# ISP Control

SaaS multi-tenant para control ISP con backend y frontend separados, todo en Docker.

## Stack

| Capa | Tecnología |
|------|------------|
| Backend | **NestJS** + TypeScript + TypeORM + JWT |
| Frontend | **Vite** + React + TypeScript + Tailwind + TanStack Query |
| Base de datos | **PostgreSQL 16** (schema por tenant) |
| Colas / jobs | **Redis 7** + **BullMQ** |
| Contenedores | **Docker Compose** (dev + prod) |

API prefix: `/api` (ej. `POST /api/auth/login`).

## Arranque con Docker (recomendado)

```bash
cp .env.example .env

# Desarrollo (API watch + Vite HMR + Postgres + Redis)
npm run docker:dev

# Seed (admin + tenant demo)
npm run docker:seed
```

| Entorno | URLs |
|---------|------|
| Dev | Web http://localhost:5173 · API http://localhost:3000/api · Landing :3040 |
| Prod | Panel `WEB_PORT` (nginx + `/api`) · Landing `LANDING_PORT` |

```bash
npm run docker:logs   # logs en desarrollo
npm run docker:down   # apagar todo
```

### Producción (imágenes Docker Hub)

Imágenes públicas bajo **`vive3d`**:

- `vive3d/isp-control-api`
- `vive3d/isp-control-web`
- `vive3d/isp-control-landing`
- `vive3d/isp-control-whatsapp-baileys`

También: `mongo` + `drumsergio/genieacs` (ACS). VPN/TR069 por tenant se configuran en el panel (sin OVPN hardcode).

Postgres, Redis, Mongo y NBI/CWMP del ACS **no** publican puertos al host: solo red Docker interna (`isp_net`).

```bash
# Build + push (máquina de desarrollo, con docker login a Docker Hub)
cp .env.production.example .env.production   # o usa el tuyo con secretos
# Editar dominios reales (VITE_API_URL se bakea en el web al build)
docker login
npm run docker:hub:push

# Servidor de producción
cp .env.production.example .env.production   # secretos + dominios
npm run docker:prod:pull
npm run docker:prod
npm run docker:seed:prod     # primera vez (desde el repo)
```

Tres subdominios típicos: **panel** (SPA), **api** (`/api`), **vpn** (puertos OpenVPN/WireGuard).

Archivos: `docker-compose.prod.yml` + `.env.production` (no se sube a git).
El panel ya no hace proxy de `/api` (el front llama al subdominio API). Solo conserva el path del portal cautivo `/{slug}/suspension`.

## Arranque local (sin contenedores de app)

Solo infra en Docker; API/web en el host:

```bash
docker compose up -d          # postgres + redis
cp .env.example .env
cp .env.example apps/api/.env
echo 'VITE_API_URL=http://localhost:3000/api' > apps/web/.env
npm install
npm run seed
npm run dev:api               # :3000
npm run dev:web               # :5173
```

## Roles

### Plataforma (`/admin`)

| Rol | Descripción |
|-----|-------------|
| `superadmin` | Control total (cuenta seed `admin@isp.local`) |
| `admin` | Administración de plataforma |
| `user` | Acceso limitado a panel plataforma |

### Empresa / tenant (`/app`)

| Rol | Descripción |
|-----|-------------|
| `owner` | Dueño de la empresa (se crea al provisionar) |
| `admin` | Admin de la empresa |
| `user` | Usuario estándar |
| `tecnico` | Rol técnico de campo/red |
| `administrativo` | Rol administrativo/oficina |

JWT: staff de plataforma usa su rol directo (`superadmin`/`admin`/`user`); usuarios de empresa usan `role: tenant_user` + `tenantRole`.

## Credenciales demo

| Rol | Email | Password | Panel |
|-----|-------|----------|-------|
| Superadmin | `admin@isp.local` | `Admin123!` | `/admin` |
| Tenant owner (demo) | `user@demo.local` | `User123!` | `/app` |

> Tras actualizar roles, vuelve a iniciar sesión (o corre `npm run docker:seed`) para refrescar el JWT.


## Arquitectura multi-tenant

- Schema `public`: `tenants`, `platform_admins`, `user_directory`
- Schema `tenant_<slug>`: `users` (+ dominio ISP después)
- Login unificado → redirect `/admin` o `/app`

## Colas (BullMQ)

| Cola | Uso |
|------|-----|
| `system` | health / jobs internos |
| `network` | stubs MikroTik / OLT |

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/admin/queues/status` | Estado Redis + contadores |
| POST | `/api/admin/queues/ping` | Job de prueba |

## API auth / paneles

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/login` | Login unificado |
| GET | `/api/auth/me` | Perfil |
| POST | `/api/auth/logout` | Cliente descarta token |
| GET | `/api/admin/dashboard` | Platform admin |
| GET | `/api/admin/tenants` | Lista empresas |
| POST | `/api/admin/tenants` | Crear empresa (schema + owner) |
| GET | `/api/admin/tenants/:id` | Detalle + users directory |
| PATCH | `/api/admin/tenants/:id/status` | active / inactive / suspended |
| GET | `/api/app/dashboard` | Tenant user |

`TenantProvisioningService` es el punto único de creación de empresas (admin hoy; registro público después).

## Estructura

```
apps/
  api/   NestJS + TypeORM + JWT + BullMQ
  web/   Vite + React + Tailwind + TanStack Query
docker-compose.yml             # postgres + redis (base local)
docker-compose.dev.yml         # api + web + landing (hot reload)
docker-compose.prod.yml        # stack producción completo (archivo único)
.env.production.example        # plantilla env producción
```

## Scripts

| Script | Descripción |
|--------|-------------|
| `npm run docker:dev` | Stack completo desarrollo |
| `npm run docker:prod` | Stack producción (`--env-file .env.production`) |
| `npm run docker:prod:logs` / `docker:prod:down` | Logs / apagar prod |
| `npm run docker:seed` | Seed en Docker (dev) |
| `npm run docker:seed:prod` | Seed en Docker (prod) |
| `npm run docker:down` | Detener contenedores (dev) |
| `npm run dev:api` / `dev:web` | Apps en el host |
| `npm run seed` | Seed desde el host |
