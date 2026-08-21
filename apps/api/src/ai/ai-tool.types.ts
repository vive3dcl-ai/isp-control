export type AiActivityKind = 'tool' | 'skill' | 'plan';

export type AiActivityStatus = 'running' | 'done' | 'error';

export type AiChatActivity = {
  id: string;
  kind: AiActivityKind;
  slug: string;
  name: string;
  status: AiActivityStatus;
  detail?: string;
  /** True si la tool modifica estado (escritura). */
  mutates?: boolean;
  at: string;
};

/** Vista emergente del chat (panel lateral en el frontend). */
export type AiUiViewMode = 'summary' | 'full';

export type AiUiView =
  | { kind: 'close' }
  | {
      kind: 'client';
      clientId: string;
      title?: string;
      mode?: AiUiViewMode;
    }
  | {
      kind: 'onu';
      onuId?: string;
      oltId: string;
      onuIf: string;
      title?: string;
      mode?: AiUiViewMode;
    }
  | {
      kind: 'service';
      serviceId: string;
      clientId?: string;
      title?: string;
      mode?: AiUiViewMode;
    }
  | {
      kind: 'device';
      deviceId: string;
      title?: string;
      mode?: AiUiViewMode;
    };

export type AiMovePlanStep = {
  tool: string;
  argsHint?: string;
  why?: string;
};

export type AiChatStreamEvent =
  | { type: 'activity'; activity: AiChatActivity }
  | { type: 'ui'; view: AiUiView }
  | {
      type: 'plan';
      goal: string;
      steps: AiMovePlanStep[];
      doneWhen?: string;
    }
  | {
      type: 'context';
      summary: string;
      keptFromEnd: number;
      compacted: true;
      contextWindow?: number;
      estimatedTokens?: number;
    }
  | {
      type: 'reply';
      reply: string;
      provider: string;
      model: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      billedInternal: boolean;
      activities: AiChatActivity[];
      readOnly: boolean;
      restorePoints: boolean;
      sessionId: string | null;
      /** Resumen acumulado del historial compactado (Hermes-style). */
      contextSummary: string | null;
      contextCompacted: boolean;
      /** Cuántos mensajes del historial de entrada se conservaron al final. */
      keptFromEnd: number | null;
      contextWindow?: number | null;
      plan?: {
        goal: string;
        steps: AiMovePlanStep[];
        doneWhen?: string;
      } | null;
    }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type AiToolHandlerResult = {
  ok: boolean;
  /** Texto corto para la UI de actividad */
  summary: string;
  /** Payload compacto para el modelo */
  data: unknown;
  /** Si está presente, el frontend abre/cierra el panel lateral */
  ui?: AiUiView | null;
};

export type AiToolExecContext = {
  user: import('../auth/auth.types').AuthUser;
  schemaName: string;
  tenantId: string;
  readOnly: boolean;
  restorePoints: boolean;
  sessionId?: string;
};
