# Hallazgos — integración Routers / OLTs

Inventario de problemas y deuda técnica detectados al revisar archivo por archivo.
No son fixes hechos: son ítems para resolver después.

Última actualización: 2026-07-30 (batch billing + client-portal)  
Sesión memoria MCP: `isp-control-olt-router-review`

---

## P0 — Seguridad / riesgo operativo

### P0.1 TLS sin verificación en MikroTik
- **Archivos:** `routeros-api.client.ts`, `mikrotik.client.ts`
- **Qué:** `rejectUnauthorized: false` en API-SSL y REST HTTPS; ciphers `ALL:@SECLEVEL=0`, `minVersion: TLSv1`.
- **Riesgo:** MITM en management plane (credenciales RouterOS).
- **Acción:** Pinning de certs o CA propia; al menos flag por dispositivo / env estricto en prod.

### P0.2 SSH OLT sin host-key por defecto
- **Archivos:** `olt-ssh-host-key.util.ts`
- **Qué:** Sin `OLT_SSH_HOST_KEYS` se permite SSH unverified (`OLT_SSH_ALLOW_UNVERIFIED` default true).
- **Riesgo:** MITM en provisioning CLI (authorize ONU, VLANs, TR069).
- **Acción:** Flujo UI para capturar fingerprint al primer “Probar”; opcional `REQUIRE_HOST_KEYS` en prod.

### P0.3 Community SNMP RW se guarda pero no se usa
- **Archivos:** `topology.service.ts` (default `private`), entity/DTO, UI `DeviceDetailModal`
- **Qué:** Se persiste `snmpCommunityRw`; clientes SNMP solo hacen GET/WALK con community RO.
- **Riesgo:** Credencial RW en DB/UI sin utilidad; confunde operadores; superficie innecesaria.
- **Acción:** Quitar RW del formulario hasta que exista SET, o documentar claramente “reservado / no usado”.

### P0.4 `api_plain` (TCP 8728) expuesto en UI
- **Archivos:** `mikrotik.client.ts`, `DeviceDetailModal`, VPN/suspension
- **Qué:** Protocolo sin TLS disponible y usado en algunos flujos.
- **Acción:** Desaconsejar en UI; warning fuerte; preferir solo `api_ssl`.

### P0.5 GenieACS NBI: dump completo de devices + HTTP plano
- **Archivos:** `genieacs-nbi.client.ts` (`findBySerial` last-resort `findDevices({})`), `tr069.service.ts` (dashboard lista ACS con `findDevices({})`)
- **Qué:** En flotas grandes carga todo el inventario ACS en memoria por request; NBI default `http://host:7557` sin auth en el client.
- **Riesgo:** DoS / latencia severa; NBI expuesto en red interna sin credenciales en el wrapper.
- **Acción:** Query indexada por SN únicamente; paginar; nunca `{}` en prod; auth NBI si GenieACS lo tiene habilitado.

### P0.6 IP pool `/8` materializa ~16M hosts en memoria
- **Archivos:** `ip-pool.util.ts` `computeIpNetwork`, DTO `@Min(8)`, `listAddresses` mapea `usableHosts`
- **Qué:** Prefix permitido desde 8; construye array completo de hosts usables.
- **Riesgo:** OOM / DoS del API al crear/listar un pool grande (p.ej. `10.0.0.1/8`).
- **Acción:** Subir mínimo a `/16` o `/20`; no materializar array — calcular total + first-free por índice; hard-cap en `listAddresses`.

### P0.7 Rutas VPN default demasiado amplias
- **Archivo:** `vpn.constants.ts` `DEFAULT_VPN_TUNNEL_ROUTES` = `10/8`, `172.16/12`, `192.168/16`
- **Qué:** Al importar túnel a MikroTik se empujan RFC1918 casi completas vía túnel.
- **Riesgo:** Blackhole de LAN/mgmt local del router si el ISP no estrecha rutas.
- **Acción:** Defaults vacíos o solo subredes del tenant; warning fuerte en UI antes de apply.

### P0.8 `POST …/mikrotik/command` ejecuta API RouterOS arbitraria
- **Archivos:** `topology.controller.ts`, `topology.service.ts` `runMikrotikCommand`, `MikrotikCommandDto`
- **Qué:** Acepta `words[]` o `path` sin allowlist (add/remove/reset/user…). Solo gated por `CRM_WRITE_ROLES`.
- **Riesgo:** Compromiso total del MikroTik si hay XSS/robo de sesión o insider.
- **Acción:** Allowlist de paths de solo lectura (`*/print`) o eliminar endpoint de prod; audit log; rate-limit; rechazar verbs write/remove/set/add.

### P0.9 VPN public setup token: scan de todos los schemas PG
- **Archivo:** `vpn.service.ts` `getSetupByTokenAcrossTenants`
- **Qué:** Por cada `GET /public/vpn-setup/:token` lista `pg_namespace` y querya cada schema hasta encontrar el token (TTL 5 min — OK).
- **Riesgo:** DoS / carga DB con muchos tenants; script RSC incluye secretos del túnel si el token es válido.
- **Acción:** Índice global `setup_token → schema` en public; single lookup; one-time invalidate tras fetch.

### P0.10 Webhook Mercado Pago sin verificación de firma / monto
- **Archivos:** `client-portal.controller.ts` `POST …/webhooks/mercadopago/:slug`, `client-portal.service.ts` `handleMercadoPagoWebhook`
- **Qué:** No valida `x-signature` de MP; marca factura `paid` si el payment remoto está `approved` y trae `invoiceId` / `external_reference`, **sin** chequear `transaction_amount` vs `invoice.total`.
- **Riesgo:** Dependencia solo en secreto del access token al GET payment; falta defensa en profundidad (firma + monto).
- **Acción:** Verificar firma MP; exigir monto ≥ total (o igual con tolerancia); idempotencia por `payment.id`.

---

## P1 — Bugs / inconsistencias de comportamiento

### P1.1 Cast inseguro Huawei↔ZTE (`as unknown as ZteOltClient`)
- **Archivos:** `topology.service.ts`, `onu-connected.service.ts`, `service-vlan.service.ts`
- **Qué:** Facade `oltCli()` / `oltSnmp()` castean Huawei al tipo ZTE.
- **Riesgo:** Drift de firmas sin error de TypeScript; bugs silenciosos si APIs divergen.
- **Acción:** Extraer interfaz común (`ManagedOltCliClient`, `ManagedOltSnmpClient`) e inyectar esa.
  Plan completo de silos OLT (C3xx / Titan / Huawei) + biblioteca ONU:
  [`drivers-migration.md`](./drivers-migration.md) (Fase 1 cierra este ítem sin
  mover aún el monolito ZTE).

### P1.2 Probe CLI Huawei sin fail-streak
- **Archivo:** `topology.service.ts` → `probeAndPersistHuaweiOlt`
- **Qué:** Un fallo CLI marca `disconnected` inmediato. MikroTik y SNMP OLT exigen 3 fallos consecutivos.
- **Riesgo:** Flapping de estado Huawei en timeouts VTY.
- **Acción:** Alinear con el mismo threshold de 3 (y reintento como ZTE).

### P1.3 Probe ZTE CLI sí reintenta; Huawei no
- **Archivo:** `topology.service.ts`
- **Qué:** ZTE hace retry a 800ms; Huawei un solo intento (con timeout 55s).
- **Acción:** Retry simétrico.

### P1.4 Autoset subtype ZTE puede sobrescribir elección del operador
- **Archivo:** `topology.service.ts` → `probeAndPersistZteOlt` (~2416+)
- **Qué:** Si product detecta C6xx vs C3xx distinto al subtype guardado, migra subtype automáticamente.
- **Riesgo:** Operador eligió modelo a propósito (p.ej. C300 genérico) y el probe lo cambia.
- **Acción:** Solo auto-migrar desde `zte_c3xx` legacy; si hay subtype explícito, sugerir en UI sin forzar.

### P1.5 Defaults SNMP `public`/`private` al guardar conexión OLT
- **Archivo:** `topology.service.ts` `updateConnection`
- **Qué:** Si faltan communities, rellena `public` / `private`.
- **Riesgo:** Probe “OK” contra community default incorrecta o débil; falsa sensación de monitoreo.
- **Acción:** No rellenar por defecto; exigir community RO explícita.

### P1.6 Huawei EPON rechazado solo en `probe`, no en todo el pipeline
- **Archivo:** `huawei-olt.client.ts` (probe lanza si solo EPON)
- **Qué:** Parsers/UI ya son GPON-only; OK. Confirmar que cards mixtas GPON+EPON no intenten operar EPON.
- **Acción:** Auditoría de `authorizeOnu` / listados cuando hay tarjetas EPON presentes.

### P1.7 Registry ZTE registra combos absurdo `c3xx@titan` / `c6xx@1.2`
- **Archivo:** `zte/adapters/registry.ts` + `ZTE_CAPABILITY_MATRIX`
- **Qué:** Producto cartesiano modelo × todas las firmware families (incl. `titan` en C220/C300).
- **Riesgo:** UI/docs pueden listar capacidades inválidas; `getZteAdapter` casi no se usa.
- **Acción:** Restringir matrix (C3xx ↔ 1.2/2.0/2.1; C6xx ↔ titan) o marcar registry como dead code.

### P1.8 Rack/shelf Huawei en cache SNMP usan `defaultFrame` para ambos
- **Archivo:** `topology.service.ts` `refreshOltInventoryStatus`
- **Qué:** `defaultRack` y `defaultShelf` caen a `huaweiChassis.defaultFrame` (casi siempre 0).
- **Riesgo:** Si UI asume rack≠shelf estilo ZTE, labels confusos.
- **Acción:** Campos explícitos frame/slot/port para Huawei en cache.

### P1.9 Huawei authorize fallback magic type `'10'`
- **Archivo:** `onu-connected.service.ts` authorize Huawei
- **Qué:** Si no hay candidatos de catálogo, intenta `preferred || '10'`.
- **Riesgo:** Autoriza con perfil line/srv id o nombre incorrecto según firmware.
- **Acción:** Fallar con mensaje claro (como ZTE: exigir tipos en catálogo); no usar `'10'`.

### P1.10 Discover CLI timeout hasta 5 minutos
- **Archivo:** `onu-connected.service.ts` `discover`
- **Qué:** `includeRunningConfig` true → timeout 300_000 ms.
- **Riesgo:** Request HTTP colgado / proxy timeouts; VTY ocupado.
- **Acción:** Default false en sync/migración (ya lo hace migration); hard-cap UI; job async para full dump.

### P1.11 Naming métricas `rx_bps`/`tx_bps` vs download/upload
- **Archivos:** `onu-connected.service.ts`, portal/detail modals
- **Qué:** Se guarda `rx_bps = downloadBps` y `tx_bps = uploadBps` (perspectiva cliente, no OLT ifIn/ifOut).
- **Riesgo:** Confusión al correlacionar con SNMP ifHCIn/Out (OLT RX = upload cliente).
- **Acción:** Renombrar kinds a `download_bps`/`upload_bps` o documentar contrato en un solo sitio.

### P1.12 Poll ONU: fallback CLI de tráfico tras SNMP exitoso
- **Archivo:** `onu-connected.service.ts` `pollOneOlt`
- **Qué:** Si SNMP no trae in/out octets, abre CLI `sampleOnuTrafficRates` (hasta 24 ONUs/tick, 90s).
- **Riesgo:** Contención VTY con inventario/authorize concurrentes.
- **Acción:** Preferir XPON/IF-MIB; rate-limit CLI traffic; skip si cola interactive llena.

### P1.13 `setOnuMgmtIp` deprecated roto al habilitar
- **Archivo:** `ip-pool.service.ts`
- **Qué:** `setOnuMgmtIp(enabled=true)` llama `setOnuTr069(..., undefined, vlanId)` → exige `profileId` y siempre lanza.
- **Acción:** Eliminar endpoint o mapear a flujo que elija perfil default / requiera profileId en la firma.

