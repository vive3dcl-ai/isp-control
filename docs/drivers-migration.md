# Plan de migración: drivers OLT + biblioteca ONU

Principio rector: **comportamiento idéntico en cada fase**; la separación es
estructural. Solo al final se permite mejorar plantillas. Si algo duda, se deja
como estaba y se marca follow-up.

### Estado (agosto 2026)

| Hito | Estado |
|------|--------|
| **Fase 1** — `drivers/olt` types + registry | **Hecho** |
| Layout `topology/{olts,onus,routers,shared}` | **Hecho** |
| **Fase 2** — silo Huawei `drivers/olt/huawei/` | **Hecho** |
| **Fase 3a** — inventario dialecto C3xx vs Titan | **Hecho** (abajo) |
| **Fase 3b–3c** — silos `zte-titan` + `zte-c3xx` (pin familia; monolito = re-export) | **Hecho** |
| **Fase 4–5** — `drivers/onu` registry + generic por marca + library Huawei | **Hecho** |
| Fase 6 — modelos ONU uno a uno con evidencia | Pendiente |

Código vivo:

- `apps/api/src/drivers/olt/{huawei,zte/c3xx,zte/titan}/` + `zte/shared/`
- `apps/api/src/drivers/onu/{library,generic,registry.ts}`
- Parsers ZTE aún en `topology/olts/zte-olt-*.util` (compartidos; Fase 7 cleanup)
- Re-export: ~~`topology/onus/onu-model-provision/`~~ eliminado — importar `drivers/onu`

---

## Objetivos y no-objetivos

### Sí

- 3 silos OLT: `zte-c3xx`, `zte-titan`, `huawei` (CLI + SNMP + OMCI propios, sin
  `if` cruzados entre ramas).
- Biblioteca ONU: un directorio por modelo conocido + `generic` como fallback.
- Orquestación delgada: `resolve*Driver` → contrato; cero comandos de negocio
  nuevos en `topology` / `onu-connected` / `onu-tr069-config`.
- Un quirk de modelo = un driver; no un `if` en el servicio gordo.

### No (en esta migración)

- No añadir vendors nuevos de OLT (p. ej. FiberHome OLT).
- No “arreglar” quirks de modelos salvo regresiones introducidas por el move.
- No tocar routers / MikroTik (fase posterior explícita).
- No reescribir GenieACS ni el wizard de UI.

### Definición de “listo”

- Misma flota: authorize, Resync, Check, verify/heal, SNMP poll, TR-069 → mismos
  resultados.
- Cambiar un archivo Titan no requiere tocar C3xx ni Huawei.
- ONU desconocida → `generic`; ONU en library → solo ese árbol de archivos.
- Onboarding de modelo nuevo = **una carpeta + registro**, sin tocar genérico.

---

## Motivación (qué hay hoy)

| Eje | Cómo se elige | Problema |
|-----|---------------|----------|
| OLT ZTE C3xx / Titan | `detectZteFwFamily` dentro del **mismo** `zte-olt.client.ts` | Un cambio de dialecto puede romper la otra rama |
| OLT Huawei | Cliente aparte, cast `as unknown as ZteOltClient` | Sin interfaz común (P1.1) |
| ONU CPE | Genérico TR-069 + handlers solo Huawei HGU | OMCI / verify / IPTV siguen en servicios gordos |

Las tres grandes ramas OLT que queremos aislar:

| Rama | Subtypes / detección | Hoy |
|------|----------------------|-----|
| **ZTE C3xx** | `zte_c2*`, `zte_c3*`, `zte_c3xx` | Mezclado con Titan |
| **Titan (C6xx)** | `zte_c6*`, firmware Titan | Mezclado con C3xx |
| **Huawei** | `huawei_*` | Cliente propio, tipado ZTE |

ONUs: muchas más. Patrón deseado = **library exacta si el modelo existe**, si no
**generic**.

---

## Arquitectura objetivo

