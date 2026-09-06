import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AgentSession,
  AuthStorage,
  createAgentSession,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import {
  type Context,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type ToolResultMessage,
} from '@earendil-works/pi-ai';
import { registerFauxProvider, resetApiProviders } from '@earendil-works/pi-ai/compat';

describe('Pi AskHuman durable resume characterization', () => {
  test('continues after dispose and reopen when the matching tool result is persisted', async (): Promise<void> => {
    const spikeRoot = mkdtempSync(join(tmpdir(), 'archon-pi-ask-resume-'));
    const cwd = join(spikeRoot, 'cwd');
    const agentDir = join(spikeRoot, 'agent');
    const sessionDir = join(spikeRoot, 'sessions');
    mkdirSync(cwd);
    mkdirSync(agentDir);
    mkdirSync(sessionDir);

    const faux = registerFauxProvider({
      api: 'archon-askhuman-spike',
      provider: 'archon-askhuman-spike',
      models: [{ id: 'resume-model' }],
      tokensPerSecond: 10_000,
    });
    const model = faux.getModel();
    let first: AgentSession | undefined;
    let second: AgentSession | undefined;

    const createSession = async (sessionManager: SessionManager): Promise<AgentSession> => {
      const authStorage = AuthStorage.inMemory({
        'archon-askhuman-spike': { type: 'api_key', key: 'test-key' },
      });
      const modelRegistry = ModelRegistry.inMemory(authStorage);
      const result = await createAgentSession({
        cwd,
        agentDir,
        model,
        authStorage,
        modelRegistry,
        settingsManager: SettingsManager.inMemory(),
        sessionManager,
        noTools: 'all',
      });
      return result.session;
    };

    try {
      const toolUseId = 'askhuman-tool-use-1';
      const pendingToolCall = fauxAssistantMessage(
        [
          fauxToolCall(
            'AskHuman',
            {
              questions: [
                {
                  id: 'direction',
                  prompt: 'Choose a direction.',
                  selection: 'single',
                  options: ['east', 'west'],
                  allowOther: false,
                },
              ],
            },
            { id: toolUseId }
          ),
        ],
        { stopReason: 'toolUse', timestamp: 2 }
      );
      const answer: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: toolUseId,
        toolName: 'AskHuman',
        content: [{ type: 'text', text: 'east' }],
        isError: false,
        timestamp: 3,
      };
      const continuedMessage = fauxAssistantMessage(fauxText('continued after AskHuman'), {
        stopReason: 'stop',
        timestamp: 4,
      });
      let capturedContext: Context | undefined;
      faux.setResponses([
        (context): typeof continuedMessage => {
          capturedContext = context;
          return continuedMessage;
        },
      ]);

      first = await createSession(SessionManager.create(cwd, sessionDir));
      first.sessionManager.appendMessage({
        role: 'user',
        content: 'Ask for a direction.',
        timestamp: 1,
      });
      first.sessionManager.appendMessage(pendingToolCall);
      const sessionFile = first.sessionFile;
      expect(typeof sessionFile).toBe('string');
      if (sessionFile === undefined) throw new Error('Pi did not persist the spike session');
      first.dispose();
      first = undefined;

      const reopened = SessionManager.open(sessionFile);
      expect(reopened.buildSessionContext().messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: [{ type: 'toolCall', id: toolUseId, name: 'AskHuman' }],
      });
      reopened.appendMessage(answer);
      second = await createSession(reopened);
      expect(second.agent.state.messages.at(-1)).toEqual(answer);

      await second.agent.continue();

      expect(faux.state.callCount).toBe(1);
      expect(capturedContext?.messages.at(-1)).toMatchObject({
        role: 'toolResult',
        toolCallId: toolUseId,
      });
      expect(second.agent.state.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: [{ type: 'text', text: 'continued after AskHuman' }],
        api: 'archon-askhuman-spike',
        provider: 'archon-askhuman-spike',
        model: 'resume-model',
        stopReason: 'stop',
      });
      second.dispose();
      second = undefined;

      const reopenedAgain = SessionManager.open(sessionFile);
      const persistedTail = reopenedAgain.buildSessionContext().messages.slice(-3);
      expect(persistedTail).toHaveLength(3);
      expect(persistedTail[0]).toMatchObject({
        role: 'assistant',
        content: [{ type: 'toolCall', id: toolUseId, name: 'AskHuman' }],
      });
      expect(persistedTail[1]).toEqual(answer);
      expect(persistedTail[2]).toMatchObject({
        role: 'assistant',
        content: [{ type: 'text', text: 'continued after AskHuman' }],
        provider: 'archon-askhuman-spike',
        model: 'resume-model',
      });
    } finally {
      first?.dispose();
      second?.dispose();
      faux.unregister();
      resetApiProviders();
      const expectedPrefix = join(tmpdir(), 'archon-pi-ask-resume-');
      if (!spikeRoot.startsWith(expectedPrefix)) {
        throw new Error(`Refusing to remove unexpected spike directory: ${spikeRoot}`);
      }
      rmSync(spikeRoot, { recursive: true, force: true });
    }
  });
});
