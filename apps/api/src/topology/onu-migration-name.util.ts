/**
 * Suggest a client name from OLT ONU fields.
 * Prefer ONU `name` (usually «Cliente Servicio») over `description`
 * (often address/coords).
 */

const SERVICE_SUFFIXES = new Set(
  [
    'casa',
    'local',
    'oficina',
    'negocio',
    'tienda',
    'empresa',
    'internet',
    'fibra',
    'principal',
    'secundario',
    'secundaria',
    'apto',
    'apt',
    'apto.',
    'depto',
    'dpto',
    'departamento',
    'taller',
    'bodega',
    'residencia',
    'vivienda',
    'hogar',
    'servicio',
    'wan',
    'lan',
  ].map((s) => s.toLowerCase()),
);

export type NameSuggestion = {
  suggestedName: string;
  suggestedFirstName: string;
  suggestedLastName: string;
  /** Trailing service-like token stripped from ONU name, if any. */
  suggestedServiceName: string;
  source: 'name' | 'description' | 'empty';
  confidence: 'high' | 'medium' | 'low';
};

export function suggestClientNameFromOlt(input: {
  name?: string | null;
  description?: string | null;
}): NameSuggestion {
  const name = cleanCandidate(input.name);
  const desc = cleanCandidate(input.description);

  // Prefer ONU name (person/company label). Description is often address/coords.
  if (name && looksLikePersonOrCompany(name)) {
    return finalize(name, 'name', 'high');
  }
  if (desc && looksLikePersonOrCompany(desc) && !looksLikeAddress(desc)) {
    return finalize(desc, 'description', 'medium');
  }
  if (name && !looksLikeTechnicalId(name)) {
    return finalize(name, 'name', 'medium');
  }
  if (desc && !looksLikeTechnicalId(desc) && !looksLikeAddress(desc)) {
    return finalize(desc, 'description', 'low');
  }
  if (name) {
    return finalize(name, 'name', 'low');
  }
  if (desc && !looksLikeAddress(desc)) {
    return finalize(desc, 'description', 'low');
  }
  return {
    suggestedName: '',
    suggestedFirstName: '',
    suggestedLastName: '',
    suggestedServiceName: '',
    source: 'empty',
    confidence: 'low',
  };
}

/** Split a full display name into tentative first/last (+ optional service). */
export function splitPersonName(full: string): {
  firstName: string;
  lastName: string;
  serviceName: string;
  displayName: string;
} {
  const titled = titleCaseWords(cleanCandidate(full));
  if (!titled) {
    return { firstName: '', lastName: '', serviceName: '', displayName: '' };
  }

  const tokens = titled.split(/\s+/).filter(Boolean);
  let serviceName = '';
  if (tokens.length >= 2) {
    const last = tokens[tokens.length - 1];
    if (SERVICE_SUFFIXES.has(last.toLowerCase())) {
      serviceName = last;
      tokens.pop();
    }
  }

  if (tokens.length === 0) {
    return {
      firstName: '',
      lastName: '',
      serviceName,
      displayName: '',
    };
  }
  if (tokens.length === 1) {
    return {
      firstName: tokens[0],
      lastName: '',
      serviceName,
      displayName: tokens[0],
    };
  }

  // Heurística LATAM: 1er token = nombre; resto = apellidos.
  // Partículas (de/del/la) van con el apellido, no con el nombre.
  let firstCount = 1;
  if (
    tokens.length >= 3 &&
    looksLikeGivenName(tokens[1]) &&
    !PARTICLES.has(tokens[1].toLowerCase())
  ) {
    // «Juan Carlos Perez» → nombre compuesto
    firstCount = 2;
  }

  const firstName = tokens.slice(0, firstCount).join(' ');
  const lastName = tokens.slice(firstCount).join(' ');
  const displayName = [firstName, lastName].filter(Boolean).join(' ');
  return { firstName, lastName, serviceName, displayName };
}

