# Scoring system and recalibration (new questions)

This doc describes the **structured-only** design: embed = q12 only (low weight), all other signals via explicit filters and score weights. No double-counting (other questions are not added to the embed).

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

### 1.3 Backend: score weights (100% total)

| Component | Weight | Notes |
|-----------|--------|--------|
| **Embedding (q12)** | 8% max | Only when both have substantive q12 text; else 0. |
| **q1_conversation_types** | 20% | Multi-select overlap. |
| **q5_talk_about** | 24% | Multi-select overlap. |
| **q6_who_excited_to_meet** | 6% | Alignment; if either "open to anyone" → 0.5, else overlap. |
| **q2_life_chapter** | 12% | Multi-select overlap. |
| **q10_first_conversation_feel** | 12% | Multi-select overlap. |
| **q4_where_most_yourself** | 7% | Multi-select overlap. |
| **q3_work_or_study** | 5% | Same value = full; different = small. |
| **Distance** | 6% | Closer = better (among pairs who pass geography filter). |

---

## 2. Intake questions reference

| Question ID | Role in algo |
|-------------|--------------|
| `q2_life_chapter` | Score 12%. |
| `q3_work_or_study` | Score 5%. |
| `q3_profession` / school / major | Reasons only (optional future score). |
| `q1_conversation_types` | Score 20%. |
| `q4_where_most_yourself` | Filter + score 7%. |
| `q5_talk_about` | Score 24%. |
| `q6_who_excited_to_meet` | **Filter (compatibility)** + score 6%. |
| `q9_availability` | Filter only. |
| `q8_distance_miles` | Filter + score 6%. |
| `q10_first_conversation_feel` | Filter + score 12%. |
| `q11_season_of_life` | Reasons only. |
| `q12_first_conversation` | Embed only (8% conditional). |

---

## 3. Design choice: no double-counting

Other questions are **not** added to the embed. They influence the score only through the structured weights above. Embed remains q12-only unless we later switch to an "embed-heavy" design.

---

## 4. Summary checklist

- [x] **Webapp:** Embed only q12; exclude empty/N/A. No q3_work_study_detail.
- [x] **Backend:** q6 compatibility filter.
- [x] **Backend:** Score weights rebalanced (embed 8% conditional, q1 20%, q5 24%, q6 6%, q2 12%, q10 12%, q4 7%, q3 5%, distance 6%).
- [x] **Backend:** q3_work_or_study and distance in score.
- [x] **Backend:** q12 only in open-ended reasons; N/A skipped; OpenAI threshold ≥ 1.
