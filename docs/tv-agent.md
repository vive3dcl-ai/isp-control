# ISP TV Agent (`isp-tv-agent`)

Minimal Go API for TV channel catalog, XMLTV EPG, ffmpeg systemd units, and host metrics. No UI — ISP Control talks to it over HTTP after SSH install.

## Layout on the host

| Path | Purpose |
|------|---------|
| `/usr/local/bin/isp-tv-agent` | Binary |
| `/var/lib/isp-tv/data.db` | SQLite (categories, channels, EPG) |
| `/var/lib/isp-tv/logos/` | Channel logos |
| `/var/lib/isp-tv/run/*.progress` | ffmpeg `-progress` files |
| `/var/lib/isp-tv/scripts/*.sh` | Per-channel ffmpeg wrappers |
| `/var/lib/isp-tv/api.token` | Bearer token (mode 600) |
| `/etc/systemd/system/isp-tv-agent.service` | Agent unit |
| `/etc/systemd/system/isp-tv-ch-<id>.service` | One ffmpeg unit per channel |

Default listen: `:8099`. Auth: `Authorization: Bearer <token>`.

## Build

```bash
cd apps/tv-agent
./build.sh          # → dist/isp-tv-agent-linux-{amd64,arm64} + install.sh
```

The API Docker image builds both arches into `/opt/isp-tv-agent/`.

## Manual install

```bash
sudo ./install.sh ./isp-tv-agent-linux-amd64 :8099
# prints ISP_TV_INSTALL_OK and ISP_TV_TOKEN=…
```

Requires: an **existing** `ffmpeg` (PATH or XtreamUI path), `systemd`, root (or sudo). **Never** installs/upgrades ffmpeg or touches XtreamUI services — only the `isp-tv-agent` unit is (re)started. Channel units run as user `isp-tv` and call the ffmpeg already on the host.

## ffmpeg model

The agent does **not** embed ffmpeg. Creating/starting a channel writes a systemd unit with a **failover wrapper**:

```text
# Prefer primary; on exit try next backup; while on backup, probe primary ~every 25s and switch back.
ffmpeg -re -i <active-source> -c copy -f mpegts -progress <run/<id>.progress> -y <output>
```

Channel JSON: `source` (primary) + `sources` (ordered list: primary then backups). Status exposes `activeSource` / `activeSourceIndex`.

- **1 fuente**: `exec ffmpeg` (systemd reconecta) — misma estabilidad que antes.
- **N fuentes**: wrapper con histéresis (3 fallos en principal antes de backup; 2 probes OK antes de volver). Sin `-re` (mejor para live HTTP).

`Restart=always` on the unit. Packet-loss estimate uses ffmpeg `drop_frames` / frames from the progress file. Link UP tolera stalls breves (~20–45s) para no parpadear en reconnect.

## HTTP API (v1)

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/health` | version |
| GET | `/v1/host` | CPU / RAM / GPU (`nvidia-smi` if present) |
| CRUD | `/v1/categories` | |
| POST | `/v1/maintenance/repair-channels` | Rewrite failover units + restart active |
| CRUD | `/v1/channels` | `source` / `sources[]`, `output` (e.g. `udp://239.x.x.x:5000`) |
| POST | `/v1/channels/:id/start\|stop` | |
| GET | `/v1/channels/:id/status` | state, bitrate, drops, reconnects |
| POST | `/v1/channels/:id/logo` | multipart field `logo` |
| CRUD | `/v1/epg/providers` | XMLTV URL |
| POST | `/v1/epg/providers/:id/refresh` | parse channel keys |
| GET | `/v1/epg/providers/:id/channels` | keys for linking |

## ISP Control

Ajustes → TV → **Servidores**: pick topology device `type=server`, SSH credentials, install progress modal, then manage channels/EPG via Nest proxy `/app/tv/servers/:id/…`. Tenant table `tv_servers` (schema v54) stores SSH + API token only; channel data lives on the agent.