### P1.14 `allocateTunnelSubnet` colisiones al agotar 10.69.x
- **Archivo:** `vpn-script.util.ts`
- **Qué:** Si n≥254 elige `1 + random*200` sin garantizar unicidad.
- **Riesgo:** Dos túneles con misma subnet.
- **Acción:** Fallar explícito / expandir espacio (otro /16) / reintentar hasta libre.

### P1.15 Service VLAN en OLT siempre `isolated: true`
- **Archivo:** `service-vlan.service.ts` `ensureOnOlt` (y P3.8 UI create)
- **Qué:** Sync a OLT fuerza isolated; no respeta flag de la fila service-vlan si existe.
- **Acción:** Propagar `row.isolated` (o campo equivalente) al upsert CLI.

### P1.16 `MikrotikCommandDto.words` sin límites de tamaño
- **Archivo:** `dto/topology.dto.ts`
- **Qué:** Array de strings sin `@ArrayMaxSize` / `@MaxLength` por elemento.
- **Acción:** Cap estricto (p.ej. 32 words × 200 chars) además de allowlist (P0.8).

### P1.17 PATCH service `status` bypasea enforcement de red
- **Archivos:** `crm.service.ts` `updateClientService`, `UpdateClientServiceDto.status`
- **Qué:** Solo `setServiceStatus` (suspend/activate endpoints) llama `applyNetworkServiceStatus`. Un `PATCH …/client-services/:id` con `status: suspended|active` cambia DB **sin** address-list ni disable/enable ONU.
- **Riesgo:** Cliente “suspendido” en CRM pero sigue navegando (o al revés).
- **Acción:** Quitar `status` del DTO de update genérico, o redirigir cambios de status a `setServiceStatus`.

### P1.18 `ended` no limpia suspensión de red
- **Archivo:** `crm.service.ts` `setServiceStatus('ended')`
- **Qué:** No llama `applyNetworkServiceStatus` / `removeSuspendedIp` / `enable` ONU.
- **Riesgo:** Servicio terminado permanece en address-list `isp-control-suspended` o ONU disabled.
- **Acción:** Antes de marcar ended, si estaba suspended (o siempre) liberar red (remove list + enable ONU según modo).

### P1.19 Suspend sin ONU: comportamiento inconsistente
- **Portal ON:** exige `onuId` + `wanIp` (throw).
- **Portal OFF:** sin `onuId` → return silencioso y **igual** marca status suspended.
- **Acción:** Fallar o advertir en ambos modos; no permitir suspended huérfano sin enforcement.

### P1.20 Billing: periodos avanzan en `suspended` pero no facturan
- **Archivo:** `billing.service.ts`
- **Qué:** `runMaintainPeriods` incluye `active`+`suspended`; `runGenerateInvoices` solo `status = active`.
- **Riesgo:** Mientras está suspendido se mueve `next_billing_date` sin emitir factura → al reactivar puede saltarse cobros del periodo suspendido (o al revés: nunca recupera deuda).
- **Acción:** Definir política: (a) no avanzar periodos suspendidos, o (b) facturar igual, o (c) prorrateo / invoice “suspendidos” al reactivar.

### P1.21 Overdue de factura no dispara suspensión de red
- Portal marca `overdue` al listar facturas; billing no tiene job de overdue→`setServiceStatus('suspended')`.
- Coherente con hallazgo previo “billing no auto-suspend”, pero es gap de producto ISP típico.
- **Acción:** Setting opcional `autoSuspendDaysAfterDue` → CRM network apply.

---

## P2 — Deuda de tests / cobertura

### P2.1 Sin specs de clientes críticos
| Archivo | Notas |
|---------|--------|
| `mikrotik.client.ts` | ~1505 LOC, 0 tests |
| `routeros-api.client.ts` | Protocolo binario, 0 tests (encode/decode son candidatos fáciles) |
| `zte-olt.client.ts` | ~5109 LOC |
| `huawei-olt.client.ts` | ~1807 LOC |
| `zte-olt-snmp.client.ts` | ~1143 LOC |
| `huawei-olt-snmp.client.ts` | ~611 LOC |
| `mikrotik-poll.service.ts` | — |
| `olt-inventory-poll.service.ts` | — |
| `olt-inventory-cache.ts` | solo tipos |
| `onu-connected.service.ts` | ~2895 LOC — authorize/sync/poll |
| `onu-tr069-config.service.ts` | ~1320 LOC |
| `onu-migration.service.ts` | — |
| `genieacs-nbi.client.ts` | findBySerial / serialIdTokens buenos unit-test targets |
| `onu-migration-name.util.ts` | heurística LATAM — ideal para spec |
| `ip-pool.service.ts` | ~1037 LOC |
| `ip-pool.util.ts` | computeIpNetwork — fácil y crítico (P0.6) |
| `service-vlan.service.ts` | — |
| `suspension-portal.service.ts` | — |
| `vpn.service.ts` | ~1491 LOC |
| `billing.service.ts` / scheduler | periodos + generate — sin specs de política suspended |
| `client-portal.service.ts` | webhook MP / metrics — sin specs |

### P2.2 Utils sin spec
- `zte-olt-onu.util.ts` (958) — parsers densos, alto riesgo de regresión
- `zte-olt-speed.util.ts`, `zte-olt-onu-type.util.ts`
- `huawei-olt-vlan.util.ts`, `huawei-olt-uplink.util.ts`, `huawei-olt-profile.util.ts`
- `huawei-olt-snmp.oids.ts` (ZTE oids sí tienen spec)
- `genieacs-nbi.client.ts` helpers (`serialIdTokens`, `deviceIdMatchesSerial`, `genieGet`)
- `ip-pool.util.ts` (`computeIpNetwork`, `firstFreeIp`)
- `billing/cron.util.ts` (candidato fácil)

### P2.3 Specs existentes (no tocar salvo ampliar)
- `olt-ssh-host-key.util.spec.ts`
- `zte-olt-firmware.util.spec.ts`, `huawei-olt-firmware.util.spec.ts`
- `zte-olt-snmp.oids.spec.ts`
- `zte-olt-vlan.util.spec.ts`, `zte-olt-uplink.util.spec.ts` (+pon normalize)
- `huawei-olt-onu.util.spec.ts`
- `huawei-olt-firmware.util.spec.ts`
- `vpn-script.util.spec.ts` — **bueno:** rechaza injection RouterOS en name/password/host

---

## P3 — Diseño / claridad / incompleto

### P3.1 Routers `cisco` / `edge_router` en catálogo sin implementación
- **Archivos:** `router.constants.ts`, UI labels, probe → error “not implemented”
- **Acción:** Ocultar en create form o marcar “próximamente”; evitar selección accidental.

### P3.2 Nombre engañoso `MikrotikPollService`
- **Qué:** También hace liveness SNMP de OLTs cada 15s.
- **Acción:** Renombrar a `DeviceHealthPollService` (o similar) + update module.

### P3.3 Legacy `zte_c3xx` sigue en queries de poll
- **Archivo:** `pollMikrotikDevicesInSchema` incluye `'zte_c3xx'`
- **Acción:** Plan de migración forzada a subtype explícito + deprecar bucket.

### P3.4 Adapter registry ZTE parece dead code
- `getZteAdapter` / `listZteAdapters` sin consumidores en apps/
- **Acción:** Usar en probe/capability UI o eliminar.

### P3.5 Dos vocabularios de firmware ZTE
- `olt.constants`: `'1.2'|'2.0'|'2.1'|'titan'`
- `zte-olt-firmware.util`: `'c3xx'|'c6xx'|'unknown'`
- **Qué:** Mapping en probe (`c6xx`→`titan`) es frágil.
- **Acción:** Unificar tipos o documentar capa de traducción única.

### P3.6 Tipos compartidos con nombres ZTE para Huawei
- `ZteConnectedOnu`, `ZteOltProbeResult`, `ZteSnmpOnuRow` reusados por Huawei.
- **Acción:** Renombrar a `OltConnectedOnu` / `OltProbeResult` (breaking rename interno).

### P3.7 Paneles web OLT: sin refresh automático de status SNMP
- **Archivos:** `OltUplinksPanel`, `OltPonPortsPanel`, `OltVlansPanel`, `OltSpeedProfilesPanel`
- **Qué:** Cache-first + `?refresh=1` manual. Status SNMP se refresca en background poll / al abrir según backend.
- **Acción:** Polling suave de status mientras el panel esté abierto (opcional).

### P3.8 VLAN create fuerza `isolated: true`
- **Archivo:** `OltVlansPanel.tsx` — en create manda `isolated: true` fijo
- **Acción:** Confirmar si es regla de negocio intencional; si no, checkbox en create.

### P3.9 `onu-type-olt-sync` post-probe puede alargar “Probar”
- **Archivos:** `topology.service` llama `onuTypeSync.syncTypesForConnectedOlt` tras probe OK
- **Qué:** Lista types + push missing = más sesiones CLI.
- **Acción:** Mover a job background / cola; no bloquear respuesta de probe.

### P3.10 TR069 ACS probe intenta muchos hosts
- **Archivo:** `tr069.service.ts` — `vpn-concentrator`, `host.docker.internal`, `172.17.0.1`, `127.0.0.1`…
- **Acción:** Documentar orden; evitar falsos “online” en entornos inesperados.

### P3.11 `OnuConnectedService` god-class (~2895 LOC)
- Authorize Huawei/ZTE, discover, import, deny, sync, detail, reboot/enable/delete, poll SNMP+CLI, traffic samples.
- **Acción:** Partir en `OnuAuthorizeService`, `OnuInventorySyncService`, `OnuMetricsPoller` (el poller ya existe pero la lógica vive aquí).

### P3.12 Migración ONU es solo scan (no move/reauth)
- **Archivo:** `onu-migration.service.ts` (~279 LOC)
- **Qué:** `scan` + `sourceVlans`; sugiere nombres vía `onu-migration-name.util`. No re-autoriza en otra OLT desde este service.
- **Acción:** Clarificar en UI “importar clientes desde inventario” vs “migrar entre OLTs”; si hay move flow, documentar dónde vive.

### P3.13 SNMP discover pierde name/VLAN/mode
- **Archivo:** `onu-connected.service.ts` `discover` map SNMP → snap
- **Qué:** `onuType`, `description`, `mode`, `vlan`/`vlans` quedan null/[] en path SNMP.
- **Acción:** Enrichment CLI selectivo o aceptar y documentar que sync SNMP es status-only.

### P3.14 Portal suspensión: lista de pagos hardcodeada MercadoPago
- **Archivo:** `suspension-portal.service.ts` `SUSPENSION_PAYMENT_ALLOW_DOMAINS`
- **Qué:** Solo dominios MP/ML; otros PSP no pasan el allow-list.
- **Acción:** Configurable por tenant / env.

### P3.15 Portal suspensión exige API binaria (no REST)
- Documentado en errores; si el router está en `rest_https:443` falla configure.
- **Acción:** UI: deshabilitar configure o auto-sugerir api_ssl cuando se active portal.

### P3.16 IP pool create hace upsert silencioso
- **Archivo:** `ip-pool.service.ts` create — si existe OLT+VLAN+purpose, actualiza en vez de 409.
- **Acción:** Confirmar UX (OK) o devolver flag `updated:true` explícito / endpoint PUT separado.

### P3.17 VPN import phases acopladas a MikroTik-only
- Cisco/edge_router no aplican; coherente con P3.1.
- Setup token cross-tenant (`getSetupByTokenAcrossTenants`) — ver P0.9.

### P3.18 Topology god-controller + module surface grande
- `TopologyController` concentra graph + OLT panels + MikroTik ports/links + raw command.
- `TopologyModule` registra 14 controllers + 3 pollers + todos los clients.
- **Acción:** Partir OLT inventory endpoints a `OltInventoryController`; MikroTik ports a `RouterPortsController`.

