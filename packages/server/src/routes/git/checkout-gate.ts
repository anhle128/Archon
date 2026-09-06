export type GitEmptyReason = 'container' | 'no_checkout';

export type CheckoutGateResult =
  | { kind: 'run_not_found' }
  | { kind: 'empty'; emptyReason: GitEmptyReason }
  | { kind: 'ready'; workingPath: string };

export interface ResolveRunCheckoutInput {
  run: { conversation_id: string; working_path: string | null } | null;
  getConversationById: (id: string) => Promise<{ isolation_env_id: string | null } | null>;
  getIsolationEnvById: (id: string) => Promise<{ provider: string } | null>;
  pathExists: (path: string) => Promise<boolean>;
  realpathFn: (path: string) => Promise<string>;
  isGitWorkTree: (path: string) => Promise<boolean>;
}

export async function resolveRunCheckout(
  input: ResolveRunCheckoutInput
): Promise<CheckoutGateResult> {
  if (!input.run) return { kind: 'run_not_found' };

  const conversation = await input.getConversationById(input.run.conversation_id);
  const envId = conversation?.isolation_env_id ?? null;
  if (envId) {
    const environment = await input.getIsolationEnvById(envId);
    if (environment?.provider === 'container') {
      return { kind: 'empty', emptyReason: 'container' };
    }
  }

  const workingPath = input.run.working_path;
  if (!workingPath) return { kind: 'empty', emptyReason: 'no_checkout' };
  if (!(await input.pathExists(workingPath))) {
    return { kind: 'empty', emptyReason: 'no_checkout' };
  }

  let canonicalPath: string;
  try {
    canonicalPath = await input.realpathFn(workingPath);
  } catch {
    return { kind: 'empty', emptyReason: 'no_checkout' };
  }

  if (!(await input.isGitWorkTree(canonicalPath))) {
    return { kind: 'empty', emptyReason: 'no_checkout' };
  }

  return { kind: 'ready', workingPath: canonicalPath };
}
