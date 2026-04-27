# Fix for `response.answer.trim is not a function` in replenish-matches

> **Archive:** The **`replenish-matches`** Edge Function was **removed** from this repo with the legacy weekly pool. Keep this note for **`answerToText()`**-style handling anywhere intake `responses` are normalized (e.g. admin matcher, future edge jobs).

The error happens because `response.answer` can be an **array** (e.g. multi-select) or other non-string type. Historically this was applied in **`supabase/functions/replenish-matches/index.ts`** (no longer in tree).

---

## 1. Add this helper inside `generateMatchReasonsV4`, right before the `try {` that starts "Generate comprehensive conversation hooks" (before the line that says `const userResponses: Record<string, string> = {}`):

```ts
  // Safe string from any answer type (string, array, number)
  function answerToText(answer: unknown): string {
    if (answer == null) return ''
    if (typeof answer === 'string') return answer.trim()
    if (Array.isArray(answer)) return answer.map((a: any) => String(a).trim()).filter(Boolean).join(', ').trim()
    return String(answer).trim()
  }
```

---

## 2. Replace the first block that builds `userResponses` (the forEach over openEndedQuestionIds for userIntake):

**Find:**
```ts
    if (userIntake.responses && Array.isArray(userIntake.responses)) {
      openEndedQuestionIds.forEach(qId => {
        const response = userIntake.responses.find((r: any) => r.question_id === qId)
        if (response?.answer && response.answer.trim().length > 0) {
          userResponses[qId] = response.answer.trim()
        }
      })
    }
```

**Replace with:**
```ts
    if (userIntake.responses && Array.isArray(userIntake.responses)) {
      openEndedQuestionIds.forEach(qId => {
        const response = userIntake.responses.find((r: any) => r.question_id === qId)
        if (response?.answer) {
          const text = answerToText(response.answer)
          if (text.length > 0) userResponses[qId] = text
        }
      })
    }
```

---

## 3. Replace the second block that builds `candidateResponses`:

**Find:**
```ts
    if (candidateIntake.responses && Array.isArray(candidateIntake.responses)) {
      openEndedQuestionIds.forEach(qId => {
        const response = candidateIntake.responses.find((r: any) => r.question_id === qId)
        if (response?.answer && response.answer.trim().length > 0) {
          candidateResponses[qId] = response.answer.trim()
        }
      })
    }
```

**Replace with:**
```ts
    if (candidateIntake.responses && Array.isArray(candidateIntake.responses)) {
      openEndedQuestionIds.forEach(qId => {
        const response = candidateIntake.responses.find((r: any) => r.question_id === qId)
        if (response?.answer) {
          const text = answerToText(response.answer)
          if (text.length > 0) candidateResponses[qId] = text
        }
      })
    }
```

---

If you maintain a forked matcher function, redeploy that function after code changes. The **`replenish-matches`** slug is **not** used in this repo anymore.