### P3.19 Network nodes son inventario físico, no control de equipo
- `NetworkNodeService`: sitios con assets (routers/OLTs), headers/ports de armario, health rollup desde `connectionStatus`.
- No habla CLI/SNMP directo — depende del poller. OK; documentar relación nodo↔device.

### P3.20 Dual-mode suspensión CRM ↔ red
- **Archivo:** `crm.service.ts` `applyNetworkServiceStatus`
- **Modos:**
  1. `tenant.suspensionPortalEnabled` → MikroTik address-list (+ portal captive)
  2. else → `OnuConnectedService.disable/enable` en OLT
- Router hint: `onu.wanPoolId` → `pool.routerId`; fallback routers configurados / todos.
- Billing **no** auto-suspende (solo lee active/suspended para facturar).
- **Acción:** Documentar en UI Empresa qué modo está activo; job de reconciliación address-list ↔ services suspended.

### P3.21 Sin reconciliación address-list ↔ CRM
- Si MikroTik se reconfigura, o WAN IP de ONU cambia tras suspend, la list puede quedar stale.
- **Acción:** Al cambiar `wanIp` / re-sync portal, actualizar entries; comando “reconciliar suspensiones”.

### P3.22 Client portal solo lectura de red (signal + métricas)
- `listServices` expone `signalDbm`; `GET portal/services/:id/metrics` lee `onu_metric_samples` (kinds `rx_bps`/`tx_bps` — ver P1.11).
- No puede suspender/autorizar; OK. Métricas dependen del poller 60s.
- **Acción:** Documentar retraso ~1 min; opcional ocultar tráfico si naming confunde.

### P3.23 Billing ↔ red desacoplado por diseño actual
- Jobs: `billing.periods` / `generate` / `send` (BullMQ, cron por tenant).
- Generate solo `active`; no llama Topology/CRM para corte.
- **Acción:** Producto: “corte por mora” como feature explícita (P1.21).

---

## Mapa de endpoints (topology module)

Auth tenant (`Jwt` + `Roles(tenant_user)` + `TenantRoles`):
escrituras suelen exigir `CRM_WRITE_ROLES`.

| Prefijo | Rol |
|---------|-----|
| `GET/POST/PATCH/DELETE app/topology` | Grafo, devices, OLT cards/pon/uplinks/vlans/speed, rogue, sync-ports, **mikrotik/command**, ports, links |
| `app/topology/vpn` | Túneles + setup/probe/import |
| `app/onus` | Inventario ONU, authorize, TR069 config, network-vlans steps, reboot/… |
| `app/onus/migration` | scan / source-vlans |
| `app/settings/ip-pools` | CRUD pools + addresses |
| `app/settings/vlans` | Service VLANs + sync/verify device |
| `app/settings/tr069` | Perfiles ACS + attach OLTs |
| `app/settings/onus` | Types/profiles tenant |
| `app/network-nodes` | Nodos físicos + headers |
| `admin/onus` | Catálogo global ONU |
| `admin/vpn` | Config concentrador WG/OVPN |
| `public/vpn-setup/:token` | Script RSC (sin JWT, TTL 5m) |
| `public/suspension-portal/:slug` | Página suspendido |
| `portal/:slug/suspended` | Legacy alias |
| `internal/vpn/concentrator-state` | Header `X-VPN-SYNC-SECRET` |

CRM (relacionado red):
| `POST app/crm/client-services/:id/suspend` | → setServiceStatus suspended (+ red) |
| `POST …/activate` | → active (+ red) |
| `POST …/end` | → ended (**sin** limpiar red hoy — P1.18) |
| `PATCH …/client-services/:id` | puede setear status **sin** red — P1.17 |

Portal cliente / billing:
| `public/client-portal/:slug/*` | branding, login, invite, **webhook MP** |
| `portal/services`, `…/metrics` | ONU signal + samples |
| Billing jobs | periods / generate / send — **sin** auto-suspend |

---

## P4 — Mejoras / nice-to-have

- [ ] Tests unitarios de `encodeWord` / `encodeSentence` / decode RouterOS
- [ ] Tests de pairing `pairOltSpeedProfiles` (UP/DOWN + TLG-)
- [ ] Tests `parseOnuStateRows` con samples C3xx + Titan
- [ ] Tests `serialIdTokens` / `deviceIdMatchesSerial` / `suggestClientNameFromOlt`
- [ ] Tests `computeIpNetwork` / `firstFreeIp` + rechazo prefix pequeños
- [ ] Tests CRM `setServiceStatus` portal vs OLT modes
- [ ] Tests billing política suspended (P1.20)
- [ ] Tests webhook MP signature + amount (P0.10)
- [ ] Interfaz común CLI + SNMP (ver P1.1)
- [ ] Telemetría: duración CLI queue wait, SNMP walk duration por OLT
- [ ] Documentar en README matriz vendor × protocolo × poller
- [ ] Huawei: specs para vlan/uplink/profile parsers (mirror ZTE)
- [ ] Capar/paginar GenieACS device listing (P0.5)
- [ ] Capar prefix pools + no materializar hosts (P0.6)
- [ ] Estrechar DEFAULT_VPN_TUNNEL_ROUTES (P0.7)
- [ ] Allowlist o remover mikrotik/command (P0.8)
- [ ] Índice global VPN setup tokens (P0.9)
- [ ] Reconciliar suspensiones CRM↔MikroTik (P3.21)
- [ ] Auto-suspend por mora opcional (P1.21)

---

## Mapa rápido de arquitectura (referencia)

```
BillingScheduler → BullMQ → periods | generate(active only) | send
  ╳ no llama CRM suspensión (P1.21 / P3.23)

UI CRM suspend/activate
  → CrmService.setServiceStatus
       ├─ portal ON  → SuspensionPortalService → MikroTik address-list
       └─ portal OFF → OnuConnectedService.disable/enable → OLT CLI

Client portal
  → listServices (signalDbm) + metrics (onu_metric_samples)
  → MP preference + webhook (P0.10)

TopologyModule → MikrotikClient | oltCli/oltSnmp | GenieAcsNbiClient
Pollers: 15s health | 30m OLT inventory | 60s ONU metrics
```

---

## P5 — Reportados en uso real (2026-08-01)

### P5.1 Probe MikroTik podía colgarse para siempre — RESUELTO
- **Archivos:** `routeros-api.client.ts` (`connect`), `topology.service.ts` (`probeAndPersistUnlocked`, `probeAndPersist`, `deleteDevice`)
- **Qué:** La opción `timeout` de `net/tls.connect` solo arma el idle timer de Node y no destruye el socket; sin listener `'timeout'` un host filtrado (DROP) o un puerto que no habla API-SSL dejaba la promesa pendiente. `mikrotik.probe()` no estaba envuelto en `withTimeout`, así que `PATCH …/connection` y `POST …/connection/test` nunca respondían (UI “Guardando…” eterno).
- **Efectos secundarios:** `probeInFlight` no se liberaba → pollers y “Probar” posteriores hacían `return` inmediato y el equipo quedaba congelado en `unknown`; `withDeviceLock` de MikroTik encolaba cualquier otra operación al mismo host; tras borrar el equipo, el probe colgado hacía `devices.save(device)` y TypeORM lo re-insertaba (equipo “resucitado”).
- **Fix:** deadline duro en `connect` (destroy + reject), `withTimeout` 25 s por intento con presupuesto total 45 s, `probeInFlight` como `Map` con robo de slot tras 120 s, `persistProbedDevice` (`existsBy` antes de `save`) y limpieza de slot/streak en `deleteDevice`.

### P5.5 Equipo eliminado reaparecía por otras escrituras lentas — RESUELTO
- **Archivos:** `device-persist.util.ts` (nuevo), `topology.service.ts` (`saveInventoryCache`, VLAN meta), `service-vlan.service.ts`
- **Qué:** El patrón “cargar device → I/O lento (CLI/SNMP/API) → `save(device)`” resucita la fila si el operador borra el equipo en el medio, y no era solo el probe. `saveInventoryCache` era la peor: al no encontrar la fila caía en `?? device` y volvía a insertar la entidad en memoria. Igual riesgo en los `save` de `oltVlanMeta` tras `create/deleteVlan` por CLI (hasta 60 s).
- **Fix:** helper compartido `saveDeviceIfPresent` (`existsBy` antes de `save`, devuelve `false` si la fila ya no está) usado en esos puntos; `saveInventoryCache` sale sin escribir si la fila desapareció; los probes cortan el trabajo posterior (metric samples, sync de tipos ONU, sync de puertos) cuando el guard devuelve `false`.
- **Pendiente menor:** los `save(device)` inmediatos tras cargar (`importSkip`, `importOne`, `importToRouterPhase`) siguen sin guard porque la ventana es de milisegundos.

### P5.2 `openvpn_udp` es seleccionable pero el concentrador no escuchaba UDP — RESUELTO
- **Archivos:** `deploy/vpn-concentrator/entrypoint.sh`, `vpn.constants.ts`, `vpn-script.util.ts`, `vpn.service.ts`, `VpnModal.tsx`
- **Qué:** El entrypoint escribía `server-udp.conf` y el compose publicaba `1195/udp`, pero solo arrancaba el daemon TCP (`UDP deferred — mismo pool 10.69/16`), así que un túnel OpenVPN UDP nunca podía conectar.
- **Fix:** pools disjuntos por transporte — TCP `10.69.0.0/17` en `tun0`, UDP `10.69.128.0/17` en `tun1`, con CCD, snippet de rutas, status log y lista de IPs de gateway propios. La API asigna 10.69.1–126 para TCP/WireGuard y 10.69.129–254 para UDP (`VPN_TUNNEL_THIRD_OCTET_RANGES`) y valida la subred manual contra el pool. El concentrador arranca los dos daemons, los vigila cada 5 s y avisa por log si un túnel viejo quedó fuera de su pool (hay que recrearlo).
- **También cierra P1.14:** `allocateTunnelSubnet` ya no reutiliza una subred al azar cuando el rango se agota; lanza error.

### P5.3 WireGuard sin private key en el contenedor VPN falla en silencio
- **Archivo:** `entrypoint.sh` `wg_reload` (“WireGuard sin private key — skip”)
- **Qué:** Si falta `VPN_WIREGUARD_SERVER_PRIVATE_KEY` en el servicio `vpn-concentrator`, `wg0` no se levanta y el túnel queda `pending` sin error visible.
- **Acción:** Exponer el estado del concentrador en el diagnóstico del túnel.

### P5.6 “Importar al router” aplicaba CERO comandos y decía OK — RESUELTO
- **Archivos:** `vpn-script.util.ts` (`routerosLineToWords`, `scriptToApiBatches`), `vpn.service.ts` (`importToRouterPhase` fase `apply`)
- **Qué:** El traductor de script → words de la API exigía rutas con slash (`/interface/ovpn-client`), pero el script usa sintaxis CLI con espacios (`/interface ovpn-client add …`). Ninguna línea del script real hacía match, así que `scriptToApiBatches` devolvía `[]`: el plan mostraba “importación completa (0 comandos)” y el apply corría `runWordsMany` con lista vacía y respondía `ok: true`, “Script completo: 0/0 OK”, sin tocar el router. El túnel quedaba sin `ovpn-client`, sin reglas de firewall y sin rutas.
- **Fix:** la ruta CLI se normaliza a slashes; se saltan los `set` sobre ítem con nombre implícito (`/ip service set api-ssl disabled=no` necesita `.id`, no es traducible); `apply` con 0 comandos ahora es `400` con instrucción de usar Bootstrap/pegar el script, y `ok` ya no es `true` con `results.length === 0`. Verificado que ahora se emiten `ovpn-client`/`wireguard` + peers + `/ip address` + 4 reglas de firewall + MSS clamp + rutas.
- **Pendiente menor:** los `remove [find comment~…]` no se traducen, así que un re-import completo puede duplicar reglas (solo ocurre si la interfaz no existe).

