import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  parseSwosJsObject,
  parseSwosLinks,
  parseSwosSystem,
  parseSwosVlanTable,
  swosVlansByPort,
  type SwosPortRow,
  type SwosSystemInfo,
  type SwosVlanRow,
} from './swos.util';

export type SwosProbeResult =
  | {
      ok: true;
      identity?: string;
      version?: string;
      boardName?: string;
      uptime?: string;
      physicalPorts: Array<{
        name: string;
        defaultName?: string;
        macAddress?: string;
        disabled: boolean;
        running: boolean;
        linkStatus: 'up' | 'down' | 'disabled';
        comment?: string;
        ipAddresses: string[];
        ipAddress: string | null;
        vlans: Array<{
          vlanId: number;
          mode: 'tagged' | 'untagged';
        }>;
      }>;
    }
  | { ok: false; error: string };

/**
 * Minimal HTTP Digest client for MikroTik SwitchOS `.b` endpoints.
 * SwOS has no official API — this mirrors the web UI transport.
 */
@Injectable()
export class SwosClient {
  private readonly logger = new Logger(SwosClient.name);

  async probe(params: {
    host: string;
    port?: number | null;
    username: string;
    password: string;
  }): Promise<SwosProbeResult> {
    const port = params.port && params.port > 0 ? params.port : 80;
    const base = `http://${params.host}:${port}`;
    try {
      const sysRaw = await this.readEndpoint(base, params, '/sys.b');
      const sys = parseSwosSystem(sysRaw);

      let links: SwosPortRow[] = [];
      let vlans: SwosVlanRow[] = [];
      try {
        const linkRaw = await this.readEndpoint(base, params, '/link.b');
        links = parseSwosLinks(linkRaw);
      } catch (err) {
        this.logger.warn(
          `SwOS link.b: ${err instanceof Error ? err.message : err}`,
        );
      }
      try {
        const vlanRaw = await this.readEndpoint(base, params, '/vlan.b');
        vlans = parseSwosVlanTable(vlanRaw, Math.max(links.length, 28));
      } catch (err) {
        this.logger.warn(
          `SwOS vlan.b: ${err instanceof Error ? err.message : err}`,
        );
      }

      if (!sys.identity && !sys.model && !links.length) {
        return {
          ok: false,
          error:
            'Respuesta SwOS vacía o esquema desconocido (¿SwOS Lite / firmware distinto?)',
        };
      }

      const physicalPorts = links.map((p) => {
        const disabled = !p.enabled;
        const running = p.linkUp && p.enabled;
        return {
          name: p.name,
          defaultName: `Port ${p.portNumber}`,
          disabled,
          running,
          linkStatus: (disabled
            ? 'disabled'
            : running
              ? 'up'
              : 'down') as 'up' | 'down' | 'disabled',
          ipAddresses: [] as string[],
          ipAddress: null as string | null,
          vlans: swosVlansByPort(vlans, p.portNumber),
        };
      });

      return {
        ok: true,
        identity: sys.identity ?? undefined,
        version: sys.version ?? undefined,
        boardName: sys.model ?? undefined,
        physicalPorts,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async readEndpoint(
    base: string,
    auth: { username: string; password: string },
    path: string,
  ): Promise<unknown> {
    const url = `${base}${path}`;
    const first = await fetch(url, { method: 'GET', redirect: 'manual' });
    if (first.status === 200) {
      const text = await first.text();
      return parseSwosJsObject(text);
    }
    if (first.status !== 401) {
      throw new Error(`SwOS ${path}: HTTP ${first.status}`);
    }
    const www = first.headers.get('www-authenticate') || '';
    const challenge = this.parseWwwAuthenticate(www);
    if (!challenge?.realm || !challenge.nonce) {
      throw new Error('SwOS: digest challenge incompleto');
    }
    const authorization = this.buildDigestHeader({
      username: auth.username,
      password: auth.password,
      method: 'GET',
      uri: path,
      challenge,
    });
    const second = await fetch(url, {
      method: 'GET',
      headers: { Authorization: authorization },
    });
    if (!second.ok) {
      throw new Error(
        `SwOS ${path}: HTTP ${second.status} tras digest auth`,
      );
    }
    const text = await second.text();
    return parseSwosJsObject(text);
  }

  private parseWwwAuthenticate(header: string): {
    realm: string;
    nonce: string;
    qop?: string;
    opaque?: string;
    algorithm?: string;
  } | null {
    if (!/digest/i.test(header)) return null;
    const get = (name: string) => {
      const m = header.match(new RegExp(`${name}="([^"]+)"`, 'i'));
      return m?.[1];
    };
    const realm = get('realm');
    const nonce = get('nonce');
    if (!realm || !nonce) return null;
    return {
      realm,
      nonce,
      qop: get('qop')?.split(',')[0]?.trim(),
      opaque: get('opaque'),
      algorithm: get('algorithm'),
    };
  }

  private buildDigestHeader(params: {
    username: string;
    password: string;
    method: string;
    uri: string;
    challenge: {
      realm: string;
      nonce: string;
      qop?: string;
      opaque?: string;
      algorithm?: string;
    };
  }): string {
    const md5 = (s: string) => createHash('md5').update(s).digest('hex');
    const { username, password, method, uri, challenge } = params;
    const ha1 = md5(`${username}:${challenge.realm}:${password}`);
    const ha2 = md5(`${method}:${uri}`);
    const nc = '00000001';
    const cnonce = randomBytes(8).toString('hex');
    let response: string;
    const parts = [
      `Digest username="${username}"`,
      `realm="${challenge.realm}"`,
      `nonce="${challenge.nonce}"`,
      `uri="${uri}"`,
    ];
    if (challenge.qop) {
      response = md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`);
      parts.push(`qop=${challenge.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
    } else {
      response = md5(`${ha1}:${challenge.nonce}:${ha2}`);
    }
    parts.push(`response="${response}"`);
    if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
    if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
    return parts.join(', ');
  }
}

// Re-export types used by topology service
export type { SwosSystemInfo, SwosPortRow, SwosVlanRow };
