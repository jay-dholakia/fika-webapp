# Fika match protocol — product spec (canonical)

> **Status:** Target protocol for matching, messaging, and scheduling. Align implementation and crons to this document. This is the canonical source for current flow and messaging.
>
> **Exact example copy + response handling:** see [`FIKA_MATCH_PROTOCOL_MESSAGE_PLAYBOOK.md`](./FIKA_MATCH_PROTOCOL_MESSAGE_PLAYBOOK.md).  
> **Your Fika page + availability + SMS handoff:** see [`FIKA_YOUR_FIKA_WEB_SMS_FLOW.md`](./FIKA_YOUR_FIKA_WEB_SMS_FLOW.md).  
> **Retiring `pg_cron` weekly jobs:** see [`FIKA_CRON_REPLACEMENT.md`](./FIKA_CRON_REPLACEMENT.md).  
> **Pre-implementation review (read before coding):** [`FIKA_PRE_IMPLEMENTATION_REVIEW.md`](./FIKA_PRE_IMPLEMENTATION_REVIEW.md).

**One-line summary:** You propose → they lean in → you handle everything → they show up.

---

## Phase 0 — Internal lock (before any outbound)

Before you send anything, sanity-check:

- Do they live reasonably close?
- Is there at least some availability overlap **likely**?
- Can I picture a good coffee shop for them?

If not → **don’t send** the match yet.

**Rule:** Never “offer” a match you can’t realistically fulfill.

---

## Phase 1 — Simultaneous match offer

Send to **both** users **at the same time** (important):

> We found a strong Fika intro for you this week — want us to set it up?

**Rules:**

- Keep it simple
- No details yet
- Feels real, not hypothetical

**Wait for:** YES / PASS

### Branching

| Case | Action |
|------|--------|
| **A — Both YES** | Continue |
| **B — One YES, one pending** | Wait (don’t advance) |
| **C — One PASS** | Kill match quietly |

**If someone is slow (>24h):**

> Still want me to line this up for you?

---

## Phase 2 — Teaser (unlock interest)

Send **only after both have said YES** (keeps parity with Phase 1 — no one sees a “preview” while the other is still pending). Optionally send **both teasers at the same time**.

> Nice — quick preview:  
> You’d be meeting Alex. Just moved to LA, works in product, into lifting and trying new coffee spots.

**Why:** This is what gets them to actually complete availability.

*(If you ever A/B “teaser right after my YES,” keep Critical Rule #1 — don’t imply the other person is further along than they are.)*

---

## Phase 3 — Availability capture

Immediately after teaser:

> Drop your availability for the next few days and we’ll lock this in.

**Best practice:**

- Push to a **simple link** (fastest), and/or accept **free text** if you support it.

**Important:**

- Keep the window **tight** — **four Fika days**, **computed from `match_offer_sent_at`** (sliding window; e.g. offer on **Tuesday** shifts the four days vs offer on **Monday**) plus a **buffer day** after send for internal day/time confirm. See [`FIKA_YOUR_FIKA_WEB_SMS_FLOW.md`](./FIKA_YOUR_FIKA_WEB_SMS_FLOW.md).

### Branching

| Case | Action |
|------|--------|
| **A — Both submit** | Proceed |
| **B — One submits, one doesn’t** | Nudge the lagging user: *Still want me to line this up with Alex?* |
| **No response ~48h** | Kill match |

---

## Phase 4 — Internal scheduling (ops / product moment)

Now **you** (the system + human judgment as needed):

- Find overlap
- Choose the time
- Choose the place

**Guidelines:**

- Midweek evenings or weekend mornings
- Coffee shops, not meals
- As close to **midpoint** between them as reasonable

This is not trivial — this is **product quality**.

---

## Phase 5 — Full reveal + plan (the payoff)

Send to **both**:

> You’re set.  
> You’ll be meeting Alex — they recently moved to LA, work in product, and have been exploring new coffee spots.  
> 📍 Maru Coffee, Los Feliz  
> 🗓 Wednesday at 6:30pm  
> If anything comes up, just text me here.

**Important:**

- Should feel **final**
- No “does this work?” — **you decide**, not ask

---

## Phase 6 — Day-of reinforcement

**Morning of:**

> You’re meeting Alex today at 6:30pm at Maru Coffee. Let me know if you’re running late.

---

## Phase 7 — Post-Fika loop

**Same evening or next day:**

> How was your Fika with Alex?

**Optional follow-up:**

> Would you want another intro soon?

---

## Full flow summary

1. Identify match (with Phase 0 gate)  
2. Send match offer (**both**, simultaneous)  
3. Get YES from **both**  
4. Send teaser (each, after their YES — or align timing so neither runs ahead; see rules)  
5. Collect availability  
6. Schedule internally  
7. Send full plan  
8. Remind (day-of)  
9. Collect feedback  

---

## Critical rules (don’t break)

1. **Never advance one user ahead of the other** — No one should feel: *“Wait, is the other person even in?”*

2. **Speed > perfection** — Match → plan ideally **24–48h**. Momentum = everything.

3. **The reveal is sacred** — Poorly written, inconvenient, or confusing = instant trust loss.

4. **Kill bad matches early** — One side slow, or availability doesn’t align → drop cleanly. Bad Fikas are worse than no Fikas.

---

## What this should feel like

**Not:** a form, a scheduling tool, a dating app.

**But:** *Someone is thoughtfully setting this up for me.*

---

## Implementation notes (for later; not blocking alignment)

- Requires **simultaneous** or **fair** dual-side state machine (webhook + ledger).
- Phases 0 and 4 imply **internal** checks before Phase 1; weekend **score-without-availability** jobs may feed Phase 0 *eligibility*, while Phase 3 uses **four consecutive days** sliding from **match send time** — see `FIKA_YOUR_FIKA_WEB_SMS_FLOW.md`.
- **Two thresholds** (nudge vs final intro) from prior alignment still apply where relevant; this doc defines **UX sequence**, not numeric thresholds.
