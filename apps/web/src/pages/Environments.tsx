import { useState, useMemo } from 'react';
import {
  Server, Copy, Trash2, CheckCircle, AlertTriangle, Loader2,
  Shield, Download, FileText, X, GitBranch
} from 'lucide-react';
import type { EphemeralEnvironment, AuditLogEntry } from '../types';

// ─── Mock data ────────────────────────────────────────────────────────────────

const MOCK_ENVS: EphemeralEnvironment[] = [
  {
    id: 'env-1',
    prNumber: 142,
    prTitle: 'feat: add billing flow & subscription tiers',
    branchName: 'feat/add-billing-flow',
    status: 'active',
    dbSizeMb: 140,
    samplePercent: 5,
    connectionString: 'postgresql://neon_branch_abc123:secret@ep-cool-pond-123.us-east-2.aws.neon.tech/envshield_pr142',
    createdAt: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
    neonBranchId: 'br-morning-wood-abc123',
  },
  {
    id: 'env-2',
    prNumber: 139,
    prTitle: 'fix: HMAC key rotation on sync pipeline',
    branchName: 'fix/hmac-key-rotation',
    status: 'active',
    dbSizeMb: 98,
    samplePercent: 5,
    connectionString: 'postgresql://neon_branch_def456:secret@ep-snowy-hill-456.us-east-2.aws.neon.tech/envshield_pr139',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
    neonBranchId: 'br-snowy-hill-def456',
  },
  {
    id: 'env-3',
    prNumber: 137,
    prTitle: 'chore: upgrade pg driver and schema introspection',
    branchName: 'chore/upgrade-pg-driver',
    status: 'building',
    dbSizeMb: 0,
    samplePercent: 5,
    connectionString: '',
    createdAt: new Date(Date.now() - 1000 * 60 * 3).toISOString(),
    neonBranchId: 'br-new-meadow-ghi789',
  },
  {
    id: 'env-4',
    prNumber: 131,
    prTitle: 'feat: ephemeral DB teardown webhook',
    branchName: 'feat/teardown-webhook',
    status: 'closed',
    dbSizeMb: 112,
    samplePercent: 5,
    connectionString: '',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
    neonBranchId: 'br-old-fog-jkl012',
  },
];

// Simulated HMAC-SHA256 hashes for audit entries
const MOCK_AUDIT: AuditLogEntry[] = [
  {
    id: 'alog-1',
    projectId: 'proj-abc',
    environmentName: 'pr-142-billing-flow',
    rowsProcessed: 48732,
    status: 'success',
    executionHash: 'sha256:3a7bd3e2360a3d29eea436fcfb7e44c735d117c144d382674c83f4f3da9fbacf',
    createdAt: new Date(Date.now() - 1000 * 60 * 34).toISOString(),
  },
  {
    id: 'alog-2',
    projectId: 'proj-abc',
    environmentName: 'pr-139-hmac-rotation',
    rowsProcessed: 31204,
    status: 'success',
    executionHash: 'sha256:9c1185a5c5e9fc54612808977ee8f548b2258d31f54f65e11b5fc76e90f2c3aa',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: 'alog-3',
    projectId: 'proj-abc',
    environmentName: 'pr-131-teardown-webhook',
    rowsProcessed: 51890,
    status: 'success',
    executionHash: 'sha256:f58c03cfeef8a54f91c5d3b1a2e7ae4d9b802c1d5e6f7a8b9c0d1e2f3a4b5c6',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 18).toISOString(),
  },
  {
    id: 'alog-4',
    projectId: 'proj-abc',
    environmentName: 'pr-128-schema-migration',
    rowsProcessed: 0,
    status: 'failed',
    executionHash: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 36).toISOString(),
  },
  {
    id: 'alog-5',
    projectId: 'proj-abc',
    environmentName: 'pr-125-auth-refactor',
    rowsProcessed: 62415,
    status: 'success',
    executionHash: 'sha256:a3c1e5g7i9k1m3o5q7s9u1w3y5a7c9e1g3i5k7m9o1q3s5u7w9y1a3c5e7g9i1',
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString(),
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
    ', ' +
    d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
  );
}

