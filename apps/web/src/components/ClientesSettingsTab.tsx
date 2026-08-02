import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import { clientDisplayName, type Client } from "../lib/crm";
import { useNotify } from "./NotifyProvider";
import { SettingsSubTabs } from "./SettingsSubTabs";

type Section = "options" | "archived";

export function ClientesSettingsTab({ canWrite }: { canWrite: boolean }) {
  const [section, setSection] = useState<Section>("options");

  return (
    <div className="space-y-4">
      <SettingsSubTabs
        aria-label="Opciones de clientes"
        value={section}
        onChange={setSection}
        tabs={
          [
            { id: "options", label: "Opciones de cliente" },
            { id: "archived", label: "Clientes archivados" },
          ] as const
        }
      />

      {section === "options" ? (
        <ClientOptions />
      ) : (
        <ArchivedClients canWrite={canWrite} />
      )}
    </div>
  );
}

function ClientOptions() {
  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-5">
      <h3 className="text-base font-semibold">Opciones de cliente</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Al archivarlos dejan de aparecer en la lista principal y se conservan
        sus datos. Desde Clientes archivados puedes restaurarlos o eliminarlos
        para siempre (sólo de esta empresa, no del panel admin).
      </p>
    </section>
  );
}

function ArchivedClients({ canWrite }: { canWrite: boolean }) {
  const queryClient = useQueryClient();
  const { confirm } = useNotify();
  const clientsQuery = useQuery({
    queryKey: ["app", "clients"],
    queryFn: () => apiFetch<Client[]>("/app/clients"),
  });
  const archived = (clientsQuery.data ?? []).filter(
    (client) => !client.isActive,
  );

  const restoreMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<Client>(`/app/clients/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: true }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["app", "clients"] });
      void queryClient.invalidateQueries({ queryKey: ["app", "dashboard"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ ok: boolean }>(`/app/clients/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["app", "clients"] });
      void queryClient.invalidateQueries({ queryKey: ["app", "dashboard"] });
    },
  });

  const busy = restoreMutation.isPending || deleteMutation.isPending;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Clientes archivados</h3>
        <p className="text-sm text-[var(--text-muted)]">
          Restaura clientes a la lista principal o elimínalos para siempre de
          esta empresa (servicios y facturas del cliente incluidos).
        </p>
      </div>

      {clientsQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {clientsQuery.error.message}
        </p>
      )}

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead className="bg-[var(--bg)] text-[var(--text-muted)]">
            <tr>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Contacto</th>
              <th className="px-4 py-3 font-medium">Ciudad</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {clientsQuery.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                  Cargando…
                </td>
              </tr>
            )}
            {!clientsQuery.isLoading && archived.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-[var(--text-muted)]">
                  No hay clientes archivados.
                </td>
              </tr>
            )}
            {archived.map((client) => (
              <tr key={client.id} className="border-t border-[var(--border)]">
                <td className="px-4 py-3 font-medium">
                  {clientDisplayName(client)}
                </td>
                <td className="px-4 py-3 text-[var(--text-muted)]">
                  <div>{client.email || "—"}</div>
                  <div className="text-xs">{client.phone || ""}</div>
                </td>
                <td className="px-4 py-3">{client.city || "—"}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      to={`/app/clients/${client.id}`}
                      className="rounded-md bg-[var(--accent)] px-2.5 py-1 text-xs font-medium text-white hover:bg-[var(--accent-hover)]"
                    >
                      Ver
                    </Link>
                    {canWrite && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void confirm(
                              `¿Restaurar a ${clientDisplayName(client)}?`,
                              {
                                title: "Restaurar cliente",
                                confirmLabel: "Restaurar",
                              },
                            ).then((ok) => {
                              if (ok) restoreMutation.mutate(client.id);
                            });
                          }}
                          className="rounded-md border border-emerald-500/50 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-60"
                        >
                          Restaurar
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            void confirm(
                              `¿Eliminar para siempre a ${clientDisplayName(client)}? Se borrarán sus servicios y facturas de esta empresa. Esta acción no se puede deshacer.`,
                              {
                                title: "Eliminar cliente",
                                confirmLabel: "Eliminar para siempre",
                                danger: true,
                              },
                            ).then((ok) => {
                              if (ok) deleteMutation.mutate(client.id);
                            });
                          }}
                          className="rounded-md border border-[var(--danger)]/50 px-2.5 py-1 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-60"
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
