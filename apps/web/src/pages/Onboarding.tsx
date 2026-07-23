import { useState } from 'react';
import {
  CheckCircle, XCircle, ArrowRight, Loader2, Check, AlertTriangle, Shield, Database, Cloud, Clock
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { testDatabaseConnection, testTargetConnection } from '../services/simulator';
import { savePipeline, seedMockRuns } from '../services/db';
import type { ScheduleType, DatabaseEngine } from '../types';

interface OnboardingProps {
  onComplete: () => void;
}

// ─── Timeline progress header ─────────────────────────────────────────────────

function StepTimeline({ step }: { step: number }) {
  const steps = [
    { num: 1, label: 'Source DB' },
    { num: 2, label: 'Sync Target' },
    { num: 3, label: 'Schedule' },
  ];

  return (
    <div className="step-timeline">
      {steps.map((s, i) => {
        const state = s.num < step ? 'done' : s.num === step ? 'active' : 'idle';
        return (
          <div key={s.num} style={{ display: 'flex', alignItems: 'center', flex: s.num === 3 ? 'none' : '1' }}>
            <div className={`step-node ${state}`}>
              <div className="step-node-circle">
                {state === 'done' ? <Check size={14} /> : s.num}
              </div>
              <span className="step-node-label">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`step-node-line ${s.num < step ? 'done' : ''}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Step 1: Source Database ──────────────────────────────────────────────────

function Step1({
  onNext, dbType, setDbType, dbUrl, setDbUrl,
}: {
  onNext: (type: DatabaseEngine, url: string) => void;
  dbType: DatabaseEngine;
  setDbType: (v: DatabaseEngine) => void;
  dbUrl: string;
  setDbUrl: (v: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleTest() {
    setTesting(true);
    setResult(null);
    const r = await testDatabaseConnection(dbUrl);
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
        <h1 className="step-title" style={{ marginBottom: 0 }}>Source Database</h1>
      </div>
      <p className="step-subtitle">
        Enter the connection URL for your production or source database. EnvShield processes data locally.
      </p>

      <div className="step-body">
        <div className="form-group">
          <label className="form-label" htmlFor="db-type">Database Engine</label>
          <select
            id="db-type"
            className="form-select"
            value={dbType}
            onChange={e => { setDbType(e.target.value as DatabaseEngine); setResult(null); }}
          >
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="source-db-url">Connection String</label>
          <input
            id="source-db-url"
            className="form-input"
            type="text"
            placeholder={dbType === 'postgres' ? 'postgresql://user:pass@host:5432/dbname' : 'mysql://user:pass@host:3306/dbname'}
            value={dbUrl}
            onChange={e => { setDbUrl(e.target.value); setResult(null); }}
          />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Shield size={11} />
            <span>Connection credentials will never leave your client or workspace browser.</span>
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
            disabled={testing || !dbUrl.trim()}
          >
            {testing
              ? <><Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> Testing…</>
              : 'Test connection'}
          </button>
        </div>
      </div>

      <div className="step-footer">
        <span className="step-footer-left">EnvShield — onboarding wizard</span>
        <div className="step-actions">
          <button
            id="step1-continue-btn"
            className="btn btn-dark"
            onClick={() => onNext(dbType, dbUrl)}
            disabled={!result?.success}
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Step 2: Target DB / Ephemeral Neon ────────────────────────────────────────

function Step2({
  onNext, onBack, targetUrl, setTargetUrl,
}: {
  onNext: (url: string) => void;
  onBack: () => void;
  targetUrl: string;
  setTargetUrl: (u: string) => void;
}) {
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  async function handleVerify() {
    setTesting(true);
    setResult(null);
    const r = await testTargetConnection(targetUrl);
    setResult(r);
    setTesting(false);
  }

  return (
    <>
      <StepTimeline step={2} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-2)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(79,126,248,0.1)', border: '1px solid rgba(79,126,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Cloud size={18} color="var(--accent-blue)" />
        </div>
        <h1 className="step-title" style={{ marginBottom: 0 }}>Sync Target Database</h1>
      </div>
      <p className="step-subtitle">
        Enter the target database URL (e.g. staging target, local docker, or Neon integration branch).
      </p>

      <div className="step-body">
        <div className="form-group">
          <label className="form-label" htmlFor="target-db-url">Target Connection String</label>
          <input
            id="target-db-url"
            className="form-input"
            type="text"
            placeholder="postgresql://user:pass@host:5432/staging_db"
            value={targetUrl}
            onChange={e => { setTargetUrl(e.target.value); setResult(null); }}
          />
        </div>

        <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
          <div>
            {result && (
              <div className={`connection-result ${result.success ? 'success' : 'error'}`}>
                {result.success ? <CheckCircle size={17} /> : <XCircle size={17} />}
                {result.success
                  ? 'Target verified successfully! Write permissions confirmed.'
                  : result.message}
              </div>
            )}
          </div>
          <button
            id="verify-target-btn"
            className="btn btn-ghost"
            onClick={handleVerify}
            disabled={testing || !targetUrl.trim()}
          >
            {testing
              ? <><Loader2 size={14} style={{ animation: 'spin 0.7s linear infinite' }} /> Verifying…</>
              : 'Verify target'}
          </button>
        </div>
      </div>

      <div className="step-footer">
        <span className="step-footer-left">EnvShield — onboarding wizard</span>
        <div className="step-actions">
          <button id="step2-back-btn" className="btn btn-ghost" onClick={onBack}>Back</button>
          <button
            id="step2-continue-btn"
            className="btn btn-dark"
            onClick={() => onNext(targetUrl)}
            disabled={!result?.success}
          >
            Continue <ArrowRight size={15} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Step 3: Schedule & Subsetting ─────────────────────────────────────────────

function Step3({
  onActivate, onBack, loading,
}: {
  onActivate: (data: { schedule: ScheduleType; subset: number; webhook: string }) => void;
  onBack: () => void;
  loading: boolean;
}) {
  const [schedule, setSchedule] = useState<ScheduleType>('daily');
  const [subset, setSubset] = useState(5);
  const [webhook, setWebhook] = useState('');

  return (
    <>
      <StepTimeline step={3} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 'var(--space-2)' }}>
        <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-md)', background: 'rgba(79,126,248,0.1)', border: '1px solid rgba(79,126,248,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Clock size={18} color="var(--accent-blue)" />
        </div>
        <h1 className="step-title" style={{ marginBottom: 0 }}>Schedule &amp; Subsetting</h1>
      </div>
      <p className="step-subtitle">
        Configure how often schema syncs run and set the database subset sample percentage.
      </p>

      <div className="step-body">
        <div className="form-group">
          <label className="form-label" htmlFor="sync-frequency">Sync frequency</label>
          <select
            id="sync-frequency"
            className="form-select"
            value={schedule}
            onChange={e => setSchedule(e.target.value as ScheduleType)}
          >
            <option value="hourly">Hourly (Best for rapid testing)</option>
            <option value="12h">Every 12 hours</option>
            <option value="daily">Daily (Recommended)</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="subset-percent">Subsetting sample percentage</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              id="subset-percent"
              type="range"
              min={1}
              max={100}
              value={subset}
              onChange={e => setSubset(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent-blue)' }}
            />
            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', width: 45, textAlign: 'right' }}>
              {subset}%
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Traverses primary/foreign key graphs to pull a referentially intact subset. Default is 5%.
          </div>
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="webhook-url">
            Sync failure webhook URL <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>
          </label>
          <input
            id="webhook-url"
            className="form-input"
            type="url"
            placeholder="e.g., https://discord.com/api/webhooks/... or Slack"
            value={webhook}
            onChange={e => setWebhook(e.target.value)}
          />
        </div>
      </div>

      <div className="step-footer">
        <span className="step-footer-left">EnvShield — onboarding wizard</span>
        <div className="step-actions">
          <button id="step3-back-btn" className="btn btn-ghost" onClick={onBack} disabled={loading}>Back</button>
          <button
            id="activate-pipeline-btn"
            className="btn btn-dark btn-lg"
            style={{ gap: 8 }}
            onClick={() => onActivate({ schedule, subset, webhook })}
            disabled={loading}
          >
            {loading
              ? <><Loader2 size={15} style={{ animation: 'spin 0.7s linear infinite' }} /> Activating…</>
              : <><CheckCircle size={15} /> Activate Pipeline</>}
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

  const [dbType, setDbType] = useState<DatabaseEngine>('postgres');
  const [dbUrl, setDbUrl] = useState('');
  const [targetUrl, setTargetUrl] = useState('');

  function handleStep1Next(type: DatabaseEngine, url: string) {
    setDbType(type);
    setDbUrl(url);
    setStep(2);
  }

  function handleStep2Next(url: string) {
    setTargetUrl(url);
    setStep(3);
  }

  async function handleActivate(data: { schedule: ScheduleType; subset: number; webhook: string }) {
    if (!user) return;
    setActivating(true);

    try {
      const pipeline = await savePipeline({
        name: `${dbType === 'postgres' ? 'PostgreSQL' : 'MySQL'} Compliance Sync (${data.schedule})`,
        user_id: user.uid,
        source_db_type: dbType,
        source_db_url: dbUrl,
        target_db_url: targetUrl,
        subset_percentage: data.subset,
        schedule: data.schedule,
        webhook_url: data.webhook,
        notify_on_success_too: false,
        created_at: new Date().toISOString(),
        status: 'active',
      });

      await seedMockRuns(pipeline.id, user.uid);
      
      setDbUrl('');
      setTargetUrl('');

      window.dispatchEvent(new CustomEvent('show-toast', { detail: 'Compliance Pipeline activated successfully!' }));
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
            dbType={dbType}
            setDbType={setDbType}
            dbUrl={dbUrl}
            setDbUrl={setDbUrl}
          />
        )}
        {step === 2 && (
          <Step2
            key="step2"
            onNext={handleStep2Next}
            onBack={() => setStep(1)}
            targetUrl={targetUrl}
            setTargetUrl={setTargetUrl}
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
