import type { components } from '@/lib/api.generated';

type WorkflowDefinition = components['schemas']['WorkflowDefinition'];
type DagNode = components['schemas']['DagNode'];

const AMBIGUOUS_WORDS = new Set(['true', 'false', 'null', '~', 'yes', 'no', 'on', 'off', 'nan']);
const NUMERIC_LIKE =
  /^[+-]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|0x[0-9a-fA-F]+|0o[0-7]+|\.(?:inf|nan))$/i;

function quoteIfAmbiguous(value: string): string {
  if (
    value === '' ||
    AMBIGUOUS_WORDS.has(value.toLowerCase()) ||
    NUMERIC_LIKE.test(value) ||
    value.includes(':') ||
    value.includes('#') ||
    value.includes('"') ||
    value.includes("'") ||
    value.startsWith('{') ||
    value.startsWith('[') ||
    value.startsWith('&') ||
    value.startsWith('*') ||
    value.startsWith('-') ||
    value.startsWith('+') ||
    value.startsWith('?') ||
    value.startsWith('!') ||
    value.startsWith('%') ||
    value.startsWith('@') ||
    value.startsWith('`') ||
    value !== value.trim()
  ) {
    return JSON.stringify(value);
  }
  return value;
}

function serializeValue(value: unknown, indent: number): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.includes('\n')) {
      const pad = ' '.repeat(indent + 2);
      return `|\n${value
        .split('\n')
        .map(line => pad + line)
        .join('\n')}`;
    }
    return quoteIfAmbiguous(value);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = ' '.repeat(indent + 2);
    return `\n${value.map(item => `${pad}- ${serializeValue(item, indent + 4)}`).join('\n')}`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, entry]) => entry !== undefined
    );
    if (entries.length === 0) return '{}';
    const pad = ' '.repeat(indent + 2);
    return `\n${entries.map(([key, entry]) => keyLine(pad, key, entry, indent + 2)).join('\n')}`;
  }
  return JSON.stringify(value);
}

function keyLine(prefix: string, key: string, value: unknown, indent: number): string {
  const rendered = serializeValue(value, indent);
  return rendered.startsWith('\n') ? `${prefix}${key}:${rendered}` : `${prefix}${key}: ${rendered}`;
}

function serializeNode(node: DagNode, indent: number): string {
  const record = node as Record<string, unknown>;
  const keys = ['id', ...Object.keys(node).filter(key => key !== 'id')];
  const pad = ' '.repeat(indent);
  const lines: string[] = [];
  let first = true;
  for (const key of keys) {
    const value = record[key];
    if (value === undefined) continue;
    lines.push(keyLine(first ? `${pad}- ` : `${pad}  `, key, value, indent + 2));
    first = false;
  }
  return lines.join('\n');
}

/** Serialize the complete wire definition for the read-only YAML previews. */
export function serializeWorkflowToYaml(definition: WorkflowDefinition): string {
  const { name, description, nodes, ...metadata } = definition;
  const lines = [keyLine('', 'name', name, 0)];
  if (description !== undefined && description !== '') {
    lines.push(keyLine('', 'description', description, 0));
  }
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) lines.push(keyLine('', key, value, 0));
  }
  lines.push('', 'nodes:');
  for (const node of nodes) lines.push(serializeNode(node, 2));
  return `${lines.join('\n')}\n`;
}
