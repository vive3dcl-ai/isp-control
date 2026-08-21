/** Catálogo built-in (metadata) compartido entre seed DB y AiToolsService. */
export type BuiltinToolMeta = {
  slug: string;
  name: string;
  description: string;
  mutates: boolean;
  parametersSchema: Record<string, unknown>;
  sortOrder: number;
};

export const BUILTIN_AI_TOOLS: BuiltinToolMeta[] = [
  {
    slug: 'crm_search_clients',
    name: 'Buscar clientes',
    description:
      'Busca clientes del tenant por nombre, teléfono, documento, email o empresa. Sin q (o q=recientes/*) lista los más recién creados. Devuelve id UUID real para usar en ui_open_view / crm_get_client.',
    mutates: false,
    sortOrder: 100,
    parametersSchema: {
      type: 'object',
      properties: {
        q: {
          type: 'string',
          description:
            'Texto a buscar. Vacío, «recientes» o «*» = últimos creados (útil para «el cliente más reciente»).',
        },
        limit: { type: 'number', description: 'Máx resultados (default 20)' },
      },
    },
  },
  {
    slug: 'crm_get_client',
    name: 'Ficha de cliente',
    description:
      'Detalle de un cliente con sus servicios y onuId asociados (si hay). clientId debe ser UUID real de crm_search_clients (nunca <uuid>).',
    mutates: false,
    sortOrder: 110,
    parametersSchema: {
      type: 'object',
      required: ['clientId'],
      properties: {
        clientId: {
          type: 'string',
          description: 'UUID del cliente (campo id del TOOL_RESULT)',
        },
      },
    },
  },
  {
    slug: 'crm_list_services',
    name: 'Servicios del cliente',
    description: 'Lista servicios de un cliente con estado y ONU enlazada.',
    mutates: false,
    sortOrder: 120,
    parametersSchema: {
      type: 'object',
      required: ['clientId'],
      properties: { clientId: { type: 'string' } },
    },
  },
  {
    slug: 'crm_get_service',
    name: 'Detalle de servicio',
    description:
      'Detalle de un servicio por id: plan, estado, onuId/SN si está enlazado.',
    mutates: false,
    sortOrder: 130,
    parametersSchema: {
      type: 'object',
      required: ['serviceId'],
      properties: { serviceId: { type: 'string' } },
    },
  },
  {
    slug: 'crm_update_client',
    name: 'Editar cliente',
    description:
      'Actualiza datos de un cliente (nombre, teléfono, email, dirección, documento, nota, zona, archivar). No disponible en solo lectura.',
    mutates: true,
    sortOrder: 140,
    parametersSchema: {
      type: 'object',
      required: ['clientId'],
      properties: {
        clientId: { type: 'string' },
        firstName: { type: 'string' },
        lastName: { type: 'string' },
        companyName: { type: 'string' },
        phone: { type: 'string' },
        email: { type: 'string' },
        documentType: { type: 'string' },
        documentNumber: { type: 'string' },
        street: { type: 'string' },
        city: { type: 'string' },
        note: { type: 'string' },
        isActive: { type: 'boolean', description: 'false = archivar' },
        isLead: { type: 'boolean' },
        zoneId: { type: 'string' },
      },
    },
  },
  {
    slug: 'crm_find_duplicates',
    name: 'Buscar clientes duplicados',
    description:
      'Detecta grupos de clientes duplicados por teléfono, documento, email o nombre. Útil antes de unificar.',
    mutates: false,
    sortOrder: 145,
    parametersSchema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description: 'auto | phone | document | email | name (default auto)',
        },
        q: {
          type: 'string',
          description: 'Opcional: acotar a clientes que coincidan con este texto',
        },
        limit: { type: 'number', description: 'Máx grupos (default 40)' },
        includeInactive: {
          type: 'boolean',
          description: 'Incluir archivados (default false)',
        },
      },
    },
  },
  {
    slug: 'crm_merge_clients',
    name: 'Unificar clientes',
    description:
      'Fusiona sourceClientId en targetClientId: mueve servicios/facturas/eventos, rellena campos vacíos y archiva el origen. Pedir confirmación si el usuario no dijo cuál conservar. No disponible en solo lectura.',
    mutates: true,
    sortOrder: 150,
    parametersSchema: {
      type: 'object',
      required: ['targetClientId', 'sourceClientId'],
      properties: {
        targetClientId: {
          type: 'string',
          description: 'Cliente que se conserva',
        },
        sourceClientId: {
          type: 'string',
          description: 'Cliente duplicado a absorber y archivar',
        },
        fillEmptyFields: {
          type: 'boolean',
          description: 'Rellenar vacíos del destino con datos del origen (default true)',
        },
        deleteSource: {
          type: 'boolean',
          description: 'Eliminar permanentemente el origen tras archivar (default false)',
        },
      },
    },
  },
  {
    slug: 'crm_find_duplicate_services',
    name: 'Buscar servicios duplicados',
    description:
      'Detecta servicios que comparten la misma ONU (y el mismo plan por defecto). Útil tras migraciones o merges de clientes. match=onu_and_plan|onu.',
    mutates: false,
    sortOrder: 152,
    parametersSchema: {
      type: 'object',
      properties: {
        match: {
          type: 'string',
          description: 'onu_and_plan (default) | onu',
        },
        clientId: {
          type: 'string',
          description: 'Opcional: limitar a un cliente',
        },
        includeEnded: {
          type: 'boolean',
          description: 'Incluir servicios ended (default false)',
        },
        limit: { type: 'number', description: 'Máx grupos (default 40)' },
      },
    },
  },
  {
    slug: 'crm_merge_services',
    name: 'Unificar servicios',
    description:
      'Fusiona sourceServiceId en targetServiceId si comparten ONU (mismo plan por defecto): mueve facturas, deja la ONU en el destino y marca el origen ended. Pedir confirmación del destino. No disponible en solo lectura.',
    mutates: true,
    sortOrder: 153,
    parametersSchema: {
      type: 'object',
      required: ['targetServiceId', 'sourceServiceId'],
      properties: {
        targetServiceId: {
          type: 'string',
          description: 'Servicio que se conserva (con ONU)',
        },
        sourceServiceId: {
          type: 'string',
          description: 'Servicio duplicado a cerrar',
        },
        requireSamePlan: {
          type: 'boolean',
          description: 'Exigir mismo plan (default true)',
        },
      },
    },
  },
  {
    slug: 'billing_search_invoices',
    name: 'Buscar facturas',
    description:
      'Busca facturas por número, cliente, teléfono o estado. status=open|debt|overdue|paid|issued|sent|draft|void.',
    mutates: false,
    sortOrder: 160,
    parametersSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Número, nombre, teléfono…' },
        status: {
          type: 'string',
          description: 'open/debt/overdue/paid/issued/sent/draft/void',
        },
        clientId: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },
  {
    slug: 'billing_list_debt',
    name: 'Facturas en deuda',
    description:
      'Lista facturas abiertas (emitidas/enviadas/vencidas) con totales de deuda y overdue. Filtra por cliente opcional.',
    mutates: false,
    sortOrder: 165,
    parametersSchema: {
      type: 'object',
      properties: {
        clientId: { type: 'string' },
        onlyOverdue: {
          type: 'boolean',
          description: 'Solo vencidas (default false = toda deuda abierta)',
        },
        limit: { type: 'number' },
      },
    },
  },
  {
    slug: 'billing_get_invoice',
    name: 'Detalle de factura',
    description: 'Detalle compacto de una factura (ítems, montos, cliente).',
    mutates: false,
    sortOrder: 170,
    parametersSchema: {
      type: 'object',
      required: ['invoiceId'],
      properties: { invoiceId: { type: 'string' } },
    },
  },
  {
    slug: 'billing_compare_invoices',
    name: 'Comparar facturas',
    description:
      'Compara dos facturas lado a lado (totales, períodos, estado, ítems).',
    mutates: false,
    sortOrder: 175,
    parametersSchema: {
      type: 'object',
      required: ['invoiceIdA', 'invoiceIdB'],
      properties: {
        invoiceIdA: { type: 'string' },
        invoiceIdB: { type: 'string' },
      },
    },
  },
  {
    slug: 'onu_list_failed',
    name: 'ONUs fallidas / con problemas',
    description:
      'Lista ONUs con verify fail/check, offline o suspendidas. kind=verify_fail|offline|suspended|all (default all).',
    mutates: false,
    sortOrder: 245,
    parametersSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          description: 'verify_fail | offline | suspended | all',
        },
        oltId: { type: 'string' },
        limit: { type: 'number', description: 'Máx resultados (default 40)' },
      },
    },
  },
  {
    slug: 'topo_list_routers',
    name: 'Listar routers',
    description:
      'Lista routers del tenant (host, usuario, estado). Credenciales: asset_get_connection.',
    mutates: false,
    sortOrder: 200,
    parametersSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Filtro opcional por nombre/host' },
      },
    },
  },
  {
    slug: 'topo_list_olts',
    name: 'Listar OLTs',
    description:
      'Lista OLTs del tenant (host, vendor, estado). Credenciales: asset_get_connection.',
    mutates: false,
    sortOrder: 210,
    parametersSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Filtro opcional por nombre/host' },
      },
    },
  },
  {
    slug: 'topo_get_device',
    name: 'Detalle de equipo',
    description:
      'Resumen de un dispositivo (router/OLT/switch). Para IP y credenciales usa asset_get_connection.',
    mutates: false,
    sortOrder: 220,
    parametersSchema: {
      type: 'object',
      required: ['deviceId'],
      properties: { deviceId: { type: 'string' } },
    },
  },
  {
    slug: 'asset_get_connection',
    name: 'Credenciales y acceso a activo',
    description:
      'Devuelve host, puerto, usuario, contraseña, SNMP y rutas VPN para un equipo (deviceId) o túnel (tunnelId). Usar antes de diagnosticar por VPN.',
    mutates: false,
    sortOrder: 225,
    parametersSchema: {
      type: 'object',
      properties: {
        deviceId: { type: 'string', description: 'ID de router/OLT/switch' },
        tunnelId: { type: 'string', description: 'ID de túnel VPN del tenant' },
      },
    },
  },
  {
    slug: 'mikrotik_read',
    name: 'MikroTik lectura segura',
    description:
      'Consulta RouterOS (print/monitor/ping) vía API del tenant. Requiere deviceId MikroTik RouterOS y credenciales en topología.',
    mutates: false,
    sortOrder: 260,
    parametersSchema: {
      type: 'object',
      required: ['deviceId'],
      properties: {
        deviceId: {
          type: 'string',
          description: 'UUID del equipo, o su nombre exacto (p. ej. edge-mikrotik)',
        },
        path: {
          type: 'string',
          description: 'Menú print, ej. /interface/print',
        },
        words: {
          type: 'array',
          items: { type: 'string' },
          description: 'Palabras API, ej. ["/ip/address/print"]',
        },
      },
    },
  },
  {
    slug: 'mikrotik_apply',
    name: 'MikroTik cambio seguro',
    description:
      'Aplica comandos RouterOS (set/add/enable/disable). Bloquea reboot/reset/remove. No disponible en solo lectura.',
    mutates: true,
    sortOrder: 270,
    parametersSchema: {
      type: 'object',
      required: ['deviceId', 'words'],
      properties: {
        deviceId: {
          type: 'string',
          description: 'UUID del equipo, o su nombre exacto (p. ej. edge-mikrotik)',
        },
        words: {
          type: 'array',
          items: { type: 'string' },
          description: 'Palabras API RouterOS (sin print)',
        },
        note: {
          type: 'string',
          description: 'Motivo breve del cambio (para restore point)',
        },
      },
    },
  },
  {
    slug: 'olt_discover_onus_live',
    name: 'ONUs en vivo en OLT',
    description:
      'Descubre ONUs conectadas en la OLT por SNMP/CLI vía mgmtHost/VPN del tenant.',
    mutates: false,
    sortOrder: 340,
    parametersSchema: {
      type: 'object',
      required: ['oltId'],
      properties: {
        oltId: { type: 'string' },
        preferSnmp: {
          type: 'boolean',
          description: 'Intentar SNMP primero (default true)',
        },
        limit: { type: 'number', description: 'Máx ONUs en respuesta (default 60)' },
      },
    },
  },
  {
    slug: 'ui_open_view',
    name: 'Abrir vista real',
    description:
      'Abre la vista en el panel-navegador del Asistente (junto al chat): ficha completa o resumen de cliente, ONU, servicio o equipo. clientId/serviceId/onuId deben ser UUID reales del TOOL_RESULT (nunca <uuid>). mode=full|summary (default full). view=close para cerrar.',
    mutates: false,
    sortOrder: 90,
    parametersSchema: {
      type: 'object',
      required: ['view'],
      properties: {
        view: {
          type: 'string',
          description: 'client | onu | service | device | close',
        },
        mode: {
          type: 'string',
          description: 'full (default) | summary',
        },
        clientId: {
          type: 'string',
          description: 'UUID real del cliente (de crm_search_clients)',
        },
        serviceId: {
          type: 'string',
          description: 'UUID real del servicio',
        },
        onuId: {
          type: 'string',
          description: 'UUID real de la ONU',
        },
        oltId: { type: 'string' },
        onuIf: { type: 'string' },
        deviceId: {
          type: 'string',
          description: 'UUID del equipo, o su nombre exacto (p. ej. edge-mikrotik)',
        },
        title: { type: 'string' },
      },
    },
  },
  {
    slug: 'onu_list_connected',
    name: 'Listar ONUs',
    description:
      'Lista las ONUs del tenant con estado online y verifyStatus (ok/fail/test/check/idle).',
    mutates: false,
    sortOrder: 300,
    parametersSchema: {
      type: 'object',
      properties: {
        verifyStatus: { type: 'string' },
        onlineOnly: { type: 'boolean' },
        limit: { type: 'number' },
      },
    },
  },
  {
    slug: 'onu_lookup',
    name: 'Buscar ONU',
    description:
      'Busca ONU por sn, onuId, serviceId o clientId. Resuelve seriales asociados al cliente/servicio.',
    mutates: false,
    sortOrder: 310,
    parametersSchema: {
      type: 'object',
      properties: {
        sn: { type: 'string' },
        onuId: { type: 'string' },
        serviceId: { type: 'string' },
        clientId: { type: 'string' },
      },
    },
  },
  {
    slug: 'onu_verify_status',
    name: 'Estado de verificación ONU',
    description:
      'Lee el progreso y checks de verificación post-provision (último resultado guardado).',
    mutates: false,
    sortOrder: 320,
    parametersSchema: {
      type: 'object',
      required: ['onuId'],
      properties: { onuId: { type: 'string' } },
    },
  },
  {
    slug: 'onu_live_status',
    name: 'Estado en vivo ONU (OLT/VPN)',
    description:
      'Consulta en vivo el estado óptico/admin de la ONU en la OLT por la VPN/mgmt del tenant.',
    mutates: false,
    sortOrder: 330,
    parametersSchema: {
      type: 'object',
      required: ['onuId'],
      properties: { onuId: { type: 'string' } },
    },
  },
  {
    slug: 'topo_test_connection',
    name: 'Probar conexión equipo',
    description:
      'Probe en vivo de router/OLT (CLI/API/SNMP) por VPN/mgmt del tenant.',
    mutates: false,
    sortOrder: 230,
    parametersSchema: {
      type: 'object',
      required: ['deviceId'],
      properties: { deviceId: { type: 'string' } },
    },
  },
  {
    slug: 'vpn_list_tunnels',
    name: 'Listar túneles VPN',
    description:
      'Lista túneles VPN (estado, protocolo, peer). Claves: asset_get_connection con tunnelId.',
    mutates: false,
    sortOrder: 240,
    parametersSchema: { type: 'object', properties: {} },
  },
  {
    slug: 'vpn_probe_tunnel',
    name: 'Probar túnel VPN',
    description:
      'Diagnostica si el túnel VPN del tenant llega al peer/LAN (ruta API + concentrador).',
    mutates: false,
    sortOrder: 250,
    parametersSchema: {
      type: 'object',
      required: ['tunnelId'],
      properties: { tunnelId: { type: 'string' } },
    },
  },
  {
    slug: 'onu_verify_run',
    name: 'Ejecutar verificación ONU',
    description:
      'Ejecuta el Check ONU completo (cura + verificación) vía ACS/OLT/router del tenant (VPN). No disponible en solo lectura.',
    mutates: true,
    sortOrder: 400,
    parametersSchema: {
      type: 'object',
      required: ['onuId'],
      properties: { onuId: { type: 'string' } },
    },
  },
  {
    slug: 'onu_refresh',
    name: 'Refrescar ONU desde OLT',
    description:
      'Relee estado de la ONU en la OLT (vía VPN/mgmt) y actualiza inventario. No disponible en solo lectura.',
    mutates: true,
    sortOrder: 410,
    parametersSchema: {
      type: 'object',
      required: ['onuId'],
      properties: { onuId: { type: 'string' } },
    },
  },
  {
    slug: 'onu_reboot',
    name: 'Reiniciar ONU',
    description:
      'Reinicia la ONU en la OLT vía VPN/mgmt. Acción destructiva leve; no disponible en solo lectura.',
    mutates: true,
    sortOrder: 420,
    parametersSchema: {
      type: 'object',
      required: ['onuId'],
      properties: { onuId: { type: 'string' } },
    },
  },
  {
    slug: 'crm_set_service_status',
    name: 'Cambiar estado de servicio',
    description:
      'Pone un servicio en active o suspended (aplica red). No disponible en solo lectura.',
    mutates: true,
    sortOrder: 430,
    parametersSchema: {
      type: 'object',
      required: ['serviceId', 'status'],
      properties: {
        serviceId: { type: 'string' },
        status: { type: 'string', description: 'active | suspended' },
      },
    },
  },
  {
    slug: 'crm_reconcile_olt',
    name: 'Reconciliar servicio en OLT',
    description:
      'Alinea OLT/portal con el estado CRM del servicio (sin borrar ONU). No disponible en solo lectura.',
    mutates: true,
    sortOrder: 440,
    parametersSchema: {
      type: 'object',
      required: ['serviceId'],
      properties: { serviceId: { type: 'string' } },
    },
  },
];

