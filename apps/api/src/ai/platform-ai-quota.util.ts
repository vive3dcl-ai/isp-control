export type QuotaCounts = {
  requestsUsed: number;
  requestsLimit: number;
  tokensUsed: number;
  tokensLimit: number;
};

export function utcUsageDate(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function quotaBlockReason(
  snap: QuotaCounts,
  estimatedTokens = 0,
): string | null {
  if (snap.requestsUsed >= snap.requestsLimit) {
    return `Cupo diario de consultas IA agotado (${snap.requestsUsed}/${snap.requestsLimit})`;
  }
  if (snap.tokensUsed >= snap.tokensLimit) {
    return `Cupo diario de tokens IA agotado (${snap.tokensUsed}/${snap.tokensLimit})`;
  }
  if (
    estimatedTokens > 0 &&
    snap.tokensUsed + estimatedTokens > snap.tokensLimit
  ) {
    return `Cupo diario de tokens IA insuficiente (${snap.tokensUsed}/${snap.tokensLimit})`;
  }
  return null;
}

export function redactAiConfig<T extends { apiKey?: string }>(
  cfg: T,
): T & { hasApiKey: boolean; apiKey: string } {
  return {
    ...cfg,
    hasApiKey: !!cfg.apiKey?.trim(),
    apiKey: '',
  };
}
