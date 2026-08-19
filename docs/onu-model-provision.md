# Scripts de aprovisionamiento por modelo de ONU

> **Ubicación:** `apps/api/src/drivers/onu/models/<id>/` (genéricos incluidos).  
> Primitivas: `drivers/onu/infra/`.  
> Orquestación: `topology/onus/` (elige drivers + probes de red; no escribe hojas ACS de vendor).

## Capas

| Capa | Por | Responsabilidad |
|------|-----|-----------------|
| `drivers/olt/{huawei,zte/…}` | **tipo OLT** | authorize, OMCI mgmt/ACS, SNMP, inventarios |
| `drivers/onu/models/<modelo>` | **modelo ONU** | provision + verifyHeal ACS (autocontenido) |
| `drivers/onu/models/generic-*` | fallback | mismo contrato; SPV sobre WAN existente; ZTE route heal |
| `drivers/onu/infra/*` | primitivas | creds, SN→vendor, datamodel TR-098/181 (sin WAN de vendor) |
| `topology/onus/*` | orquestación | elige driver; ARP/uplink/tráfico; veredicto ok/fail |

## Contrato `OnuDriver`

```
omciPlan.serviceWanOmci  → 'skip' | 'apply' (CLI OMCI lo ejecuta el OLT)
skipOmciServiceWan       → @deprecated; se deriva de omciPlan
verifyChecks             → arp/wan/… required|optional|skip (criterio de OK)
ownsWanSelection         → provision exclusivo (no SPV genérico)
provision / provisionPipeline / ensureServiceWan
diagnoseGaps?(device)    → gaps para verify (el modelo decide)
verifyHeal(gaps)         → un paso ACS por tick
resolveServiceWan        → qué WAN mira verify/SPV
applyServiceSpv          → empujar hojas (generic)
supportsTr181RouteHeal   → heal SmartOLT (solo generic-zte hoy)
```

Admin wifi/LAN/IPTV: aún en `OnuTr069ConfigService`; se pelea a
`models/<modelo>/` cuando un modelo lo necesite (p. ej. IPTV en fiberhome).

## Cómo se elige el driver

```
resolveOnuDriver(sn, onuType, acsModel)
  1. models/<modelo> específico (HG8145X6, HG6143D, HGU-VEIP, …)
  2. models/generic-<marca>   # HWTC→huawei, ZTEG→zte, FHTT→fiberhome
```

## Apply

- `omciPlan.serviceWanOmci === 'skip'` → OMCI wan-ip omitido → `driver.provisionPipeline` / ACS
- `'apply'` → OMCI ×2; si falla → modo manual (ZTE clásico intacto)

## Verify / heal

- Poller corre solo los probes que el modelo no marca `skip`
- Veredicto usa `verifyChecks` del driver (p. ej. TR-098 → `route: skip`)
- Route heal solo si `supportsTr181RouteHeal` + WAN TR-181
- Si el driver expone `verifyHeal`, el poller **no** pre-cura credenciales globales
- Monitoreo periódico (métricas) es independiente: arranca cuando verify → ok

## HG/EG8145X6 — pasos atómicos

Provision y verify están **separados**. Cada paso = como máximo una mutación
ACS (SPV / AddObject / refresh / preload-sin-CR). **No** se usa
`refreshObject(ManagementServer)` en bootstrap: en campo provoca
`session_terminated` y deja la cola llena.

| Paso | Provision (serie) | Verify heal (1/tick) |
|------|-------------------|----------------------|
| `ensure_connreq` | SPV user/pass; si sin hojas MS → preload SPV-only + reboot | si `connreqOurs=false` |
| `ensure_inform` | Inform **120 s** (solo este modelo) | si `informOk=false` |
| `ensure_reachable` | Probe CR on-demand | si no hay CR |
| `ensure_mgmt_ready` | Refresh WAN TR069; confirmar Connected | si mgmt no lista |
| `ensure_service_wcd` | AddObject WCD nuevo | si falta INTERNET y no hay hueco |
| `ensure_service_wanip` | AddObject WANIP bajo WCD vacío | si WCD vacío sin WANIP |
| `ensure_service_spv` | SPV INTERNET (IP/VLAN/DNS/NAT/LANBIND) | si WAN mal / blank |

Archivos: `models/huawei-hg8145x6/{steps,provision,verify,wan}.ts`.

Regla de oro: **nunca** encolar WCD+SPV junto al preload del reboot. Tras el
Inform post-reboot, provision/verify retoman desde el siguiente paso.

## Modelos en producción

| id | Cuándo |
|----|--------|
| `huawei-hg8145x6` | HG/EG8145X6 |
| `huawei-hgu-veip` | Resto HGU Huawei VEIP |
| `fiberhome-hg6143d` | FiberHome HG6143D (FHTT…; OLT a veces dice F600) |
| `generic-huawei` / `generic-zte` / … | Modelos sin carpeta específica |

## Añadir un modelo nuevo

1. Diagnosticar en campo.
2. `drivers/onu/models/<id>/` con `index.ts` (`OnuDriver`), `provision.ts`, `verify.ts`.
3. Registrar en `ONU_MODEL_DRIVERS` **antes** de los genéricos de marca.
4. Tests `matches` + flags (`skipOmci`, `resolveServiceWan`, `diagnoseGaps`).
5. **No** parchear `generic-<marca>` para quirks de un modelo concreto.
6. Si el modelo satura la cola ACS, preferir pasos atómicos + `verifyHeal`
   (patrón HG8145X6) en lugar de un `provision` monolítico.

Ver también [`drivers-migration.md`](./drivers-migration.md).
