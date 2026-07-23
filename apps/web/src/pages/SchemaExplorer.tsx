import { useState, useMemo } from 'react';
import { Search, ScanSearch, AlertTriangle, ShieldCheck, Loader2, CheckCircle } from 'lucide-react';
import type { SchemaColumn, MaskingStrategy, PiiRisk } from '../types';

// ─── Mock Schema Data ─────────────────────────────────────────────────────────

const MOCK_SCHEMA: SchemaColumn[] = [
  // users table
  { id: 'users.id',              table: 'users',    column: 'id',               dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'a1b2c3d4-...',     previewMasked: 'a1b2c3d4-...' },
  { id: 'users.email',           table: 'users',    column: 'email',            dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'EMAIL',       strategy: 'hash',      previewOriginal: 'john@gmail.com',   previewMasked: 'usr_a8f92@masked.com' },
  { id: 'users.full_name',       table: 'users',    column: 'full_name',        dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'FULL_NAME',   strategy: 'anonymize', previewOriginal: 'John Doe',          previewMasked: 'Alice Turner' },
  { id: 'users.phone',           table: 'users',    column: 'phone',            dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'PHONE',       strategy: 'redact',    previewOriginal: '+1-555-012-3456',  previewMasked: '[REDACTED]' },
  { id: 'users.ssn',             table: 'users',    column: 'ssn',              dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'SSN',         strategy: 'redact',    previewOriginal: '123-45-6789',      previewMasked: '[REDACTED]' },
  { id: 'users.date_of_birth',   table: 'users',    column: 'date_of_birth',    dataType: 'date',        piiRisk: 'MEDIUM',     piiCategory: 'DOB',         strategy: 'anonymize', previewOriginal: '1987-04-12',       previewMasked: '1991-07-03' },
  { id: 'users.address',         table: 'users',    column: 'address',          dataType: 'text',        piiRisk: 'HIGH',       piiCategory: 'ADDRESS',     strategy: 'anonymize', previewOriginal: '42 Main St, NYC',  previewMasked: '17 Elm Ave, Dallas' },
  { id: 'users.ip_address',      table: 'users',    column: 'ip_address',       dataType: 'inet',        piiRisk: 'MEDIUM',     piiCategory: 'IP_ADDRESS',  strategy: 'hash',      previewOriginal: '192.168.1.105',    previewMasked: '10.0.x.xxx' },
  { id: 'users.created_at',      table: 'users',    column: 'created_at',       dataType: 'timestamptz', piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: '2024-01-15T...',   previewMasked: '2024-01-15T...' },
  { id: 'users.is_verified',     table: 'users',    column: 'is_verified',      dataType: 'boolean',     piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'true',             previewMasked: 'true' },

  // orders table
  { id: 'orders.id',             table: 'orders',   column: 'id',               dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'ord_99xz...',      previewMasked: 'ord_99xz...' },
  { id: 'orders.user_id',        table: 'orders',   column: 'user_id',          dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'a1b2c3d4-...',     previewMasked: 'a1b2c3d4-...' },
  { id: 'orders.amount',         table: 'orders',   column: 'amount',           dataType: 'numeric',     piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: '149.99',           previewMasked: '149.99' },
  { id: 'orders.shipping_addr',  table: 'orders',   column: 'shipping_address', dataType: 'text',        piiRisk: 'HIGH',       piiCategory: 'ADDRESS',     strategy: 'anonymize', previewOriginal: '42 Main St, NYC',  previewMasked: '89 Oak Rd, Austin' },
  { id: 'orders.status',         table: 'orders',   column: 'status',           dataType: 'varchar',     piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'completed',        previewMasked: 'completed' },
  { id: 'orders.created_at',     table: 'orders',   column: 'created_at',       dataType: 'timestamptz', piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: '2024-03-22T...',   previewMasked: '2024-03-22T...' },

  // payments table
  { id: 'payments.id',           table: 'payments', column: 'id',               dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'pay_ab12...',      previewMasked: 'pay_ab12...' },
  { id: 'payments.order_id',     table: 'payments', column: 'order_id',         dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'ord_99xz...',      previewMasked: 'ord_99xz...' },
  { id: 'payments.card_number',  table: 'payments', column: 'card_number',      dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'CREDIT_CARD', strategy: 'redact',    previewOriginal: '4111 1111 1111 1111', previewMasked: '[REDACTED]' },
  { id: 'payments.card_last4',   table: 'payments', column: 'card_last4',       dataType: 'char(4)',     piiRisk: 'LOW',        piiCategory: 'CREDIT_CARD', strategy: 'keep',      previewOriginal: '1111',             previewMasked: '1111' },
  { id: 'payments.cvv',          table: 'payments', column: 'cvv',              dataType: 'char(3)',     piiRisk: 'HIGH',       piiCategory: 'CREDIT_CARD', strategy: 'redact',    previewOriginal: '452',              previewMasked: '[REDACTED]' },
  { id: 'payments.stripe_token', table: 'payments', column: 'stripe_token',     dataType: 'varchar',     piiRisk: 'MEDIUM',     piiCategory: 'TOKEN',       strategy: 'hash',      previewOriginal: 'tok_live_xyz...',  previewMasked: 'tok_d4e9f2...' },
  { id: 'payments.amount',       table: 'payments', column: 'amount',           dataType: 'numeric',     piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: '149.99',           previewMasked: '149.99' },

  // sessions table
  { id: 'sessions.id',           table: 'sessions', column: 'id',               dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'sess_...',         previewMasked: 'sess_...' },
  { id: 'sessions.user_id',      table: 'sessions', column: 'user_id',          dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'a1b2c3d4-...',     previewMasked: 'a1b2c3d4-...' },
  { id: 'sessions.token',        table: 'sessions', column: 'token',            dataType: 'varchar',     piiRisk: 'MEDIUM',     piiCategory: 'TOKEN',       strategy: 'hash',      previewOriginal: 'eyJhbGci...',      previewMasked: 'tok_f8a3c1...' },
  { id: 'sessions.user_agent',   table: 'sessions', column: 'user_agent',       dataType: 'text',        piiRisk: 'LOW',        piiCategory: 'USER_AGENT',  strategy: 'anonymize', previewOriginal: 'Mozilla/5.0...',   previewMasked: 'Mozilla/5.0 (generic)' },
  { id: 'sessions.ip_address',   table: 'sessions', column: 'ip_address',       dataType: 'inet',        piiRisk: 'MEDIUM',     piiCategory: 'IP_ADDRESS',  strategy: 'hash',      previewOriginal: '10.0.1.42',        previewMasked: '10.x.x.xxx' },
  { id: 'sessions.expires_at',   table: 'sessions', column: 'expires_at',       dataType: 'timestamptz', piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: '2024-12-31T...',   previewMasked: '2024-12-31T...' },

  // employees table
  { id: 'employees.id',          table: 'employees', column: 'id',              dataType: 'integer',     piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: '1042',             previewMasked: '1042' },
  { id: 'employees.first_name',  table: 'employees', column: 'first_name',      dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'FIRST_NAME',  strategy: 'anonymize', previewOriginal: 'John',             previewMasked: 'Michael' },
  { id: 'employees.last_name',   table: 'employees', column: 'last_name',       dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'LAST_NAME',   strategy: 'anonymize', previewOriginal: 'Doe',              previewMasked: 'Nguyen' },
  { id: 'employees.email',       table: 'employees', column: 'email',           dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'EMAIL',       strategy: 'hash',      previewOriginal: 'j.doe@corp.com',   previewMasked: 'emp_7c3a@corp.masked' },
  { id: 'employees.salary',      table: 'employees', column: 'salary',          dataType: 'numeric',     piiRisk: 'HIGH',       piiCategory: 'FINANCIAL',   strategy: 'redact',    previewOriginal: '95000.00',         previewMasked: '[REDACTED]' },
  { id: 'employees.national_id', table: 'employees', column: 'national_id',     dataType: 'varchar',     piiRisk: 'HIGH',       piiCategory: 'GOV_ID',      strategy: 'redact',    previewOriginal: 'AB123456C',        previewMasked: '[REDACTED]' },
  { id: 'employees.department',  table: 'employees', column: 'department',      dataType: 'varchar',     piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'Engineering',      previewMasked: 'Engineering' },

  // audit_logs table
  { id: 'audit_logs.id',         table: 'audit_logs', column: 'id',             dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'log_...',          previewMasked: 'log_...' },
  { id: 'audit_logs.actor_id',   table: 'audit_logs', column: 'actor_id',       dataType: 'uuid',        piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'a1b2c3d4-...',     previewMasked: 'a1b2c3d4-...' },
  { id: 'audit_logs.action',     table: 'audit_logs', column: 'action',         dataType: 'varchar',     piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: 'user.login',       previewMasked: 'user.login' },
  { id: 'audit_logs.metadata',   table: 'audit_logs', column: 'metadata',       dataType: 'jsonb',       piiRisk: 'UNREVIEWED', piiCategory: null,          strategy: 'redact',    previewOriginal: '{"email":"..."}',  previewMasked: '[REDACTED]' },
  { id: 'audit_logs.created_at', table: 'audit_logs', column: 'created_at',     dataType: 'timestamptz', piiRisk: 'NONE',       piiCategory: null,          strategy: 'keep',      previewOriginal: '2024-06-01T...',   previewMasked: '2024-06-01T...' },

  // medical_records table
  { id: 'medical_records.id',           table: 'medical_records', column: 'id',             dataType: 'uuid',    piiRisk: 'NONE',   piiCategory: null,          strategy: 'keep',      previewOriginal: 'rec_...',        previewMasked: 'rec_...' },
  { id: 'medical_records.patient_id',   table: 'medical_records', column: 'patient_id',     dataType: 'uuid',    piiRisk: 'NONE',   piiCategory: null,          strategy: 'keep',      previewOriginal: 'a1b2...',        previewMasked: 'a1b2...' },
  { id: 'medical_records.diagnosis',    table: 'medical_records', column: 'diagnosis',      dataType: 'text',    piiRisk: 'HIGH',   piiCategory: 'MEDICAL',     strategy: 'redact',    previewOriginal: 'Type 2 Diabetes', previewMasked: '[REDACTED]' },
  { id: 'medical_records.prescription', table: 'medical_records', column: 'prescription',   dataType: 'text',    piiRisk: 'HIGH',   piiCategory: 'MEDICAL',     strategy: 'redact',    previewOriginal: 'Metformin 500mg', previewMasked: '[REDACTED]' },
  { id: 'medical_records.doctor_notes', table: 'medical_records', column: 'doctor_notes',   dataType: 'text',    piiRisk: 'HIGH',   piiCategory: 'MEDICAL',     strategy: 'redact',    previewOriginal: 'Patient reports...', previewMasked: '[REDACTED]' },
];

