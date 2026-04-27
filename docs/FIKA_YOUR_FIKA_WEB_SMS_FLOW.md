# Your Fika page + SMS — combined flow (spec)

> Companion to [`FIKA_MATCH_PROTOCOL.md`](./FIKA_MATCH_PROTOCOL.md) and [`FIKA_MATCH_PROTOCOL_MESSAGE_PLAYBOOK.md`](./FIKA_MATCH_PROTOCOL_MESSAGE_PLAYBOOK.md). **Not implemented yet** — product + engineering alignment.

---

## Intent

- **SMS** = lightweight offer, teaser, and **state changes** (YES / PASS / confirm).
- **Web (`/app/yourfika`)** = **intro card** appears after commitment, **teaser** drives traffic here, **availability** uses the full calendar UX.
- After saving availability on web, user **returns to SMS** for the **“availability locked in”** confirmation from the agent (or explicit keyword you define).

---

## 1. After “We found a strong Fika intro…” — user says **YES**

**SMS:** User texts **YES** (or agreed keyword).

**Backend:** Record opt-in for this match / week; user is in “matched offer accepted” state (exact state name TBD in implementation).

**Web:** **`/app/yourfika`** shows an **intro card** for this match (even **before** the teaser SMS, if you want parity the moment they say YES — or only after both YES; product choice).

**Rule to align:** If you enforce **“never advance one user ahead of the other,”** the card can be:

- **Option A:** Visible but **locked** (“Waiting for your match to respond…”) until both YES, **or**
- **Option B:** Hidden until both YES, then card appears.

Pick one and keep it consistent with the protocol.

---

## 2. Teaser SMS — include **Your Fika** link

**SMS:** After both YES, send teaser copy **and** a **second message** (or same message if short) with:

```text
https://<APP_HOST>/app/yourfika
```

**Optional:** `?match=<match_candidate_id>` or `?intro=<id>` so the page can **scroll to / highlight** the right intro card.

**Purpose:** Teaser is the hook; the **URL** is where they see the **full intro card** (photo line, bio snippet, etc.) in a richer layout than SMS.

---

## 3. Intro card — “Set availability”

**On `/app/yourfika`**, the card for this match includes:

- Teaser-style summary (same story as SMS, can be richer).
- Primary CTA: **Set availability** → navigates to **`/app/availability`** with rules below.

### Availability window (locked spec) — **slides with send day**

The **four** Fika days are **not** fixed to calendar Wed–Sat in absolute terms. They **adjust** based on **`match_offer_sent_at`** (when Phase 1 went out).

| Rule | Meaning |
|------|--------|
| **4-day availability** | **Four consecutive calendar days** on which a Fika could happen — computed from the match offer time. |
| **Buffer day** | The **first day after** the offer is reserved for **internal** confirmation (day/time, ops). So the **first selectable day on the grid** is **not** the calendar day immediately after send. |
| **Example: offer on Tuesday** | Buffer **Wednesday** → first Fika-eligible day might be **Thursday** → four days = **Thu, Fri, Sat, Sun** (illustrative; timezone + “start of day” rules in implementation). |
| **Example: offer on Monday** | Buffer **Tuesday** → four days might be **Wed, Thu, Fri, Sat**. |

**Formula (conceptual):**

1. **Anchor time:** Prefer a timestamp that means “this offer went out” — often **`match_candidates.created_at`** if the row is created when the Phase 1 offer is issued (same moment or immediately before SMS). If creation can happen before send or for retries, use **`match_offer_sent_at`** or the outbound **message ledger** time instead.
2. Convert anchor to the user’s **market timezone** (or a single product TZ — pick one).
3. **`first_grid_day`** = after **one buffer day** for internal confirm, then **four** consecutive days starting from that point (exact rule in code).
4. UI shows those **four** dates explicitly so “Tuesday send” vs “Monday send” always **adjusts**.

**SMS copy:** Don’t hardcode “Wed–Sat” unless the offer always lands on Monday; prefer *“your four-day window is in the app”* or list **computed dates**.

**Deadline** to submit: tight follow-through (e.g. 48h from when the availability step unlocks) — match existing protocol.

---

## 4. After user saves availability on web

**Implemented (baseline):** `POST /api/availability` upserts **`match_availability`** for the given `match_id`: sets `pending_sms_ready_confirmation = true` and clears `sms_ready_confirmed_at` when the user saves **with at least one slot**. Response includes `sms_ready: { pending, keyword: 'READY', message }`. A short concierge SMS says to text **READY** to confirm. (Legacy **`weekly_availability`** was removed with the old weekly pool.)

**Webhook:** Inbound **READY** (see `isAvailabilityReadyKeyword` in `lib/sms-agent.ts`) → if **`pending_sms_ready_confirmation`** and slots exist → clear pending, set **`sms_ready_confirmed_at`**, send **`messageAvailabilityLockAllSet()`** (`context: availability_ready_confirmed`).

**On the availability success view** (or back on Your Fika card), show:

1. **Button: “Continue in Messages”** (or “Text to confirm”)  
   - **Mobile:** Prefer **`sms:+1XXXXXXXXXX&body=READY`** (or `DONE` / `SET`) — **test** on iOS/Android; some clients use `?` vs `&` for body.  
   - **Fallback:** Show concierge number + **“Text READY to confirm your availability”** + copy button.

2. **Button: “Pass on this intro”**  
   - Same pattern: **`sms:…&body=PASS`** or deep link that opens Messages with **PASS** so **`sendblue-webhook`** can run the same **PASS** branch as SMS-native users.

**Why:** Keeps **source of truth** for PASS/confirm in **SMS + ledger**, while **web** did the heavy availability UI.

---

## 5. Pass / confirm — state updates

| User action | Expected result |
|-------------|-----------------|
| Saves availability + texts **READY** (or agreed token) | Agent sends confirmation text; state = availability captured; proceed to internal scheduling. |
| Taps **Pass** → SMS **PASS** | Same as SMS-only PASS: kill or wind down match per protocol. |
| Misses deadline | Protocol kill / nudge per existing rules. |

---

## 6. Implementation checklist (later)

- [ ] API or RLS so `/app/yourfika` only shows intro cards for **this user’s** active matches in the right phase.
- [ ] `match_offer_sent_at` (or per-user) for **48h** deadline UI.
- [ ] `/app/availability` accepts query params: `batch_week`, `match_id`, `deadline`, `mode=five_day` (or reuse existing weekly table with stricter date range).
- [ ] Post-save page: SMS deep links + **PASS** body.
- [ ] Webhook: new inbound keywords **READY** / **DONE** if not already mapped.
- [ ] Desktop: no `sms:` → show number + copy + QR optional.

---

## 7. One-paragraph summary

**YES** on SMS → **intro card** on **Your Fika** → teaser SMS includes **link to Your Fika** → card **Set availability** opens a **4-day sliding calendar** anchored on **`match_offer_sent_at`** (e.g. offer **Tuesday** → grid adjusts; not fixed Wed–Sat globally) after the **buffer day** for internal confirm → on save, **Continue in Messages** triggers **SMS confirm** (keyword) or **Pass** opens SMS with **PASS** so the **agent updates state** the same way as a text-only user.

This matches your description and stays consistent with the **protocol** as long as **both-side** gating for the card is explicitly chosen (locked vs hidden until both YES).
