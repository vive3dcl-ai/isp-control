import * as crypto from 'crypto';
import * as net from 'net';
import * as tls from 'tls';

export type RosReply = {
  type: string;
  attrs: Record<string, string>;
  tag?: string;
};

/**
 * Low-level RouterOS API client (binary sentence protocol).
 * Supports plain TCP (8728) and TLS API-SSL (8729).
 *
 * Protocol: length-prefixed UTF-8 words; sentence ends with zero-length word.
 * Login: post-v6.43 plaintext; falls back to MD5 challenge for older ROS.
 */
export class RouterOsApiClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private nextTag = 1;
  private readonly pending = new Map<
    string,
    {
      replies: RosReply[];
      resolve: (replies: RosReply[]) => void;
      reject: (err: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly useTls: boolean,
    private readonly timeoutMs = 20_000,
  ) {}

  async connect(): Promise<void> {
    if (this.socket) return;

    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const onConnect = () => {
        cleanup();
        // Idle timeout would kill long multi-command sessions; rely on per-command timers.
        sock.setTimeout(0);
        resolve();
      };
      const cleanup = () => {
        sock.off('error', onError);
        sock.off('secureConnect', onConnect);
        sock.off('connect', onConnect);
      };

      let sock: net.Socket | tls.TLSSocket;
      if (this.useTls) {
        sock = tls.connect({
          host: this.host,
          port: this.port,
          rejectUnauthorized: false,
          // Allow anonymous DH when api-ssl has no certificate configured
          ciphers: 'ALL:@SECLEVEL=0',
          minVersion: 'TLSv1',
          timeout: this.timeoutMs,
        });
        sock.once('secureConnect', onConnect);
      } else {
        sock = net.connect({
          host: this.host,
          port: this.port,
          timeout: this.timeoutMs,
        });
        sock.once('connect', onConnect);
      }

      sock.once('error', onError);
      sock.on('data', (chunk: Buffer) => this.onData(chunk));
      sock.on('close', () => this.onClose());
      this.socket = sock;
    });
  }

  async login(username: string, password: string): Promise<void> {
    // Post-v6.43: credentials in one sentence
    const first = await this.write([
      '/login',
      `=name=${username}`,
      `=password=${password}`,
    ]);

    const done = first.find((r) => r.type === '!done');
    const trap = first.find((r) => r.type === '!trap' || r.type === '!fatal');
    if (trap) {
      throw new Error(trap.attrs.message || 'Login failed');
    }

    // Legacy challenge: !done with =ret=challenge and no success yet
    if (done?.attrs.ret && !done.attrs['.section']) {
      // Some firmwares return ret on successful empty; try challenge login if ret looks like hex
      const challenge = done.attrs.ret;
      if (/^[0-9a-fA-F]+$/.test(challenge) && challenge.length >= 16) {
        const response = this.md5Challenge(password, challenge);
        const second = await this.write([
          '/login',
          `=name=${username}`,
          `=response=${response}`,
        ]);
        const trap2 = second.find(
          (r) => r.type === '!trap' || r.type === '!fatal',
        );
        if (trap2) {
          throw new Error(trap2.attrs.message || 'Login failed (legacy)');
        }
        if (!second.some((r) => r.type === '!done')) {
          throw new Error('Login failed: no !done');
        }
        return;
      }
    }

    if (!done) {
      throw new Error('Login failed: no !done');
    }
  }

  /**
   * Run a command and collect !re rows until !done.
   * Example: write(['/system/resource/print'])
   */
  async write(words: string[]): Promise<RosReply[]> {
    if (!this.socket || this.socket.destroyed) {
      throw new Error('Not connected');
    }

    const tag = String(this.nextTag++);
    const sentence = [...words, `.tag=${tag}`];

    return new Promise<RosReply[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tag);
        reject(new Error('API command timeout'));
      }, this.timeoutMs);

      this.pending.set(tag, { replies: [], resolve, reject, timer });

      try {
        this.socket!.write(encodeSentence(sentence));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(tag);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /** Convenience: print and map !re attrs to objects */
  async print(path: string): Promise<Record<string, string>[]> {
    const cmd = path.endsWith('/print') ? path : `${path}/print`;
    const replies = await this.write([cmd]);
    const trap = replies.find((r) => r.type === '!trap' || r.type === '!fatal');
    if (trap) {
      throw new Error(trap.attrs.message || 'Command failed');
    }
    return replies.filter((r) => r.type === '!re').map((r) => r.attrs);
  }

  close(): Promise<void> {
    if (!this.socket) return Promise.resolve();
    const sock = this.socket;
    this.socket = null;
    sock.removeAllListeners('data');
    // Avoid double-reject: clear pending before destroy triggers onClose
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection closed'));
    }
    this.pending.clear();
    sock.destroy();
    return Promise.resolve();
  }

  private md5Challenge(password: string, challengeHex: string): string {
    const challenge = Buffer.from(challengeHex, 'hex');
    const hash = crypto
      .createHash('md5')
      .update(
        Buffer.concat([Buffer.from([0]), Buffer.from(password), challenge]),
      )
      .digest('hex');
    return `00${hash}`;
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const parsed = tryDecodeSentence(this.buffer);
      if (!parsed) break;
      this.buffer = Buffer.from(parsed.rest);
      this.dispatchSentence(parsed.words);
    }
  }

  private dispatchSentence(words: string[]) {
    if (words.length === 0) return;
    const type = words[0];
    const attrs: Record<string, string> = {};
    let tag: string | undefined;
    for (let i = 1; i < words.length; i++) {
      const w = words[i];
      if (w.startsWith('.tag=')) {
        tag = w.slice(5);
      } else if (w.startsWith('=')) {
        const eq = w.indexOf('=', 1);
        if (eq > 0) {
          attrs[w.slice(1, eq)] = w.slice(eq + 1);
        } else {
          attrs[w.slice(1)] = '';
        }
      }
    }

    const reply: RosReply = { type, attrs, tag };
    if (!tag) {
      return;
    }
    const pending = this.pending.get(tag);
    if (!pending) return;

    pending.replies.push(reply);
    if (type === '!done' || type === '!trap' || type === '!fatal') {
      clearTimeout(pending.timer);
      this.pending.delete(tag);
      if (type === '!fatal') {
        pending.reject(new Error(attrs.message || 'Fatal API error'));
      } else {
        pending.resolve(pending.replies);
      }
    }
  }

  private onClose() {
    this.socket = null;
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error('Connection closed'));
    }
    this.pending.clear();
  }
}

