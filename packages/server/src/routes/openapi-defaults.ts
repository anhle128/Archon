/**
 * Shared OpenAPIHono configuration used by both the server and tests.
 */
import type { OpenAPIHono } from '@hono/zod-openapi';

type DefaultHook = NonNullable<ConstructorParameters<typeof OpenAPIHono>[0]>['defaultHook'];

/** Safe Zod detail: path (field names) + schema message only — never issue input/received values. */
export function formatSafeZodIssueDetail(error: {
  issues: readonly { path: readonly PropertyKey[]; message: string }[];
}): string {
  const issue = error.issues[0];
  if (!issue) return 'invalid request';
  const path = issue.path
    .map(String)
    .filter(segment => segment.length > 0)
    .join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

/** Default validation-error hook: formats Zod issues as { error: string } with 400 status. */
export const validationErrorHook: DefaultHook = (result, c): Response | undefined => {
  if (!result.success) {
    const message = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return c.json({ error: message }, 400);
  }
  return undefined;
};

/**
 * Workflow ENV route-scoped validation hook (US-023).
 *
 * OpenAPI body/query/param failures must not fall through to the global
 * field-path-as-`error` shape. Stable machine code + safe detail only —
 * never prompt/bash/unknown-field values.
 */
export const workflowEnvValidationErrorHook: DefaultHook = (result, c): Response | undefined => {
  if (!result.success) {
    return c.json(
      {
        error: 'invalid_env_request',
        detail: formatSafeZodIssueDetail(result.error),
      },
      400
    );
  }
  return undefined;
};
