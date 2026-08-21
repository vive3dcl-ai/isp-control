import { BadRequestException } from '@nestjs/common';
import type {
  AiCompletionRequest,
  AiCompletionResult,
} from '../ai-completion.types';

type AnthropicResponse = {
  content?: Array<{ type?: string; text?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
};

export async function completeAnthropic(
  req: AiCompletionRequest,
): Promise<AiCompletionResult> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')
    .trim();
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: m.content,
    }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': req.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model,
      max_tokens: req.maxTokens ?? 256,
      temperature: req.temperature ?? 0.2,
      ...(system ? { system } : {}),
      messages,
    }),
  });
  const raw = (await res.json().catch(() => ({}))) as AnthropicResponse;
  if (!res.ok) {
    throw new BadRequestException(
      raw.error?.message || `Error Anthropic HTTP ${res.status}`,
    );
  }
  const text =
    raw.content
      ?.filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text!)
      .join('')
      .trim() ?? '';
  if (!text) {
    throw new BadRequestException('Respuesta vacía de Anthropic');
  }
  const promptTokens = raw.usage?.input_tokens ?? 0;
  const completionTokens = raw.usage?.output_tokens ?? 0;
  return {
    text,
    provider: 'anthropic',
    model: req.model,
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}
