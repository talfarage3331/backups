export type DatabaseEngine = 'postgres' | 'mysql';
export type ScheduleType = 'hourly' | '12h' | 'daily';
export type RunStatus = 'running' | 'completed' | 'failed';
export type RunType = 'sync' | 'scan';
export type PipelineStatus = 'active' | 'inactive';

export interface Pipeline {
  id: string;
  name?: string;
  user_id: string;
  source_db_type: DatabaseEngine;
  source_db_url: string;
  target_db_url: string;
  subset_percentage: number;
  schedule: ScheduleType;
  webhook_url: string;
  notify_on_success_too: boolean;
  created_at: string;
  status: PipelineStatus;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'error' | 'success';
  message: string;
}

export interface Run {
  id: string;
  pipelineId: string;
  userId: string;
  type: RunType;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  rowsProcessed: number;
  logs: LogEntry[];
}

export interface UserSettings {
  slack_webhook_url: string;
  discord_webhook_url: string;
  telegram_bot_token: string;
  mfa_enabled: boolean;
  dark_mode: boolean;
}

// ─── Phase 5: EnvShield-specific types ───────────────────────────────────────

export type MaskingStrategy = 'hash' | 'anonymize' | 'redact' | 'keep';
export type PiiRisk = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE' | 'UNREVIEWED';

export interface SchemaColumn {
  id: string;                       // Unique: `table.column`
  table: string;
  column: string;
  dataType: string;
  piiRisk: PiiRisk;
  piiCategory: string | null;       // e.g. 'EMAIL', 'PHONE', 'SSN'
  strategy: MaskingStrategy;
  previewOriginal: string;
  previewMasked: string;
}

export interface EphemeralEnvironment {
  id: string;
  prNumber: number;
  prTitle: string;
  branchName: string;
  status: 'active' | 'building' | 'teardown' | 'closed';
  dbSizeMb: number;
  samplePercent: number;
  connectionString: string;
  createdAt: string;
  neonBranchId: string;
}

export interface AuditLogEntry {
  id: string;
  projectId: string;
  environmentName: string;
  rowsProcessed: number;
  status: 'success' | 'failed';
  executionHash: string;
  createdAt: string;
}

