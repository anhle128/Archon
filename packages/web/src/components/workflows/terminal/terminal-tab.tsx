import { useEffect, useRef, useState, type ReactElement } from 'react';
import '@xterm/xterm/css/xterm.css';

import { Button } from '@/components/ui/button';

import type { TerminalClientState } from './client';
import { TerminalStatus } from './terminal-status';
import { mountXtermSession, type MountedXtermSession } from './xterm-session';

export function TerminalTab({ runId }: { runId: string }): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<MountedXtermSession | null>(null);
  const [state, setState] = useState<TerminalClientState>({ kind: 'connecting' });
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const session = mountXtermSession({ host, runId, onState: setState });
    sessionRef.current = session;
    return (): void => {
      sessionRef.current = null;
      session.dispose();
    };
  }, [runId]);
  const terminalEnded =
    state.kind === 'closed' ||
    state.kind === 'exited' ||
    state.kind === 'unavailable' ||
    state.kind === 'error';
  return (
    <section role="region" aria-label="Run terminal" className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center justify-between">
        {state.kind === 'connected' ? <TerminalStatus state={state} /> : <span />}
        <Button
          disabled={terminalEnded}
          onClick={(): void => {
            sessionRef.current?.closeSession();
          }}
        >
          Close terminal
        </Button>
      </div>
      <div className="relative flex-1 min-h-0 overflow-hidden bg-surface-inset">
        <div ref={hostRef} className="h-full w-full" />
        {state.kind !== 'connected' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface-inset">
            <TerminalStatus state={state} />
          </div>
        )}
      </div>
    </section>
  );
}
