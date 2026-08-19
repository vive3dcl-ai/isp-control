import { Logger } from '@nestjs/common';

export type GenieParamValue = {
  value: unknown;
  type?: string;
};

function primitiveString(value: unknown): string | null {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  return null;
}

/**
 * Minimal GenieACS NBI HTTP client (REST on :7557).
 * @see https://docs.genieacs.com/en/latest/api-reference.html
 */
export class GenieAcsNbiClient {
  private readonly logger = new Logger(GenieAcsNbiClient.name);
  private wake: (() => Promise<boolean>) | null = null;

  constructor(private readonly baseUrl: string) {}

  private root(): string {
    return this.baseUrl.replace(/\/$/, '');
  }

  /**
   * Despertar el CPE por nuestra cuenta en vez de con `?connection_request`.
   *
   * GenieACS no conserva la ConnectionRequestPassword —el CPE nunca la
   * devuelve— así que sus peticiones salen sin autenticar y toda orden espera
   * al Inform periódico. Cuando se registra esta función, la tarea se encola
   * suelta, se despierta al equipo y se espera a que la ejecute.
   */
  useConnectionRequest(wake: () => Promise<boolean>) {
    this.wake = wake;
  }

  async findDevices(
    query: Record<string, unknown>,
    opts?: { projection?: string },
  ): Promise<Record<string, unknown>[]> {
    const u = new URL(`${this.root()}/devices/`);
    u.searchParams.set('query', JSON.stringify(query));
    if (opts?.projection?.trim()) {
      u.searchParams.set('projection', opts.projection.trim());
    }
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
      const hit = all.find((d) =>
        deviceIdMatchesSerial(primitiveString(d._id) ?? '', sn),
      );
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
    const wantsWake = opts?.connectionRequest !== false;
    const timeoutMs = opts?.timeoutMs ?? 0;
    const ownWake = wantsWake && this.wake ? this.wake : null;

    const encoded = encodeURIComponent(deviceId);
    const qs: string[] = [];
    // Con despertador propio la tarea se encola suelta: esperar aquí sólo
    // retrasaría la petición de conexión, que es lo que hace que el CPE la
    // recoja.
    if (wantsWake && !ownWake) {
      qs.push('connection_request');
      if (timeoutMs) qs.push(`timeout=${timeoutMs}`);
    }
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
    if (!ownWake || res.status === 200) return { status: res.status, data };

    const taskId = primitiveString(
      (data as { _id?: unknown } | null)?._id ?? null,
    );
    if (!(await ownWake()) || !taskId) return { status: res.status, data };
    const done = await this.waitForTask(deviceId, taskId, timeoutMs || 60_000);
    return { status: done ? 200 : res.status, data };
  }

