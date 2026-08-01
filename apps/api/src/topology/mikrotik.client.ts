import { Injectable, Logger } from '@nestjs/common';
import * as https from 'https';
import { RouterOsApiClient } from './routeros-api.client';

export type MikroTikPortLinkStatus = 'up' | 'down' | 'disabled';

export interface MikroTikPortVlan {
  vlanId: number;
  mode: 'tagged' | 'untagged';
  /** RouterOS L3 interface for this VLAN (e.g. vlan10) when known */
  interfaceName?: string;
  /** CIDR addresses on that VLAN interface */
  ipAddresses?: string[];
  comment?: string;
}

export interface MikroTikPhysicalPort {
  name: string;
  defaultName?: string;
  macAddress?: string;
  disabled: boolean;
  running: boolean;
  /** Derived: disabled → disabled; running → up; else down */
  linkStatus: MikroTikPortLinkStatus;
  comment?: string;
  /** Primary IP (first) without mask — for compact display */
  ipAddress?: string | null;
  /** All addresses on this interface as CIDR strings */
  ipAddresses: string[];
  vlans: MikroTikPortVlan[];
}

export interface MikroTikIpAddress {
  id: string;
  address: string;
  interface: string;
  network?: string;
  disabled?: boolean;
}

export interface MikroTikProbeResult {
  ok: boolean;
  error?: string;
  identity?: string;
  version?: string;
  cpuLoad?: number;
  freeMemory?: number;
  totalMemory?: number;
  uptime?: string;
  boardName?: string;
  architecture?: string;
  /** Preferred °C from /system/health (cpu-temperature, temperature, …) */
  temperature?: number;
  physicalPorts?: MikroTikPhysicalPort[];
}

export interface MikroTikCommandResult {
  ok: boolean;
  error?: string;
  rows: Record<string, string>[];
}

/**
 * MikroTik RouterOS adapters:
 * - rest_https: HTTPS Basic Auth → /rest/* (www-ssl, typically :443)
 * - api_ssl: binary API over TLS (:8729) — full CLI parity
 * - api_plain: binary API TCP (:8728) — available but insecure
 *
 * Winbox (:8291) is proprietary GUI — not used here.
 */
@Injectable()
export class MikrotikClient {
  private readonly logger = new Logger(MikrotikClient.name);
  /** Serialize API sessions per device — MikroTik often allows few concurrent API logins. */
  private readonly deviceLocks = new Map<string, Promise<void>>();

  private deviceKey(host: string, port: number) {
    return `${host}:${port}`;
  }

