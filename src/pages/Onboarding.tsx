import { useState } from 'react';
import {
  CheckCircle, XCircle, ArrowRight, Loader2, Check, AlertTriangle, Shield, Database, Cloud, Clock
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

// ─── Step 1: Database ─────────────────────────────────────────────────────────

function Step1({
  onNext, serviceAccount, setServiceAccount, collections, setCollections,
}: {
  onNext: (serviceAccount: string, collections: string) => void;
  serviceAccount: string;
  setServiceAccount: (v: string) => void;
  collections: string;
  setCollections: (v: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [fileError, setFileError] = useState('');

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const r = await testDatabaseConnection(serviceAccount);
    setResult(r);
    setTesting(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setServiceAccount(text);
      setResult(null);
      setFileError('');
    };
    reader.onerror = () => {
      setFileError('Failed to read key file.');
    };
    reader.readAsText(file);
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
        Upload or paste your Firebase service account key to establish a secure connection.
      </p>

      <div className="step-body">
        {/* Service Account key */}
        <div className="form-group">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label className="form-label" style={{ marginBottom: 0 }}>
              Firebase Service Account key
            </label>
            <label className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, height: 'auto', border: '1px solid var(--border-subtle)' }}>
              Upload JSON file
              <input
                type="file"
                accept=".json"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          {fileError && (
            <div style={{ color: 'var(--accent-red)', fontSize: 12, marginBottom: 6 }}>{fileError}</div>
          )}

          <textarea
            id="firebase-service-account-key"
            className="form-input"
            rows={5}
            placeholder='{&#10;  "type": "service_account",&#10;  "project_id": "your-project-id",&#10;  "private_key": "-----BEGIN PRIVATE KEY-----\n..."&#10;}'
            value={serviceAccount}
            onChange={e => { setServiceAccount(e.target.value); setResult(null); }}
            autoComplete="off"
            spellCheck={false}
            style={{ fontFamily: 'monospace', fontSize: 12.5, whiteSpace: 'pre', resize: 'vertical' }}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Shield size={11} />
            <span>Generate this in Firebase Console → Project Settings → Service Accounts → Generate new private key.</span>
          </div>

          {result && !result.success && (
            <div style={{ marginTop: 12, padding: '12px 14px', background: 'rgba(248,97,79,0.04)', border: '1px solid rgba(248,97,79,0.15)', borderRadius: 'var(--radius-md)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 13, color: 'var(--accent-red)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={14} /> Connection Test Failed
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {result.message}
              </div>
            </div>
          )}
        </div>

        {/* Collections */}
        <div className="form-group" style={{ marginTop: 16 }}>
          <label className="form-label" htmlFor="collections-to-back-up">
            Which collections should we back up?
          </label>
          <input
            id="collections-to-back-up"
            className="form-input"
            type="text"
            placeholder="e.g. users, projects, logs (comma-separated)"
            value={collections}
            onChange={e => setCollections(e.target.value)}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Leave empty to back up all top-level collections.
          </div>
        </div>

        {/* Result & Testing */}
        <div className="flex items-center justify-between" style={{ marginTop: 12 }}>
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
            disabled={testing || !serviceAccount.trim()}
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
            onClick={() => onNext(serviceAccount, collections)}
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
        {/* Provider dropdown */}
        <div className="form-group">
          <label className="form-label" htmlFor="storage-provider">Storage provider</label>
          <select
            id="storage-provider"
            className="form-select"
            value={storageType}
            onChange={e => { setStorageType(e.target.value as StorageType); setResult(null); }}
          >
            <option value="r2">Cloudflare R2</option>
            <option value="s3">AWS S3</option>
          </select>
        </div>

        <div className="settings-row">
          <div className="form-group">
            <label className="form-label" htmlFor="storage-access-key">Access Key ID</label>
            <input
              id="storage-access-key"
              className="form-input"
              type="text"
              placeholder="AKIAIOSFODNN7EXAMPLE"
              value={creds.access_key}
              onChange={e => update('access_key', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="storage-secret-key">Secret Access Key</label>
            <input
              id="storage-secret-key"
              className="form-input"
              type="password"
              placeholder="••••••••••••••••"
              value={creds.secret_key}
              onChange={e => update('secret_key', e.target.value)}
            />
          </div>
        </div>

        <div className="settings-row">
          <div className="form-group">
            <label className="form-label" htmlFor="storage-bucket">Bucket name</label>
            <input
              id="storage-bucket"
              className="form-input"
              type="text"
              placeholder="my-backups"
              value={creds.bucket}
              onChange={e => update('bucket', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label className="form-label" htmlFor="storage-endpoint">Endpoint URL <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({storageType === 'r2' ? 'Required' : 'Optional'})</span></label>
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
        <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
          <div>
            {result && (
              <div className={`connection-result ${result.success ? 'success' : 'error'}`}>
                {result.success ? <CheckCircle size={17} /> : <XCircle size={17} />}
                {result.success
                  ? 'Success! Write permissions verified — test object created and deleted.'
                  : result.message}
              </div>
            )}
          </div>
          <button
            id="verify-storage-btn"
            className="btn btn-ghost"
            onClick={handleVerify}
            disabled={testing || !creds.access_key.trim() || !creds.secret_key.trim() || !creds.bucket.trim() || !creds.endpoint.trim()}
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
        {/* Frequency selector dropdown */}
        <div className="form-group">
          <label className="form-label" htmlFor="backup-frequency">Backup frequency</label>
          <select
            id="backup-frequency"
            className="form-select"
            value={schedule}
            onChange={e => setSchedule(e.target.value as ScheduleType)}
          >
            <option value="hourly">Hourly (Best for high-frequency write apps)</option>
            <option value="12h">Every 12 hours (Balanced cost and protection)</option>
            <option value="daily">Daily (Recommended starting point)</option>
          </select>
        </div>

        {/* Retention */}
        <div className="form-group">
          <label className="form-label" htmlFor="retention-count">Retention policy</label>
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
          <label className="form-label" htmlFor="webhook-url">
            Failure webhook URL <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
          </label>
          <input
            id="webhook-url"
            className="form-input"
            type="url"
            placeholder="e.g., https://discord.com/api/webhooks/... or Slack"
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
  const [serviceAccount, setServiceAccount] = useState('');
  const [collections, setCollections] = useState('');
  const [storageType, setStorageType] = useState<StorageType>('r2');
  const [storageCreds, setStorageCreds] = useState<Pipeline['storage_credentials']>({
    access_key: '', secret_key: '', bucket: '', endpoint: '',
  });

  function handleStep1Next(sa: string, cols: string) {
    setServiceAccount(sa);
    setCollections(cols);
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
        database_type: 'firestore',
        firebase_service_account_encrypted: serviceAccount,
        collections: collections ? collections.split(',').map(s => s.trim()).filter(Boolean) : null,
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

      await seedMockRuns(pipeline.id, user.uid);
      
      // Reset onboarding local state
      setServiceAccount('');
      setCollections('');
      setStorageCreds({ access_key: '', secret_key: '', bucket: '', endpoint: '' });
      setStorageType('r2');

      // Dispatch global toast event
      window.dispatchEvent(new CustomEvent('show-toast', { detail: 'Pipeline activated successfully!' }));

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
            serviceAccount={serviceAccount}
            setServiceAccount={setServiceAccount}
            collections={collections}
            setCollections={setCollections}
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