function finalize(
  raw: string,
  source: 'name' | 'description',
  confidence: 'high' | 'medium' | 'low',
): NameSuggestion {
  const split = splitPersonName(raw);
  return {
    suggestedName: split.displayName || titleCaseWords(raw),
    suggestedFirstName: split.firstName,
    suggestedLastName: split.lastName,
    suggestedServiceName: split.serviceName,
    source,
    confidence,
  };
}

function cleanCandidate(raw?: string | null): string {
  if (!raw?.trim()) return '';
  let s = raw
    .replace(/["'`\\<>|]+/g, ' ')
    .replace(/[_/]+/g, ' ')
    .replace(/\s*[-–—]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(/^(onu|olt|pon|gpon|epon)[\s\-_:]+/i, '').trim();
  s = s.replace(/^onu[\s\-_]*/i, '').trim();
  // Drop pure SN-like tokens (hex / digit-heavy), not person names without spaces.
  if (looksLikeSerialToken(s)) return '';
  return s.slice(0, 120);
}

/** True for GPON serials like ZTEG12345678 — not «JuanPerezCasa». */
function looksLikeSerialToken(s: string): boolean {
  const compact = s.replace(/[\s\-:]/g, '');
  if (!/^[A-Z0-9]{12,16}$/i.test(compact)) return false;
  if (/^[A-F0-9]{12,16}$/i.test(compact)) return true;
  const digits = (compact.match(/\d/g) ?? []).length;
  return digits >= 4;
}

function looksLikeTechnicalId(s: string): boolean {
  const t = s.trim();
  if (/^(F\/\d+\/\d+|gpon|epon|olt_|onu_)/i.test(t)) return true;
  if (/^\d{1,4}$/.test(t)) return true;
  if (looksLikeSerialToken(t)) return true;
  if (/^(working|offline|los|sync)/i.test(t)) return true;
  return false;
}

function looksLikeAddress(s: string): boolean {
  const t = s.trim();
  // coords with any decimal precision: -12.3, -76.1 or -12.345678, -76.123456
  if (/^-?\d{1,3}\.\d+,\s*-?\d{1,3}\.\d+$/.test(t)) return true;
  // after dash-stripping cleanCandidate may leave "12.345678, 76.123456"
  if (/^\d{1,3}\.\d+,\s*\d{1,3}\.\d+$/.test(t)) return true;
  if (/\b(calle|av\.|avenida|jr\.|jiron|mz|lote|urb\.|urb)\b/i.test(t)) {
    return true;
  }
  return false;
}

function looksLikePersonOrCompany(s: string): boolean {
  if (looksLikeTechnicalId(s)) return false;
  if (!/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(s)) return false;
  if (/\s/.test(s)) return true;
  if (s.length >= 4 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,}/.test(s)) return true;
  return false;
}

const PARTICLES = new Set(
  ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'do', 'das', 'dos'].map((p) =>
    p.toLowerCase(),
  ),
);

/** Common Spanish given-name-ish second token (short heuristic). */
function looksLikeGivenName(token: string): boolean {
  const t = token.toLowerCase();
  if (PARTICLES.has(t)) return false;
  const commons = new Set([
    'jose',
    'maría',
    'maria',
    'juan',
    'luis',
    'carlos',
    'ana',
    'rosa',
    'pedro',
    'jesus',
    'jesús',
    'miguel',
    'angel',
    'ángel',
    'francisco',
    'antonio',
    'manuel',
    'alberto',
    'alejandro',
    'fernando',
    'ricardo',
    'diego',
    'andres',
    'andrés',
    'daniel',
    'david',
    'gabriel',
    'pablo',
    'rafael',
    'sebastian',
    'sebastián',
    'sofia',
    'sofía',
    'camila',
    'valentina',
    'isabella',
    'lucia',
    'lucía',
  ]);
  return commons.has(t);
}

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => {
      if (!w) return w;
      const lower = w.toLowerCase();
      if (PARTICLES.has(lower)) return lower;
      if (w.length <= 2 && w === w.toUpperCase()) return w;
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ')
    .trim();
}
