import { resolveModelContextWindow, estimateTokensFromText } from './ai-model-context';

describe('ai-model-context', () => {
  it('resolves known models', () => {
    expect(resolveModelContextWindow('gpt-4o-mini')).toBe(128_000);
    expect(resolveModelContextWindow('claude-sonnet-4-20250514')).toBe(200_000);
    expect(resolveModelContextWindow('gemini-2.0-flash')).toBe(1_000_000);
  });

  it('falls back for unknown', () => {
    expect(resolveModelContextWindow('weird-model-xyz')).toBe(128_000);
  });

  it('estimates tokens', () => {
    expect(estimateTokensFromText('abcd')).toBe(1);
    expect(estimateTokensFromText('a'.repeat(8))).toBe(2);
  });
});
