# Migrations

Use **14-digit timestamp** prefix so each file has a unique version: `YYYYMMDDHHmmss_description.sql`.

Example: `20260308120000_add_feature.sql`

The CLI uses the leading numeric part as the version key in `schema_migrations`. Multiple files with the same 8-digit date (e.g. `20260226_*.sql`) cause duplicate key errors on push.

Create new migrations with:
```bash
supabase migration new your_migration_name
```
This generates a file with a unique 14-digit timestamp.
