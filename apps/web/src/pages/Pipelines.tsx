import { useState, useEffect } from 'react';
import {
  Database, Trash2, Edit2, Plus, Loader2, CheckCircle, XCircle, Settings, ToggleLeft, ToggleRight
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { savePipeline, deletePipeline, subscribeToPipelines, seedMockRuns } from '../services/db';
import { testDatabaseConnection, testTargetConnection } from '../services/simulator';
import type { Pipeline, DatabaseEngine, ScheduleType } from '../types';

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
          Are you sure you want to delete <strong>{pipelineName}</strong>? This will permanently remove the configuration and all associated sync logs. This action cannot be undone.
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
  const [sourceDbType, setSourceDbType] = useState<DatabaseEngine>(pipeline?.source_db_type || 'postgres');
  const [sourceDbUrl, setSourceDbUrl] = useState(pipeline?.source_db_url || '');
  const [targetDbUrl, setTargetDbUrl] = useState(pipeline?.target_db_url || '');
  const [subsetPercent, setSubsetPercent] = useState(pipeline?.subset_percentage || 5);
  const [schedule, setSchedule] = useState<ScheduleType>(pipeline?.schedule || 'daily');
  const [webhook, setWebhook] = useState(pipeline?.webhook_url || '');
  const [notifyOnSuccess, setNotifyOnSuccess] = useState(pipeline?.notify_on_success_too ?? false);

  // Connection testing states
  const [testingSource, setTestingSource] = useState(false);
  const [sourceResult, setSourceResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testingTarget, setTestingTarget] = useState(false);
  const [targetResult, setTargetResult] = useState<{ success: boolean; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleTestSource() {
    setTestingSource(true);
    setSourceResult(null);
    const r = await testDatabaseConnection(sourceDbUrl);
    setSourceResult(r);
    setTestingSource(false);
  }

  async function handleTestTarget() {
    setTestingTarget(true);
    setTargetResult(null);
    const r = await testTargetConnection(targetDbUrl);
    setTargetResult(r);
    setTestingTarget(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter a pipeline name.'); return; }
    if (!sourceDbUrl.trim()) { setError('Please provide a source database URL.'); return; }
    if (!targetDbUrl.trim()) { setError('Please provide a target database URL.'); return; }

    setError('');
    setSaving(true);

    try {
      const saved = await savePipeline({
        id: pipeline?.id,
        name,
        user_id: userId,
        source_db_type: sourceDbType,
        source_db_url: sourceDbUrl,
        target_db_url: targetDbUrl,
        subset_percentage: subsetPercent,
        schedule,
        webhook_url: webhook,
        notify_on_success_too: notifyOnSuccess,
        created_at: pipeline?.created_at || new Date().toISOString(),
        status: pipeline?.status || 'active',
      });

      if (!isEdit) {
        await seedMockRuns(saved.id, userId);
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
        style={{ maxWidth: 640, width: '95%', maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div className="modal-title" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 12, marginBottom: 16 }}>
          {isEdit ? 'Edit Sync Pipeline' : 'Create New Sync Pipeline'}
        </div>

        {error && <div className="auth-error" style={{ marginBottom: 16 }}>{error}</div>}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Pipeline Name */}
          <div className="form-group">
            <label className="form-label">Pipeline Name</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Staging Sync & Mask"
              value={name}
              onChange={e => setName(e.target.value)}
              required
            />
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          {/* Source Database Details */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>1. Database Source</h3>
            
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Database Engine</label>
              <select className="form-select" value={sourceDbType} onChange={e => setSourceDbType(e.target.value as DatabaseEngine)}>
                <option value="postgres">PostgreSQL</option>
                <option value="mysql">MySQL</option>
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Source Database Connection String</label>
              <input
                className="form-input"
                type="text"
                placeholder={sourceDbType === 'postgres' ? 'postgresql://user:pass@host:5432/dbname' : 'mysql://user:pass@host:3306/dbname'}
                value={sourceDbUrl}
                onChange={e => { setSourceDbUrl(e.target.value); setSourceResult(null); }}
                required
              />
            </div>

            <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
              {sourceResult && (
                <div className={`connection-result ${sourceResult.success ? 'success' : 'error'}`} style={{ padding: 0 }}>
                  {sourceResult.success ? <CheckCircle size={15} /> : <XCircle size={15} />}
                  <span style={{ fontSize: 13, marginLeft: 4 }}>{sourceResult.message}</span>
                </div>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleTestSource}
                disabled={testingSource || !sourceDbUrl}
                style={{ marginLeft: 'auto' }}
              >
                {testingSource ? 'Testing...' : 'Test Source Connection'}
              </button>
            </div>
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          {/* Target Database Details */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>2. Destination Target</h3>
            
            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Target Database Connection String</label>
              <input
                className="form-input"
                type="text"
                placeholder="postgresql://user:pass@host:5432/staging_db"
                value={targetDbUrl}
                onChange={e => { setTargetDbUrl(e.target.value); setTargetResult(null); }}
                required
              />
            </div>

            <div className="flex items-center justify-between" style={{ marginTop: 8 }}>
              {targetResult && (
                <div className={`connection-result ${targetResult.success ? 'success' : 'error'}`} style={{ padding: 0 }}>
                  {targetResult.success ? <CheckCircle size={15} /> : <XCircle size={15} />}
                  <span style={{ fontSize: 13, marginLeft: 4 }}>{targetResult.message}</span>
                </div>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleTestTarget}
                disabled={testingTarget || !targetDbUrl}
                style={{ marginLeft: 'auto' }}
              >
                {testingTarget ? 'Verifying...' : 'Test Target Connection'}
              </button>
            </div>
          </div>

          <div className="divider" style={{ margin: '8px 0' }} />

          {/* Schedule & Subsetting */}
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 12 }}>3. Policy &amp; Subsetting Config</h3>
            
            <div className="settings-row" style={{ marginBottom: 12 }}>
              <div className="form-group">
                <label className="form-label">Sync Frequency</label>
                <select className="form-select" value={schedule} onChange={e => setSchedule(e.target.value as ScheduleType)}>
                  <option value="hourly">Hourly</option>
                  <option value="12h">Every 12 hours</option>
                  <option value="daily">Daily</option>
                </select>
              </div>
              
              <div className="form-group">
                <label className="form-label">Subsetting Sample ({subsetPercent}%)</label>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={subsetPercent}
                  onChange={e => setSubsetPercent(Number(e.target.value))}
                  style={{ width: '100%', marginTop: 8, accentColor: 'var(--accent-blue)' }}
                />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 12 }}>
              <label className="form-label">Failure Webhook URL (optional)</label>
              <input className="form-input" type="url" placeholder="https://hooks.slack.com/services/..." value={webhook} onChange={e => setWebhook(e.target.value)} />
            </div>

            <label className="checkbox-label">
              <input type="checkbox" checked={notifyOnSuccess} onChange={e => setNotifyOnSuccess(e.target.checked)} />
              Notify on successful sync execution
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
        <h1 className="page-title">Sync Pipelines</h1>
        <button
          id="create-pipeline-btn"
          className="btn btn-dark"
          onClick={() => setFormModal({ isOpen: true, data: null })}
        >
          <Plus size={16} /> Create Sync Pipeline
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
          <div>No active sync pipelines. Get started by creating your first sync configuration!</div>
          <button
            className="btn btn-primary"
            style={{ marginTop: 12 }}
            onClick={() => setFormModal({ isOpen: true, data: null })}
          >
            Create Pipeline
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {pipelines.map((pipeline) => {
            const isPipelineActive = pipeline.status === 'active';
            const sourceLabel = pipeline.source_db_type === 'postgres' ? 'PostgreSQL' : 'MySQL';
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
                      <span style={{ color: 'var(--text-muted)' }}>Source:</span> {sourceLabel}
                      <span style={{ color: 'var(--text-muted)' }}>• Subset:</span> {pipeline.subset_percentage}%
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
