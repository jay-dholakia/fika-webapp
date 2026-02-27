# Deploy replenish-matches Edge Function

The function source lives in **`supabase/functions/replenish-matches/index.ts`**.

## Deploy with Supabase CLI

From the repo root, with Supabase CLI installed and linked to your project:

```bash
supabase functions deploy replenish-matches
```

If the function requires secrets (e.g. `OPENAI_API_KEY`), set them in the Supabase dashboard (Project → Edge Functions → replenish-matches → Secrets) or via:

```bash
supabase secrets set OPENAI_API_KEY=your_key
```

## What was last updated

- **Score weights:** q5 32%, q10 14%, q2 10%, q4 7%, q6 6%, distance 6%, q3_work_or_study 5%, q3_profession/university/major 4%, q15 4%, q13 2%, q14 2%. Embed 8% max. (q1_conversation_types removed.)
- **Filters:** Filter 7 (q15: don't match "avoid" with "actively enjoy"). Filter 8 (q13: don't match "Moving in the right direction" with "In need of major change").
- **Reasons fallback:** Uses q10 and q2 (and q5) only; q1 removed. q13, q14, q15 are not included in reasons (private).

See **`docs/SCORING_AND_RECALIBRATION.md`** for the full spec.
