import type { Pipeline, Run, RunStatus, UserSettings, LogEntry } from '../types';
import { USE_MOCK, db } from './firebase';
import {
  collection, doc, setDoc, getDocs, deleteDoc, updateDoc, getDoc,
  query, where, onSnapshot, arrayUnion,
} from 'firebase/firestore';

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function generateId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

// ═══════════════════════════════════════════════════════════
// LOCAL-STORAGE (mock mode)
// ═══════════════════════════════════════════════════════════

const PIPELINES_KEY = 'sg_pipelines_v2';
const RUNS_KEY = 'sg_runs_v2';
const SETTINGS_PREFIX = 'sg_settings_';

function lsGetPipelines(userId: string): Pipeline[] {
  const raw = localStorage.getItem(PIPELINES_KEY);
  const all: Pipeline[] = raw ? JSON.parse(raw) : [];
  return all.filter((p) => p.user_id === userId);
}

function lsGetRuns(pipelineId: string): Run[] {
  const raw = localStorage.getItem(RUNS_KEY);
  const all: Run[] = raw ? JSON.parse(raw) : [];
  return all
    .filter((r) => r.pipelineId === pipelineId)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

function lsSavePipeline(pipeline: Omit<Pipeline, 'id'> & { id?: string }): Pipeline {
  const raw = localStorage.getItem(PIPELINES_KEY);
  const all: Pipeline[] = raw ? JSON.parse(raw) : [];
  const id = pipeline.id || generateId();
  const name = pipeline.name || `Backup Pipeline (${pipeline.database_type === 'firestore' ? 'Firestore' : 'RTDB'})`;
  const updated: Pipeline = { ...pipeline, id, name } as Pipeline;
  const idx = all.findIndex((p) => p.id === id);
  if (idx >= 0) all[idx] = updated; else all.push(updated);
  localStorage.setItem(PIPELINES_KEY, JSON.stringify(all));
  return updated;
}

function lsSaveRun(run: Omit<Run, 'id'> & { id?: string }): Run {
  const raw = localStorage.getItem(RUNS_KEY);
  const all: Run[] = raw ? JSON.parse(raw) : [];
  const id = run.id || generateId();
  const updated: Run = { ...run, id } as Run;
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) all[idx] = updated; else all.push(updated);
  localStorage.setItem(RUNS_KEY, JSON.stringify(all));
  return updated;
}

function lsUpdateRunStatus(id: string, status: RunStatus, extra?: Partial<Run>): void {
  const raw = localStorage.getItem(RUNS_KEY);
  const all: Run[] = raw ? JSON.parse(raw) : [];
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx] = { ...all[idx], status, ...(extra ?? {}) };
    localStorage.setItem(RUNS_KEY, JSON.stringify(all));
  }
}

function lsUpdateRunLogs(id: string, logEntry: LogEntry): void {
  const raw = localStorage.getItem(RUNS_KEY);
  const all: Run[] = raw ? JSON.parse(raw) : [];
  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx].logs = [...(all[idx].logs || []), logEntry];
    localStorage.setItem(RUNS_KEY, JSON.stringify(all));
  }
}

function lsDeletePipeline(id: string): void {
  const raw = localStorage.getItem(PIPELINES_KEY);
  const all: Pipeline[] = raw ? JSON.parse(raw) : [];
  localStorage.setItem(PIPELINES_KEY, JSON.stringify(all.filter((p) => p.id !== id)));
  const runsRaw = localStorage.getItem(RUNS_KEY);
  const runs: Run[] = runsRaw ? JSON.parse(runsRaw) : [];
  localStorage.setItem(RUNS_KEY, JSON.stringify(runs.filter((r) => r.pipelineId !== id)));
}

function lsGetUserSettings(userId: string): UserSettings {
  const raw = localStorage.getItem(SETTINGS_PREFIX + userId);
  if (raw) return JSON.parse(raw);
  return {
    slack_webhook_url: '',
    discord_webhook_url: '',
    telegram_bot_token: '',
    mfa_enabled: false,
    dark_mode: true,
  };
}

function lsSaveUserSettings(userId: string, settings: UserSettings): void {
  localStorage.setItem(SETTINGS_PREFIX + userId, JSON.stringify(settings));
}

// ═══════════════════════════════════════════════════════════
// FIRESTORE helpers (real mode)
// ═══════════════════════════════════════════════════════════

async function fsGetPipelines(userId: string): Promise<Pipeline[]> {
  const q = query(collection(db!, 'pipelines'), where('user_id', '==', userId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pipeline));
}

