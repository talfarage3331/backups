export type DatabaseType = 'firestore' | 'rtdb';
export type StorageType = 'r2' | 's3';
export type ScheduleType = 'hourly' | '12h' | 'daily';
export type RestoreCheckFrequency = 'weekly' | 'monthly' | 'off';
export type RunStatus = 'running' | 'completed' | 'failed';
export type RunType = 'backup' | 'restore_check';
export type PipelineStatus = 'active' | 'inactive';

export interface Pipeline {
  id: string;
  name?: string;
  user_id: string;
  database_type: DatabaseType;
  firebase_service_account_encrypted: string;
  collections: string[] | null;
  storage_type: StorageType;
  storage_credentials: {
    access_key: string;
    secret_key: string;
    bucket: string;
    endpoint: string;
  };
  schedule: ScheduleType;
  retention_count: number;
  restore_check_frequency: RestoreCheckFrequency;
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
  type: RunType;
  status: RunStatus;
  startedAt: string;
  endedAt?: string;
  storageUsedBytes: number;
  logs: LogEntry[];
}

export interface UserSettings {
  slack_webhook_url: string;
  discord_webhook_url: string;
  telegram_bot_token: string;
  mfa_enabled: boolean;
  dark_mode: boolean;
}
