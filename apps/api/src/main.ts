import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

/** Logos / fotos ONU en JSON (data URL base64 ~3 MB archivo ≈ 4 MB payload). */
const JSON_BODY_LIMIT = '8mb';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(json({ limit: JSON_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

  app.setGlobalPrefix('api');

  const isDev = process.env.NODE_ENV !== 'production';
  if (!isDev) {
    // Producción publica la API solo detrás del reverse proxy local.
    const httpServer = app.getHttpAdapter().getInstance() as {
      set(name: string, value: unknown): void;
    };
    httpServer.set('trust proxy', 1);
  }
  const corsOrigins = (
    process.env.CORS_ORIGINS ||
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://localhost'
  )
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    // En local: refleja el Origin (móvil/otro PC en la LAN). Prod: lista fija.
    origin: isDev ? true : corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://0.0.0.0:${port}/api`);
}

void bootstrap();
