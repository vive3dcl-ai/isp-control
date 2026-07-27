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
};

const PORT = Number(process.env.PORT || 3101);
const SECRET = process.env.WHATSAPP_BAILEYS_SECRET || '';
const SESSIONS_DIR =
  process.env.WHATSAPP_SESSIONS_DIR || path.join(process.cwd(), 'data', 'sessions');
const API_INTERNAL_URL = (
  process.env.API_INTERNAL_URL || 'http://api:3000/api'
).replace(/\/$/, '');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });
const sessions = new Map<string, SessionState>();

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
  }
  if (opts?.notify !== false) {
    await notifyApi(s);
  }
}

async function startSession(tenantId: string): Promise<SessionState> {
  const s = getOrCreate(tenantId);
  if (s.status === 'connected' && s.sock) {
    return s;
  }

  if (s.sock) {
    try {
      s.sock.end(undefined);
    } catch {
      /* ignore */
    }
    s.sock = null;
  }

  const authDir = path.join(SESSIONS_DIR, tenantId);
  fs.mkdirSync(authDir, { recursive: true });
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
        await setStatus(s, 'qr', { qrDataUrl, reason: 'Escanea el código QR' });
      } catch (err) {
        log.error({ err, tenantId }, 'QR encode failed');
      }
    }
    if (connection === 'open') {
      await setStatus(s, 'connected', { qrDataUrl: null, reason: null });
      log.info({ tenantId }, 'Baileys connected');
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error as { output?: { statusCode?: number } })
        ?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      await setStatus(s, loggedOut ? 'disconnected' : 'disconnected', {
        qrDataUrl: null,
        reason: loggedOut
          ? 'Sesión cerrada en el teléfono; escanea el QR de nuevo'
          : `Conexión cerrada (code=${code ?? 'unknown'})`,
      });
      s.sock = null;
      log.warn({ tenantId, code }, 'Baileys disconnected');
    }
  });

  return s;
}

async function logoutSession(tenantId: string): Promise<SessionState> {
  const s = getOrCreate(tenantId);
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
  const authDir = path.join(SESSIONS_DIR, tenantId);
  try {
    fs.rmSync(authDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  await setStatus(s, 'disconnected', {
    reason: 'Sesión cerrada',
    qrDataUrl: null,
  });
  return s;
}

function paramId(v: string | string[]): string {
  return Array.isArray(v) ? v[0] : v;
}

const app = express();
app.use(express.json({ limit: '20mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, sessions: sessions.size });
});

app.post('/sessions/:tenantId/start', requireSecret, async (req, res) => {
  try {
    const s = await startSession(paramId(req.params.tenantId));
    // Espera breve por QR si aún connecting
    if (s.status === 'connecting') {
      await new Promise((r) => setTimeout(r, 1500));
    }
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
      session = await startSession(tenantId);
      const deadline = Date.now() + 12_000;
      while (session.status === 'connecting' && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
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
