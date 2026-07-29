import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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
