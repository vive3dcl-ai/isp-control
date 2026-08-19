/** Sanitize text for OLT ONU `name` / labels (ASCII; sin `+` / `-` / comillas). */
export function sanitizeOltLabel(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[+\-]/g, ' ')
    .replace(/["'`\\<>|]/g, '')
    .replace(/[^A-Za-z0-9 @#$&()._/,\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * OLT ONU display name: «Cliente Servicio» (solo espacios).
 * El guion `-` lo rechaza la OLT; comillas no hacen falta.
 */
export function oltOnuName(clientName: string, serviceName: string): string {
  const client = sanitizeOltLabel(clientName);
  const service = sanitizeOltLabel(serviceName);
  return [client, service].filter(Boolean).join(' ').slice(0, 60);
}
