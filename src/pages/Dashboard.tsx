import { useState, useEffect, useRef } from 'react';
import {
  CheckCircle, XCircle, Shield, HardDrive, Play, Download, Loader2, Terminal as TerminalIcon
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getPipelines, saveRun, subscribeToRuns } from '../services/db';
import { runBackupSimulation } from '../services/simulator';
import { USE_MOCK } from '../services/firebase';
import type { Pipeline, Run } from '../types';

function formatBytes(b: number): string {
  if (b === 0) return '0 B';
  const k = 1000;
  const dm = 2;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ', ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

// ─── Storage Growth SVG Chart ────────────────────────────────────────────────

function StorageChart({ runs }: { runs: Run[] }) {
  const backupRuns = runs
    .filter(r => r.type === 'backup' && r.status === 'completed' && r.storageUsedBytes > 0)
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());

  const W = 900; const H = 160;
  const padL = 60; const padR = 24; const padT = 20; const padB = 30;

  if (backupRuns.length < 2) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, color: 'var(--text-muted)', fontSize: 13 }}>
        Not enough data to show a chart yet. Run a successful backup first!
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
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
  const areaPath = `M ${points[0].x},${H - padB} ` +
    points.map(p => `L ${p.x},${p.y}`).join(' ') +
    ` L ${points[points.length - 1].x},${H - padB} Z`;

  const yTicks = [minS, (minS + maxS) / 2, maxS].map(v => ({ label: formatBytes(v), y: yScale(v) }));

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ overflow: 'visible' }}>
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
          {new Date(r.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </text>
      ))}
    </svg>
  );
}

// ─── Terminal Log Component ──────────────────────────────────────────────────

