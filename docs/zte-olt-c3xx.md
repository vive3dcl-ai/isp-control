# ZTE ZXA10 C-series (C220 / C300 / C320 / C350) — isp-control

Referencia para integrar OLTs como SmartOLT: **modelo exacto + firmware
detectado**, matriz de capacidades y diferencias de chasis.

## Modelos soportados (selección explícita)

| Subtype     | Producto        | Rack / Shelf (comisión)      | Rack# / Shelf# |
|-------------|-----------------|------------------------------|----------------|
| `zte_c220`  | C220            | `ZXPON` / `ZXA10C220-A\|B`   | 0 / 0          |
| `zte_c300`  | C300            | `IEC19` / `IEC_SHELF`        | 1 / 1          |
| `zte_c320`  | C320            | `C320Rack` / `C320_SHELF`    | 1 / 1          |
| `zte_c350`  | C350 / C350M    | `IEC19` / `IEC_SHELF`        | 1 / 1          |

SmartOLT lista: **C300, C320, C350M, C220** — ver
[setup TR069](https://www.smartolt.com/setup_instructions_tr069.html) y
[initial setup](https://www.smartolt.com/zte-olt-initial-setup.html).

## Firmwares (familias)

| Familia | Ejemplos SoftVer     | Notas |
|---------|----------------------|--------|
| `1.2`   | V1.2.5P3             | Generación amplia en campo |
| `2.0`   | V2.0.x               | Transición |
| `2.1`   | V2.1.0               | MIB/ifIndex unificado C300↔C320 en muchos builds |

SmartOLT: **v1.2.x, v2.0.x, v2.1.x** para todos esos modelos.

Combinaciones objetivo: **4 modelos × 3 firmwares = 12**.

## Qué cambia de verdad entre modelos

1. **Chasis / rack-shelf** al primer arranque (comandos distintos).
2. **Slots físicos** de tarjetas GPON (C320 ~1–2; C300 muchos slots).
3. **Tarjetas de control** (SMXA vs SCXN/SCXM…).
4. **SNMP composite index / slot conversion** (docs MIB C3xx).
5. C220 es generación distinta (rack 0).

CLI operativa GPON (`show gpon onu state`, `show card`, etc.) es **muy
parecida** en C300/C320/C350; el mapeo de índices SNMP es lo crítico.

## SNMP

- Enterprise ZTE: `1.3.6.1.4.1.3902…`
- En v2.1, C300 y C320 suelen compartir árbol MIB/ifIndex; difieren los slots
  poblados ([snmp-olt-zte](https://github.com/Cepat-Kilat-Teknologi/snmp-olt-zte)).
- Obligatorio en muchos despliegues: `mib-compatibility iftable v2`
  (SmartOLT lo aplica; si falta, índices ONU incorrectos en FW 2.1).

## VPN (SaaS shared concentrator)

Modelo A: un concentrador de plataforma; túneles lógicos por tenant
(OpenVPN TCP/UDP, WireGuard). Defaults de routes = RFC1918
(`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).

UI: Topología → **VPN**. Script MikroTik + importación API a router.
Variables: `VPN_PUBLIC_HOST`, `PUBLIC_API_URL`,
`VPN_WIREGUARD_SERVER_PUBLIC_KEY`.

El daemon OpenVPN/WireGuard del concentrador es etapa siguiente; hoy se
genera config/cliente MikroTik y se guarda el túnel por tenant.

TR-069 / CWMP (perfiles ACS, adjuntar OLTs, OMCI): ver
[tr069.md](./tr069.md). UI: **Ajustes → TR069**.


## Flujo operador (como SmartOLT)

1. Crear OLT → elegir **modelo exacto** (C220/C300/C320/C350).
2. Conexión **Pública** o **VPN** + usuario/contraseña CLI (usuario con
   `privilege 15`; no se pide enable password) + **SNMP read-only** y
   **SNMP read-write** communities (como SmartOLT).
3. Probar → se detecta **firmware** (SoftVer), **PON type** desde
   tarjetas (`GT*`→GPON, `ET*`→EPON, ambas→GPON+EPON) y se guarda.
4. Si el banner sugiere otro modelo, el operador puede corregir el subtype.
