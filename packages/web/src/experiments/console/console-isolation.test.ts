import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const CONSOLE_ROOT = import.meta.dir;

const FORBIDDEN_SPEC_PREFIXES = [
  '@/components',
  '@/stores',
  '@/contexts',
  '@/routes',
  '@/hooks',
  '@tanstack/react-query',
] as const;

const FORBIDDEN_INSPECT_IDENTIFIERS = ['pending_interactions', 'AskCard', 'ChatComposer'] as const;
const FORBIDDEN_INSPECT_STRINGS = ['Waiting on you', 'awaiting'] as const;

interface ImportSite {
  spec: string;
  typeOnly: boolean;
}

function isTestFile(relativePath: string): boolean {
  return relativePath.endsWith('.test.ts') || relativePath.endsWith('.test.tsx');
}

function isProductionSource(relativePath: string): boolean {
  return (
    (relativePath.endsWith('.ts') || relativePath.endsWith('.tsx')) && !isTestFile(relativePath)
  );
}

function compact(source: string): string {
  return source.replace(/\s+/g, '');
}

function parseImports(source: string): ImportSite[] {
  const sites: ImportSite[] = [];
  const fromImport =
    /(?:^|;)\s*(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  const sideEffect = /(?:^|;)\s*import\s+['"]([^'"]+)['"]/gm;
  for (const match of source.matchAll(fromImport)) {
    const typeKeyword = match[1] !== undefined;
    const clause = match[2] ?? '';
    const spec = match[3] ?? '';
    sites.push({ spec, typeOnly: typeKeyword || namedClauseIsTypeOnly(clause) });
  }
  for (const match of source.matchAll(sideEffect)) {
    const spec = match[1] ?? '';
    if (spec.length === 0) continue;
    if (sites.some(site => site.spec === spec)) continue;
    sites.push({ spec, typeOnly: false });
  }
  return sites;
}

function namedClauseIsTypeOnly(clause: string): boolean {
  const trimmed = clause.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return false;
  const inner = trimmed.slice(1, -1);
  const parts = inner
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  return parts.length > 0 && parts.every(part => /^type\b/.test(part));
}

function isForbiddenSpec(spec: string): boolean {
  if (spec === '@/lib/api' || spec.startsWith('@/lib/api/')) return true;
  return FORBIDDEN_SPEC_PREFIXES.some(
    prefix => spec === prefix || spec.startsWith(`${prefix}/`) || spec.startsWith(`${prefix}?`)
  );
}

async function productionFiles(): Promise<string[]> {
  const files: string[] = [];
  for await (const path of new Bun.Glob('**/*.{ts,tsx}').scan({ cwd: CONSOLE_ROOT })) {
    const relativePath = path.replaceAll('\\', '/');
    if (isProductionSource(relativePath)) files.push(relativePath);
  }
  files.sort();
  return files;
}

describe('console NFR4 isolation', () => {
  test('production files do not import legacy UI, React Query, or runtime API modules', async () => {
    const violations: string[] = [];
    for (const relativePath of await productionFiles()) {
      const source = await readFile(join(CONSOLE_ROOT, relativePath), 'utf8');
      for (const site of parseImports(source)) {
        if (isForbiddenSpec(site.spec)) {
          violations.push(`${relativePath} imports ${site.spec}`);
          continue;
        }
        if (site.spec === '@/lib/api.generated' || site.spec.startsWith('@/lib/api.generated/')) {
          if (!site.typeOnly) {
            violations.push(`${relativePath} runtime-imports ${site.spec}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  test('status cards wire consoleRunHref to current-node or approval-node ids', async () => {
    const card = compact(
      await readFile(join(CONSOLE_ROOT, 'components/ConsoleWorkflowResultCard.tsx'), 'utf8')
    );
    const dock = compact(await readFile(join(CONSOLE_ROOT, 'components/WorkflowDock.tsx'), 'utf8'));
    expect(card).toContain("from'./console-run-href'");
    expect(card).toContain('consoleRunHref(run.projectId,run.id,run.currentNode??null)');
    expect(dock).toContain("from'./console-run-href'");
    expect(dock).toContain('consoleRunHref(run.projectId,run.id,run.currentNode??null)');
    expect(dock).toContain(
      'consoleRunHref(run.projectId,run.id,run.approval?.nodeId??run.currentNode??null)'
    );
  });

  test('inspect and room production files omit premature HITL chrome', async () => {
    const inspectFiles: string[] = [];
    for await (const path of new Bun.Glob('components/inspect/**/*.{ts,tsx}').scan({
      cwd: CONSOLE_ROOT,
    })) {
      const relativePath = path.replaceAll('\\', '/');
      if (isProductionSource(relativePath)) inspectFiles.push(relativePath);
    }
    inspectFiles.push('components/ConsoleNodeRoom.tsx', 'components/ConsoleInspectPane.tsx');

    const violations: string[] = [];
    for (const relativePath of inspectFiles) {
      const source = await readFile(join(CONSOLE_ROOT, relativePath), 'utf8');
      for (const identifier of FORBIDDEN_INSPECT_IDENTIFIERS) {
        if (source.includes(identifier)) {
          violations.push(`${relativePath} contains ${identifier}`);
        }
      }
      const allowAwaiting = relativePath.endsWith('inspect-status.ts');
      for (const phrase of FORBIDDEN_INSPECT_STRINGS) {
        if (phrase === 'awaiting' && allowAwaiting) continue;
        if (source.includes(phrase)) {
          violations.push(`${relativePath} contains ${phrase}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
