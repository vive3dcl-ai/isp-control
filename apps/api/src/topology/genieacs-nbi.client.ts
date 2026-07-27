import { Logger } from '@nestjs/common';

export type GenieParamValue = {
  value: unknown;
  type?: string;
};

/**
 * Minimal GenieACS NBI HTTP client (REST on :7557).
 * @see https://docs.genieacs.com/en/latest/api-reference.html
 */
export class GenieAcsNbiClient {
  private readonly logger = new Logger(GenieAcsNbiClient.name);

  constructor(private readonly baseUrl: string) {}

  private root(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  async findDevices(
    query: Record<string, unknown>,
  ): Promise<Record<string, unknown>[]> {
    const u = new URL(`${this.root()}/devices/`);
    u.searchParams.set('query', JSON.stringify(query));
    const res = await fetch(u.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GenieACS NBI ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as Record<string, unknown>[];
    return Array.isArray(data) ? data : [];
  }

  async findBySerial(serial: string): Promise<Record<string, unknown> | null> {
    const sn = serial.trim();
    if (!sn) return null;
    const tokens = serialIdTokens(sn);
    const queries: Record<string, unknown>[] = [];
    for (const token of tokens) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      queries.push({ _id: { $regex: escaped, $options: 'i' } });
      queries.push({
        'InternetGatewayDevice.DeviceInfo.SerialNumber._value': token,
      });
      queries.push({ 'Device.DeviceInfo.SerialNumber._value': token });
    }
    // Exact common leaves with original SN
    queries.push({
      'InternetGatewayDevice.DeviceInfo.SerialNumber._value': sn,
    });
    queries.push({ 'Device.DeviceInfo.SerialNumber._value': sn });

    for (const q of queries) {
      try {
        const rows = await this.findDevices(q);
        if (rows.length) return rows[0];
      } catch (e) {
        this.logger.debug(
          `findBySerial failed: ${e instanceof Error ? e.message : e}`,
        );
      }
    }

    // Last resort: scan devices and match _id token locally (cheap for lab sizes).
    try {
      const all = await this.findDevices({});
      const hit = all.find((d) => deviceIdMatchesSerial(String(d._id ?? ''), sn));
      if (hit) return hit;
    } catch (e) {
      this.logger.debug(
        `findBySerial scan failed: ${e instanceof Error ? e.message : e}`,
      );
    }
    return null;
  }

  async enqueueTask(
    deviceId: string,
    task: Record<string, unknown>,
    opts?: { connectionRequest?: boolean; timeoutMs?: number },
  ): Promise<{ status: number; data: unknown }> {
    const encoded = encodeURIComponent(deviceId);
    const qs: string[] = [];
    if (opts?.connectionRequest !== false) qs.push('connection_request');
    if (opts?.timeoutMs) qs.push(`timeout=${opts.timeoutMs}`);
    const url = `${this.root()}/devices/${encoded}/tasks${qs.length ? `?${qs.join('&')}` : ''}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(task),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    if (res.status >= 400) {
      throw new Error(`GenieACS task ${res.status}: ${text.slice(0, 240)}`);
    }
    return { status: res.status, data };
  }

  async setParameterValues(
    deviceId: string,
    parameterValues: Array<[string, string | number | boolean, string?]>,
  ) {
    return this.enqueueTask(
      deviceId,
      {
        name: 'setParameterValues',
        parameterValues: parameterValues.map(([path, value, type]) =>
          type != null ? [path, value, type] : [path, value],
        ),
      },
      { connectionRequest: true, timeoutMs: 30_000 },
    );
  }

  async refreshObject(deviceId: string, objectName = '') {
    return this.enqueueTask(
      deviceId,
      { name: 'refreshObject', objectName },
      { connectionRequest: true, timeoutMs: 60_000 },
    );
  }
}

/** Read `_value` leaf from GenieACS nested device document. */
export function genieGet(obj: unknown, path: string): GenieParamValue | null {
  if (!obj || typeof obj !== 'object') return null;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return null;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (cur == null) return null;
  if (typeof cur === 'object' && cur !== null && '_value' in cur) {
    const leaf = cur as { _value?: unknown; _type?: string };
    return { value: leaf._value, type: leaf._type };
  }
  if (
    typeof cur === 'string' ||
    typeof cur === 'number' ||
    typeof cur === 'boolean'
  ) {
    return { value: cur };
  }
  return null;
}

export function genieChildIndices(obj: unknown, path: string): number[] {
  if (!obj || typeof obj !== 'object') return [];
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return [];
    cur = (cur as Record<string, unknown>)[p];
  }
  if (!cur || typeof cur !== 'object') return [];
  return Object.keys(cur as object)
    .filter((k) => /^\d+$/.test(k))
    .map(Number)
    .sort((a, b) => a - b);
}

export function resolveNbiBaseUrl(): string {
  const explicit = process.env.TR069_NBI_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const host =
    process.env.TR069_ACS_PROBE_HOST?.trim() || 'host.docker.internal';
  const port = process.env.TR069_NBI_PORT?.trim() || '7557';
  return `http://${host}:${port}`;
}

/**
 * GenieACS `_id` is typically `OUI-ProductClass-Serial`.
 * For many Huawei/GPON ONUs the Serial segment is `hex(vendor4) + rest`
 * e.g. HWTC314E23A3 → 48575443314E23A3 (not full-ASCII-hex of the SN).
 */
export function serialIdTokens(serial: string): string[] {
  const sn = serial.trim();
  if (!sn) return [];
  const out = new Set<string>([sn, sn.toUpperCase(), sn.toLowerCase()]);
  const asciiHex = Buffer.from(sn, 'utf8').toString('hex');
  out.add(asciiHex);
  out.add(asciiHex.toUpperCase());
  if (sn.length > 4) {
    const vendor = sn.slice(0, 4);
    const rest = sn.slice(4);
    const vendorHex = Buffer.from(vendor, 'utf8').toString('hex');
    out.add(vendorHex + rest);
    out.add(vendorHex.toUpperCase() + rest.toUpperCase());
    out.add(vendorHex.toLowerCase() + rest.toUpperCase());
    out.add(vendorHex.toUpperCase() + rest);
  }
  return [...out].filter(Boolean);
}

export function deviceIdMatchesSerial(deviceId: string, serial: string): boolean {
  const id = deviceId.trim();
  if (!id || !serial.trim()) return false;
  const upper = id.toUpperCase();
  for (const token of serialIdTokens(serial)) {
    if (upper.includes(token.toUpperCase())) return true;
  }
  return false;
}

export function strVal(v: GenieParamValue | null): string | null {
  if (!v || v.value == null) return null;
  return String(v.value);
}

export function boolVal(v: GenieParamValue | null): boolean | null {
  if (!v || v.value == null) return null;
  if (typeof v.value === 'boolean') return v.value;
  const s = String(v.value).toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}
