import {
  estimateMessagesTokens,
  estimateTokensFromText,
} from './ai-model-context';

/** Fallback si no hay ventana de modelo. */
export const AI_CHAT_KEEP_RECENT = 12;
export const AI_CHAT_COMPACT_MIN_MESSAGES = 18;
export const AI_CHAT_SUMMARY_MAX_CHARS = 2_400;

/** Hermes: comprimir al 50% de la ventana del modelo. */
export const AI_CONTEXT_COMPRESS_RATIO = 0.5;
/** Cola protegida ~20% del umbral (turnos recientes). */
export const AI_CONTEXT_TAIL_RATIO = 0.2;

export type ChatTurn = { role: 'user' | 'assistant'; content: string };

export type CompactBudget = {
  contextWindow: number;
  /** Tokens ya reservados (system + tools catalog + summary). */
  reservedTokens?: number;
  /** Ratio del context window que dispara compactación (default 0.5). */
  compressRatio?: number;
};

export function estimateChatChars(messages: ChatTurn[]): number {
  return messages.reduce((n, m) => n + (m.content?.length ?? 0) + 16, 0);
}

export function estimateHistoryTokens(
  messages: ChatTurn[],
  extraText = '',
): number {
  return (
    estimateMessagesTokens(messages) + estimateTokensFromText(extraText)
  );
}

/**
 * Compactar cuando el historial supera el umbral del modelo
 * (o fallback por cantidad de mensajes).
 */
export function shouldCompactChatHistory(
  messages: ChatTurn[],
  budget?: CompactBudget,
): boolean {
  if (messages.length <= 4) return false;

  if (budget?.contextWindow) {
    const ratio = budget.compressRatio ?? AI_CONTEXT_COMPRESS_RATIO;
    const threshold = Math.floor(budget.contextWindow * ratio);
    const used =
      estimateHistoryTokens(messages) + (budget.reservedTokens ?? 0);
    return used >= threshold;
  }

  if (messages.length >= AI_CHAT_COMPACT_MIN_MESSAGES) return true;
  return false;
}

/**
 * Parte el historial dejando una cola por presupuesto de tokens
 * (o por cantidad fija si no hay budget).
 */
export function splitHistoryForCompact(
  messages: ChatTurn[],
  budget?: CompactBudget,
): {
  older: ChatTurn[];
  recent: ChatTurn[];
} {
  if (messages.length <= 2) {
    return { older: [], recent: messages };
  }

  if (budget?.contextWindow) {
    const ratio = budget.compressRatio ?? AI_CONTEXT_COMPRESS_RATIO;
    const threshold = Math.floor(budget.contextWindow * ratio);
    const tailBudget = Math.max(
      2_000,
      Math.floor(threshold * AI_CONTEXT_TAIL_RATIO),
    );
    let used = 0;
    const recent: ChatTurn[] = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const t = estimateTokensFromText(messages[i].content) + 4;
      if (recent.length >= 2 && used + t > tailBudget) break;
      recent.unshift(messages[i]);
      used += t;
    }
    // Siempre conservar al menos el último user
    if (recent.length === 0) {
      return { older: messages.slice(0, -1), recent: messages.slice(-1) };
    }
    const cut = messages.length - recent.length;
    return { older: messages.slice(0, cut), recent };
  }

  if (messages.length <= AI_CHAT_KEEP_RECENT) {
    return { older: [], recent: messages };
  }
  return {
    older: messages.slice(0, -AI_CHAT_KEEP_RECENT),
    recent: messages.slice(-AI_CHAT_KEEP_RECENT),
  };
}

export function formatTurnsForSummary(messages: ChatTurn[]): string {
  return messages
    .map((m) => {
      const label = m.role === 'user' ? 'Usuario' : 'Asistente';
      const body = (m.content ?? '').trim().slice(0, 900);
      return `${label}: ${body}`;
    })
    .join('\n\n');
}

export function buildContextSummaryPrompt(input: {
  previousSummary?: string;
  olderTurns: ChatTurn[];
}): Array<{ role: 'system' | 'user'; content: string }> {
  const prev = (input.previousSummary ?? '').trim();
  const older = formatTurnsForSummary(input.olderTurns);
  return [
    {
      role: 'system',
      content: `Resumí el historial de un asistente de operaciones ISP (CRM, ONU, topología, MikroTik).
Plantilla obligatoria (estilo OpenCode/Hermes):
## Objetivo
## Hecho
## Pendiente
## IDs / datos clave (UUIDs, seriales, equipos, VLANs)
## Decisiones
Conservá hechos útiles. Omití saludos y relleno.
Máximo ${AI_CHAT_SUMMARY_MAX_CHARS} caracteres. Español.`,
    },
    {
      role: 'user',
      content: `${
        prev
          ? `Resumen previo (PRESERVAR lo útil y ACTUALIZAR):\n${prev.slice(0, AI_CHAT_SUMMARY_MAX_CHARS)}\n\n`
          : ''
      }Turnos a compactar:\n${older}\n\nEscribe solo el resumen actualizado con la plantilla.`,
    },
  ];
}

