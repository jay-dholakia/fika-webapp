import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { isAdminByUserId } from '@/lib/admin-markets'
import { sendConcierge } from '@/lib/sendblue'
import { messageEventCancelledByAdmin } from '@/lib/sms-agent'

export const dynamic = 'force-dynamic'

async function getAdminSupabase(request: Request): Promise<SupabaseClient | null> {
  const supabaseAuth = await createServerSupabase()
  if (!supabaseAuth) return null
  let userId: string | null = null
  const { data: { session } } = await supabaseAuth.auth.getSession()
  if (session?.user?.id) userId = session.user.id
  if (!userId) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)
      const { data: { user } } = await supabaseAuth.auth.getUser(token)
      if (user?.id) userId = user.id
    }
  }
  if (!userId) return null
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) throw new Error('Server not configured')
  const supabase = createClient(url, key)
  const admin = await isAdminByUserId(supabase, userId)
  if (!admin) return null
  return supabase
}

/** DELETE /api/admin/weekly-events/[id]
 *  - Sends cancellation SMS to all users with a yes RSVP
 *  - Marks those RSVPs as cancelled
 *  - Resets sms_conversation_states for pending invitees back to GLOBAL_READY
 *  - Deletes the event */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = await getAdminSupabase(request)
    if (!supabase) return NextResponse.json({ error: 'Admin role required', code: 'NOT_ADMIN' }, { status: 403 })

    const eventId = params.id

    const { data: event } = await supabase
      .from('weekly_fika_events')
      .select('id')
      .eq('id', eventId)
      .single()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })

    // Find yes RSVPs with phone numbers
    const { data: yesRsvps } = await supabase
      .from('weekly_rsvps')
      .select('id, user_id, profiles!inner(phone)')
      .eq('event_id', eventId)
      .eq('decision', 'yes')

    // Send cancellation SMS to confirmed attendees
    const nowIso = new Date().toISOString()
    const message = messageEventCancelledByAdmin()
    let notified = 0

    for (const rsvp of yesRsvps ?? []) {
      const phone = (rsvp.profiles as unknown as { phone: string | null } | null)?.phone?.trim()
      if (phone) {
        await sendConcierge(phone, message)
        notified++
      }
    }

    // Mark yes RSVPs as cancelled
    if ((yesRsvps ?? []).length > 0) {
      const rsvpIds = (yesRsvps ?? []).map(r => r.id)
      await supabase
        .from('weekly_rsvps')
        .update({ decision: 'cancelled', decided_at: nowIso })
        .in('id', rsvpIds)
    }

    // Reset sms_conversation_states for all users still in this event's flow (including reveal_sent)
    const { data: pendingStates } = await supabase
      .from('sms_conversation_states')
      .select('user_id')
      .in('state', ['social_invited', 'weekly_opt_in_sent', 'social_rsvp_accepted', 'social_morning_reminder', 'social_reveal_sent'])
      .filter('payload->>event_id', 'eq', eventId)
      .is('match_id', null)

    for (const s of pendingStates ?? []) {
      await supabase.rpc('upsert_global_sms_conversation_state', {
        p_user_id: s.user_id,
        p_state: 'global_ready',
        p_payload: {},
        p_last_sendblue_message_handle: null,
      })
    }

    // Delete all RSVPs for this event (FK has no cascade), then delete the event
    await supabase.from('weekly_rsvps').delete().eq('event_id', eventId)
    await supabase.from('weekly_fika_events').delete().eq('id', eventId)

    return NextResponse.json({ ok: true, notified, reset: (pendingStates ?? []).length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
