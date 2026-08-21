/**
 * Parseo del protocolo de tool/skill calls del Asistente.
 *
 * Formatos aceptados:
 * ```tool
 * {"name":"onu_lookup","arguments":{"sn":"ZTEGC..."}}
 * ```
 * ```tool
 * name: ui_open_view
 * arguments:
 *   view: client
 *   clientId: uuid
 * ```
 * O JSON suelto / name+arguments en texto.
 */
export type ParsedAgentAction =
  | {
      kind: 'tool';
      name: string;
      arguments: Record<string, unknown>;
      raw: string;
    }
  | {
      kind: 'skill';
      name: string;
      arguments: Record<string, unknown>;
      raw: string;
    }
  | { kind: 'text'; text: string };

const FENCE_RE = /```(tool|skill)\s*\n([\s\S]*?)```/i;

const BARE_JSON_RE =
  /\{\s*"name"\s*:\s*"([a-z0-9_]+)"\s*,\s*"(?:arguments|args)"\s*:\s*(\{[\s\S]*?\})\s*\}/i;

function coerceArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/** YAML-ish mínimo: `key: value` (una línea) o `arguments:` + indent. */
function parseLooseBody(body: string): {
  name?: string;
  arguments?: Record<string, unknown>;
} | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed) as {
      name?: string;
      arguments?: Record<string, unknown>;
      args?: Record<string, unknown>;
    };
  } catch {
    /* fall through */
  }

  const nameMatch = trimmed.match(/^name\s*:\s*["']?([a-z0-9_]+)["']?\s*$/im);
  if (!nameMatch) return null;
  const name = nameMatch[1];
  const args: Record<string, unknown> = {};

  const argsBlock = trimmed.match(
    /(?:arguments|args)\s*:\s*(?:\n([\s\S]+)|(\{[\s\S]*\}))/i,
  );
  if (argsBlock?.[2]) {
    try {
      Object.assign(args, JSON.parse(argsBlock[2]));
    } catch {
      /* ignore */
    }
  } else if (argsBlock?.[1]) {
    for (const line of argsBlock[1].split('\n')) {
      const m = line.match(/^\s+([a-zA-Z0-9_]+)\s*:\s*(.+?)\s*$/);
      if (!m) continue;
      let v: unknown = m[2].replace(/^["']|["']$/g, '');
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      else if (/^-?\d+(\.\d+)?$/.test(String(v))) v = Number(v);
      args[m[1]] = v;
    }
  }

  // También aceptar `view: client` al mismo nivel que name
  for (const line of trimmed.split('\n')) {
    const m = line.match(/^([a-zA-Z0-9_]+)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    if (m[1] === 'name' || m[1] === 'arguments' || m[1] === 'args') continue;
    if (args[m[1]] !== undefined) continue;
    let v: unknown = m[2].replace(/^["']|["']$/g, '');
    if (v === 'true') v = true;
    else if (v === 'false') v = false;
    args[m[1]] = v;
  }

  return { name, arguments: args };
}

export function parseAgentAction(content: string): ParsedAgentAction {
  const text = (content ?? '').trim();
  if (!text) return { kind: 'text', text: '' };

  const m = text.match(FENCE_RE);
  if (m) {
    const kind = m[1].toLowerCase() as 'tool' | 'skill';
    const loose = parseLooseBody(m[2]);
    const name = (loose?.name ?? '').trim();
    if (name) {
      return {
        kind,
        name,
        arguments: coerceArgs(loose?.arguments ?? (loose as { args?: unknown })?.args),
        raw: m[0],
      };
    }
  }

  const bare = text.match(BARE_JSON_RE);
  if (bare) {
    try {
      const args = JSON.parse(bare[2]) as Record<string, unknown>;
      return {
        kind: 'tool',
        name: bare[1],
        arguments: coerceArgs(args),
        raw: bare[0],
      };
    } catch {
      /* ignore */
    }
  }

  // Último recurso: cuerpo suelto estilo name:/arguments:
  if (/^```?(tool|skill)?/i.test(text) || /^name\s*:/im.test(text)) {
    const loose = parseLooseBody(text.replace(/^```(?:tool|skill)?\s*/i, '').replace(/```$/, ''));
    if (loose?.name) {
      return {
        kind: 'tool',
        name: loose.name.trim(),
        arguments: coerceArgs(loose.arguments),
        raw: text,
      };
    }
  }

  return { kind: 'text', text };
}

/** El modelo alega (falsamente) que no puede ejecutar tools. */
export function looksLikeToolRefusal(text: string): boolean {
  const t = (text ?? '').toLowerCase();
  if (!t) return false;
  return (
    /no tengo (acceso|ejecuci[oó]n|tools?|herramientas)/i.test(t) ||
    /tools? (no |des)?habilitad/i.test(t) ||
    /herramientas? (no |des)?habilitad/i.test(t) ||
    /sin ejecuci[oó]n de tools?/i.test(t) ||
    /entorno (no )?permit/i.test(t) ||
    /si el entorno habilita/i.test(t) ||
    /no puedo abrir.{0,40}sin ejecutar/i.test(t) ||
    /no tengo persistido.{0,80}conversaci[oó]n/i.test(t)
  );
}

/**
 * El modelo anuncia que va a actuar pero no emite ```tool (corta la cadena).
 * Solo mensajes cortos: respuestas finales largas no se fuerzan.
 */
export function looksLikeDeferredToolIntent(text: string): boolean {
  const t = (text ?? '').trim();
  if (!t || t.length > 520) return false;
  if (/```\s*tool/i.test(t) || /"name"\s*:\s*"[a-z0-9_]+"/i.test(t)) {
    return false;
  }
  return (
    /\bvoy a\b/i.test(t) ||
    /\bprocedo (a|con)\b/i.test(t) ||
    /\bahora (la |lo )?(reviso|creo|aplico|verifico|consulto|busco)\b/i.test(
      t,
    ) ||
    /\b(la|lo) (reviso|creo|aplico|verifico) (ahora|ya)\b/i.test(t) ||
    /\bsi no existe[, ]+(la |lo )?(creo|creo\.|aplico)\b/i.test(t) ||
    /\brevisar[eé]\b/i.test(t) ||
    /\bejecutar[eé]\b/i.test(t) ||
    /\bla creo\b/i.test(t) ||
    /\blo creo\b/i.test(t) ||
    /\bla verifico\b/i.test(t)
  );
}

/**
 * Estilo Hermes/OpenCode: la respuesta parece un turno incompleto
 * (se detuvo a mitad del objetivo) y conviene auto-continuar.
 */
export function looksLikeIncompleteAgentTurn(
  text: string,
  opts?: { toolsUsed?: number },
): boolean {
  const t = (text ?? '').trim();
  if (!t) return true;
  if (/```\s*tool/i.test(t) || /"name"\s*:\s*"[a-z0-9_]+"/i.test(t)) {
    return false;
  }
  if (looksLikeToolRefusal(t) || looksLikeDeferredToolIntent(t)) return true;

  const toolsUsed = opts?.toolsUsed ?? 0;
  const done =
    /\b(listo|hecho|completad[oa]|ya (está|quedo|quedó|apliqué|creé|unifiqué|revisé)|objetivo cumplido|resumen)\b/i.test(
      t,
    );

  // Ofrece hacer algo en vez de hacerlo
  if (
    /\b(puedo|podría|si quieres|si querés|¿quieres que|¿querés que|debo\b)/i.test(
      t,
    ) &&
    !done
  ) {
    return true;
  }

  // Narrativa de pasos futuros
  if (
    /\b(siguiente paso|próximo paso|ahora (voy|haré|procedo)|luego (voy|haré)|falta (revisar|crear|aplicar|verificar|buscar))\b/i.test(
      t,
    ) &&
    !done
  ) {
    return true;
  }

  // Se corta a medias (sin cierre claro) y aún no hizo casi nada
  if (toolsUsed === 0 && t.length < 80 && !/[.!?…]["']?\s*$/u.test(t)) {
    return true;
  }

  // Frases típicas de “pensamiento a medias”
  if (
    /\b(estoy (revisando|buscando|preparando)|déjame|dejame|un momento|en proceso)\b/i.test(
      t,
    ) &&
    !done
  ) {
    return true;
  }

  return false;
}

/** Firma estable para detectar doom-loops (misma tool + mismos args). */
export function toolCallSignature(
  name: string,
  args: Record<string, unknown>,
): string {
  const keys = Object.keys(args ?? {}).sort();
  const norm: Record<string, unknown> = {};
  for (const k of keys) norm[k] = args[k];
  return `${name}:${JSON.stringify(norm)}`;
}

export function stripActionFence(content: string): string {
  return content.replace(FENCE_RE, '').trim();
}
