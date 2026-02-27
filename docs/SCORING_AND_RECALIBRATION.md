# Scoring system and recalibration (new questions)

This doc describes the **structured-only** design: embed = q12 only (low weight), all other signals via explicit filters and score weights. No double-counting (other questions are not added to the embed).

---

## What users see vs. what’s matching-only

**Visible to the other person when they see an intro** (card + detail modal):

- **Profile:** First name, city, age, avatar, languages, bio (if set).
- **Intake shown in modal:** Only questions in the “safe for reasons” set — used to build **reasons** (conversation hooks, shared interests) and/or displayed as “About them” sections. Currently: q2 life chapter, q3 work/study, q3 profession/school/major, q5 topics, q10 first conversation feel, q4 meetup format, q6 who they’re open to meet, q9 availability, q11 season of life. These are the only intake answers the backend should surface in reasons and the only ones the webapp shows in the intro detail modal.

**Used only for matching (not shown to the other person):**

- **Filters:** Gender, gender_preference, q9 availability, q8 distance, q4 meetup format, q10 first conversation feel, q6 who excited to meet — used to gate or rank candidates; specific answers are not shown.
- **Score-only intake (private):** q13 country belief, q14 societal discussion style, q15 political/social comfort. These are used in the match score only. They are **not** included in reasons and **not** shown in the intro modal (treated as private).

**Summary:** If it’s in the “reasons” / “safe intake” set, it can be shown. If it’s score-only or filter-only, it is used for matching but not displayed to the other user.

---

## Two parts of scoring

1. **Embedding (vector)** — Built in the Fika webapp from **q12 only**. Stored in `intake_responses_v5.embed_vector`. Used for a small share of the match score (8% max, conditional on both having substantive q12 text).

2. **Percentage / numeric score** — Computed in the backend (replenish-matches) from **structured weights only** (plus the small embed term). Written to `match_candidates.score`. No other questions are added to the embed so each signal is counted once.

---

## 1. Current design (structured-only)

### 1.1 Webapp: embeddings (complete-intake)

- **What gets embedded:** Only **q12_first_conversation**. Empty or `"N/A"` are excluded.
- **Output:** OpenAI `text-embedding-3-small` → `intake_responses_v5.embed_vector`.
- **Intent:** One weak, optional semantic signal; all other matching is explicit.

### 1.2 Backend: filters (hard gates)

Candidates must pass all of:

