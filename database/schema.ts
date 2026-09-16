export type QueueStatus = 'pending' | 'uploading' | 'completed' | 'failed';

export interface UploadQueueRecord {
  id: number;
  attendee_id: string;
  local_uri: string;
  drive_folder_id: string | null;
  status: QueueStatus;
  retries: number;
  error_message: string | null;
  created_at: number;
}

export interface FolderCacheRecord {
  attendee_id: string;
  drive_folder_id: string;
  updated_at: number;
}

export interface PrecreatedFolderRecord {
  drive_folder_id: string;
  folder_name: string; // e.g. "Rawda - KOT-89487"
  attendee_name: string; // e.g. "Rawda"
  raw_id: string; // e.g. "KOT-89487"
  numeric_id: string; // e.g. "89487"
  updated_at: number;
}

export interface QueueSummary {
  pending: number;
  uploading: number;
  completed: number;
  failed: number;
  total: number;
}
