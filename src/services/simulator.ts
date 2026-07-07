import type { Pipeline, LogEntry } from '../types';
import { updateRunStatus, updateRunLogs } from './db';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Connection validation ────────────────────────────────────────────────────

export async function testDatabaseConnection(
  serviceAccountJson: string
): Promise<{ success: boolean; message: string }> {
  await delay(1200 + Math.random() * 600);

  if (!serviceAccountJson.trim()) {
    return { success: false, message: 'Service account key is empty.' };
  }

  try {
    const parsed = JSON.parse(serviceAccountJson.trim());
    if (parsed.type !== 'service_account') {
      return {
        success: false,
        message: 'Invalid key type. Key type must be "service_account".'
      };
    }
    if (!parsed.project_id) {
      return {
        success: false,
        message: 'Missing "project_id" in the service account JSON.'
      };
    }
    if (!parsed.private_key) {
      return {
        success: false,
        message: 'Missing "private_key" in the service account JSON.'
      };
    }
    if (!parsed.client_email) {
      return {
        success: false,
        message: 'Missing "client_email" in the service account JSON.'
      };
    }
    return { success: true, message: `Successfully connected to Firestore project "${parsed.project_id}"` };
  } catch (err) {
    return {
      success: false,
      message: 'Failed to parse JSON. Please verify that the pasted text is a valid service account JSON key.'
    };
  }
}

export async function testStorageConnection(credentials: {
  access_key: string; secret_key: string; bucket: string; endpoint: string;
}): Promise<{ success: boolean; message: string }> {
  await delay(1400 + Math.random() * 600);
  const missing: string[] = [];
  if (!credentials.access_key.trim()) missing.push('Access Key ID');
  if (!credentials.secret_key.trim()) missing.push('Secret Access Key');
  if (!credentials.bucket.trim()) missing.push('Bucket Name');
  if (!credentials.endpoint.trim()) missing.push('Endpoint URL');
  if (missing.length > 0) return { success: false, message: `Missing required fields: ${missing.join(', ')}.` };

  try { new URL(credentials.endpoint); }
  catch { return { success: false, message: 'Endpoint URL is invalid. Must be a fully qualified URL (e.g. https://...).' }; }

  // Specific simulation checks
  const key = credentials.access_key.toLowerCase();
  const bucketName = credentials.bucket.toLowerCase();

  if (key.includes('fail') || key.length < 10) {
    return { success: false, message: 'Access Denied: Please check your keys' };
  }
  if (bucketName.includes('fail') || bucketName.length < 3) {
    return { success: false, message: 'Bucket not found' };
  }

  return { success: true, message: 'Target verified successfully' };
}

// ─── Backup simulation (mock only) ────────────────────────────────────────────

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

  await addLog('info',  'Connecting to Firestore database...',                  2000);
  await addLog('info',  'Exporting collections...',                             2000);
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
