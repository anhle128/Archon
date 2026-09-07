import type { PendingInteraction, WorkflowNodeMessage } from '../../skills/runs';

function collectToolIds(messages: readonly WorkflowNodeMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.kind === 'tool') {
      ids.add(message.payload.id);
    }
  }
  return ids;
}

function sortedBySeq(messages: readonly WorkflowNodeMessage[]): WorkflowNodeMessage[] {
  return [...messages].sort((left, right) => left.seq - right.seq);
}

function visibleReachesTranscriptTail(
  allMessages: readonly WorkflowNodeMessage[],
  visibleMessages: readonly WorkflowNodeMessage[]
): boolean {
  const full = sortedBySeq(allMessages);
  if (full.length === 0) {
    return true;
  }
  const visible = sortedBySeq(visibleMessages);
  if (visible.length === 0) {
    return false;
  }
  return visible[visible.length - 1].id === full[full.length - 1].id;
}

export function selectVisibleNodeAskInteractions(input: {
  pending: readonly PendingInteraction[];
  nodeId: string;
  allMessages: readonly WorkflowNodeMessage[];
  visibleMessages: readonly WorkflowNodeMessage[];
}): PendingInteraction[] {
  const allToolIds = collectToolIds(input.allMessages);
  const visibleToolIds = collectToolIds(input.visibleMessages);
  const atTail = visibleReachesTranscriptTail(input.allMessages, input.visibleMessages);

  const selected: PendingInteraction[] = [];
  for (const interaction of input.pending) {
    if (interaction.kind !== 'ask') {
      continue;
    }
    if (interaction.node_id !== input.nodeId) {
      continue;
    }
    if (interaction.status !== 'pending' && interaction.status !== 'answered') {
      continue;
    }
    const anchored = allToolIds.has(interaction.tool_use_id);
    if (anchored) {
      if (!visibleToolIds.has(interaction.tool_use_id)) {
        continue;
      }
    } else if (!atTail) {
      continue;
    }
    selected.push(interaction);
  }
  return selected;
}
