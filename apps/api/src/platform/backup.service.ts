import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

export type DumpResult = {
  stream: Readable;
  filename: string;
  cleanup: () => Promise<void>;
};

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly config: ConfigService) {}

  private dbEnv(): {
    host: string;
    port: string;
    user: string;
    password: string;
    database: string;
    env: NodeJS.ProcessEnv;
  } {
    const host = this.config.get<string>('DATABASE_HOST', 'localhost');
    const port = String(
      this.config.get<string | number>('DATABASE_PORT', 5432),
    );
    const user = this.config.get<string>('DATABASE_USER', 'isp');
    const password = this.config.get<string>('DATABASE_PASSWORD', 'isp');
    const database = this.config.get<string>('DATABASE_NAME', 'isp_control');
    return {
      host,
      port,
      user,
      password,
      database,
      env: { ...process.env, PGPASSWORD: password },
    };
  }

  private stamp(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  /** Full DB dump (custom format -Fc). Writes to a temp file then streams it. */
  async createDump(): Promise<DumpResult> {
    const { host, port, user, database, env } = this.dbEnv();
    const filename = `isp-control-${this.stamp()}.backup`;
    const outPath = join(tmpdir(), `isp-control-${randomUUID()}.backup`);

    await this.assertPgTools();

    await new Promise<void>((resolve, reject) => {
      const args = [
        '-h',
        host,
        '-p',
        port,
        '-U',
        user,
        '-d',
        database,
        '-Fc',
        '--no-owner',
        '--no-acl',
        '-f',
        outPath,
      ];
      this.logger.log(`pg_dump → ${filename}`);
      const child = spawn('pg_dump', args, { env });
      let stderr = '';
      child.stderr.on('data', (buf: Buffer) => {
        stderr += buf.toString();
      });
      child.on('error', (err) => {
        reject(
          new ServiceUnavailableException(
            `No se pudo ejecutar pg_dump: ${err.message}. ¿Está instalado postgresql-client?`,
          ),
        );
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          reject(
            new BadRequestException(
              `pg_dump falló (código ${code}): ${stderr.slice(0, 500) || 'sin detalle'}`,
            ),
          );
        }
      });
    });

    const stream = createReadStream(outPath);
    const cleanup = async () => {
      await fs.unlink(outPath).catch(() => undefined);
    };
    stream.on('close', () => {
      void cleanup();
    });
    stream.on('error', () => {
      void cleanup();
    });

    return { stream, filename, cleanup };
  }

  /**
   * Restore full DB from a custom-format dump.
   * Terminates other backends first so --clean can drop objects.
   */
  async restoreFromFile(
    filePath: string,
  ): Promise<{ ok: true; warnings: string }> {
    const { host, port, user, database, env } = this.dbEnv();
    await this.assertPgTools();
    await this.validateDump(filePath, env);

    // Best-effort: kick other sessions (not ours) so DROP during restore works.
    await this.terminateOtherSessions(env, host, port, user, database);

    const warnings = await new Promise<string>((resolve, reject) => {
      const args = [
        '-h',
        host,
        '-p',
        port,
        '-U',
        user,
        '-d',
        database,
        '--clean',
        '--if-exists',
        '--exit-on-error',
        '--single-transaction',
        '--no-owner',
        '--no-acl',
        filePath,
      ];
      this.logger.warn('pg_restore --clean starting (destructive)');
      const child = spawn('pg_restore', args, { env });
      let stderr = '';
      child.stderr.on('data', (buf: Buffer) => {
        stderr += buf.toString();
      });
      child.on('error', (err) => {
        reject(
          new ServiceUnavailableException(
            `No se pudo ejecutar pg_restore: ${err.message}. ¿Está instalado postgresql-client?`,
          ),
        );
      });
      child.on('close', (code) => {
        if (code === 0) {
          resolve(stderr.slice(0, 2000));
        } else {
          reject(
            new BadRequestException(
              `pg_restore falló (código ${code}): ${stderr.slice(0, 800) || 'sin detalle'}`,
            ),
          );
        }
      });
    });

    this.logger.warn('pg_restore finished');
    return { ok: true, warnings };
  }

  private validateDump(
    filePath: string,
    env: NodeJS.ProcessEnv,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('pg_restore', ['--list', filePath], { env });
      let stderr = '';
      child.stderr.on('data', (buf: Buffer) => {
        stderr = (stderr + buf.toString()).slice(0, 800);
      });
      child.on('error', (err) => {
        reject(
          new ServiceUnavailableException(
            `No se pudo validar el respaldo: ${err.message}`,
          ),
        );
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          reject(
            new BadRequestException(
              `El archivo no es un respaldo PostgreSQL válido: ${
                stderr || `pg_restore terminó con código ${code}`
              }`,
            ),
          );
        }
      });
    });
  }

  private async assertPgTools(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pg_dump', ['--version']);
      child.on('error', () => {
        reject(
          new ServiceUnavailableException(
            'pg_dump no está disponible en el contenedor API. Recompila la imagen con postgresql-client.',
          ),
        );
      });
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          reject(
            new ServiceUnavailableException(
              'pg_dump no responde correctamente en el contenedor API.',
            ),
          );
        }
      });
    });
  }

  private terminateOtherSessions(
    env: NodeJS.ProcessEnv,
    host: string,
    port: string,
    user: string,
    database: string,
  ): Promise<void> {
    return new Promise((resolve) => {
      const sql = `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend';`;
      const child = spawn(
        'psql',
        [
          '-h',
          host,
          '-p',
          port,
          '-U',
          user,
          '-d',
          database,
          '-v',
          'ON_ERROR_STOP=0',
          '-c',
          sql,
        ],
        { env },
      );
      child.on('close', () => resolve());
      child.on('error', () => resolve());
    });
  }
}
