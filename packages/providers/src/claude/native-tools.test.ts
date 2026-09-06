import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { z, type ZodTypeAny } from 'zod';
import {
  AskHumanAwaitingError,
  AskHumanNoStarterError,
  type NativeTool,
  type NativeToolHandlerContext,
} from '../types';

type CapturedTool = {
  name: string;
  description: string;
  inputSchema: Record<string, ZodTypeAny>;
  handler: (
    args: Record<string, unknown>,
    extra?: unknown
  ) => Promise<{ content: { type: 'text'; text: string }[] }>;
};

const capturedTools: CapturedTool[] = [];

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (
    name: string,
    description: string,
    inputSchema: Record<string, ZodTypeAny>,
    handler: CapturedTool['handler']
  ): CapturedTool => {
    const def: CapturedTool = { name, description, inputSchema, handler };
    capturedTools.push(def);
    return def;
  },
  createSdkMcpServer: (config: {
    name: string;
    version: string;
    tools: unknown[];
    alwaysLoad?: boolean;
  }) => config,
}));

const { buildArchonMcpServer, ARCHON_TOOL_SERVER } = await import('./native-tools');

function spec(inputSchema: Record<string, unknown>, handler?: NativeTool['handler']): NativeTool {
  return {
    name: 'manage_run',
    description: 'test tool',
    inputSchema,
    handler: handler ?? ((): Promise<string> => Promise.resolve('ok')),
  };
}

const VALID_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['list', 'get'], description: 'the action' },
    runId: { type: 'string' },
    confirm: { type: 'boolean', description: 'guard' },
  },
  required: ['action'],
};

const ASK_HUMAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      description: 'Ordered structured questions for the run starter.',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          prompt: { type: 'string' },
          selection: { type: 'string', enum: ['single', 'multi'] },
          options: { type: 'array', items: { type: 'string' } },
          allowOther: { type: 'boolean' },
        },
        required: ['id', 'prompt', 'selection', 'options', 'allowOther'],
      },
    },
  },
  required: ['questions'],
};

const VALID_QUESTIONS = {
  questions: [
    {
      id: 'q1',
      prompt: 'Which option?',
      selection: 'single' as const,
      options: ['a', 'b'],
      allowOther: false,
    },
  ],
};

function capturedSchema(): z.ZodObject<Record<string, ZodTypeAny>> {
  const tool = capturedTools[0];
  if (!tool) throw new Error('expected captured tool');
  return z.object(tool.inputSchema);
}

