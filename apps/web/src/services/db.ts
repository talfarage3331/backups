import type { Pipeline, Run, RunStatus, UserSettings, LogEntry } from '../types';
import { db, functions } from './firebase';
import {
  collection, doc, setDoc, getDocs, deleteDoc, updateDoc, getDoc,
  query, where, onSnapshot, arrayUnion,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';

function generateId(): string {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

export async function getPipelines(userId: string): Promise<Pipeline[]> {
  const q = query(collection(db, 'pipelines'), where('user_id', '==', userId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pipeline));
}

export async function getRuns(pipelineId: string): Promise<Run[]> {
  const q = query(collection(db, 'runs'), where('pipelineId', '==', pipelineId));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as Run))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

export async function savePipeline(
  pipeline: Omit<Pipeline, 'id'> & { id?: string }
): Promise<Pipeline> {
  const saveSecurely = httpsCallable(functions, 'savePipelineSecurely');
  const result = await saveSecurely(pipeline);
  return result.data as Pipeline;
}

export async function saveRun(run: Omit<Run, 'id'> & { id?: string }): Promise<Run> {
  const id = run.id || generateId();
  const data: Run = { ...run, id } as Run;
  await setDoc(doc(collection(db, 'runs'), id), data, { merge: true });
  return data;
}

export async function updateRunStatus(
  id: string,
  status: RunStatus,
  extra?: Partial<Run>
): Promise<void> {
  await updateDoc(doc(collection(db, 'runs'), id), {
    status,
    ...(extra ?? {}),
  } as Record<string, unknown>);
}

export async function updateRunLogs(id: string, logEntry: LogEntry): Promise<void> {
  await updateDoc(doc(collection(db, 'runs'), id), {
    logs: arrayUnion(logEntry),
  });
}

export async function deletePipeline(id: string): Promise<void> {
  await deleteDoc(doc(collection(db, 'pipelines'), id));
  const q = query(collection(db, 'runs'), where('pipelineId', '==', id));
  const snap = await getDocs(q);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

export async function deleteAllUserData(userId: string): Promise<void> {
  const pipelines = await getPipelines(userId);
  await Promise.all(pipelines.map((p) => deletePipeline(p.id)));
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const docRef = doc(db, 'users', userId, 'settings', 'global');
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

export async function saveUserSettings(userId: string, settings: UserSettings): Promise<void> {
  const docRef = doc(db, 'users', userId, 'settings', 'global');
  await setDoc(docRef, settings, { merge: true });
}

export function subscribeToRuns(
  pipelineId: string,
  callback: (runs: Run[]) => void
): () => void {
  const q = query(
    collection(db, 'runs'),
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

export function subscribeToPipelines(
  userId: string,
  callback: (pipelines: Pipeline[]) => void
): () => void {
  const q = query(
    collection(db, 'pipelines'),
    where('user_id', '==', userId)
  );

  return onSnapshot(q, (snap) => {
    const pipelines = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Pipeline));
    callback(pipelines);
  }, (err) => {
    console.error('Pipelines onSnapshot error:', err.message);
  });
}

export async function seedMockRuns(pipelineId: string, userId: string): Promise<void> {
  const existing = await getRuns(pipelineId);
  if (existing.length > 0) return;

  const now = Date.now();
  const day = 86400000;

  const completedLogs: LogEntry[] = [
    { timestamp: new Date(now - 45000).toISOString(), level: 'info',    message: '[EnvShield] Sync pipeline triggered.' },
    { timestamp: new Date(now - 43000).toISOString(), level: 'info',    message: 'Introspecting source database schema...' },
    { timestamp: new Date(now - 41000).toISOString(), level: 'info',    message: 'Found 14 tables. Loading active masking rules policy...' },
    { timestamp: new Date(now - 39000).toISOString(), level: 'info',    message: 'DAG Subsetting starting sampling (5% subset limit)...' },
    { timestamp: new Date(now - 37000).toISOString(), level: 'info',    message: 'Streaming rows through StreamMaskingTransformer...' },
    { timestamp: new Date(now - 36000).toISOString(), level: 'success', message: 'Sync successfully written to target Neon database branch!' },
  ];

  const failedLogs: LogEntry[] = [
    { timestamp: new Date(now - day * 5).toISOString(), level: 'info',  message: '[EnvShield] Sync pipeline triggered.' },
    { timestamp: new Date(now - day * 5 + 2000).toISOString(), level: 'info',  message: 'Introspecting source database schema...' },
    { timestamp: new Date(now - day * 5 + 4000).toISOString(), level: 'info',  message: 'Found 14 tables. Loading active masking rules policy...' },
    { timestamp: new Date(now - day * 5 + 6000).toISOString(), level: 'info',  message: 'DAG Subsetting starting sampling (5% subset limit)...' },
    { timestamp: new Date(now - day * 5 + 8000).toISOString(), level: 'info',  message: 'Streaming rows through StreamMaskingTransformer...' },
    { timestamp: new Date(now - day * 5 + 9000).toISOString(), level: 'error', message: 'Error: Connection lost to target database. Staged synchronization aborted.' },
  ];

  const scanLogs: LogEntry[] = [
    { timestamp: new Date(now - day * 2).toISOString(), level: 'info',    message: 'Schema PII scan initiated.' },
    { timestamp: new Date(now - day * 2 + 5000).toISOString(), level: 'info',    message: 'Fetching information_schema schema model...' },
    { timestamp: new Date(now - day * 2 + 10000).toISOString(), level: 'info',    message: 'Running regex PII classification scanner...' },
    { timestamp: new Date(now - day * 2 + 15000).toISOString(), level: 'info',    message: 'Running LLM classification fallback on ambiguous columns...' },
    { timestamp: new Date(now - day * 2 + 25000).toISOString(), level: 'success', message: 'Scan complete: Found 12 PII-high risk fields. Policy synced with Control Plane.' },
  ];

  const entries: Omit<Run, 'id'>[] = [
    {
      pipelineId, userId, type: 'sync', status: 'completed',
      startedAt:  new Date(now - day * 0.5).toISOString(),
      endedAt:    new Date(now - day * 0.5 + 45000).toISOString(),
      rowsProcessed: 48732, logs: completedLogs,
    },
    {
      pipelineId, userId, type: 'scan', status: 'completed',
      startedAt:  new Date(now - day * 2).toISOString(),
      endedAt:    new Date(now - day * 2 + 120000).toISOString(),
      rowsProcessed: 0, logs: scanLogs,
    },
    {
      pipelineId, userId, type: 'sync', status: 'completed',
      startedAt:  new Date(now - day * 3).toISOString(),
      endedAt:    new Date(now - day * 3 + 38000).toISOString(),
      rowsProcessed: 47250, logs: completedLogs,
    },
    {
      pipelineId, userId, type: 'sync', status: 'failed',
      startedAt:  new Date(now - day * 5).toISOString(),
      endedAt:    new Date(now - day * 5 + 9000).toISOString(),
      rowsProcessed: 0, logs: failedLogs,
    },
    {
      pipelineId, userId, type: 'sync', status: 'completed',
      startedAt:  new Date(now - day * 6).toISOString(),
      endedAt:    new Date(now - day * 6 + 41000).toISOString(),
      rowsProcessed: 45890, logs: completedLogs,
    },
    {
      pipelineId, userId, type: 'sync', status: 'completed',
      startedAt:  new Date(now - day * 10).toISOString(),
      endedAt:    new Date(now - day * 10 + 40000).toISOString(),
      rowsProcessed: 42100, logs: completedLogs,
    },
  ];

  await Promise.all(entries.map((e) => saveRun(e)));
}
