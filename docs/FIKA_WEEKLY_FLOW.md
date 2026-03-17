# Fika Weekly Flow — Product spec

Single reference for the weekly SMS flow: user opt-in, availability, intro, confirmation, and day-of reminder. No code — product intent and copy only.

---

## Decisions (locked)

| Question | Decision |
|----------|----------|
| **Sunday evening reminder — when?** | 8 PM PT |
| **No match Tuesday — tell them?** | Yes. Send: "No match this week — text FIKA next Sunday to try again." |
| **Reschedule/cancel after YES-by-9PM?** | Later phase. Reschedule/cancel will be supported on the day of the Fika only. |
| **Venue/time in intro?** | One suggested time and one venue per intro. Algorithm picks from overlapping availability; no back-and-forth. |

---

## Opt-in window

**Opens:** Sunday 12am PT  
**Closes:** Monday 11am PT  

Users opt in by texting **FIKA** during this window. We do not text them first; they must text us.

---

## Sunday — User opt-in

**Trigger:** User texts **FIKA** (during the window above).

**Reply 1 (immediate):**  
*You're in for this week's Fika.*

**Reply 2 (separate message; URL standalone):**  
*Great — let's set up your Fika for this week.*  
*Please share when you're free between Wednesday and Saturday:*  
`[availability link]`  

*You can update your availability until Monday at 11 AM PT.*

---

## Sunday 8 PM PT — Availability reminder

**Who gets it:** Users who texted FIKA but have **not** submitted availability by 8 PM PT Sunday.

**Message:**  
*Quick reminder to set your availability for this week's Fika.*  
*Please submit it by 11 AM PT tomorrow.*  
`[availability link]` (standalone message)

---

## Monday 11 AM PT — Availability lock

**Who submitted availability:**  
*You're all set for this week's Fika.*  
*We'll send your introduction tomorrow morning.*

**Who did not submit in time:**  
*Looks like availability wasn't submitted in time for this week.*  
*You can opt in again next Sunday.*

---

## Tuesday — Fika introductions

**Who gets it:** Users who set availability and received a match.

**Message:**  
*You've been matched with [Name].*  
*You both live near [area] and are free [day] [time].*  

*Fika plan*  
*[Day] — [Time]*  
*[Venue]*  

*Reply YES to confirm by 9 PM tonight.*

**Design:** One proposed plan (day, time, venue). Single confirmation; no separate confirm-intro / confirm-venue / confirm-time steps.

---

## Tuesday 9 PM PT — Confirmation deadline

**If both reply YES:**  
*Your Fika is confirmed.*  
*[Day] — [Time]*  
*[Venue]*  
*Enjoy the conversation.*

**If either passes or doesn’t respond by 9 PM:**  
Introduction expires. Both can opt in again next Sunday.

---

## Tuesday — No match

**Who gets it:** Users who set availability but had no match this week.

**Message:**  
*No match this week — text FIKA next Sunday to try again.*

---

## Day of the Fika — Reminder

**Who gets it:** Both users with a confirmed Fika that day.

**Message:**  
*Reminder: Your Fika with [Name] is today.*  
*[Day] — [Time]*  
*[Venue]*

Reschedule/cancel (day-of only) is a later phase; existing HERE / RUNNING LATE / CAN'T MAKE IT behavior can remain until then.

---

## Weekly rhythm

| When | What |
|------|------|
| Sunday | User texts FIKA → commitment line + availability link. |
| Sunday 8 PM PT | Reminder + link (only if availability not set). |
| Monday 11 AM PT | Availability locks; "all set" or "not submitted in time." |
| Tuesday | Intro with full plan, or "No match this week." |
| Tuesday 9 PM PT | Confirm or expire. |
| Wed–Sat | Fika window; day-of reminder on the actual day. |

---

## Messaging load

- **User-initiated:** FIKA → commitment + link.
- **Scheduled outbound:** Sunday 8 PM reminder (if needed), Monday 11 AM lock messages, Tuesday intro or no-match, Tuesday 9 PM confirm/expire, day-of reminder.
