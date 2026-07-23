import type { Pipeline, LogEntry } from '../types';
import { updateRunStatus, updateRunLogs } from './db';

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Connection validation ────────────────────────────────────────────────────

export async function testDatabaseConnection(
  connectionString: string
): Promise<{ success: boolean; message: string }> {
  await delay(1000 + Math.random() * 500);

  if (!connectionString.trim()) {
    return { success: false, message: 'Connection string is empty.' };
  }

  // Simple string format check for PG/MySQL URIs
  const trimmed = connectionString.trim().toLowerCase();
  const isPostgres = trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://');
  const isMysql = trimmed.startsWith('mysql://');

  if (!isPostgres && !isMysql) {
    return {
      success: false,
      message: 'Invalid database URL. Must start with "postgresql://" or "mysql://".'
    };
  }

  try {
    // Attempt parse
    new URL(connectionString.trim());
    return { success: true, message: 'Successfully established connection to source database.' };
  } catch (err) {
    return {
      success: false,
      message: 'Invalid database URL structure. Please check host, port, credentials, and format.'
    };
  }
}

export async function testTargetConnection(
  connectionString: string
): Promise<{ success: boolean; message: string }> {
  await delay(1200 + Math.random() * 500);

  if (!connectionString.trim()) {
    return { success: false, message: 'Target database connection string is empty.' };
  }

  const trimmed = connectionString.trim().toLowerCase();
  const isPostgres = trimmed.startsWith('postgres://') || trimmed.startsWith('postgresql://');
  const isMysql = trimmed.startsWith('mysql://');

  if (!isPostgres && !isMysql) {
    return {
      success: false,
      message: 'Invalid target database URL. Must start with "postgresql://" or "mysql://".'
    };
  }

  try {
    new URL(connectionString.trim());
    return { success: true, message: 'Target database connection verified successfully.' };
  } catch (err) {
    return {
      success: false,
      message: 'Invalid target URL structure. Please check host and connection credentials.'
    };
  }
}

// ─── Sync simulation ─────────────────────────────────────────────────────────

export async function runSyncSimulation(
  pipeline: Pipeline,
  runId: string
): Promise<void> {
  const addLog = async (level: LogEntry['level'], message: string, waitMs = 1500) => {
    await delay(waitMs);
    await updateRunLogs(runId, {
      timestamp: new Date().toISOString(),
      level,
      message,
    });
  };

  await addLog('info',  '[EnvShield] Introspecting source database schema...',         1200);
  await addLog('info',  'Found 14 tables. Fetching active masking rules policy...',   1200);
  await addLog('info',  'Executing DAG Subsetting on root (sample: 5%)...',          1500);
  await addLog('info',  'Relational subsetting complete. Processing streams...',     1500);

  const isMock = pipeline.source_db_url.toLowerCase().includes('fail') || pipeline.target_db_url.toLowerCase().includes('fail');

  if (isMock) {
    await addLog('error', 'Error: Target database connection lost. Sync aborted.', 1000);
    await updateRunStatus(runId, 'failed', { endedAt: new Date().toISOString() });
  } else {
    await addLog('success', 'Zero-leakage masking complete. Sync written to target!', 1000);
    await updateRunStatus(runId, 'completed', {
      endedAt:       new Date().toISOString(),
      rowsProcessed: Math.floor(25000 + Math.random() * 30000),
    });
  }
}
