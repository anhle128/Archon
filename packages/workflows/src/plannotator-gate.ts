/**
 * Pure helpers for the plannotator_gate node.
 *
 * Path contract (producer / rework stdout): entire output is one document path —
 * exactly one non-empty trimmed line. Decision contract (annotate --result-file payload):
 * one JSON object with `decision` ∈ approved|annotated|dismissed.
 * Spawn argv is fixed; binary resolution is env-only (capability probing lives in the executor).
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
 * Requires exactly one non-empty line after per-line trim.
 */
export function parseDocumentPathFromNodeOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0);
  if (lines.length !== 1) {
    throw new Error(
      `plannotator_gate document path must be exactly one non-empty line, got ${lines.length}`
    );
  }
  return lines[0];
}

/**
 * Parse a Plannotator annotate result-file payload into a typed decision.
 * Allows surrounding whitespace but rejects any content outside the JSON object.
 * Requires a JSON object with `decision` ∈ approved|annotated|dismissed.
 */
export function parsePlannotatorGateDecisionJson(payload: string): PlannotatorGateDecision {
  const json = payload.trim();
  if (json.length === 0) {
    throw new Error('plannotator gate result file is empty — expected a JSON decision line');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error(`plannotator gate decision is not valid JSON: ${json}`);
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
export function buildAnnotateArgv(documentPath: string, resultFilePath: string): string[] {
  return [
    'annotate',
    documentPath,
    '--gate',
    '--json',
    '--persist-session',
    '--result-file',
    resultFilePath,
  ];
}

/**
 * Binary name/path for the annotate subprocess.
 * Override via PLANNOTATOR_BIN; PATH existence check is the supervisor's job.
 */
export function resolvePlannotatorBinary(): string {
  return process.env.PLANNOTATOR_BIN ?? 'plannotator';
}
