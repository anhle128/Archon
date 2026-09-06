import { describe, test, expect, mock } from 'bun:test';
import { Value } from '@sinclair/typebox/value';
import { buildPiNativeToolDefinitions } from './native-tools';
import {
  AskHumanAwaitingError,
  AskHumanNoStarterError,
  type NativeTool,
  type NativeToolHandlerContext,
} from '../../types';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

const defineTool = (definition: ToolDefinition): ToolDefinition => definition;

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

async function executeTool(
  def: ToolDefinition,
  toolCallId: string,
  params: unknown
): Promise<unknown> {
  return def.execute(toolCallId, params as never, undefined, undefined, undefined as never);
}

describe('buildPiNativeToolDefinitions (Pi JSON-Schema → TypeBox)', () => {
  test('builds for a valid schema with string / string-enum / boolean fields', () => {
    const defs = buildPiNativeToolDefinitions([spec(VALID_SCHEMA)], defineTool);
    expect(defs).toHaveLength(1);
    expect(defs[0]?.name).toBe('manage_run');
  });

  test('rejects a non-object schema (fail-fast)', () => {
    expect(() => buildPiNativeToolDefinitions([spec({ type: 'string' })], defineTool)).toThrow(
      /must be an object schema/
    );
  });

  test('rejects an unsupported field type (number)', () => {
    expect(() =>
      buildPiNativeToolDefinitions(
        [spec({ type: 'object', properties: { n: { type: 'number' } }, required: [] })],
        defineTool
      )
    ).toThrow(/unsupported type/);
  });

  test('rejects a number field nested inside a question object', () => {
    expect(() =>
      buildPiNativeToolDefinitions(
        [
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
        ],
        defineTool
      )
    ).toThrow(/unsupported type/);
  });

  test('rejects an empty enum', () => {
    expect(() =>
      buildPiNativeToolDefinitions(
        [spec({ type: 'object', properties: { a: { enum: [] } }, required: ['a'] })],
        defineTool
      )
    ).toThrow(/non-empty strings/);
  });

  test('accepts ASK_HUMAN_INPUT_SCHEMA and validates nested questions[]', () => {
    const defs = buildPiNativeToolDefinitions([spec(ASK_HUMAN_INPUT_SCHEMA)], defineTool);
    const parameters = defs[0]?.parameters;
    if (!parameters) throw new Error('expected parameters');
    expect(Value.Check(parameters, VALID_QUESTIONS)).toBe(true);
    expect(Value.Check(parameters, { questions: [] })).toBe(false);
    expect(
      Value.Check(parameters, {
        questions: [
          {
            id: 'q1',
            prompt: 'Which option?',
            selection: 'single',
            options: ['a'],
          },
        ],
      })
    ).toBe(false);
  });

  test('passes _toolCallId and runtime sessionId into the NativeTool handler', async () => {
    const seen: Array<NativeToolHandlerContext | undefined> = [];
    const runtime = {
      sessionId: (): string | undefined => 'sess_1',
      onControlError: mock(),
    };
    const defs = buildPiNativeToolDefinitions(
      [
        spec(ASK_HUMAN_INPUT_SCHEMA, async (_input, context): Promise<string> => {
          seen.push(context);
          return 'ok';
        }),
      ],
      defineTool,
      runtime
    );
    const def = defs[0];
    if (!def) throw new Error('expected tool definition');
    await executeTool(def, 'call_1', VALID_QUESTIONS);
    expect(seen).toEqual([{ toolUseId: 'call_1', sessionId: 'sess_1' }]);
    expect(runtime.onControlError).not.toHaveBeenCalled();
  });

  test('reports AskHumanAwaitingError to onControlError and rejects with the same instance', async () => {
    const awaiting = new AskHumanAwaitingError('call_1', 'review', 'run-1');
    const onControlError = mock();
    const defs = buildPiNativeToolDefinitions(
      [
        spec(ASK_HUMAN_INPUT_SCHEMA, (): Promise<string> => {
          throw awaiting;
        }),
      ],
      defineTool,
      {
        sessionId: (): string | undefined => 'sess_1',
        onControlError,
      }
    );
    const def = defs[0];
    if (!def) throw new Error('expected tool definition');
    await expect(executeTool(def, 'call_1', VALID_QUESTIONS)).rejects.toBe(awaiting);
    expect(onControlError).toHaveBeenCalledTimes(1);
    expect(onControlError.mock.calls[0]?.[0]).toBe(awaiting);
  });

  test('reports AskHumanNoStarterError to onControlError and rejects with the same instance', async () => {
    const noStarter = new AskHumanNoStarterError('run-1');
    const onControlError = mock();
    const defs = buildPiNativeToolDefinitions(
      [
        spec(ASK_HUMAN_INPUT_SCHEMA, (): Promise<string> => {
          throw noStarter;
        }),
      ],
      defineTool,
      {
        sessionId: (): string | undefined => 'sess_1',
        onControlError,
      }
    );
    const def = defs[0];
    if (!def) throw new Error('expected tool definition');
    await expect(executeTool(def, 'call_1', VALID_QUESTIONS)).rejects.toBe(noStarter);
    expect(onControlError).toHaveBeenCalledTimes(1);
    expect(onControlError.mock.calls[0]?.[0]).toBe(noStarter);
  });

  test('does not report a normal handler error to onControlError', async () => {
    const boom = new Error('boom');
    const onControlError = mock();
    const defs = buildPiNativeToolDefinitions(
      [
        spec(VALID_SCHEMA, (): Promise<string> => {
          throw boom;
        }),
      ],
      defineTool,
      {
        sessionId: (): string | undefined => undefined,
        onControlError,
      }
    );
    const def = defs[0];
    if (!def) throw new Error('expected tool definition');
    await expect(executeTool(def, 'call_1', { action: 'list' })).rejects.toBe(boom);
    expect(onControlError).not.toHaveBeenCalled();
  });
});
