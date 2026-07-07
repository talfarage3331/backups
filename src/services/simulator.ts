import type { Pipeline, LogEntry } from '../types';
import { updateRunStatus, updateRunLogs } from './db';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Connection validation ────────────────────────────────────────────────────

function isValidFirebaseConfig(json: Record<string, unknown>): boolean {
  return ['apiKey', 'authDomain', 'projectId'].every(
    (k) => typeof json[k] === 'string' && (json[k] as string).length > 0
  );
}

function isValidServiceAccount(json: Record<string, unknown>): boolean {
  return ['type', 'project_id', 'private_key', 'client_email'].every(
    (k) => typeof json[k] === 'string' && (json[k] as string).length > 0
  );
}

export async function testDatabaseConnection(
  configText: string
): Promise<{ success: boolean; message: string }> {
  await delay(1400 + Math.random() * 600);
  if (!configText.trim())
    return { success: false, message: 'Configuration is empty. Please paste your Firebase config or Service Account JSON.' };

  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(configText); }
  catch { return { success: false, message: 'Invalid JSON. Please check your configuration for syntax errors.' }; }

  if (isValidFirebaseConfig(parsed) || isValidServiceAccount(parsed))
    return { success: true, message: 'Connection successful' };

  const missing = ['apiKey', 'authDomain', 'projectId'].filter((k) => !parsed[k]);
  if (missing.length < 3)
    return { success: false, message: `Firebase config incomplete. Missing: ${missing.join(', ')}.` };
  return { success: false, message: 'Unrecognized format. Provide a Firebase Config JSON or a Service Account JSON.' };
}

export async function testStorageConnection(credentials: {
  access_key: string; secret_key: string; bucket: string; endpoint: string;
}): Promise<{ success: boolean; message: string }> {
  await delay(1600 + Math.random() * 800);
  const missing: string[] = [];
  if (!credentials.access_key.trim()) missing.push('Access Key');
  if (!credentials.secret_key.trim()) missing.push('Secret Key');
  if (!credentials.bucket.trim()) missing.push('Bucket Name');
  if (!credentials.endpoint.trim()) missing.push('Endpoint URL');
  if (missing.length > 0) return { success: false, message: `Missing required fields: ${missing.join(', ')}.` };

  try { new URL(credentials.endpoint); }
  catch { return { success: false, message: 'Endpoint URL is invalid. Must be a fully qualified URL (e.g. https://...).' }; }

  if (credentials.access_key === 'fail')
    return { success: false, message: 'Access denied — invalid credentials or bucket permissions.' };

  return { success: true, message: 'Target verified successfully' };
}

// ─── Backup simulation ────────────────────────────────────────────────────────

function isMockCredential(accessKey: string): boolean {
  return (
    !accessKey ||
    accessKey.includes('EXAMPLE') ||
    accessKey.toLowerCase().includes('mock') ||
    accessKey.toLowerCase().includes('test') ||
    accessKey.length < 10
  );
}

export async function runBackupSimulation(
  pipeline: Pipeline,
  runId: string
): Promise<void> {
  const addLog = async (level: LogEntry['level'], message: string, waitMs = 2000) => {
    await delay(waitMs);
    await updateRunLogs(runId, {
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  };

  await addLog('info',  'Connecting to Firestore database...',                2000);
  await addLog('info',  'Fetching collections and exporting documents...',    2000);
  await addLog('info',  'Compressing backup archive (tar.gz)...',             2000);
  await addLog('info',  'Connecting to Cloudflare R2 storage target...',      2000);

  const isMock = isMockCredential(pipeline.storage_credentials.access_key);

  if (isMock) {
    await addLog('error', 'Error: Cloudflare R2 Authentication Failed. Invalid Access Key ID.', 1000);
    await updateRunStatus(runId, 'failed', { endedAt: new Date().toISOString() });
  } else {
    await addLog('success', 'Backup successfully written to Cloudflare R2!', 1000);
    await updateRunStatus(runId, 'completed', {
      endedAt:         new Date().toISOString(),
      storageUsedBytes: 1_542_450,
    });
  }
}
