import { afterEach, describe, expect, test } from 'bun:test';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { DeepseekProviderError } from './errors';
import { buildDeepseekMcpServers } from './mcp';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function makeExecutable(name: string): Promise<{ path: string; pathEnv: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'archon-deepseek-mcp-'));
  tempDirs.push(dir);
  const path = join(dir, name);
  await writeFile(path, '#!/usr/bin/env sh\nexit 0\n');
  await chmod(path, 0o755);
  const pathEnv = `${dir}${delimiter}${process.env.PATH ?? '/usr/bin:/bin'}`;
  return { path, pathEnv };
}

function expectSubtype(fn: () => unknown, subtype: string): DeepseekProviderError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(DeepseekProviderError);
    const typed = error as DeepseekProviderError;
    expect(typed.subtype).toBe(subtype);
    return typed;
  }
  throw new Error(`expected DeepseekProviderError(${subtype})`);
}

describe('buildDeepseekMcpServers', () => {
  test('defaults omitted type to stdio', async () => {
    const { path, pathEnv } = await makeExecutable('server');
    expect(
      buildDeepseekMcpServers({ github: { command: path, args: ['--stdio'] } }, { PATH: pathEnv })
    ).toEqual([
      {
        name: 'github',
        command: path,
        args: ['--stdio'],
        env: [],
      },
    ]);
  });

  test('stdio requires a non-empty command and only string args and env', async () => {
    const { path, pathEnv } = await makeExecutable('server');
    const env = { PATH: pathEnv };

    const missing = expectSubtype(
      () => buildDeepseekMcpServers({ github: { args: ['--stdio'] } }, env),
      'deepseek_mcp_config_error'
    );
    expect(missing.message).toContain('github');

    const blank = expectSubtype(
      () => buildDeepseekMcpServers({ github: { command: '   ' } }, env),
      'deepseek_mcp_config_error'
    );
    expect(blank.message).toContain('github');

    const badArgs = expectSubtype(
      () => buildDeepseekMcpServers({ github: { command: path, args: [1] } }, env),
      'deepseek_mcp_config_error'
    );
    expect(badArgs.message).toContain('github');

    const badEnv = expectSubtype(
      () => buildDeepseekMcpServers({ github: { command: path, env: { TOKEN: 1 } } }, env),
      'deepseek_mcp_config_error'
    );
    expect(badEnv.message).toContain('github');
  });

  test('an absolute stdio command remains unchanged', async () => {
    const { path, pathEnv } = await makeExecutable('server');
    const [server] = buildDeepseekMcpServers(
      { tools: { type: 'stdio', command: path, args: [] } },
      { PATH: pathEnv }
    );
    expect(server).toEqual({
      name: 'tools',
      command: path,
      args: [],
      env: [],
    });
  });

  test('a bare command resolves to an absolute executable through PATH', async () => {
    const { path, pathEnv } = await makeExecutable('npx');
    const [server] = buildDeepseekMcpServers(
      { pkg: { command: 'npx', args: ['-y', 'demo'] } },
      { PATH: pathEnv }
    );
    expect(server).toEqual({
      name: 'pkg',
      command: path,
      args: ['-y', 'demo'],
      env: [],
    });
  });

  test('an unresolved bare command fails naming the server and command', () => {
    const error = expectSubtype(
      () =>
        buildDeepseekMcpServers(
          { github: { command: 'definitely-not-an-mcp-binary' } },
          { PATH: '/nonexistent-deepseek-mcp-path' }
        ),
      'deepseek_mcp_config_error'
    );
    expect(error.message).toContain('github');
    expect(error.message).toContain('definitely-not-an-mcp-binary');
  });

  test('formats stdio env as name/value pairs', async () => {
    const { path, pathEnv } = await makeExecutable('server');
    expect(
      buildDeepseekMcpServers(
        {
          github: {
            command: path,
            args: ['-y', '@modelcontextprotocol/server-github'],
            env: { GITHUB_PERSONAL_ACCESS_TOKEN: 'token-value' },
          },
        },
        { PATH: pathEnv }
      )
    ).toEqual([
      {
        name: 'github',
        command: path,
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: [{ name: 'GITHUB_PERSONAL_ACCESS_TOKEN', value: 'token-value' }],
      },
    ]);
  });

  test('validates HTTP transport URL and converts headers', () => {
    expect(
      buildDeepseekMcpServers(
        {
          api: {
            type: 'http',
            url: 'https://mcp.example.com/v1',
            headers: { Authorization: 'Bearer secret' },
          },
        },
        {}
      )
    ).toEqual([
      {
        type: 'http',
        name: 'api',
        url: 'https://mcp.example.com/v1',
        headers: [{ name: 'Authorization', value: 'Bearer secret' }],
      },
    ]);

    const relative = expectSubtype(
      () => buildDeepseekMcpServers({ api: { type: 'http', url: '/v1' } }, {}),
      'deepseek_mcp_config_error'
    );
    expect(relative.message).toContain('api');

    const fileUrl = expectSubtype(
      () => buildDeepseekMcpServers({ api: { type: 'http', url: 'file:///tmp/mcp' } }, {}),
      'deepseek_mcp_config_error'
    );
    expect(fileUrl.message).toContain('api');
  });

  test('rejects SSE with the pinned DSH ACP transport message', () => {
    const error = expectSubtype(
      () =>
        buildDeepseekMcpServers(
          {
            realtime: {
              type: 'sse',
              url: 'https://mcp.example.com/sse',
            },
          },
          {}
        ),
      'deepseek_mcp_config_error'
    );
    expect(error.message).toMatch(/pinned DSH ACP supports only stdio and Streamable HTTP/i);
  });

  test('rejects unknown transports, malformed objects, and blank names', async () => {
    const { path, pathEnv } = await makeExecutable('server');
    const env = { PATH: pathEnv };

    const unknown = expectSubtype(
      () => buildDeepseekMcpServers({ weird: { type: 'websocket', command: path } }, env),
      'deepseek_mcp_config_error'
    );
    expect(unknown.message).toContain('weird');

    expectSubtype(
      () => buildDeepseekMcpServers({ broken: ['npx'] }, env),
      'deepseek_mcp_config_error'
    );
    expectSubtype(
      () => buildDeepseekMcpServers({ broken: null }, env),
      'deepseek_mcp_config_error'
    );

    const malformedEnv = expectSubtype(
      () => buildDeepseekMcpServers({ github: { command: path, env: ['TOKEN'] } }, env),
      'deepseek_mcp_config_error'
    );
    expect(malformedEnv.message).toContain('github');

    const malformedHeaders = expectSubtype(
      () =>
        buildDeepseekMcpServers(
          { api: { type: 'http', url: 'https://mcp.example.com', headers: ['Authorization'] } },
          env
        ),
      'deepseek_mcp_config_error'
    );
    expect(malformedHeaders.message).toContain('api');

    const blank = expectSubtype(
      () => buildDeepseekMcpServers({ '': { command: path } }, env),
      'deepseek_mcp_config_error'
    );
    expect(blank.message.length).toBeGreaterThan(0);
  });

  test('does not mutate input objects', async () => {
    const { path, pathEnv } = await makeExecutable('server');
    const envMap = { TOKEN: 'secret' };
    const server = { command: path, args: ['--stdio'], env: envMap };
    const servers = { github: server };

    buildDeepseekMcpServers(servers, { PATH: pathEnv });

    expect(servers.github).toBe(server);
    expect(server).toEqual({ command: path, args: ['--stdio'], env: envMap });
    expect(envMap).toEqual({ TOKEN: 'secret' });
  });
});
