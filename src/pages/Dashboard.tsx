import { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckCircle, XCircle, Shield, HardDrive, Play, Download,
  Loader2, Terminal as TerminalIcon, Database, Cloud, Settings,
  Clock, LayoutDashboard
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { subscribeToPipelines, subscribeToRuns, saveRun } from "../services/db";
import type { Pipeline, Run } from "../types";

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const k = 1000;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    ", " +
    d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
  );
}

function scheduleLabel(s: string): string {
  if (s === "hourly") return "Hourly";
  if (s === "12h") return "Every 12h";
  return "Daily";
}

// ─── Storage Growth SVG Chart ────────────────────────────────────────────────

function StorageChart({ runs }: { runs: Run[] }) {
  const backupRuns = runs
    .filter(r => r.type === "backup" && r.status === "completed" && r.storageUsedBytes > 0)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  const W = 900; const H = 160;
  const padL = 60; const padR = 24; const padT = 20; const padB = 30;

  if (backupRuns.length < 2) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 160, color: "var(--text-muted)", fontSize: 13 }}>
        Not enough data yet. Run a successful backup first!
      </div>
    );
  }

  const sizes = backupRuns.map(r => r.storageUsedBytes);
  const minS = Math.min(...sizes) * 0.9;
  const maxS = Math.max(...sizes) * 1.05;
  const times = backupRuns.map(r => new Date(r.startedAt).getTime());
  const minT = times[0]; const maxT = times[times.length - 1];

  const xScale = (t: number) => padL + ((t - minT) / (maxT - minT || 1)) * (W - padL - padR);
  const yScale = (s: number) => padT + (1 - (s - minS) / (maxS - minS || 1)) * (H - padT - padB);

  const points = backupRuns.map((r, i) => ({ x: xScale(times[i]), y: yScale(r.storageUsedBytes) }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(" ");
  const areaPath =
    `M ${points[0].x},${H - padB} ` +
    points.map(p => `L ${p.x},${p.y}`).join(" ") +
    ` L ${points[points.length - 1].x},${H - padB} Z`;
  const yTicks = [minS, (minS + maxS) / 2, maxS].map(v => ({ label: formatBytes(v), y: yScale(v) }));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: "visible" }}>
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-blue)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--accent-blue)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={t.y} x2={W - padR} y2={t.y} stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={padL - 6} y={t.y + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">{t.label}</text>
        </g>
      ))}
      <path d={areaPath} fill="url(#chartGrad)" />
      <polyline points={polyline} fill="none" stroke="var(--accent-blue)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="4" fill="var(--accent-blue)" stroke="var(--bg-surface)" strokeWidth="2" />
      ))}
      {backupRuns.map((r, i) => (
        <text key={i} x={points[i].x} y={H - padB + 18} textAnchor="middle" fontSize="10" fill="var(--text-muted)">
          {new Date(r.startedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
        </text>
      ))}
    </svg>
  );
}

// ─── Terminal Log Component ──────────────────────────────────────────────────

