# Roadmap: producto de aprovisionamiento a nivel industria

Objetivo: ser el mejor panel para ISP con OLT clásica (ZTE C3xx/C6xx, Huawei MA) + HGU mixtos (Huawei, Tenda, FiberHome, ZTE) + ACS (GenieACS), sin volverse VOLTHA ni forzar PPPoE+RADIUS como diseño único.

Principios:

- Un cambio por etapa; cada etapa tiene criterio de “hecho” y se puede desplegar **sin tocar la base** si no añade tablas (si una etapa pide columnas, se documenta aparte y se acuerda).
- Velocidad del cliente: **perfiles DBA en la OLT** (T-CONT up + traffic down), como SmartOLT. El router no moldea el plan residencial.
- OMCI y TR-069 no se pisan: cada parámetro tiene un dueño.
- Un driver nuevo no nace en un abonado de producción.

Estado actual (aprovechar, no reinventar):

- Drivers ONU por modelo + genéricos.
- Perfiles de velocidad en CRM (`speed-profiles`) y sync a la OLT (`profile tcont {name}-UP` + `profile traffic {name}-DOWN`).
- El aprovisionamiento de GEM/T-CONT todavía usa a menudo `SMARTOLT-1000MB-UP` en lugar del perfil del plan.
- Suspender ONU = `shutdown` en interfaz ONU (C3xx), no borrar SN.
- Huérfanas / bloqueadas / suspendidas: corrección en curso (listados).

---

## Paso 0 — Deuda operativa (estabilizar lo que ya existe) — **Cumplido**

Hacer el producto **predecible** antes de sumar capas. Cerrado en código: Huérfanas no listan SN ya en Conectadas; denegar guarda `onuSnKey` y el purge no borra `manual !== false`; heal HG9/HG8145 hace SPV si Inform vive y el reboot OMCI del poller usa `force: false`.

| Ítem | Qué | Hecho cuando |
|------|-----|----------------|
| 0.1 Suspendidas vs huérfanas | ONU admin-disable no aparece en Huérfanas; botón Suspendidas + rehabilitar | En prod: suspender → lista Suspendidas; denegar no se borra al reiniciar |
| 0.2 Denegadas persistentes | Bloqueo manual no lo limpia el listado aunque el SN esté en Conectadas | Tras reboot de ONU, sigue en Bloqueadas |
| 0.3 ConnReq | No martillar CR; Inform periódico; factory `acs` no bloquea WAN | Provision HG8145/HG9 termina WAN sin 401 eterno |
| 0.4 OMCI vs ACS | OMCI no reescribe IP/VLAN de servicio ACS-only; post-OMCI no pisa WCD de internet | Tras OMCI+reboot, WCD servicio conserva `wan_ip` |
| 0.5 Driver HG9 | Receta validada (VLAN en WCD, no `ServiceType=INTERNET` si hay conflicto) | Verify elige WCD por `X_TDTC_VLAN`, no el INTERNET de fábrica |
| 0.6 Hardening HG8145 | CR factory no detiene WAN; Inform muerto → OMCI+reboot con tope | Heal no llena la cola ACS |

Despliegue: API + web, **sin migraciones**.

---

## Etapa 1 — Un estado de servicio (contrato manda)

Hoy cada botón (suspender OLT, denegar, cortar) cuenta una historia distinta.

| | |
|--|--|
| Qué | Un estado canónico por servicio: `active` \| `suspended` \| `denied` \| `disabled_olt` \| `pending_auth`. La UI y la OLT derivan de ahí. |
| Incluye | Mapeo: suspendido → `shutdown` ONU; activo → `no shutdown`; denegado → denylist + no autorizar; baja → `no onu` (eso sí borra). |
| No incluye | RADIUS, tickets NOC, firmware. |
| Hecho | Un servicio no puede estar “activo en CRM” y “disable en OLT” sin que el panel lo muestre como desvío. Acción “Reconciliar OLT” opcional. |

---

## Etapa 2 — Dueños de parámetros (OMCI / ACS / OLT DBA)

Tabla por modelo: quién escribe VLAN servicio, IP WAN, IP mgmt, ACS URL, T-CONT, NAT, bind LAN.

Reglas:

- Huawei HG8145 y Tenda HG9: **WAN servicio = ACS**; OMCI solo TR069/ip-host de gestión.
- ZTE bridge clásico: OMCI/OLT puede poseer VLAN; ACS no inventa `X_HW_VLAN`.
- Velocidad: **solo OLT** (T-CONT + traffic profile), nunca SPV de rate en el HGU.

Hecho: un reboot OMCI no cambia la IP de internet; un sync ACS no borra el T-CONT del plan.

---