function Terminal({ run }: { run: Run | null }) {
  const terminalEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Scroll terminal to bottom when logs update
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
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

  const formatLogTime = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  };

  return (
    <div className="run-terminal card-elevated" style={{ height: 320, display: 'flex', flexDirection: 'column' }}>
      <div className="run-terminal-topbar">
        <div className="terminal-dots">
          <span className="terminal-dot red" />
          <span className="terminal-dot yellow" />
          <span className="terminal-dot green" />
        </div>
        <div className="terminal-tab-row">
          <span className="terminal-tab" style={{ marginLeft: 8 }}>
            run_id: {run.id} ({run.type === 'backup' ? 'Backup' : 'Restore Check'})
          </span>
          {run.status === 'running' ? (
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
            <span className="terminal-ts">{formatLogTime(log.timestamp)}</span>
            <span className={`terminal-level ${log.level}`}>
              [{log.level.toUpperCase()}]
            </span>
            <span className={`terminal-msg ${log.level}`}>
              {log.message}
            </span>
          </div>
        ))}
        {run.status === 'running' && (
          <div className="terminal-line" style={{ display: 'flex', alignItems: 'center' }}>
            <span className="terminal-spinner" style={{ marginRight: 6 }} />
            <span className="terminal-msg info" style={{ color: 'var(--text-muted)' }}>
              Executing backend tasks...
              <span className="terminal-cursor" />
            </span>
          </div>
        )}
        <div ref={terminalEndRef} />
      </div>
    </div>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { user } = useAuth();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [runningBackup, setRunningBackup] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  // Set up real-time listener for runs
  useEffect(() => {
    if (!user) return;

    setDataLoading(true);
    getPipelines(user.uid).then((pipelines) => {
      if (pipelines.length === 0) {
        setDataLoading(false);
        return;
      }
      const p = pipelines[0];
      setPipeline(p);

      // Subscribe to real-time updates
      const unsubscribe = subscribeToRuns(p.id, (updatedRuns) => {
        setRuns(updatedRuns);
        setDataLoading(false);

        // If there's an active run, make sure it's selected in the terminal
        const activeRun = updatedRuns.find(r => r.status === 'running');
        if (activeRun) {
          setSelectedRunId(activeRun.id);
        } else if (updatedRuns.length > 0 && !selectedRunId) {
          // Default selection to the latest run if none is selected
          setSelectedRunId(updatedRuns[0].id);
        }
      });

      return unsubscribe;
    }).catch((err) => {
      console.error('Error fetching pipelines:', err);
      setDataLoading(false);
    });
  }, [user]);

  // Derive stats
  const lastBackup = runs.find(r => r.type === 'backup');
  const lastRestore = runs.find(r => r.type === 'restore_check');
  const latestSuccess = runs.find(r => r.type === 'backup' && r.status === 'completed');
  const totalStorage = latestSuccess?.storageUsedBytes ?? 0;

  // Selected run for the terminal component
  const selectedRun = runs.find(r => r.id === selectedRunId) || null;

  async function handleRunNow() {
    if (!pipeline || runningBackup) return;
    setRunningBackup(true);

    const startedAt = new Date().toISOString();
    const newRun = await saveRun({
      pipelineId: pipeline.id,
      type: 'backup',
      status: 'running',
      startedAt,
      storageUsedBytes: 0,
      logs: [
        {
          timestamp: startedAt,
          level: 'info',
          message: 'Pipeline triggered manually.',
        }
      ]
    });

    setSelectedRunId(newRun.id);

    if (USE_MOCK) {
      // Run simulation in background
      runBackupSimulation(pipeline, newRun.id).finally(() => {
        setRunningBackup(false);
      });
    } else {
      // Production backend will update runs, disable local spinner
      setRunningBackup(false);
    }
  }

  return (
    <div className="main-content animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <button
          id="run-backup-now-btn"
          className="btn btn-dark"
          onClick={handleRunNow}
          disabled={runningBackup || dataLoading}
        >
          {runningBackup
            ? <><Loader2 size={16} style={{ animation: 'spin 0.7s linear infinite' }} /> Running…</>
            : <><Play size={15} /> Run backup now</>}
        </button>
      </div>

      {dataLoading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <div className="spinner spinner-blue" style={{ width: 28, height: 28, borderWidth: 3 }} />
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="stat-cards-row">
            {/* Last Backup */}
            <div className="stat-card">
              <div className="stat-card-label">Last backup</div>
              <div className="stat-card-value">
                {lastBackup ? (
                  lastBackup.status === 'running' ? (
                    <><Loader2 size={20} style={{ animation: 'spin 0.7s linear infinite' }} /> Running</>
                  ) : lastBackup.status === 'completed' ? (
                    <><CheckCircle size={20} color="var(--accent-green)" /> Succeeded</>
                  ) : (
                    <><XCircle size={20} color="var(--accent-red)" /> Failed</>
                  )
                ) : '—'}
              </div>
              <div className="stat-card-meta">
                {lastBackup ? timeAgo(lastBackup.startedAt) : 'No backups yet'}
              </div>
            </div>

            {/* Restore check — most prominent */}
            <div className="stat-card restore-check">
              <div className="stat-card-label">Restore check</div>
              <div className="stat-card-value">
                {lastRestore ? (
                  lastRestore.status === 'completed' ? (
                    <><Shield size={22} /> Verified</>
                  ) : lastRestore.status === 'failed' ? (
                    <><XCircle size={22} /> Failed</>
                  ) : (
                    <><Loader2 size={22} style={{ animation: 'spin 0.7s linear infinite' }} /> Running</>
                  )
                ) : '—'}
              </div>
              <div className="stat-card-meta">
                {lastRestore ? timeAgo(lastRestore.startedAt) : 'Not yet run'}
              </div>
            </div>

            {/* Storage used */}
            <div className="stat-card">
              <div className="stat-card-label">Storage used</div>
              <div className="stat-card-value">
                <HardDrive size={20} color="var(--text-muted)" />
                {formatBytes(totalStorage)}
              </div>
              <div className="stat-card-meta">
                {pipeline
                  ? pipeline.storage_type === 'r2' ? 'Cloudflare R2' : 'AWS S3'
                  : '—'}
              </div>
            </div>
          </div>

          {/* Storage chart */}
          <div className="chart-card">
            <div className="chart-label">Storage growth</div>
            <div className="chart-container">
              <StorageChart runs={runs} />
            </div>
          </div>

          {/* Real-time terminal log viewer & Run log */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>
            {/* Run log Table */}
            <div className="run-log-card">
              <div className="run-log-header flex items-center justify-between">
                <span>Run log</span>
              </div>
              {runs.length === 0 ? (
                <div className="empty-state" style={{ height: 270 }}>
                  <div className="empty-state-icon"><Play size={24} /></div>
                  <div>No runs yet. Click "Run backup now" to trigger the first one.</div>
                </div>
              ) : (
                <div style={{ maxHeight: 270, overflowY: 'auto' }}>
                  <table className="run-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th style={{ textAlign: 'right' }}>↓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {runs.map(run => (
                        <tr
                          key={run.id}
                          className={`${run.status === 'running' ? 'running-row' : ''} ${selectedRunId === run.id ? 'selected-row' : ''}`}
                          onClick={() => setSelectedRunId(run.id)}
                        >
                          <td>{formatDate(run.startedAt)}</td>
                          <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                            {run.type === 'backup' ? 'Backup' : 'Restore check'}
                          </td>
                          <td>
                            {run.status === 'running' && (
                              <span className="badge badge-running animate-pulse">
                                <Loader2 size={11} style={{ animation: 'spin 0.7s linear infinite' }} /> Running
                              </span>
                            )}
                            {run.status === 'completed' && (
                              <span style={{ color: 'var(--accent-green)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <CheckCircle size={14} /> {run.type === 'restore_check' ? 'Verified' : 'Success'}
                              </span>
                            )}
                            {run.status === 'failed' && (
                              <span style={{ color: 'var(--accent-red)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 5 }}>
                                <XCircle size={14} /> Failed
                              </span>
                            )}
                          </td>
                          <td style={{ textAlign: 'right' }} onClick={e => e.stopPropagation()}>
                            <button
                              className="run-download-btn"
                              disabled={run.status !== 'completed' || !run.storageUsedBytes}
                              title={run.status === 'completed' ? 'Download backup' : 'Not available'}
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

            {/* Terminal console */}
            <Terminal run={selectedRun} />
          </div>
        </>
      )}
    </div>
  );
}
