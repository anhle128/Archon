/**
 * Persistent inspect split: Log or Graph on the left, one mounted node room
 * on the right. View toggles must not remount the room.
 */
import { useMemo, type ReactElement, type ReactNode, type RefObject } from 'react';

import type { RunEvent } from '../primitives/event';
import type { Message } from '../primitives/message';
import type { Run } from '../primitives/run';
import type {
  WorkflowEvent,
  WorkflowNodeMessagesResponse,
  WorkflowNodeState,
} from '../skills/runs';
import type { UsageReport } from '../skills/usage';
import type { DagNode } from '../skills/workflows';
import { useEntity } from '../store/cache';
import { K } from '../store/keys';
import { StreamContextProvider } from '../lib/stream-context';
import { ConsoleNodeRoom } from './ConsoleNodeRoom';
import { RunGraphPanel } from './RunGraphPanel';
import { RunStream } from './RunStream';
import type { ConsoleLogEntry } from './inspect/build-console-log-entries';
import type { LogRow } from './inspect/build-log-rows';
import { isInspectRunLive } from './inspect/inspect-status';

export interface ConsoleInspectPaneProps {
  view: 'log' | 'graph';
  run: Run;
  projectId: string;
  projectCwd: string;
  messages: Message[];
  events: RunEvent[];
  rawEvents: WorkflowEvent[];
  nodeStates: WorkflowNodeState[];
  logEntries: ConsoleLogEntry[];
  usage: UsageReport | null;
  streamNodeFilter: string;
  selectedNodeId: string | null;
  selectedLogRowId: string | null;
  showToolCalls: boolean;
  showSystem: boolean;
  logHeader: ReactNode;
  logFooter: ReactNode;
  logScrollRef: RefObject<HTMLDivElement | null>;
  onSelectNode: (nodeId: string, rowId?: string) => void;
  onCloseRoom: () => void;
  loadDefinition: (workflowName: string, cwd: string) => Promise<DagNode[]>;
  loadMessages: (runId: string, nodeId: string) => Promise<WorkflowNodeMessagesResponse>;
}

function resolveSelectedRow(
  entries: readonly ConsoleLogEntry[],
  selectedNodeId: string | null,
  selectedLogRowId: string | null
): LogRow | null {
  if (selectedNodeId === null) return null;
  if (selectedLogRowId !== null) {
    for (const entry of entries) {
      if (entry.row.id === selectedLogRowId && entry.row.nodeId === selectedNodeId) {
        return entry.row;
      }
    }
  }
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.row.nodeId === selectedNodeId) {
      return entry.row;
    }
  }
  return null;
}

export function ConsoleInspectPane({
  view,
  run,
  projectId,
  projectCwd,
  messages,
  events,
  rawEvents,
  nodeStates,
  logEntries,
  usage,
  streamNodeFilter,
  selectedNodeId,
  selectedLogRowId,
  showToolCalls,
  showSystem,
  logHeader,
  logFooter,
  logScrollRef,
  onSelectNode,
  onCloseRoom,
  loadDefinition,
  loadMessages,
}: ConsoleInspectPaneProps): ReactElement {
  const definitionQuery = useEntity<DagNode[]>(K.workflowDagNodes(projectCwd, run.workflow), () =>
    loadDefinition(run.workflow, projectCwd)
  );
  const definitionError =
    definitionQuery.error === undefined ? null : definitionQuery.error.message;
  const definitionPending =
    definitionQuery.data === undefined && definitionQuery.error === undefined;
  const definitionNodes = definitionQuery.data ?? [];
  const selectedRow = useMemo(
    () => resolveSelectedRow(logEntries, selectedNodeId, selectedLogRowId),
    [logEntries, selectedNodeId, selectedLogRowId]
  );

  return (
    <div data-testid="console-inspect-pane" className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {view === 'log' ? (
          <div ref={logScrollRef} className="min-h-0 flex-1 overflow-y-auto">
            {logHeader}
            <StreamContextProvider value={{ runStartedAt: run.startedAt }}>
              <RunStream
                messages={messages}
                events={events}
                showToolCalls={showToolCalls}
                showSystem={showSystem}
                selectedNodeId={streamNodeFilter}
                usage={usage}
                logEntries={logEntries}
                selectedLogRowId={selectedLogRowId}
                onSelectLogRow={(rowId: string, nodeId: string): void => {
                  onSelectNode(nodeId, rowId);
                }}
              />
            </StreamContextProvider>
            {logFooter}
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <RunGraphPanel
              nodes={definitionNodes}
              nodeStates={nodeStates}
              selectedNodeId={selectedNodeId}
              definitionPending={definitionPending}
              definitionError={definitionError}
              onSelectNode={(nodeId: string): void => {
                onSelectNode(nodeId);
              }}
            />
          </div>
        )}
      </div>
      <aside
        data-testid="console-inspect-room"
        className="flex max-h-[40vh] min-h-0 w-full shrink-0 flex-col border-t border-border lg:max-h-none lg:w-[380px] lg:border-l lg:border-t-0"
      >
        <ConsoleNodeRoom
          run={run}
          projectId={projectId}
          nodeId={selectedNodeId}
          selectedRow={selectedRow}
          definitionNodes={definitionNodes}
          definitionPending={definitionPending}
          nodeStates={nodeStates}
          events={rawEvents}
          approval={run.approval ?? null}
          isLive={isInspectRunLive(run.status)}
          loadMessages={loadMessages}
          onClose={onCloseRoom}
        />
      </aside>
    </div>
  );
}
