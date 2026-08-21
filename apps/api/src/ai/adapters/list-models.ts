import { BadRequestException } from '@nestjs/common';
import { getAiVendor, type AiVendorId } from '../ai-providers';

export type ListAiModelsResult = {
  models: string[];
  live: boolean;
  warning?: string;
};

export function isEmbeddingModelId(id: string): boolean {
  const s = id.toLowerCase();
  return (
    s.includes('embed') ||
    s.includes('e5-') ||
    s.includes('bge-') ||
    s.includes('nomic') ||
    s.includes('voyage') ||
    s.includes('minilm') ||
    s.includes('mpnet') ||
    s.includes('text-embedding')
  );
}

/** Gemini list returns `models/gemini-…`; generateContent expects bare id. */
export function normalizeGeminiModelId(name: string): string {
  return name.replace(/^models\//, '').trim();
}

function presetsFor(provider: string): string[] {
  return getAiVendor(provider)?.models?.slice() ?? [];
}

async function listOpenAiCompatible(
  provider: AiVendorId,
  apiKey: string,
): Promise<string[]> {
  const vendor = getAiVendor(provider);
  const baseUrl = (vendor?.baseUrl ?? 'https://api.openai.com/v1').replace(
    /\/$/,
    '',
  );
  const res = await fetch(`${baseUrl}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });
  const raw = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg =
      raw.error?.message ||
      `No se pudo listar modelos (${provider} HTTP ${res.status})`;
    if (res.status === 401 || res.status === 403) {
      throw new BadRequestException(msg);
    }
    throw new Error(msg);
  }
  const ids = (raw.data ?? [])
    .map((m) => String(m.id ?? '').trim())
    .filter((id) => id && !isEmbeddingModelId(id));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

async function listAnthropic(apiKey: string): Promise<string[]> {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
    },
  });
  const raw = (await res.json().catch(() => ({}))) as {
    data?: Array<{ id?: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg =
      raw.error?.message ||
      `No se pudo listar modelos (Anthropic HTTP ${res.status})`;
    if (res.status === 401 || res.status === 403) {
      throw new BadRequestException(msg);
    }
    throw new Error(msg);
  }
  const ids = (raw.data ?? [])
    .map((m) => String(m.id ?? '').trim())
    .filter(Boolean);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

async function listGemini(apiKey: string): Promise<string[]> {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models?key=' +
    encodeURIComponent(apiKey);
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const raw = (await res.json().catch(() => ({}))) as {
    models?: Array<{
      name?: string;
      supportedGenerationMethods?: string[];
    }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg =
      raw.error?.message ||
      `No se pudo listar modelos (Gemini HTTP ${res.status})`;
    if (res.status === 401 || res.status === 403) {
      throw new BadRequestException(msg);
    }
    throw new Error(msg);
  }
  const ids = (raw.models ?? [])
    .filter((m) =>
      (m.supportedGenerationMethods ?? []).includes('generateContent'),
    )
    .map((m) => normalizeGeminiModelId(String(m.name ?? '')))
    .filter((id) => id && !isEmbeddingModelId(id));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/**
 * Lista modelos chat del proveedor con la API key.
 * Si falla la llamada live, devuelve presets del catálogo + warning (no lanza).
 * Si la key es inválida (4xx), lanza BadRequestException.
 */
export async function listAiModels(
  provider: string,
  apiKey: string,
): Promise<ListAiModelsResult> {
  const key = apiKey.trim();
  if (!key) {
    throw new BadRequestException('Indica una API key para listar modelos');
  }
  const presets = presetsFor(provider);

  try {
    let models: string[];
    switch (provider) {
      case 'openai':
      case 'grok':
      case 'deepseek':
      case 'latinrouter':
        models = await listOpenAiCompatible(provider, key);
        break;
      case 'anthropic':
        models = await listAnthropic(key);
        break;
      case 'gemini':
        models = await listGemini(key);
        break;
      default:
        throw new BadRequestException(`Proveedor no soportado: ${provider}`);
    }
    if (models.length === 0) {
      return {
        models: presets,
        live: false,
        warning: 'El proveedor no devolvió modelos; usando lista sugerida',
      };
    }
    return { models, live: true };
  } catch (err) {
    if (err instanceof BadRequestException) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      models: presets,
      live: false,
      warning: message || 'No se pudo contactar al proveedor',
    };
  }
}
