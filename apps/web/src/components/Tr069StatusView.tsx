import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiFetch } from "../lib/api";
import type { AcsServiceStatus, Tr069StatusResponse } from "../lib/tr069";
import {
  OperationProgressModal,
  runProgressSteps,
  type ProgressStep,
} from "./OperationProgressModal";

function ServiceBadge({
  label,
  status,
}: {
  label: string;
  status: AcsServiceStatus;
}) {
  const online = status === "online";
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      {label}:
      <span
        className={[
          "inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white",
          online ? "bg-emerald-600" : "bg-[var(--danger)]",
        ].join(" ")}
        title={status}
      >
        {online ? "✓" : "✕"}
      </span>
    </span>
  );
}

function KpiCard({
  value,
  label,
  emphasize,
}: {
  value: number;
  label: string;
  emphasize?: "accent" | "danger" | "muted";
}) {
  const valueClass =
    emphasize === "danger"
      ? "text-[var(--danger)]"
      : emphasize === "muted"
        ? "text-[var(--text)]"
        : "text-[var(--accent)]";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] px-4 py-4">
      <p className={`text-3xl font-semibold tabular-nums ${valueClass}`}>
        {value}
      </p>
      <p className="mt-1 text-sm text-[var(--text-muted)]">{label}</p>
    </div>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="ml-2 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--bg)] px-1.5 text-xs text-[var(--text-muted)]">
      {n}
    </span>
  );
}

