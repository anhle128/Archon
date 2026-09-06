/**
 * Sort node transcripts by seq, then slice loop iterations by status markers.
 */
import type { WorkflowNodeMessage } from '../../skills/runs';
import type { LogRowSelection } from './build-log-rows';

export function selectNodeRoomMessages(
  messages: readonly WorkflowNodeMessage[],
  selection: LogRowSelection
): WorkflowNodeMessage[] {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  if (selection.kind !== 'loop_iteration') return ordered;
  const detail = String(selection.iteration);
  const start = ordered.findIndex(
    message =>
      message.kind === 'status' &&
      message.payload.state === 'iteration_started' &&
      message.payload.detail === detail
  );
  if (start < 0) return ordered;
  const terminalOffset = ordered
    .slice(start + 1)
    .findIndex(
      message =>
        message.kind === 'status' &&
        (message.payload.state === 'iteration_completed' ||
          message.payload.state === 'iteration_failed') &&
        message.payload.detail === detail
    );
  if (terminalOffset >= 0) return ordered.slice(start, start + terminalOffset + 2);
  const nextStartOffset = ordered
    .slice(start + 1)
    .findIndex(
      message => message.kind === 'status' && message.payload.state === 'iteration_started'
    );
  return ordered.slice(start, nextStartOffset >= 0 ? start + nextStartOffset + 1 : undefined);
}
