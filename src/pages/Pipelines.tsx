import { useState, useEffect } from 'react';
import {
  Database, Trash2, Edit2, Plus, Loader2, CheckCircle, XCircle, Settings, HelpCircle, ToggleLeft, ToggleRight
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { savePipeline, deletePipeline, subscribeToPipelines, seedMockRuns } from '../services/db';
import { testDatabaseConnection, testStorageConnection } from '../services/simulator';
import type { Pipeline, StorageType, ScheduleType, RestoreCheckFrequency } from '../types';

// ─── Modal confirmation for pipeline deletion ───────────────────────────────
function DeleteConfirmModal({
  pipelineName, onConfirm, onCancel
}: {
  pipelineName: string; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-title" style={{ color: 'var(--accent-red)' }}>Delete pipeline?</div>
        <div className="modal-body">
          Are you sure you want to delete <strong>{pipelineName}</strong>? This will permanently remove the configuration and all associated backup execution logs. This action cannot be undone.
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>Delete Pipeline</button>
        </div>
      </div>
    </div>
  );
}

// ─── Pipeline Edit/Create Form Modal ─────────────────────────────────────────
function PipelineFormModal({
  pipeline, userId, onSave, onCancel
}: {
  pipeline: Partial<Pipeline> | null;
  userId: string;
  onSave: () => void;
  onCancel: () => void;
}) {
  const isEdit = !!pipeline?.id;

  // Form states
  const [name, setName] = useState(pipeline?.name || '');
  const [firebaseServiceAccount, setFirebaseServiceAccount] = useState(
    pipeline?.firebase_service_account_encrypted || ''
  );
  const [collections, setCollections] = useState(
    pipeline?.collections ? pipeline.collections.join(', ') : ''
  );
  const [storageType, setStorageType] = useState<StorageType>(pipeline?.storage_type || 'r2');
  const [accessKey, setAccessKey] = useState(pipeline?.storage_credentials?.access_key || '');
  const [secretKey, setSecretKey] = useState(pipeline?.storage_credentials?.secret_key || '');
  const [bucket, setBucket] = useState(pipeline?.storage_credentials?.bucket || '');
  const [endpoint, setEndpoint] = useState(pipeline?.storage_credentials?.endpoint || '');
  const [schedule, setSchedule] = useState<ScheduleType>(pipeline?.schedule || 'daily');
  const [retention, setRetention] = useState(pipeline?.retention_count || 14);
  const [restoreFreq, setRestoreFreq] = useState<RestoreCheckFrequency>(pipeline?.restore_check_frequency || 'weekly');
  const [webhook, setWebhook] = useState(pipeline?.webhook_url || '');
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(pipeline?.notify_on_success_too ?? false);

  // Connection testing states
  const [testingDb, setTestingDb] = useState(false);
  const [dbResult, setDbResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingStorage, setTestingStorage] = useState(false);
  const [storageResult, setStorageResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [fileError, setFileError] = useState('');

  async function handleTestDb() {
    setTestingDb(true);
    setDbResult(null);
    const r = await testDatabaseConnection(firebaseServiceAccount);
    setDbResult(r);
    setTestingDb(false);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      setFirebaseServiceAccount(text);
      setDbResult(null);
      setFileError('');
    };
    reader.onerror = () => {
      setFileError('Failed to read key file.');
    };
    reader.readAsText(file);
  }

  async function handleTestStorage() {
    setTestingStorage(true);
    setStorageResult(null);
    const r = await testStorageConnection({
      access_key: accessKey, secret_key: secretKey, bucket, endpoint
    });
    setStorageResult(r);
    setTestingStorage(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter a pipeline name.'); return; }
    if (!firebaseServiceAccount.trim()) { setError('Please provide a Firebase Service Account key.'); return; }
    if (!accessKey || !secretKey || !bucket || !endpoint) { setError('Please complete all storage credentials.'); return; }

    setError('');
    setSaving(true);

    try {
      const saved = await savePipeline({
        id: pipeline?.id,
        name,
        user_id: userId,
        database_type: 'firestore',
        firebase_service_account_encrypted: firebaseServiceAccount,
        collections: collections ? collections.split(',').map(s => s.trim()).filter(Boolean) : null,
        storage_type: storageType,
        storage_credentials: { access_key: accessKey, secret_key: secretKey, bucket, endpoint },
        schedule,
        retention_count: retention,
        restore_check_frequency: restoreFreq,
        webhook_url: webhook,
        notify_on_success_too: notifyOnSuccess,
        created_at: pipeline?.created_at || new Date().toISOString(),
        status: pipeline?.status || 'active',
      });

      // If creating a brand new pipeline, seed initial logs
      if (!isEdit) {
        await seedMockRuns(saved.id);
      }

      onSave();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save pipeline');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div
        className="modal-box animate-slide-up"
        onClick={e => e.stopPropagation()}
        style={{ maxWidth: 640, width: '90%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-title" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 16 }}>
          {isEdit ? 'Edit Backup Pipeline' : 'Create New Pipeline'}
        </div>

        {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Pipeline Name */}
          <div className="form-group">
            <label className="form-label">Pipeline name</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Production Firestore Backup"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          {/* Database Setup */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>1. Database Source (Firebase / Firestore)</h3>
            
            <div className="form-group" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Firebase Service Account key</label>
                <label className="btn btn-ghost btn-sm" style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, height: 'auto', border: '1px solid var(--border-subtle)' }}>
                  Upload JSON
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
                className="form-input"
                rows={4}
                placeholder='{&#10;  "type": "service_account",&#10;  "project_id": "your-project-id",&#10;  "private_key": "-----BEGIN PRIVATE KEY-----\n..."&#10;}'
                value={firebaseServiceAccount}
                onChange={e => { setFirebaseServiceAccount(e.target.value); setDbResult(null); }}
                autoComplete="off"
                spellCheck={false}
                style={{ fontFamily: 'monospace', fontSize: 12, whiteSpace: 'pre', resize: 'vertical' }}
              />
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
                Generate this in Firebase Console → Project Settings → Service Accounts → Generate new private key.
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Which collections should we back up?</label>
              <input
                className="form-input"
                type="text"
                placeholder="e.g. users, projects, logs (comma-separated)"
                value={collections}
                onChange={e => setCollections(e.target.value)}
              />
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 5 }}>
                Leave empty to back up all top-level collections.
              </div>
            </div>

            <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
              {dbResult && (
                <div className={`connection-result ${dbResult.success ? 'success' : 'error'}`} style={{ padding: 0 }}>
                  {dbResult.success ? <CheckCircle size={15} /> : <XCircle size={15} />}
                  <span style={{ fontSize: 13 }}>{dbResult.message}</span>
                </div>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleTestDb}
                disabled={testingDb || !firebaseServiceAccount}
                style={{ marginLeft: 'auto' }}
              >
                {testingDb ? 'Testing...' : 'Test Connection'}
              </button>
            </div>
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          {/* Storage Target */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>2. Storage Target</h3>
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Storage Provider</label>
              <div className="toggle-group" style={{ maxWidth: 260 }}>
                <button
                  type="button"
                  className={`toggle-btn ${storageType === 'r2' ? 'active' : ''}`}
                  onClick={() => setStorageType('r2')}
                >Cloudflare R2</button>
                <button
                  type="button"
                  className={`toggle-btn ${storageType === 's3' ? 'active' : ''}`}
                  onClick={() => setStorageType('s3')}
                >AWS S3</button>
              </div>
            </div>

            <div className="settings-row" style={{ marginBottom: 12 }}>
              <div className="form-group">
                <label className="form-label">Access Key ID</label>
                <input className="form-input" type="text" placeholder="AKIAIOSFODNN7EXAMPLE" value={accessKey} onChange={e => { setAccessKey(e.target.value); setStorageResult(null); }} required />
              </div>
              <div className="form-group">
                <label className="form-label">Secret Access Key</label>
                <input className="form-input" type="password" placeholder="••••••••••••••••" value={secretKey} onChange={e => { setSecretKey(e.target.value); setStorageResult(null); }} required />
              </div>
            </div>

            <div className="settings-row">
              <div className="form-group">
                <label className="form-label">Bucket Name</label>
                <input className="form-input" type="text" placeholder="backup-bucket" value={bucket} onChange={e => { setBucket(e.target.value); setStorageResult(null); }} required />
              </div>
              <div className="form-group">
                <label className="form-label">Endpoint URL</label>
                <input className="form-input" type="url" placeholder="https://<account-id>.r2.cloudflarestorage.com" value={endpoint} onChange={e => { setEndpoint(e.target.value); setStorageResult(null); }} required />
              </div>
            </div>

            <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
              {storageResult && (
                <div className={`connection-result ${storageResult.success ? 'success' : 'error'}`} style={{ padding: 0 }}>
                  {storageResult.success ? <CheckCircle size={15} /> : <XCircle size={15} />}
                  <span style={{ fontSize: 13 }}>{storageResult.message}</span>
                </div>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleTestStorage}
                disabled={testingStorage || !accessKey || !secretKey || !bucket || !endpoint}
                style={{ marginLeft: 'auto' }}
              >
                {testingStorage ? 'Verifying...' : 'Verify Storage Target'}
              </button>
            </div>
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          {/* Schedule & Retention */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>3. Schedule &amp; Notifications</h3>
            <div className="settings-row" style={{ marginBottom: 12 }}>
              <div className="form-group">
                <label className="form-label">Backup Frequency</label>
                <select className="form-select" value={schedule} onChange={e => setSchedule(e.target.value as ScheduleType)}>
                  <option value="hourly">Hourly</option>
                  <option value="12h">Every 12 hours</option>
                  <option value="daily">Daily</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Retention Count</label>
                <input className="form-number" type="number" min={1} max={365} value={retention} onChange={e => setRetention(Number(e.target.value))} required />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <div className="flex items-center gap-2" style={{ marginBottom: 6 }}>
                <label className="form-label" style={{ marginBottom: 0 }}>Restore check frequency</label>
                <div className="tooltip-wrapper">
                  <HelpCircle size={14} style={{ color: 'var(--text-muted)', cursor: 'help' }} />
                  <span className="tooltip-text">
                    We restore your latest backup into a sandbox and verify it's recoverable — not just that a file exists.
                  </span>
                </div>
              </div>
              <select className="form-select" value={restoreFreq} onChange={e => setRestoreFreq(e.target.value as RestoreCheckFrequency)}>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="off">Off</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Webhook URL</label>
              <input className="form-input" type="url" placeholder="https://hooks.slack.com/services/..." value={webhook} onChange={e => setWebhook(e.target.value)} />
            </div>

            <label className="checkbox-label">
              <input type="checkbox" checked={!notifyOnSuccess} onChange={e => setNotifyOnSuccess(!e.target.checked)} />
              Only notify on failure
            </label>
          </div>

          {/* Form Actions */}
          <div className="modal-actions" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 12 }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : 'Save Pipeline'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Pipelines Main Page Component ──────────────────────────────────────────
export default function Pipelines() {
  const { user } = useAuth();
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal control states
  const [formModal, setFormModal] = useState<{ isOpen: boolean; data: Partial<Pipeline> | null }>({ isOpen: false, data: null });
  const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean; id: string; name: string }>({ isOpen: false, id: '', name: '' });

  useEffect(() => {
    if (!user) return;
    setLoading(true);

    const unsubscribe = subscribeToPipelines(user.uid, (data) => {
      setPipelines(data);
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  async function handleToggleActive(pipeline: Pipeline) {
    const updatedStatus = pipeline.status === 'active' ? 'inactive' : 'active';
    await savePipeline({
      ...pipeline,
      status: updatedStatus,
    });
  }

  async function handleDeleteConfirm() {
    if (!deleteModal.id) return;
    await deletePipeline(deleteModal.id);
    setDeleteModal({ isOpen: false, id: '', name: '' });
  }

  return (
    <div className="main-content animate-fade-in">
      {/* Modals */}
      {formModal.isOpen && (
        <PipelineFormModal
          pipeline={formModal.data}
          userId={user?.uid || ''}
          onSave={() => setFormModal({ isOpen: false, data: null })}
          onCancel={() => setFormModal({ isOpen: false, data: null })}
        />
      )}

      {deleteModal.isOpen && (
        <DeleteConfirmModal
          pipelineName={deleteModal.name}
          onConfirm={handleDeleteConfirm}
          onCancel={() => setDeleteModal({ isOpen: false, id: '', name: '' })}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <h1 className="page-title">Pipelines</h1>
        <button
          id="create-pipeline-btn"
          className="btn btn-dark"
          onClick={() => setFormModal({ isOpen: true, data: null })}
        >
          <Plus size={16} /> Create pipeline
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
          <div className="spinner spinner-blue" style={{ width: 28, height: 28, borderWidth: 3 }} />
        </div>
      ) : pipelines.length === 0 ? (
        <div className="empty-state card">
          <div className="empty-state-icon">
            <Settings size={28} />
          </div>
          <div>No pipelines configured. Get started by creating your first backup pipeline!</div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => setFormModal({ isOpen: true, data: null })}
          >
            Create pipeline
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {pipelines.map((pipeline) => {
            const isPipelineActive = pipeline.status === 'active';
            const dbLabel = pipeline.database_type === 'firestore' ? 'Firestore' : 'Realtime DB';
            const storageLabel = pipeline.storage_type === 'r2' ? 'Cloudflare R2' : 'AWS S3';
            const scheduleSummary = pipeline.schedule === 'hourly' ? 'Hourly' : pipeline.schedule === '12h' ? 'Every 12 Hours' : 'Daily';

            return (
              <div key={pipeline.id} className="card flex items-center justify-between" style={{ padding: 'var(--space-5) var(--space-6)' }}>
                {/* Info Column */}
                <div className="flex items-center gap-4">
                  <div
                    className="flex items-center justify-center"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 'var(--radius-md)',
                      background: 'var(--bg-elevated)',
                      border: '1px solid var(--border)',
                      color: isPipelineActive ? 'var(--accent-blue)' : 'var(--text-muted)'
                    }}
                  >
                    <Database size={20} />
                  </div>
                  <div className="flex flex-col">
                    <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)' }}>{pipeline.name}</span>
                    <span style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Source:</span> {dbLabel}
                      <span style={{ color: 'var(--text-muted)' }}>• Target:</span> {storageLabel}
                      <span style={{ color: 'var(--text-muted)' }}>• Schedule:</span> {scheduleSummary}
                    </span>
                  </div>
                </div>

                {/* Actions Column */}
                <div className="flex items-center gap-6">
                  {/* Status Toggle Button */}
                  <div className="flex items-center gap-2">
                    <span style={{ fontSize: 12, fontWeight: 500, color: isPipelineActive ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                      {isPipelineActive ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleToggleActive(pipeline)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: isPipelineActive ? 'var(--accent-green)' : 'var(--text-muted)' }}
                    >
                      {isPipelineActive ? <ToggleRight size={34} /> : <ToggleLeft size={34} />}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setFormModal({ isOpen: true, data: pipeline })}
                      title="Edit Pipeline Configuration"
                    >
                      <Edit2 size={13} /> Edit
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => setDeleteModal({ isOpen: true, id: pipeline.id, name: pipeline.name || 'Unnamed Pipeline' })}
                      title="Delete Pipeline"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
