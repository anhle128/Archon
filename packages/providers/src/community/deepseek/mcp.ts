import { execFileSync } from 'node:child_process';
import { accessSync, constants as fsConstants, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import type { McpServer } from '@agentclientprotocol/sdk';

import { DeepseekProviderError } from './errors';

function describeJsonType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function mcpConfigError(message: string): never {
  throw new DeepseekProviderError('deepseek_mcp_config_error', message);
}

function isUsableExecutable(path: string): boolean {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return false;
    if (process.platform !== 'win32') accessSync(path, fsConstants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveBareCommand(command: string, env: Record<string, string>): string | undefined {
  const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    const output = execFileSync(lookupCmd, [command], {
      encoding: 'utf-8',
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return output.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function recordToNameValues(
  record: Record<string, unknown>,
  serverName: string,
  field: 'env' | 'headers'
): { name: string; value: string }[] {
  const result: { name: string; value: string }[] = [];
  for (const [name, value] of Object.entries(record)) {
    if (typeof value !== 'string') {
      mcpConfigError(`MCP server "${serverName}" ${field} must be an object of string values.`);
    }
    result.push({ name, value });
  }
  return result;
}

function parseStringMap(
  raw: unknown,
  serverName: string,
  field: 'env' | 'headers'
): { name: string; value: string }[] {
  if (raw === undefined) return [];
  if (!isPlainObject(raw)) {
    mcpConfigError(`MCP server "${serverName}" ${field} must be an object of string values.`);
  }
  return recordToNameValues(raw, serverName, field);
}

function parseArgs(raw: unknown, serverName: string): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || !raw.every((item): item is string => typeof item === 'string')) {
    mcpConfigError(`MCP server "${serverName}" args must be an array of strings.`);
  }
  return [...raw];
}

function parseHttpUrl(raw: unknown, serverName: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    mcpConfigError(`MCP server "${serverName}" url must be an absolute http: or https: URL.`);
  }
  const url = raw.trim();
  try {
    const protocol = new URL(url).protocol;
    if (protocol === 'http:' || protocol === 'https:') return url;
  } catch {
    // Invalid absolute URL — reject below with the protocol constraint.
  }
  mcpConfigError(`MCP server "${serverName}" url must be an absolute http: or https: URL.`);
}

function resolveStdioCommand(
  rawCommand: unknown,
  serverName: string,
  env: Record<string, string>
): string {
  if (typeof rawCommand !== 'string' || rawCommand.trim().length === 0) {
    mcpConfigError(`MCP server "${serverName}" requires a non-empty command.`);
  }
  const command = rawCommand.trim();
  if (isAbsolute(command)) {
    if (!isUsableExecutable(command)) {
      mcpConfigError(`MCP server "${serverName}" command "${command}" is not a usable executable.`);
    }
    return command;
  }

  const resolved = resolveBareCommand(command, env);
  if (resolved === undefined || !isUsableExecutable(resolved)) {
    mcpConfigError(`MCP server "${serverName}" command "${command}" was not found on PATH.`);
  }
  return resolved;
}

function convertServer(name: string, raw: unknown, env: Record<string, string>): McpServer {
  if (name.trim().length === 0) {
    mcpConfigError('MCP server name must be a non-empty string.');
  }
  if (!isPlainObject(raw)) {
    mcpConfigError(`MCP server "${name}" must be a JSON object (got ${describeJsonType(raw)}).`);
  }

  const type = raw.type === undefined ? 'stdio' : raw.type;
  if (typeof type !== 'string') {
    mcpConfigError(
      `MCP server "${name}" has unsupported transport ${JSON.stringify(type)}. ` +
        'Pinned DSH ACP supports only stdio and Streamable HTTP.'
    );
  }

  if (type === 'sse') {
    mcpConfigError(
      `MCP server "${name}" uses SSE. Pinned DSH ACP supports only stdio and Streamable HTTP.`
    );
  }

  if (type === 'http') {
    return {
      type: 'http',
      name,
      url: parseHttpUrl(raw.url, name),
      headers: parseStringMap(raw.headers, name, 'headers'),
    };
  }

  if (type !== 'stdio') {
    mcpConfigError(
      `MCP server "${name}" has unsupported transport "${type}". ` +
        'Pinned DSH ACP supports only stdio and Streamable HTTP.'
    );
  }

  return {
    name,
    command: resolveStdioCommand(raw.command, name, env),
    args: parseArgs(raw.args, name),
    env: parseStringMap(raw.env, name, 'env'),
  };
}

/**
 * Convert Archon MCP server maps into ACP declarations accepted by pinned DSH.
 * Does not mutate `servers`.
 */
export function buildDeepseekMcpServers(
  servers: Record<string, unknown>,
  env: Record<string, string>
): McpServer[] {
  return Object.entries(servers).map(([name, raw]) => convertServer(name, raw, env));
}
