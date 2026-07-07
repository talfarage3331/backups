import { useState } from 'react';
import {
  CheckCircle, XCircle, ArrowRight, Loader2, Copy, Check, AlertTriangle, Shield, Database, Cloud, Clock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { testDatabaseConnection, testStorageConnection } from '../services/simulator';
import { savePipeline, seedMockRuns } from '../services/db';
import type { Pipeline, ScheduleType } from '../types';

type StorageType = 'r2' | 's3';

interface OnboardingProps {
  onComplete: () => void;
}

// ─── Timeline progress header ─────────────────────────────────────────────────

function StepTimeline({ step }: { step: number }) {
  const steps = [
    { num: 1, label: 'Database' },
    { num: 2, label: 'Storage' },
    { num: 3, label: 'Schedule' },
  ];

  return (
    <div className="step-timeline">
      {steps.map((s, i) => {
        const state = s.num < step ? 'done' : s.num === step ? 'active' : 'idle';
        return (
          <>
            <div key={s.num} className={`step-node ${state}`}>
              <div className="step-node-circle">
                {state === 'done' ? <Check size={14} /> : s.num}
              </div>
              <span className="step-node-label">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div key={`line-${i}`} className={`step-node-line ${s.num < step ? 'done' : ''}`} />
            )}
          </>
        );
      })}
    </div>
  );
}

// ─── SQL copy block ───────────────────────────────────────────────────────────

const SQL_SNIPPET = `-- Run these 5 lines in your Supabase SQL Editor
CREATE ROLE stackguard_backup WITH LOGIN PASSWORD 'choose-a-strong-password';
GRANT CONNECT ON DATABASE postgres TO stackguard_backup;
GRANT USAGE ON SCHEMA public TO stackguard_backup;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO stackguard_backup;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO stackguard_backup;`;

function SqlBlock() {
  const [copied, setCopied] = useState(false);
  const [showToast, setShowToast] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(SQL_SNIPPET).then(() => {
      setCopied(true);
      setShowToast(true);
      setTimeout(() => { setCopied(false); setShowToast(false); }, 2500);
    });
  }

  return (
    <>
      <div className="sql-block">
        <div className="sql-block-header">
          <span className="sql-block-title">SQL — run in Supabase SQL Editor</span>
          <button className={`sql-copy-btn ${copied ? 'copied' : ''}`} onClick={handleCopy}>
            {copied ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Copy</>}
          </button>
        </div>
        <div className="sql-block-body">
          <span className="sql-comment">{'-- Run these 5 lines in your Supabase SQL Editor\n'}</span>
          <span><span className="sql-keyword">CREATE ROLE</span> stackguard_backup <span className="sql-keyword">WITH LOGIN PASSWORD</span> <span className="sql-string">'choose-a-strong-password'</span>;<br /></span>
          <span><span className="sql-keyword">GRANT CONNECT ON DATABASE</span> postgres <span className="sql-keyword">TO</span> stackguard_backup;<br /></span>
          <span><span className="sql-keyword">GRANT USAGE ON SCHEMA</span> public <span className="sql-keyword">TO</span> stackguard_backup;<br /></span>
          <span><span className="sql-keyword">GRANT SELECT ON ALL TABLES IN SCHEMA</span> public <span className="sql-keyword">TO</span> stackguard_backup;<br /></span>
          <span><span className="sql-keyword">ALTER DEFAULT PRIVILEGES IN SCHEMA</span> public <span className="sql-keyword">GRANT SELECT ON TABLES TO</span> stackguard_backup;</span>
        </div>
      </div>
      {showToast && (
        <div className="copy-toast">
          <CheckCircle size={14} /> SQL copied to clipboard
        </div>
      )}
    </>
  );
}

// ─── Step 1: Database ─────────────────────────────────────────────────────────