  private async withDeviceLock<T>(
    host: string,
    port: number,
    fn: () => Promise<T>,
  ): Promise<T> {
    const key = this.deviceKey(host, port);
    const prev = this.deviceLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.deviceLocks.set(
      key,
      prev.then(() => gate).catch(() => gate),
    );
    await prev.catch(() => undefined);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  async probe(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
  }): Promise<MikroTikProbeResult> {
    const protocol = params.protocol ?? 'rest_https';
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        if (protocol === 'api_ssl' || protocol === 'api_plain') {
          return await this.probeApi({
            ...params,
            useTls: protocol === 'api_ssl',
          });
        }
        if (protocol === 'rest_https') {
          return await this.probeRest(params);
        }
        return {
          ok: false,
          error: `Unknown protocol: ${protocol}`,
        };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `MikroTik probe failed ${params.host} (${protocol}): ${message}`,
      );
      return { ok: false, error: message };
    }
  }

  /**
   * Execute an arbitrary RouterOS API print/command path via API-SSL/plain.
   * path example: `/system/resource` or `/interface`
   */
  async runPrint(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    path: string;
    useTls?: boolean;
  }): Promise<MikroTikCommandResult> {
    const client = new RouterOsApiClient(
      params.host,
      params.port,
      params.useTls ?? true,
    );
    try {
      await client.connect();
      await client.login(params.username, params.password);
      const rows = await client.print(params.path);
      return { ok: true, rows };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, rows: [] };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  /**
   * Run raw API words via API-SSL (e.g. ['/ip/address/print', '?disabled=false']).
   */
  async runWords(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    words: string[];
    useTls?: boolean;
  }): Promise<MikroTikCommandResult> {
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const client = new RouterOsApiClient(
          params.host,
          params.port,
          params.useTls ?? true,
        );
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const replies = await client.write(params.words);
          const trap = replies.find(
            (r) => r.type === '!trap' || r.type === '!fatal',
          );
          if (trap) {
            return {
              ok: false,
              error: trap.attrs.message || 'Command failed',
              rows: [],
            };
          }
          return {
            ok: true,
            rows: replies.filter((r) => r.type === '!re').map((r) => r.attrs),
          };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, rows: [] };
    }
  }

  /**
   * One login, many sequential commands (avoids TLS thrash on MikroTik).
   */
  async runWordsMany(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    commands: string[][];
    useTls?: boolean;
  }): Promise<MikroTikCommandResult[]> {
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const client = new RouterOsApiClient(
          params.host,
          params.port,
          params.useTls ?? true,
        );
        const out: MikroTikCommandResult[] = [];
        try {
          await client.connect();
          await client.login(params.username, params.password);
          for (const words of params.commands) {
            try {
              const replies = await client.write(words);
              const trap = replies.find(
                (r) => r.type === '!trap' || r.type === '!fatal',
              );
              if (trap) {
                out.push({
                  ok: false,
                  error: trap.attrs.message || 'Command failed',
                  rows: [],
                });
              } else {
                out.push({
                  ok: true,
                  rows: replies
                    .filter((r) => r.type === '!re')
                    .map((r) => r.attrs),
                });
              }
            } catch (err) {
              out.push({
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                rows: [],
              });
            }
          }
          return out;
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return params.commands.map(() => ({
        ok: false,
        error: message,
        rows: [] as Record<string, string>[],
      }));
    }
  }

  private async probeApi(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    useTls: boolean;
  }): Promise<MikroTikProbeResult> {
    const client = new RouterOsApiClient(
      params.host,
      params.port,
      params.useTls,
    );
    try {
      await client.connect();
      await client.login(params.username, params.password);

      // Sequential prints: concurrent tagged writes on one socket are flaky on some ROS.
      const resources = await client.print('/system/resource');
      const identities = await client.print('/system/identity');
      const ethernets = await client.print('/interface/ethernet');
      const addresses = await client.print('/ip/address');
      const bridgeVlans = await client
        .print('/interface/bridge/vlan')
        .catch(() => [] as Record<string, string>[]);
      const bridgePorts = await client
        .print('/interface/bridge/port')
        .catch(() => [] as Record<string, string>[]);
      const vlanIfaces = await client
        .print('/interface/vlan')
        .catch(() => [] as Record<string, string>[]);
      const health = await client
        .print('/system/health')
        .catch(() => [] as Record<string, string>[]);

      const res = resources[0];
      const id = identities[0];
      if (!res) {
        return { ok: false, error: 'Empty /system/resource reply' };
      }

      return {
        ok: true,
        identity: id?.name,
        version: res.version,
        cpuLoad: res['cpu-load'] != null ? Number(res['cpu-load']) : undefined,
        freeMemory:
          res['free-memory'] != null ? Number(res['free-memory']) : undefined,
        totalMemory:
          res['total-memory'] != null ? Number(res['total-memory']) : undefined,
        uptime: res.uptime,
        boardName: res['board-name'],
        architecture: res['architecture-name'],
        temperature: this.pickTemperature(health),
        physicalPorts: this.mapPhysicalPorts(
          ethernets,
          addresses,
          bridgeVlans,
          bridgePorts,
          vlanIfaces,
        ),
      };
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async probeRest(params: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<MikroTikProbeResult> {
    const base = `https://${params.host}:${params.port}/rest`;
    const auth =
      'Basic ' +
      Buffer.from(`${params.username}:${params.password}`).toString('base64');

    const [
      resource,
      identity,
      ethernetRaw,
      addressRaw,
      bridgeVlanRaw,
      bridgePortRaw,
      vlanIfaceRaw,
      healthRaw,
    ] = await Promise.all([
      this.httpsGetJson(`${base}/system/resource`, auth),
      this.httpsGetJson(`${base}/system/identity`, auth),
      this.httpsGetJson(`${base}/interface/ethernet`, auth).catch(() => []),
      this.httpsGetJson(`${base}/ip/address`, auth).catch(() => []),
      this.httpsGetJson(`${base}/interface/bridge/vlan`, auth).catch(() => []),
      this.httpsGetJson(`${base}/interface/bridge/port`, auth).catch(() => []),
      this.httpsGetJson(`${base}/interface/vlan`, auth).catch(() => []),
      this.httpsGetJson(`${base}/system/health`, auth).catch(() => []),
    ]);

    const res = Array.isArray(resource) ? resource[0] : resource;
    const id = Array.isArray(identity) ? identity[0] : identity;

    if (!res || typeof res !== 'object') {
      return { ok: false, error: 'Empty response from /system/resource' };
    }

    const toRows = (raw: unknown) =>
      (Array.isArray(raw) ? raw : raw ? [raw] : []).map((row) =>
        this.rowToStringMap(row),
      );

    const ethernets = toRows(ethernetRaw);
    const addresses = toRows(addressRaw);
    const bridgeVlans = toRows(bridgeVlanRaw);
    const bridgePorts = toRows(bridgePortRaw);
    const vlanIfaces = toRows(vlanIfaceRaw);
    const health = toRows(healthRaw);

    return {
      ok: true,
      identity:
        id && typeof id === 'object' && 'name' in id
          ? String((id as { name: string }).name)
          : undefined,
      version:
        res['version'] != null
          ? // RouterOS values are scalar at runtime.
            // eslint-disable-next-line @typescript-eslint/no-base-to-string
            String(res['version'])
          : undefined,
      cpuLoad: res['cpu-load'] != null ? Number(res['cpu-load']) : undefined,
      freeMemory:
        res['free-memory'] != null ? Number(res['free-memory']) : undefined,
      totalMemory:
        res['total-memory'] != null ? Number(res['total-memory']) : undefined,
      uptime:
        res['uptime'] != null
          ? // eslint-disable-next-line @typescript-eslint/no-base-to-string
            String(res['uptime'])
          : undefined,
      boardName:
        res['board-name'] != null
          ? // eslint-disable-next-line @typescript-eslint/no-base-to-string
            String(res['board-name'])
          : undefined,
      architecture:
        res['architecture-name'] != null
          ? // eslint-disable-next-line @typescript-eslint/no-base-to-string
            String(res['architecture-name'])
          : undefined,
      temperature: this.pickTemperature(health),
      physicalPorts: this.mapPhysicalPorts(
        ethernets,
        addresses,
        bridgeVlans,
        bridgePorts,
        vlanIfaces,
      ),
    };
  }

  private rowToStringMap(row: unknown): Record<string, string> {
    if (!row || typeof row !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
      if (v == null) continue;
      if (Array.isArray(v)) out[k] = v.map(String).join(',');
      // RouterOS API attributes are scalar; preserve the existing coercion.
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      else out[k] = String(v);
    }
    return out;
  }

  private mapPhysicalPorts(
    ethernets: Record<string, string>[],
    addresses: Record<string, string>[],
    bridgeVlans: Record<string, string>[] = [],
    bridgePorts: Record<string, string>[] = [],
    vlanIfaces: Record<string, string>[] = [],
  ): MikroTikPhysicalPort[] {
    const ipsByIface = new Map<string, string[]>();
    for (const addr of addresses) {
      const iface = addr.interface;
      const raw = addr.address?.trim();
      if (!iface || !raw) continue;
      const list = ipsByIface.get(iface) ?? [];
      if (!list.includes(raw)) list.push(raw);
      ipsByIface.set(iface, list);
    }

    const portNames = new Set<string>();
    for (const eth of ethernets) {
      const name = eth.name || eth['default-name'];
      if (name) portNames.add(name);
    }

    const vlansByPort = this.buildVlansByPort(
      portNames,
      bridgeVlans,
      bridgePorts,
      vlanIfaces,
      ipsByIface,
    );

    const mapped: MikroTikPhysicalPort[] = [];
    for (const eth of ethernets) {
      const name = eth.name || eth['default-name'];
      if (!name) continue;
      const disabled = this.isTruthy(eth.disabled);
      const running = this.isTruthy(eth.running);
      const ipAddresses = ipsByIface.get(name) ?? [];
      mapped.push({
        name,
        defaultName: eth['default-name'] || undefined,
        macAddress: eth['mac-address'] || undefined,
        disabled,
        running,
        linkStatus: disabled ? 'disabled' : running ? 'up' : 'down',
        comment: eth.comment || undefined,
        ipAddresses,
        ipAddress: ipAddresses[0]?.split('/')[0] ?? null,
        vlans: vlansByPort.get(name) ?? [],
      });
    }
    return mapped.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }

  /**
   * Build per-port VLAN membership from:
   * - /interface/bridge/vlan (tagged / untagged)
   * - /interface/bridge/port pvid (access / native)
   * - /interface/vlan on a physical parent
   * Attaches L3 interfaceName + IPs when a matching /interface/vlan exists.
   */
  private buildVlansByPort(
    portNames: Set<string>,
    bridgeVlans: Record<string, string>[],
    bridgePorts: Record<string, string>[],
    vlanIfaces: Record<string, string>[],
    ipsByIface: Map<string, string[]>,
  ): Map<string, MikroTikPortVlan[]> {
    /** port → vlanId → mode (untagged wins over tagged) */
    const map = new Map<string, Map<number, 'tagged' | 'untagged'>>();

    const ensure = (port: string) => {
      if (!map.has(port)) map.set(port, new Map());
      return map.get(port)!;
    };

    const add = (port: string, vlanId: number, mode: 'tagged' | 'untagged') => {
      if (!portNames.has(port) || !Number.isFinite(vlanId) || vlanId < 1) {
        return;
      }
      const modes = ensure(port);
      const prev = modes.get(vlanId);
      if (prev === 'untagged') return;
      if (mode === 'untagged' || !prev) modes.set(vlanId, mode);
    };

    for (const row of bridgeVlans) {
      const ids = this.parseVlanIds(row['vlan-ids'] ?? row.vlanIds ?? '');
      for (const vlanId of ids) {
        for (const iface of this.parseIfaceList(row.tagged)) {
          add(iface, vlanId, 'tagged');
        }
        for (const iface of this.parseIfaceList(row.untagged)) {
          add(iface, vlanId, 'untagged');
        }
      }
    }

    const portToBridge = new Map<string, string>();
    for (const row of bridgePorts) {
      const iface = row.interface;
      const pvid = Number(row.pvid);
      if (iface && row.bridge) portToBridge.set(iface, row.bridge);
      if (iface && Number.isFinite(pvid) && pvid > 0) {
        add(iface, pvid, 'untagged');
      }
    }

    /** vlanId → vlan interface definitions */
    const vlanDefs = new Map<
      number,
      Array<{ name: string; parent: string; comment?: string }>
    >();
    for (const row of vlanIfaces) {
      const parent = row.interface;
      const name = row.name;
      const vlanId = Number(row['vlan-id'] ?? row.vlanId);
      if (!parent || !name || !Number.isFinite(vlanId)) continue;
      add(parent, vlanId, 'tagged');
      const list = vlanDefs.get(vlanId) ?? [];
      list.push({
        name,
        parent,
        comment: row.comment?.trim() || undefined,
      });
      vlanDefs.set(vlanId, list);
    }

    const resolveVlanIface = (
      port: string,
      vlanId: number,
    ): { name: string; comment?: string } | undefined => {
      const defs = vlanDefs.get(vlanId) ?? [];
      if (defs.length === 0) return undefined;
      const onPort = defs.find((d) => d.parent === port);
      if (onPort) return onPort;
      const bridge = portToBridge.get(port);
      if (bridge) {
        const onBridge = defs.find((d) => d.parent === bridge);
        if (onBridge) return onBridge;
      }
      return defs[0];
    };

    const out = new Map<string, MikroTikPortVlan[]>();
    for (const [port, modes] of map) {
      const list: MikroTikPortVlan[] = [...modes.entries()]
        .map(([vlanId, mode]) => {
          const resolved = resolveVlanIface(port, vlanId);
          const interfaceName = resolved?.name;
          return {
            vlanId,
            mode,
            interfaceName,
            comment: resolved?.comment,
            ipAddresses: interfaceName
              ? (ipsByIface.get(interfaceName) ?? [])
              : [],
          };
        })
        .sort((a, b) => a.vlanId - b.vlanId);
      out.set(port, list);
    }
    return out;
  }

  private parseIfaceList(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== '*');
  }

  /** Parse RouterOS vlan-ids: "10,20,30-32" → [10,20,30,31,32] */
  private parseVlanIds(raw: string): number[] {
    if (!raw) return [];
    const ids = new Set<number>();
    for (const part of raw.split(/[,;]/)) {
      const token = part.trim();
      if (!token) continue;
      const range = /^(\d+)\s*-\s*(\d+)$/.exec(token);
      if (range) {
        let from = Number(range[1]);
        let to = Number(range[2]);
        if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
        if (from > to) [from, to] = [to, from];
        // Cap expansion to avoid huge ranges
        if (to - from > 256) to = from + 256;
        for (let i = from; i <= to; i++) ids.add(i);
        continue;
      }
      const n = Number(token);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
    return [...ids];
  }

  private isTruthy(value: string | undefined): boolean {
    if (value == null || value === '') return false;
    const v = value.toLowerCase();
    return v === 'true' || v === 'yes' || v === '1';
  }

  /** Prefer CPU temp, then board/main temperature sensors. */
  private pickTemperature(
    healthRows: Record<string, string>[],
  ): number | undefined {
    if (!healthRows.length) return undefined;
    const byName = new Map<string, number>();
    for (const row of healthRows) {
      const name = (row.name ?? '').toLowerCase();
      if (!name) continue;
      const raw = row.value ?? row['value'];
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      // Some older paths report tenths of a degree
      const value = n > 200 ? n / 10 : n;
      byName.set(name, value);
    }
    for (const key of [
      'cpu-temperature',
      'temperature',
      'board-temperature1',
      'pcb-temperature',
      'phy-temperature',
    ]) {
      const v = byName.get(key);
      if (v != null && Number.isFinite(v)) return Math.round(v * 10) / 10;
    }
    return undefined;
  }

  /**
   * List /ip/address entries for one interface (live from device).
   */
  async listInterfaceAddresses(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    interfaceName: string;
  }): Promise<{ ok: boolean; error?: string; addresses: MikroTikIpAddress[] }> {
    try {
      return await this.withDeviceLock(params.host, params.port, () =>
        this.listInterfaceAddressesUnlocked(params),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, addresses: [] };
    }
  }

  private async listInterfaceAddressesUnlocked(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    interfaceName: string;
  }): Promise<{ ok: boolean; error?: string; addresses: MikroTikIpAddress[] }> {
    try {
      const protocol = params.protocol ?? 'api_ssl';
      const rows =
        protocol === 'rest_https'
          ? await this.restListAddresses(params)
          : await this.apiListAddresses({
              ...params,
              useTls: protocol !== 'api_plain',
            });
      const want = params.interfaceName.toLowerCase();
      const addresses = rows
        .filter((r) => (r.interface || '').toLowerCase() === want)
        .map((r) => ({
          id: r['.id'] || r.id || '',
          address: r.address,
          interface: r.interface,
          network: r.network,
          disabled: this.isTruthy(r.disabled),
        }))
        .filter((a) => !!a.address);
      return { ok: true, addresses };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, addresses: [] };
    }
  }

  /**
   * Apply desired address list for an interface.
   * Re-reads live state, then set/add/remove to match desired.
   */
  async applyInterfaceAddresses(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    interfaceName: string;
    desired: Array<{ id?: string; address: string }>;
  }): Promise<{ ok: boolean; error?: string; addresses: MikroTikIpAddress[] }> {
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const listed = await this.listInterfaceAddressesUnlocked(params);
        if (!listed.ok) return listed;

        const desired = params.desired
          .map((d) => ({
            id: d.id?.trim() || undefined,
            address: d.address.trim(),
          }))
          .filter((d) => d.address.length > 0);

        const current = listed.addresses.filter((a) => !!a.id);
        const currentById = new Map(current.map((a) => [a.id, a]));
        const currentByAddress = new Map(current.map((a) => [a.address, a]));

        // Match desired rows to live entries by id, else by address
        const matchedDesired: Array<{ id?: string; address: string }> =
          desired.map((d) => {
            if (d.id && currentById.has(d.id)) {
              return d;
            }
            const byAddr = currentByAddress.get(d.address);
            if (byAddr) return { id: byAddr.id, address: d.address };
            return { address: d.address };
          });

        const desiredIds = new Set(
          matchedDesired.map((d) => d.id).filter((id): id is string => !!id),
        );

        const toRemove = current.filter((c) => !desiredIds.has(c.id));
        const toUpdate = matchedDesired.filter(
          (d) =>
            d.id &&
            currentById.has(d.id) &&
            currentById.get(d.id)!.address !== d.address,
        );
        const toAdd = matchedDesired.filter((d) => !d.id);

        const protocol = params.protocol ?? 'api_ssl';
        if (protocol === 'rest_https') {
          for (const row of toRemove) {
            await this.httpsRequestJson(
              `https://${params.host}:${params.port}/rest/ip/address/${encodeURIComponent(row.id)}`,
              'DELETE',
              params.username,
              params.password,
            );
          }
          for (const row of toUpdate) {
            await this.httpsRequestJson(
              `https://${params.host}:${params.port}/rest/ip/address/${encodeURIComponent(row.id!)}`,
              'PATCH',
              params.username,
              params.password,
              { address: row.address },
            );
          }
          for (const row of toAdd) {
            await this.httpsRequestJson(
              `https://${params.host}:${params.port}/rest/ip/address`,
              'PUT',
              params.username,
              params.password,
              {
                address: row.address,
                interface: params.interfaceName,
              },
            );
          }
        } else {
          const useTls = protocol !== 'api_plain';
          const client = new RouterOsApiClient(
            params.host,
            params.port,
            useTls,
          );
          try {
            await client.connect();
            await client.login(params.username, params.password);
            for (const row of toRemove) {
              await this.apiExpectOk(client, [
                '/ip/address/remove',
                `=.id=${row.id}`,
              ]);
            }
            for (const row of toUpdate) {
              await this.apiExpectOk(client, [
                '/ip/address/set',
                `=.id=${row.id}`,
                `=address=${row.address}`,
              ]);
            }
            for (const row of toAdd) {
              await this.apiExpectOk(client, [
                '/ip/address/add',
                `=address=${row.address}`,
                `=interface=${params.interfaceName}`,
              ]);
            }
          } finally {
            await client.close().catch(() => undefined);
          }
        }

        return this.listInterfaceAddressesUnlocked(params);
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, addresses: [] };
    }
  }

  /**
   * Ensure gateway/prefix exists as /ip/address on interface (typically vlan_N).
   * Does not remove unrelated addresses on the same interface.
   * If previousAddress differs, updates that entry or removes it after adding the new one.
   * Uses a single device session to avoid MikroTik "connection closed" from nested logins.
   */
  async upsertGatewayAddress(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    interfaceName: string;
    address: string;
    previousAddress?: string;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const want = params.address.trim();
    const prev = params.previousAddress?.trim();
    const iface = params.interfaceName;
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';

        if (protocol === 'rest_https') {
          const listed = await this.listInterfaceAddressesUnlocked(params);
          if (!listed.ok) {
            return {
              ok: false,
              error: listed.error || 'No se pudo listar IPs',
            };
          }
          return this.applyGatewayUpsertOnListed({
            listed: listed.addresses,
            want,
            prev,
            iface,
            add: async () => {
              try {
                await this.httpsRequestJson(
                  `https://${params.host}:${params.port}/rest/ip/address`,
                  'PUT',
                  params.username,
                  params.password,
                  { address: want, interface: iface },
                );
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/already|exist|such/i.test(msg)) return;
                throw err;
              }
            },
            set: async (id, address) => {
              await this.httpsRequestJson(
                `https://${params.host}:${params.port}/rest/ip/address/${encodeURIComponent(id)}`,
                'PATCH',
                params.username,
                params.password,
                { address },
              );
            },
            remove: async (id) => {
              await this.httpsRequestJson(
                `https://${params.host}:${params.port}/rest/ip/address/${encodeURIComponent(id)}`,
                'DELETE',
                params.username,
                params.password,
              );
            },
          });
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const rows = await client.print('/ip/address');
          const wantIface = iface.toLowerCase();
          const addresses = rows
            .map((r) => ({
              id: r['.id'] || r.id || '',
              address: r.address || '',
              interface: r.interface || '',
              network: r.network,
              disabled: this.isTruthy(r.disabled),
            }))
            .filter(
              (a) =>
                !!a.address && (a.interface || '').toLowerCase() === wantIface,
            );

          return await this.applyGatewayUpsertOnListed({
            listed: addresses,
            want,
            prev,
            iface,
            add: async () => {
              try {
                await this.apiExpectOk(client, [
                  '/ip/address/add',
                  `=address=${want}`,
                  `=interface=${iface}`,
                ]);
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                if (/already|exist|such/i.test(msg)) return;
                throw err;
              }
            },
            set: async (id, address) => {
              await this.apiExpectOk(client, [
                '/ip/address/set',
                `=.id=${id}`,
                `=address=${address}`,
              ]);
            },
            remove: async (id) => {
              await this.apiExpectOk(client, [
                '/ip/address/remove',
                `=.id=${id}`,
              ]);
            },
          });
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already|exist|such/i.test(message)) {
        return { ok: true, message: 'gateway ya estaba en el Router' };
      }
      return { ok: false, error: message };
    }
  }

  /** Compare /ip/address values ignoring minor formatting differences. */
  private addressKey(addr: string): string {
    const t = addr.trim().toLowerCase();
    const [ip, prefix] = t.split('/');
    return prefix ? `${ip}/${prefix}` : ip;
  }

  private findAddressRow(
    listed: Array<{ id: string; address: string }>,
    address: string,
  ) {
    const key = this.addressKey(address);
    const ipOnly = key.split('/')[0];
    return (
      listed.find((a) => this.addressKey(a.address) === key) ??
      listed.find((a) => this.addressKey(a.address).split('/')[0] === ipOnly) ??
      undefined
    );
  }

  private async applyGatewayUpsertOnListed(params: {
    listed: Array<{ id: string; address: string }>;
    want: string;
    prev?: string;
    iface: string;
    add: () => Promise<void>;
    set: (id: string, address: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
  }): Promise<{ ok: boolean; error?: string; message?: string }> {
    const { listed, want, prev } = params;
    const existing = this.findAddressRow(listed, want);
    if (existing) {
      if (prev && this.addressKey(prev) !== this.addressKey(want)) {
        const old = this.findAddressRow(listed, prev);
        if (old?.id && old.id !== existing.id) {
          await params.remove(old.id);
        }
      }
      return { ok: true, message: 'gateway ya estaba en el Router' };
    }

    const old =
      prev && this.addressKey(prev) !== this.addressKey(want)
        ? this.findAddressRow(listed, prev)
        : undefined;
    if (old?.id) {
      await params.set(old.id, want);
      return { ok: true, message: `gateway actualizado → ${want}` };
    }

    await params.add();
    return { ok: true, message: `gateway añadido en el Router: ${want}` };
  }

  /** Remove a specific /ip/address from an interface if present. */
  async removeGatewayAddress(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    interfaceName: string;
    address: string;
  }): Promise<{ ok: boolean; error?: string; missing?: boolean }> {
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const listed = await this.listInterfaceAddressesUnlocked(params);
        if (!listed.ok) {
          return { ok: false, error: listed.error || 'No se pudo listar IPs' };
        }
        const row = this.findAddressRow(
          listed.addresses,
          params.address.trim(),
        );
        if (!row?.id) return { ok: true, missing: true };

        const protocol = params.protocol ?? 'api_ssl';
        if (protocol === 'rest_https') {
          await this.httpsRequestJson(
            `https://${params.host}:${params.port}/rest/ip/address/${encodeURIComponent(row.id)}`,
            'DELETE',
            params.username,
            params.password,
          );
          return { ok: true };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          await this.apiExpectOk(client, [
            '/ip/address/remove',
            `=.id=${row.id}`,
          ]);
          return { ok: true };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /**
   * Create /interface/vlan on a parent port.
   * Name is always `vlan_<id>` (e.g. vlan_10).
   */
  async createVlanInterface(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    parentInterface: string;
    vlanId: number;
    comment?: string;
  }): Promise<{ ok: boolean; error?: string; name?: string }> {
    const name = `vlan_${params.vlanId}`;
    const comment = params.comment?.trim() ?? '';
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';

        if (protocol === 'rest_https') {
          const body: Record<string, string | number> = {
            name,
            interface: params.parentInterface,
            'vlan-id': params.vlanId,
          };
          if (comment) body.comment = comment;
          await this.httpsRequestJson(
            `https://${params.host}:${params.port}/rest/interface/vlan`,
            'PUT',
            params.username,
            params.password,
            body,
          );
          return { ok: true, name };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const words = [
            '/interface/vlan/add',
            `=name=${name}`,
            `=interface=${params.parentInterface}`,
            `=vlan-id=${params.vlanId}`,
          ];
          if (comment) words.push(`=comment=${comment}`);
          await this.apiExpectOk(client, words);
          return { ok: true, name };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /** Set comment on any RouterOS interface (ethernet, vlan, …) by name. */
  async setInterfaceComment(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    interfaceName: string;
    comment: string;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';
        const comment = params.comment.trim();

        if (protocol === 'rest_https') {
          const auth =
            'Basic ' +
            Buffer.from(`${params.username}:${params.password}`).toString(
              'base64',
            );
          const raw = await this.httpsGetJson(
            `https://${params.host}:${params.port}/rest/interface?name=${encodeURIComponent(params.interfaceName)}`,
            auth,
          );
          const rows = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((r) =>
            this.rowToStringMap(r),
          );
          const row =
            rows.find((r) => r.name === params.interfaceName) ?? rows[0];
          const id = row?.['.id'] || row?.id;
          if (!id) {
            return {
              ok: false,
              error: `Interfaz ${params.interfaceName} no encontrada`,
            };
          }
          await this.httpsRequestJson(
            `https://${params.host}:${params.port}/rest/interface/${encodeURIComponent(id)}`,
            'PATCH',
            params.username,
            params.password,
            { comment },
          );
          return { ok: true };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const found = await client.write([
            '/interface/print',
            `?name=${params.interfaceName}`,
          ]);
          const trap = found.find(
            (r) => r.type === '!trap' || r.type === '!fatal',
          );
          if (trap) {
            return {
              ok: false,
              error: trap.attrs.message || 'No se pudo buscar la interfaz',
            };
          }
          const re = found.find((r) => r.type === '!re');
          const id = re?.attrs['.id'];
          if (!id) {
            return {
              ok: false,
              error: `Interfaz ${params.interfaceName} no encontrada`,
            };
          }
          await this.apiExpectOk(client, [
            '/interface/set',
            `=.id=${id}`,
            `=comment=${comment}`,
          ]);
          return { ok: true };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  /** Delete /interface/vlan by VLAN id (name `vlan_<id>`). */
  async deleteVlanInterface(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    vlanId: number;
  }): Promise<{ ok: boolean; error?: string; missing?: boolean }> {
    const name = `vlan_${params.vlanId}`;
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';

        if (protocol === 'rest_https') {
          const auth =
            'Basic ' +
            Buffer.from(`${params.username}:${params.password}`).toString(
              'base64',
            );
          const raw = await this.httpsGetJson(
            `https://${params.host}:${params.port}/rest/interface/vlan`,
            auth,
          );
          const rows = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((r) =>
            this.rowToStringMap(r),
          );
          const row = rows.find(
            (r) => r.name === name || Number(r['vlan-id']) === params.vlanId,
          );
          const id = row?.['.id'] || row?.id;
          if (!id) return { ok: true, missing: true };
          await this.httpsRequestJson(
            `https://${params.host}:${params.port}/rest/interface/vlan/${encodeURIComponent(id)}`,
            'DELETE',
            params.username,
            params.password,
          );
          return { ok: true };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const found = await client.write([
            '/interface/vlan/print',
            `?vlan-id=${params.vlanId}`,
          ]);
          const trap = found.find(
            (r) => r.type === '!trap' || r.type === '!fatal',
          );
          if (trap) {
            return {
              ok: false,
              error: trap.attrs.message || 'No se pudo buscar la VLAN',
            };
          }
          const re = found.find((r) => r.type === '!re');
          const id = re?.attrs['.id'];
          if (!id) return { ok: true, missing: true };
          await this.apiExpectOk(client, [
            '/interface/vlan/remove',
            `=.id=${id}`,
          ]);
          return { ok: true };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  }

  private async apiExpectOk(
    client: RouterOsApiClient,
    words: string[],
  ): Promise<void> {
    const replies = await client.write(words);
    const trap = replies.find((r) => r.type === '!trap' || r.type === '!fatal');
    if (trap) {
      throw new Error(trap.attrs.message || 'Command failed');
    }
  }

  private async apiListAddresses(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    useTls: boolean;
  }): Promise<Record<string, string>[]> {
    const client = new RouterOsApiClient(
      params.host,
      params.port,
      params.useTls,
    );
    try {
      await client.connect();
      await client.login(params.username, params.password);
      return client.print('/ip/address');
    } finally {
      await client.close().catch(() => undefined);
    }
  }

  private async restListAddresses(params: {
    host: string;
    port: number;
    username: string;
    password: string;
  }): Promise<Record<string, string>[]> {
    const auth =
      'Basic ' +
      Buffer.from(`${params.username}:${params.password}`).toString('base64');
    const raw = await this.httpsGetJson(
      `https://${params.host}:${params.port}/rest/ip/address`,
      auth,
    );
    return (Array.isArray(raw) ? raw : raw ? [raw] : []).map((row) =>
      this.rowToStringMap(row),
    );
  }

  private httpsRequestJson(
    url: string,
    method: string,
    username: string,
    password: string,
    body?: Record<string, unknown>,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const auth =
        'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      const payload = body ? JSON.stringify(body) : undefined;
      const req = https.request(
        {
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method,
          headers: {
            Authorization: auth,
            Accept: 'application/json',
            ...(payload
              ? {
                  'Content-Type': 'application/json',
                  'Content-Length': Buffer.byteLength(payload),
                }
              : {}),
          },
          rejectUnauthorized: false,
          timeout: 15_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 500) >= 400) {
              reject(
                new Error(
                  `HTTP ${res.statusCode}${text ? `: ${text.slice(0, 200)}` : ''}`,
                ),
              );
              return;
            }
            if (!text) {
              resolve(null);
              return;
            }
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve(text);
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timeout'));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  private httpsGetJson(
    url: string,
    auth: string,
  ): Promise<Record<string, unknown> | Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request(
        {
          hostname: u.hostname,
          port: u.port || 443,
          path: u.pathname + u.search,
          method: 'GET',
          headers: {
            Authorization: auth,
            Accept: 'application/json',
          },
          rejectUnauthorized: false,
          timeout: 12_000,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            if ((res.statusCode ?? 500) >= 400) {
              reject(
                new Error(
                  `HTTP ${res.statusCode}${text ? `: ${text.slice(0, 200)}` : ''}`,
                ),
              );
              return;
            }
            try {
              resolve(
                JSON.parse(text) as
                  Record<string, unknown> | Record<string, unknown>[],
              );
            } catch {
              reject(new Error('Invalid JSON from MikroTik'));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Connection timeout'));
      });
      req.end();
    });
  }

  private restRows(raw: unknown): Record<string, string>[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((row) => {
      const out: Record<string, string> = {};
      if (!row || typeof row !== 'object') return out;
      for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
        out[k] = v == null ? '' : String(v);
      }
      return out;
    });
  }

  private restId(row: Record<string, string>): string | undefined {
    const id = row['.id'] || row.id;
    return id || undefined;
  }

  // —— Bridge / VLAN filtering (CRS / switch-mode RouterOS) ——

  async getBridgeConfig(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
  }): Promise<{
    ok: boolean;
    error?: string;
    bridges?: Array<{
      name: string;
      vlanFiltering: boolean;
      disabled: boolean;
    }>;
    ports?: Array<{
      id?: string;
      interface: string;
      bridge: string;
      pvid: number;
      disabled: boolean;
    }>;
    vlans?: Array<{
      id?: string;
      vlanIds: number[];
      bridge: string;
      tagged: string[];
      untagged: string[];
    }>;
  }> {
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';
        const parseIds = (raw: string) =>
          raw
            .split(/[,\s-]+/)
            .map((s) => Number(s))
            .filter((n) => Number.isFinite(n) && n >= 1 && n <= 4094);
        const parseList = (raw?: string) =>
          (raw ?? '')
            .split(/[,\s]+/)
            .map((s) => s.trim())
            .filter(Boolean);

        const asRows = (raw: unknown) => this.restRows(raw);
        const str = (v: unknown) => (v == null ? '' : String(v));

        if (protocol === 'rest_https') {
          const base = `https://${params.host}:${params.port}/rest`;
          const auth =
            'Basic ' +
            Buffer.from(`${params.username}:${params.password}`).toString(
              'base64',
            );
          const [bridgesRaw, portsRaw, vlansRaw] = await Promise.all([
            this.httpsGetJson(`${base}/interface/bridge`, auth).catch(
              () => [] as unknown,
            ),
            this.httpsGetJson(`${base}/interface/bridge/port`, auth).catch(
              () => [] as unknown,
            ),
            this.httpsGetJson(`${base}/interface/bridge/vlan`, auth).catch(
              () => [] as unknown,
            ),
          ]);
          const bridges = asRows(bridgesRaw);
          const ports = asRows(portsRaw);
          const vlans = asRows(vlansRaw);
          return {
            ok: true,
            bridges: bridges.map((b) => ({
              name: str(b.name),
              vlanFiltering: this.isTruthy(b['vlan-filtering']),
              disabled: this.isTruthy(b.disabled),
            })),
            ports: ports.map((p) => ({
              id: str(p['.id'] || p.id) || undefined,
              interface: str(p.interface),
              bridge: str(p.bridge),
              pvid: Number(p.pvid) || 1,
              disabled: this.isTruthy(p.disabled),
            })),
            vlans: vlans.map((v) => ({
              id: str(v['.id'] || v.id) || undefined,
              vlanIds: parseIds(str(v['vlan-ids'])),
              bridge: str(v.bridge),
              tagged: parseList(str(v.tagged)),
              untagged: parseList(str(v.untagged)),
            })),
          };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const bridges = await client.print('/interface/bridge');
          const ports = await client
            .print('/interface/bridge/port')
            .catch(() => [] as Record<string, string>[]);
          const vlans = await client
            .print('/interface/bridge/vlan')
            .catch(() => [] as Record<string, string>[]);
          return {
            ok: true,
            bridges: bridges.map((b) => ({
              name: b.name || '',
              vlanFiltering: this.isTruthy(b['vlan-filtering']),
              disabled: this.isTruthy(b.disabled),
            })),
            ports: ports.map((p) => ({
              id: p['.id'],
              interface: p.interface || '',
              bridge: p.bridge || '',
              pvid: Number(p.pvid) || 1,
              disabled: this.isTruthy(p.disabled),
            })),
            vlans: vlans.map((v) => ({
              id: v['.id'],
              vlanIds: parseIds(v['vlan-ids'] || ''),
              bridge: v.bridge || '',
              tagged: parseList(v.tagged),
              untagged: parseList(v.untagged),
            })),
          };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async ensureBridge(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    name?: string;
    vlanFiltering?: boolean;
  }): Promise<{ ok: boolean; error?: string; name?: string }> {
    const name = params.name?.trim() || 'bridge';
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';
        const vlanFiltering = params.vlanFiltering !== false;

        if (protocol === 'rest_https') {
          const base = `https://${params.host}:${params.port}/rest/interface/bridge`;
          const auth =
            'Basic ' +
            Buffer.from(`${params.username}:${params.password}`).toString(
              'base64',
            );
          const list = await this.httpsGetJson(base, auth).catch(
            () => [] as unknown,
          );
          const rows = this.restRows(list);
          const existing = rows.find((b) => b.name === name);
          if (existing) {
            const id = this.restId(existing);
            if (
              id &&
              vlanFiltering &&
              !this.isTruthy(existing['vlan-filtering'])
            ) {
              await this.httpsRequestJson(
                `${base}/${encodeURIComponent(id)}`,
                'PATCH',
                params.username,
                params.password,
                { 'vlan-filtering': 'true' },
              );
            }
            return { ok: true, name };
          }
          await this.httpsRequestJson(
            base,
            'PUT',
            params.username,
            params.password,
            {
              name,
              'vlan-filtering': vlanFiltering ? 'true' : 'false',
            },
          );
          return { ok: true, name };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const bridges = await client.print('/interface/bridge');
          const existing = bridges.find((b) => b.name === name);
          if (existing?.['.id']) {
            if (
              vlanFiltering &&
              !this.isTruthy(existing['vlan-filtering'])
            ) {
              await client.write([
                '/interface/bridge/set',
                `=.id=${existing['.id']}`,
                '=vlan-filtering=yes',
              ]);
            }
            return { ok: true, name };
          }
          await client.write([
            '/interface/bridge/add',
            `=name=${name}`,
            `=vlan-filtering=${vlanFiltering ? 'yes' : 'no'}`,
          ]);
          return { ok: true, name };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async setBridgePort(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    interfaceName: string;
    bridge: string;
    pvid?: number;
  }): Promise<{ ok: boolean; error?: string }> {
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';
        const pvid =
          params.pvid != null && Number.isFinite(params.pvid)
            ? params.pvid
            : 1;

        if (protocol === 'rest_https') {
          const base = `https://${params.host}:${params.port}/rest/interface/bridge/port`;
          const auth =
            'Basic ' +
            Buffer.from(`${params.username}:${params.password}`).toString(
              'base64',
            );
          const list = await this.httpsGetJson(base, auth).catch(
            () => [] as unknown,
          );
          const rows = this.restRows(list);
          const existing = rows.find(
            (p) => p.interface === params.interfaceName,
          );
          if (existing) {
            const id = this.restId(existing);
            await this.httpsRequestJson(
              `${base}/${encodeURIComponent(id!)}`,
              'PATCH',
              params.username,
              params.password,
              {
                bridge: params.bridge,
                pvid: String(pvid),
              },
            );
            return { ok: true };
          }
          await this.httpsRequestJson(
            base,
            'PUT',
            params.username,
            params.password,
            {
              interface: params.interfaceName,
              bridge: params.bridge,
              pvid: String(pvid),
            },
          );
          return { ok: true };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const ports = await client.print('/interface/bridge/port');
          const existing = ports.find(
            (p) => p.interface === params.interfaceName,
          );
          if (existing?.['.id']) {
            await client.write([
              '/interface/bridge/port/set',
              `=.id=${existing['.id']}`,
              `=bridge=${params.bridge}`,
              `=pvid=${pvid}`,
            ]);
          } else {
            await client.write([
              '/interface/bridge/port/add',
              `=interface=${params.interfaceName}`,
              `=bridge=${params.bridge}`,
              `=pvid=${pvid}`,
            ]);
          }
          return { ok: true };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async upsertBridgeVlan(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    bridge: string;
    vlanId: number;
    tagged: string[];
    untagged: string[];
  }): Promise<{ ok: boolean; error?: string }> {
    const vlanIds = String(params.vlanId);
    const tagged = params.tagged.filter(Boolean).join(',');
    const untagged = params.untagged.filter(Boolean).join(',');
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';

        if (protocol === 'rest_https') {
          const base = `https://${params.host}:${params.port}/rest/interface/bridge/vlan`;
          const auth =
            'Basic ' +
            Buffer.from(`${params.username}:${params.password}`).toString(
              'base64',
            );
          const list = await this.httpsGetJson(base, auth).catch(
            () => [] as unknown,
          );
          const rows = this.restRows(list);
          const existing = rows.find((v) => {
            const ids = (v['vlan-ids'] || '')
              .split(/[,\s-]+/)
              .map(Number);
            return v.bridge === params.bridge && ids.includes(params.vlanId);
          });
          const body: Record<string, string> = {
            bridge: params.bridge,
            'vlan-ids': vlanIds,
            tagged,
            untagged,
          };
          if (existing) {
            const id = this.restId(existing);
            await this.httpsRequestJson(
              `${base}/${encodeURIComponent(id!)}`,
              'PATCH',
              params.username,
              params.password,
              body,
            );
          } else {
            await this.httpsRequestJson(
              base,
              'PUT',
              params.username,
              params.password,
              body,
            );
          }
          return { ok: true };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const vlans = await client.print('/interface/bridge/vlan');
          const existing = vlans.find((v) => {
            const ids = (v['vlan-ids'] || '')
              .split(/[,\s-]+/)
              .map(Number);
            return v.bridge === params.bridge && ids.includes(params.vlanId);
          });
          if (existing?.['.id']) {
            await client.write([
              '/interface/bridge/vlan/set',
              `=.id=${existing['.id']}`,
              `=bridge=${params.bridge}`,
              `=vlan-ids=${vlanIds}`,
              `=tagged=${tagged}`,
              `=untagged=${untagged}`,
            ]);
          } else {
            await client.write([
              '/interface/bridge/vlan/add',
              `=bridge=${params.bridge}`,
              `=vlan-ids=${vlanIds}`,
              `=tagged=${tagged}`,
              `=untagged=${untagged}`,
            ]);
          }
          return { ok: true };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** Remove a bridge VLAN filtering entry (idempotent if missing). */
  async removeBridgeVlan(params: {
    host: string;
    port: number;
    username: string;
    password: string;
    protocol?: string;
    bridge: string;
    vlanId: number;
  }): Promise<{ ok: boolean; error?: string; missing?: boolean }> {
    try {
      return await this.withDeviceLock(params.host, params.port, async () => {
        const protocol = params.protocol ?? 'api_ssl';
        const matchRow = (bridge: string, vlanIdsRaw: string) => {
          const ids = vlanIdsRaw
            .split(/[,\s-]+/)
            .map(Number)
            .filter((n) => Number.isFinite(n));
          return bridge === params.bridge && ids.includes(params.vlanId);
        };

        if (protocol === 'rest_https') {
          const base = `https://${params.host}:${params.port}/rest/interface/bridge/vlan`;
          const auth =
            'Basic ' +
            Buffer.from(`${params.username}:${params.password}`).toString(
              'base64',
            );
          const list = await this.httpsGetJson(base, auth).catch(
            () => [] as unknown,
          );
          const rows = this.restRows(list);
          const existing = rows.find((v) =>
            matchRow(String(v.bridge || ''), String(v['vlan-ids'] || '')),
          );
          if (!existing) return { ok: true, missing: true };
          const id = this.restId(existing);
          if (!id) return { ok: true, missing: true };
          await this.httpsRequestJson(
            `${base}/${encodeURIComponent(id)}`,
            'DELETE',
            params.username,
            params.password,
          );
          return { ok: true };
        }

        const useTls = protocol !== 'api_plain';
        const client = new RouterOsApiClient(params.host, params.port, useTls);
        try {
          await client.connect();
          await client.login(params.username, params.password);
          const vlans = await client.print('/interface/bridge/vlan');
          const existing = vlans.find((v) =>
            matchRow(v.bridge || '', v['vlan-ids'] || ''),
          );
          if (!existing?.['.id']) return { ok: true, missing: true };
          await client.write([
            '/interface/bridge/vlan/remove',
            `=.id=${existing['.id']}`,
          ]);
          return { ok: true };
        } finally {
          await client.close().catch(() => undefined);
        }
      });
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