function Terminal({ run }: { run: Run | null }) {
  const terminalEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [run?.logs?.length]);

  if (!run) {
    return (
      <div className="run-terminal card-elevated" style={{ height: 320 }}>
        <div className="run-terminal-topbar">
          <div className="terminal-dots">
            <span className="terminal-dot red" />
            <span className="terminal-dot yellow" />
            <span className="terminal-dot green" />
          </div>
          <span className="terminal-tab">Console Output</span>
        </div>
        <div className="terminal-no-selection">
          <TerminalIcon size={24} style={{ opacity: 0.4 }} />
          Select a run from the log table to view console output
        </div>
      </div>
    );
  }

  const fmtTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }) + "." + String(d.getMilliseconds()).padStart(3, "0");
  };

  return (
    <div className="run-terminal card-elevated" style={{ height: 320, display: "flex", flexDirection: "column" }}>
      <div className="run-terminal-topbar">
        <div className="terminal-dots">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
        </div>
        <div className="terminal-tab-row">
          <span className="terminal-tab" style={{ marginLeft: 8 }}>
            run_id: {run.id} ({run.type === "backup" ? "Backup" : "Restore Check"})
          </span>
          {run.status === "running" ? (
            <span className="terminal-live-badge" style={{ marginRight: 8 }}>
              <span className="terminal-live-dot" /> LIVE STREAM
            </span>
          ) : (
            <span className="terminal-done-badge" style={{ marginRight: 8 }}>
              STATUS: {run.status.toUpperCase()}
            </span>
          )}
        </div>
      </div>
      <div className="run-terminal-body">
        {(!run.logs || run.logs.length === 0) && (
          <div className="terminal-empty">
            <span className="terminal-spinner" />
            Initializing stream...
          </div>
        )}
        {run.logs?.map((log, index) => (
          <div key={index} className="terminal-line">
            <span className="terminal-ts">{fmtTime(log.timestamp)}</span>
            <span className={`terminal-level ${log.level}`}>[{log.level.toUpperCase()}]</span>
            <span className={`terminal-msg ${log.level}`}>{log.message}</span>
          </div>
        ))}
        {run.status === "running" && (
          <div className="terminal-line" style={{ display: "flex", alignItems: "center" }}>
            <span className="terminal-spinner" style={{ marginRight: 6 }} />
            <span className="terminal-msg info" style={{ color: "var(--text-muted)" }}>
              Executing backend tasks...<span className="terminal-cursor" />
            </span>
          </div>
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}

// ─── Status Badge ────────────────────────────────────────────────────────────

function StatusBadge({ runs, loading }: { runs: Run[]; loading: boolean }) {
  if (loading) return <span className="pipeline-badge badge-idle">…</span>;
  const activeRun = runs.find(r => r.status === "running");
  if (activeRun) return (
    <span className="pipeline-badge badge-running-status animate-pulse">
      <Loader2 size={10} style={{ animation: "spin 0.7s linear infinite" }} /> Running
    </span>
  );
  const last = runs.find(r => r.type === "backup");
  if (!last) return <span className="pipeline-badge badge-idle">Never run</span>;
  if (last.status === "completed") return <span className="pipeline-badge badge-ok"><CheckCircle size={10} /> Healthy</span>;
  return <span className="pipeline-badge badge-error"><XCircle size={10} /> Failed</span>;
}

// ─── Pipeline Row ────────────────────────────────────────────────────────────

function PipelineRow({
  pipeline, runs, runsLoading, isSelected, onSelect, onRunNow, runningNow, onSettings,
}: {
  pipeline: Pipeline; runs: Run[]; runsLoading: boolean;
  isSelected: boolean; onSelect: () => void;
  onRunNow: () => void; runningNow: boolean; onSettings: () => void;
}) {
  const lastBackup = runs.find(r => r.type === "backup");
  return (
    <div className={`pipeline-row${isSelected ? " pipeline-row-selected" : ""}`} onClick={onSelect}>
      <div className="pipeline-row-left">
        <div className="pipeline-row-icon"><Database size={16} color="var(--accent-blue)" /></div>
        <div>
          <div className="pipeline-row-name">{pipeline.name || `Pipeline ${pipeline.id.slice(-4)}`}</div>
          <div className="pipeline-row-meta">
            <Cloud size={11} />
            {pipeline.storage_type === "r2" ? "Cloudflare R2" : "AWS S3"} · {pipeline.storage_credentials?.bucket || "—"}
            <span className="pipeline-row-sep">·</span>
            <Clock size={11} />
            {scheduleLabel(pipeline.schedule)}
          </div>
        </div>
      </div>
      <div className="pipeline-row-time">
        {lastBackup
          ? <><span style={{ color: "var(--text-secondary)" }}>Last run:</span> {timeAgo(lastBackup.startedAt)}</>
          : <span style={{ color: "var(--text-muted)" }}>Never run</span>
        }
      </div>
      <div className="pipeline-row-right" onClick={e => e.stopPropagation()}>
        <StatusBadge runs={runs} loading={runsLoading} />
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: "5px 12px", gap: 5 }}
          onClick={onRunNow}
          disabled={runningNow || pipeline.status === "inactive"}
          title={pipeline.status === "inactive" ? "Pipeline is inactive" : "Run backup now"}
        >
          {runningNow
            ? <><Loader2 size={12} style={{ animation: "spin 0.7s linear infinite" }} /> Running…</>
            : <><Play size={12} /> Run now</>}
        </button>
        <button
          className="btn btn-ghost"
          style={{ fontSize: 12, padding: "5px 10px" }}
          onClick={onSettings}
          title="Pipeline settings"
        >
          <Settings size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [runsMap, setRunsMap] = useState<Record<string, Run[]>>({});
  const [runsLoadingMap, setRunsLoadingMap] = useState<Record<string, boolean>>({});
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);
  const [runningMap, setRunningMap] = useState<Record<string, boolean>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const runUnsubs = useRef<Record<string, () => void>>({});

  useEffect(() => {
    if (!user) return;
    setPipelinesLoading(true);

    const unsub = subscribeToPipelines(user.uid, (updated) => {
      setPipelines(updated);
      setPipelinesLoading(false);

      setSelectedPipelineId(prev => {
        if (prev && updated.find(p => p.id === prev)) return prev;
        return updated[0]?.id ?? null;
      });

      updated.forEach(p => {
        if (!runUnsubs.current[p.id]) {
          setRunsLoadingMap(prev => ({ ...prev, [p.id]: true }));
          const u = subscribeToRuns(p.id, (runs) => {
            setRunsMap(prev => ({ ...prev, [p.id]: runs }));
            setRunsLoadingMap(prev => ({ ...prev, [p.id]: false }));
            const active = runs.find(r => r.status === "running");
            if (active) setSelectedRunId(active.id);
          });
          runUnsubs.current[p.id] = u;
        }
      });
    });

    return () => {
      unsub();
      Object.values(runUnsubs.current).forEach(u => u());
      runUnsubs.current = {};
    };
  }, [user]);

  useEffect(() => {
    if (!selectedPipelineId) return;
    const runs = runsMap[selectedPipelineId] ?? [];
    setSelectedRunId(runs[0]?.id ?? null);
  }, [selectedPipelineId]);

  const handleRunNow = useCallback(async (pipeline: Pipeline) => {
    if (runningMap[pipeline.id]) return;
    setRunningMap(prev => ({ ...prev, [pipeline.id]: true }));
    setSelectedPipelineId(pipeline.id);
    const startedAt = new Date().toISOString();
    const newRun = await saveRun({
      pipelineId: pipeline.id,
      type: "backup",
      status: "running",
      startedAt,
      storageUsedBytes: 0,
      logs: [{ timestamp: startedAt, level: "info", message: "Pipeline triggered manually." }],
    });
    setSelectedRunId(newRun.id);
    setRunningMap(prev => ({ ...prev, [pipeline.id]: false }));
  }, [runningMap]);

  const selectedPipeline = pipelines.find(p => p.id === selectedPipelineId) ?? null;
  const selectedRuns = selectedPipelineId ? (runsMap[selectedPipelineId] ?? []) : [];
  const selectedRun = selectedRuns.find(r => r.id === selectedRunId) ?? null;
  const lastBackupRun = selectedRuns.find(r => r.type === "backup");
  const lastRestoreRun = selectedRuns.find(r => r.type === "restore_check");
  const latestSuccess = selectedRuns.find(r => r.type === "backup" && r.status === "completed");
  const totalStorage = latestSuccess?.storageUsedBytes ?? 0;

  return (
    <div className="main-content animate-fade-in">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
      </div>

      {/* Pipeline list card */}
      <div className="card" style={{ marginBottom: "var(--space-6)", overflow: "hidden", padding: 0 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "var(--space-4) var(--space-5)",
          borderBottom: "1px solid var(--border-subtle)",
        }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
            <LayoutDashboard size={14} /> Pipelines
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {pipelines.length} pipeline{pipelines.length !== 1 ? "s" : ""}
          </span>
        </div>

        {pipelinesLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-8)" }}>
            <div className="spinner spinner-blue" style={{ width: 24, height: 24, borderWidth: 2 }} />
          </div>
        ) : pipelines.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Database size={26} /></div>
            <div>
              <div style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>No active backups yet</div>
              <div style={{ fontSize: 13 }}>Create your first pipeline to start protecting your data.</div>
            </div>
            <button
              className="btn btn-dark"
              style={{ marginTop: 4 }}
              onClick={() => window.dispatchEvent(new CustomEvent("show-toast", { detail: "Use the Onboarding Wizard to create a pipeline!" }))}
            >
              <Play size={14} /> Create your first pipeline
            </button>
          </div>
        ) : (
          <div className="pipeline-list">
            {pipelines.map(p => (
              <PipelineRow
                key={p.id}
                pipeline={p}
                runs={runsMap[p.id] ?? []}
                runsLoading={runsLoadingMap[p.id] ?? true}
                isSelected={selectedPipelineId === p.id}
                onSelect={() => setSelectedPipelineId(p.id)}
                onRunNow={() => handleRunNow(p)}
                runningNow={!!runningMap[p.id]}
                onSettings={() => window.dispatchEvent(new CustomEvent("navigate-pipelines"))}
              />
            ))}
          </div>
        )}
      </div>

      {/* Detail section for selected pipeline */}
      {selectedPipeline && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)", marginBottom: "var(--space-4)", display: "flex", alignItems: "center", gap: 6 }}>
            <Database size={13} /> {selectedPipeline.name || `Pipeline ${selectedPipeline.id.slice(-4)}`}
          </div>

          <div className="stat-cards-row">
            <div className="stat-card">
              <div className="stat-card-label">Last backup</div>
              <div className="stat-card-value">
                {lastBackupRun ? (
                  lastBackupRun.status === "running"
                    ? <><Loader2 size={20} style={{ animation: "spin 0.7s linear infinite" }} /> Running</>
                    : lastBackupRun.status === "completed"
                    ? <><CheckCircle size={20} color="var(--accent-green)" /> Succeeded</>
                    : <><XCircle size={20} color="var(--accent-red)" /> Failed</>
                ) : "—"}
              </div>
              <div className="stat-card-meta">{lastBackupRun ? timeAgo(lastBackupRun.startedAt) : "No backups yet"}</div>
            </div>

            <div className="stat-card restore-check">
              <div className="stat-card-label">Restore check</div>
              <div className="stat-card-value">
                {lastRestoreRun ? (
                  lastRestoreRun.status === "completed"
                    ? <><Shield size={22} /> Verified</>
                    : lastRestoreRun.status === "failed"
                    ? <><XCircle size={22} /> Failed</>
                    : <><Loader2 size={22} style={{ animation: "spin 0.7s linear infinite" }} /> Running</>
                ) : "—"}
              </div>
              <div className="stat-card-meta">{lastRestoreRun ? timeAgo(lastRestoreRun.startedAt) : "Not yet run"}</div>
            </div>

            <div className="stat-card">
              <div className="stat-card-label">Storage used</div>
              <div className="stat-card-value">
                <HardDrive size={20} color="var(--text-muted)" />
                {formatBytes(totalStorage)}
              </div>
              <div className="stat-card-meta">{selectedPipeline.storage_type === "r2" ? "Cloudflare R2" : "AWS S3"}</div>
            </div>
          </div>

          <div className="chart-card">
            <div className="chart-label">Storage growth</div>
            <div className="chart-container"><StorageChart runs={selectedRuns} /></div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-6)", alignItems: "start" }}>
            <div className="run-log-card">
              <div className="run-log-header flex items-center justify-between">
                <span>Run log</span>
              </div>
              {selectedRuns.length === 0 ? (
                <div className="empty-state" style={{ height: 270 }}>
                  <div className="empty-state-icon"><Play size={24} /></div>
                  <div>No runs yet. Click "Run now" to trigger the first backup.</div>
                </div>
              ) : (
                <div style={{ maxHeight: 270, overflowY: "auto" }}>
                  <table className="run-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th style={{ textAlign: "right" }}>↓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedRuns.map(run => (
                        <tr
                          key={run.id}
                          className={`${run.status === "running" ? "running-row" : ""} ${selectedRunId === run.id ? "selected-row" : ""}`}
                          onClick={() => setSelectedRunId(run.id)}
                        >
                          <td>{formatDate(run.startedAt)}</td>
                          <td style={{ fontWeight: 500, color: "var(--text-primary)" }}>
                            {run.type === "backup" ? "Backup" : "Restore check"}
                          </td>
                          <td>
                            {run.status === "running" && (
                              <span className="badge badge-running animate-pulse">
                                <Loader2 size={11} style={{ animation: "spin 0.7s linear infinite" }} /> Running
                              </span>
                            )}
                            {run.status === "completed" && (
                              <span style={{ color: "var(--accent-green)", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
                                <CheckCircle size={14} /> {run.type === "restore_check" ? "Verified" : "Success"}
                              </span>
                            )}
                            {run.status === "failed" && (
                              <span style={{ color: "var(--accent-red)", fontWeight: 500, display: "flex", alignItems: "center", gap: 5 }}>
                                <XCircle size={14} /> Failed
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: "right" }} onClick={e => e.stopPropagation()}>
                            <button
                              className="run-download-btn"
                              disabled={run.status !== "completed" || !run.storageUsedBytes}
                              title={run.status === "completed" ? "Download backup" : "Not available"}
                              onClick={() => alert(`In production, this would download the backup for run: ${run.id}`)}
                            >
                              <Download size={16} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <Terminal run={selectedRun} />
          </div>
        </>
      )}
    </div>
  );
}
