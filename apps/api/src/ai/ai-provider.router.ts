import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import type { AuthUser } from '../auth/auth.types';
import { Tenant } from '../tenants/entities/tenant.entity';
import { TenantConnectionService } from '../database/tenant-connection.service';
import {
  EMPTY_ASISTENTE_IA_CONFIG,
  type AsistenteIaModuleConfig,
} from '../modules/module-catalog';
import { completeAnthropic } from './adapters/anthropic';
import { completeGemini } from './adapters/gemini';
import { completeOpenAiCompatible } from './adapters/openai-compatible';
import type {
  AiChatMessage,
  AiCompletionResult,
} from './ai-completion.types';
import { getAiVendor, isAiVendorId } from './ai-providers';
import { PlatformAiQuotaService } from './platform-ai-quota.service';
import { PlatformAiSettingsService } from './platform-ai-settings.service';
import { PlatformAiCapabilitiesService } from './platform-ai-capabilities.service';
import { AiToolsService } from './ai-tools.service';
import { parseAgentAction, looksLikeToolRefusal, looksLikeDeferredToolIntent, looksLikeIncompleteAgentTurn, toolCallSignature } from './ai-tool-protocol';
import {
  AI_CHAT_KEEP_RECENT,
  AI_CHAT_SUMMARY_MAX_CHARS,
  buildContextSummaryPrompt,
  buildMovePlanPrompt,
  formatMovePlanForPrompt,
  looksLikeMultiStepGoal,
  parseMovePlan,
  shouldCompactChatHistory,
  splitHistoryForCompact,
  estimateHistoryTokens,
  type MovePlan,
} from './ai-chat-context.util';
import {
  estimateTokensFromText,
  resolveModelContextWindow,
} from './ai-model-context';
import type {
  AiChatActivity,
  AiChatStreamEvent,
} from './ai-tool.types';

/** Prompt base del agente. */
export const ASISTENTE_SYSTEM_PROMPT = `Eres el Asistente de ISP Control, el agente de operaciones para ISPs en esta plataforma.

Tienes acceso TOTAL al tenant del usuario: CRM, topología, VPN, ONUs y verificación en vivo.
Las tools que hablan con OLT/router usan automáticamente la VPN/mgmt del tenant.

## Tools SIEMPRE activas (crítico)
- En ESTE entorno las tools del catálogo están SIEMPRE operativas. El sistema las ejecuta de verdad.
- NUNCA digas que no tienes tools, que no están habilitadas, que «el entorno no permite» o que «si estuvieran activas…».
- NUNCA pidas al usuario datos que ya puedes obtener con una tool (ID, teléfono, etc.) si puedes buscarlos o ya te los dio.
- Si el usuario pasa un clientId UUID y pide abrir/ver ficha: responde ÚNICAMENTE con el bloque tool ui_open_view (sin texto alrededor).

## Cadena de ejecución (crítico)
- NUNCA digas «voy a…», «revisaré…», «la creo» o «verifico ahora» sin emitir YA el bloque \`\`\`tool.
- Si el objetivo necesita varias tools: emite una, espera TOOL_RESULT, sigue con la siguiente hasta terminar. No te detengas a mitad.
- Tras un cambio (write ok): responde al usuario en 1–3 frases claras qué hiciste y el resultado (sin relleno).
- deviceId: preferí el UUID de topo_list_routers / topo_list_olts. Si solo tienes el nombre del equipo (p. ej. edge-mikrotik), puedes pasarlo: el sistema lo resuelve.
- Completá el OBJETIVO del usuario en este turno (estilo agentes Hermes/OpenCode): no dejes pasos a medias ni ofrezcas «puedo hacerlo» — hacelo o reportá el bloqueo real.

## Tools vs Skills (no confundir)
- \`\`\`tool\`\`\` = ejecuta una acción real (ej. \`crm_merge_clients\`, \`crm_find_duplicates\`).
- \`\`\`skill\`\`\` = solo carga una guía corta (ej. \`crm_dedupe_clients\`). NUNCA pongas el nombre de una tool dentro de un bloque skill.
- Para unificar duplicados: skill \`crm_dedupe_clients\` O directo tools \`crm_find_duplicates\` → \`crm_merge_clients\`.
- Para unificar servicios con misma ONU/plan: skill \`crm_dedupe_services\` O tools \`crm_find_duplicate_services\` → \`crm_merge_services\`.

## Uso de tools (OBLIGATORIO)
- Tools de LECTURA / bajo riesgo (crm_*, billing_*, topo_*, vpn_*, onu_lookup, onu_list_*, onu_verify_status, onu_live_status, olt_discover_onus_live, asset_get_connection, mikrotik_read, ui_open_view): ÚSALAS DE INMEDIATO. NO preguntes permiso. NO digas «puedo buscar» ni «si quieres consulto»: ejecuta la tool y luego responde con el resultado.
- Solo pregunta antes de tools de ESCRITURA / riesgo (onu_verify_run, onu_reboot, onu_refresh, mikrotik_apply, crm_set_service_status, crm_reconcile_olt, crm_merge_clients, crm_merge_services, crm_update_client), salvo que el usuario ya pidió explícitamente el cambio.
- Cuando el usuario pida ver/abrir un cliente, ONU o equipo: llama ui_open_view (abre el panel-navegador junto al chat; mode=full por defecto).

Flujo típico: crm_search_clients (sin q = más recientes) → crm_get_client / ui_open_view → onu_lookup → onu_live_status.
Equipo sin respuesta: asset_get_connection → vpn_probe_tunnel → topo_test_connection.

## IDs (crítico)
- Los IDs (clientId, serviceId, onuId, deviceId) son UUID reales que vienen en el JSON del TOOL_RESULT (campo \`id\`).
- NUNCA inventes ni copies placeholders del estilo \`<uuid>\`, \`uuid\`, \`<clientId>\` o texto de ejemplo.
- Si no tienes el id: llama primero crm_search_clients / topo_list_* / onu_lookup y usa el \`id\` devuelto.

No inventes seriales, IPs ni resultados. Responde en español, claro y conciso.`;