async function fsGetRuns(pipelineId: string): Promise<Run[]> {
  const q = query(collection(db!, 'runs'), where('pipelineId', '==', pipelineId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Run))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

async function fsSavePipeline(pipeline: Omit<Pipeline, 'id'> & { id?: string }): Promise<Pipeline> {
  const id = pipeline.id || generateId();
  const name = pipeline.name || `Backup Pipeline (${pipeline.database_type === 'firestore' ? 'Firestore' : 'RTDB'})`;
  const data: Pipeline = { ...pipeline, id, name } as Pipeline;
  await setDoc(doc(collection(db!, 'pipelines'), id), data, { merge: true });
  return data;
}

async function fsSaveRun(run: Omit<Run, 'id'> & { id?: string }): Promise<Run> {
  const id = run.id || generateId();
  const data: Run = { ...run, id } as Run;
  await setDoc(doc(collection(db!, 'runs'), id), data, { merge: true });
  return data;
}

async function fsUpdateRunStatus(id: string, status: RunStatus, extra?: Partial<Run>): Promise<void> {
  await updateDoc(doc(collection(db!, 'runs'), id), {
    status,
    ...(extra ?? {}),
  } as Record<string, unknown>);
}

async function fsUpdateRunLogs(id: string, logEntry: LogEntry): Promise<void> {
  await updateDoc(doc(collection(db!, 'runs'), id), {
    logs: arrayUnion(logEntry),
  });
}

async function fsDeletePipeline(id: string): Promise<void> {
  await deleteDoc(doc(collection(db!, 'pipelines'), id));
  const q = query(collection(db!, 'runs'), where('pipelineId', '==', id));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

async function fsGetUserSettings(userId: string): Promise<UserSettings> {
  const docRef = doc(db!, 'users', userId, 'settings', 'global');
  const snap = await getDoc(docRef);
  if (snap.exists()) {
    return snap.data() as UserSettings;
  }
  return {
    slack_webhook_url: '',
    discord_webhook_url: '',
    telegram_bot_token: '',
    mfa_enabled: false,
    dark_mode: true,
  };
}

async function fsSaveUserSettings(userId: string, settings: UserSettings): Promise<void> {
  const docRef = doc(db!, 'users', userId, 'settings', 'global');
  await setDoc(docRef, settings, { merge: true });
}

// ═══════════════════════════════════════════════════════════
// PUBLIC API — async, routes to Firestore or localStorage
// ═══════════════════════════════════════════════════════════

export async function getPipelines(userId: string): Promise<Pipeline[]> {
  return USE_MOCK ? lsGetPipelines(userId) : fsGetPipelines(userId);
}

export async function getRuns(pipelineId: string): Promise<Run[]> {
  return USE_MOCK ? lsGetRuns(pipelineId) : fsGetRuns(pipelineId);
}

export async function savePipeline(
  pipeline: Omit<Pipeline, 'id'> & { id?: string }
): Promise<Pipeline> {
  return USE_MOCK ? lsSavePipeline(pipeline) : fsSavePipeline(pipeline);
}

export async function saveRun(run: Omit<Run, 'id'> & { id?: string }): Promise<Run> {
  return USE_MOCK ? lsSaveRun(run) : fsSaveRun(run);
}

export async function updateRunStatus(
  id: string,
  status: RunStatus,
  extra?: Partial<Run>
): Promise<void> {
  if (USE_MOCK) { lsUpdateRunStatus(id, status, extra); return; }
  return fsUpdateRunStatus(id, status, extra);
}

export async function updateRunLogs(id: string, logEntry: LogEntry): Promise<void> {
  if (USE_MOCK) { lsUpdateRunLogs(id, logEntry); return; }
  return fsUpdateRunLogs(id, logEntry);
}

export async function deletePipeline(id: string): Promise<void> {
  if (USE_MOCK) { lsDeletePipeline(id); return; }
  return fsDeletePipeline(id);
}

export async function deleteAllUserData(userId: string): Promise<void> {
  const pipelines = await getPipelines(userId);
  await Promise.all(pipelines.map((p) => deletePipeline(p.id)));
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  return USE_MOCK ? lsGetUserSettings(userId) : fsGetUserSettings(userId);
}

export async function saveUserSettings(userId: string, settings: UserSettings): Promise<void> {
  if (USE_MOCK) { lsSaveUserSettings(userId, settings); return; }
  return fsSaveUserSettings(userId, settings);
}

// ═══════════════════════════════════════════════════════════
// REAL-TIME SUBSCRIPTION
// ═══════════════════════════════════════════════════════════

export function subscribeToRuns(
  pipelineId: string,
  callback: (runs: Run[]) => void
): () => void {
  if (USE_MOCK) {
    const poll = () => callback(lsGetRuns(pipelineId));
    poll();
    const interval = setInterval(poll, 600);
    return () => clearInterval(interval);
  }

  const q = query(
    collection(db!, 'runs'),
    where('pipelineId', '==', pipelineId),
  );

  return onSnapshot(q, (snap) => {
    const runs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Run))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    callback(runs);
  }, (err) => {
    console.error('onSnapshot error:', err.message);
  });
}

// ═══════════════════════════════════════════════════════════
// REAL-TIME PIPELINES SUBSCRIPTION
// ═══════════════════════════════════════════════════════════

