/**
 * @deprecated Intake embeddings are disabled in the app (`lib/intake-embed-server.ts`).
 * This script no longer writes `embed_vector`. Use DB tooling if you need to backfill
 * vectors for external systems.
 */
console.error(
  'backfill-intake-embeddings: deprecated — intake embeddings are disabled. Exiting without changes.'
)
process.exit(0)
