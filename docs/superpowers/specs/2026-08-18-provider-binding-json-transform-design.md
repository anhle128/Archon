# Provider-Binding Outbound JSON Transformation Design

**Status:** Approved

**Date:** 2026-08-18

**Branch:** `feat/provider-binding-json-transform`

**Base:** `dev` at `57af0ec5e1a81007a6130fa3a8dd53adce8f841a`

## Summary

Archon will support an optional outbound JSON transformation on each workflow provider binding.
The first engine is JSONata.
Archon will keep `workflow-event-envelope.v1` as its canonical internal event envelope.
The transform will run once after Archon constructs the canonical envelope and before Archon persists the outbox row.
Archon will persist the exact serialized result in `event_body`.
HMAC signing and all retries will continue to use that stored string without reconstruction.

Each binding can also contain private receiver authentication headers.
Archon will send these headers with its existing HMAC headers.
Archon will not expose the private header values through public binding reads, command output, logs, errors, or delivery-attempt evidence.

This design is provider-neutral.
It does not add receiver-specific fields, schemas, names, or routing rules.

## Problem

External HTTP receivers do not always accept the canonical Archon event shape.
A binding needs a controlled way to map the canonical envelope to the JSON shape that its receiver accepts.
The mapping must not change Archon's internal event contract.
The mapping must also preserve deterministic delivery evidence, HMAC correctness, and byte-identical retries.

Some receivers also require a private authentication header in addition to Archon's HMAC headers.
Archon needs a safe per-binding configuration for these headers without exposing the secret values.

## Goals

- Keep `workflow-event-envelope.v1` unchanged.
- Add an optional JSONata transform to each provider binding.
- Preserve current behavior when a binding has no transform.
- Validate a transform before a binding create or update writes to the database.
- Apply the transform once at enqueue time.
- Persist the exact transformed JSON string in `event_body`.
- Keep transform failure independent from workflow-run success or failure.
- Store a durable and inspectable `transform-failed` outbox outcome.
- Add a side-effect-free CLI test command that uses file inputs.
- Add private per-binding receiver headers.
- Keep receiver header values out of all public and diagnostic surfaces.
- Preserve binding create, update, status, rotate, and disable behavior.
- Preserve event-type filtering.
- Preserve SQLite and PostgreSQL schema parity.

## Non-Goals

- No web UI.
- No receiver-specific integration logic.
- No new router service.
- No generic transform plugin framework.
- No second transform engine in V1.
- No XML, form encoding, or arbitrary content types.
- No transform at delivery time.
- No change to workflow event filtering.
- No change to Archon's HMAC format.
- No secret value on command-line arguments.

## Constitution Check

The design keeps the feature in `@archon/core`, where provider-binding persistence and workflow-event enqueue behavior already exist.
The server dispatcher continues to use the private core binding read.
The change does not add an import from the workflow package to core or server code.
The change uses strict TypeScript types and Zod-derived types.
The database change is additive in both dialects.
The design uses explicit classified errors and safe structured logs.
The design does not change workflow lifecycle state across process boundaries.
The design does not change the workflow YAML language.

The post-design check has the same result.
No constitutional exception is necessary.

## Approved Architecture

The binding will use two additive columns.

- `transform` stores the non-secret transform configuration as JSON text.
- `delivery_headers` stores the private receiver header map as JSON text.

The split keeps public transformation settings separate from private authentication values.
It also follows the existing split between the public binding schema and the private binding row that contains `signing_secret`.

The implementation will add one focused transform module in `@archon/core`.
This module will own config normalization, JSONata compilation, AST policy validation, evaluation, JSON-result validation, serialization, and safe error classification.
It will not provide an engine registry or a plugin interface.
A discriminated config and one exhaustive engine branch are sufficient for V1.

## Binding Configuration

The public binding schema will add the optional normalized `transform` value.
The public schema will not contain `delivery_headers` or `signing_secret`.