function formatRows(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function copyToClipboard(text: string, label = 'Copied!') {
  navigator.clipboard.writeText(text).then(() => {
    window.dispatchEvent(new CustomEvent('show-toast', { detail: label }));
  });
}

// ─── Env Status Badge ─────────────────────────────────────────────────────────

function EnvBadge({ status }: { status: EphemeralEnvironment['status'] }) {
  const labels: Record<EphemeralEnvironment['status'], string> = {
    active:   'ACTIVE — NEON BRANCH',
    building: 'BUILDING...',
    teardown: 'TEARDOWN',
    closed:   'CLOSED',
  };
  return (
    <span className={`env-badge ${status}`}>
      {status === 'building' && <Loader2 size={10} style={{ animation: 'spin 0.7s linear infinite' }} />}
      {labels[status]}
    </span>
  );
}

// ─── Teardown Confirm Modal ───────────────────────────────────────────────────

function TeardownModal({
  env, onConfirm, onCancel,
}: {
  env: EphemeralEnvironment;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title" style={{ color: 'var(--accent-red)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Trash2 size={18} /> Teardown Environment?
        </div>
        <div className="modal-body">
          This will permanently delete the Neon branch{' '}
          <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-blue)' }}>
            {env.neonBranchId}
          </code>{' '}
          for <strong>PR #{env.prNumber}</strong>. The database and all its data will be destroyed immediately.
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>
            <Trash2 size={13} /> Teardown Now
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── SOC2 Compliance Report Modal ────────────────────────────────────────────

function ComplianceReportModal({
  logs, onClose
}: {
  logs: AuditLogEntry[];
  onClose: () => void;
}) {
  const successLogs = logs.filter(l => l.status === 'success');
  const totalRows   = logs.reduce((s, l) => s + l.rowsProcessed, 0);
  const reportDate  = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // Simple bar chart data (last 5 runs by rows processed)
  const barData = [...logs].slice(0, 5).reverse();
  const maxRows = Math.max(...barData.map(l => l.rowsProcessed), 1);

  // Deterministic signature stub (in production this is server-signed)
  const reportHash = `sha256:${logs.map(l => l.executionHash).join('').slice(7, 71)}`;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box-wide" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'var(--accent-indigo-bg)', border: '1px solid var(--accent-indigo-border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <FileText size={18} color="var(--accent-indigo)" />
            </div>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>SOC2 Compliance Report</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Generated {reportDate}</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm no-print" style={{ padding: '6px 10px' }} onClick={onClose}>
            <X size={14} />
          </button>
        </div>

        {/* Print zone */}
        <div className="print-report">
          {/* Summary section */}
          <div className="report-section">
            <div className="report-section-title">
              <Shield size={12} /> Executive Summary
            </div>
            <table className="report-kv-table">
              <tbody>
                <tr><td>Organization</td><td>EnvShield — Production Environment</td></tr>
                <tr><td>Report Period</td><td>Last 30 days</td></tr>
                <tr><td>Generated On</td><td>{reportDate}</td></tr>
                <tr><td>Total Sync Runs</td><td>{logs.length}</td></tr>
                <tr><td>Successful Runs</td><td>{successLogs.length} / {logs.length}</td></tr>
                <tr><td>Total Rows Masked</td><td>{formatRows(totalRows)} records</td></tr>
                <tr>
                  <td>PII Leakage Status</td>
                  <td>
                    <span className="verified-badge">
                      <CheckCircle size={12} /> ZERO PII — VERIFIED
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Architecture</td>
                  <td>Zero-Data Retention (ZDR) — Data never leaves customer infrastructure</td>
                </tr>
                <tr><td>Compliance Frameworks</td><td>SOC2 Type II · GDPR · HIPAA-ready</td></tr>
              </tbody>
            </table>
          </div>

          {/* Masked records chart */}
          <div className="report-section">
            <div className="report-section-title">
              <Shield size={12} /> Masked Records per Run
            </div>
            <div className="masked-bar-chart-row">
              {barData.map(l => (
                <div key={l.id} className="masked-bar-item">
                  <div
                    className="masked-bar"
                    title={`${formatRows(l.rowsProcessed)} rows`}
                    style={{ height: `${Math.max((l.rowsProcessed / maxRows) * 72, 4)}px` }}
                  />
                  <span className="masked-bar-label">{`PR ${l.environmentName.match(/pr-(\d+)/)?.[1] ?? '?'}`}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Run log table */}
          <div className="report-section">
            <div className="report-section-title">
              <FileText size={12} /> Audit Run Log
            </div>
            <div className="audit-table-wrapper">
              <table className="audit-table" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Environment</th>
                    <th>Rows Masked</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map(l => (
                    <tr key={l.id}>
                      <td>{formatDate(l.createdAt)}</td>
                      <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{l.environmentName}</td>
                      <td style={{ fontFamily: 'var(--font-mono)' }}>{formatRows(l.rowsProcessed)}</td>
                      <td>
                        {l.status === 'success' ? (
                          <span style={{ color: 'var(--accent-green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                            <CheckCircle size={12} /> SUCCESS
                          </span>
                        ) : (
                          <span style={{ color: 'var(--accent-red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
                            <AlertTriangle size={12} /> FAILED
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Cryptographic signature */}
          <div className="report-section">
            <div className="report-section-title">
              <Shield size={12} /> Cryptographic Execution Signature
            </div>
            <div className="hash-display">
              <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: 4, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Composite SHA-256 Report Hash
              </span>
              {reportHash}
            </div>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>
              This hash is a deterministic composite of all individual run execution hashes. It can be used to cryptographically verify that this report has not been tampered with after generation.
            </p>
          </div>
        </div>

        {/* Footer actions */}
        <div className="no-print" style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 'var(--space-6)', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button
            id="export-soc2-pdf"
            className="btn btn-indigo"
            onClick={() => window.print()}
          >
            <Download size={14} /> Export PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Environments Page ───────────────────────────────────────────────────

export default function Environments() {
  const [envs, setEnvs]                 = useState<EphemeralEnvironment[]>(MOCK_ENVS);
  const [teardownTarget, setTeardownTarget] = useState<EphemeralEnvironment | null>(null);
  const [tearing, setTearing]           = useState<Record<string, boolean>>({});
  const [showReport, setShowReport]     = useState(false);

  const activeCount   = useMemo(() => envs.filter(e => e.status === 'active').length, [envs]);
  const buildingCount = useMemo(() => envs.filter(e => e.status === 'building').length, [envs]);

  async function handleTeardown(env: EphemeralEnvironment) {
    setTeardownTarget(null);
    setTearing(prev => ({ ...prev, [env.id]: true }));

    // Simulated teardown — replace with real API call
    await new Promise(r => setTimeout(r, 1200));

    setEnvs(prev => prev.map(e => e.id === env.id ? { ...e, status: 'closed' } : e));
    setTearing(prev => ({ ...prev, [env.id]: false }));

    window.dispatchEvent(new CustomEvent('show-toast', {
      detail: `Environment for PR #${env.prNumber} torn down successfully`
    }));
  }

  return (
    <div className="main-content animate-fade-in">
      {/* Modals */}
      {teardownTarget && (
        <TeardownModal
          env={teardownTarget}
          onConfirm={() => handleTeardown(teardownTarget)}
          onCancel={() => setTeardownTarget(null)}
        />
      )}
      {showReport && (
        <ComplianceReportModal
          logs={MOCK_AUDIT}
          onClose={() => setShowReport(false)}
        />
      )}

      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Environments</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Active PR preview databases and compliance audit trail.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {activeCount > 0 && (
            <span className="env-badge active" style={{ fontSize: 12 }}>
              {activeCount} active branch{activeCount !== 1 ? 'es' : ''}
            </span>
          )}
          {buildingCount > 0 && (
            <span className="env-badge building" style={{ fontSize: 12 }}>
              <Loader2 size={11} style={{ animation: 'spin 0.7s linear infinite' }} />
              {buildingCount} building
            </span>
          )}
        </div>
      </div>

      {/* ──── Section 1: Active PR Environments ──────────────────────────── */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-4)' }}>
          <GitBranch size={16} color="var(--accent-blue)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>
            Pull Request Preview Databases
          </span>
        </div>

        {envs.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
            <Server size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
            <div style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>No environments yet</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Environments are created automatically when a Pull Request is opened.
            </div>
          </div>
        ) : (
          <div className="env-table-wrapper">
            <table className="env-table">
              <thead>
                <tr>
                  <th>Pull Request</th>
                  <th>Status</th>
                  <th>DB Size</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {envs.map(env => (
                  <tr key={env.id}>
                    {/* PR info */}
                    <td>
                      <div className="env-pr-num">#{env.prNumber}</div>
                      <div className="env-pr-title">{env.prTitle}</div>
                      <div className="env-branch">{env.branchName}</div>
                    </td>

                    {/* Status */}
                    <td>
                      <EnvBadge status={env.status} />
                      {env.status === 'building' && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                          Streaming masked subset...
                        </div>
                      )}
                    </td>

                    {/* DB Size */}
                    <td>
                      {env.status === 'building' ? (
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>—</span>
                      ) : (
                        <>
                          <div className="env-db-size">{env.dbSizeMb} MB</div>
                          <div className="env-sample-pct">{env.samplePercent}% sample</div>
                        </>
                      )}
                    </td>

                    {/* Created */}
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {timeAgo(env.createdAt)}
                    </td>

                    {/* Actions */}
                    <td>
                      <div className="env-actions">
                        {env.status === 'active' && (
                          <button
                            id={`copy-conn-${env.id}`}
                            className="env-copy-btn"
                            onClick={() => copyToClipboard(env.connectionString, `Connection string copied for PR #${env.prNumber}`)}
                          >
                            <Copy size={11} />
                            Copy Conn. String
                          </button>
                        )}
                        <button
                          id={`teardown-${env.id}`}
                          className="env-teardown-btn"
                          disabled={env.status === 'closed' || env.status === 'teardown' || !!tearing[env.id]}
                          onClick={() => setTeardownTarget(env)}
                        >
                          {tearing[env.id]
                            ? <><Loader2 size={11} style={{ animation: 'spin 0.7s linear infinite' }} /> Tearing down...</>
                            : <><Trash2 size={11} /> Teardown Now</>
                          }
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ──── Section 2: SOC2 Compliance & Audit Trail ────────────────────── */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div className="compliance-card">
          <div className="compliance-card-header">
            <div className="compliance-title">
              <Shield size={18} color="var(--accent-indigo)" />
              SOC2 Compliance &amp; Audit Trail
            </div>
            <button
              id="generate-soc2-report"
              className="btn btn-indigo"
              style={{ fontSize: 13, padding: '8px 16px' }}
              onClick={() => setShowReport(true)}
            >
              <FileText size={14} />
              Generate SOC2 Report
            </button>
          </div>

          {/* Compliance stats */}
          <div className="compliance-stats-row">
            <div className="compliance-stat">
              <div className="compliance-stat-value">{MOCK_AUDIT.length}</div>
              <div className="compliance-stat-label">Total Runs</div>
            </div>
            <div className="compliance-stat">
              <div className="compliance-stat-value" style={{ color: 'var(--accent-green)' }}>
                {formatRows(MOCK_AUDIT.reduce((s, l) => s + l.rowsProcessed, 0))}
              </div>
              <div className="compliance-stat-label">Rows Masked</div>
            </div>
            <div className="compliance-stat">
              <div className="compliance-stat-value" style={{ fontSize: 16, color: 'var(--accent-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <CheckCircle size={22} />
                ZERO
              </div>
              <div className="compliance-stat-label">PII Leaks Detected</div>
            </div>
          </div>

          {/* Audit log table */}
          <div className="audit-table-wrapper">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Environment</th>
                  <th>Rows Masked</th>
                  <th>Status</th>
                  <th>Execution Hash</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_AUDIT.map(log => (
                  <tr key={log.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {formatDate(log.createdAt)}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-primary)' }}>
                      {log.environmentName}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {formatRows(log.rowsProcessed)}
                    </td>
                    <td>
                      {log.status === 'success' ? (
                        <span style={{ color: 'var(--accent-green)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <CheckCircle size={13} /> Success
                        </span>
                      ) : (
                        <span style={{ color: 'var(--accent-red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                          <AlertTriangle size={13} /> Failed
                        </span>
                      )}
                    </td>
                    <td>
                      <div className="audit-hash">
                        {log.executionHash.slice(0, 20)}...
                        <button
                          className="audit-copy-hash"
                          title="Copy full hash"
                          onClick={() => copyToClipboard(log.executionHash, 'Execution hash copied!')}
                        >
                          <Copy size={9} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