export type AsistenteChatOptions = {
  readOnly?: boolean;
  restorePoints?: boolean;
  /** Planifica y encadena más rondas de tools. */
  thinking?: boolean;
  sessionId?: string;
  /** Resumen previo de contexto (sesiones largas). */
  contextSummary?: string;
  /** Callback para SSE / UI en vivo */
  onEvent?: (event: AiChatStreamEvent) => void;
};

const MAX_TOOL_ROUNDS = 20;
const MAX_TOOL_ROUNDS_THINKING = 28;

@Injectable()
export class AiProviderRouter {
  private readonly logger = new Logger(AiProviderRouter.name);
  private aiInternalColumnEnsured = false;

  constructor(
    @InjectRepository(Tenant)
    private readonly tenants: Repository<Tenant>,
    private readonly tenantConnections: TenantConnectionService,
    private readonly platformAi: PlatformAiSettingsService,
    private readonly quota: PlatformAiQuotaService,
    private readonly capabilities: PlatformAiCapabilitiesService,
    private readonly tools: AiToolsService,
    private readonly dataSource: DataSource,
  ) {}

  async readTenantConfig(
    schemaName: string,
  ): Promise<AsistenteIaModuleConfig> {
    const repo =
      await this.tenantConnections.getModuleConfigRepository(schemaName);
    const row = await repo.findOne({ where: { moduleId: 'asistente_ia' } });
    return {
      ...EMPTY_ASISTENTE_IA_CONFIG,
      ...((row?.config ?? {}) as Partial<AsistenteIaModuleConfig>),
    };
  }