function Step1({
  onNext, connStr, setConnStr,
}: {
  onNext: (connStr: string) => void;
  connStr: string;
  setConnStr: (v: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const isPoolerWarning = result && !result.success && result.message.includes('Session Pooler');

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const r = await testDatabaseConnection(connStr);
    setResult(r);
    setTesting(false);
  }

  return (
    <>
      <StepTimeline step={1} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-2)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(79,126,248,0.1)', border: '1px solid rgba(79,126,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Database size={18} color="var(--accent-blue)" />
        </div>
        <h1 className="step-title" style={{ marginBottom: 0 }}>Connect your database</h1>
      </div>
      <p className="step-subtitle">
        We connect with a read-only role — StackGuard never writes to your data.
      </p>

      <div className="step-body">
        {/* SQL instructions */}
        <div>
          <label className="form-label" style={{ marginBottom: 8 }}>
            Step 1 of 2 — Create a read-only user in Supabase (run all 5 lines)
          </label>
          <SqlBlock />
        </div>

        {/* Connection string */}
        <div className="form-group">
          <label className="form-label">
            Step 2 of 2 — Paste the Session Pooler connection string
          </label>
          <input
            id="db-connection-string"
            className="form-input"
            type="password"
            placeholder="postgresql://stackguard_backup:[password]@[project].pooler.supabase.com:6543/postgres"
            value={connStr}
            onChange={e => { setConnStr(e.target.value); setResult(null); }}
            autoComplete="off"
            spellCheck={false}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Shield size={11} />
            Use the <strong style={{ color: 'var(--text-secondary)' }}>Session Pooler</strong> connection (port 6543) for maximum compatibility — find it in Supabase → Settings → Database → Connection string.
          </div>

          {result && !result.success && !isPoolerWarning && (
            <div style={{ marginTop: 12, padding: '12px 14px', background: 'rgba(248,97,79,0.04)', border: '1px solid rgba(248,97,79,0.15)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--accent-red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} /> Connection Test Failed
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {result.message}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 6, marginTop: 2 }}>
                💡 <strong>Troubleshooting Tip:</strong> Please verify your database password is correct (replace <code>[password]</code> with your actual password), ensure you've executed the SQL script above in your Supabase editor, and double-check that you copied the <strong>Session Pooler</strong> URI (port 6543) from Supabase settings.
              </div>
            </div>
          )}
        </div>

        {/* Warning box shown when pooler detection fails */}
        {isPoolerWarning && (
          <div className="diagnostic-box">
            <div className="diagnostic-box-icon"><AlertTriangle size={15} /></div>
            <div>
              <strong>IPv6 / Direct Connection Detected</strong><br />
              Your connection string points to port 5432 (direct connection). Many cloud platforms and ISPs block direct IPv6 Postgres connections.<br /><br />
              <strong>Fix:</strong> In your Supabase dashboard, go to <em>Settings → Database → Connection string</em> and copy the <strong>Session Pooler</strong> URI (port 6543, containing <code>pooler.supabase.com</code>).
            </div>
          </div>
        )}

        {/* Result */}
        <div className="flex items-center justify-between">
          <div>
            {result && result.success && (
              <div className="connection-result success">
                <CheckCircle size={17} />
                {result.message}
              </div>
            )}
          </div>
          <button
            id="test-db-connection-btn"
            className="btn btn-ghost"
            onClick={handleTest}
            disabled={testing || !connStr.trim()}
          >
            {testing
              ? <><Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> Testing…</>
              : 'Test connection'}
          </button>
        </div>
      </div>

      <div className="step-footer">
        <span className="step-footer-left">StackGuard — onboarding wizard</span>
        <div className="step-actions">
          <button
            id="step1-continue-btn"
            className="btn btn-dark"
            onClick={() => onNext(connStr)}
            disabled={!result?.success}
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Step 2: Storage ──────────────────────────────────────────────────────────

function Step2({
  onNext, onBack, storageType, setStorageType, creds, setCreds,
}: {
  onNext: (creds: Pipeline['storage_credentials'], type: StorageType) => void;
  onBack: () => void;
  storageType: StorageType;
  setStorageType: (t: StorageType) => void;
  creds: Pipeline['storage_credentials'];
  setCreds: (c: Pipeline['storage_credentials']) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  function update(field: keyof typeof creds, value: string) {
    setCreds({ ...creds, [field]: value });
    setResult(null);
  }

  async function handleVerify() {
    setTesting(true);
    setResult(null);
    const r = await testStorageConnection(creds);
    setResult(r);
    setTesting(false);
  }

  const placeholderEndpoint = storageType === 'r2'
    ? 'https://<account-id>.r2.cloudflarestorage.com'
    : 'https://s3.us-east-1.amazonaws.com';

  return (
    <>
      <StepTimeline step={2} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-2)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(79,126,248,0.1)', border: '1px solid rgba(79,126,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Cloud size={18} color="var(--accent-blue)" />
        </div>
        <h1 className="step-title" style={{ marginBottom: 0 }}>Storage destination</h1>
      </div>
      <p className="step-subtitle">
        Backup archives are written to your own bucket — you retain full ownership.
      </p>

      <div className="step-body">
        {/* Provider toggle */}
        <div className="form-group">
          <label className="form-label">Storage provider</label>
          <div className="toggle-group" style={{ maxWidth: 260 }}>
            <button
              id="toggle-r2"
              className={`toggle-btn ${storageType === 'r2' ? 'active' : ''}`}
              onClick={() => { setStorageType('r2'); setResult(null); }}
            >Cloudflare R2</button>
            <button
              id="toggle-s3"
              className={`toggle-btn ${storageType === 's3' ? 'active' : ''}`}
              onClick={() => { setStorageType('s3'); setResult(null); }}
            >AWS S3</button>
          </div>
        </div>

        <div className="settings-row">
          <div className="form-group">
            <label className="form-label">Access Key ID</label>
            <input id="storage-access-key" className="form-input" type="text" placeholder="AKIAIOSFODNN7EXAMPLE" value={creds.access_key} onChange={e => update('access_key', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Secret Access Key</label>
            <input id="storage-secret-key" className="form-input" type="password" placeholder="••••••••••••••••" value={creds.secret_key} onChange={e => update('secret_key', e.target.value)} />
          </div>
        </div>

        <div className="settings-row">
          <div className="form-group">
            <label className="form-label">Bucket name</label>
            <input id="storage-bucket" className="form-input" type="text" placeholder="my-backups" value={creds.bucket} onChange={e => update('bucket', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Endpoint URL</label>
            <input
              id="storage-endpoint"
              className="form-input"
              type="url"
              placeholder={placeholderEndpoint}
              value={creds.endpoint}
              onChange={e => update('endpoint', e.target.value)}
            />
          </div>
        </div>

        {/* Verify result */}
        <div className="flex items-center justify-between">
          <div>
            {result && (
              <div className={`connection-result ${result.success ? 'success' : 'error'}`}>
                {result.success ? <CheckCircle size={17} /> : <XCircle size={17} />}
                {result.success
                  ? 'Write permissions confirmed — test object created and deleted.'
                  : result.message}
              </div>
            )}
          </div>
          <button
            id="verify-storage-btn"
            className="btn btn-ghost"
            onClick={handleVerify}
            disabled={testing || !creds.access_key || !creds.secret_key || !creds.bucket || !creds.endpoint}
          >
            {testing
              ? <><Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> Verifying…</>
              : 'Verify target'}
          </button>
        </div>
      </div>

      <div className="step-footer">
        <span className="step-footer-left">StackGuard — onboarding wizard</span>
        <div className="step-actions">
          <button id="step2-back-btn" className="btn btn-ghost" onClick={onBack}>Back</button>
          <button
            id="step2-continue-btn"
            className="btn btn-dark"
            onClick={() => onNext(creds, storageType)}
            disabled={!result?.success}
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Step 3: Schedule & Alerts ────────────────────────────────────────────────

function Step3({
  onActivate, onBack, loading,
}: {
  onActivate: (data: { schedule: ScheduleType; retention: number; webhook: string }) => void;
  onBack: () => void;
  loading: boolean;
}) {
  const [schedule, setSchedule] = useState<ScheduleType>('daily');
  const [retention, setRetention] = useState(14);
  const [webhook, setWebhook] = useState('');

  const scheduleOptions: { value: ScheduleType; label: string; desc: string }[] = [
    { value: 'hourly', label: 'Hourly',        desc: 'Best for high-frequency write apps' },
    { value: '12h',    label: 'Every 12 hours', desc: 'Balanced cost and protection' },
    { value: 'daily',  label: 'Daily',          desc: 'Recommended starting point' },
  ];

  return (
    <>
      <StepTimeline step={3} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-2)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(79,126,248,0.1)', border: '1px solid rgba(79,126,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Clock size={18} color="var(--accent-blue)" />
        </div>
        <h1 className="step-title" style={{ marginBottom: 0 }}>Schedule &amp; alerts</h1>
      </div>
      <p className="step-subtitle">
        Configure how often backups run and where you receive failure notifications.
      </p>

      <div className="step-body">
        {/* Frequency selector */}
        <div className="form-group">
          <label className="form-label">Backup frequency</label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {scheduleOptions.map(opt => (
              <label
                key={opt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: '12px 16px',
                  border: `1px solid ${schedule === opt.value ? 'var(--accent-blue)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius-md)',
                  background: schedule === opt.value ? 'rgba(79,126,248,0.06)' : 'var(--bg-elevated)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <input
                  type="radio"
                  name="schedule"
                  value={opt.value}
                  checked={schedule === opt.value}
                  onChange={() => setSchedule(opt.value)}
                  style={{ accentColor: 'var(--accent-blue)', width: 15, height: 15 }}
                />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{opt.desc}</div>
                </div>
                {schedule === opt.value && (
                  <CheckCircle size={16} color="var(--accent-blue)" style={{ marginLeft: 'auto' }} />
                )}
              </label>
            ))}
          </div>
        </div>

        {/* Retention */}
        <div className="form-group">
          <label className="form-label">Retention policy</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>Keep the last</span>
            <input
              id="retention-count"
              className="form-number"
              type="number"
              min={1}
              max={365}
              value={retention}
              onChange={e => setRetention(Math.max(1, Number(e.target.value)))}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 14, color: 'var(--text-secondary)' }}>backups</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Older backups are automatically deleted. Default is 14.
          </div>
        </div>

        {/* Webhook */}
        <div className="form-group">
          <label className="form-label">
            Failure webhook URL <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
          </label>
          <input
            id="webhook-url"
            className="form-input"
            type="url"
            placeholder="https://hooks.slack.com/services/... or Discord / Telegram"
            value={webhook}
            onChange={e => setWebhook(e.target.value)}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Sends an alert if a backup job fails. Compatible with Slack, Discord, and Telegram webhooks.
          </div>
        </div>
      </div>

      <div className="step-footer">
        <span className="step-footer-left">StackGuard — onboarding wizard</span>
        <div className="step-actions">
          <button id="step3-back-btn" className="btn btn-ghost" onClick={onBack} disabled={loading}>Back</button>
          <button
            id="activate-pipeline-btn"
            className="btn btn-dark btn-lg"
            style={{ gap: 8 }}
            onClick={() => onActivate({ schedule, retention, webhook })}
            disabled={loading}
          >
            {loading
              ? <><Loader2 size={15} style={{ animation: 'spin 0.7s linear infinite' }} /> Activating…</>
              : <><CheckCircle size={15} /> Activate pipeline</>}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Onboarding Shell ─────────────────────────────────────────────────────────

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [activating, setActivating] = useState(false);

  // State carried through steps
  const [connStr, setConnStr] = useState('');
  const [storageType, setStorageType] = useState<StorageType>('r2');
  const [storageCreds, setStorageCreds] = useState<Pipeline['storage_credentials']>({
    access_key: '', secret_key: '', bucket: '', endpoint: '',
  });

  function handleStep1Next(cs: string) {
    setConnStr(cs);
    setStep(2);
  }

  function handleStep2Next(creds: Pipeline['storage_credentials'], type: StorageType) {
    setStorageCreds(creds);
    setStorageType(type);
    setStep(3);
  }

  async function handleActivate(data: { schedule: ScheduleType; retention: number; webhook: string }) {
    if (!user) return;
    setActivating(true);

    try {
      const pipeline = await savePipeline({
        name: `${storageType === 'r2' ? 'R2' : 'S3'} Backup (${data.schedule})`,
        user_id: user.uid,
        database_type: 'postgres',
        db_config: { connection_string: connStr },
        storage_type: storageType,
        storage_credentials: storageCreds,
        schedule: data.schedule,
        retention_count: data.retention,
        restore_check_frequency: 'weekly',
        webhook_url: data.webhook,
        notify_on_success_too: false,
        created_at: new Date().toISOString(),
        status: 'active',
      });

      await seedMockRuns(pipeline.id);
      onComplete();
    } catch (err) {
      console.error('Activation error:', err);
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        {step === 1 && (
          <Step1
            key="step1"
            onNext={handleStep1Next}
            connStr={connStr}
            setConnStr={setConnStr}
          />
        )}
        {step === 2 && (
          <Step2
            key="step2"
            onNext={handleStep2Next}
            onBack={() => setStep(1)}
            storageType={storageType}
            setStorageType={setStorageType}
            creds={storageCreds}
            setCreds={setStorageCreds}
          />
        )}
        {step === 3 && (
          <Step3
            key="step3"
            onActivate={handleActivate}
            onBack={() => setStep(2)}
            loading={activating}
          />
        )}
      </div>
    </div>
  );
}