```
apps/api/src/drivers/
  olt/
    types.ts / registry.ts / dto.ts
    _shared/transport/       # SSH host-key, SNMP health (cross-vendor)
    huawei/                  # driver Huawei OLT (CLI+SNMP+utils)
    zte/
      c3xx/                  # silo C3xx
      titan/                 # silo Titan/C6xx
      shared/                # parsers ZTE
  onu/
    types.ts / registry.ts   # library first, else generic
    generic/                 # fallback por marca
    library/                 # modelos exactos (hg8145x6, hgu-veip, …)
    shared/                  # ACS puro: WAN datamodel, connreq, IPTV bridge

apps/api/src/topology/       # orquestación + dominio (NO vendor drivers)
  olts/                      # constants, inventory poll, service-vlan
                             # (+ stubs re-export → drivers/olt/*)
  onus/                      # connected, tr069, verify, catalog
  routers/                   # mikrotik, ip-pool, swos/switch
  shared/                    # entities, dto, genieacs-nbi, device-persist
  topology.module.ts / topology.service.ts
```

### Cómo encajan OLT × ONU (sin global)

```
1. OltDriver  = resolveOltDriver(olt)      # zte-c3xx | zte-titan | huawei
2. OnuDriver  = resolveOnuDriver(sn, …)    # library/* | generic

authorize:     olt.authorize(profile)
mgmt ACS:      olt.applyMgmtOmci(...)
service WAN:   onu.provision({ olt, acs, wan })
                 # el script del modelo decide si pide OMCI al OLT o solo TR-069
verify:        onu.verify(...)
```

El OLT no conoce hojas `DNSServers`. La ONU no conoce si el ifName es
`gpon_olt-` o `gpon-olt_`.

### Reglas de imports (enforceables en review; luego eslint)

- `zte/c3xx/**` **no** importa `zte/titan/**` ni `huawei/**` (y viceversa).
- `models/X/**` **no** importa `models/Y/**`.
- Orquestación solo importa `drivers/*/registry` y `types`, nunca `cli.ts` de
  una rama.
- Helpers compartidos permitidos solo si son **puros** (sin vendor): p. ej.
  `vendorFromSn`, `normalizeOnuModelName`, parse IP. Opcional:
  `drivers/onu/infra/`, `drivers/olt/_transport/` (SSH/telnet sin strings de
  comando de negocio).

### Qué queda “global” a propósito

| Permitido | Prohibido |
|-----------|-----------|
| `types.ts`, registry, DTOs API/UI | Tablas SNMP / builders OMCI entre ramas OLT |
| Transport SSH/telnet sin comandos de negocio | Plantillas TR-069 entre modelos |
| Utilidades puras (`vendorFromSn`, etc.) | Helpers que por dentro hagan `if (titan)` |

---

## Fase 0 — Inventario de anclaje (antes de mover nada)

Documento vivo (puede ser sección de este archivo o checklist en el PR) con:

| Área | Qué congelar |
|------|----------------|
| OLT subtypes → rama | `zte_c2*`/`zte_c3*` → c3xx; `zte_c6*` → titan; `huawei_*` → huawei |
| Flujos críticos | authorize, uncfg, list connected, reboot/delete, uplink VLAN, service VLAN, TR069 mgmt OMCI, wan OMCI, SNMP monitor |
| ONU models inicial | `huawei-hg8145x6`, `huawei-hgu-veip` (ya existen); resto → generic |
| Suite de regresión | jest actuales + checklist manual 3 OLT × 2–3 ONU (HWTC, FHTT, ZTEG) |

**Gate A:** lista acordada + tests verdes en la rama de trabajo **antes** del
primer move.

---

## Fases de migración

Cada fase = **PR pequeño**, desplegable (API-only), reversible. Un silo por PR.
Nunca “partir ZTE + mover ONU” en el mismo deploy.

### Fase 1 — Contratos + registry sin mover lógica — **HECHO**

Riesgo: **mínimo**.

