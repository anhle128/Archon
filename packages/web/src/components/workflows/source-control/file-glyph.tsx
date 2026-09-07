import { createElement, type ReactElement } from 'react';
import { File, FileCode, FileJson, FileText, type LucideIcon } from 'lucide-react';

export function splitGitPath(path: string): { name: string; directory: string | null } {
  const slash = path.lastIndexOf('/');
  if (slash <= 0) return { name: path, directory: null };
  return { name: path.slice(slash + 1), directory: path.slice(0, slash) };
}

function extensionOf(path: string): string {
  const name = splitGitPath(path).name;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

interface GlyphSpec {
  icon: LucideIcon;
  className: string;
}

const DEFAULT_GLYPH: GlyphSpec = { icon: File, className: 'text-text-secondary' };

const GLYPH_BY_EXTENSION: Record<string, GlyphSpec> = {
  ts: { icon: FileCode, className: 'text-node-command' },
  tsx: { icon: FileCode, className: 'text-node-command' },
  js: { icon: FileCode, className: 'text-node-command' },
  jsx: { icon: FileCode, className: 'text-node-command' },
  mjs: { icon: FileCode, className: 'text-node-command' },
  cjs: { icon: FileCode, className: 'text-node-command' },
  json: { icon: FileJson, className: 'text-node-bash' },
  jsonc: { icon: FileJson, className: 'text-node-bash' },
  md: { icon: FileText, className: 'text-node-command' },
  markdown: { icon: FileText, className: 'text-node-command' },
  yml: { icon: FileCode, className: 'text-node-prompt' },
  yaml: { icon: FileCode, className: 'text-node-prompt' },
  css: { icon: FileCode, className: 'text-node-loop' },
  scss: { icon: FileCode, className: 'text-node-loop' },
  html: { icon: FileCode, className: 'text-node-approval' },
  txt: { icon: File, className: 'text-text-secondary' },
};

export function FileGlyph(props: { path: string }): ReactElement {
  const spec = GLYPH_BY_EXTENSION[extensionOf(props.path)] ?? DEFAULT_GLYPH;
  return createElement(spec.icon, {
    'aria-hidden': 'true',
    className: `size-3.5 shrink-0 ${spec.className}`,
  });
}
