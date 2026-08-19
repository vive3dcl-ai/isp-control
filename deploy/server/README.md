# Nginx (aaPanel) — ISP Control

## Dominios (4)

| Dominio | Servicio | Puerto host Docker |
|---------|----------|--------------------|
| `panel.ispcontrol.ai` | web (panel SPA) | **5730** |
| `api.ispcontrol.ai` | api (Nest `/api/*`) | **5731** |
| `ispcontrol.ai` / `www` | landing | **5732** |
| `vpn.ispcontrol.ai` | concentrador VPN (no HTTP) | **1194/tcp**, **1195/udp**, **51820/udp** |

Plantillas en este directorio (pegar en aaPanel cuando cambies el proxy):

- `nginx-panel.ispcontrol.ai.conf` — panel → `127.0.0.1:5730`
- `nginx-api.ispcontrol.ai.conf` — API → `127.0.0.1:5731`
- `nginx-ispcontrol.ai.conf` — landing → `127.0.0.1:5732`
- `nginx-vpn.ispcontrol.ai.conf` — solo SSL/ACME (VPN no va por nginx HTTP)
- Legado vive3d: `nginx-ispcontrol.vive3d.cl.conf`, `nginx-ispapi.vive3d.cl.conf`, `nginx-ispvpn.vive3d.cl.conf`

Tras pegar en aaPanel: `nginx -t && nginx -s reload`.

**Importante:** recrear solo `api`, `web` y `landing` (nunca `down -v` / no tocar postgres). Si cambia `VPN_PUBLIC_HOST`, recrea también `api` (y peers/scripts salen con el hostname nuevo).

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production pull api web landing
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --no-deps api web landing
```

**VPN concentrador** (`vpn-concentrator` en `docker-compose.prod.yml`):

- Imagen: `vive3d/isp-control-vpn` (OpenVPN TCP/UDP + WireGuard).
- Sync cada ~30s desde `GET /api/internal/vpn/concentrator-state` con header `X-VPN-SYNC-SECRET` (= `VPN_SYNC_SECRET`).
- Firewall/DNAT hacia el host Docker: `TCP/1194`, `UDP/1195`, `UDP/51820` (no van por nginx).
- Tras push de imagen: recrear stack **sin** `-v` para conservar PKI/volúmenes.