export function encodeWord(word: string): Buffer {
  const data = Buffer.from(word, 'utf8');
  const len = data.length;
  let header: Buffer;
  if (len <= 0x7f) {
    header = Buffer.from([len]);
  } else if (len <= 0x3fff) {
    header = Buffer.alloc(2);
    header.writeUInt16BE(len | 0x8000, 0);
  } else if (len <= 0x1fffff) {
    header = Buffer.alloc(3);
    header[0] = (len >> 16) | 0xc0;
    header[1] = (len >> 8) & 0xff;
    header[2] = len & 0xff;
  } else if (len <= 0xfffffff) {
    header = Buffer.alloc(4);
    header.writeUInt32BE((len | 0xe0000000) >>> 0, 0);
  } else {
    throw new Error('Word too long for RouterOS API');
  }
  return Buffer.concat([header, data]);
}

export function encodeSentence(words: string[]): Buffer {
  const parts = words.map(encodeWord);
  // zero-length word terminator
  return Buffer.concat([...parts, Buffer.from([0x00])]);
}

function tryDecodeSentence(
  buf: Buffer,
): { words: string[]; rest: Buffer } | null {
  const words: string[] = [];
  let offset = 0;

  while (offset < buf.length) {
    const decoded = tryDecodeWord(buf, offset);
    if (!decoded) return null;
    offset = decoded.nextOffset;
    if (decoded.word === null) {
      // end of sentence
      return { words, rest: buf.subarray(offset) };
    }
    words.push(decoded.word);
  }
  return null;
}

function tryDecodeWord(
  buf: Buffer,
  offset: number,
): { word: string | null; nextOffset: number } | null {
  if (offset >= buf.length) return null;
  const first = buf[offset];

  // zero-length word
  if (first === 0x00) {
    return { word: null, nextOffset: offset + 1 };
  }

  let len: number;
  let headerLen: number;

  if (first <= 0x7f) {
    len = first;
    headerLen = 1;
  } else if ((first & 0xc0) === 0x80) {
    if (offset + 2 > buf.length) return null;
    len = buf.readUInt16BE(offset) & 0x3fff;
    headerLen = 2;
  } else if ((first & 0xe0) === 0xc0) {
    if (offset + 3 > buf.length) return null;
    len = ((first & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
    headerLen = 3;
  } else if ((first & 0xf0) === 0xe0) {
    if (offset + 4 > buf.length) return null;
    len = buf.readUInt32BE(offset) & 0x0fffffff;
    headerLen = 4;
  } else {
    throw new Error(`Unsupported API length byte 0x${first.toString(16)}`);
  }

  const start = offset + headerLen;
  const end = start + len;
  if (end > buf.length) return null;
  return {
    word: buf.subarray(start, end).toString('utf8'),
    nextOffset: end,
  };
}
