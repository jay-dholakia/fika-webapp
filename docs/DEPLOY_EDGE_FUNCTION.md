# Edge Functions (Fika)

The legacy **`replenish-matches`** function and its deploy payload were **removed** from this repo (old weekly pool pipeline).

**Current path:** admin **`/api/admin/match-sim`** (Trigger SMS) → **`sms-match-delivery`** with explicit `match_ids`.

Deploy the delivery function from the repo root:

```bash
supabase functions deploy sms-match-delivery
```

Historical scoring notes for the old replenisher live in **`docs/SCORING_AND_RECALIBRATION.md`** and git history.

## Stale Edge Functions (already cleaned on meetwithmoai)

Legacy slugs (`replenish-matches`, weekly-pool SMS, Bookmanager ingest, `archive-inactive-chats`, `ask-liv`, etc.) were **removed** from the linked project. If another environment’s Dashboard still shows a deleted function, remove it with:

```bash
supabase functions delete <function-slug> --project-ref <your-project-ref>
```

Migrations **`20260430210000_unschedule_removed_weekly_pool_edge_crons.sql`** and **`20260430220000_unschedule_bookmanager_archive_chats_ask_liv.sql`** unschedule matching `cron.job` rows after `db push`.