  async completeForTenant(
    user: AuthUser,
    messages: AiChatMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<AiCompletionResult & { billedInternal: boolean }> {
    const tenant = await this.requireTenant(user);
    const cfg = await this.readTenantConfig(tenant.schemaName);
    if (cfg.enabled === false) {
      throw new BadRequestException('Asistente IA deshabilitado en la config');
    }

    let provider: string;
    let model: string;
    let apiKey: string;
    let billedInternal = false;

    if (cfg.mode === 'internal') {
      if (tenant.aiInternalEnabled === false) {
        throw new ForbiddenException(
          'El proveedor interno no está habilitado para esta empresa. Usa API propia o contacta a soporte.',
        );
      }
      const creds = await this.platformAi.getInternalCredentials();
      await this.quota.assertCanConsume(
        tenant.id,
        Math.max(64, Math.min(opts?.maxTokens ?? 256, 2048)),
      );
      provider = creds.provider;
      model = creds.model;
      apiKey = creds.apiKey;
      billedInternal = true;
    } else {
      if (!isAiVendorId(cfg.provider)) {
        throw new BadRequestException(`Proveedor inválido: ${cfg.provider}`);
      }
      if (!cfg.apiKey?.trim()) {
        throw new BadRequestException(
          'Falta la API key del proveedor. Configúrala en Integraciones → Asistente IA.',
        );
      }
      provider = cfg.provider;
      model =
        cfg.model?.trim() || getAiVendor(cfg.provider)!.defaultModel;
      apiKey = cfg.apiKey.trim();
    }

    const result = await this.dispatch({
      provider,
      model,
      apiKey,
      messages,
      maxTokens: opts?.maxTokens ?? 256,
      temperature: opts?.temperature,
    });

    if (billedInternal) {
      await this.quota.recordUsage(tenant.id, {
        requests: 1,
        tokens: result.totalTokens || 1,
      });
    }

    this.logger.debug(
      `AI complete tenant=${tenant.id} provider=${provider} tokens=${result.totalTokens} internal=${billedInternal}`,
    );
    return { ...result, billedInternal };
  }

  private async resolveTenantAiTarget(user: AuthUser): Promise<{
    provider: string;
    model: string;
    apiKey: string;
    billedInternal: boolean;
    contextWindow: number;
    tenantId: string;
  }> {
    const tenant = await this.requireTenant(user);
    const cfg = await this.readTenantConfig(tenant.schemaName);
    if (cfg.enabled === false) {
      throw new BadRequestException('Asistente IA deshabilitado en la config');
    }
    let provider: string;
    let model: string;
    let apiKey: string;
    let billedInternal = false;
    if (cfg.mode === 'internal') {
      if (tenant.aiInternalEnabled === false) {
        throw new ForbiddenException(
          'El proveedor interno no está habilitado para esta empresa. Usa API propia o contacta a soporte.',
        );
      }
      const creds = await this.platformAi.getInternalCredentials();
      provider = creds.provider;
      model = creds.model;
      apiKey = creds.apiKey;
      billedInternal = true;
    } else {
      if (!isAiVendorId(cfg.provider)) {
        throw new BadRequestException(`Proveedor inválido: ${cfg.provider}`);
      }
      if (!cfg.apiKey?.trim()) {
        throw new BadRequestException(
          'Falta la API key del proveedor. Configúrala en Integraciones → Asistente IA.',
        );
      }
      provider = cfg.provider;
      model =
        cfg.model?.trim() || getAiVendor(cfg.provider)!.defaultModel;
      apiKey = cfg.apiKey.trim();
    }
    return {
      provider,
      model,
      apiKey,
      billedInternal,
      contextWindow: resolveModelContextWindow(model),
      tenantId: tenant.id,
    };
  }

    async testConnection(user: AuthUser) {
    const result = await this.completeForTenant(
      user,
      [
        {
          role: 'user',
          content: 'Responde exactamente con la palabra OK.',
        },
      ],
      { maxTokens: 16 },
    );
    return {
      ok: true,
      provider: result.provider,
      model: result.model,
      reply: result.text.slice(0, 200),
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      totalTokens: result.totalTokens,
      billedInternal: result.billedInternal,
    };
  }

  /**
   * Chat del agente con loop de tools/skills.
   * Emite actividades vía opts.onEvent (SSE) y las devuelve en la respuesta.
   */
  async chat(
    user: AuthUser,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    opts?: AsistenteChatOptions,
  ) {
    const cleaned = history
      .map((m) => ({
        role: m.role,
        content: (m.content ?? '').trim(),
      }))
      .filter((m) => m.content.length > 0)
      .slice(-40);
    if (cleaned.length === 0) {
      throw new BadRequestException('Escribe un mensaje');
    }
    if (cleaned[cleaned.length - 1]?.role !== 'user') {
      throw new BadRequestException('El último mensaje debe ser del usuario');
    }

    if (!user.schemaName || !user.tenantId) {
      throw new BadRequestException('Sin esquema de empresa');
    }

    const readOnly = opts?.readOnly === true;
    const restorePoints = !readOnly && opts?.restorePoints === true;
    const thinking = opts?.thinking === true;
    const maxRounds = thinking ? MAX_TOOL_ROUNDS_THINKING : MAX_TOOL_ROUNDS;
    const emit = opts?.onEvent;
    const activities: AiChatActivity[] = [];

    const aiTarget = await this.resolveTenantAiTarget(user);
    const contextWindow = aiTarget.contextWindow;
    let contextSummary = (opts?.contextSummary ?? '').trim();
    let dialogue = cleaned;
    let contextCompacted = false;
    let keptFromEnd: number | null = null;
    let movePlan: MovePlan | null = null;

    const reservedTokens =
      estimateTokensFromText(contextSummary) +
      estimateTokensFromText(ASISTENTE_SYSTEM_PROMPT) +
      2_500;
    const compactBudget = {
      contextWindow,
      reservedTokens,
    };

    if (shouldCompactChatHistory(dialogue, compactBudget)) {
      const { older, recent } = splitHistoryForCompact(
        dialogue,
        compactBudget,
      );
      if (older.length > 0) {
        try {
          const summaryMsgs = buildContextSummaryPrompt({
            previousSummary: contextSummary,
            olderTurns: older,
          });
          const summaryResult = await this.completeForTenant(
            user,
            summaryMsgs,
            { maxTokens: 700, temperature: 0.2 },
          );
          const nextSummary = summaryResult.text
            .trim()
            .slice(0, AI_CHAT_SUMMARY_MAX_CHARS);
          if (nextSummary) {
            contextSummary = nextSummary;
            dialogue = recent;
            contextCompacted = true;
            keptFromEnd = recent.length;
            emit?.({
              type: 'context',
              summary: contextSummary,
              keptFromEnd: recent.length,
              compacted: true,
              contextWindow,
              estimatedTokens: estimateHistoryTokens(cleaned, contextSummary),
            });
            this.logger.log(
              `AI context compacted model=${aiTarget.model} window=${contextWindow} dropped=${older.length} kept=${recent.length}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `AI context compact failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          dialogue = dialogue.slice(-AI_CHAT_KEEP_RECENT);
          keptFromEnd = dialogue.length;
          contextCompacted = true;
        }
      }
    }

    const pushActivity = (
      partial: Omit<AiChatActivity, 'id' | 'at'> & { id?: string },
    ) => {
      const activity: AiChatActivity = {
        id:
          partial.id ??
          `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        kind: partial.kind,
        slug: partial.slug,
        name: partial.name,
        status: partial.status,
        detail: partial.detail,
        mutates: partial.mutates,
        at: new Date().toISOString(),
      };
      const idx = activities.findIndex((a) => a.id === activity.id);
      if (idx >= 0) activities[idx] = activity;
      else activities.push(activity);
      emit?.({ type: 'activity', activity });
      return activity;
    };

    const caps = await this.capabilities.listActiveForAgent();
    const toolsList = readOnly
      ? caps.tools.filter((t) => {
          const meta = this.tools.getMeta(t.slug);
          if (meta) return !meta.mutates;
          const s = `${t.slug} ${t.name} ${t.description}`.toLowerCase();
          return !/(create|update|delete|set|write|patch|remove|suspend|apply|provision|verify_run)/.test(
            s,
          );
        })
      : caps.tools;

    const toolsBlock =
      toolsList.length > 0
        ? toolsList
            .map((t) => {
              const schema = t.parametersSchema
                ? ` args=${JSON.stringify(t.parametersSchema)}`
                : '';
              return `- tool \`${t.slug}\`: ${t.description || t.name}${schema}`;
            })
            .join('\n')
        : '- (ninguna tool activa)';
    const skillsBlock =
      caps.skills.length > 0
        ? caps.skills
            .map((s) => `- skill \`${s.slug}\`: ${s.description || s.name}`)
            .join('\n')
        : '- (ningún skill activo)';

    const modeBlock = readOnly
      ? `## Modo de sesión: SOLO LECTURA (activo)
- PROHIBIDO tools que modifiquen (onu_verify_run, onu_reboot, mikrotik_apply, crm_set_service_status, etc.).
- Solo consulta/orientación con tools de lectura y ui_open_view.
- Si el usuario pide modificar algo: NO digas que lo hiciste. Alerta de forma clara y directa:
  «Para hacer ese cambio tenés que desactivar **S lectura** en el asistente y volver a pedirlo.»
- No inventes workarounds ni simules writes.`
      : restorePoints
        ? `## Modo de sesión: PUNTO DE RESTAURACIÓN ACTIVO
- Ante writes, el sistema registrará undo cuando aplique.`
        : `## Modo de sesión: ESCRITURA NORMAL`;

    const thinkingBlock = thinking
      ? `
## Modo thinking (ACTIVO)
- Decide qué tools necesitas y ejecútalas YA (bloque \`\`\`tool), no narres el plan en prosa.
- Encadena tools hasta completar el OBJETIVO: no pares a mitad ni digas «siguiente paso» en texto.
- Solo responde al usuario con el resultado completo o un error real de tool.
- Si una tool falla, prueba una alternativa YA.`
      : `
## Modo thinking (INACTIVO)
- Igual debes usar tools y completar el OBJETIVO. Thinking solo aumenta rondas/planificación.`;

    const userGoal = String(dialogue[dialogue.length - 1]?.content ?? '').trim();
    const goalSnippet =
      userGoal.length > 280 ? `${userGoal.slice(0, 280)}…` : userGoal;

    const contextBlock = contextSummary
      ? `
## Contexto previo (resumido — no lo repitas entero)
${contextSummary}`
      : '';

    const system = `${ASISTENTE_SYSTEM_PROMPT}

${modeBlock}
${thinkingBlock}
${contextBlock}

## OBJETIVO de este turno (no soltar)
${goalSnippet || '(mensaje del usuario)'}
Seguí hasta cumplirlo o hasta un bloqueo real. No te detengas a mitad del pensamiento.

## Cómo usar tools y skills
Cuando necesites datos o ejecutar una acción, responde ÚNICAMENTE con un bloque (una tool o skill por turno). Sin texto antes ni después:

\`\`\`tool
{"name":"crm_search_clients","arguments":{"limit":5}}
\`\`\`

(sin \`q\` = clientes más recientes; con \`q\` = búsqueda por texto). Luego usa el campo \`id\` del resultado en crm_get_client / ui_open_view.

o

\`\`\`skill
{"name":"onu_verify_diagnose"}
\`\`\`

El sistema ejecutará la tool/skill y te devolverá el resultado. Luego continúa.
Cuando el OBJETIVO ya está cumplido, escribe en español SIN el bloque tool/skill (1–5 frases).
No inventes seriales, IPs ni resultados de verificación.
NUNCA pidas permiso para tools de lectura: ejecútalas en el mismo turno.
NUNCA digas que las tools no están disponibles.
NUNCA uses placeholders (\`<uuid>\`, \`uuid\`, \`<clientId>\`): siempre el id del TOOL_RESULT.

## Catálogo activo
### Tools${readOnly ? ' (solo lectura)' : ''}
${toolsBlock}

### Skills
${skillsBlock}`;

    const messages: AiChatMessage[] = [
      { role: 'system', content: system },
      ...dialogue,
    ];

    const wantPlan =
      thinking || looksLikeMultiStepGoal(userGoal);
    if (wantPlan && toolsList.length > 0) {
      const planAct = pushActivity({
        kind: 'plan',
        slug: 'plan_moves',
        name: 'Plan de movimientos',
        status: 'running',
        detail: 'Diseñando cadena de tools…',
      });
      try {
        const planMsgs = buildMovePlanPrompt({
          goal: userGoal,
          toolsBlock,
          readOnly,
        });
        const planResult = await this.completeForTenant(user, planMsgs, {
          maxTokens: thinking ? 900 : 600,
          temperature: 0.2,
        });
        movePlan = parseMovePlan(planResult.text);
        if (movePlan) {
          emit?.({
            type: 'plan',
            goal: movePlan.goal,
            steps: movePlan.steps,
            doneWhen: movePlan.doneWhen,
          });
          pushActivity({
            ...planAct,
            status: 'done',
            detail: movePlan.steps
              .map((s) => s.tool)
              .slice(0, 6)
              .join(' → '),
          });
          messages[0] = {
            role: 'system',
            content: `${system}

${formatMovePlanForPrompt(movePlan)}`,
          };
        } else {
          pushActivity({
            ...planAct,
            status: 'done',
            detail: 'Sin plan estructurado; se ejecuta directo',
          });
        }
      } catch (err) {
        pushActivity({
          ...planAct,
          status: 'error',
          detail:
            err instanceof Error ? err.message.slice(0, 160) : 'Error de plan',
        });
        this.logger.warn(
          `AI plan stage failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    let provider = '';
    let model = '';
    let billedInternal = false;
    let promptTokens = 0;
    let completionTokens = 0;
    let reply = '';
    let intentionNudges = 0;
    let goalContinueNudges = 0;
    let toolsUsed = 0;
    let lastToolSig = '';
    let sameToolStreak = 0;

    const toolCtx = {
      user,
      schemaName: user.schemaName,
      tenantId: user.tenantId!,
      readOnly,
      restorePoints,
      sessionId: opts?.sessionId,
    };

    const continueTowardGoal = (reason: string, assistantText: string) => {
      goalContinueNudges += 1;
      this.logger.warn(
        `AI incomplete turn (goal-nudge=${goalContinueNudges}): ${reason}`,
      );
      pushActivity({
        kind: 'tool',
        slug: '_continue',
        name: 'Continuando objetivo',
        status: 'running',
        detail: reason.slice(0, 120),
      });
      messages.push({ role: 'assistant', content: assistantText });
      messages.push({
        role: 'user',
        content: `↻ CONTINUAR OBJETIVO (${goalContinueNudges}/4): ${goalSnippet}

Tu respuesta anterior se detuvo a medias o no cumplió el objetivo.
Emite ÚNICAMENTE el siguiente bloque \`\`\`tool ahora, o —si el objetivo YA está 100% cumplido— responde el resultado final en 1–5 frases.
Prohibido: «voy a…», «puedo…», «si quieres…», narrar el plan sin ejecutar.`,
      });
    };

    for (let round = 0; round < maxRounds; round += 1) {
      const result = await this.completeForTenant(user, messages, {
        maxTokens: thinking ? 3072 : 2048,
        temperature: thinking ? 0.35 : 0.25,
      });
      provider = result.provider;
      model = result.model;
      billedInternal = result.billedInternal;
      promptTokens += result.promptTokens;
      completionTokens += result.completionTokens;

      let action = parseAgentAction(result.text);
      if (action.kind === 'text') {
        if (
          toolsList.length > 0 &&
          looksLikeToolRefusal(action.text) &&
          round < maxRounds - 1
        ) {
          this.logger.warn(
            `AI refused tools (round=${round}); nudging retry`,
          );
          pushActivity({
            kind: 'tool',
            slug: '_nudge',
            name: 'Reintentando tools',
            status: 'running',
            detail: 'El modelo omitió la tool; forzando ejecución…',
          });
          messages.push({ role: 'assistant', content: result.text });
          messages.push({
            role: 'user',
            content:
              'INCORRECTO: las tools del catálogo SÍ están operativas ahora. No digas que faltan. Emite ÚNICAMENTE el bloque ```tool con JSON {"name","arguments"} que corresponda. Sin prosa.',
          });
          continue;
        }
        if (
          toolsList.length > 0 &&
          looksLikeDeferredToolIntent(action.text) &&
          intentionNudges < 3 &&
          round < maxRounds - 1
        ) {
          intentionNudges += 1;
          this.logger.warn(
            `AI deferred intent without tool (round=${round}); nudging`,
          );
          pushActivity({
            kind: 'tool',
            slug: '_nudge',
            name: 'Continuando cadena',
            status: 'running',
            detail: 'El modelo anunció la acción; forzando tool…',
          });
          messages.push({ role: 'assistant', content: result.text });
          messages.push({
            role: 'user',
            content:
              'NO narres el plan. Emite ÚNICAMENTE el bloque ```tool con la siguiente acción concreta ahora. Sin prosa. Si el objetivo ya está cumplido, entonces sí responde en 1–5 frases qué hiciste.',
          });
          continue;
        }
        if (
          toolsList.length > 0 &&
          looksLikeIncompleteAgentTurn(action.text, { toolsUsed }) &&
          goalContinueNudges < 4 &&
          round < maxRounds - 1
        ) {
          continueTowardGoal('turno incompleto', action.text || result.text);
          continue;
        }
        reply = action.text || result.text;
        break;
      }

      messages.push({ role: 'assistant', content: result.text });

      if (action.kind === 'skill') {
        const skillAction = action;
        const skill = caps.skills.find((s) => s.slug === skillAction.name);
        if (!skill) {
          const toolExists =
            toolsList.some((t) => t.slug === skillAction.name) ||
            !!this.tools.getMeta(skillAction.name);
          if (toolExists) {
            this.logger.warn(
              `AI skill→tool remap: «${skillAction.name}» es tool, no skill`,
            );
            pushActivity({
              kind: 'tool',
              slug: '_remap',
              name: 'Skill→Tool',
              status: 'done',
              detail: `«${skillAction.name}» es una tool; ejecutando como tool…`,
            });
            action = {
              kind: 'tool',
              name: skillAction.name,
              arguments: skillAction.arguments ?? {},
              raw: skillAction.raw,
            };
          } else {
            const act = pushActivity({
              kind: 'skill',
              slug: skillAction.name,
              name: skillAction.name,
              status: 'running',
              detail: 'Cargando skill…',
            });
            pushActivity({
              ...act,
              status: 'error',
              detail: 'Skill no encontrada o deshabilitada',
            });
            const hintSkill = caps.skills.find(
              (s) =>
                s.slug.includes('dedupe') ||
                s.slug.includes('merge') ||
                s.description.toLowerCase().includes('duplic'),
            );
            messages.push({
              role: 'user',
              content: `SKILL_RESULT ${JSON.stringify({
                name: skillAction.name,
                ok: false,
                error: 'Skill no disponible',
                hint: hintSkill
                  ? `Probá skill «${hintSkill.slug}» o la tool equivalente con bloque tool`
                  : 'Usá bloque tool con un slug del catálogo de Tools',
              })}\n\nOBJETIVO: ${goalSnippet}\nEmite ÚNICAMENTE el siguiente bloque \`\`\`tool correcto YA.`,
            });
            continue;
          }
        } else {
          const act = pushActivity({
            kind: 'skill',
            slug: skillAction.name,
            name: skill.name ?? skillAction.name,
            status: 'running',
            detail: 'Cargando skill…',
          });
          pushActivity({
            ...act,
            status: 'done',
            detail: 'Skill aplicada al contexto',
          });
          messages.push({
            role: 'user',
            content: `SKILL_RESULT para \`${skill.slug}\`:\n${skill.code}\n\nOBJETIVO: ${goalSnippet}\nUsa esta guía y llama tools YA (bloque \`\`\`tool) hasta completar el objetivo. No vuelvas a llamar skill con nombres de tools.`,
          });
          continue;
        }
      }

      if (action.kind !== 'tool') {
        continue;
      }

      const toolAction = action;
      const meta = this.tools.getMeta(toolAction.name);
            const catalogTool = toolsList.find((t) => t.slug === toolAction.name);
      if (!catalogTool && !meta) {
        pushActivity({
          kind: 'tool',
          slug: toolAction.name,
          name: toolAction.name,
          status: 'error',
          detail: 'Tool no disponible',
        });
        messages.push({
          role: 'user',
          content: `TOOL_RESULT ${JSON.stringify({
            name: toolAction.name,
            ok: false,
            error: 'Tool no disponible en este modo/sesión',
          })}\n\nOBJETIVO: ${goalSnippet}\nPrueba otra tool YA.`,
        });
        continue;
      }
      if (readOnly && meta?.mutates) {
        pushActivity({
          kind: 'tool',
          slug: toolAction.name,
          name: meta.name ?? toolAction.name,
          status: 'error',
          detail: 'Bloqueada: desactiva S lectura',
          mutates: true,
        });
        messages.push({
          role: 'user',
          content: `TOOL_RESULT ${JSON.stringify({
            name: toolAction.name,
            ok: false,
            code: 'READ_ONLY_BLOCKED',
            error:
              'Modo solo lectura activo. Alerta al usuario: para modificar debe desactivar «S lectura» en el asistente y volver a pedirlo.',
            userHint:
              'Para modificar, desactivá «S lectura» en el asistente y volvé a pedirlo.',
          })}\n\nResponde al usuario con esa alerta. No inventes que ejecutaste el cambio.`,
        });
        continue;
      }

      const sig = toolCallSignature(toolAction.name, toolAction.arguments);
      if (sig === lastToolSig) sameToolStreak += 1;
      else {
        lastToolSig = sig;
        sameToolStreak = 1;
      }
      if (sameToolStreak >= 3) {
        pushActivity({
          kind: 'tool',
          slug: toolAction.name,
          name: meta?.name ?? catalogTool?.name ?? toolAction.name,
          status: 'error',
          detail: 'Doom loop: misma tool repetida',
        });
        messages.push({
          role: 'user',
          content: `DOOM_LOOP: repetiste \`${toolAction.name}\` con los mismos argumentos 3 veces.
OBJETIVO: ${goalSnippet}
Cambia de enfoque (otra tool / otros args) YA, o responde al usuario con el estado actual y el bloqueo. No repitas lo mismo.`,
        });
        sameToolStreak = 0;
        lastToolSig = '';
        continue;
      }

      const toolMutates = meta?.mutates === true;
      const act = pushActivity({
        kind: 'tool',
        slug: toolAction.name,
        name: meta?.name ?? catalogTool?.name ?? toolAction.name,
        status: 'running',
        detail: this.formatArgsDetail(toolAction.arguments),
        mutates: toolMutates,
      });

      const outcome = await this.tools.execute(
        toolAction.name,
        toolAction.arguments,
        toolCtx,
      );
      toolsUsed += 1;

      pushActivity({
        ...act,
        status: outcome.ok ? 'done' : 'error',
        detail: outcome.summary,
        mutates: toolMutates,
      });

      if (outcome.ui) {
        emit?.({ type: 'ui', view: outcome.ui });
      }

      messages.push({
        role: 'user',
        content: `TOOL_RESULT de \`${toolAction.name}\`:\n${JSON.stringify({
          ok: outcome.ok,
          summary: outcome.summary,
          data: outcome.data,
          ui: outcome.ui ?? undefined,
        })}\n\nOBJETIVO: ${goalSnippet}\n${
          outcome.ok
            ? toolMutates
              ? 'Si el OBJETIVO ya está cumplido, responde en 1–5 frases qué cambiaste. Si falta verificar u otra acción, emite ÚNICAMENTE otro bloque ```tool YA.'
              : 'Continúa YA hacia el OBJETIVO: otra ```tool si falta algo; si ya terminaste, responde breve. Nunca digas «voy a…» sin tool.'
            : 'Falló. Corrige y reintenta YA con otro bloque ```tool. Sin narrar el plan.'
        }`,
      });
    }

    if (!reply) {
      reply =
        goalContinueNudges > 0 || toolsUsed > 0
          ? `Llegué al límite de pasos sin cerrar del todo el objetivo («${goalSnippet}»). Pedime «continúa» y sigo desde acá.`
          : 'No pude completar la consulta con las tools disponibles. Prueba de nuevo o indica el serial de la ONU.';
    }

    const visibleActivities = activities.filter(
      (a) => !a.slug.startsWith('_'),
    );

    const payload = {
      ok: true as const,
      reply,
      provider,
      model,
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      billedInternal,
      activities: visibleActivities,
      readOnly,
      restorePoints,
      sessionId: opts?.sessionId ?? null,
      contextSummary: contextSummary || null,
      contextCompacted,
      keptFromEnd,
      contextWindow,
      plan: movePlan
        ? {
            goal: movePlan.goal,
            steps: movePlan.steps,
            doneWhen: movePlan.doneWhen,
          }
        : null,
    };
    emit?.({ type: 'reply', ...payload });
    emit?.({ type: 'done' });
    return payload;
  }

  private formatArgsDetail(args: Record<string, unknown>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(args ?? {})) {
      if (v == null || v === '') continue;
      parts.push(`${k}=${String(v)}`);
    }
    return parts.slice(0, 4).join(' · ') || 'Ejecutando…';
  }

  private async dispatch(req: {
    provider: string;
    model: string;
    apiKey: string;
    messages: AiChatMessage[];
    maxTokens?: number;
    temperature?: number;
  }): Promise<AiCompletionResult> {
    switch (req.provider) {
      case 'openai':
      case 'grok':
      case 'deepseek':
      case 'latinrouter':
        return completeOpenAiCompatible(req);
      case 'anthropic':
        return completeAnthropic(req);
      case 'gemini':
        return completeGemini(req);
      default:
        throw new BadRequestException(
          `Proveedor no implementado: ${req.provider}`,
        );
    }
  }

  private async requireTenant(user: AuthUser): Promise<Tenant> {
    if (!user.tenantId) {
      throw new BadRequestException('Sin tenant');
    }
    if (!this.aiInternalColumnEnsured) {
      await this.dataSource.query(`
        ALTER TABLE public.tenants
        ADD COLUMN IF NOT EXISTS ai_internal_enabled boolean NOT NULL DEFAULT true
      `);
      this.aiInternalColumnEnsured = true;
    }
    const tenant = await this.tenants.findOne({
      where: { id: user.tenantId },
    });
    if (!tenant) throw new BadRequestException('Tenant no encontrado');
    return tenant;
  }
}
