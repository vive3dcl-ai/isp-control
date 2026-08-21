import { BadRequestException } from '@nestjs/common';
import type {
  AiCompletionRequest,
  AiCompletionResult,
} from '../ai-completion.types';

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: { message?: string };
};

export async function completeGemini(
  req: AiCompletionRequest,
): Promise<AiCompletionResult> {
  const system = req.messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content)
    .join('\n')
    .trim();
  const contents = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(req.apiKey)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(system
        ? { systemInstruction: { parts: [{ text: system }] } }
        : {}),
      contents,
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? 256,
        temperature: req.temperature ?? 0.2,
      },
    }),
  });
  const raw = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    throw new BadRequestException(
      raw.error?.message || `Error Gemini HTTP ${res.status}`,
    );
  }
  const text =
    raw.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? '')
      .join('')
      .trim() ?? '';
  if (!text) {
    throw new BadRequestException('Respuesta vacía de Gemini');
  }
  const promptTokens = raw.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = raw.usageMetadata?.candidatesTokenCount ?? 0;
  return {
    text,
    provider: 'gemini',
    model: req.model,
    promptTokens,
    completionTokens,
    totalTokens:
      raw.usageMetadata?.totalTokenCount ??
      promptTokens + completionTokens,
  };
}