export const TENANT_ACCESS_SKILL = {
  slug: 'tenant_ops_guide',
  name: 'Operaciones del tenant',
  description:
    'Acceso total al tenant: CRM, topología, VPN, credenciales y verificación en vivo.',
  sortOrder: 1,
  code: `# Guía de acceso total al tenant

Tienes acceso a TODO el tenant del usuario (datos + equipos en vivo).

## Credenciales e IPs
1. \`asset_get_connection\` con \`deviceId\` (router/OLT) o \`tunnelId\` (VPN).
2. Devuelve host, puerto, usuario, contraseña, SNMP y rutas del túnel.
3. Las tools de lectura/escritura usan esas credenciales automáticamente; no inventes IPs ni passwords.

## Panel lateral (UI)
Cuando quieras mostrar detalle al usuario: \`ui_open_view\` (client / onu / service / device).
Eso abre el panel-navegador junto al chat (vista completa por defecto; mode=summary para resumen).
No digas «puedo abrir»; ábrela. No uses navegación de la app principal.
Cierra con \`ui_open_view\` \`view=close\`.

## Tools sin pedir permiso
Lecturas CRM/topología/VPN/ONU/live: ejecuta al momento. No preguntes «¿quieres que busque?».
Solo confirma antes de mutaciones (reboot, apply, suspend, etc.).

## Resolver pedidos
1. Cliente → \`crm_search_clients\` (sin q = recientes) → \`crm_get_client\` / \`crm_list_services\` → \`ui_open_view\` client (con el id del resultado).
2. Duplicados → \`crm_find_duplicates\` → confirmar destino → \`crm_merge_clients\` → \`ui_open_view\` client.
3. Servicios duplicados (misma ONU/plan) → \`crm_find_duplicate_services\` → \`crm_merge_services\`.
3. Editar cliente → \`crm_update_client\` (tras confirmación si el usuario no fue explícito).
4. Facturas / deuda → \`billing_list_debt\` / \`billing_search_invoices\` → \`billing_get_invoice\` / \`billing_compare_invoices\` → abrir cliente.
5. Servicio → \`crm_get_service\` o \`onu_lookup\` con \`serviceId\`/\`clientId\`.
6. ONU en vivo → \`onu_list_failed\` / \`onu_live_status\` / \`olt_discover_onus_live\` / \`onu_verify_status\` → \`ui_open_view\` onu.
7. MikroTik → \`mikrotik_read\` (revisar) y \`mikrotik_apply\` (cambios acotados).
8. Equipo no responde → \`vpn_list_tunnels\` + \`vpn_probe_tunnel\` + \`topo_test_connection\`.

## Verificación / reparación
- Preferir \`onu_refresh\` + \`onu_verify_run\` antes de \`onu_reboot\`.
- Solo lectura: consulta en vivo pero NO mutar (\`mikrotik_apply\`, \`onu_verify_run\`, \`crm_merge_clients\`, etc.).
- Con punto de restauración: mutaciones dejan rastro undo.
`,
};