### P5.8 `place-before=0` por la API → las reglas de firewall del túnel nunca se creaban — RESUELTO
- **Archivos:** `vpn-script.util.ts` (`placeBeforeTables`, `resolvePlaceBeforeBatches`), `vpn.service.ts` (`resolvePlaceBefore`, fases `apply` full e incremental)
- **Qué:** `place-before=0` es el *ordinal* del CLI. Por la API el valor tiene que ser un `.id` interno (`*3`); con `0` el `add` falla con “no such item”. Confirmado en producción (RB4011, ROS 7.23.2): `Script completo: 7/10 OK` y la verificación reportó `vpn-fwd-in`, `vpn-fwd-out` y `vpn-input` como *No encontrada*. El `nat` pasó solo porque su primera regla tenía id `*0`. Sin el `accept` en `chain=input` para la interfaz del túnel, la gestión por VPN se cae con timeout aunque la IP pública funcione — y el plan incremental arrastraba el mismo error, así que reintentar no lo arreglaba nunca.
- **Fix:** antes de aplicar se imprimen solo las tablas involucradas y se sustituye `place-before` por el `.id` de la primera regla **de la misma cadena**; si la cadena está vacía se quita el argumento (la regla ya queda primera). La parte pura está testeada (3 casos).
- **Nota:** `suspension-portal.service.ts` ya lo hacía bien (`=place-before=${dropId}`) — era el patrón correcto a copiar.

### P5.10 El concentrador salía con el origen equivocado: ningún túnel salvo el primero era gestionable — RESUELTO
- **Archivo:** `deploy/vpn-concentrator/entrypoint.sh` (`apply_state` → `route` del /24, `add_gateway_ips_to_dev` → SNAT)
- **Evidencia (producción):** `docker exec isp-control-vpn ip route get 10.69.1.2` → `via 10.69.0.2 dev tun0 src 10.69.0.1`; `ping` desde el concentrador al router 100% de pérdida, mientras el ping del MikroTik al servidor sí llegaba, y falla igual con dos routers distintos.
- **Qué:** `apply_state` escribía `route <cliente>/24` en `server-routes-<proto>.conf`. Esa ruta es redundante (el `/17` del pool ya cubre el `/24`) y OpenVPN la instala **con gateway** (`via 10.69.0.2`, el route-gateway del pool), lo que le gana a la ruta on-link que crea la IP secundaria `10.69.x.1/24`. Al ser ruta con gateway, el kernel elige como origen la IP primaria del tun (`10.69.0.1`) y el `MASQUERADE` la conserva. El MikroTik solo tiene ruta de vuelta a su peer (`10.69.x.1/32`), así que la respuesta se iba por el WAN: timeout en todos los sondeos.
- **Por qué “antes sí conectaba”:** el primer túnel histórico caía en `10.69.0.0/24`, donde el cliente es `10.69.0.2` (= el route-gateway) y el origen `10.69.0.1` sí es on-link. Cualquier túnel posterior (`10.69.1.0/24`, `10.69.2.0/24`…) quedaba inalcanzable. El `iroute` del CCD se mantiene: la entrega interna de OpenVPN no dependía de esa ruta.
- **Fix:** no se emite `route` para el `/24` del propio túnel (sí para las LAN detrás del router) y se fuerza el origen con `SNAT --to-source 10.69.x.1`, insertado antes del `MASQUERADE` genérico.
- **Orden del SNAT:** las reglas viven en una cadena propia `ISP_VPN_SNAT` (jump insertado una vez en `POSTROUTING`) que se **reescribe entera en cada sync**, con los archivos ordenados de más específico a más amplio. Con reglas sueltas el orden dependía de cuándo se insertó cada una, y un rango amplio publicado por otro túnel (`10.0.0.0/8` de la lista por defecto) le tapaba la `/24` propia. Verificado con dos túneles sobre `tun0`, uno con `/8` + `/16`.
- **Cómo agregar una red nueva:** la lista de rutas del túnel es la única fuente de verdad (alimenta `iroute`, `route`, `lan-routes.txt` y el SNAT). Rangos por defecto `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`; `172.10.220.0/24` queda fuera de todos (172.10 no es RFC1918), por eso hay que declararla. En el MikroTik hacen falta además los `accept` de `chain=forward`.
- **Alcance ampliado (mismo bug, un salto más):** las LAN publicadas por el túnel (p. ej. `172.10.220.0/24`) también se instalan `via 10.69.0.2`, así que los equipos detrás del router central recibían tráfico desde `10.69.0.1` y tampoco tenían ruta de vuelta. `apply_state` ahora emite `snat-<proto>.txt` con `<peer> <red>` para la red del túnel **y** cada `lanRoute`, y `apply_tunnel_snat` inserta una regla por red. Verificado simulando `apply_state` con un túnel TCP (2 LAN) y uno UDP.

### P5.9 Túnel conectado pero gestión intermitente (“Inestable 2/3”)
- **Contexto:** tras P5.8 el router responde por `10.69.1.2:8729` y el panel muestra métricas, pero ~2 de 3 sondeos dan `Connect timeout after 20000ms`. Ping desde el MikroTik al servidor OK.
- **Mitigado:** clamp de MSS (`TCPMSS --clamp-mss-to-pmtu`) en `FORWARD` para `tun0/tun1/wg0` en los dos sentidos — el certificado de `api-ssl` viaja en paquetes grandes y sin PMTUD el handshake se cuelga aunque el ping ande; y el probe vuelve a reintentar **una** vez ante timeout (nunca ante host muerto), para que un stall aislado no marque el equipo inestable.
- **Sospecha principal pendiente:** TCP dentro de TCP (túnel `openvpn_tcp`) amplifica retransmisiones y produce stalls de segundos. Evidencia a recoger en el router: `/ping 10.69.1.1 count=20 size=1400 do-not-fragment`, `/log print where message~"ovpn"`, `/interface ovpn-client print detail`. Si hay pérdida con paquete grande → MTU; si hay reconexiones → flapping; si está limpio → migrar el túnel a `openvpn_udp` (pool 10.69.129+ ya operativo).

### P5.7 `api-ssl` habilitado sin certificado → el panel se queda “Guardando…” — RESUELTO
- **Archivo:** `vpn-script.util.ts` (`buildMikrotikTunnelAccessRules`)
- **Qué:** El script hacía `/ip service set api-ssl disabled=no`, pero RouterOS necesita un certificado en ese servicio; sin él el puerto 8729 acepta el TCP y nunca completa el TLS. El probe (`api_ssl`/8729 por defecto en la UI) quedaba colgado en el handshake — antes para siempre, ahora 25 s de espera y error.
- **Fix:** si `api-ssl` no tiene certificado, el script crea y firma `isp-control-api` (2048, 10 años, `tls-server`) y lo asigna antes de habilitar el servicio. Es idempotente y no toca un certificado ya configurado. Los bloques `:if … do={}` se omiten al aplicar por API (no se pueden evaluar allí).

### P5.4 Sync del concentrador cada 30 s sin feedback en UI
- **Qué:** `VPN_SYNC_INTERVAL_SEC=30`. Aplicar el script en el MikroTik antes de la primera sync da `AUTH_FAILED` y el operador no sabe que debe esperar.
- **Acción:** Forzar sync al crear/editar túnel (o mostrar “esperando concentrador…” hasta que el peer exista).

---

## P6 — Regresiones del soporte multi-vendor (Huawei + ZTE Titan)

Contexto: todo funcionaba con ZTE C320 hasta `b3e49a7` (“Harden platform security and complete multi-vendor OLT support”). El commit bueno anterior es `9fd0a47`.

### P6.1 “Verificar en equipos” siempre decía “faltan equipos” en OLT — RESUELTO
- **Archivo:** `service-vlan.service.ts` (`discoverPresence`, `verify`, `ensureOnOlt`, nuevo `rememberOltVlan`)
- **Qué:** Antes de `b3e49a7`, `discoverPresence` abría Telnet y leía las VLANs de cada OLT (`listVlans`), así que `verify` las encontraba. El commit lo cambió a leer **solo** `oltVlanMeta` (“Do NOT open Telnet here… Live OLT VLAN scrape stays on explicit sync/verify actions”), pero `verify` sigue usando `discoverPresence` y **ningún** paso del asistente de VLANs escribe `oltVlanMeta`: `ensureOnOlt` confirma/crea por CLI y no anota nada. Resultado: el paso 2 daba OK (“ya existía en la OLT”) y el 3 fallaba siempre con “VLAN N: faltan equipos”. El camino del panel de la OLT (`topology.upsertDeviceVlan`) sí anotaba la meta, de ahí que pareciera aleatorio. La lista de VLANs también mostraba la columna OLT vacía.
- **Fix:** (1) `ensureOnOlt` anota la VLAN en `oltVlanMeta` vía `rememberOltVlan` tanto si la creó como si ya existía; (2) `discoverPresence` suma `oltInventoryCache.vlans` (sigue siendo DB-only, sin Telnet); (3) si esas dos fuentes no la conocen, `verify` sí consulta la OLT por CLI y, cuando la encuentra, actualiza la meta; (4) el mensaje de error ahora nombra el equipo y el motivo (“no encontrada en la OLT”, “no se pudo leer la OLT: …”) en vez de “faltan equipos”.

### P6.3 “Eliminar VLAN” decía OK y la VLAN seguía en la OLT — RESUELTO
- **Archivos:** `zte-olt.client.ts` `deleteVlan`, `zte-olt-vlan.util.ts` (`interpretNoVlanOutput` + spec), `service-vlan.service.ts` (`forgetOltVlan`), `topology.service.ts` (`deleteDeviceVlan`)
- **Qué:** `deleteVlan` mandaba `no igmp mvlan N` + `no vlan N` y devolvía `ok: true` **sin mirar la salida**. La C320 rechaza `no vlan` si la VLAN está en uso (service-port de una ONU, interfaz, uplink), así que el panel informaba “VLAN N eliminada de la OLT” y la VLAN seguía configurada — y al refrescar volvía a aparecer. Segundo efecto, del arreglo de P6.1: al sumar `oltInventoryCache.vlans` como fuente de presencia, borrar solo `oltVlanMeta` dejaba la VLAN listada igual.
- **Fix:** `interpretNoVlanOutput` (testeado, 4 casos) distingue borrado limpio, “does not exist” (idempotente, se acepta) y rechazo (`%Error…`, `is used by…`) devolviendo el motivo de la OLT; `deleteVlan` ahora falla con ese texto. `forgetOltVlan` borra meta **y** entrada de la caché en el mismo save; `deleteDeviceVlan` purga la caché antes del `refreshVlansViaCli` para que un refresh fallido no reviva la fila.
- **Huawei:** no afectado — `config()` llama `throwIfCliError` tras cada comando, así que `undo vlan N` ya lanzaba.

### P6.2 Aislamiento de VLAN: 3 comandos a ciegas y el rechazo se reporta como éxito
- **Archivo:** `zte-olt.client.ts` `upsertVlan` (~3695)
- **Qué:** Prueba `no all-to-all` → `isolate enable` → `isolate` (o los inversos) y si los tres fallan devuelve `ok: true` con el aviso “la OLT rechazó el comando de aislamiento (revisa el firmware)”. Es previo a `b3e49a7` (no es regresión), pero es el mensaje de “comando mal estructurado” que ve el operador y deja la VLAN sin el aislamiento pedido sin fallar.
- **Acción:** confirmar la sintaxis real por dialecto (C320 V1.2/V2.1 vs C6xx) y usar una sola, o al menos reflejar en el resultado que el aislamiento no se aplicó.
- **Relacionado:** P1.15 y P3.8 (se fuerza `isolated: true` en todos los create).

### P6.4 Auditoría CLI ZTE completa: `9fd0a47` → HEAD

