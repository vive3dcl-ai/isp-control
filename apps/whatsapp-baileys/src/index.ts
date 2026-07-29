import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys';

type SessionStatus = 'disconnected' | 'qr' | 'connected' | 'connecting';

type SessionState = {
  tenantId: string;
  status: SessionStatus;
  qrDataUrl: string | null;
  reason: string | null;
  sock: WASocket | null;
  /** Skip attention/alert when user clicked logout. */
  manualLogout: boolean;
};

const PORT = Number(process.env.PORT || 3101);
const SECRET = process.env.WHATSAPP_BAILEYS_SECRET || '';
const SESSIONS_DIR =
  process.env.WHATSAPP_SESSIONS_DIR ||
  path.join(process.cwd(), 'data', 'sessions');
const API_INTERNAL_URL = (
  process.env.API_INTERNAL_URL || 'http://api:3000/api'
).replace(/\/$/, '');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const sessions = new Map<string, SessionState>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function requireSecret(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const got = req.header('x-wa-internal-secret') || '';
  if (!SECRET || got !== SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

function getOrCreate(tenantId: string): SessionState {
  let s = sessions.get(tenantId);
  if (!s) {
    s = {
      tenantId,
      status: 'disconnected',
      qrDataUrl: null,
      reason: null,
      sock: null,
      manualLogout: false,
    };
    sessions.set(tenantId, s);
  }
  return s;
}

function publicState(s: SessionState) {
  return {
    tenantId: s.tenantId,
    status: s.status,
    qrDataUrl: s.qrDataUrl,
    reason: s.reason,
  };
}

async function notifyApi(s: SessionState) {
  if (!SECRET) return;
  try {
    await fetch(`${API_INTERNAL_URL}/internal/whatsapp/baileys/status`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WA-INTERNAL-SECRET': SECRET,
      },
      body: JSON.stringify({
        tenantId: s.tenantId,
        status: s.status,
        reason: s.reason ?? undefined,
        qrDataUrl: s.qrDataUrl ?? undefined,
        /** Intentional logout must not open the attention banner. */
        alert: !s.manualLogout && s.status !== 'connecting',
      }),
    });
  } catch (err) {
    log.warn(
      { err, tenantId: s.tenantId },
      'Failed to notify API of Baileys status',
    );
  }
}

async function setStatus(
  s: SessionState,
  status: SessionStatus,
  opts?: { reason?: string | null; qrDataUrl?: string | null; notify?: boolean },
) {
  s.status = status;
  if (opts?.reason !== undefined) s.reason = opts.reason;
  if (opts?.qrDataUrl !== undefined) s.qrDataUrl = opts.qrDataUrl;
  if (status === 'connected') {
    s.qrDataUrl = null;
    s.reason = null;
    s.manualLogout = false;
  }
  if (opts?.notify !== false) {
    await notifyApi(s);
  }
}

function sessionAuthDir(tenantId: string): string {
  const sessionsRoot = path.resolve(SESSIONS_DIR);
  const authDir = path.resolve(sessionsRoot, tenantId);
  if (!authDir.startsWith(`${sessionsRoot}${path.sep}`)) {
    throw new Error('tenantId inválido');
  }
  return authDir;
}

function wipeAuthDir(tenantId: string) {
  const authDir = sessionAuthDir(tenantId);
  try {
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  fs.mkdirSync(authDir, { recursive: true });
  return authDir;
}

async function startSession(
  tenantId: string,
  opts?: { forceQr?: boolean },
): Promise<SessionState> {
  const s = getOrCreate(tenantId);
  if (s.status === 'connected' && s.sock && !opts?.forceQr) {
    return s;
  }

  s.manualLogout = false;

  if (s.sock) {
    try {
      s.sock.end(undefined);
    } catch {
      /* ignore */
    }
    s.sock = null;
  }

  // Stale multi-file auth often reconnects without emitting a QR. When the user
  // explicitly asks to connect / show QR, start clean unless already connected.
  const authDir =
    opts?.forceQr !== false && s.status !== 'connected'
      ? wipeAuthDir(tenantId)
      : (() => {
          const dir = sessionAuthDir(tenantId);
          fs.mkdirSync(dir, { recursive: true });
          return dir;
        })();

  const { state, saveCreds } = await useMultiFileAuthState(authDir);

  await setStatus(s, 'connecting', { reason: null, qrDataUrl: null });

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });
  s.sock = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
        await setStatus(s, 'qr', {
          qrDataUrl,
          reason: 'Escanea el código QR',
        });
        log.info({ tenantId }, 'Baileys QR ready');
      } catch (err) {
        log.error({ err, tenantId }, 'QR encode failed');
      }
    }
    if (connection === 'open') {
      await setStatus(s, 'connected', { qrDataUrl: null, reason: null });
      log.info({ tenantId }, 'Baileys connected');
    }
    if (connection === 'close') {
      const code = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      if (s.manualLogout) {
        await setStatus(s, 'disconnected', {
          qrDataUrl: null,
          reason: 'Sesión cerrada manualmente',
          notify: false,
        });
      } else {
        await setStatus(s, 'disconnected', {
          qrDataUrl: null,
          reason: loggedOut
            ? 'Sesión cerrada en el teléfono; escanea el QR de nuevo'
            : `Conexión cerrada (code=${code ?? 'unknown'})`,
        });
      }
      s.sock = null;
      log.warn({ tenantId, code, manual: s.manualLogout }, 'Baileys disconnected');
    }
  });

  return s;
}

