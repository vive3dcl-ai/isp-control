import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'
import { PanelShell } from '../components/PanelShell'
import { SettingsSubTabs } from '../components/SettingsSubTabs'
import {
  ListSearchInput,
  matchesSearch,
} from '../components/ListSearchInput'
import {
  ModalShell,
  modalBodyClass,
  modalFooterClass,
  modalHeaderClass,
} from '../components/ModalShell'
import type { AiCapability, AiCapabilityKind } from '../lib/ai-capabilities'
import { useAuth } from '../auth/AuthContext'

const TABS = [
  { id: 'tools', label: 'Tools' },
  { id: 'skills', label: 'Skills' },
] as const

type TabId = (typeof TABS)[number]['id']

const inputClass =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm outline-none ring-[var(--accent)] focus:ring-2'

const codeClass =
  'w-full min-h-[220px] rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-xs leading-relaxed outline-none ring-[var(--accent)] focus:ring-2'

const DEFAULT_TOOL_SCHEMA = `{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}`

const DEFAULT_TOOL_CODE = `// Handler del tool (se ejecutará en el runtime del agente).
// Recibe args validados según parametersSchema.
async function run(args, ctx) {
  // TODO: implementar
  return { ok: true, args }
}
`

const DEFAULT_SKILL_CODE = `# Instrucciones del skill

Describe cuándo usarlo y qué pasos seguir.
`

function slugify(name: string) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80)
}

export function AdminAiPage() {
  const { user } = useAuth()
  const canWrite =
    user?.role === 'superadmin' || user?.role === 'admin'
  const [tab, setTab] = useState<TabId>('tools')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AiCapability | null>(null)
  const [creating, setCreating] = useState(false)

  const kind: AiCapabilityKind = tab === 'tools' ? 'tool' : 'skill'

  const query = useQuery({
    queryKey: ['admin', 'ai', 'capabilities', kind],
    queryFn: () =>
      apiFetch<AiCapability[]>(
        `/admin/ai/capabilities?kind=${kind}`,
      ),
  })

  const visible = useMemo(() => {
    const rows = query.data ?? []
    return rows.filter((r) =>
      matchesSearch(search, r.name, r.slug, r.description),
    )
  }, [query.data, search])

  return (
    <PanelShell
      title="IA"
      subtitle="Tools y skills globales del Asistente"
      variant="admin"
    >
      <SettingsSubTabs
        tabs={TABS}
        value={tab}
        onChange={(id) => {
          setTab(id)
          setSearch('')
          setEditing(null)
          setCreating(false)
        }}
        aria-label="Secciones IA"
      />

      <p className="mb-4 text-sm text-[var(--text-muted)]">
        Solo los items <strong>activos</strong> se entregan a los agentes de
        los tenants. Las tools son funciones invocables; los skills son
        instrucciones/playbooks.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <ListSearchInput
          value={search}
          onChange={setSearch}
          placeholder={
            kind === 'tool' ? 'Buscar tool…' : 'Buscar skill…'
          }
          className="md:max-w-sm"
        />
        {canWrite && (
          <button
            type="button"
            onClick={() => {
              setEditing(null)
              setCreating(true)
            }}
            className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)]"
          >
            Nuevo {kind === 'tool' ? 'tool' : 'skill'}
          </button>
        )}
      </div>

      {query.isLoading && (
        <p className="text-sm text-[var(--text-muted)]">Cargando…</p>
      )}
      {query.error && (
        <p className="text-sm text-[var(--danger)]">{query.error.message}</p>
      )}

      <ul className="space-y-2">
        {visible.map((item) => (
          <CapabilityRow
            key={item.id}
            item={item}
            canWrite={canWrite}
            onEdit={() => {
              setCreating(false)
              setEditing(item)
            }}
          />
        ))}
      </ul>

      {!query.isLoading && visible.length === 0 && (
        <p className="mt-6 text-sm text-[var(--text-muted)]">
          No hay {kind === 'tool' ? 'tools' : 'skills'} todavía.
        </p>
      )}

      {(creating || editing) && (
        <CapabilityEditorModal
          kind={kind}
          initial={editing}
          canWrite={canWrite}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
        />
      )}
    </PanelShell>
  )
}

function CapabilityRow({
  item,
  canWrite,
  onEdit,
}: {
  item: AiCapability
  canWrite: boolean
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/ai/capabilities/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled: !item.enabled }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'ai', 'capabilities'],
      })
    },
  })

  return (
    <li className="flex flex-wrap items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{item.name}</span>
          <code className="rounded bg-[var(--bg-elevated)] px-1.5 py-0.5 text-[11px] text-[var(--text-muted)]">
            {item.slug}
          </code>
          <span
            className={[
              'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
              item.enabled
                ? 'bg-emerald-500/15 text-emerald-300'
                : 'bg-[var(--bg-elevated)] text-[var(--text-muted)]',
            ].join(' ')}
          >
            {item.enabled ? 'Activo' : 'Inactivo'}
          </span>
        </div>
        {item.description && (
          <p className="mt-1 text-xs text-[var(--text-muted)]">
            {item.description}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canWrite && (
          <button
            type="button"
            disabled={toggle.isPending}
            onClick={() => toggle.mutate()}
            className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:bg-[var(--bg-elevated)] disabled:opacity-60"
          >
            {item.enabled ? 'Desactivar' : 'Activar'}
          </button>
        )}
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs hover:bg-[var(--bg-elevated)]"
        >
          {canWrite ? 'Editar' : 'Ver'}
        </button>
      </div>
    </li>
  )
}

