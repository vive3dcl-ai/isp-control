# Nginx (aaPanel) — ISP Control

Puertos Docker (host) según `.env.production.aapanel`:

| Dominio | Servicio | Puerto host |
|---------|----------|-------------|
| `ispcontrol.vive3d.cl` | web (panel SPA) | **5730** |
| `ispapi.vive3d.cl` | api | **5731** |
| landing (cuando toque) | landing | **5732** |
| ACS UI (opcional) | GenieACS | **5733** |

Archivos en este directorio:

- `nginx-ispcontrol.vive3d.cl.conf` — panel → `127.0.0.1:5730`
- `nginx-ispapi.vive3d.cl.conf` — API → `127.0.0.1:5731`
- `nginx-ispvpn.vive3d.cl.conf` — solo SSL/ACME (VPN no es HTTP; puertos 1194/1195/51820)
- landing — cuando lo pidas → `5732`

Tras pegar en aaPanel: `nginx -t && nginx -s reload`.

**VPN concentrador** (`vpn-concentrator` en `docker-compose.prod.yml`):

- Imagen: `vive3d/isp-control-vpn` (OpenVPN TCP/UDP + WireGuard).
- Sync cada ~30s desde `GET /api/internal/vpn/concentrator-state` con header `X-VPN-SYNC-SECRET` (= `VPN_SYNC_SECRET`).
- Firewall/DNAT hacia el host Docker: `TCP/1194`, `UDP/1195`, `UDP/51820` (no van por nginx).
- Tras push de imagen: recrear stack **sin** `-v` para conservar PKI/volúmenes.