Se comparó comando por comando toda la superficie CLI ZTE contra el último commit bueno.

**Conclusión previa importante:** el dialecto de ifName **no** es la regresión de la C320. Todos los caminos c3xx siguen emitiendo `gpon-olt_1/2/1` / `gpon-onu_1/2/1:5`, y `unknown` cae a c3xx. Los ifName en el cable son idénticos antes y después. El daño está en otras cuatro áreas.

#### Resueltos en esta pasada

| # | Qué | Archivo |
|---|-----|---------|
| 1 | **El lector se desfasaba tras un timeout.** `readUntil` (telnet y SSH) rechazaba sin limpiar `this.buffer`, así que la respuesta atrasada del comando N se entregaba como respuesta del N+1 durante el resto de la sesión: estados de ONU, SN y potencias mal atribuidos, o puertos enteros perdidos. Es la causa raíz de los síntomas “datos raros” intermitentes. | `zte-olt.client.ts` (ambos `readUntil`) |
| 2 | **Timeouts de lectura recortados ~40%.** `show gpon onu state` 25→15 s, `baseinfo` 25→15 s, `pon power onu-rx` 20→12 s, `onu uncfg` por puerto 15→8 s, `show interface` 12→8 s, `show running-config interface` 12→8 s. Un puerto PON lleno en V1.2 pasa de 15 s. Restaurados. | `zte-olt.client.ts` |
| 3 | **`looksCompleteRunningConfig` convertía degradación en error.** Rechazaba el volcado si la última línea no era un prompt; como `readUntil` resuelve con el primer `#` que aparece, un `#` dentro de una `description` truncaba el dump y las pestañas Uplinks / PON fallaban por completo. Ahora avisa y parsea lo recibido: el chequeo de “cero interfaces” que ya existía debajo es el que protege la caché. | `zte-olt.client.ts` (`listUplinks`, PON light) |
| 4 | **Señal inventada.** En el fallback de RX, si la ONU pedida no estaba en el mapa se tomaba “el primer número del texto” del puerto completo: devolvía la lectura de otra ONU o un dígito del propio ifName (típico `1 dBm`). Eliminado; ahora queda `null`. | `zte-olt.client.ts` |
| 5 | **`!` no cerraba el bloque de interfaz.** El último bloque del volcado se tragaba la config global que sigue, y un `shutdown`/`description` global se atribuía al último uplink o puerto PON. Ahora cierra en `!` a columna 0 y sigue ignorando el `!` indentado (decorativo). | `zte-olt-uplink.util.ts` + spec |
| 6 | **TR069 exigía usuario y clave de ACS.** Antes tenían default `'acs'`; cualquier perfil ACS sin credenciales (auth por SN/OUI) dejó de aprovisionar. Defaults restaurados; el endpoint sigue siendo obligatorio. | `zte-olt.client.ts` |
| 7 | **`show gpon onu uncfg` global podía ocultar ONUs.** Se parsea sin `defaultOltIf`, así que el formato SN-only queda afuera; y con ≥1 fila parseada se hacía `return` y el barrido por puerto no corría. Ahora se compara filas parseadas contra líneas de datos (`countUncfgDataLines`) y, si se perdió alguna, se completa por puerto (el dedupe por SN ya existía). | `zte-olt.client.ts`, `zte-olt-onu.util.ts` + spec |
| 8 | **ifName Titan hacia una C320.** El fallback `interface vport-…` de TR069 corría con `family === 'unknown'`, cuando todo el resto del cliente asume c3xx en ese caso. Ahora solo con `c6xx`. | `zte-olt.client.ts` |
| 9 | **`write` desde submodo.** `ensureOnuTypeOnOlt` salía un solo `exit` del submodo `pon` y mandaba `write` crudo, que en ZTE es Invalid command; ahora usa `persistRunningConfig` (`end` + `write`). | `zte-olt.client.ts` |
| 10 | **La caché de dialecto le ganaba al modelo declarado.** Una entrada de 5 min por `host:port` cortocircuitaba la detección antes de leer el `subtype`; dos OLTs detrás del mismo NAT/VPN compartían dialecto. Ahora el subtype declarado manda, la caché solo se usa cuando la detección da `unknown`, y la clave incluye el subtype. | `zte-olt.client.ts` |

#### Pendientes (necesitan decisión o la OLT del usuario)

- **Contraseña de enable:** `b3e49a7` reemplazó el `zxr10` hardcodeado por la contraseña de login. Quitar el default fue correcto; perder el campo no: `NetworkDevice.mgmtEnablePassword` existe pero `topology.service.ts:168` lo descarta explícitamente y el cliente nunca lo recibe. Una C320 con usuario que no sea privilegio 15 y enable de fábrica se queda en EXEC de usuario y todo falla después. Falla con timeout (no corrompe), y el setup documentado es privilegio 15 sin enable, así que el alcance es limitado. Arreglo: pasar `mgmtEnablePassword` por los `zteConn()` y usar `enablePassword ?? password` en los 4 sitios de enable (toca ~46 firmas de método, por eso no se hizo acá).
- **`listPonPorts` en modo light no lee ONUs ni óptica:** solo `show card` + un `show running-config`. `onuOnline`, `onuTotal`, `avgSignalDbm`, `txPowerDbm` quedan en 0/null y `status` es solo `adminEnabled ? 'Up' : 'Down'`. `topology.service.ts` lo compensa con el overlay SNMP, así que en una OLT **sin** SNMP la pestaña Puertos muestra todo Up con 0 ONUs. Arreglo: caer al camino completo por puerto cuando no hay overlay, o exponer `light: false` en el refresh manual.
- **`listUplinks` dejó de leer cada interfaz:** se quitaron `show interface <if>` y `show interface optical-module-info <if>`, así que `negotiation`, `wavelengthNm`, `signalDbm` y `tempC` son `null` fijos y `parseInterfaceStatus` / `parseOpticalUplink` quedaron sin llamador. Arreglo: reemitirlos cuando `priority === 'interactive'`.
- **Comandos a ciegas que devuelven `ok: true` sin mirar la respuesta** (previos a `b3e49a7`, no regresiones): `setRogueDetect`, `configureUplink`, `configurePonPort`, `enableAllPonPorts`, los `onu-type-if` de `ensureOnuTypeOnOlt`, el `name`/`description` de `authorizeOnu` y los `ip-host` de TR069. Mismo patrón que causó P6.3.
- **Sin verificar contra hardware:** la salida real de `show vlan` y `show gpon onu uncfg` en una C320 V1.2/V2.1 (no hay capturas en el repo; el regex nuevo de `show vlan` solo se prueba contra un fixture sintético), y si `show running-config | include …` lo acepta el firmware del usuario.

#### Sin regresión (verificado)

Los parsers se **ampliaron**, no se reemplazaron: `zte-olt-onu.util.ts`, `zte-olt-pon.util.ts`, `zte-olt-speed.util.ts` y `zte-olt-onu-type.util.ts` siguen matcheando el formato clásico de la C320 (los alternantes Titan se sumaron con `|`). `zte-olt-vlan.util.ts` sigue siendo c3xx-only en su escaneo de tags PON/ONU: si algo rompe ahí, rompe en C6xx, no en C320. La anidación de `configure terminal` está balanceada en todos los bloques.

---

## P7 — Switches MikroTik (RouterOS + SwitchOS)

### Modelo
- `type=switch` ahora admite `subtype`: `generic` | `mikrotik_routeros` | `mikrotik_swos`.
- UI: Fabricante (Genérico / MikroTik) + OS (RouterOS / SwitchOS).
- RouterOS reutiliza `MikrotikClient` (API-SSL/REST) + panel Bridge/VLANs (bridge → puertos/PVID → bridge vlan tagged/untagged).
- Las VLANs L3 (`/interface/vlan`) siguen siendo el flujo de **routers**; los switches usan bridge VLAN filtering.

### P7.1 SwitchOS write — PENDIENTE
- **Qué:** SwitchOS no tiene API oficial. Solo HTTP Digest a endpoints `.b` del web UI (`/sys.b`, `/link.b`, `/vlan.b`). Las escrituras suelen enviar el objeto completo; un payload mal formado puede corromper config (reportado por libs comunitarias).
- **Estado:** Cliente `swos.client.ts` + `swos.util.ts` hacen **solo lectura** (identidad, puertos, membresía VLAN). Escritura de puertos/VLANs queda pendiente tras pruebas contra hardware real (SwOS vs SwOS Lite usan field maps distintos).
- **Acción:** capturar dumps de un CSS/CRS en SwOS del usuario; implementar write read-modify-write por endpoint; no publicar write ciego.

### P7.2 Diferencia L2 switch vs L3 router
- Router: `createPortVlan` → `/interface/vlan` (interfaz L3 `vlan_N`).
- Switch RouterOS: `ensureBridge` + `setBridgePort` + `upsertBridgeVlan` → `/interface/bridge*`.

### P7.3 Service VLAN → switches (Ajustes → VLANs)
- Catálogo `service_vlans.switch_ids` + sync `kind: 'switch'` con `bridge` + `ports[{portId, mode: tagged|untagged}]`.
- `ensureOnSwitch` / `removeFromSwitch` vía bridge helpers; verify consulta bridge live si la caché no tiene la VLAN.
- UI `VlansSettingsTab`: sección Switches RouterOS con selector por puerto. SwitchOS write sigue en P7.1.

---

## P8 — “Esperando Inform”: el CWMP del ACS estaba en un agujero negro (2026-08-02)

### P8.1 DNAT del puerto CWMP a loopback → ningún Inform llegó nunca — RESUELTO Y VERIFICADO EN PRODUCCIÓN
- **Verificación (2026-08-02, tras desplegar `vive3d/isp-control-vpn:latest`
  `sha256:1ebc8283…`):** desde el túnel, `curl http://10.69.1.1:14501/` responde
  `HTTP/1.1 405 Method Not Allowed` con `Allow: POST` — la respuesta propia del
  CWMP de GenieACS. Antes: timeout. El camino ONU→ACS ya está abierto.

- **Archivos:** `deploy/vpn-concentrator/entrypoint.sh` (`sync_tunnel_gateway_ips`), `docker-compose.prod.yml` (`VPN_ACS_HOST: 127.0.0.1`)
- **Qué:** El concentrador publica el CWMP con
  `iptables -t nat -A PREROUTING -d 10.69.x.1 -p tcp --dport 14501 -j DNAT --to-destination 127.0.0.1:14501`.
  Linux descarta como **marciano** todo paquete que entra por `tun+`/`wg0` y acaba enrutado a `127.0.0.0/8`, salvo que se active `net.ipv4.conf.<dev>.route_localnet=1` — que no se activa en ninguna parte del repo. El SYN de cada ONU muere ahí, sin log y sin RST.
- **Lo peor:** el DNAT además **sobra**. Desde `27c20aa` GenieACS comparte netns con el concentrador (`network_mode: service:vpn-concentrator`) y CWMP escucha en `0.0.0.0:14501`, así que `10.69.x.1` ya es una IP local y el paquete se entregaría solo. La regla convierte un paquete entregable en uno descartado.
- **Evidencia (producción, desde el túnel, cliente 10.69.1.3):**

  | Destino | Resultado |
  |---------|-----------|
  | `ping 10.69.1.1` | 0% pérdida |
  | `10.69.1.1:1194` (OpenVPN, mismo netns) | abierto |
  | `10.69.1.1:3000` (UI GenieACS, mismo netns) | abierto — **HTTP 200** |
  | `10.69.1.1:14501` (CWMP, **único puerto con DNAT**) | timeout |
  | `10.69.1.1:7557` / `:7567` | cerrado (correcto, `isolate_acs_admin_ports`) |

  GenieACS está vivo y el netns es alcanzable por TCP desde el túnel; falla exactamente y solo el puerto que pasa por el DNAT.