| Filter | Logic |
|--------|--------|
| **q9_availability** | At least one overlapping time slot. |
| **q8_distance_miles** | Within combined radius (sum of both users' radii). |
| **Gender / gender_preference** | Mutual compatibility. |
| **q4_where_most_yourself** | At least one overlapping meetup format. |
| **q10_first_conversation_feel** | At least one overlapping "first conversation feel" option. |
| **q6_who_excited_to_meet** | **Compatibility (not overlap):** "I'm open to anyone" or difference-seeking → pass. "Someone I'd instantly relate to" (without "open to anyone") → other must have "instantly relate" or "open to anyone." |
| **q15_political_social** | **Filter 7:** Do not match "I'd rather avoid political topics altogether" with "I actively enjoy discussing politics and current events." |
| **q13_country_belief** | **Filter 8:** Do not match "Moving in the right direction" with "In need of major change." |

### 1.3 Backend: score weights (100% total)

| Component | Weight | Notes |
|-----------|--------|--------|
| **Embedding (q12)** | 8% max | Only when both have substantive q12 text; else 0. |
| **q5_talk_about** | 32% | Multi-select overlap (topics they enjoy). |
| **q10_first_conversation_feel** | 14% | Multi-select overlap (prioritized over life chapter). |
| **q2_life_chapter** | 10% | Multi-select overlap. |
| **q4_where_most_yourself** | 7% | Multi-select overlap. |
| **q6_who_excited_to_meet** | 6% | Alignment; if either "open to anyone" → 0.5, else overlap. |
| **Distance (q8)** | 6% | Closer = better (among pairs who pass geography filter). |
| **q3_work_or_study** | 5% | Same value = full; different = small. |
| **q3_profession / university / major** | 4% | Work/school similarity: same industry, same school, or same major = contribution. Only when both have answered; else 0. Shown in reasons. |
| **q15_political_social** | 4% | Compatibility: avoid pairing "avoid" with "actively enjoy"; overlap or adjacent = higher. **Private — not in reasons.** |
| **q13_country_belief** | 2% | Same or adjacent on belief scale; Filter 8 blocks right direction vs major change. **Private — not in reasons.** (Question: "Right now, I believe the country is…" — Moving in the right direction, In need of major change, More stable than people think, Hard to define in one sentence, Prefer not to say.) |
| **q14_societal_discussion** | 2% | Compatibility (e.g. share my views vs opposing perspectives). **Private — not in reasons.** |

**Total:** 8 + 32 + 14 + 10 + 7 + 6 + 6 + 5 + 4 + 4 + 2 + 2 = 100% (embed is conditional).

**Note:** q13, q14, q15 are **scoring only** — not included in reasons, not visible to the other user. Profession / university / major are in the score and remain visible in reasons/modal.


---

## 2. Intake questions reference

**Onboarding order (webapp):** Who you are (q2, q3, profession/school/major) → What you talk about (q5 topics, q13 country, q14 societal, q15 political) → How you connect (q10, q4, q6) → Practicals (q9, q8) → Optional wrap (q11, q12, confirm).

| Question ID | Role in algo | Shown to other user? |
|-------------|--------------|----------------------|
| `q2_life_chapter` | Score 12%. | Yes (reasons / modal). |
| `q3_work_or_study` | Score 5%. | Yes (reasons / modal). |
| **q3_profession / university / major** | **Score 4%** (work/school similarity). | Yes (reasons / modal). |
| `q4_where_most_yourself` | Filter + score 7%. | Yes (reasons / modal). |
| `q5_talk_about` | Score 32% (topics they enjoy). | Yes (reasons / modal). |
| `q6_who_excited_to_meet` | **Filter (compatibility)** + score 6%. | Yes (reasons / modal). |
| `q9_availability` | Filter only. | Yes (reasons / modal). |
| `q8_distance_miles` | Filter + score 6%. | No (matching only). |
| `q10_first_conversation_feel` | Filter + score 12%. | Yes (reasons / modal). |
| `q11_season_of_life` | Reasons only. | Yes (reasons / modal). |
| **q13_country_belief** | **Score 2%.** | **No — private.** |
| **q14_societal_discussion** | **Score 2%.** | **No — private.** |
| **q15_political_social** | **Score 4%.** | **No — private.** |
| `q12_first_conversation` | Embed only (8% conditional). | Yes (reasons from embed/reasons text). |

q13, q14, q15 are scoring only; do **not** include them in reasons or show in the intro modal.

---

## 3. Design choice: no double-counting

Other questions are **not** added to the embed. They influence the score only through the structured weights above. Embed remains q12-only unless we later switch to an "embed-heavy" design.

---

## 4. Summary checklist

- [x] **Webapp:** Embed only q12; exclude empty/N/A. No q3_work_study_detail.
- [x] **Backend:** q6 compatibility filter.
- [x] **Backend:** Score weights rebalanced: embed 8% conditional, q5 32%, q2 12%, q10 12%, q4 7%, q6 6%, distance 6%, q3_work_or_study 5%, q3_profession/university/major 4%, q15 4%, q13 2%, q14 2%. q13/q14/q15 scoring only, not in reasons.
- [ ] **Backend:** Implement full weight set (incl. q3 profession/school/major 4%, q13 2%, q14 2%, q15 4%). Do **not** include q13, q14, q15 in reasons payload.
- [x] **Backend:** q3_work_or_study and distance in score.
- [x] **Backend:** q12 only in open-ended reasons; N/A skipped; OpenAI threshold ≥ 1.