// ─── Helper: compute masked preview based on strategy ────────────────────────

function computePreview(col: SchemaColumn): string {
  switch (col.strategy) {
    case 'redact':   return '[REDACTED]';
    case 'keep':     return col.previewOriginal;
    case 'hash':     return col.previewMasked;
    case 'anonymize': return col.previewMasked;
    default:         return col.previewMasked;
  }
}

// ─── PII Badge Component ──────────────────────────────────────────────────────

function PiiBadge({ risk, category }: { risk: PiiRisk; category: string | null }) {
  const labels: Record<PiiRisk, string> = {
    HIGH:       `HIGH RISK${category ? ` — ${category}` : ''}`,
    MEDIUM:     `MEDIUM${category ? ` — ${category}` : ''}`,
    LOW:        `LOW${category ? ` — ${category}` : ''}`,
    NONE:       'CLEAN',
    UNREVIEWED: 'UNREVIEWED',
  };

  const icons: Record<PiiRisk, React.ReactNode> = {
    HIGH:       <AlertTriangle size={10} />,
    MEDIUM:     <AlertTriangle size={10} />,
    LOW:        <ShieldCheck size={10} />,
    NONE:       <ShieldCheck size={10} />,
    UNREVIEWED: <AlertTriangle size={10} />,
  };

  return (
    <span className={`pii-badge ${risk}`}>
      {icons[risk]}
      {labels[risk]}
    </span>
  );
}