export const BUILTIN_AI_SKILLS = [
  TENANT_ACCESS_SKILL,
  {
    slug: 'onu_verify_diagnose',
    name: 'Diagnosticar verificación ONU',
    description:
      'Guía para revisar ONUs del tenant con las tools de verificación.',
    sortOrder: 5,
    code: `# Diagnóstico de verificación ONU

1. Resolver ONU (sn / clientId / serviceId) con \`onu_lookup\`.
2. \`asset_get_connection\` en la OLT si hace falta confirmar mgmt/VPN.
3. \`onu_verify_status\` e interpretar fail/test/ok/check.
4. \`onu_live_status\` o \`olt_discover_onus_live\` para estado óptico en OLT.
5. Si hace falta y no hay solo lectura → \`onu_verify_run\` o \`onu_refresh\`.
`,
  },
  {
    slug: 'mikrotik_safe_review',
    name: 'Revisar MikroTik con seguridad',
    description:
      'Flujo de lectura RouterOS vía VPN sin aplicar cambios.',
    sortOrder: 10,
    code: `# Revisión segura MikroTik

1. \`topo_list_routers\` o \`topo_get_device\` → elegir \`deviceId\`.
2. \`asset_get_connection\` → host, usuario, contraseña, protocolo API.
3. \`vpn_probe_tunnel\` si el mgmtHost es LAN privada.
4. \`topo_test_connection\` para confirmar reachability.
5. \`mikrotik_read\` con paths típicos:
   - \`/interface/print\`
   - \`/ip/address/print\`
   - \`/ip/route/print\`
   - \`/ip/firewall/filter/print\`
   - \`/queue/simple/print\`
6. Resume hallazgos al usuario. NO uses \`mikrotik_apply\` en solo lectura.
`,
  },
  {
    slug: 'mikrotik_safe_apply',
    name: 'Aplicar cambios MikroTik seguros',
    description:
      'Cambios acotados en RouterOS con restore point y sin comandos destructivos.',
    sortOrder: 15,
    code: `# Cambios seguros MikroTik

1. Completar revisión (\`mikrotik_safe_review\`) antes de mutar.
2. Confirmar que NO hay modo solo lectura.
3. \`mikrotik_read\` del recurso afectado (estado antes).
4. \`mikrotik_apply\` con \`words\` RouterOS (set/add/enable/disable/comment).
   - Prohibido: reboot, reset, remove masivo, delete.
5. \`mikrotik_read\` otra vez para verificar.
6. Si falla, indicar undo manual o restore point de la sesión.
`,
  },
  {
    slug: 'olt_onu_verify_via_vpn',
    name: 'Verificar ONUs OLT vía VPN',
    description:
      'Descubrir y verificar ONUs en OLT usando mgmtHost y túnel VPN del tenant.',
    sortOrder: 20,
    code: `# ONUs en OLT vía VPN

1. \`topo_list_olts\` → \`oltId\`.
2. \`asset_get_connection\` con \`deviceId\` = OLT (host SNMP/CLI + credenciales).
3. \`vpn_list_tunnels\` + \`vpn_probe_tunnel\` si mgmt es red privada.
4. \`topo_test_connection\` en la OLT.
5. \`olt_discover_onus_live\` → inventario SNMP/CLI actual.
6. Para una ONU: \`onu_lookup\` → \`onu_live_status\` o \`onu_verify_status\`.
7. Reparar (si permitido): \`onu_refresh\` → \`onu_verify_run\`.
`,
  },
  {
    slug: 'crm_dedupe_clients',
    name: 'Unificar clientes duplicados',
    description: 'Detectar y fusionar fichas duplicadas del CRM.',
    sortOrder: 25,
    code: `# Unificar clientes duplicados

1. \`crm_find_duplicates\` (field=auto o phone/document/email/name; q si el usuario dio un nombre).
2. Mostrar grupos y pedir cuál conservar si no está claro.
3. \`crm_get_client\` de target y source.
4. Sin solo lectura → \`crm_merge_clients\` (targetClientId = el que se queda).
5. \`ui_open_view\` del cliente unificado.
6. Resumen corto: qué se movió (servicios/facturas) y cuál quedó archivado.
`,
  },
  {
    slug: 'crm_dedupe_services',
    name: 'Unificar servicios duplicados',
    description:
      'Detectar y fusionar servicios que comparten la misma ONU y plan.',
    sortOrder: 26,
    code: `# Unificar servicios (misma ONU + plan)

1. \`crm_find_duplicate_services\` (match=onu_and_plan por defecto; clientId si acotás a un cliente).
2. Revisá cada grupo: misma ONU, mismo plan, estados (preferí conservar active/suspended).
3. \`crm_get_service\` de target y source si hace falta detalle.
4. Sin solo lectura → \`crm_merge_services\` (targetServiceId = suggestedTargetServiceId o el que el usuario elija).
5. Opcional: \`ui_open_view\` service del unificado.
6. Resumen: qué servicio quedó, cuál ended, facturas movidas.
`,
  },
  {
    slug: 'billing_debt_review',
    name: 'Revisar deuda y facturas',
    description: 'Listar deuda, buscar y comparar facturas.',
    sortOrder: 30,
    code: `# Deuda y facturas

1. \`billing_list_debt\` (onlyOverdue si pide vencidas; clientId si es un cliente).
2. \`billing_search_invoices\` para buscar por número/nombre.
3. \`billing_get_invoice\` o \`billing_compare_invoices\` para detalle.
4. \`crm_get_client\` / \`ui_open_view\` del deudor si hace falta.
5. Resume totales de deuda y listado breve (número, cliente, monto, estado, vencimiento).
`,
  },
  {
    slug: 'onu_failed_triage',
    name: 'Triaje ONUs fallidas',
    description: 'Listar y diagnosticar ONUs con verify fail/offline.',
    sortOrder: 35,
    code: `# ONUs fallidas

1. \`onu_list_failed\` (kind=verify_fail|offline|all).
2. Para cada caso relevante: \`onu_verify_status\` + \`onu_live_status\`.
3. \`ui_open_view\` onu si el usuario quiere ver la ficha.
4. Reparar solo si lo pide y no hay solo lectura: \`onu_refresh\` → \`onu_verify_run\`.
`,
  },
];
