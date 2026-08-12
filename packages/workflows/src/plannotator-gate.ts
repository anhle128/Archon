/**
 * Pure helpers for the plannotator_gate node.
 *
 * Path contract (producer / rework stdout): entire output is one document path —
 * first non-empty trimmed line. Decision contract (annotate --gate --json stdout):
 * last non-empty line is `{"decision":"approved"|"annotated"|"dismissed",...}`.
 * Spawn argv is fixed; binary resolution is env-only (PATH probe lives in the supervisor).
 */

export type PlannotatorGateDecision =
  | { kind: 'approved'; feedback: string }
  | { kind: 'annotated'; feedback: string }
  | { kind: 'dismissed' };

function isDecisionKind(value: unknown): value is 'approved' | 'annotated' | 'dismissed' {
  return value === 'approved' || value === 'annotated' || value === 'dismissed';
}

/**
 * Extract a document path from producer / rework node stdout.
 * Takes the first non-empty line after per-line trim; throws if none.
 */
export function parseDocumentPathFromNodeOutput(output: string): string {
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  throw new Error(
    'plannotator_gate document path is empty — expected a non-empty path string from the producer node output'
  );
}

/**
 * Parse Plannotator annotate `--gate --json` stdout into a typed decision.
 * Uses the last non-empty line so log noise before the decision line is ignored.
 * Requires a JSON object with `decision` ∈ approved|annotated|dismissed.
 */
export function parsePlannotatorGateDecisionJson(stdout: string): PlannotatorGateDecision {
  let lastNonEmpty: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) lastNonEmpty = trimmed;
  }
  if (lastNonEmpty === undefined) {
    throw new Error('plannotator gate decision stdout is empty — expected a JSON decision line');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(lastNonEmpty);
  } catch {
    throw new Error(
      `plannotator gate decision is not valid JSON (last non-empty line): ${lastNonEmpty}`
    );
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `plannotator gate decision must be a JSON object, got ${Array.isArray(parsed) ? 'array' : typeof parsed}`
    );
  }

  const record = parsed as Record<string, unknown>;
  const decision = record.decision;
  if (!isDecisionKind(decision)) {
    throw new Error(
      `plannotator gate decision field missing or unknown: ${JSON.stringify(decision)}`
    );
  }

  if (decision === 'dismissed') {
    return { kind: 'dismissed' };
  }

  const feedback = typeof record.feedback === 'string' ? record.feedback : '';
  return { kind: decision, feedback };
}

/**
 * Argv for `plannotator annotate` under a gate (no binary name — caller prefixes it).
 */
export function buildAnnotateArgv(documentPath: string): string[] {
  return ['annotate', documentPath, '--gate', '--json', '--persist-session'];
}

/**
 * Binary name/path for the annotate subprocess.
 * Override via PLANNOTATOR_BIN; PATH existence check is the supervisor's job.
 */
export function resolvePlannotatorBinary(): string {
  return process.env.PLANNOTATOR_BIN ?? 'plannotator';
}
