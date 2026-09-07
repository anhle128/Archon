import type { ReactElement } from 'react';

import type { TerminalClientState } from './client';

function terminalStatusCopy(state: TerminalClientState): string {
  switch (state.kind) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'unavailable':
    case 'error':
      return state.message;
    case 'closed':
      return 'Terminal closed.';
    case 'exited':
      if (state.code !== null) return `Terminal exited with code ${String(state.code)}.`;
      if (state.signal !== null) return `Terminal exited after ${state.signal}.`;
      return 'Terminal exited.';
  }
}

export function TerminalStatus({ state }: { state: TerminalClientState }): ReactElement {
  return (
    <p role="status" aria-live="polite" className="text-sm text-text-secondary">
      {terminalStatusCopy(state)}
    </p>
  );
}
