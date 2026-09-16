import * as SQLite from 'expo-sqlite';
import {
  UploadQueueRecord,
  QueueStatus,
  QueueSummary,
  PrecreatedFolderRecord,
} from './schema';

const DB_NAME = 'event_photo_system.db';
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let dbQueue: Promise<any> = Promise.resolve();

/**
 * Initializes and returns the shared SQLite database instance.
 * All callers share the same Promise to prevent race conditions during open.
 */
export function getDatabaseAsync(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await initDatabaseAsync(db);
      return db;
    })();
  }
  return dbPromise;
}

/**
 * Serializes database operations to avoid concurrent statement preparation
 * on Android which causes java.lang.NullPointerException in NativeDatabase.prepareAsync.
 */
export function withDbAsync<T>(task: (db: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const next = dbQueue.then(async () => {
    const db = await getDatabaseAsync();
    return await task(db);
  });
  dbQueue = next.catch(() => {});
  return next;
}

export async function initDatabaseAsync(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS upload_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      attendee_id TEXT NOT NULL,
      local_uri TEXT NOT NULL,
      drive_folder_id TEXT,
      status TEXT DEFAULT 'pending',
      retries INTEGER DEFAULT 0,
      error_message TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folder_cache (
      attendee_id TEXT PRIMARY KEY,
      drive_folder_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS precreated_folders (
      drive_folder_id TEXT PRIMARY KEY,
      folder_name TEXT NOT NULL,
      attendee_name TEXT,
      raw_id TEXT,
      numeric_id TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_upload_queue_status ON upload_queue(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_upload_queue_attendee ON upload_queue(attendee_id);
    CREATE INDEX IF NOT EXISTS idx_precreated_numeric ON precreated_folders(numeric_id);
    CREATE INDEX IF NOT EXISTS idx_precreated_raw ON precreated_folders(raw_id);
    CREATE INDEX IF NOT EXISTS idx_precreated_name ON precreated_folders(folder_name);
  `);
}

export async function addToQueueAsync(
  attendeeId: string,
  localUri: string,
  resolvedDriveFolderId?: string | null
): Promise<number> {
  return withDbAsync(async db => {
    const normalizedId = attendeeId.trim() || 'no_id';
    const createdAt = Date.now();

    const result = await db.runAsync(
      `INSERT INTO upload_queue (attendee_id, local_uri, drive_folder_id, status, retries, created_at)
       VALUES (?, ?, ?, 'pending', 0, ?)`,
      normalizedId,
      localUri,
      resolvedDriveFolderId || null,
      createdAt
    );

    return result.lastInsertRowId;
  });
}

export async function getPendingQueueItemsAsync(limit: number = 10): Promise<UploadQueueRecord[]> {
  return withDbAsync(async db => {
    const rows = await db.getAllAsync<UploadQueueRecord>(
      `SELECT * FROM upload_queue 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT ?`,
      limit
    );
    return rows;
  });
}

export async function updateQueueItemStatusAsync(
  id: number,
  status: QueueStatus,
  driveFolderId?: string | null,
  errorMessage?: string | null
): Promise<void> {
  return withDbAsync(async db => {
    if (driveFolderId !== undefined && errorMessage !== undefined) {
      await db.runAsync(
        `UPDATE upload_queue 
         SET status = ?, drive_folder_id = ?, error_message = ? 
         WHERE id = ?`,
        status,
        driveFolderId,
        errorMessage,
        id
      );
    } else if (driveFolderId !== undefined) {
      await db.runAsync(
        `UPDATE upload_queue 
         SET status = ?, drive_folder_id = ? 
         WHERE id = ?`,
        status,
        driveFolderId,
        id
      );
    } else if (errorMessage !== undefined) {
      await db.runAsync(
        `UPDATE upload_queue 
         SET status = ?, error_message = ? 
         WHERE id = ?`,
        status,
        errorMessage,
        id
      );
    } else {
      await db.runAsync(
        `UPDATE upload_queue 
         SET status = ? 
         WHERE id = ?`,
        status,
        id
      );
    }
  });
}

export async function incrementRetriesAsync(
  id: number,
  errorMessage: string,
  maxRetries: number = 3
): Promise<void> {
  return withDbAsync(async db => {
    const row = await db.getFirstAsync<{ retries: number }>(
      `SELECT retries FROM upload_queue WHERE id = ?`,
      id
    );

    const currentRetries = row ? row.retries : 0;
    const newRetries = currentRetries + 1;
    const newStatus: QueueStatus = newRetries >= maxRetries ? 'failed' : 'pending';

    await db.runAsync(
      `UPDATE upload_queue 
       SET retries = ?, status = ?, error_message = ? 
       WHERE id = ?`,
      newRetries,
      newStatus,
      errorMessage,
      id
    );
  });
}

export async function getAllQueueItemsAsync(): Promise<UploadQueueRecord[]> {
  return withDbAsync(async db => {
    const rows = await db.getAllAsync<UploadQueueRecord>(
      `SELECT * FROM upload_queue ORDER BY created_at DESC`
    );
    return rows;
  });
}

export async function getQueueStatsAsync(): Promise<QueueSummary> {
  return withDbAsync(async db => {
    const rows = await db.getAllAsync<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM upload_queue GROUP BY status`
    );

    const summary: QueueSummary = {
      pending: 0,
      uploading: 0,
      completed: 0,
      failed: 0,
      total: 0,
    };

    for (const r of rows) {
      if (r.status === 'pending') summary.pending = r.count;
      else if (r.status === 'uploading') summary.uploading = r.count;
      else if (r.status === 'completed') summary.completed = r.count;
      else if (r.status === 'failed') summary.failed = r.count;
      summary.total += r.count;
    }

    return summary;
  });
}

export async function resetFailedToPendingAsync(): Promise<number> {
  return withDbAsync(async db => {
    const result = await db.runAsync(
      `UPDATE upload_queue 
       SET status = 'pending', retries = 0, error_message = NULL 
       WHERE status = 'failed'`
    );
    return result.changes;
  });
}

export const retryFailedItemsAsync = resetFailedToPendingAsync;

export async function clearCompletedAsync(): Promise<number> {
  return withDbAsync(async db => {
    const result = await db.runAsync(
      `DELETE FROM upload_queue WHERE status = 'completed'`
    );
    return result.changes;
  });
}

export async function deleteQueueItemAsync(id: number): Promise<void> {
  return withDbAsync(async db => {
    await db.runAsync(`DELETE FROM upload_queue WHERE id = ?`, id);
  });
}

// -------------------------------------------------------------
// Folder Cache & Pre-created Drive Folders
// -------------------------------------------------------------

export async function getCachedFolderIdAsync(attendeeId: string): Promise<string | null> {
  return withDbAsync(async db => {
    const row = await db.getFirstAsync<{ drive_folder_id: string }>(
      `SELECT drive_folder_id FROM folder_cache WHERE attendee_id = ?`,
      attendeeId
    );
    return row ? row.drive_folder_id : null;
  });
}

export async function setCachedFolderIdAsync(
  attendeeId: string,
  driveFolderId: string
): Promise<void> {
  return withDbAsync(async db => {
    await db.runAsync(
      `INSERT OR REPLACE INTO folder_cache (attendee_id, drive_folder_id, updated_at) 
       VALUES (?, ?, ?)`,
      attendeeId,
      driveFolderId,
      Date.now()
    );
  });
}

export async function clearFolderCacheAsync(): Promise<void> {
  return withDbAsync(async db => {
    await db.runAsync(`DELETE FROM folder_cache`);
  });
}

/**
 * Saves a list of pre-created Drive folders to SQLite.
 */
export async function savePrecreatedFoldersAsync(
  folders: PrecreatedFolderRecord[]
): Promise<void> {
  return withDbAsync(async db => {
    const now = Date.now();
    for (const f of folders) {
      await db.runAsync(
        `INSERT OR REPLACE INTO precreated_folders 
         (drive_folder_id, folder_name, attendee_name, raw_id, numeric_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        f.drive_folder_id,
        f.folder_name,
        f.attendee_name,
        f.raw_id,
        f.numeric_id,
        now
      );
    }
  });
}

/**
 * Finds a pre-created folder by exact numeric ID (e.g. "89487").
 * Also supports matching raw_id (e.g. "KOT-89487") or "no_id".
 */
export async function findFolderByNumericIdAsync(
  digitsOrRaw: string
): Promise<PrecreatedFolderRecord | null> {
  return withDbAsync(async db => {
    const cleanDigits = digitsOrRaw.replace(/\D/g, '');

    if (cleanDigits) {
      const row = await db.getFirstAsync<PrecreatedFolderRecord>(
        `SELECT * FROM precreated_folders WHERE numeric_id = ? LIMIT 1`,
        cleanDigits
      );
      if (row) return row;
    }

    // Fallback match on raw_id, numeric_id, or folder_name
    const row = await db.getFirstAsync<PrecreatedFolderRecord>(
      `SELECT * FROM precreated_folders 
       WHERE raw_id = ? OR numeric_id = ? OR folder_name LIKE ? 
       LIMIT 1`,
      digitsOrRaw,
      digitsOrRaw,
      `%${digitsOrRaw}%`
    );
    return row || null;
  });
}

/**
 * Searches pre-created folders by partial numeric digits or name for autocomplete suggestions.
 */
export async function searchFoldersByNumberAsync(
  query: string,
  limit: number = 5
): Promise<PrecreatedFolderRecord[]> {
  return withDbAsync(async db => {
    const cleanDigits = query.replace(/\D/g, '');

    if (cleanDigits) {
      const rows = await db.getAllAsync<PrecreatedFolderRecord>(
        `SELECT * FROM precreated_folders 
         WHERE numeric_id LIKE ? OR raw_id LIKE ? 
         ORDER BY numeric_id ASC 
         LIMIT ?`,
        `%${cleanDigits}%`,
        `%${query}%`,
        limit
      );
      return rows;
    }

    const rows = await db.getAllAsync<PrecreatedFolderRecord>(
      `SELECT * FROM precreated_folders 
       WHERE folder_name LIKE ? OR attendee_name LIKE ? 
       ORDER BY folder_name ASC 
       LIMIT ?`,
      `%${query}%`,
      `%${query}%`,
      limit
    );
    return rows;
  });
}

export async function getAllPrecreatedFoldersAsync(): Promise<PrecreatedFolderRecord[]> {
  return withDbAsync(async db => {
    return await db.getAllAsync<PrecreatedFolderRecord>(
      `SELECT * FROM precreated_folders ORDER BY folder_name ASC`
    );
  });
}

export async function getPrecreatedFoldersCountAsync(): Promise<number> {
  return withDbAsync(async db => {
    const row = await db.getFirstAsync<{ count: number }>(
      `SELECT COUNT(*) as count FROM precreated_folders`
    );
    return row ? row.count : 0;
  });
}

export async function clearPrecreatedFoldersAsync(): Promise<void> {
  return withDbAsync(async db => {
    await db.runAsync(`DELETE FROM precreated_folders`);
  });
}