export function subscribeToPipelines(
  userId: string,
  callback: (pipelines: Pipeline[]) => void
): () => void {
  if (USE_MOCK) {
    const poll = () => callback(lsGetPipelines(userId));
    poll();
    const interval = setInterval(poll, 1000);
    return () => clearInterval(interval);
  }

  const q = query(
    collection(db!, 'pipelines'),
    where('user_id', '==', userId)
  );

  return onSnapshot(q, (snap) => {
    const pipelines = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pipeline));
    callback(pipelines);
  }, (err) => {
    console.error('Pipelines onSnapshot error:', err.message);
  });
}

// ═══════════════════════════════════════════════════════════
// SEED demo runs (new schema)
// ═══════════════════════════════════════════════════════════

export async function seedMockRuns(pipelineId: string): Promise<void> {
  const existing = await getRuns(pipelineId);
  if (existing.length > 0) return;

  const now = Date.now();
  const day = 86400000;

  const completedLogs: LogEntry[] = [
    { timestamp: new Date(now - 45000).toISOString(), level: 'info',    message: 'Pipeline triggered by schedule.' },
    { timestamp: new Date(now - 43000).toISOString(), level: 'info',    message: 'Connecting to Firestore database...' },
    { timestamp: new Date(now - 41000).toISOString(), level: 'info',    message: 'Fetching collections and exporting documents...' },
    { timestamp: new Date(now - 39000).toISOString(), level: 'info',    message: 'Compressing backup archive (tar.gz)...' },
    { timestamp: new Date(now - 37000).toISOString(), level: 'info',    message: 'Connecting to Cloudflare R2 storage target...' },
    { timestamp: new Date(now - 36000).toISOString(), level: 'success', message: 'Backup successfully written to Cloudflare R2!' },
  ];

  const failedLogs: LogEntry[] = [
    { timestamp: new Date(now - day * 5).toISOString(), level: 'info',  message: 'Pipeline triggered by schedule.' },
    { timestamp: new Date(now - day * 5 + 2000).toISOString(), level: 'info',  message: 'Connecting to Firestore database...' },
    { timestamp: new Date(now - day * 5 + 4000).toISOString(), level: 'info',  message: 'Fetching collections and exporting documents...' },
    { timestamp: new Date(now - day * 5 + 6000).toISOString(), level: 'info',  message: 'Compressing backup archive (tar.gz)...' },
    { timestamp: new Date(now - day * 5 + 8000).toISOString(), level: 'info',  message: 'Connecting to Cloudflare R2 storage target...' },
    { timestamp: new Date(now - day * 5 + 9000).toISOString(), level: 'error', message: 'Error: Cloudflare R2 Authentication Failed. Invalid Access Key ID.' },
  ];

  const restoreLogs: LogEntry[] = [
    { timestamp: new Date(now - day * 2).toISOString(), level: 'info',    message: 'Restore check initiated (weekly schedule).' },
    { timestamp: new Date(now - day * 2 + 5000).toISOString(), level: 'info',    message: 'Downloading latest backup archive from R2...' },
    { timestamp: new Date(now - day * 2 + 30000).toISOString(), level: 'info',    message: 'Restoring into ephemeral sandbox environment...' },
    { timestamp: new Date(now - day * 2 + 90000).toISOString(), level: 'info',    message: 'Validating document counts and integrity...' },
    { timestamp: new Date(now - day * 2 + 115000).toISOString(), level: 'success', message: 'Restore verified — all 1,247 documents recovered successfully.' },
  ];

  const entries: Omit<Run, 'id'>[] = [
    {
      pipelineId, type: 'backup', status: 'completed',
      startedAt:  new Date(now - day * 0.5).toISOString(),
      endedAt:    new Date(now - day * 0.5 + 45000).toISOString(),
      storageUsedBytes: 1_289_748_480, logs: completedLogs,
    },
    {
      pipelineId, type: 'restore_check', status: 'completed',
      startedAt:  new Date(now - day * 2).toISOString(),
      endedAt:    new Date(now - day * 2 + 120000).toISOString(),
      storageUsedBytes: 1_289_748_480, logs: restoreLogs,
    },
    {
      pipelineId, type: 'backup', status: 'completed',
      startedAt:  new Date(now - day * 3).toISOString(),
      endedAt:    new Date(now - day * 3 + 38000).toISOString(),
      storageUsedBytes: 1_245_982_720, logs: completedLogs,
    },
    {
      pipelineId, type: 'backup', status: 'failed',
      startedAt:  new Date(now - day * 5).toISOString(),
      endedAt:    new Date(now - day * 5 + 9000).toISOString(),
      storageUsedBytes: 0, logs: failedLogs,
    },
    {
      pipelineId, type: 'backup', status: 'completed',
      startedAt:  new Date(now - day * 6).toISOString(),
      endedAt:    new Date(now - day * 6 + 41000).toISOString(),
      storageUsedBytes: 1_198_000_000, logs: completedLogs,
    },
    {
      pipelineId, type: 'backup', status: 'completed',
      startedAt:  new Date(now - day * 10).toISOString(),
      endedAt:    new Date(now - day * 10 + 40000).toISOString(),
      storageUsedBytes: 1_100_000_000, logs: completedLogs,
    },
  ];

  await Promise.all(entries.map((e) => saveRun(e)));
}