export function Tr069StatusView() {
  const [search, setSearch] = useState("");
  const [oltSortAsc, setOltSortAsc] = useState(true);
  const [manualTests, setManualTests] = useState<
    Record<string, { status: "running" | "ok" | "fail"; message: string }>
  >({});
  const [checkOpen, setCheckOpen] = useState(false);
  const [checkTitle, setCheckTitle] = useState("Test manual");
  const [checkSteps, setCheckSteps] = useState<ProgressStep[]>([]);
  const [checkRunning, setCheckRunning] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [checkDone, setCheckDone] = useState(false);

  const statusQuery = useQuery({
    queryKey: ["app", "settings", "tr069", "status"],
    queryFn: () => apiFetch<Tr069StatusResponse>("/app/settings/tr069/status"),
    refetchOnWindowFocus: false,
  });

  const data = statusQuery.data;
  const q = search.trim().toLowerCase();

  const filteredFaults = data?.faults ?? [];

  const filteredOnus = useMemo(() => {
    let rows = data?.onus ?? [];
    if (q) {
      rows = rows.filter((o) =>
        [
          o.deviceId,
          o.serial,
          o.oltName,
          o.model,
          o.description,
          o.ip,
          o.state,
          o.profileName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    return [...rows].sort((a, b) => {
      const av = (a.oltName ?? "").toLowerCase();
      const bv = (b.oltName ?? "").toLowerCase();
      const cmp = av.localeCompare(bv);
      return oltSortAsc ? cmp : -cmp;
    });
  }, [data?.onus, q, oltSortAsc]);

  const summary = data?.summary ?? {
    managedOnus: 0,
    onlineInformed: 0,
    notInformedRecently: 0,
    activeFaults: 0,
  };

  async function executeManualTest(
    onuId: string,
    steps: ProgressStep[],
    runners: Record<string, () => Promise<string | void>>,
  ) {
    setCheckRunning(true);
    setCheckFailed(false);
    setCheckDone(false);
    const result = await runProgressSteps(steps, setCheckSteps, runners);
    setCheckRunning(false);
    if (result.ok) {
      setCheckDone(true);
      setManualTests((prev) => ({
        ...prev,
        [onuId]: { status: "ok", message: "Todo OK" },
      }));
    } else {
      setCheckFailed(true);
      const failed = result.steps.find((s) => s.status === "error");
      setManualTests((prev) => ({
        ...prev,
        [onuId]: {
          status: "fail",
          message: failed?.detail || "Hay fallos",
        },
      }));
    }
  }

  /** Mismas pruebas que Check ONU, con el modal de progreso paso a paso. */
  function startManualTest(onuId: string, serial: string) {
    const pause = (ms: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, ms));

    const steps: ProgressStep[] = [
      {
        id: "run",
        label: "Consultando router del gateway y ACS",
        status: "pending",
      },
      { id: "arp", label: "ARP en el router del gateway", status: "pending" },
      {
        id: "connreq",
        label: "Credenciales de petición de conexión",
        status: "pending",
      },
      {
        id: "wan",
        label: "WAN TR-069 (IP, máscara, VLAN, NAT)",
        status: "pending",
      },
      {
        id: "traffic",
        label: "Tráfico / conexiones activas",
        status: "pending",
      },
      { id: "result", label: "Resultado final", status: "pending" },
    ];

    let detail: Record<string, unknown> = {};
    let status = "fail";

    const checkOf = (key: string) =>
      detail[key] as { ok?: boolean; message?: string } | undefined;

    const runners: Record<string, () => Promise<string | void>> = {
      run: async () => {
        const r = await apiFetch<{
          ok: boolean;
          verifyStatus: string;
          verifyDetail: Record<string, unknown>;
          message?: string;
        }>(`/app/onus/${onuId}/verify/run`, { method: "POST" });
        detail = r.verifyDetail ?? {};
        status = r.verifyStatus;
        const healed = detail.healed;
        return Array.isArray(healed) && healed.length
          ? `Pruebas hechas · curado: ${healed.join("; ")}`
          : "Pruebas hechas";
      },
      arp: async () => {
        await pause(350);
        const c = checkOf("arp");
        if (!c?.ok) throw new Error(c?.message || "ARP falló");
        return c.message || "ARP OK";
      },
      connreq: async () => {
        await pause(350);
        const c = checkOf("connreq");
        if (!c?.ok) throw new Error(c?.message || "Credenciales fallaron");
        return c.message || "Credenciales OK";
      },
      wan: async () => {
        await pause(350);
        const c = checkOf("wan");
        if (!c?.ok) throw new Error(c?.message || "WAN falló");
        return c.message || "WAN OK";
      },
      traffic: async () => {
        await pause(350);
        const c = checkOf("traffic");
        // Un cliente sin equipos encendidos no invalida el chequeo.
        if (status === "ok") {
          return c?.ok
            ? c.message || "Tráfico OK"
            : c?.message || "Sin tráfico (cliente idle)";
        }
        if (!c?.ok) throw new Error(c?.message || "Sin tráfico");
        return c.message || "Tráfico OK";
      },
      result: async () => {
        await pause(200);
        if (status !== "ok") throw new Error("La ONU no pasó el chequeo");
        return "Todo OK";
      },
    };

    setManualTests((prev) => ({
      ...prev,
      [onuId]: { status: "running", message: "Verificando…" },
    }));
    setCheckTitle(`Test manual · ${serial}`);
    setCheckSteps(steps);
    setCheckOpen(true);
    void executeManualTest(onuId, steps, runners);
  }

  return (
    <div className="space-y-4">
      {statusQuery.error && (
        <p className="text-sm text-[var(--danger)]">
          {statusQuery.error.message}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard value={summary.managedOnus} label="TR069-managed ONUs" />
        <KpiCard
          value={summary.onlineInformed}
          label="Online (informed < 60 min)"
        />
        <KpiCard
          value={summary.notInformedRecently}
          label="Not informed recently"
          emphasize="muted"
        />
        <KpiCard
          value={summary.activeFaults}
          label="Active faults"
          emphasize="danger"
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold">ACS / GenieACS health</h3>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs hover:bg-[var(--bg)] disabled:opacity-50"
            disabled={statusQuery.isFetching}
            onClick={() => void statusQuery.refetch()}
          >
            <span aria-hidden>↻</span>
            {statusQuery.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Profile</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">NBI endpoint</th>
                <th className="px-4 py-2 font-medium">Services</th>
                <th className="px-4 py-2 font-medium">Devices in ACS</th>
                <th className="px-4 py-2 font-medium">Faults</th>
              </tr>
            </thead>
            <tbody>
              {statusQuery.isLoading && (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-6 text-[var(--text-muted)]"
                  >
                    Cargando…
                  </td>
                </tr>
              )}
              {!statusQuery.isLoading &&
                (data?.acsHealth ?? []).length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-6 text-[var(--text-muted)]"
                    >
                      No hay perfiles TR069. Crea uno en la vista Profiles.
                    </td>
                  </tr>
                )}
              {(data?.acsHealth ?? []).map((row) => (
                <tr
                  key={row.profileId}
                  className="border-b border-[var(--border)] last:border-0"
                >
                  <td className="px-4 py-3 font-medium">{row.profileName}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {row.type}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">
                    {row.nbiEndpoint || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-3">
                      <ServiceBadge label="CWMP" status={row.services.cwmp} />
                      <ServiceBadge label="NBI" status={row.services.nbi} />
                      <ServiceBadge label="FS" status={row.services.fs} />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {row.devicesInAcs == null ? "—" : row.devicesInAcs}
                  </td>
                  <td className="px-4 py-3">{row.faults}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data?.refreshedAt && (
          <p className="border-t border-[var(--border)] px-4 py-2 text-xs text-[var(--text-muted)]">
            Actualizado {new Date(data.refreshedAt).toLocaleString()}
            {statusQuery.isFetching ? " · sondeando ACS…" : ""}
          </p>
        )}
      </section>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="flex items-center border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold">
            Active faults &amp; provisioning errors
          </h3>
          <CountBadge n={filteredFaults.length} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Profile</th>
                <th className="px-4 py-2 font-medium">Device</th>
                <th className="px-4 py-2 font-medium">Channel</th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Message</th>
                <th className="px-4 py-2 font-medium">Retries</th>
              </tr>
            </thead>
            <tbody>
              {filteredFaults.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-[var(--text-muted)]"
                  >
                    No active faults.
                  </td>
                </tr>
              ) : (
                filteredFaults.map((f, i) => (
                  <tr
                    key={`${f.when}-${f.code}-${i}`}
                    className="border-b border-[var(--border)] last:border-0"
                  >
                    <td className="px-4 py-2 text-xs">
                      {new Date(f.when).toLocaleString()}
                    </td>
                    <td className="px-4 py-2">{f.profileName}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {f.deviceId ?? "—"}
                    </td>
                    <td className="px-4 py-2">{f.channel}</td>
                    <td className="px-4 py-2 font-mono text-xs">{f.code}</td>
                    <td className="px-4 py-2">{f.message}</td>
                    <td className="px-4 py-2">{f.retries}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="relative">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]">
          ⌕
        </span>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search ONUs (serial, IP, description, OLT, model)..."
          className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] py-2.5 pl-9 pr-3 text-sm outline-none ring-[var(--accent)] focus:ring-2"
        />
      </div>

      <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)]">
        <div className="flex items-center border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold">TR069 ONU inventory</h3>
          <CountBadge n={filteredOnus.length} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th className="px-4 py-2 font-medium">Device ID</th>
                <th className="px-4 py-2 font-medium">Serial</th>
                <th className="px-4 py-2 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 hover:text-[var(--text)]"
                    onClick={() => setOltSortAsc((v) => !v)}
                  >
                    OLT
                    <span className="text-[10px]">
                      {oltSortAsc ? "▲" : "▼"}
                    </span>
                  </button>
                </th>
                <th className="px-4 py-2 font-medium">Model</th>
                <th className="px-4 py-2 font-medium">Description</th>
                <th className="px-4 py-2 font-medium">IP</th>
                <th className="px-4 py-2 font-medium">Last inform</th>
                <th className="px-4 py-2 font-medium">State</th>
                <th className="px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredOnus.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-8 text-center text-[var(--text-muted)]"
                  >
                    No TR069-managed ONUs found.
                  </td>
                </tr>
              ) : (
                filteredOnus.map((o) => {
                  const test = manualTests[o.onuId];
                  return (
                    <tr
                      key={o.deviceId}
                      className="border-b border-[var(--border)] last:border-0"
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        {o.deviceId}
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {o.serial ? (
                          <Link
                            to={`/app/settings?tab=onus&q=${encodeURIComponent(o.serial)}`}
                            className="text-[var(--accent)] hover:underline"
                            title="Ver en ONUs"
                          >
                            {o.serial}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-2">{o.oltName ?? "—"}</td>
                      <td className="px-4 py-2">{o.model ?? "—"}</td>
                      <td className="px-4 py-2">{o.description ?? "—"}</td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {o.ip ?? "—"}
                      </td>
                      <td className="px-4 py-2 text-xs">
                        {o.lastInform
                          ? new Date(o.lastInform).toLocaleString()
                          : "—"}
                      </td>
                      <td className="px-4 py-2">{o.state}</td>
                      <td className="px-4 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            disabled={checkRunning}
                            onClick={() => startManualTest(o.onuId, o.serial)}
                            className="rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
                          >
                            {test?.status === "running"
                              ? "Testing…"
                              : "Test manual"}
                          </button>
                          {test && test.status !== "running" ? (
                            <span
                              title={test.message}
                              className={
                                test.status === "ok"
                                  ? "text-xs text-emerald-400"
                                  : "text-xs text-[var(--danger)]"
                              }
                            >
                              {test.status === "ok" ? "Todo OK" : "Fail"}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <OperationProgressModal
        open={checkOpen}
        title={checkTitle}
        steps={checkSteps}
        running={checkRunning}
        failed={checkFailed}
        allDone={checkDone}
        doneLabel="Todo OK"
        failedLabel="Hay fallos — puedes reintentar el chequeo"
        onClose={() => {
          setCheckOpen(false);
          void statusQuery.refetch();
        }}
      >
        {checkDone ? (
          <div className="mx-5 mb-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
            Todo OK — la ONU pasó ARP, credenciales, WAN y tráfico.
          </div>
        ) : null}
      </OperationProgressModal>
    </div>
  );
}
