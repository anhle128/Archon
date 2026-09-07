import { describe, expect, test } from 'bun:test';

import { buildDockerClientEnv, buildHostTerminalEnv } from './env';

const source = {
  HOME: '/Users/operator',
  USER: 'operator',
  PATH: '/usr/local/bin:/usr/bin:/bin',
  LANG: 'en_US.UTF-8',
  DOCKER_HOST: 'unix:///tmp/docker.sock',
  DATABASE_URL: 'postgres://secret',
  TOKEN_ENCRYPTION_KEY: 'secret',
  BETTER_AUTH_SECRET: 'secret',
  SLACK_BOT_TOKEN: 'secret',
  ANTHROPIC_API_KEY: 'secret',
  SSH_AUTH_SOCK: '/tmp/agent.sock',
  UNRELATED_SECRET: 'secret',
};

describe('terminal environments', () => {
  test('host shell receives basics and fixed terminal values only', () => {
    expect(buildHostTerminalEnv(source)).toEqual({
      HOME: '/Users/operator',
      USER: 'operator',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    });
  });

  test('Docker client additionally receives only Docker connection settings', () => {
    expect(buildDockerClientEnv(source)).toEqual({
      HOME: '/Users/operator',
      USER: 'operator',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      LANG: 'en_US.UTF-8',
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      DOCKER_HOST: 'unix:///tmp/docker.sock',
    });
  });
});
