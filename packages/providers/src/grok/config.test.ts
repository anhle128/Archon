import { describe, expect, test } from 'bun:test';

import { parseGrokConfig } from './config';

describe('parseGrokConfig', () => {
  test('parses supported defaults and ignores unknown fields', () => {
    expect(
      parseGrokConfig({
        model: 'grok-build',
        modelReasoningEffort: 'xhigh',
        grokBinaryPath: ' /opt/grok/bin/grok ',
        permissionMode: 'acceptEdits',
        ignored: true,
      })
    ).toEqual({
      model: 'grok-build',
      modelReasoningEffort: 'xhigh',
      grokBinaryPath: '/opt/grok/bin/grok',
      permissionMode: 'acceptEdits',
    });
  });

  test('rejects malformed supported fields', () => {
    expect(() => parseGrokConfig({ model: '  ' })).toThrow('assistants.grok.model');
    expect(() => parseGrokConfig({ modelReasoningEffort: '' })).toThrow('non-empty string');
    expect(() => parseGrokConfig({ grokBinaryPath: 42 })).toThrow('assistants.grok.grokBinaryPath');
    expect(() => parseGrokConfig({ permissionMode: 'unsafe' })).toThrow(
      'assistants.grok.permissionMode'
    );
  });
});
