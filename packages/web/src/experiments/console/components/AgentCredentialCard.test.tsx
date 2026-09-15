/**
 * A single-credential agent whose only credential kind is `ambient` must show
 * whether the shared login is usable; there is no key form or login button.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { installHappyDom, restoreHappyDom } from '../test/install-happy-dom';
import { AgentCredentialCard } from './AgentCredentialCard';
import type { AgentCredentials } from '../skills';

function devinAgent(ambientConfigured: boolean): AgentCredentials {
  return {
    id: 'devin',
    displayName: 'Devin CLI (community)',
    catalog: 'static',
    ready: ambientConfigured,
    credentials: [
      {
        vendor: 'devin',
        displayName: 'Devin',
        kinds: ['ambient'],
        connected: null,
        subscriptionAvailable: false,
        installEnv: false,
        ambientConfigured,
      },
    ],
  };
}

describe('AgentCredentialCard — ambient-only single credential', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installHappyDom();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    restoreHappyDom();
  });

  async function render(agent: AgentCredentials): Promise<void> {
    await act(async () => {
      root.render(
        createElement(AgentCredentialCard, {
          agent,
          connections: [],
          connectEnabled: true,
          piModelCounts: new Map(),
        })
      );
    });
  }

  test('shows the shared login as configured with its source and no connect controls', async () => {
    await render(devinAgent(true));
    expect(container.textContent).toContain('configured via devin auth login');
    expect(container.querySelector('button')).toBeNull();
  });

  test('shows not detected when the CLI or login is missing', async () => {
    await render(devinAgent(false));
    expect(container.textContent).toContain('not detected');
    expect(container.textContent).toContain('needs credential');
    expect(container.querySelector('button')).toBeNull();
  });
});
