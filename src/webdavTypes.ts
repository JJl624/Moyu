export interface SyncPolicy {
  onOpen: boolean; afterSave: boolean; interval: number;
  includeCodeData: boolean; excludes: string; deletion: 'confirm' | 'sync' | 'keep';
  timeout: number; retries: number; concurrency: number; maxFileMB: number;
}
export interface WebDAVConnection {
  url?: string; directory?: string; username?: string; password?: string;
  hasPassword?: boolean; clearPassword?: boolean; sync: SyncPolicy;
}
export interface SyncConflict {
  path: string; local: string | null; remote: string | null;
  localText: string | null; remoteText: string | null;
  truncated?: boolean;
}
export interface SyncChange { path: string; action: string; copy?: string; size?: number }
export interface CloudEntry { path: string; type: 'folder' | 'file'; size: number; modified?: number; created?: number; excluded?: string }
export interface CloudSnapshot { root: string; scannedAt: number; entries: CloudEntry[] }
export interface SyncReport {
  changes: SyncChange[]; skipped: SyncSkipped[]; totalChanges: number; totalSkipped: number;
  duration?: number; bytes?: number; conflicts?: number; counts?: Record<string, number>;
}
export interface SyncSkipped { path: string; reason: string }
export interface SyncPreview {
  token: string; firstSync: boolean; changes: SyncChange[];
  deletions: { path: string; side: string }[]; skipped: SyncSkipped[];
}
export interface SyncJob {
  operation?: 'sync' | 'directory';
  root?: string; phase: 'idle' | 'scan' | 'ready' | 'transfer' | 'awaiting' | 'cancelled' | 'error';
  current?: string; completed: number; total: number; error?: string; pending?: SyncPreview;
}
export interface SyncStatus {
  enabled?: boolean; lastSync: number; conflicts: SyncConflict[];
  files?: Record<string, string>; job?: SyncJob; needsConfirmation?: boolean;
  changes?: SyncChange[]; skipped?: SyncSkipped[];
  report?: SyncReport;
  cloud?: CloudSnapshot | null;
}
export const syncDefaults: SyncPolicy = {
  onOpen: false, afterSave: false, interval: 0,
  includeCodeData: true, excludes: '', deletion: 'confirm',
  timeout: 60, retries: 2, concurrency: 2, maxFileMB: 128,
};
