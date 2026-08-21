import { BadRequestException } from '@nestjs/common';
import type {
  AiCompletionRequest,
  AiCompletionResult,
} from '../ai-completion.types';
import { getAiVendor } from '../ai-providers';

type OpenAiChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: { message?: string };
};

/** OpenAI, Grok (xAI), DeepSeek y LatinRouter: API chat/completions compatible. */
export async function completeOpenAiCompatible(
  req: AiCompletionRequest,
): Promise<AiCompletionResult> {
  const vendor = getAiVendor(req.provider);
  const baseUrl = (vendor?.baseUrl ?? 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${req.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: req.model,
      messages: req.messages,
      max_tokens: req.maxTokens ?? 256,
      temperature: req.temperature ?? 0.2,
    }),
  });
  const raw = (await res.json().catch(() => ({}))) as OpenAiChatResponse;
  if (!res.ok) {
    throw new BadRequestException(
      raw.error?.message ||
        `Error ${req.provider} HTTP ${res.status}`,
    );
  }
  const text = raw.choices?.[0]?.message?.content?.trim() ?? '';
  if (!text) {
    throw new BadRequestException(`Respuesta vacía de ${req.provider}`);
  }
  const promptTokens = raw.usage?.prompt_tokens ?? 0;
  const completionTokens = raw.usage?.completion_tokens ?? 0;
  return {
    text,
    provider: req.provider,
    model: req.model,
    promptTokens,
    completionTokens,
    totalTokens:
      raw.usage?.total_tokens ?? promptTokens + completionTokens,
  };
}
