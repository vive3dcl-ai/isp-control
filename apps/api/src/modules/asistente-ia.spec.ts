import {
  isAsistenteIaConfigured,
  EMPTY_ASISTENTE_IA_CONFIG,
  type AsistenteIaModuleConfig,
} from './module-catalog';
import {
  quotaBlockReason,
  redactAiConfig,
  utcUsageDate,
} from '../ai/platform-ai-quota.util';
import { getAiVendor, isAiVendorId } from '../ai/ai-providers';
import {
  isEmbeddingModelId,
  normalizeGeminiModelId,
} from '../ai/adapters/list-models';

describe('asistente_ia config', () => {
  it('internal mode is configured without apiKey', () => {
    expect(
      isAsistenteIaConfigured({
        ...EMPTY_ASISTENTE_IA_CONFIG,
        mode: 'internal',
        apiKey: '',
      }),
    ).toBe(true);
  });

  it('own mode requires apiKey', () => {
    expect(
      isAsistenteIaConfigured({
        mode: 'own',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        apiKey: '',
        enabled: true,
      }),
    ).toBe(false);
    expect(
      isAsistenteIaConfigured({
        mode: 'own',
        provider: 'openai',
        model: 'gpt-4.1-mini',
        apiKey: 'sk-test',
        enabled: true,
      }),
    ).toBe(true);
  });

  it('disabled is never configured', () => {
    expect(
      isAsistenteIaConfigured({
        mode: 'internal',
        enabled: false,
      } as Partial<AsistenteIaModuleConfig>),
    ).toBe(false);
  });

  it('redactAiConfig never returns the secret', () => {
    const out = redactAiConfig({
      mode: 'own' as const,
      apiKey: 'sk-secret',
      model: 'x',
    });
    expect(out.apiKey).toBe('');
    expect(out.hasApiKey).toBe(true);
  });
});

describe('own vs internal resolution', () => {
  it('own keeps tenant provider; internal ignores tenant apiKey for configured()', () => {
    const own: AsistenteIaModuleConfig = {
      mode: 'own',
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-tenant',
      enabled: true,
    };
    const internal: AsistenteIaModuleConfig = {
      mode: 'internal',
      provider: 'openai',
      model: 'ignored-by-runtime',
      apiKey: '',
      enabled: true,
    };
    expect(isAsistenteIaConfigured(own)).toBe(true);
    expect(own.mode === 'own' && !!own.apiKey).toBe(true);
    expect(isAsistenteIaConfigured(internal)).toBe(true);
    expect(internal.mode === 'internal').toBe(true);
    // Solo mode=internal incrementa platform_ai_usage_daily (AiProviderRouter).
    expect(own.mode === 'internal').toBe(false);
    expect(internal.mode === 'internal').toBe(true);
  });
});

describe('platform AI quota util', () => {
  it('utcUsageDate is YYYY-MM-DD', () => {
    expect(utcUsageDate(new Date('2026-08-20T23:30:00.000Z'))).toBe(
      '2026-08-20',
    );
  });

  it('blocks when requests exhausted', () => {
    expect(
      quotaBlockReason({
        requestsUsed: 10,
        requestsLimit: 10,
        tokensUsed: 0,
        tokensLimit: 1000,
      }),
    ).toMatch(/consultas/);
  });

  it('blocks when tokens exhausted', () => {
    expect(
      quotaBlockReason({
        requestsUsed: 1,
        requestsLimit: 100,
        tokensUsed: 1000,
        tokensLimit: 1000,
      }),
    ).toMatch(/tokens/);
  });

  it('blocks when estimated tokens would exceed', () => {
    expect(
      quotaBlockReason(
        {
          requestsUsed: 1,
          requestsLimit: 100,
          tokensUsed: 900,
          tokensLimit: 1000,
        },
        200,
      ),
    ).toMatch(/insuficiente/);
  });

  it('allows when under limits', () => {
    expect(
      quotaBlockReason({
        requestsUsed: 1,
        requestsLimit: 100,
        tokensUsed: 10,
        tokensLimit: 1000,
      }),
    ).toBeNull();
  });
});

describe('latinrouter vendor', () => {
  it('is OpenAI-compatible at llm.latinrouter.ai', () => {
    expect(isAiVendorId('latinrouter')).toBe(true);
    const v = getAiVendor('latinrouter');
    expect(v?.baseUrl).toBe('https://llm.latinrouter.ai/v1');
    expect(v?.defaultModel).toBe('gpt-4o-mini');
  });
});

describe('list models helpers', () => {
  it('filters embedding model ids', () => {
    expect(isEmbeddingModelId('text-embedding-3-small')).toBe(true);
    expect(isEmbeddingModelId('gpt-4o-mini')).toBe(false);
  });

  it('strips Gemini models/ prefix', () => {
    expect(normalizeGeminiModelId('models/gemini-2.0-flash')).toBe(
      'gemini-2.0-flash',
    );
  });
});
