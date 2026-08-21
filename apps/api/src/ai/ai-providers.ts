/**
 * Catálogo de proveedores IA (tenant own + plataforma internal).
 * `internal` es un modo de facturación/cupo, no un vendor HTTP.
 */

export type AiVendorId =
  | 'openai'
  | 'anthropic'
  | 'grok'
  | 'gemini'
  | 'deepseek'
  | 'latinrouter';

export type AiProviderOption = {
  id: AiVendorId;
  label: string;
  /** Base URL OpenAI-compatible cuando aplica. */
  baseUrl?: string;
  models: string[];
  defaultModel: string;
};

export const AI_VENDORS: AiProviderOption[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'],
    defaultModel: 'gpt-4.1-mini',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: [
      'claude-sonnet-4-20250514',
      'claude-3-5-haiku-latest',
      'claude-3-5-sonnet-latest',
    ],
    defaultModel: 'claude-sonnet-4-20250514',
  },
  {
    id: 'grok',
    label: 'Grok (xAI)',
    baseUrl: 'https://api.x.ai/v1',
    models: ['grok-3', 'grok-3-mini', 'grok-2-latest'],
    defaultModel: 'grok-3-mini',
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-pro'],
    defaultModel: 'gemini-2.0-flash',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    defaultModel: 'deepseek-chat',
  },
  {
    // OpenAI-compatible (mismo patrón que mcp_memory / OpenClaw).
    id: 'latinrouter',
    label: 'LatinRouter',
    baseUrl: 'https://llm.latinrouter.ai/v1',
    models: [
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4.1-mini',
      'claude-sonnet-4-20250514',
      'gemini-2.0-flash',
    ],
    defaultModel: 'gpt-4o-mini',
  },
];

export function getAiVendor(id: string): AiProviderOption | undefined {
  return AI_VENDORS.find((v) => v.id === id);
}

export function isAiVendorId(id: string): id is AiVendorId {
  return AI_VENDORS.some((v) => v.id === id);
}
