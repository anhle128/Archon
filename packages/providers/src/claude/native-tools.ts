// Direct `zod` import (not `@hono/zod-openapi`): this builds the Zod shape the
// Claude SDK's `tool()` expects, never an OpenAPI schema, and `@archon/providers`
// is an SDK-deps-only leaf package that must not pull in Hono. See the documented
// exception in CLAUDE.md (Zod Schema Conventions).
import { z, type ZodTypeAny } from 'zod';
import {
  tool,
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
} from '@anthropic-ai/claude-agent-sdk';
import {
  AskHumanAwaitingError,
  AskHumanNoStarterError,
  type AskHumanControlError,
  type NativeTool,
  type NativeToolHandlerContext,
} from '../types';

/** The in-process MCP server name; tools are callable as `mcp__archon__<name>`. */
export const ARCHON_TOOL_SERVER = 'archon';

export interface ClaudeNativeToolRuntime {
  contextFor(toolName: string): NativeToolHandlerContext;
  onControlError(error: AskHumanControlError): void;
}

type ZodRawShape = Record<string, ZodTypeAny>;

const UNSUPPORTED_TYPE =
  "native tool schema: unsupported type for '%s' (only string / string-enum / boolean / array)";

function isString(v: unknown): v is string {
  return typeof v === 'string';
}

function isAskHumanControlError(error: unknown): error is AskHumanControlError {
  return error instanceof AskHumanAwaitingError || error instanceof AskHumanNoStarterError;
}

/**
 * Convert one JSON Schema property into a Zod type. Deliberately narrow — string,
 * string-enum, boolean, array-of-strings, and array-of-objects whose fields
 * recursively use that subset. Anything else throws (fail-fast).
 */
function jsonSchemaToZodType(prop: Record<string, unknown>, key: string): ZodTypeAny {
  if (Array.isArray(prop.enum)) {
    const values = prop.enum.filter(isString);
    if (values.length === 0) {
      throw new Error(`native tool schema: enum for '${key}' must be non-empty strings`);
    }
    return z.enum(values as [string, ...string[]]);
  }
  if (prop.type === 'string') return z.string();
  if (prop.type === 'boolean') return z.boolean();
  if (prop.type === 'array') {
    if (typeof prop.items !== 'object' || prop.items === null || Array.isArray(prop.items)) {
      throw new Error(UNSUPPORTED_TYPE.replace('%s', key));
    }
    const items = prop.items as Record<string, unknown>;
    let itemType: ZodTypeAny;
    if (items.type === 'string') {
      itemType = z.string();
    } else if (items.type === 'object') {
      itemType = z.object(jsonSchemaToZodShape(items));
    } else {
      throw new Error(UNSUPPORTED_TYPE.replace('%s', key));
    }
    const minItems = prop.minItems;
    return typeof minItems === 'number' ? z.array(itemType).min(minItems) : z.array(itemType);
  }
  throw new Error(UNSUPPORTED_TYPE.replace('%s', key));
}

/**
 * Convert a NativeTool's canonical JSON Schema into the Zod raw shape the Claude
 * SDK's `tool()` expects.
 */
function jsonSchemaToZodShape(schema: Record<string, unknown>): ZodRawShape {
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

  const shape: ZodRawShape = {};
  for (const [key, prop] of Object.entries(props)) {
    let field = jsonSchemaToZodType(prop, key);
    if (typeof prop.description === 'string') field = field.describe(prop.description);
    shape[key] = required.has(key) ? field : field.optional();
  }
  return shape;
}

/**
 * Build a single in-process SDK MCP server exposing the given NativeTools.
 * `alwaysLoad` keeps the tools visible without tool-search (which Haiku lacks).
 * Each tool's handler maps its text result into a CallToolResult.
 * Optional `runtime` supplies per-invocation handler context and reports branded
 * AskHuman control errors without converting them into tool output.
 */
export function buildArchonMcpServer(
  nativeTools: NativeTool[],
  runtime?: ClaudeNativeToolRuntime
): McpSdkServerConfigWithInstance {
  const tools = nativeTools.map(spec =>
    tool(
      spec.name,
      spec.description,
      jsonSchemaToZodShape(spec.inputSchema),
      async (args): Promise<{ content: { type: 'text'; text: string }[] }> => {
        try {
          const text = await spec.handler(
            args as Record<string, unknown>,
            runtime?.contextFor(spec.name)
          );
          return { content: [{ type: 'text', text }] };
        } catch (error) {
          if (isAskHumanControlError(error)) {
            runtime?.onControlError(error);
          }
          throw error;
        }
      }
    )
  );
  return createSdkMcpServer({
    name: ARCHON_TOOL_SERVER,
    version: '1.0.0',
    tools,
    alwaysLoad: true,
  });
}
