/**
 * Ventanas de contexto conocidas (tokens de entrada aproximados).
 * Los vendors de chat no auto-comprimen el historial: lo hacemos nosotros
 * al ~50% de esta ventana (estilo Hermes/OpenCode).
 */

const DEFAULT_CONTEXT_WINDOW = 128_000;

/** id substring (lowercase) → tokens de contexto */
const MODEL_CONTEXT_WINDOWS: Array<{ match: string; tokens: number }> = [
  // OpenAI / LatinRouter
  { match: 'gpt-4.1-mini', tokens: 1_000_000 },
  { match: 'gpt-4.1', tokens: 1_000_000 },
  { match: 'gpt-4o-mini', tokens: 128_000 },
  { match: 'gpt-4o', tokens: 128_000 },
  { match: 'o4-mini', tokens: 200_000 },
  { match: 'o3-mini', tokens: 200_000 },
  { match: 'o1', tokens: 200_000 },
  // Anthropic
  { match: 'claude-sonnet-4', tokens: 200_000 },
  { match: 'claude-opus-4', tokens: 200_000 },
  { match: 'claude-3-5-sonnet', tokens: 200_000 },
  { match: 'claude-3-5-haiku', tokens: 200_000 },
  { match: 'claude-3-opus', tokens: 200_000 },
  { match: 'claude-3-haiku', tokens: 200_000 },
  // Google
  { match: 'gemini-2.0-flash', tokens: 1_000_000 },
  { match: 'gemini-1.5-pro', tokens: 1_000_000 },
  { match: 'gemini-1.5-flash', tokens: 1_000_000 },
  // xAI
  { match: 'grok-3', tokens: 131_072 },
  { match: 'grok-2', tokens: 131_072 },
  // DeepSeek
  { match: 'deepseek-reasoner', tokens: 128_000 },
  { match: 'deepseek-chat', tokens: 128_000 },
];

export function resolveModelContextWindow(model: string): number {
  const id = (model ?? '').trim().toLowerCase();
  if (!id) return DEFAULT_CONTEXT_WINDOW;
  for (const row of MODEL_CONTEXT_WINDOWS) {
    if (id.includes(row.match)) return row.tokens;
  }
  return DEFAULT_CONTEXT_WINDOW;
}

export function getDefaultContextWindow(): number {
  return DEFAULT_CONTEXT_WINDOW;
}

/** Estimación rough estilo Hermes: ~4 chars ≈ 1 token. */
export function estimateTokensFromText(text: string): number {
  const n = (text ?? '').length;
  return Math.max(1, Math.ceil(n / 4));
}

export function estimateMessagesTokens(
  messages: Array<{ role?: string; content?: string }>,
): number {
  let total = 0;
  for (const m of messages) {
    total += 4; // role overhead
    total += estimateTokensFromText(m.content ?? '');
  }
  return total;
}
