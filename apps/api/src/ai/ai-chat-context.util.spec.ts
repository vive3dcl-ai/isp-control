import {
  estimateHistoryTokens,
  looksLikeMultiStepGoal,
  parseMovePlan,
  shouldCompactChatHistory,
  splitHistoryForCompact,
  AI_CHAT_KEEP_RECENT,
} from './ai-chat-context.util';
import { resolveModelContextWindow } from './ai-model-context';

describe('ai-chat-context.util (model budget)', () => {
  it('compacts by model window at ~50%', () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'x'.repeat(800),
    }));
    const budget = {
      contextWindow: resolveModelContextWindow('gpt-4o-mini'),
      reservedTokens: 2_000,
    };
    // Not enough yet for 128k*0.5
    expect(shouldCompactChatHistory(messages.slice(0, 2), budget)).toBe(false);

    const fat = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: 'palabra '.repeat(2_000),
    }));
    const smallBudget = {
      contextWindow: 32_000,
      reservedTokens: 2_000,
    };
    expect(shouldCompactChatHistory(fat, smallBudget)).toBe(true);
    const { older, recent } = splitHistoryForCompact(fat, smallBudget);
    expect(recent.length).toBeGreaterThan(0);
    expect(older.length).toBeGreaterThan(0);
    expect(recent.length + older.length).toBe(fat.length);
  });

  it('keeps recent by default count without budget', () => {
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `m${i}`,
    }));
    const { recent } = splitHistoryForCompact(messages);
    expect(recent).toHaveLength(AI_CHAT_KEEP_RECENT);
  });

  it('estimates tokens', () => {
    expect(
      estimateHistoryTokens([{ role: 'user', content: 'abcd' }]),
    ).toBeGreaterThan(0);
  });

  it('detects multi-step goals', () => {
    expect(
      looksLikeMultiStepGoal(
        'Buscá a Juan, unificá duplicados y abrí la ficha',
      ),
    ).toBe(true);
    expect(looksLikeMultiStepGoal('hola')).toBe(false);
  });

  it('parses move plans', () => {
    const plan = parseMovePlan(
      '```json\n{"goal":"x","steps":[{"tool":"crm_search_clients","why":"buscar"}]}\n```',
    );
    expect(plan?.steps[0].tool).toBe('crm_search_clients');
  });
});
