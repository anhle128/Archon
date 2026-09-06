/**
 * Core alias for the engine pending-interaction row and insert schemas.
 *
 * Canonical shapes live in `@archon/workflows/schemas/pending-interaction`.
 * Types are derived with `z.infer`.
 */
export {
  pendingInteractionSchema,
  insertPendingInteractionSchema,
  type PendingInteraction,
  type InsertPendingInteractionInput,
} from '@archon/workflows/schemas/pending-interaction';