The stored V1 transform shape is:

```typescript
const jsonataProviderBindingTransformSchema = z.object({
  engine: z.literal('jsonata'),
  expression: z.string().min(1),
  timeoutMs: z.number().int().positive().max(200).default(50),
  stackDepth: z.number().int().positive().max(512).default(128),
  maxSequenceSize: z.number().int().positive().max(100_000).default(10_000),
  maxOutputBytes: z.number().int().positive().max(262_144).default(65_536),
});

const providerBindingTransformSchema = z.discriminatedUnion('engine', [
  jsonataProviderBindingTransformSchema,
]);
```

Normalization will apply a separate UTF-8 byte check to `expression` because Zod string length counts JavaScript code units.
The database stores the normalized object, including all resolved defaults.
This makes the behavior stable if defaults change in a later Archon version.
The discriminated shape permits a future engine without a receiver-specific field or a generic plugin framework.

The private receiver header shape is a string record.

```typescript
type DeliveryHeaders = Record<string, string>;
```

The private binding parser will parse `delivery_headers` and `signing_secret`.
The public binding parser will strip both private fields.

## Limits

| Resource | Default | Hard cap |
|---|---:|---:|
| JSONata expression length | Not applicable | 32,768 UTF-8 bytes |
| Evaluation time | 50 ms | 200 ms |
| Evaluation stack depth | 128 | 512 |
| JSONata sequence size | 10,000 | 100,000 |
| Serialized output size | 65,536 bytes | 262,144 bytes |
| Receiver header count | Not applicable | 16 |
| Receiver header name | Not applicable | 128 UTF-8 bytes |
| Receiver header value | Not applicable | 8,192 UTF-8 bytes |
| All receiver header values | Not applicable | 32,768 UTF-8 bytes |

Byte limits use `TextEncoder` and therefore measure UTF-8 bytes.
The timeout, stack, and sequence settings map directly to JSONata evaluator options.
The JSONata timeout is cooperative and checks between evaluator operations.
The AST policy rejects regular expressions, dynamic evaluation, and large-string padding to remove important operations that could stay inside one evaluator call for too long.

## JSONata Dependency

Archon will use `jsonata` version `2.2.2`.
It is the current stable package version at the design date.
It has built-in TypeScript declarations and no runtime dependencies.
The package will be added to `@archon/core` through Bun so that the root lockfile records the exact resolution.

Official references:

