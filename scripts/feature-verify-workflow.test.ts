import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from '@hono/zod-openapi';
import { parseWorkflow } from '../packages/workflows/src/loader';
import { registerBuiltinProviders, registerOmpProvider } from '@archon/providers';

registerBuiltinProviders();
registerOmpProvider();

const nodeSchema = z
  .object({
    id: z.string(),
    bash: z.string().optional(),
    prompt: z.string().optional(),
    depends_on: z.array(z.string()).optional(),
    output_format: z
      .object({ properties: z.record(z.string(), z.unknown()) })
      .passthrough()
      .optional(),
    route_loop: z
      .object({
        condition: z.string(),
        routes: z.object({ positive: z.string(), negative: z.string(), exhausted: z.string() }),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const path = join(
  import.meta.dir,
  '../.archon/workflows/defaults/archon-superpower-feature-verify-loop.yml'
);
const source = readFileSync(path, 'utf8');
const workflow = z.object({ nodes: z.array(nodeSchema) }).parse(Bun.YAML.parse(source));

function node(id: string): z.infer<typeof nodeSchema> {
  const found = workflow.nodes.find(item => item.id === id);
  if (!found) throw new Error(`Missing node ${id}`);
  return found;
}

test('agent proposes typed behaviors, never a whitespace feature list', (): void => {
  expect(node('select-verify-targets').output_format?.properties).toHaveProperty(
    'affected_behaviors'
  );
  expect(source).not.toContain('feature-ids');
});

test('proof and result gate execute deterministic code', (): void => {
  expect(node('prove').bash).toContain('verify-feature-gate.ts prove');
  expect(node('prove').prompt).toBeUndefined();
  expect(node('record-verify').bash).toContain('verify-feature-gate.ts record');
  expect(node('verify-gate').route_loop?.condition).toBe("$record-verify.output == 'true'");
  expect(node('record-verify').bash).toContain('$begin-verify.output');
  expect(source).not.toContain('result.txt');
  expect(source).not.toContain('/harness');
});

test('the actual engine loader accepts the complete workflow', (): void => {
  expect(parseWorkflow(source, path).error).toBeNull();
  expect(parseWorkflow(source, path).workflow).toBeDefined();
});

test('planning artifacts stay out of the product diff', (): void => {
  expect(node('write-plan').prompt).toContain('$ARTIFACTS_DIR/superpowers/plans/');
  expect(node('build-ralph-prd').prompt).toContain('$ARTIFACTS_DIR/superpowers/ralph/');
  expect(source).not.toContain('docs/superpowers/');
});

test('every fix returns through a fresh attempt and selection', (): void => {
  expect(node('begin-verify').depends_on).toContain('fix-verify');
  expect(node('finalize-change').depends_on).toEqual(['begin-verify']);
  expect(node('prepare-verify').depends_on).toEqual(['finalize-change']);
  expect(node('select-verify-targets').depends_on).toEqual(['prepare-verify']);
  expect(node('normalize-verify-targets').depends_on).toEqual(['select-verify-targets']);
  expect(node('prove').depends_on).toEqual(['normalize-verify-targets']);
});

test('positive routing checks current proof again before PR creation', (): void => {
  expect(node('verify-gate').route_loop?.routes.positive).toBe('authorize-pr');
  expect(node('authorize-pr').bash).toContain('verify-feature-gate.ts assert-pass');
  expect(node('create-pull-request').depends_on).toEqual(['authorize-pr']);
});