- **Por qué el panel no avisa:** el probe del ACS entra por `eth0` (`vpn-concentrator:14501`, 172.28.10.20). El DNAT solo matchea `-d <IP de gateway del túnel>`, así que el probe no lo toca y el dashboard reporta el ACS sano mientras ninguna ONU puede informar.
- **Cuándo se rompió:** `27c20aa` metió GenieACS en el netns del concentrador y puso `VPN_ACS_HOST: 127.0.0.1` en el compose (el entrypoint aún tenía default `acs`); `f264077` cambió también el default del entrypoint a `127.0.0.1`. Antes el ACS era un contenedor aparte en `isp_net` con IP enrutable y el DNAT funcionaba.
- **Fix:** si el ACS es loopback y CWMP escucha en el comodín (se lee de `/proc/net/tcp`, sin depender de `ss`/`netstat`), no se instala DNAT y se purgan los que dejaron arranques anteriores; si el listener fuera loopback-only se mantiene el DNAT pero activando `route_localnet` en `tun0/tun1/wg0`.
- **Comprobación rápida en el servidor** (se auto-revierte en ≤30 s, cuando el sync reinstala la regla):
  ```sh
  docker exec isp-control-vpn sh -c \
    'iptables -t nat -S PREROUTING | grep -- "--dport 14501" | sed "s/^-A /-D /" \
     | while read r; do iptables -t nat $r; done'
  # y desde el túnel, en el acto:  curl -m5 http://10.69.1.1:14501/
  ```

### P8.4 Estado del ACS de producción: nunca recibió un solo Inform
- **Medido por SSH en el servidor (aaPanel + Docker), 2026-08-02:**
  - La base `genieacs` en `isp-control-acs-mongo` solo tiene las colecciones
    `cache`, `locks`, `tasks`. **No existe la colección `devices`**, que GenieACS
    crea al primer Inform → ningún CPE ha informado nunca contra este stack.
  - `faults=0`, `tasks=0`, `db.devices.countDocuments({})=0`.
  - `genieacs-cwmp.log` solo tiene los `Worker listening; address="0.0.0.0" port=14501`
    del arranque; no hay access log.
  - El volumen `isp-control_acs_mongo` nace el **2026-07-28**; existe otro,
    `isp-control_lab_mongo_data`, congelado el **2026-07-27** (el laboratorio
    `deploy/lab-tr069`). El “antes funcionaba” corresponde a ese entorno de
    laboratorio, no a este stack de producción.
- **Conclusión:** en producción el aprovisionamiento automático por TR-069 nunca
  llegó a completarse ni una vez; no es una regresión que rompiera un flujo que
  aquí estuviera vivo.

### P8.5 Camino VLAN de gestión → CWMP: abierto y verificado
- **Método:** el contenedor no tiene `/proc/net/nf_conntrack` (módulo no cargado
  en su netns), así que una sonda basada en conntrack da **falso negativo**. Hay
  que leer `/proc/net/tcp`: puerto en hex (`14501` = `38A5`) e IPs en
  little-endian (`0101450A` = `10.69.1.1`).
- **Prueba:** `POST http://10.69.1.1:14501/` desde el 4011 con
  `src-address=30.30.20.1` (gateway de la VLAN 401). Sockets al 14501 en el
  concentrador: **0 antes → 1 después**, `desde 172.10.220.2 estado=TIME_WAIT`
  (el 4011 tras su masquerade). La conexión TCP se completa y se cierra limpia.
- **Conclusión:** de la VLAN de gestión al ACS no queda nada roto. El único tramo
  que falla es ONU → VLAN 401 (`rx-pkt=0` en `vlan_401`, 0 MACs en la OLT).

### P8.2 El camino L3 desde la VLAN de gestión sí estaba bien
- Descartado como causa: el 4011 enmascara `30.30.20.0/24` hacia `Wan_RedCentral` (única regla srcnat), y la ruta al ACS sale justo por ahí, así que el Inform llega al concentrador con origen `172.10.220.2`, red que el túnel sí publica. `ping 10.69.1.1` con `src-address=30.30.20.1` da 0% de pérdida.
- Que el router BGP no tenga rutas a `30.30.20.0/24` / `40.40.20.0/24` es irrelevante por ese masquerade. No hace falta publicar esas redes en el túnel.

### P8.3 La plantilla OMCI del panel no abre camino de gestión en la ONU — PENDIENTE
- **Archivo:** `zte-olt.client.ts` `applyOnuTr069Mgmt`
- **Qué:** Sobre `gpon-onu_1/2/4:12` (SN `FHTT967F69A0`, `Config state: success`, sin config-fail) el running-config queda así:
  - `service-port 2 vport 2 user-vlan 401 vlan 401` y `gemport 2 tcont 2` — pero **no hay `flow 2 pri 2 vlan 401` ni `gemport 2 flow 2`**. El código los manda “best-effort” y **nunca mira la respuesta**, así que el gemport de gestión se queda sin flow y la ONU no sabe qué cursar por él.
  - La IP de gestión va a `ip-host 2`, pero el único etiquetado que se aplica es `vlan-filter veip 1 pri 2 vlan 401`. **No existe `vlan-filter iphost 2`**, así que el tráfico del ip-host sale sin etiqueta y lo come `untag-filter discard`.
  - Causa de fondo: el modo router del cliente (`wan-ip 1 … host 1`) ocupa el índice 1 y empuja la gestión al `ip-host 2`.
- **Medición:** `show mac vlan` en la OLT → **0 MACs** en 401, 402, 701 y 702 (todas VLAN creadas por el panel) frente a 65/56/40/30 en 350/351/500/501 (creadas por SmartOLT). Ninguna de las ~12 ONUs aprovisionadas por el panel cursa tráfico, ni de gestión ni de cliente.
- **No es incompatibilidad de modelo:** el mismo HG6244C funciona en 10 ONUs de la VLAN 500 y 1 de la 350. La forma que sí funciona es la de SmartOLT: `switchport-bind switch_0/1 iphost 1` + `ip-host 1 …` + `vlan-filter-mode iphost 1 …` + `vlan-filter iphost 1 pri 0 vlan N`, con la VLAN en el flow del gemport.
- **No es regresión de `b3e49a7`:** el diff de `applyOnuTr069Mgmt` contra `9fd0a47` solo cambia la resolución de ifName (que en C320 devuelve el mismo string), el fallback C6xx y los defaults de credenciales. `ip-host 2`, `veip 1`, `flow 2 pri`, `gemport 2 flow 2` y `vlan-filter veip` no se tocan desde el commit inicial.
- **Acción:** decidir plantilla (alinear con la forma SmartOLT vs arreglar gestión sobre `ip-host 2`) y, en cualquier caso, dejar de devolver “TR069 aplicado” cuando esos comandos son rechazados.
- **Uplinks descartados:** `show vlan 401` incluye `xgei_1/3/2`, el mismo uplink que usa la 350. El etiquetado de uplink no era el problema aquí.

### P8.6 La única ONU que informó en la vida lo hizo con una WAN puesta a mano, no por OMCI — CONFIRMA P8.3
Forense sobre el lab local (`isp-control-lab-mongo`, volumen `isp-control_lab_mongo_data`), que es el entorno donde “antes funcionaba” con túnel inverso.

- **Un solo device en toda la historia del ACS del lab:** `00259E-HG8245W5-48575443314E23A3` (Huawei HG8245W5, `HWTC314E23A3`, FW `V5R019C10S170`). Alta 2026-07-24 11:32, último Inform 11:43. Once minutos de vida y nunca volvió.
- **Por dónde llegó al ACS:** una **única WAN enrutada `1_INTERNET_R_VID_500`** — VLAN **500, la de servicio**, no una VLAN de gestión:
  - `AddressingType = DHCP` → `ExternalIPAddress = 10.20.10.205`, `DefaultGateway = 10.20.10.1`, `DNSServers = 10.20.10.1,8.8.8.8`, `NATEnabled = true`, `ConnectionStatus = Connected`.
  - Esa IP sale del **propio 4011**: servidor `dhcp1` sobre `vlan500_quilicura_dhcp` con pool `dhcp_pool0 = 10.20.10.2-10.20.10.254`.
  - No hay segunda WAN, ni WAN de gestión, ni IP estática. El camino de gestión y el de cliente eran **el mismo**.
- **Quién creó esa WAN:** el `DeviceLog` de la propia ONU lo deja por escrito. A los 2-3 minutos de arrancar, alguien entra por la web como `telecomadmin` y la crea a mano:
  - `00:02:32 Terminal:WEB(192.168.100.66) Type:Login Username:telecomadmin`
  - `00:03:12 Terminal:WEB(192.168.100.66) Type:Set WANDevice.WANConnectionDevice.WANIPConnection:1.1.1 Enable:1 X_HW_IPv4Enable:1 …`
  - y **después** de eso: `Terminal:ACS(10.69.70.2) Result:Success Type:Authorization`.
- **El panel sí encoló trabajo TR-069, pero llegó tarde:** 12 tasks (`refreshObject` / `setParameterValues`) siguen *pendientes* desde el 24-jul contra ese device. Se pusieron en cola y la ONU nunca volvió a informar para recogerlas. `presets`, `provisions` y `files` están a 0.
- **Conclusión:** el aprovisionamiento automático **nunca ha empujado una red de gestión utilizable a una ONU**. El único Inform de la historia del proyecto lo produjo una WAN creada a mano por la web de la ONU, sobre la VLAN de servicio y con DHCP. Coincide con lo que se ve en producción (P8.3): las ONUs que cursan tráfico son las de SmartOLT en 350/500, y ninguna de las ~12 del panel.
- **Agravante en el 4011 de hoy:** `vlan_401` (`30.30.20.1/24`, la de gestión del panel) **no tiene servidor DHCP**. Los únicos son `dhcp1`/`dhcp2` sobre `vlan500_quilicura_dhcp` y `vlan501_san_jose_dhcp`. La gestión depende al 100 % de la IP estática por OMCI, que es justo lo que P8.3 demuestra que no se aplica. Cero leases en `30.30.20.0/24` y `40.40.20.0/24`.
- **Acción:** replicar el modelo que sí funcionó — gestión sobre la VLAN de servicio con DHCP — o, si se mantiene la VLAN de gestión dedicada, levantar DHCP en `vlan_401` **y** arreglar la plantilla OMCI de P8.3. Hoy no se sostiene ninguna de las dos.

### P8.7 Plantilla de gestión: qué se probó en la ONU de test y qué rechaza la OLT
Intento de replicar en `gpon-onu_1/2/4:12` la forma de SmartOLT. Se aplicó y se revirtió; la ONU está de nuevo en su estado literal previo.

- **La comparación en la propia OLT es concluyente.** 26 ONUs tienen `ip-host`, y se parten en dos grupos exactos:
  - **13 de SmartOLT:** `ip-host 1 ip …`, `switchport-bind switch_0/1 iphost 1` *y* `veip 1`, `vlan-filter-mode iphost 1 …`, `vlan-filter iphost 1 pri 0 vlan 350`, con la VLAN de gestión metida en el mismo `flow 1` del `gemport 1` que el servicio. **Ninguna tiene `tr069-mgmt`**: la gestión se hace sobre la IP del ip-host.
  - **13 del panel:** `ip-host 2 ip …` pero `vlan-filter iphost 1 pri 0 vlan 80` y `tr069-mgmt 1 tag pri 2 vlan 401`. **El índice no cuadra**: `tr069-mgmt 1` y el vlan-filter miran al ip-host 1, y la IP está en el 2, así que el agente TR-069 se queda sin dirección de origen. Además el filtro etiqueta en la VLAN 80, no en la 401.