1. ~~Crear `drivers/olt/types.ts`~~ (`ManagedOltCliClient` / `ManagedOltSnmpClient`).
2. ~~`registry.ts`~~: `resolveOltDriverKind` → `zte-c3xx` | `zte-titan` |
   `huawei`; `resolveOltCli` / `resolveOltSnmp` delegan a Nest clients.
3. ~~Sustituir casts en call sites~~ (`topology.service`, `onu-connected`,
   `onu-tr069-config`, `service-vlan`, `onu-type-olt-sync`). Único cast
   Huawei→contrato: dentro del registry.
4. Titan vs C3xx: registry distingue ramas; ambos delegan al **mismo**
   `ZteOltClient` (comportamiento idéntico).

También: move mecánico de `topology/` a `{olts,onus,routers,shared}` sin
cambio de lógica.

**Gate B:** API deploy; smoke authorize + poll SNMP en C3xx, Titan y Huawei.

**Rollback:** revert commit; no hay silos OLT partidos aún.

---

### Fase 2 — Extraer Huawei OLT al silo — **HECHO**

Riesgo: **bajo**.

1. ~~Mover `huawei-*` a `drivers/olt/huawei/`~~ (+ re-exports en `topology/olts/`).
2. ~~DTOs neutrales en `drivers/olt/dto.ts`~~; transport/SSH/health en `_shared/`.
3. Nest providers desde el silo; registry `huawei` → `HuaweiOltClient`.

**Gate C:** API deploy; smoke flota Huawei.

---

### Fase 3 — Separar ZTE C3xx vs Titan — **HECHO** (pin + silos)

Riesgo: **alto**. Estrategia aplicada: **copia + pin de familia** (comportamiento
idéntico; ramas `if (c6xx)` residuales quedan como dead code por silo — cleanup
Fase 7).

#### 3a. Inventario dialecto (congelado)

| Clase | Métodos / áreas |
|-------|-----------------|
| **Estructural Titan** | `applyOnuTr069Mgmt`, `applyOnuServiceVlans`, `applyOnuEthPortVlan` (vport vs classic) |
| **ifName / authorize** | `authorizeOnu` (retry opposite si unknown), collectors uncfg/connected/PON, `parseShowCard` |
| **Idénticos** | uplink, VLAN CRUD, speed profiles, rogue; SNMP OIDs (parse dual ifName) |

Canonical DB: `gpon-olt_` / `gpon-onu_`. CLI Titan: `gpon_olt-` / `gpon_onu-`.

#### 3b–3c. Silos

- `drivers/olt/zte/titan/{cli,snmp}.ts` — `resolveFwFamily` **siempre `c6xx`**
- `drivers/olt/zte/c3xx/{cli,snmp}.ts` — **siempre `c3xx`**
- Registry: subtype/fw → silo real
- `topology/olts/zte-olt.client.ts` = re-export C3xx (deprecated stub)

**Gate D:** API deploy; smoke C3xx + Titan (uncfg/authorize/SNMP) + Huawei.

---

### Fase 4 — ONU: registry formal + generic por marca — **HECHO**

Riesgo: **medio**.

1. ~~`drivers/onu/types.ts`~~ (`OnuDriver` + brand).
2. ~~`generic/{huawei,zte,fiberhome}`~~ + `applyGenericServiceSpv` (SPV cortado de
   `applyWanStaticTr069`).
3. ~~Registry~~: library first → brand generic (`resolveOnuDriver`).
4. Orquestador: `driver.provision` / library `ensureServiceWan` / SPV genérico.

**Gate E:** deploy API; Check FH/ZTE/Huawei.

---

### Fase 5 — ONU library: mover handlers existentes — **HECHO**

1. ~~`huawei-hg8145x6` / `huawei-hgu-veip` → `drivers/onu/models/`~~
2. ~~`onu-model-provision/` = re-export~~

**Gate F:** tests + Check HG8145 / HG8245.

---

### Fase 6 — ONU: sacar del genérico solo lo demostrado

