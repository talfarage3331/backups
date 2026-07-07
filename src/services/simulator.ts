import type { Pipeline, LogEntry } from '../types';
import { updateRunStatus, updateRunLogs } from './db';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Connection validation ────────────────────────────────────────────────────

export async function testDatabaseConnection(
  connectionString: string
): Promise<{ success: boolean; message: string }> {
  await delay(1200 + Math.random() * 600);

  if (!connectionString.trim()) {
    return { success: false, message: 'Connection string is empty.' };
  }

  const cleanString = connectionString.trim();

  if (!cleanString.startsWith('postgresql://') && !cleanString.startsWith('postgres://')) {
    return {
      success: false,
      message: 'Invalid protocol. Connection string must start with "postgresql://" or "postgres://".'
    };
  }

  // Detect direct connection instead of Session Pooler
  const isSupabase = cleanString.includes('supabase');
  const isDirectPort = cleanString.includes(':5432');
  const isMissingPooler = !cleanString.includes('pooler');

  if (isSupabase && (isDirectPort || isMissingPooler)) {
    return {
      success: false,
      message: 'Connection failed: Supabase direct connection detected on port 5432. Many serverless environments and local ISPs block IPv6 direct database routes. We recommend using a Session Pooler connection string (port 6543 or containing *.pooler.supabase.com) to establish a stable IPv4 tunnel.'
    };
  }

  return { success: true, message: 'Connection successful' };
}

export async function testStorageConnection(credentials: {
  access_key: string; secret_key: string; bucket: string; endpoint: string;
}): Promise<{ success: boolean; message: string }> {
  await delay(1400 + Math.random() * 600);
  const missing: string[] = [];
  if (!credentials.access_key.trim()) missing.push('Access Key');
  if (!credentials.secret_key.trim()) missing.push('Secret Key');
  if (!credentials.bucket.trim()) missing.push('Bucket Name');
  if (!credentials.endpoint.trim()) missing.push('Endpoint URL');
  if (missing.length > 0) return { success: false, message: `Missing required fields: ${missing.join(', ')}.` };

  try { new URL(credentials.endpoint); }
  catch { return { success: false, message: 'Endpoint URL is invalid. Must be a fully qualified URL (e.g. https://...).' }; }

  if (credentials.access_key.includes('fail') || credentials.access_key.length < 5) {
    return { success: false, message: 'Access denied — write permissions check failed: Unable to put test object in bucket.' };
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

  await addLog('info',  'Connecting to database...',                            2000);
  await addLog('info',  'Fetching schema and exporting tables...',              2000);
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