  /**
   * La tarea desaparece de la cola del equipo en cuanto el CPE la ejecuta.
   *
   * Se listan las del dispositivo en vez de buscar por `_id`: en la colección
   * de tareas ese campo es un ObjectId y la comparación con la cadena que
   * devuelve el NBI no siempre casa.
   */
  private async waitForTask(
    deviceId: string,
    taskId: string,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_500));
      try {
        const rows = await this.listDeviceTasks(deviceId);
        if (!rows.some((t) => primitiveString(t._id ?? null) === taskId)) {
          return true;
        }
      } catch (e) {
        this.logger.debug(
          `waitForTask ${taskId}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    return false;
  }

  /** Tareas pendientes del CPE en GenieACS (cola NBI). */
  async listDeviceTasks(
    deviceId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const u = new URL(`${this.root()}/tasks/`);
    u.searchParams.set('query', JSON.stringify({ device: deviceId }));
    const res = await fetch(u.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return [];
    const rows = (await res.json()) as unknown;
    return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
  }

  async hasPendingTask(
    deviceId: string,
    pred: (task: Record<string, unknown>) => boolean,
  ): Promise<boolean> {
    const rows = await this.listDeviceTasks(deviceId);
    return rows.some(pred);
  }

  /**
   * @param opts.wait default true — espera a que el CPE ejecute la tarea
   *   (hasta timeoutMs). Con `wait: false` sólo encola y responde al tiro
   *   (típicamente 202); el llamador puede despertar el CPE en background.
   */
  async setParameterValues(
    deviceId: string,
    parameterValues: Array<[string, string | number | boolean, string?]>,
    opts?: { timeoutMs?: number; wait?: boolean },
  ) {
    const wait = opts?.wait !== false;
    return this.enqueueTask(
      deviceId,
      {
        name: 'setParameterValues',
        parameterValues: parameterValues.map(([path, value, type]) =>
          type != null ? [path, value, type] : [path, value],
        ),
      },
      wait
        ? { connectionRequest: true, timeoutMs: opts?.timeoutMs ?? 120_000 }
        : { connectionRequest: false },
    );
  }

  /**
   * Crea una instancia bajo `objectName`.
   *
   * Importante: NO forzar el punto final. En este GenieACS, AddObject con
   * `…WANConnectionDevice.` (trailing dot) termina en
   * `script.Error Invalid parameter path`; sin el punto responde 200 y el CPE
   * (HG8145X6) sí crea la instancia.
   *
   * `connectionRequest: false` encola sin despertar (p. ej. tras reboot de
   * bootstrap: el próximo Inform drena la cola).
   */
  async addObject(
    deviceId: string,
    objectName: string,
    opts?: { connectionRequest?: boolean; timeoutMs?: number },
  ) {
    const name = objectName.replace(/\.$/, '');
    const wantsWake = opts?.connectionRequest !== false;
    return this.enqueueTask(
      deviceId,
      { name: 'addObject', objectName: name },
      wantsWake
        ? { connectionRequest: true, timeoutMs: opts?.timeoutMs ?? 120_000 }
        : { connectionRequest: false },
    );
  }

  async deleteObject(deviceId: string, objectName: string) {
    return this.enqueueTask(
      deviceId,
      { name: 'deleteObject', objectName },
      { connectionRequest: true, timeoutMs: 120_000 },
    );
  }

  async refreshObject(deviceId: string, objectName = '') {
    return this.enqueueTask(
      deviceId,
      { name: 'refreshObject', objectName },
      { connectionRequest: true, timeoutMs: 60_000 },
    );
  }

  async getParameterValues(deviceId: string, parameterNames: string[]) {
    return this.enqueueTask(
      deviceId,
      { name: 'getParameterValues', parameterNames },
      { connectionRequest: true, timeoutMs: 60_000 },
    );
  }

  /**
   * Register a file in GenieACS (`PUT /files/:name`).
   * Download tasks reference this name as `file`.
   */
  async putFile(
    fileName: string,
    body: Buffer,
    headers: {
      fileType: string;
      productClass?: string;
      version?: string;
      oui?: string;
    },
  ): Promise<void> {
    const encoded = encodeURIComponent(fileName);
    const h: Record<string, string> = {
      fileType: headers.fileType,
    };
    if (headers.productClass?.trim()) {
      h.productClass = headers.productClass.trim();
    }
    if (headers.version?.trim()) h.version = headers.version.trim();
    if (headers.oui?.trim()) h.oui = headers.oui.trim();
    const res = await fetch(`${this.root()}/files/${encoded}`, {
      method: 'PUT',
      headers: h,
      body: new Uint8Array(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `GenieACS file PUT ${res.status}: ${text.slice(0, 240)}`,
      );
    }
  }

  async deleteFile(fileName: string): Promise<void> {
    const encoded = encodeURIComponent(fileName);
    const res = await fetch(`${this.root()}/files/${encoded}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 404) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `GenieACS file DELETE ${res.status}: ${text.slice(0, 240)}`,
      );
    }
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
  if (typeof cur === 'object' && cur !== null) {
    const leaf = cur as {
      _value?: unknown;
      _type?: string;
      _object?: boolean;
      _writable?: boolean;
    };
    // GenieACS a veces descubre el path (_writable) antes de traer _value.
    if ('_value' in leaf || leaf._object === false || '_type' in leaf) {
      return { value: leaf._value, type: leaf._type };
    }
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

/** True if the dotted path exists in the GenieACS device document. */
export function genieNodeExists(obj: unknown, path: string): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const p of parts) {
    if (!cur || typeof cur !== 'object') return false;
    if (!(p in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur != null;
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
  return Object.keys(cur)
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

export function deviceIdMatchesSerial(
  deviceId: string,
  serial: string,
): boolean {
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
  return primitiveString(v.value);
}

export function boolVal(v: GenieParamValue | null): boolean | null {
  if (!v || v.value == null) return null;
  if (typeof v.value === 'boolean') return v.value;
  const s = primitiveString(v.value)?.toLowerCase();
  if (s === 'true' || s === '1') return true;
  if (s === 'false' || s === '0') return false;
  return null;
}
