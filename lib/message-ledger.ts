/**
 * Append-only message ledger: log every inbound and outbound SMS for audit/support.
 * Table: message_ledger (user_id, direction, peer_phone, content_snippet, context, ...).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const SNIPPET_MAX_LEN = 500

export type MessageLedgerEntry = {
  user_id?: string | null
  direction: 'inbound' | 'outbound'
  peer_phone: string
  content_snippet: string
  context?: string | null
  message_handle?: string | null
  batch_week?: string | null
  match_id?: string | null
}

/**
 * Insert one row into message_ledger. Non-throwing; logs and returns on error so send path is not broken.
 */
export async function insertMessageLedger(
  supabase: SupabaseClient,
  entry: MessageLedgerEntry
): Promise<void> {
  const snippet =
    entry.content_snippet.length > SNIPPET_MAX_LEN
      ? entry.content_snippet.slice(0, SNIPPET_MAX_LEN) + '…'
      : entry.content_snippet
  const { error } = await supabase.from('message_ledger').insert({
    user_id: entry.user_id ?? null,
    direction: entry.direction,
    peer_phone: entry.peer_phone,
    content_snippet: snippet,
    context: entry.context ?? null,
    message_handle: entry.message_handle ?? null,
    batch_week: entry.batch_week ?? null,
    match_id: entry.match_id ?? null,
  })
  if (error) {
    console.error('[message-ledger] insert failed', error.message, entry.direction, entry.context)
  }
}
