import { describe, expect, it } from 'vitest';
import { localPromptDefinitions, validatePrompt } from './local-prompt-config';
describe('editable local prompt contracts', () => {
  it('accepts all initial templates and token limits', () => { for (const spec of localPromptDefinitions) expect(validatePrompt(spec.key, spec.template, spec.maxTokens)).toBeNull(); });
  it('rejects missing or injected variables and damaged JSON output contracts', () => {
    const spec = localPromptDefinitions.find((s) => s.key === 'capture')!;
    expect(validatePrompt('capture', spec.template.replace('{{input}}', ''), 320)).toBe('REQUIRED_VARIABLE_MISSING');
    expect(validatePrompt('capture', spec.template + '{{secret}}', 320)).toBe('UNKNOWN_VARIABLE');
    expect(validatePrompt('capture', spec.template.replace('"rawText"', 'rawText'), 320)).toBe('OUTPUT_FIELDS_MISSING');
  });
  it('bounds editable content and output tokens', () => {
    expect(validatePrompt('capture', 'x'.repeat(4001), 320)).toBe('TEMPLATE_LENGTH_INVALID');
    expect(validatePrompt('capture', '{{input}}', 99999)).toBe('MAX_TOKENS_INVALID');
    expect(validatePrompt('capture', '{{input}}', 256.5)).toBe('MAX_TOKENS_INVALID');
  });
});