// ─── Preview Cell Component ───────────────────────────────────────────────────

function PreviewCell({ col }: { col: SchemaColumn }) {
  const masked = computePreview(col);
  if (col.strategy === 'keep') {
    return (
      <div className="preview-cell">
        <span className="preview-keep">{col.previewOriginal}</span>
        <span className="preview-arrow">·</span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>kept as-is</span>
      </div>
    );
  }
  if (col.strategy === 'redact') {
    return (
      <div className="preview-cell">
        <span className="preview-original">{col.previewOriginal}</span>
        <span className="preview-arrow">→</span>
        <span className="preview-redacted">{masked}</span>
      </div>
    );
  }
  return (
    <div className="preview-cell">
      <span className="preview-original">{col.previewOriginal}</span>
      <span className="preview-arrow">→</span>
      <span className="preview-masked">{masked}</span>
    </div>
  );
}

// ─── Main SchemaExplorer Page ─────────────────────────────────────────────────

type FilterTab = 'all' | 'pii' | 'unconfigured';

export default function SchemaExplorer() {
  const [columns, setColumns] = useState<SchemaColumn[]>(MOCK_SCHEMA);
  const [filter, setFilter]   = useState<FilterTab>('all');
  const [search, setSearch]   = useState('');
  const [saving, setSaving]   = useState<Record<string, boolean>>({});
  const [saved, setSaved]     = useState<Record<string, boolean>>({});

  // Counts for filter tabs
  const piiCount          = columns.filter(c => c.piiRisk === 'HIGH' || c.piiRisk === 'MEDIUM').length;
  const unconfiguredCount = columns.filter(c => c.piiRisk === 'UNREVIEWED').length;

  // Filtered columns
  const visible = useMemo(() => {
    let list = columns;
    if (filter === 'pii')          list = list.filter(c => c.piiRisk === 'HIGH' || c.piiRisk === 'MEDIUM');
    if (filter === 'unconfigured') list = list.filter(c => c.piiRisk === 'UNREVIEWED');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        `${c.table}.${c.column}`.toLowerCase().includes(q) ||
        (c.piiCategory ?? '').toLowerCase().includes(q) ||
        c.dataType.toLowerCase().includes(q)
      );
    }
    return list;
  }, [columns, filter, search]);

  async function handleStrategyChange(id: string, newStrategy: MaskingStrategy) {
    // Optimistic update
    setColumns(prev => prev.map(c => c.id === id ? { ...c, strategy: newStrategy } : c));
    setSaving(prev => ({ ...prev, [id]: true }));
    setSaved(prev => ({ ...prev, [id]: false }));

    // Simulated API call (replace with real fetch in production)
    await new Promise(r => setTimeout(r, 700));

    setSaving(prev => ({ ...prev, [id]: false }));
    setSaved(prev => ({ ...prev, [id]: true }));

    // Clear saved indicator after 2s
    setTimeout(() => setSaved(prev => ({ ...prev, [id]: false })), 2000);

    window.dispatchEvent(new CustomEvent('show-toast', {
      detail: `Rule saved: ${id.replace('.', '.')} → ${newStrategy}`
    }));
  }

  return (
    <div className="main-content animate-fade-in">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Schema Explorer</h1>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Inspect detected PII columns and configure masking strategies.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {columns.length} columns across {[...new Set(columns.map(c => c.table))].length} tables
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="card" style={{ padding: 'var(--space-4) var(--space-5)', marginBottom: 'var(--space-5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
            <input
              id="schema-search"
              className="form-input"
              style={{ paddingLeft: 32, height: 36, fontSize: 13 }}
              placeholder="Search table.column, type, category..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Filter tabs */}
          <div className="schema-filter-row">
            <button
              id="schema-filter-all"
              className={`schema-filter-tab ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              All Tables
              <span className="tab-count">{columns.length}</span>
            </button>
            <button
              id="schema-filter-pii"
              className={`schema-filter-tab ${filter === 'pii' ? 'active' : ''}`}
              onClick={() => setFilter('pii')}
            >
              <AlertTriangle size={12} />
              PII Detected
              <span className="tab-count">{piiCount}</span>
            </button>
            <button
              id="schema-filter-unconfigured"
              className={`schema-filter-tab ${filter === 'unconfigured' ? 'active' : ''}`}
              onClick={() => setFilter('unconfigured')}
            >
              Unconfigured
              <span className="tab-count">{unconfiguredCount}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Schema table */}
      <div className="schema-table-wrapper">
        <table className="schema-table">
          <thead>
            <tr>
              <th>Table &amp; Column</th>
              <th>Data Type</th>
              <th>PII Classification</th>
              <th>Masking Strategy</th>
              <th>Live Preview</th>
              <th style={{ width: 70 }}></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                  <ScanSearch size={24} style={{ marginBottom: 8, opacity: 0.4 }} />
                  <br />
                  No columns match your filter.
                </td>
              </tr>
            ) : visible.map(col => (
              <tr key={col.id}>
                {/* Table.Column */}
                <td>
                  <div className="schema-col-name">
                    <span className="table-part">{col.table}</span>
                    <span style={{ color: 'var(--text-muted)' }}>.</span>
                    <span className="col-part">{col.column}</span>
                  </div>
                </td>

                {/* Data type */}
                <td>
                  <span className="schema-dtype">{col.dataType}</span>
                </td>

                {/* PII Badge */}
                <td>
                  <PiiBadge risk={col.piiRisk} category={col.piiCategory} />
                </td>

                {/* Strategy selector */}
                <td>
                  <select
                    id={`strategy-${col.id}`}
                    className="strategy-select"
                    value={col.strategy}
                    onChange={e => handleStrategyChange(col.id, e.target.value as MaskingStrategy)}
                    disabled={saving[col.id]}
                  >
                    <option value="hash">HMAC Hash</option>
                    <option value="anonymize">Anonymize</option>
                    <option value="redact">Redact</option>
                    <option value="keep">Keep Original</option>
                  </select>
                </td>

                {/* Live preview */}
                <td>
                  <PreviewCell col={col} />
                </td>

                {/* Saving / Saved indicator */}
                <td>
                  {saving[col.id] && (
                    <span className="saving-indicator">
                      <Loader2 size={11} style={{ animation: 'spin 0.7s linear infinite' }} />
                      saving
                    </span>
                  )}
                  {saved[col.id] && !saving[col.id] && (
                    <span className="saving-indicator" style={{ color: 'var(--accent-green)' }}>
                      <CheckCircle size={11} />
                      saved
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer stats */}
      <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: 'var(--space-5)', flexWrap: 'wrap' }}>
        {[
          { label: 'High Risk', value: columns.filter(c => c.piiRisk === 'HIGH').length, color: 'var(--accent-red)' },
          { label: 'Medium Risk', value: columns.filter(c => c.piiRisk === 'MEDIUM').length, color: 'var(--accent-amber)' },
          { label: 'Low Risk', value: columns.filter(c => c.piiRisk === 'LOW').length, color: 'var(--accent-blue)' },
          { label: 'Unreviewed', value: columns.filter(c => c.piiRisk === 'UNREVIEWED').length, color: 'var(--accent-amber)' },
          { label: 'Clean', value: columns.filter(c => c.piiRisk === 'NONE').length, color: 'var(--accent-green)' },
        ].map(stat => (
          <div key={stat.label} className="card" style={{ padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 auto', minWidth: 120 }}>
            <span style={{ fontSize: 20, fontWeight: 700, color: stat.color }}>{stat.value}</span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stat.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