Riesgo: **controlado**, continuo.

Por cada modelo que hoy tiene `if` especial (FiberHome IPTV, F6600P TR-181,
etc.):

1. Diagnosticar / script `vpn.local` ya validado.
2. Crear `models/<id>/` con el guion completo.
3. Quitar la rama del genérico/servicio.
4. Deploy API-only.
5. No abrir el siguiente modelo hasta Gate del anterior.

**Regla:** si no hay evidencia de campo, **no** se crea driver “por si acaso”.
Generic se queda estable. Cuando un modelo falle: **no se parchea el genérico**;
se crea carpeta en library.

---

### Fase 7 — Limpieza y disciplina

Riesgo: **bajo**.

- Eliminar re-exports legacy.
- Actualizar este doc + [`onu-model-provision.md`](./onu-model-provision.md)
  (o renombrar a `drivers-onu.md`).
- Checklist PR: “¿este cambio toca más de un silo? → rechazar salvo
  types/registry”.
- (Opcional) eslint `no-restricted-imports` entre silos.
- Logs con `driver.id` (`zte-titan`, `huawei-hg8145x6`) en authorize /
  provision / heal.

---

## Cuidados operativos

| Práctica | Detalle |
|----------|---------|
| Un silo por PR | Nunca partir ZTE y mover ONU en el mismo deploy |
| API-only | No tocar web / VPN en estas fases |
| Monolito en cuarentena | Tras 3b/3c, 1–2 deploys con fallback al viejo si hace falta |
| Feature flag suave | Opcional `OLT_DRIVER_V2`; default nuevo tras Gate D |
| Observabilidad | Log `driver.id` en flujos críticos |
| No “mejoras” en move PRs | Commits de move vs commits de behavior separados |
| Flota canary | Primero OLT de prueba / valle; Titan y C3xx en días distintos |

Despliegue API (recordatorio): build/push `vive3d/isp-control-api:latest` +
`npx tsx vpn.local/deploy-api-only.ts --apply`.

---

## Orden temporal sugerido

```
Semana 1       Fase 1 (contratos) + deploy
Semana 1–2     Fase 2 (Huawei silo)
Semana 2–4     Fase 3a–3c (Titan luego C3xx)  ← buffer grande
Semana 4       Fase 4–5 (ONU generic + move library existente)
Ongoing        Fase 6 (un modelo a la vez cuando falle o se documente)
Semana N       Fase 7 cleanup
```

No hay prisa en Fase 6: el valor estructural ya está en 1–5.

---

## Siguiente paso concreto

**Fase 6:** sacar quirks demostrados (IPTV FH, F6600P legacy route, etc.) a
`library/<modelo>/` **uno a uno** con evidencia de campo. No parchear el
generic de marca.

---

## Criterio de éxito final

- [x] Fase 1: registry OLT + layout `topology/{olts,onus,routers,shared}`.
- [x] Tres carpetas OLT independientes (`huawei`, `zte/titan`, `zte/c3xx`).
- [x] ONU: `generic/{marca}` + library model; first-match registry.
- [x] Orquestadores vía registry (sin clients de vendor directos en flujos nuevos).
- [ ] Prod estable: mismos verify ok / mismos tiempos de poll (Gate E/F en curso).
- [ ] Modelo nuevo = una carpeta + registro; genérico intocado.
- [ ] Routers fuera de alcance hasta plan propio (`drivers/router/…`).

---

## Referencias

- [`onu-model-provision.md`](./onu-model-provision.md) — guía operativa (paths →
  `drivers/onu`).
- [`olt-router-findings.md`](./olt-router-findings.md) — P1.1 cast Huawei↔ZTE;
  matrices de capacidades.
- [`zte-olt-c3xx.md`](./zte-olt-c3xx.md) — dialecto C3xx.
- [`tr069.md`](./tr069.md) — plano ACS / GenieACS.
- Código hoy: `apps/api/src/drivers/olt/`, `apps/api/src/drivers/onu/`.