- **Origen en el código:** `zte-olt.client.ts` `applyOnuTr069Mgmt` prueba `ip-host 2` **primero** y corta al primer acierto, con el comentario “VEIP TR069 usually binds ip-host 2”. La OLT dice lo contrario. El filtro se aplica sobre `veip`, no sobre `iphost`, y nunca se manda `switchport-bind switch_0/1 iphost 1`.
- **Lo que la OLT rechaza (HG6244C):** no admite un segundo flow. `flow mode 2`, `flow 2 pri 0 vlan 401` y `gemport 2 flow 2` devuelven `%Code 63953-GPONRM : Flow does not exist`. Por eso el `gemport 2` de gestión que crea el panel nunca puede cursar nada: **el diseño de dos gemports no es viable en este modelo**, hay que ir a un solo flow como SmartOLT.
- **Tampoco valen algunos `no`:** `no switchport-bind switch_0/1 iphost 1` y `no switchport-bind switch_0/1` se rechazan; el binding se corrige reescribiendo `switchport-bind switch_0/1 veip 1`.
- **Resultado de la prueba:** con `ip-host 1` bien puesto y la 401 dentro del `flow 1`, la ONU **siguió sin emitir** (0 MACs en la 401, ping a `30.30.20.13` al 100 % de pérdida, ACS sin devices). Falta entender qué hace SmartOLT que nosotros no.
- **Siguiente paso:** capturar a SmartOLT en vivo (P8.8).

### P8.8 Montaje temporal para capturar a SmartOLT — DESMONTAR AL TERMINAR
Para ver la receta real se intercala un proxy telnet entre SmartOLT y la OLT.

- `vpn.local/olt-telnet-tap.ts` escucha en el 2323 del PC de trabajo, reenvía a `10.181.2.3:23` y registra la sesión en `vpn.local/tap/` (transcripción y `commands.txt`). Enmascara las credenciales: lo que se responde a un prompt de usuario o contraseña no se guarda.
- `vpn.local/watch-onu-config.ts` vigila en paralelo el running-config de la ONU y muestra solo las altas y bajas de líneas. Sirve aunque SmartOLT entre por SSH.
- **Reglas temporales en Core BGP** (`vpn.local/apply-tap-nat.ts`, marcadas con el comentario `isp-control TAP OLT temporal`):
  - `dstnat tcp 45.191.101.177:23334 → 10.69.1.3:2323`
  - `srcnat masquerade` hacia `10.69.1.3:2323` — sin esto el PC contestaría por su salida a internet y la sesión no se establece.
  - El `23333 → 10.181.2.3:23` de siempre **no se toca** y queda como respaldo.
- **Deshacer:** `npx tsx vpn.local/apply-tap-nat.ts --undo`. No dejar estas reglas puestas en el router de borde más allá de la prueba.

### P8.9 CWMP/NBI/FS de SmartOLT en rojo: al túnel le faltan las rutas de vuelta
El túnel `SmartOLT-VPN` (OpenVPN a `raio.smartolt.com:19649`, usuario `tunnel1@`) está arriba en el 4011 y tiene IP `10.69.69.2/24`. El servidor de SmartOLT es el `10.69.69.1`.

- **Los servicios de SmartOLT están perfectamente vivos.** Desde la IP del túnel responden los tres: CWMP `7547`, NBI `7557` y FS `7567`, y el ping al `10.69.69.1` va al 0 % de pérdida. El problema no está en su lado.
- **Solo funciona la IP del túnel.** Con origen en cualquier red nuestra el ping al `10.69.69.1` se pierde al 100 %: `172.10.220.2`, `30.30.20.1` (gestión de ONUs), `40.40.20.1` y `20.20.10.3`. La regla `srcnat accept out=SmartOLT-VPN` está bien puesta y por delante del masquerade, así que el tráfico sale sin traducir con su IP de origen real — y SmartOLT no sabe devolverlo.
- **Causa:** en el alta del túnel no se declararon las *private connected subnets*. El manual lo pide en el paso 1 ("fill in with your private connected subnets"), y sin eso SmartOLT solo enruta la IP del extremo.
- **Falta además ruta en el borde.** Core BGP no tiene ninguna entrada para `10.69.69.0/24`, así que tampoco alcanza el `10.69.69.1`. Hace falta `10.69.69.0/24 via 172.10.220.2` para que SmartOLT pueda hablar con la IP privada de la OLT y ahorrarse el port-forward `23333`.
- **Encaja con P8.6/P8.7.** El manual condiciona el Inform a poder hacer ping a la IP de gestión de la ONT desde el MikroTik (paso 7), que es exactamente lo que nunca hemos conseguido (`30.30.20.13` al 100 % de pérdida). Y el paso 8 confirma el modelo que queremos: gestión primero y luego elegir OMCI o TR-069 para la WAN.
- **Acción:** declarar en SmartOLT `30.30.20.0/24`, `10.181.2.0/24` y `40.40.20.0/24`, y añadir la ruta en Core BGP.
- **Hecho:** ruta `10.69.69.0/24 via 172.10.220.2` añadida en Core BGP (`vpn.local/apply-smartolt-route.ts`).

### P8.10 Captura de SmartOLT: el comando que nos faltaba es `flow N switch switch_0/1`
Capturado en vivo con el tap de P8.8 mientras SmartOLT aprovisionaba `gpon-onu_1/2/4:12` (SN `FHTT967F69A0`). Receta literal en `vpn.local/tap/*.commands.txt`.

**Lo que hace SmartOLT** (tres sesiones telnet: alta, gestión, TR-069):

```
interface gpon-olt_1/2/4
 onu 12 type HG6244C sn FHTT967F69A0
interface gpon-onu_1/2/4:12
 tcont 1 profile SMARTOLT-1000MB-UP / gemport 1 tcont 1
 service-port 1 vport 1 user-vlan 80 vlan 80
pon-onu-mng gpon-onu_1/2/4:12
 flow 1 switch switch_0/1          <-- CREA el flow
 gemport 1 flow 1
 flow mode 1 tag-filter vlan-filter untag-filter discard
 flow 1 pri 0 vlan 80
 switchport-bind switch_0/1 veip 1
 switchport-bind switch_0/1 iphost 1
 vlan-filter-mode iphost 1 … / vlan-filter iphost 1 pri 0 vlan 80
--- luego, gestión sobre VLAN 600 ---
interface …: switchport mode hybrid vport 2 / no service-port 2
             service-port 2 vport 2 user-vlan 600 vlan 600
pon-onu-mng …:
 no switchport-bind iphost 2 / no ip-host 2 / no voip-ip / no flow 2   (limpieza)
 flow 2 switch switch_0/1          <-- CREA el flow
 flow mode 2 tag-filter vlan-filter untag-filter discard
 flow 2 pri 2 vlan 600
 gemport 2 flow 2
 switchport-bind switch_0/1 iphost 2
 ip-host 2 ip 10.50.10.239 mask 255.255.255.0 gateway 10.50.10.1
 ip-host 2 primary-dns 8.8.8.8 second-dns 8.8.4.4
 vlan-filter-mode iphost 2 … / vlan-filter iphost 2 pri 2 vlan 600
--- y por último TR-069 ---
 veip 1 port udp 1232 host 2
 tr069-mgmt 1 acs http://10.69.69.1:14501 validate basic username … password …
 tr069-mgmt 1 tag pri 2 vlan 600 state unlock
```

**Diferencias contra `applyOnuTr069Mgmt`, por orden de gravedad:**
1. **Falta `flow N switch switch_0/1`.** Es lo que crea el flow y lo ata al switch interno. Sin él, `flow N pri…` y `gemport N flow N` devuelven `%Code 63953 : Flow does not exist`. Esto invalida la conclusión de P8.7 de que el modelo no admite dos flows: **sí los admite**, solo hay que crearlos.
2. **Los índices tienen que ser el mismo en todo el bloque.** SmartOLT usa el 2 de punta a punta: `ip-host 2`, `switchport-bind switch_0/1 iphost 2`, `vlan-filter-mode iphost 2`, `vlan-filter iphost 2`. Nosotros ponemos la IP en el 2 y los filtros en el 1, y encima filtramos sobre `veip` en vez de sobre `iphost`.
3. **Falta `switchport-bind switch_0/1 iphost N`**: solo atamos el veip, así que el ip-host no tiene salida.
4. **Falta `veip 1 port udp 1232 host N`**, que es por donde el ACS hace el Connection Request.
5. **Falta `switchport mode hybrid vport N`** antes del service-port.
6. Falta la limpieza idempotente previa (`no flow N`, `no ip-host N`, …) que hace SmartOLT antes de escribir.
7. `pri 2` y el `state unlock` en la misma línea del `tag` son detalles menores, pero conviene copiarlos.

**Corregido en** `apps/api/src/topology/zte-onu-mgmt-omci.util.ts`, una utilidad pura que construye la secuencia y marca qué comandos son críticos; `zte-olt.client.ts` la ejecuta. Cubierto por `zte-onu-mgmt-omci.util.spec.ts`, que fija el orden del `flow … switch` y la coherencia de índices. Además `applyOnuTr069Mgmt` ya **no devuelve éxito** si la OLT rechazó algún comando crítico: antes decía "TR069 aplicado" y el fallo solo se veía horas después como una ONU "esperando informe".

**Resultado en la OLT:** por primera vez una ONU aprovisionada por OMCI **cursa tráfico de gestión**. `show mac vlan 600` aprende `9055.de7f.69a4` en `gpon-onu_1/2/4:12 vport 2`, y el 4011 tiene el ARP completo de `10.50.10.239`. El camino L2 funciona de extremo a extremo.

### P8.12 Prueba del código corregido: la red funciona, el agente TR-069 de la ONU no arranca
Reaprovisionada `gpon-onu_1/2/4:12` (SN `FHTT967F69A0`) desde cero con el código ya corregido (`vpn.local/test-panel-provision.ts`), sobre nuestra VLAN 401, IP `30.30.20.30/24`, gateway `30.30.20.1`, ACS `http://10.69.1.1:14501`.

**Lo que sí funciona ahora** (y antes no):
- La OLT aceptó **todos** los comandos críticos, incluido `flow 2 switch switch_0/1`. Los únicos rechazos fueron los `no …` de limpieza sobre una ONU nueva, que es lo esperado.
- La OLT aprende la MAC de gestión `9055.de7f.69a4` en la VLAN 401, vport 2.
- El MikroTik la resuelve por ARP y responde a `ping 30.30.20.30`.
- La ONU **enruta**: contesta a pings originados en otras subredes (`20.20.10.3`, `10.181.1.1`, `10.0.24x.1`), así que su pila IP y su ruta por defecto están bien.
- El ACS es alcanzable desde la red de gestión: `10.69.1.1:14501` responde.
- La configuración OMCI leída de vuelta coincide con la receta de SmartOLT.

**Lo que sigue sin funcionar:** la ONU no emite ni un paquete por iniciativa propia (0 paquetes en 30 s en `vlan_401`, ninguna sesión en la tabla de conexiones). Solo contesta a lo que se le pregunta. Dos reinicios (`Online Duration` confirma que se reiniciaron de verdad) no cambian nada.

**Única divergencia concreta que queda contra la ejecución de SmartOLT:** `security-mgmt 999 state enable ingress-type lan protocol ftp telnet ssh snmp tr069`, que declara tr069 entre los protocolos de gestión permitidos. SmartOLT lo aplicó sin problema; a nosotros la ONU nos lo rechaza con `%Code 63990-GPONRM : ONT return error:command processing error` en las tres variantes probadas (con y sin `mode forward`, `ingress-type lan` y `wan`).

**Hipótesis a probar:** SmartOLT lo manda en la **primera** sesión, justo después del alta y antes del resto de la configuración. Puede que la ONU solo acepte `security-mgmt` en esa ventana inicial de aprovisionamiento. Si se confirma, el panel tendría que aplicarlo dentro de `authorizeOnu`, no después.

### P8.13 Segunda captura de SmartOLT (aprovisionamiento exitoso): la receta es idéntica y el `security-mgmt` TAMBIÉN le falla
Se reconstruyó el tap desde cero (puerto 23334, ONU borrada) y se capturó un aprovisionamiento completo de SmartOLT que **sí levantó**. Receta en `vpn.local/tap/` (la anterior quedó en `tap/archive/`). Hallazgos que **invalidan las dos sospechas de P8.12**:

1. **`security-mgmt 999` NO es la causa.** En esta captura exitosa la OLT le responde a SmartOLT el mismo `%Code 63990-GPONRM : ONT return error:command processing error` en `security-mgmt 999`, y la ONU informa igual. Es una pista falsa.
2. **`Config state: fail` NO es la causa.** La ONU de SmartOLT queda en `Config state: fail` (por el objeto OMCI 65305, que es justo `security-mgmt`) y aun así informa. También descartado.
3. **`Validation scheme: lock` es normal.** Aparece igual en la ONU de SmartOLT que informa; no es un bloqueo.
4. **La receta es byte a byte idéntica** a la que ya replicamos con `test-panel-provision.ts` / `replay-smartolt-recipe.ts`. Los únicos errores (`Record already exists`, `UNI does not exist`, `Flow does not exist` en los `no …`, `security-mgmt`) son idénticos en ambos.

### P8.14 Causa raíz del retorno del ACS y migración del túnel al 4011
Con el túnel `Router1` sano (tras un `HUP`, ver más abajo) el concentrador **ya instalaba** el `iroute` de `30.30.20.0/24`, pero apuntando al cliente `Router1` = `10.69.1.2`, que vivía en **Core BGP**. La VLAN 401 (`30.30.20.0/24`) está conectada en el **4011**, no en Core BGP, así que el ACS nunca podía devolverle tráfico a la ONU: el `iroute` de la red de gestión estaba en el router equivocado.

**Migración hecha (scripts en `vpn.local/`, todos reversibles):**
- `apply-router1-4011.ts`: recrea el cliente OVPN `Router1` en el 4011 (Core Clientes) — interfaz, ruta al ACS/peer `10.69.1.1`, redes del túnel, `no-masquerade` en el túnel y forward/input + MSS. Misma credencial (leída de la BD, nunca impresa). Modos `--enable/--disable/--undo/--status`.
- `apply-corebgp-backup.ts`: ruta de respaldo en Core BGP a `10.69.1.0/24` y `10.69.1.1/32` vía el 4011 (`172.10.220.2`, distancia 5) para que Core BGP no pierda el ACS al apagar su túnel.
- `toggle-corebgp-router1.ts --disable`: apaga el cliente OVPN de Core BGP (recuperación con `--enable`).
- `apply-4011-transit.ts`: rutas de tránsito en el 4011 hacia redes que cuelgan detrás de Core BGP (OLT `10.181.2.0/24`, switch `20.20.10.0/24`) vía `172.10.220.1`, porque ahora el 4011 las publica por el túnel pero no las tiene conectadas.

**Estado final verificado:** el 4011 es el `Router1` del túnel (running=true); Core BGP con su cliente deshabilitado pero alcanzando el ACS por la ruta de respaldo; el concentrador alcanza 4011, Core BGP y la OLT (`10.181.2.3`). El retorno ACS→VLAN 401 ahora es directo al 4011. Verificado: el concentrador hace ping a `30.30.20.1` con 0% de pérdida incluso con origen `10.69.1.1`.

**RESULTADO — Inform confirmado.** Tras reaprovisionar la ONU `FHTT967F69A0` con el código del panel (`vpn.local/test-panel-provision.ts --apply`) hacia `http://10.69.1.1:14501` por VLAN 401, GenieACS registró el device `000AC2-HG6244C-46485454967F69A0` (el `46485454` = `FHTT` en hex) con `_lastInform` fresco y `faults=0`. La ONU aparece conectada en el panel. **El auto-aprovisionamiento por TR-069 contra nuestro ACS funciona.** Nota: el comando `ip-host N ping-response/traceroute-response` lo rechaza este modelo (`%Error 20201`), por eso la IP de gestión no responde a ping — es cosmético y no afecta al Inform; conviene omitirlo o hacerlo tolerante en el cliente ZTE.

**Incidente durante el trabajo (recuperado):** el túnel `Router1` (TCP, único camino al 4011/OLT) reconectó a un estado zombie (en `CLIENT_LIST` pero sin `ROUTING_TABLE`/iroute), probablemente por saturación al hacer un `/ip/route/print` completo del 4011 (tabla enorme). Todo lo que colgaba detrás de Core BGP quedó inalcanzable. Se recuperó con un `HUP` al `openvpn-tcp` del concentrador (`vpn.local/free-onu-index.ts`), que es la misma señal del sync. Lección: nunca hacer prints completos de rutas en estos routers; filtrar del lado del router por `dst-address` (la API **no** soporta `?comment~`, que es solo del CLI).

**Nota de bookkeeping:** los cambios de los routers se hicieron en vivo por API; la BD del panel aún asocia el cliente `Router1` al device de Core BGP. El concentrador autentica por username (sin cambio), así que funciona; conviene re-asociar el cliente al 4011 en el panel más adelante.

**Conclusión: el código OMCI del panel ya es correcto.** La diferencia entre la ONU que informa y nuestra réplica que no era **solo el destino**:

| | SmartOLT (informa) | Nuestra réplica (no informó) |
|---|---|---|
| ACS | `http://10.69.69.1:14501` | `http://10.69.1.1:14501` |
| VLAN gestión | 600 | 401 |
| IP gestión | 10.50.10.239 | 30.30.20.30 |
| credenciales | `soltcpe` / real | `acs` / `acs` |

Nuestra réplica tenía IP, respondía al ping y enrutaba a otras subredes, pero emitió **0 paquetes**: el cliente TR-069 nunca marcó. El siguiente paso es aislar por qué el camino VLAN 401 → `10.69.1.1` (nuestro GenieACS) no dispara el Inform, mientras VLAN 600 → `10.69.69.1` (SmartOLT) sí. Sospechas ordenadas: (a) el 4011 hace ping a `10.69.1.1` desde sí mismo pero quizá no **reenvía** tráfico de la VLAN 401 hacia `10.69.1.0/24`; (b) el túnel a `10.69.1.1` lo levanta esta máquina, no el 4011, así que la ruta de retorno puede faltar; (c) credenciales/relleno del perfil ACS del panel.

### P8.11 Por qué tampoco informa con SmartOLT: la IP de gestión del MikroTik es /32
- En el 4011, `vlan3` (VLAN 600, sobre `sfp-sfpplus1`, comentario "Vlan tr069 smartolt") tiene **`10.50.10.1/32`** con `network 10.50.10.1`.
- Con /32 no hay subred conectada: la única ruta 10.50.x es `10.50.10.1/32 via vlan3`. **No existe ruta para `10.50.10.0/24`**, así que el router no sabe devolver nada a `10.50.10.239` y esos paquetes se van por la default.
- El ARP sí está resuelto (`10.50.10.239 → 90:55:DE:7F:69:A4, completa=true`), o sea que el problema es puramente de enrutado, no de L2.
- **Arreglo aplicado:** dirección cambiada a `10.50.10.1/24` (`vpn.local/apply-mgmt-netmask.ts`, con `--undo`). Aparece la ruta conectada `10.50.10.0/24 via vlan3`.
- **Resultado inmediato:** `ping 10.50.10.239` desde el 4011 pasa de 100 % de pérdida a 0 %. Es la condición que el manual de SmartOLT marca en el paso 7 para que la ONT empiece a informar.
- **No hacía falta declarar nada en el túnel para esta red:** con origen `10.50.10.1` el ACS `10.69.69.1` responde al ping y el puerto CWMP 14501 contesta, así que SmartOLT ya enrutaba `10.50.10.0/24` de vuelta (es su propio pool de gestión). Lo de P8.9 sigue aplicando a *nuestras* redes (`30.30.20.0/24`, `40.40.20.0/24`, `10.181.2.0/24`), que siguen sin ruta de retorno.
- **TR-069 vivo y bidireccional.** En la tabla de conexiones del 4011 aparecen sesiones TCP completadas en ambos sentidos: `10.50.10.239 → 10.69.69.1` (el Inform de la ONU) y `10.69.69.1 → 10.50.10.239` (el Connection Request del ACS). Primera vez en todo el diagnóstico que una ONU habla con un ACS.

---

## Checklist de resolución (vacío — marcar al ir cerrando)

| ID | Estado | Notas |
|----|--------|-------|
| P5.1 | resuelto | probe MikroTik colgado / device resucitado |
| P5.2 | resuelto | OpenVPN UDP con pool propio (cierra P1.14) |
| P5.3 | pendiente | WG private key en concentrador |
| P5.4 | pendiente | sync 30 s sin feedback |
| P5.5 | resuelto | saveDeviceIfPresent en escrituras lentas |
| P6.1 | resuelto | verify VLAN en OLT (regresión multi-vendor) |
| P6.2 | pendiente | aislamiento VLAN ZTE: comandos a ciegas |
| P6.3 | resuelto | delete VLAN silencioso + caché que la revivía |
| P6.4 | parcial | auditoría CLI ZTE: 10 arreglados; enable-password, PON light y óptica de uplinks pendientes |
| P8.1 | resuelto y verificado | DNAT CWMP a loopback tragaba todos los Inform |
| P8.2 | descartado | camino L3 gestión→ACS correcto (masquerade del 4011) |
| P8.3 | pendiente | plantilla OMCI: gemport de gestión sin flow y `ip-host 2` sin vlan-filter |
| P8.4 | informativo | el ACS de producción nunca recibió un Inform (Mongo sin `devices`) |
| P8.5 | verificado | VLAN gestión → CWMP abierto (TIME_WAIT desde 172.10.220.2) |
| P8.6 | pendiente | el único Inform de la historia salió de una WAN puesta a mano en VLAN 500 con DHCP; `vlan_401` no tiene DHCP |
| P8.7 | pendiente | el panel usa `ip-host 2` con filtros al índice 1; el modelo no admite un segundo flow |
| P8.8 | temporal | tap telnet + 2 reglas NAT en Core BGP para capturar a SmartOLT — DESMONTAR |
| P8.9 | parcial | ruta en Core BGP añadida; falta declarar nuestras subredes en el túnel de SmartOLT |
| P8.10 | corregido en código | `applyOnuTr069Mgmt` reescrito con la secuencia capturada; falta probarlo contra una ONU real |
| P8.11 | resuelto | `10.50.10.1/32` → `/24` en vlan3: la ONU responde y hay Inform bidireccional con el ACS |
| P8.12 | revisado | descartadas las sospechas de `security-mgmt`/`config-fail`; ver P8.13 |
| P8.13 | revisado | receta OMCI del panel confirmada correcta; el corte estaba en el retorno del ACS hacia VLAN 401; ver P8.14 |
| P8.14 | hecho | causa raíz del retorno + migración del túnel Router1 de Core BGP al 4011 |
| P7.1 | pendiente | SwitchOS write (API no oficial; solo lectura ahora) |
| P7.3 | resuelto | push VLAN de catálogo a switch RouterOS con puertos tagged/untagged |
| P0.1 | pendiente | TLS MikroTik |
| P0.2 | pendiente | SSH host-key |
| P0.3 | pendiente | SNMP RW unused |
| P0.4 | pendiente | api_plain |
| P0.5 | pendiente | GenieACS full dump / HTTP |
| P0.6 | pendiente | IP pool /8 OOM |
| P0.7 | pendiente | VPN rutas RFC1918 |
| P0.8 | pendiente | mikrotik/command arbitrario |
| P0.9 | pendiente | VPN token schema scan |
| P0.10 | pendiente | MP webhook firma/monto |
| P1.1–P1.19 | pendiente | ver secciones |
| P1.20 | pendiente | periodos suspended vs generate |
| P1.21 | pendiente | overdue → suspend red |
| P2.* | pendiente | ver tablas |
| P3.* | pendiente | |
| P4.* | backlog | |