describe('buildArchonMcpServer (Claude JSON-Schema → Zod)', () => {
  beforeEach(() => {
    capturedTools.length = 0;
  });

  test('builds for a valid schema with string / string-enum / boolean fields', () => {
    const server = buildArchonMcpServer([spec(VALID_SCHEMA)]);
    expect(server).toBeDefined();
    expect(ARCHON_TOOL_SERVER).toBe('archon');
  });

  test('rejects a non-object schema (fail-fast)', () => {
    expect(() => buildArchonMcpServer([spec({ type: 'string' })])).toThrow(
      /must be an object schema/
    );
  });

  test('rejects an unsupported field type (number)', () => {
    expect(() =>
      buildArchonMcpServer([
        spec({ type: 'object', properties: { n: { type: 'number' } }, required: [] }),
      ])
    ).toThrow(/unsupported type/);
  });

  test('rejects a number field nested inside a question object', () => {
    expect(() =>
      buildArchonMcpServer([
        spec({
          type: 'object',
          properties: {
            questions: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: { n: { type: 'number' } },
                required: ['n'],
              },
            },
          },
          required: ['questions'],
        }),
      ])
    ).toThrow(/unsupported type/);
  });

  test('rejects an empty enum', () => {
    expect(() =>
      buildArchonMcpServer([
        spec({ type: 'object', properties: { a: { enum: [] } }, required: ['a'] }),
      ])
    ).toThrow(/non-empty strings/);
  });

  test('accepts ASK_HUMAN_INPUT_SCHEMA and validates nested questions[]', () => {
    buildArchonMcpServer([spec(ASK_HUMAN_INPUT_SCHEMA)]);
    const schema = capturedSchema();
    expect(schema.safeParse(VALID_QUESTIONS).success).toBe(true);
    expect(schema.safeParse({ questions: [] }).success).toBe(false);
    expect(
      schema.safeParse({
        questions: [
          {
            id: 'q1',
            prompt: 'Which option?',
            selection: 'single',
            options: ['a'],
          },
        ],
      }).success
    ).toBe(false);
  });

  test('passes runtime context { toolUseId, sessionId } into the NativeTool handler', async () => {
    const seen: Array<NativeToolHandlerContext | undefined> = [];
    const runtime = {
      contextFor: (): NativeToolHandlerContext => ({
        toolUseId: 'tu_1',
        sessionId: 'sess_1',
      }),
      onControlError: mock(),
    };
    buildArchonMcpServer(
      [
        spec(ASK_HUMAN_INPUT_SCHEMA, async (_input, context): Promise<string> => {
          seen.push(context);
          return 'ok';
        }),
      ],
      runtime
    );
    const tool = capturedTools[0];
    if (!tool) throw new Error('expected captured tool');
    await tool.handler(VALID_QUESTIONS);
    expect(seen).toEqual([{ toolUseId: 'tu_1', sessionId: 'sess_1' }]);
    expect(runtime.onControlError).not.toHaveBeenCalled();
  });

  test('reports AskHumanAwaitingError to onControlError and rejects with the same instance', async () => {
    const awaiting = new AskHumanAwaitingError('tu_1', 'review', 'run-1');
    const onControlError = mock();
    buildArchonMcpServer(
      [
        spec(ASK_HUMAN_INPUT_SCHEMA, (): Promise<string> => {
          throw awaiting;
        }),
      ],
      {
        contextFor: (): NativeToolHandlerContext => ({
          toolUseId: 'tu_1',
          sessionId: 'sess_1',
        }),
        onControlError,
      }
    );
    const tool = capturedTools[0];
    if (!tool) throw new Error('expected captured tool');
    await expect(tool.handler(VALID_QUESTIONS)).rejects.toBe(awaiting);
    expect(onControlError).toHaveBeenCalledTimes(1);
    expect(onControlError.mock.calls[0]?.[0]).toBe(awaiting);
  });

  test('reports AskHumanNoStarterError to onControlError and rejects with the same instance', async () => {
    const noStarter = new AskHumanNoStarterError('run-1');
    const onControlError = mock();
    buildArchonMcpServer(
      [
        spec(ASK_HUMAN_INPUT_SCHEMA, (): Promise<string> => {
          throw noStarter;
        }),
      ],
      {
        contextFor: (): NativeToolHandlerContext => ({
          toolUseId: 'tu_1',
          sessionId: 'sess_1',
        }),
        onControlError,
      }
    );
    const tool = capturedTools[0];
    if (!tool) throw new Error('expected captured tool');
    await expect(tool.handler(VALID_QUESTIONS)).rejects.toBe(noStarter);
    expect(onControlError).toHaveBeenCalledTimes(1);
    expect(onControlError.mock.calls[0]?.[0]).toBe(noStarter);
  });

  test('does not report a normal handler error to onControlError', async () => {
    const boom = new Error('boom');
    const onControlError = mock();
    buildArchonMcpServer(
      [
        spec(VALID_SCHEMA, (): Promise<string> => {
          throw boom;
        }),
      ],
      {
        contextFor: (): NativeToolHandlerContext => ({}),
        onControlError,
      }
    );
    const tool = capturedTools[0];
    if (!tool) throw new Error('expected captured tool');
    await expect(tool.handler({ action: 'list' })).rejects.toBe(boom);
    expect(onControlError).not.toHaveBeenCalled();
  });
});
