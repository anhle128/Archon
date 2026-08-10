import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2, RefreshCw, Terminal } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  previewRetryWorkflowNode,
  retryWorkflowNode,
  type RetryWorkflowNodeCheckoutStrategy,
  type RetryWorkflowNodeResponse,
} from '@/lib/api';
import {
  getWorkflowNodeRetryActionState,
  normalizeRetryWorkflowNodeError,
} from '@/lib/workflow-retry';
import type { DagNodeState, WorkflowRunStatus } from '@/lib/types';

interface WorkflowNodeRetryActionProps {
  runId: string;
  runStatus: WorkflowRunStatus;
  node: DagNodeState | null;
  parentPlatformId: string | null;
  conversationPlatformId: string | null;
  onRetried?: (result: RetryWorkflowNodeResponse) => void;
}

function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 12) : 'unknown';
}

export function WorkflowNodeRetryAction({
  runId,
  runStatus,
  node,
  parentPlatformId,
  conversationPlatformId,
  onRetried,
}: WorkflowNodeRetryActionProps): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkoutStrategy, setCheckoutStrategy] =
    useState<RetryWorkflowNodeCheckoutStrategy>('checkpoint');

  const previewQuery = useQuery({
    queryKey: ['workflow-node-retry-preview', runId, node?.nodeId],
    queryFn: () => {
      if (!node) throw new Error('No retry node selected');
      return previewRetryWorkflowNode(runId, node.nodeId);
    },
    enabled: open && !!node,
    retry: false,
  });

  useEffect(() => {
    if (!previewQuery.data) return;
    setCheckoutStrategy(previewQuery.data.requiresCommitChoice ? 'current' : 'checkpoint');
  }, [previewQuery.data]);

  const retryMutation = useMutation({
    mutationFn: () => {
      if (!node) throw new Error('No retry node selected');
      return retryWorkflowNode(
        runId,
        node.nodeId,
        previewQuery.data?.requiresCommitChoice ? { checkoutStrategy } : undefined
      );
    },
    onSuccess: result => {
      setError(null);
      setOpen(false);
      onRetried?.(result);
    },
    onError: mutationError => {
      setError(normalizeRetryWorkflowNodeError(mutationError));
    },
  });

  if (!node) return null;

  const actionState = getWorkflowNodeRetryActionState(
    { runId, status: runStatus, parentPlatformId, conversationPlatformId },
    node
  );

  if (actionState.kind === 'hidden') return null;

  if (actionState.kind === 'route-loop-guidance') {
    return (
      <div className="border-b border-border bg-surface px-3 py-2 text-xs text-text-secondary">
        <div className="flex min-w-0 items-start gap-2">
          <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <div className="min-w-0 space-y-1">
            <div className="font-medium text-text-primary">Retry the route source node</div>
            <p>
              Route-loop controller nodes are not retried directly. Select{' '}
              <code className="rounded bg-background px-1 font-mono text-[11px] text-text-primary">
                {actionState.sourceNodeId}
              </code>{' '}
              from the controller dependencies and retry that node to rerun the route decision.
            </p>
            {actionState.command && (
              <code className="block break-all rounded bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
                {actionState.command}
              </code>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (actionState.kind === 'cli') {
    return (
      <div className="border-b border-border bg-surface px-3 py-2 text-xs text-text-secondary">
        <div className="flex min-w-0 items-start gap-2">
          <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-tertiary" />
          <div className="min-w-0">
            <div className="font-medium text-text-primary">Retry this run from the CLI</div>
            <code className="mt-1 block break-all rounded bg-background px-2 py-1 font-mono text-[11px] text-text-secondary">
              {actionState.command}
            </code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-border bg-surface px-3 py-2">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-medium text-text-primary">Failed node: {node.name}</div>
          <div className="text-xs text-text-secondary">Retry selected node and descendants</div>
        </div>
        <AlertDialog
          open={open}
          onOpenChange={nextOpen => {
            setOpen(nextOpen);
            if (!nextOpen) setError(null);
          }}
        >
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="outline" disabled={retryMutation.isPending}>
              {retryMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Retry
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Retry failed node?</AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-2 text-sm text-text-secondary">
                  <p>
                    Retry <strong>{node.name}</strong>. Archon will prepare the selected checkout
                    point before rerunning this node and downstream dependent nodes.
                  </p>
                  <p>
                    Dirty tracked changes from the failed attempt are committed to a retry safety
                    ref first. Untracked and ignored files are not deleted.
                  </p>
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            {previewQuery.isFetching && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Checking checkout state</span>
              </div>
            )}
            {previewQuery.error && (
              <div className="flex items-start gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">
                  {normalizeRetryWorkflowNodeError(previewQuery.error)}
                </span>
              </div>
            )}
            {previewQuery.data?.requiresCommitChoice && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-text-primary">Retry checkout</div>
                <div className="grid gap-2" role="radiogroup" aria-label="Retry checkout">
                  <label
                    className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                      checkoutStrategy === 'current'
                        ? 'border-primary bg-primary/10 text-text-primary'
                        : 'border-border bg-background text-text-secondary'
                    }`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name={`retry-checkout-${runId}-${node.nodeId}`}
                      value="current"
                      checked={checkoutStrategy === 'current'}
                      onChange={() => {
                        setCheckoutStrategy('current');
                      }}
                    />
                    <span className="block font-medium">Current HEAD</span>
                    <code className="mt-1 block font-mono text-xs">
                      {shortSha(previewQuery.data.currentHeadSha)}
                    </code>
                  </label>
                  <label
                    className={`cursor-pointer rounded-md border px-3 py-2 text-sm ${
                      checkoutStrategy === 'checkpoint'
                        ? 'border-primary bg-primary/10 text-text-primary'
                        : 'border-border bg-background text-text-secondary'
                    }`}
                  >
                    <input
                      className="sr-only"
                      type="radio"
                      name={`retry-checkout-${runId}-${node.nodeId}`}
                      value="checkpoint"
                      checked={checkoutStrategy === 'checkpoint'}
                      onChange={() => {
                        setCheckoutStrategy('checkpoint');
                      }}
                    />
                    <span className="block font-medium">Node checkpoint</span>
                    <code className="mt-1 block font-mono text-xs">
                      {shortSha(previewQuery.data.checkpointCommitSha)}
                    </code>
                  </label>
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 break-words">{error}</span>
              </div>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={retryMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={
                  retryMutation.isPending || previewQuery.isFetching || !!previewQuery.error
                }
                onClick={event => {
                  event.preventDefault();
                  retryMutation.mutate();
                }}
              >
                {retryMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Retry node
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