async function waitForQrOrConnected(s: SessionState, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (s.status === 'connected') return;
    if (s.status === 'qr' && s.qrDataUrl) return;
    if (s.status === 'disconnected' && s.reason) return;
    await sleep(250);
  }
}

async function logoutSession(tenantId: string): Promise<SessionState> {
  const s = getOrCreate(tenantId);
  s.manualLogout = true;
  if (s.sock) {
    try {
      await s.sock.logout();
    } catch {
      try {
        s.sock.end(undefined);
      } catch {
        /* ignore */
      }
    }
    s.sock = null;
  }
  wipeAuthDir(tenantId);
  await setStatus(s, 'disconnected', {
    reason: 'Sesión cerrada manualmente',
    qrDataUrl: null,
  });
  return s;
}

function paramId(v: string | string[]): string {
  return Array.isArray(v) ? v[0] : v;
}

const app = express();
app.use(express.json({ limit: '20mb' }));
app.param('tenantId', (_req, res, next, value: string) => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    res.status(400).json({ error: 'tenantId inválido' });
    return;
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

app.post('/sessions/:tenantId/start', requireSecret, async (req, res) => {
  try {
    const tenantId = paramId(req.params.tenantId);
    const s = await startSession(tenantId, { forceQr: true });
    // QR can take several seconds after socket open.
    await waitForQrOrConnected(s, 20_000);
    res.json(publicState(s));
  } catch (err) {
    log.error({ err }, 'start failed');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'start failed',
    });
  }
});

app.get('/sessions/:tenantId/status', requireSecret, (req, res) => {
  const s = getOrCreate(paramId(req.params.tenantId));
  res.json(publicState(s));
});

app.post('/sessions/:tenantId/logout', requireSecret, async (req, res) => {
  try {
    const s = await logoutSession(paramId(req.params.tenantId));
    res.json(publicState(s));
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : 'logout failed',
    });
  }
});

app.post('/sessions/:tenantId/send', requireSecret, async (req, res) => {
  try {
    const tenantId = paramId(req.params.tenantId);
    const body = req.body as {
      phone?: string;
      fileName?: string;
      mimeType?: string;
      caption?: string;
      contentBase64?: string;
    };
    const phone = (body.phone || '').replace(/\D/g, '');
    if (phone.length < 8 || phone.length > 15) {
      res.status(400).json({ error: 'Invalid recipient phone' });
      return;
    }
    if (!body.contentBase64 || !body.fileName) {
      res.status(400).json({ error: 'Document content and fileName required' });
      return;
    }

    let session = getOrCreate(tenantId);
    if (!session.sock || session.status !== 'connected') {
      // Do not wipe auth when sending — only reconnect existing session.
      session = await startSession(tenantId, { forceQr: false });
      await waitForQrOrConnected(session, 12_000);
    }
    if (!session.sock || session.status !== 'connected') {
      res.status(409).json({
        error:
          session.status === 'qr'
            ? 'Baileys session requires QR'
            : 'Baileys session is not connected',
        status: session.status,
      });
      return;
    }

    const message = await session.sock.sendMessage(`${phone}@s.whatsapp.net`, {
      document: Buffer.from(body.contentBase64, 'base64'),
      mimetype: body.mimeType || 'application/pdf',
      fileName: body.fileName,
      caption: body.caption || undefined,
    });
    res.json({ ok: true, messageId: message?.key?.id });
  } catch (err) {
    log.error({ err }, 'send document failed');
    res.status(500).json({
      error: err instanceof Error ? err.message : 'send failed',
    });
  }
});

fs.mkdirSync(SESSIONS_DIR, { recursive: true });
app.listen(PORT, () => {
  log.info({ PORT, SESSIONS_DIR }, 'whatsapp-baileys listening');
});