function CapabilityEditorModal({
  kind,
  initial,
  canWrite,
  onClose,
}: {
  kind: AiCapabilityKind
  initial: AiCapability | null
  canWrite: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const isNew = !initial
  const [name, setName] = useState(initial?.name ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [slugTouched, setSlugTouched] = useState(!!initial)
  const [description, setDescription] = useState(initial?.description ?? '')
  const [code, setCode] = useState(
    initial?.code ??
      (kind === 'tool' ? DEFAULT_TOOL_CODE : DEFAULT_SKILL_CODE),
  )
  const [schemaText, setSchemaText] = useState(
    initial?.parametersSchema
      ? JSON.stringify(initial.parametersSchema, null, 2)
      : DEFAULT_TOOL_SCHEMA,
  )
  const [enabled, setEnabled] = useState(initial?.enabled ?? true)
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 0)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    if (!slugTouched && isNew) {
      setSlug(slugify(name))
    }
  }, [name, slugTouched, isNew])

  const save = useMutation({
    mutationFn: async () => {
      let parametersSchema: Record<string, unknown> | null = null
      if (kind === 'tool') {
        try {
          parametersSchema = JSON.parse(schemaText) as Record<string, unknown>
        } catch {
          throw new Error('parametersSchema no es JSON válido')
        }
      }
      if (isNew) {
        return apiFetch<AiCapability>('/admin/ai/capabilities', {
          method: 'POST',
          body: JSON.stringify({
            kind,
            slug,
            name,
            description,
            code,
            parametersSchema,
            enabled,
            sortOrder,
          }),
        })
      }
      return apiFetch<AiCapability>(`/admin/ai/capabilities/${initial!.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name,
          description,
          code,
          parametersSchema,
          enabled,
          sortOrder,
        }),
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'ai', 'capabilities'],
      })
      onClose()
    },
    onError: (err: Error) => setMsg(err.message),
  })

  const remove = useMutation({
    mutationFn: () =>
      apiFetch(`/admin/ai/capabilities/${initial!.id}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ['admin', 'ai', 'capabilities'],
      })
      onClose()
    },
    onError: (err: Error) => setMsg(err.message),
  })

  return (
    <ModalShell
      open
      onClose={onClose}
      panelClassName="max-w-3xl"
      labelledBy="ai-cap-editor-title"
    >
      <div className={modalHeaderClass}>
        <div>
          <h2 id="ai-cap-editor-title" className="text-lg font-semibold">
            {isNew
              ? `Nuevo ${kind === 'tool' ? 'tool' : 'skill'}`
              : canWrite
                ? 'Editar'
                : 'Ver'}{' '}
            {!isNew && initial?.name}
          </h2>
          <p className="text-xs text-[var(--text-muted)]">
            {kind === 'tool'
              ? 'Función que el agente puede invocar'
              : 'Playbook / instrucciones para el agente'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-[var(--text-muted)] hover:bg-[var(--bg)]"
        >
          ✕
        </button>
      </div>

      <div className={`${modalBodyClass} space-y-3`}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Nombre</span>
            <input
              className={inputClass}
              value={name}
              disabled={!canWrite}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Slug</span>
            <input
              className={inputClass}
              value={slug}
              disabled={!canWrite || !isNew}
              onChange={(e) => {
                setSlugTouched(true)
                setSlug(e.target.value)
              }}
              placeholder="buscar_cliente"
            />
          </label>
        </div>

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            Descripción
          </span>
          <textarea
            className={inputClass}
            rows={2}
            value={description}
            disabled={!canWrite}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canWrite}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Activo (visible para agentes tenant)
          </label>
          <label className="flex items-center gap-2">
            <span className="text-[var(--text-muted)]">Orden</span>
            <input
              type="number"
              min={0}
              className={inputClass + ' w-24'}
              value={sortOrder}
              disabled={!canWrite}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </label>
        </div>

        {kind === 'tool' && (
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">
              parametersSchema (JSON)
            </span>
            <textarea
              className={codeClass}
              value={schemaText}
              disabled={!canWrite}
              spellCheck={false}
              onChange={(e) => setSchemaText(e.target.value)}
            />
          </label>
        )}

        <label className="block text-sm">
          <span className="mb-1 block text-[var(--text-muted)]">
            {kind === 'tool' ? 'Código del tool' : 'Contenido del skill'}
          </span>
          <textarea
            className={codeClass + ' min-h-[280px]'}
            value={code}
            disabled={!canWrite}
            spellCheck={false}
            onChange={(e) => setCode(e.target.value)}
          />
        </label>

        {msg && <p className="text-sm text-[var(--danger)]">{msg}</p>}
      </div>

      <div className={modalFooterClass}>
        {!isNew && canWrite && (
          <button
            type="button"
            disabled={remove.isPending || save.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `¿Eliminar «${initial?.name}»? Esta acción no se puede deshacer.`,
                )
              ) {
                remove.mutate()
              }
            }}
            className="mr-auto rounded-lg border border-[var(--danger)]/40 px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-60"
          >
            Eliminar
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm"
        >
          Cerrar
        </button>
        {canWrite && (
          <button
            type="button"
            disabled={save.isPending || !name.trim() || !slug.trim()}
            onClick={() => {
              setMsg(null)
              save.mutate()
            }}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            {save.isPending ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
    </ModalShell>
  )
}
