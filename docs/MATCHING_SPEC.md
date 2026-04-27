# Matching spec — scoring rules for `match_candidates` (Fika backend)

The **`replenish-matches`** Edge Function was **removed** with the legacy weekly pool. This doc still specifies how **any job that fills `match_candidates`** (admin simulation, **`lib/weekly-fika-matcher.ts`**, or a future automated matcher) should use **gender + gender preference** and the **new intake questions** for filtering and scoring. Apply these rules in the meetwithmoai backend.

---

## 1. Gender preference (profiles)

**Source:** `profiles.gender` and `profiles.gender_preference`.

**`gender_preference` values (updated in Fika webapp):**
- `No preference` – no filter by gender; include all candidates (subject to other rules).
- `Same gender` – only include candidates whose `gender` matches the user’s `gender`.
- `Different gender` – only include candidates whose `gender` is different from the user’s `gender`.

**Implementation notes:**
- Compare using normalized strings (e.g. trim, consistent casing). Stored values are: `Female`, `Male`, `Non-binary`, `Other`, `Prefer not to say`.
- **Same gender:** For `Non-binary`, “same” typically means the other person is also `Non-binary`. For `Other` / `Prefer not to say`, you can treat “same” as matching that exact value, or treat as “no preference” if that’s simpler.
- **Different gender:** Exclude candidates with the same `gender` as the user. Everyone else is allowed (including non-binary when user is binary, and vice versa).
- Apply the filter **both ways**: when building candidates for user A, respect A’s preference (A’s gender vs B’s gender), and also respect B’s preference (B’s gender vs A’s gender). So a pair is valid only if both A’s and B’s gender preferences are satisfied.

---

## 2. New intake questions to use in scoring / reasons

**Source:** `intake_responses_v5.responses` (array of `{ question_id, answer, ... }`).

**New question IDs and suggested use:**

| Question ID        | Meaning              | Suggested use in matching |
|--------------------|----------------------|----------------------------|
| `q3_work_or_study` | Work/study description | Life-stage similarity or diversity; include in `reasons`. Values: I work, I'm in school, I work and study, Between things / in transition, On extended leave, Other, Prefer not to say. |
| `q3_profession`    | Industry             | Similarity/diversity by industry; boost score for same industry or surface in `reasons` (“Both in tech”, “Both in healthcare”). |
| `q3_university`    | School (LA area)     | Optional: same-school or same-system boost; or “Both at UCLA” in reasons. |
| `q3_major`         | Major                | Optional: same major or related field in reasons; mainly for students. |

**Implementation notes:**
- Use `answerToText()` (or equivalent) for any answer that might be an array or number – see `docs/REPLENISH_MATCHES_FIX.md`.
- **Scoring:** Add these fields to whatever text is used for embedding/similarity (if the backend builds a blob from intake for vector search), and/or use them in a heuristic score (e.g. +weight for same industry, same work/study status).
- **Reasons:** Populate `match_candidates.reasons` with human-readable hooks, e.g.:
  - From `q3_profession`: “Both in Technology”, “Both in Healthcare”, etc.
  - From `q3_work_or_study`: “Both working”, “Both studying”, “One studying, one working”, or situation-based (e.g. “Both full-time students”).
  - From `q3_university` / `q3_major`: “Both at UCLA”, “Same major”, etc. (optional).
- If a user hasn’t answered these (e.g. completed onboarding before they were added), skip them; don’t assume a value.
- **q12_first_conversation:** When the answer is stored as `"N/A"` (user left it empty), treat it as “no content” — don’t use it in embedding text, reasons, or scoring. For full scoring/recalibration notes, see `docs/SCORING_AND_RECALIBRATION.md`.

---

## 3. Embedding / open-ended text (optional)

If the backend or Fika’s **complete-intake** flow builds a single text for embedding from intake, consider including the new questions so vector similarity reflects work/study, industry, and optionally school/major. For example append:
- `q3_work_or_study` (string)
- `q3_profession` (string)
- `q3_university` (string)
- `q3_major` (string)

using `answerToText()` for each. That way similarity search naturally rewards alignment on these dimensions without changing the rest of the pipeline.

---

## 4. Summary checklist for backend

- [ ] **Gender filter:** Read `profiles.gender` and `profiles.gender_preference` for both users in a pair.
- [ ] **Same gender:** Only allow pairs where the candidate’s gender matches the user’s gender (with a clear rule for Non-binary / Other).
- [ ] **Different gender:** Only allow pairs where the candidate’s gender is different from the user’s gender.
- [ ] **Both directions:** Enforce each user’s preference when they are the “user” and when they are the “candidate.”
- [ ] **Reasons:** Include `q3_work_or_study`, `q3_profession`, and optionally `q3_university` / `q3_major` in `match_candidates.reasons` (conversation hooks / shared traits).
- [ ] **Scoring:** Use the new intake fields in score (same industry, same work/study, etc.) and/or in the text used for embedding.
- [ ] **Safe parsing:** Use a safe `answerToText(answer)` for all intake answers (string, array, number) to avoid `.trim is not a function` – see `docs/REPLENISH_MATCHES_FIX.md`.
