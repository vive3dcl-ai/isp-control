import { Client, type ConnectConfig } from 'ssh2';
import { Readable } from 'stream';

export type SshExecResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

function connect(cfg: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client
      .on('ready', () => resolve(client))
      .on('error', reject)
      .connect({
        readyTimeout: 20_000,
        algorithms: undefined,
        ...cfg,
        // Allow first-connect without pinned host key (same as OLT default).
        hostVerifier: () => true,
      } as ConnectConfig);
  });
}

export async function withSsh<T>(
  opts: {
    host: string;
    port: number;
    username: string;
    password: string;
  },
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connect({
    host: opts.host,
    port: opts.port,
    username: opts.username,
    password: opts.password,
  });
  try {
    return await fn(client);
  } finally {
    client.end();
  }
}

export function sshExec(
  client: Client,
  command: string,
  timeoutMs = 120_000,
): Promise<SshExecResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSH exec timeout: ${command.slice(0, 80)}`));
    }, timeoutMs);
    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      let stdout = '';
      let stderr = '';
      stream
        .on('close', (code: number | null) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr });
        })
        .on('data', (d: Buffer) => {
          stdout += d.toString('utf8');
        });
      stream.stderr.on('data', (d: Buffer) => {
        stderr += d.toString('utf8');
      });
    });
  });
}

export function sshWriteFile(
  client: Client,
  remotePath: string,
  data: Buffer,
  mode = 0o755,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) {
        reject(err);
        return;
      }
      const ws = sftp.createWriteStream(remotePath, { mode });
      ws.on('close', () => resolve());
      ws.on('error', reject);
      Readable.from(data).pipe(ws);
    });
  });
}
