import { Type, type TObject, type TSchema } from '@sinclair/typebox';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import {
  AskHumanAwaitingError,
  AskHumanNoStarterError,
  AskHumanPauseFailedError,
  type AskHumanControlError,
  type NativeTool,
} from '../../types';

type PiDefineTool = typeof import('@earendil-works/pi-coding-agent').defineTool;

export interface PiNativeToolRuntime {
  sessionId(): string | undefined;
  onControlError(error: AskHumanControlError): void;
}

const UNSUPPORTED_TYPE =
  "native tool schema: unsupported type for '%s' (only string / string-enum / boolean / array)";

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isAskHumanControlError(error: unknown): error is AskHumanControlError {
  return (
    error instanceof AskHumanAwaitingError ||
    error instanceof AskHumanNoStarterError ||
    error instanceof AskHumanPauseFailedError
  );
}

/**
 * Convert one JSON Schema property into a TypeBox schema. Same narrow subset as
 * the Claude converter: string, string-enum, boolean, array-of-strings, and
 * array-of-objects whose fields recursively use that subset.
 */
function jsonSchemaToTypeBoxType(prop: Record<string, unknown>, key: string): TSchema {
  if (Array.isArray(prop.enum)) {
    const values = prop.enum.filter(isString);
    if (values.length === 0) {
      throw new Error(`native tool schema: enum for '${key}' must be non-empty strings`);
    }
    return Type.Union(values.map(v => Type.Literal(v)));
  }
  if (prop.type === 'string') return Type.String();
  if (prop.type === 'boolean') return Type.Boolean();
  if (prop.type === 'array') {
    if (typeof prop.items !== 'object' || prop.items === null || Array.isArray(prop.items)) {
      throw new Error(UNSUPPORTED_TYPE.replace('%s', key));
    }
    const items = prop.items as Record<string, unknown>;
    let itemType: TSchema;
    if (items.type === 'string') {
      itemType = Type.String();
    } else if (items.type === 'object') {
      itemType = jsonSchemaToTypeBox(items);
    } else {
      throw new Error(UNSUPPORTED_TYPE.replace('%s', key));
    }
    const minItems = prop.minItems;
    return typeof minItems === 'number' ? Type.Array(itemType, { minItems }) : Type.Array(itemType);
  }
  throw new Error(UNSUPPORTED_TYPE.replace('%s', key));
}

/**
 * Convert a NativeTool's canonical JSON Schema into the TypeBox schema Pi's
 * `defineTool` expects.
 */
function jsonSchemaToTypeBox(schema: Record<string, unknown>): TObject {
  if (
    schema.type !== 'object' ||
    typeof schema.properties !== 'object' ||
    schema.properties === null
  ) {
    throw new Error('native tool inputSchema must be an object schema with `properties`');
  }
  const props = schema.properties as Record<string, Record<string, unknown>>;
  const required = new Set(
    Array.isArray(schema.required) ? (schema.required as unknown[]).filter(isString) : []
  );

  const shape: Record<string, TSchema> = {};
  for (const [key, prop] of Object.entries(props)) {
    let field = jsonSchemaToTypeBoxType(prop, key);
    if (typeof prop.description === 'string') {
      field = Type.Unsafe<unknown>({ ...field, description: prop.description });
    }
    shape[key] = required.has(key) ? field : Type.Optional(field);
  }
  return Type.Object(shape);
}

/**
 * Adapt NativeTools to Pi `ToolDefinition`s for the `customTools` array. The
 * handler's text result becomes the tool's content; `details` is unused.
 * Optional `runtime` supplies the live session id and reports branded AskHuman
 * control errors. `_toolCallId` is always forwarded as `toolUseId`.
 */
export function buildPiNativeToolDefinitions(
  nativeTools: NativeTool[],
  defineTool: PiDefineTool,
  runtime?: PiNativeToolRuntime
): ToolDefinition[] {
  return nativeTools.map(spec =>
    defineTool({
      // Pi shows `label` in its UI; derive it per-tool from the name so a future
      // second native tool doesn't inherit a hardcoded "Manage runs".
      name: spec.name,
      label: spec.name,
      description: spec.description,
      parameters: jsonSchemaToTypeBox(spec.inputSchema),
      execute: async (
        toolCallId,
        params
      ): Promise<{ content: { type: 'text'; text: string }[]; details: undefined }> => {
        try {
          const text = await spec.handler(params as Record<string, unknown>, {
            toolUseId: toolCallId,
            sessionId: runtime?.sessionId(),
          });
          return { content: [{ type: 'text', text }], details: undefined };
        } catch (error) {
          if (isAskHumanControlError(error)) {
            runtime?.onControlError(error);
          }
          throw error;
        }
      },
    })
  );
}