/** ¿El pedido del usuario parece multi-paso y conviene planificar? */
export function looksLikeMultiStepGoal(text: string): boolean {
  const t = (text ?? '').trim();
  if (t.length >= 120) return true;
  if (
    /\b(y luego|después|despues|también|tambien|además|ademas|primero|segundo|finalmente)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    /\b(buscar|abrir|crear|aplicar|verificar|unificar|merge|revisar).{0,60}\b(y|luego|después|despues)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  const commas = (t.match(/,/g) ?? []).length;
  const ands = (t.match(/\by\b/gi) ?? []).length;
  if (commas + ands >= 2) return true;
  // Varios verbos de acción ISP
  const verbs =
    t.match(
      /\b(busc\w*|abr\w*|cre\w*|aplic\w*|verific\w*|unific\w*|merge\w*|revis\w*|list\w*|consult\w*)\b/gi,
    ) ?? [];
  return verbs.length >= 2;
}

export function buildMovePlanPrompt(input: {
  goal: string;
  toolsBlock: string;
  readOnly: boolean;
}): Array<{ role: 'system' | 'user'; content: string }> {
  return [
    {
      role: 'system',
      content: `Sos el planificador de un agente ISP. NO ejecutes nada: solo planificá movimientos (tools).
Respondé ÚNICAMENTE JSON válido:
{"goal":"…","steps":[{"tool":"slug_tool","argsHint":"…","why":"…"}],"doneWhen":"…"}
Reglas:
- Máximo 8 steps.
- Solo tools del catálogo.
- ${input.readOnly ? 'Solo lectura: no planifiques writes.' : 'Writes solo si el usuario lo pidió.'}
- Preferí cadena concreta: buscar → detalle → acción → ui_open_view si aplica.
- Sin prosa fuera del JSON.`,
    },
    {
      role: 'user',
      content: `OBJETIVO:\n${input.goal.slice(0, 1200)}\n\nTOOLS:\n${input.toolsBlock.slice(0, 6000)}`,
    },
  ];
}

export type MovePlan = {
  goal: string;
  steps: Array<{ tool: string; argsHint?: string; why?: string }>;
  doneWhen?: string;
};

export function parseMovePlan(text: string): MovePlan | null {
  const raw = (text ?? '').trim();
  if (!raw) return null;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence?.[1] ?? raw).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as {
      goal?: unknown;
      steps?: unknown;
      doneWhen?: unknown;
    };
    const stepsRaw = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps = stepsRaw
      .map((s) => {
        if (!s || typeof s !== 'object') return null;
        const row = s as Record<string, unknown>;
        const tool = String(row.tool ?? row.name ?? '').trim();
        if (!tool) return null;
        return {
          tool,
          argsHint:
            row.argsHint != null ? String(row.argsHint).slice(0, 200) : undefined,
          why: row.why != null ? String(row.why).slice(0, 200) : undefined,
        };
      })
      .filter(Boolean) as MovePlan['steps'];
    if (steps.length === 0) return null;
    return {
      goal: String(parsed.goal ?? '').trim() || 'Objetivo del usuario',
      steps: steps.slice(0, 8),
      doneWhen:
        parsed.doneWhen != null
          ? String(parsed.doneWhen).slice(0, 300)
          : undefined,
    };
  } catch {
    return null;
  }
}

export function formatMovePlanForPrompt(plan: MovePlan): string {
  const lines = plan.steps.map(
    (s, i) =>
      `${i + 1}. \`${s.tool}\`${s.argsHint ? ` (${s.argsHint})` : ''}${
        s.why ? ` — ${s.why}` : ''
      }`,
  );
  return `## PLAN de movimientos (seguir en orden; adaptar si TOOL_RESULT lo exige)
Objetivo: ${plan.goal}
Pasos:
${lines.join('\n')}
${plan.doneWhen ? `Listo cuando: ${plan.doneWhen}` : ''}
Ejecutá el siguiente paso YA con un bloque \`\`\`tool. No re-planifiques en prosa.`;
}