- [JSONata package](https://www.npmjs.com/package/jsonata)
- [JSONata JavaScript API](https://docs.jsonata.org/embedding-extending)
- [JSONata 2.2.2 release](https://github.com/jsonata-js/jsonata/releases/tag/v2.2.2)

## Compile-Time Transform Policy

Binding create and update will normalize the config, compile the expression, and inspect the compiled AST before the database write.
The same compile-and-inspect function will be used by the CLI test command and by enqueue-time evaluation.
Enqueue-time validation protects against corrupt or manually edited database data.

The AST visitor will inspect objects as `Record<string, unknown>` values.
It will not depend on the incomplete `any` fields in JSONata's public `ExprNode` declaration.
It will recursively visit each object and array property of the AST.

The visitor will permit only direct calls whose procedure is a variable with one of these names:

```text
string
length
substring
substringBefore
substringAfter
uppercase
lowercase
trim
contains
split
join
number
floor
ceil
round
abs
sqrt
power
boolean
not
count
sum
min
max
average
keys
lookup
append
exists
merge
reverse
distinct
```

The visitor will reject all other direct calls.
It will also reject dynamic calls, aliased calls, partial application, function application, lambdas, JSONata transform expressions, and regular-expression nodes.
This policy rejects `$eval`, `$now`, `$millis`, `$random`, and other functions that are not on the allowlist.
The policy uses the AST and does not search source substrings.

Normal path selection, object and array construction, conditions, comparisons, arithmetic, concatenation, and non-function variable bindings remain available.
These features are sufficient for the approved mapping use case without a broad executable surface.

## Transform Result Rules

The top-level result must be an object or an array.
Scalar top-level JSON values are rejected because they are usually callback configuration errors.

The result validator will recursively reject:

- `undefined` values.
- Functions.
- Symbols.
- Bigints.
- `NaN`, positive infinity, and negative infinity.
- Sparse array elements.
- Cyclic references.
- Object instances whose prototype is not `Object.prototype` or `null`.

The validator accepts JSONata-created plain objects with a normal or null prototype.
After validation, the module calls `JSON.stringify` exactly once to create the outbound body.
It then measures the UTF-8 output size and rejects a body above `maxOutputBytes`.

The primary interfaces are:

```typescript
export function normalizeProviderBindingTransform(
  value: unknown
): ProviderBindingTransform;

export function validateProviderBindingTransform(
  transform: ProviderBindingTransform
): void;

export async function transformWorkflowEventBody(
  envelope: WorkflowEventEnvelope,
  transform: ProviderBindingTransform | null
): Promise<TransformBodyResult>;

export interface TransformBodyResult {
  body: string;
  outputBytes: number;
  engine: 'identity' | 'jsonata';
  durationMs: number;
}
```

When `transform` is `null`, `transformWorkflowEventBody` returns `JSON.stringify(envelope)`.
This identity path preserves the current byte output.

## Enqueue Data Flow

The routable event path will be:

```text
internal workflow event
  -> current external event-type validation
  -> current binding and event-type filter
  -> current approval payload enrichment
  -> buildWorkflowEventEnvelope
  -> transformWorkflowEventBody exactly once
  -> persist returned body as event_body
  -> dispatcher reads stored event_body
  -> HMAC signs stored event_body
  -> HTTP sends stored event_body
  -> retries reuse stored event_body
```

The canonical envelope object is the only transform input.
No additional binding data, environment variable, clock, network function, or delivery-attempt state is available to the expression.
The transform does not change the canonical envelope object or its schema.

The current event-type filter runs before envelope construction and remains unchanged.
Filtered events continue to produce no outbox row.

## Transform Failure

A transform failure must not fail the workflow run.
The enqueue path will catch classified transform errors separately from its general best-effort enqueue guard.

It will persist an outbox row with:

```text
status = "not-routable"
not_routable_reason = "transform-failed"
last_error = <safe transform error code>
event_body = JSON.stringify(canonicalEnvelope)
next_attempt_at = null
```

The canonical envelope in `event_body` is durable evidence only.
The dispatcher does not claim `not-routable` rows, so it cannot send this body.
No partial or failed transformed value is persisted.

Stable transform error codes are:

```text
TRANSFORM_CONFIG_INVALID
TRANSFORM_COMPILE_FAILED
TRANSFORM_FUNCTION_DISALLOWED
TRANSFORM_AST_DISALLOWED
TRANSFORM_TIMEOUT
TRANSFORM_STACK_LIMIT
TRANSFORM_SEQUENCE_LIMIT
TRANSFORM_RESULT_INVALID
TRANSFORM_OUTPUT_TOO_LARGE
TRANSFORM_EVALUATION_FAILED
```

Error messages must not include the expression, input envelope, transformed body, or JSONata token text.

The structured transform log can contain only:

```text
bindingId
eventType
engine
durationMs
outputBytes
errorCode
```

`outputBytes` is omitted when serialization did not complete.
The log must not attach the raw thrown error.

## Receiver Header Validation

Header validation runs on binding create and update before the database write.
The dispatcher runs the same validation again before delivery to detect corrupt database content.

Header names must match the HTTP token grammar:

```text
^[!#$%&'*+.^_`|~0-9A-Za-z-]+$
```

Header names and values must not contain carriage return or line feed characters.
Header names are compared without case.

The following names are reserved and rejected:

```text
Content-Type
X-Webhook-Signature-V2
X-Webhook-Timestamp
X-Request-ID
Host
Content-Length
Connection
Keep-Alive
Proxy-Authenticate
Proxy-Authorization
Proxy-Connection
TE
Trailer
Transfer-Encoding
Upgrade
```

Archon will continue to create its HMAC and request headers first.
It will merge validated receiver headers only after the Archon-owned header map exists.
Because reserved-name validation is case-insensitive, a receiver header cannot replace an Archon-owned value.

If send-time validation fails, the dispatcher will not send HTTP.
It will set the outbox row to `terminal-failure` with `last_error = "unsafe-delivery-headers"`.
The log will identify the binding and outbox event but will not contain a header name or value.

## Header Privacy and Attempt Evidence

The private binding schema can contain `delivery_headers` and `signing_secret`.
The public binding schema, status result, and list output cannot contain either private value.

The dispatcher needs the actual receiver header values only in memory while it builds the HTTP request.
It will pass a separate evidence map to `insertPendingAttempt`.

The evidence map will contain:

- The current Archon-owned header names and values.
- Each receiver header name with the value `[REDACTED]`.

The persisted `request_headers` field will never contain a receiver secret value.
The receiver secret values will not be included in response envelopes, logs, errors, or artifacts.

## Binding Lifecycle Semantics

Create accepts an optional transform file and an optional receiver-header file.
An omitted file creates no configuration for that concern.
A file that contains JSON `null` also creates no configuration.

Update uses patch semantics for these two concerns.
An omitted file preserves the stored value.
A transform file that contains JSON `null` clears `transform` to SQL `NULL`.
A receiver-header file that contains JSON `null` clears `delivery_headers` to `{}`.

Update performs validation before it starts the guarded database update.
An invalid config does not change the binding.
The update input keeps `undefined` distinct from `null`:

```typescript
interface UpdateBindingInput {
  transform?: ProviderBindingTransform | null;
  deliveryHeaders?: Record<string, string> | null;
}
```

The SQL update will use explicit supplied flags instead of `COALESCE`.
This permits `undefined` to preserve a column and `null` to clear it.
The logical assignments are:

```sql
transform = CASE WHEN transform_supplied = 1 THEN transform_value ELSE transform END,
delivery_headers = CASE
  WHEN delivery_headers_supplied = 1 THEN delivery_headers_value
  ELSE delivery_headers
END
```

Rotate changes only `binding_version`, `signing_secret`, `state`, and `updated_at`.
It preserves `transform` and `delivery_headers` without reading and rewriting them.

Disable changes only `state` and `updated_at`.
It preserves `transform` and `delivery_headers`.

Status remains compatible with its current result shape.
It does not expose receiver header names or values.

## CLI Design

Create and update gain these file options:

```text
--transform-file <path>
--receiver-headers-file <path>
```

The files contain JSON.
The transform file contains the discriminated transform object or `null`.
The receiver-header file contains a JSON object of string values or `null`.

Receiver secret values never appear in process arguments.
The documentation will tell operators to use a restricted local file, such as mode `0600` on POSIX systems, and to remove the file after the command succeeds.
The CLI will not echo the input path or contents in a success or error envelope.

The side-effect-free command is:

```text
archon provider-binding test \
  --transform-file <path> \
  --envelope-file <path> \
  --json
```

The command requires a non-null transform object and a sample canonical `workflow-event-envelope.v1` object.
It reads files, validates the canonical envelope, compiles and evaluates the transform, and prints one command envelope.
It does not initialize the database, enqueue an event, or send HTTP.

The command uses the additive command identifier `binding.test` in `workflow-command-envelope.v1`.
Its `bindingRef` comes from the sample canonical envelope.
Its result shape is:

```json
{
  "operation": "test",
  "engine": "jsonata",
  "transformedBody": "{\"example\":true}",
  "outputBytes": 16
}
```

`transformedBody` is the exact serialized string that enqueue-time execution would persist.
`outputBytes` is its UTF-8 byte length.
Failures use the existing error-envelope style and a stable transform error code.

The command contract and CLI reference will add `binding.test` and its syntax.
Existing command identifiers and envelopes remain unchanged.

## Canonical Envelope Validation for Dry Run

The canonical envelope module will expose a Zod schema for `workflow-event-envelope.v1`.
The derived TypeScript type will replace the parallel hand-written envelope interface without changing the runtime shape.
The schema will select the correct payload schema from `eventType` so the dry run cannot accept an unrelated JSON document.

The existing builder will continue to return the same keys in the same insertion order.
Tests will compare the identity serialized body with the current literal output.

## Database Changes

The PostgreSQL source schema will add these columns to the binding table definition:

```sql
transform        TEXT,
delivery_headers TEXT NOT NULL DEFAULT '{}',
```

The PostgreSQL upgrade section will use:

```sql
ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS transform TEXT;

ALTER TABLE remote_agent_workflow_provider_bindings
  ADD COLUMN IF NOT EXISTS delivery_headers TEXT NOT NULL DEFAULT '{}';
```

The SQLite fresh schema will add the same logical columns and defaults.
The SQLite `migrateColumns()` path will inspect the existing binding table and add each missing column.
The `delivery_headers` SQLite `ADD COLUMN` statement will include `NOT NULL DEFAULT '{}'`.

No data backfill is necessary.
Existing rows read `transform` as null and `delivery_headers` as an empty object.

The generated bundled schema will be changed only with:

```bash
bun run generate:bundled-schema
```

Dialect parity tests will verify both columns, nullability behavior, and defaults.

## Delivery and Retry Behavior

The dispatcher will continue to sign:

```text
timestamp + "." + row.event_body
```

The dispatcher will continue to send `row.event_body` as the request body.
It will not parse, rebuild, or reserialize that body.
Each retry can have a new timestamp and HMAC signature.
Each retry must send the same body bytes.

Receiver headers do not affect the HMAC input.
They are merged only into the HTTP header map.

## Test Strategy

Implementation will follow strict red-green-refactor cycles.
Each production behavior will have a test that failed for the expected missing behavior before production code is added.

### Schema and Transform Tests

- Parse a valid normalized JSONata config.
- Apply every default.
- Reject each value above its hard cap.
- Reject an empty or oversized expression.
- Accept object construction and canonical envelope field selection.
- Reject `$eval`, `$now`, `$millis`, and `$random` by AST node.
- Reject an aliased disallowed function call.
- Reject an unknown direct function call.
- Reject partial application, function application, lambdas, transform expressions, and regex nodes.
- Enforce timeout, stack, and sequence limits with deterministic fixtures.
- Reject undefined, functions, symbols, bigints, non-finite numbers, sparse arrays, cycles, and non-plain objects.
- Reject a scalar top-level result.
- Reject output above the configured limit by UTF-8 bytes.
- Return exact serialized JSON and its byte length.
- Return current `JSON.stringify(envelope)` bytes for identity behavior.

### Binding Database Tests

- Create stores normalized transform JSON and private receiver header JSON.
- Public create, update, get, status, and list values do not expose receiver header values.
- Private reads return receiver headers for delivery.
- Update omission preserves both configurations.
- Update with JSON `null` clears the selected configuration.
- An invalid transform or header fails before a database mutation.
- Rotate preserves both configurations.
- Disable preserves both configurations.
- Corrupt JSON produces a classified binding corruption error without raw values.

### Schema Migration Tests

- Fresh SQLite has both new columns.
- Existing SQLite adds both new columns.
- Existing SQLite rows receive `{}` for `delivery_headers`.
- PostgreSQL SQL contains both additive statements.
- SQLite and PostgreSQL column parity remains valid.
- The bundled schema check passes after generator use.

### Enqueue and Outbox Tests

- The canonical envelope remains unchanged.
- No transform persists the exact current body.
- A transform receives the canonical envelope object.
- A transform is evaluated once.
- The transformed string is persisted as `event_body`.
- Event-type filtering still happens before transformation.
- A transform error produces a durable `not-routable` row with reason `transform-failed`.
- A transform error stores only a safe error code.
- A transform error does not reject workflow execution.
- Safe logs contain only the approved metadata.

### Dispatcher Tests

- HMAC uses the stored transformed body.
- Initial delivery and retries send the exact stored body.
- Valid receiver headers reach the HTTP request.
- Receiver headers cannot replace Archon-owned headers.
- Reserved names are rejected without case sensitivity.
- Invalid names and CR or LF values are rejected.
- Corrupt stored headers prevent HTTP delivery.
- Delivery-attempt evidence keeps receiver header names and redacts their values.
- Public logs and errors contain no header value.

### CLI Tests

- Create and update parse both file flags before database mutation.
- Omitted update flags preserve configuration.
- JSON `null` files clear configuration.
- File read and JSON parse errors produce one classified command envelope.
- Receiver secret values do not appear in command output or errors.
- `provider-binding test` accepts valid file inputs outside a Git repository.
- The test command returns the exact transformed string and byte length.
- The test command does not call binding persistence, outbox persistence, or HTTP delivery.
- The test command uses the additive `binding.test` command contract.
- Existing binding command syntax and envelopes remain valid.

## Documentation Changes

The CLI reference will document the two new create and update file options.
It will document the side-effect-free test command.
It will include a generic JSONata example that uses canonical envelope fields only.
It will document defaults, hard caps, allowed functions, rejected constructs, update clear semantics, and transform failure evidence.
It will document private receiver headers and the reserved-name list.
It will explain the restricted temporary-file pattern for secrets.
It will state that Archon's HMAC headers remain active.

No documentation will prescribe a receiver-specific body schema.

## Rollback

The runtime rollback is to stop writing and reading the two new columns.
Existing bindings then use the current identity body and HMAC delivery path.
The additive columns can remain in both databases because Archon's schema policy forbids destructive rollback.
No data migration or table rebuild is necessary.

The dependency rollback removes JSONata from `@archon/core` and the Bun lockfile after the transform call sites are removed.
Outbox rows already contain their final body strings and remain deliverable without the transform engine.

## Rejected Alternatives

### Transform at Delivery Time

This could produce different results on retry.
It would also make HMAC evidence depend on repeated evaluation.
It does not meet the exact stored-body requirement.

### Receiver-Specific Binding Fields

This would couple Archon to one receiver contract.
It would create schema and routing work for each new receiver.
The transform expression already owns the receiver shape.

### Combined Delivery Configuration Column

One column would mix public transform settings with private authentication values.
It would make privacy projections and future schema changes less clear.

### Generic Transform Plugin Framework

V1 has one engine and one caller.
A registry, plugin interface, or factory would have no second implementation.
The discriminated config and exhaustive branch provide the necessary future seam.

### Source-Substring Function Checks

Substring checks can be bypassed by aliases, comments, or dynamic construction.
The compiled AST is the correct validation boundary.

### Command-Line Secret Values

Process arguments can appear in shell history and process inspection.
The receiver-header config therefore uses file input only.

## Approved Decisions

- Use two binding columns, not one combined delivery config.
- Use JSONata as the only V1 engine.
- Accept only object or array transform results.
- Preserve omitted update configuration.
- Use a JSON `null` file to clear transform or receiver headers.
- Transform once before outbox persistence.
- Persist transform failures as non-routable evidence.
- Keep receiver header values private and redact attempt evidence.
- Use file-based CLI inputs for expressions, sample envelopes, and receiver secrets.

## Open Questions

There are no open design questions.
