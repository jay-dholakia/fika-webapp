# Fika match protocol — message playbook (examples)

> **Phase 0 today:** Done manually via **admin match simulation** (and human judgment) before any user-facing send. Nothing automated in this doc for Phase 0.

Below: **example copy** for **Phases 1–7**, with **two users** — **Jordan** and **Alex** (swap names per recipient). Replace names, venue, times, and bios with real data.

**Convention:** `→` = next outbound or system action. **User** = inbound SMS.

---

## Phase 1 — Simultaneous match offer

### Outbound (both users, same time)

**Message 1 (identical to Jordan and Alex):**

```text
We found a strong Fika intro for you this week — want us to set it up?
```

### User responses

| User says | What happens |
|-----------|----------------|
| **YES** (or agreed keyword: e.g. `YES`, `Y`, `Sure`) | Record YES for that user. If **other not yet YES** → **no new copy** (wait). If **both YES** → go to **Phase 2**. |
| **PASS** (or `PASS`, `No thanks`) | Record PASS → **kill match** for both (no further messages on this match; optional short ack below). |
| **Anything else / HELP** | Short clarification: *Reply YES if you want us to set it up, or PASS to skip this one.* |
| **STOP** | Opt-out flow (policy); match killed. |

### Optional ack after PASS (keep light)

```text
Got it — we'll pass on this one. Text us anytime if you want to try another week.
```

### If one person YES, other silent — after ~24h (only to the silent user)

```text
Still want me to line this up for you?
```

| User says | What happens |
|-----------|----------------|
| **YES** | If other already YES → Phase 2. If other still pending → keep waiting. |
| **PASS** | Kill match (same as above). |
| **Nothing** | Per policy: after another window, kill or escalate (your 24h/48h rules). |

### If both YES — go to Phase 2

(No Phase 1 message to the person who already said YES until Phase 2 fires for both.)

---

## Phase 2 — Teaser (after both YES)

Send **each** person a teaser about the **other** person. **Same moment** for both if possible.

### To Jordan (about Alex)

```text
Nice — quick preview:

You'd be meeting Alex. Just moved to LA, works in product, into lifting and trying new coffee spots.
```

### To Alex (about Jordan)

```text
Nice — quick preview:

You'd be meeting Jordan. Lives in Silver Lake, into film photography and weekend hikes.
```

### User responses

Usually **none required** — next message is Phase 3. If they reply anyway:

| User says | What happens |
|-----------|----------------|
| **Question / nervous text** | Short reassuring reply, then **Phase 3** as planned. |
| **PASS / never mind** | Treat as **withdraw** → kill or pause match per policy. |

---

## Phase 3 — Availability capture

Send **immediately after** teaser (same thread feel). **Both** get availability ask; link as **second message** if you split for deliverability.

### Message A (text)

```text
Open the link — your four-day window is there (dates match when we sent your intro).
```

*(Shorter SMS variant: `Drop your availability for this week's window and we'll lock this in.`)*

*(Product: **four consecutive Fika days** — **not** fixed to Wed–Sat on the calendar; **slides** from `match_offer_sent_at` — e.g. offer on **Tuesday** shifts the four days. One **buffer day** after send for internal day/time confirm — see `FIKA_YOUR_FIKA_WEB_SMS_FLOW.md`.)*

### Message B (link — separate bubble)

```text
https://letsfika.vercel.app/app/availability
```

*(Use your real `APP_CANONICAL_URL` + path.)*

### If one submits, one doesn’t — after a beat, **only to the laggard**

```text
Still want me to line this up with Alex?
```

*(Use the **other person’s first name** for the laggard’s message.)*

### User responses

| Action | What happens |
|--------|----------------|
| **Completes link / app** | Record availability → if **both** in → **Phase 4** internal. |
| **Free text** (if you support it) | Parse or ops review → mark received. |
| **PASS / can't** | Kill or negotiate per policy. |
| **Silence ~48h** | **Kill match** (clean exit message below). |

### Optional kill after no availability

```text
We couldn't line this one up in time — no worries. We'll reach out when there's another good intro.
```

---

## Phase 4 — Internal scheduling

**No user-facing SMS** in this phase — ops/system picks overlap, time, venue (midpoint, coffee, etc.).

---

## Phase 5 — Full reveal + plan (both users)

**Same structure for both**; names and bios describe the **other** person.

### To Jordan

```text
You're set.

You'll be meeting Alex — they recently moved to LA, work in product, and have been exploring new coffee spots.

📍 Maru Coffee, Los Feliz
🗓 Wednesday at 6:30pm

If anything comes up, just text me here.
```

### To Alex

```text
You're set.

You'll be meeting Jordan — they're in Silver Lake, love film photography, and are down for weekend hikes.

📍 Maru Coffee, Los Feliz
🗓 Wednesday at 6:30pm

If anything comes up, just text me here.
```

### User responses

| User says | What happens |
|-----------|----------------|
| **Thanks / emoji / “see you”** | Optional short ack: *Amazing — see you Wednesday.* |
| **Question about venue / time** | **Policy call:** either brief factual answer or *We’ve got this locked — text me day-of if something comes up.* (Protocol says **decisive**, not re-opening negotiation.) |
| **Can't make it / need to cancel** | Move to **reschedule/cancel** flow (existing product). |
| **PASS now** | Rare; handle as cancel / forfeit. |

---

## Phase 6 — Day-of (morning of)

**Both** get a reminder; same facts.

```text
You're meeting Alex today at 6:30pm at Maru Coffee. Let me know if you're running late.
```

*(Alex’s version: “meeting Jordan”.)*

### User responses

| User says | What happens |
|-----------|----------------|
| **Running late** | Ack + optional ping to other if you relay. |
| **Can't make it** | Day-of crisis / cancel flow. |
| **👍 / ok** | Optional tiny ack or none. |

---

## Phase 7 — Post-Fika

### Same evening or next day

```text
How was your Fika with Alex?
```

### Optional follow-up (later message or thread)

```text
Would you want another intro soon?
```

### User responses

| User says | What happens |
|-----------|----------------|
| **Positive** | Thank them; tag for re-match pipeline if you want. |
| **Negative / issues** | Support / feedback capture. |
| **No reply** | Close thread or one gentle nudge per policy. |

---

## Quick reference — happy path only

1. **Phase 0:** Admin simulation / manual gate ✓  
2. **Phase 1:** Same offer → both **YES**  
3. **Phase 2:** Teaser to each (about the other)  
4. **Phase 3:** Availability copy + link → both submit  
5. **Phase 4:** *(silent)* schedule  
6. **Phase 5:** Full reveal to both  
7. **Phase 6:** Day-of reminder  
8. **Phase 7:** Feedback + optional re-intro ask  

---

## Keyword cheat sheet (suggested)

| Intent | Accept |
|--------|--------|
| Accept match offer | `YES`, `Y`, `SURE`, `OK` (normalize in code) |
| Decline match offer | `PASS`, `NO`, `NO THANKS` |
| Help | `HELP` |

Tune to match your webhook’s existing keyword helpers.
