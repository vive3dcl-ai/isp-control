# Lab TR069 (GenieACS + reverse OpenVPN)

## One-shot

```bash
# 1) MikroTik OVPN server + DB tunnel + TR069 profile (API)
npm run docker:lab:provision

# 2) GenieACS + OpenVPN client (shared netns → 10.69.69.2)
npm run docker:lab:up
```

## Running pieces

| Piece | Detail |
|-------|--------|
| MikroTik Core Router | OpenVPN TCP **:1194** (API-provisioned) |
| Tunnel `lab-tr069` | mode=`reverse`, ACS IP **10.69.70.2** (no usar 10.69.69 — choca con SmartOLT-VPN) |
| `isp-control-lab-vpnacs` | OpenVPN client (`tun0` = 10.69.70.2) |
| `isp-control-lab-acs` | GenieACS (same netns as VPN) |
| CWMP | **10.69.70.2:14501** (también en host `:14501`) |
| GenieACS UI | http://localhost:3001 |
| Profile | **Lab TR069** → `http://10.69.70.2:14501` (attached to OLT Central) |
| Mgmt VLAN | **601** → gateway `10.60.60.1` on MikroTik `vlan_601` |

## Apply ACS to an ONU

Activar TR069 en el detalle de la ONU empuja ACS URL por OMCI. La ONU debe
alcanzar `10.69.70.2:14501` vía VLAN mgmt → MikroTik → OVPN.

**Nota:** el túnel lab usa `10.69.70.0/24` porque `10.69.69.0/24` ya lo usa
`SmartOLT-VPN` en el Core Router (si reusas .69 el plano de datos queda muerto).

## Notes

- CWMP escucha **14501 dentro del netns del túnel** (no solo el publish del host).
- Client uses `route-nopull` so RFC1918 routes do not break Docker/Mongo.
- Re-provision: `npm run docker:lab:provision` then restart `lab-vpnacs`.