## Etapa 3 — Velocidad SmartOLT (OLT, no router)

Ya existen perfiles y sync. Falta **aplicarlos a la ONU**.

| Paso | Qué |
|------|-----|
| 3.1 | Al autorizar / cambiar plan: `tcont N profile {plan}-UP` + traffic down en el service-port/gem correspondiente (dejar de hardcodear `SMARTOLT-1000MB-UP` en internet). Gestión puede seguir en perfil chico (p. ej. 10M). |
| 3.2 | Verify: el T-CONT/traffic de la ONU coincide con el plan; si no, heal solo DBA (no toca WAN ACS). |
| 3.3 | Cambio de plan en caliente: un comando OLT, sin reaprovisionar ACS. |
| 3.4 | Huawei MA: equivalente (`ont-lineprofile` / `traffic-table` / `srv-profile`) cuando toque esa OLT. |

Hecho: un plan “100/50” en CRM se ve en `show gpon onu tcont` / traffic de esa ONU; el MikroTik no tiene queues por abonado residencial.

Fuera de alcance: moldeo en router (queda para mayorista/BNG opcional, etapa 9).

---

## Etapa 4 — Lab y matriz de modelos

| | |
|--|--|
| Qué | Por modelo: golden tree ACS (JSON), lista de SPV seguros, faults conocidos (9003/9007), “lab OK” antes de prod. |
| Cómo | ONU de almacén o cliente piloto explícito; grabar Inform/SPV; test unitarios del picker WAN (como HG9). |
| Matriz | Soportado / parcial / genérico / no tocar. |
| Hecho | Añadir un modelo = carpeta `models/<id>` + spec de match/WAN + fila en la matriz; **no** debug en el primer abonado. |

---

## Etapa 5 — Auditoría OLT/ACS

Cada acción: actor, SN, OLT, comando o SPV, respuesta, duración.

Hecho: se puede responder “quién suspendió el SN X el martes” sin logs Docker.

Preferible tabla `device_audit_events` (esta etapa **sí** pide BD; acordar antes). Hasta entonces, log estructurado JSON en API.

---

## Etapa 6 — Alarmas de red (NOC)

No son los tickets tenant↔plataforma.

- Inform ACS ausente > N×intervalo
- RX ONU bajo umbral
- LOS / dying gasp
- OLT inalcanzable
- Cola ACS > umbral

Hecho: el técnico de zona recibe el evento (panel + opcional Telegram) con SN y OLT.

---

## Etapa 7 — Firmware

Inventario `SoftwareVersion` ACS + tipo OLT. Imagen aprobada por modelo. Upgrade masivo con ventana y tope.

Hecho: se lista “HG9 en firmware X (N unidades); aprobado = Y”.

---

## Etapa 8 — Backup OLT y modo mantenimiento

- Backup periódico de running-config (archivo, no pisar postgres a lo loco).
- Diff antes/después de un cambio masivo.
- “Técnico en OLT”: el poller no escribe T-CONT/WAN en esa caja.

Hecho: se restaura un C320 de backup de ayer; el poller no pelea con una sesión CLI humana.

---

## Etapa 9 — BNG opcional (no reemplaza la OLT)

Solo si un tenant quiere corte/limitación **además** de la OLT (mayorista, CGNAT, IPv6).

Residencial por defecto: **solo DBA OLT**. RADIUS/MikroTik queue = extra, no el camino principal.

---

## Etapa 10 — HA del plano de control

Backup restaurable de Postgres + Mongo ACS, RPO declarado, ACS no es SPOF mudo.

Hecho: se documenta “si cae el API, la flota sigue informando; si cae ACS, Inform se encola N horas”.

---

## Orden recomendado

```
0  estabilizar (listados, HG9, OMCI/ACS, ConnReq)
1  estado de servicio único
2  dueños de parámetros
3  aplicar perfiles DBA del plan a cada ONU   ← “SmartOLT de velocidad”
4  lab + matriz de modelos
5  auditoría
6  alarmas
7  firmware
8  backup OLT
9  BNG opcional
10 HA
```

No saltar 0→3 sin 2: si OMCI sigue pisando WAN, el perfil de velocidad se va a aplicar sobre una ONU mal IP-eada.

No saltar 3→4: sin lab, cada modelo nuevo rompe el DBA “genérico 1000M”.

---

## Qué no vamos a copiar

- VOLTHA / OpenOLT: no sustituye ZTE C320.
- NMS Prime “todo por PPPoE+RADIUS”: contradice velocidad en OLT.
- Driver único genérico ACS: ya se demostró falso en Tenda y Huawei HGU.

El diferenciador se mantiene: **drivers por modelo + DBA en la OLT + verify de campo**. El resto es disciplina de producto alrededor de eso.
