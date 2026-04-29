/**
 * Calls Edge Function sms-match-delivery. Success is HTTP 2xx **and** JSON `{ ok: true }`
 * so “handled but nothing sent” (`{ ok: false }`) does not mark intros in the DB.
 */
export async function invokeSmsMatchDelivery(params: {
  supabaseUrl: string
  serviceRoleKey: string
  matchIds: string[]
}): Promise<{ ok: boolean; status: number; text: string }> {
  const fnUrl = `${params.supabaseUrl.replace(/\/$/, '')}/functions/v1/sms-match-delivery`
  let res: Response
  try {
    res = await fetch(fnUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.serviceRoleKey}`,
      },
      body: JSON.stringify({ match_ids: params.matchIds }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'fetch failed'
    return { ok: false, status: 0, text: JSON.stringify({ ok: false, error: msg }) }
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) return { ok: false, status: res.status, text }
  try {
    const parsed = JSON.parse(text) as { ok?: boolean }
    return parsed.ok === true ? { ok: true, status: res.status, text } : { ok: false, status: res.status, text }
  } catch {
    return { ok: false, status: res.status, text }
  }
}
