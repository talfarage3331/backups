import { useState, useRef } from 'react';
import { CheckCircle, XCircle, Lock, Upload, HelpCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { testDatabaseConnection, testStorageConnection } from '../services/simulator';
import { savePipeline, seedMockRuns } from '../services/db';
import type { Pipeline } from '../types';

type DBType = 'firestore' | 'rtdb';
type StorageType = 'r2' | 's3';

interface OnboardingProps {
  onComplete: () => void;
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="progress-bar-row">
      {[1, 2, 3].map((s) => (
        <div key={s} className="progress-segment">
          <div
            className={`progress-segment-fill ${s < step ? 'done' : s === step ? 'active' : 'idle'}`}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Step 1: Database ────────────────────────────────────────────────────────

function Step1({
  onNext,
  dbType,
  setDbType,
  dbConfig,
  setDbConfig,
}: {
  onNext: (config: string, type: DBType) => void;
  dbType: DBType;
  setDbType: (t: DBType) => void;
  dbConfig: string;
  setDbConfig: (v: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const r = await testDatabaseConnection(dbConfig);
    setResult(r);
    setTesting(false);
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setDbConfig(ev.target?.result as string);
    reader.readAsText(file);
  }

  return (
    <>
      <ProgressBar step={1} />
      <p className="progress-label">Step <strong>1</strong> of 3 — connect your database</p>

      <h1 className="step-title">Connect your database</h1>
      <p className="step-subtitle">
        Paste your Firebase config JSON or upload your Service Account key — we'll read the data, never write it.
      </p>

      <div className="step-body">
        {/* DB type toggle */}
        <div className="form-group">
          <label className="form-label">Database type</label>
          <div className="toggle-group" style={{ maxWidth: 300 }}>
            <button
              id="toggle-firestore"
              className={`toggle-btn ${dbType === 'firestore' ? 'active' : ''}`}
              onClick={() => { setDbType('firestore'); setResult(null); }}
            >Firestore</button>
            <button
              id="toggle-rtdb"
              className={`toggle-btn ${dbType === 'rtdb' ? 'active' : ''}`}
              onClick={() => { setDbType('rtdb'); setResult(null); }}
            >Realtime Database</button>
          </div>
        </div>

        {/* Config JSON */}
        <div className="form-group">
          <div className="flex items-center justify-between" style={{ marginBottom: 6 }}>
            <label className="form-label" style={{ marginBottom: 0 }}>
              {dbType === 'firestore' ? 'Firebase Config JSON or Service Account key' : 'Firebase Config JSON'}
            </label>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => fileRef.current?.click()}
              style={{ gap: 6 }}
            >
              <Upload size={13} /> Upload file
            </button>
            <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }} onChange={handleFile} />
          </div>
          <textarea
            id="db-config-textarea"
            className="form-textarea"
            placeholder={'{\n  "apiKey": "...",\n  "authDomain": "...",\n  "projectId": "..."\n}'}
            value={dbConfig}
            onChange={e => { setDbConfig(e.target.value); setResult(null); }}
          />
        </div>

        {/* Hint box */}
        <div className="info-box">
          <div className="info-box-header">
            <Lock size={14} />
            Read-only access recommended
          </div>
          <div className="code-block">
            For Service Accounts, grant only the <span>Cloud Datastore Viewer</span> or{' '}
            <span>Firebase Viewer</span> IAM role — StackGuard never modifies your data.
          </div>
        </div>

        {/* Result */}
        <div className="flex items-center justify-between">
          <div>
            {result && (
              <div className={`connection-result ${result.success ? 'success' : 'error'}`}>
                {result.success
                  ? <CheckCircle size={18} />
                  : <XCircle size={18} />}
                {result.message}
              </div>
            )}
          </div>
          <button
            id="test-db-connection-btn"
            className="btn btn-ghost"
            onClick={handleTest}
            disabled={testing}
          >
            {testing ? <><Loader2 size={15} className="animate-spin" style={{ animation: 'spin 0.7s linear infinite' }} /> Testing…</> : 'Test connection'}
          </button>
        </div>
      </div>

      <div className="step-footer">
        <span className="step-footer-left">StackGuard — onboarding wizard</span>
        <div className="step-actions">
          <button
            id="step1-continue-btn"
            className="btn btn-dark"
            onClick={() => onNext(dbConfig, dbType)}
            disabled={!result?.success}
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Step 2: Storage ─────────────────────────────────────────────────────────

function Step2({
  onNext,
  onBack,
  storageType,
  setStorageType,
  creds,
  setCreds,
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

  return (
    <>
      <ProgressBar step={2} />
      <p className="progress-label">Step <strong>2</strong> of 3 — connect storage</p>

      <h1 className="step-title">Connect storage</h1>
      <p className="step-subtitle">
        Backup archives will be written to your own bucket — you keep full ownership.
      </p>

      <div className="step-body">
        {/* Storage type toggle */}
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
            <input id="storage-bucket" className="form-input" type="text" placeholder="my-backups-bucket" value={creds.bucket} onChange={e => update('bucket', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Endpoint URL</label>
            <input
              id="storage-endpoint"
              className="form-input"
              type="url"
              placeholder={storageType === 'r2' ? 'https://<account-id>.r2.cloudflarestorage.com' : 'https://s3.amazonaws.com'}
              value={creds.endpoint}
              onChange={e => update('endpoint', e.target.value)}
            />
          </div>
        </div>

        {/* Result */}
        <div className="flex items-center justify-between">
          <div>
            {result && (
              <div className={`connection-result ${result.success ? 'success' : 'error'}`}>
                {result.success ? <CheckCircle size={18} /> : <XCircle size={18} />}
                {result.message}
              </div>
            )}
          </div>
          <button
            id="verify-storage-btn"
            className="btn btn-ghost"
            onClick={handleVerify}
            disabled={testing}
          >
            {testing ? <><Loader2 size={15} style={{ animation: 'spin 0.7s linear infinite' }} /> Verifying…</> : 'Verify target'}
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

// ─── Step 3: Schedule & Notifications ────────────────────────────────────────

function Step3({
  onActivate,
  onBack,
  loading,
}: {
  onActivate: (data: { schedule: string; retention: number; restoreFreq: string; webhook: string; notifyOnFailOnly: boolean }) => void;
  onBack: () => void;
  loading: boolean;
}) {
  const [schedule, setSchedule] = useState('daily');
  const [retention, setRetention] = useState(14);
  const [restoreFreq, setRestoreFreq] = useState('weekly');
  const [webhook, setWebhook] = useState('');
  const [notifyOnFailOnly, setNotifyOnFailOnly] = useState(true);

  return (
    <>
      <ProgressBar step={3} />
      <p className="progress-label">Step <strong>3</strong> of 3 — schedule &amp; notifications</p>

      <h1 className="step-title">Schedule &amp; notifications</h1>
      <p className="step-subtitle">
        Configure when backups run and how you want to be alerted.
      </p>

      <div className="step-body">
        <div className="settings-row">
          <div className="form-group">
            <label className="form-label">Backup frequency</label>
            <select id="backup-frequency" className="form-select" value={schedule} onChange={e => setSchedule(e.target.value)}>
              <option value="12h">Every 12 hours</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Retention — keep last N backups</label>
            <input
              id="retention-count"
              className="form-number"
              type="number"
              min={1}
              max={365}
              value={retention}
              onChange={e => setRetention(Number(e.target.value))}
            />
          </div>
        </div>

        {/* Restore check */}
        <div className="form-group">
          <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
            <label className="form-label" style={{ marginBottom: 0 }}>Restore check frequency</label>
            <div className="tooltip-wrapper">
              <HelpCircle size={14} style={{ color: 'var(--text-muted)', cursor: 'help' }} />
              <span className="tooltip-text">
                We restore your latest backup into a sandbox and verify it's recoverable — not just that a file exists.
              </span>
            </div>
          </div>
          <select id="restore-frequency" className="form-select" value={restoreFreq} onChange={e => setRestoreFreq(e.target.value)}>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="off">Off</option>
          </select>
        </div>

        {/* Webhook */}
        <div className="form-group">
          <label className="form-label">Webhook URL <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Discord / Telegram / Slack)</span></label>
          <input
            id="webhook-url"
            className="form-input"
            type="url"
            placeholder="https://hooks.slack.com/services/..."
            value={webhook}
            onChange={e => setWebhook(e.target.value)}
          />
        </div>

        <label className="checkbox-label">
          <input
            id="notify-fail-only"
            type="checkbox"
            checked={notifyOnFailOnly}
            onChange={e => setNotifyOnFailOnly(e.target.checked)}
          />
          Only notify on failure
        </label>
      </div>

      <div className="step-footer">
        <span className="step-footer-left">StackGuard — onboarding wizard</span>
        <div className="step-actions">
          <button id="step3-back-btn" className="btn btn-ghost" onClick={onBack} disabled={loading}>Back</button>
          <button
            id="activate-pipeline-btn"
            className="btn btn-dark btn-lg"
            onClick={() => onActivate({ schedule, retention, restoreFreq, webhook, notifyOnFailOnly })}
            disabled={loading}
          >
            {loading ? <><span className="spinner" /> Activating…</> : '🚀 Activate pipeline'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Onboarding Shell ────────────────────────────────────────────────────────

export default function Onboarding({ onComplete }: OnboardingProps) {
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [activating, setActivating] = useState(false);

  // State carried through steps
  const [dbType, setDbType] = useState<DBType>('firestore');
  const [dbConfig, setDbConfig] = useState('');
  const [storageType, setStorageType] = useState<StorageType>('r2');
  const [storageCreds, setStorageCreds] = useState<Pipeline['storage_credentials']>({
    access_key: '', secret_key: '', bucket: '', endpoint: '',
  });

  function handleStep1Next(config: string, type: DBType) {
    setDbConfig(config);
    setDbType(type);
    setStep(2);
  }

  function handleStep2Next(creds: Pipeline['storage_credentials'], type: StorageType) {
    setStorageCreds(creds);
    setStorageType(type);
    setStep(3);
  }

  async function handleActivate(data: {
    schedule: string;
    retention: number;
    restoreFreq: string;
    webhook: string;
    notifyOnFailOnly: boolean;
  }) {
    if (!user) return;
    setActivating(true);

    const pipeline = await savePipeline({
      user_id: user.uid,
      database_type: dbType,
      db_config: JSON.parse(dbConfig),
      storage_type: storageType,
      storage_credentials: storageCreds,
      schedule: data.schedule as Pipeline['schedule'],
      retention_count: data.retention,
      restore_check_frequency: data.restoreFreq as Pipeline['restore_check_frequency'],
      webhook_url: data.webhook,
      notify_on_success_too: !data.notifyOnFailOnly,
      created_at: new Date().toISOString(),
      status: 'active',
    });

    await seedMockRuns(pipeline.id);
    setActivating(false);
    onComplete();
  }

  return (
    <div className="onboarding-page">
      <div className="onboarding-card">
        {step === 1 && (
          <Step1
            key="step1"
            onNext={handleStep1Next}
            dbType={dbType}
            setDbType={setDbType}
            dbConfig={dbConfig}
            setDbConfig={setDbConfig}
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
