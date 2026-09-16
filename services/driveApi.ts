import * as FileSystem from 'expo-file-system/legacy';
import {
  getCachedFolderIdAsync,
  setCachedFolderIdAsync,
  findFolderByNumericIdAsync,
  savePrecreatedFoldersAsync,
  getAllPrecreatedFoldersAsync,
} from '../database/sqlite';
import { PrecreatedFolderRecord } from '../database/schema';
import { refreshAccessTokenAsync } from './googleAuth';

// In-memory folder ID cache: attendeeId/numericId -> driveFolderId
const inMemoryFolderCache = new Map<string, string>();

export const DEFAULT_PARENT_FOLDER_ID = 'root';

export interface DriveUploadResult {
  fileId: string;
  folderId: string;
}

export interface DriveFolderItem {
  id: string;
  name: string;
  isRoot?: boolean;
}

export interface ParsedFolderName {
  folderName: string;
  attendeeName: string;
  rawId: string;
  numericId: string;
}

/**
 * Parses folder display names formatted like:
 * "Rawda - KOT-89487" -> name: "Rawda", rawId: "KOT-89487", numericId: "89487"
 * "Omar - 45210" -> name: "Omar", rawId: "45210", numericId: "45210"
 * "General - no_id" -> name: "General", rawId: "no_id", numericId: "no_id"
 */
export function parseFolderName(folderName: string): ParsedFolderName {
  const trimmed = folderName.trim();
  const lower = trimmed.toLowerCase();

  if (lower.includes('no_id') || lower === 'general') {
    return {
      folderName: trimmed,
      attendeeName: 'General Photos',
      rawId: 'no_id',
      numericId: 'no_id',
    };
  }

  // Extract digits
  const digitMatch = trimmed.match(/\d+/);
  const numericId = digitMatch ? digitMatch[0] : '';

  // Split on ' - ' (space hyphen space) to preserve hyphens inside 'KOT-89487'
  let attendeeName = 'Attendee';
  let rawId = trimmed;

  if (trimmed.includes(' - ')) {
    const firstDivider = trimmed.indexOf(' - ');
    const p0 = trimmed.substring(0, firstDivider).trim();
    const p1 = trimmed.substring(firstDivider + 3).trim();

    if (/\d/.test(p1) && !/\d/.test(p0)) {
      attendeeName = p0;
      rawId = p1;
    } else if (/\d/.test(p0) && !/\d/.test(p1)) {
      rawId = p0;
      attendeeName = p1;
    } else {
      attendeeName = p0;
      rawId = p1;
    }
  }

  return {
    folderName: trimmed,
    attendeeName: attendeeName || 'Attendee',
    rawId: rawId || trimmed,
    numericId: numericId || rawId,
  };
}

/**
 * Lists user's top-level Google Drive folders so the user can easily select
 * the event destination folder visually instead of copy-pasting an ID.
 */
export async function listUserDriveFoldersAsync(
  accessToken: string,
  isDemo: boolean = false
): Promise<DriveFolderItem[]> {
  if (isDemo) {
    return [
      { id: 'root', name: 'My Drive (Root)', isRoot: true },
      { id: 'demo_folder_rawda_2026', name: 'Rawda & KOT Event 2026' },
      { id: 'demo_folder_gala_2026', name: 'Annual Gala 2026' },
      { id: 'demo_folder_booth_photos', name: 'Event Photo Booth Destination' },
      { id: 'demo_folder_wedding_2026', name: 'VIP & Corporate Party 2026' },
    ];
  }

  try {
    const query = encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and trashed = false");
    const fields = encodeURIComponent('nextPageToken,files(id,name)');
    const url = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=${fields}&pageSize=50&orderBy=name`;

    let res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 401) {
      const refreshed = await refreshAccessTokenAsync();
      if (refreshed) {
        accessToken = refreshed;
        res = await fetch(url, {
          headers: { Authorization: `Bearer ${refreshed}` },
        });
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      console.warn('Failed to list Drive folders:', res.status, errText);
      return [{ id: 'root', name: 'My Drive (Root)', isRoot: true }];
    }

    const data = await res.json();
    const folders: DriveFolderItem[] = [
      { id: 'root', name: 'My Drive (Root)', isRoot: true },
    ];

    if (Array.isArray(data.files)) {
      for (const f of data.files) {
        if (f.id && f.name) {
          folders.push({ id: f.id, name: f.name });
        }
      }
    }

    return folders;
  } catch (error) {
    console.error('listUserDriveFoldersAsync error:', error);
    return [{ id: 'root', name: 'My Drive (Root)', isRoot: true }];
  }
}

/**
 * Fetches all pre-created folders under PARENT_DRIVE_FOLDER_ID from Google Drive
 * and caches them into the local SQLite `precreated_folders` table.
 */
export async function fetchAndCacheDriveFoldersAsync(
  parentFolderId: string = DEFAULT_PARENT_FOLDER_ID,
  accessToken: string,
  isDemo: boolean = false
): Promise<PrecreatedFolderRecord[]> {
  if (isDemo) {
    // Pre-created mock folders for Demo mode
    const mockNames = [
      'Rawda - KOT-89487',
      'Omar - KOT-45210',
      'Nour - KOT-91342',
      'Zaid - KOT-89489',
      'Fatima - KOT-33215',
      'Tarek - KOT-55104',
      'General - no_id',
    ];

    const demoRecords: PrecreatedFolderRecord[] = mockNames.map((name, index) => {
      const parsed = parseFolderName(name);
      return {
        drive_folder_id: `demo_drive_folder_${parsed.numericId || index}`,
        folder_name: parsed.folderName,
        attendee_name: parsed.attendeeName,
        raw_id: parsed.rawId,
        numeric_id: parsed.numericId,
        updated_at: Date.now(),
      };
    });

    await savePrecreatedFoldersAsync(demoRecords);
    return demoRecords;
  }

  try {
    const escapedParent = parentFolderId.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    let pageToken: string | null = null;
    const allFetchedFolders: PrecreatedFolderRecord[] = [];

    do {
      let queryUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
        `'${escapedParent}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
      )}&fields=nextPageToken,files(id,name)&pageSize=500`;

      if (pageToken) {
        queryUrl += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      let res = await fetch(queryUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (res.status === 401) {
        const refreshed = await refreshAccessTokenAsync();
        if (refreshed) {
          accessToken = refreshed;
          res = await fetch(queryUrl, {
            headers: { Authorization: `Bearer ${refreshed}` },
          });
        }
      }

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to list Drive folders (${res.status}): ${errorText}`);
      }

      const data = await res.json();
      const files: Array<{ id: string; name: string }> = data.files || [];

      for (const file of files) {
        const parsed = parseFolderName(file.name);
        allFetchedFolders.push({
          drive_folder_id: file.id,
          folder_name: parsed.folderName,
          attendee_name: parsed.attendeeName,
          raw_id: parsed.rawId,
          numeric_id: parsed.numericId,
          updated_at: Date.now(),
        });
      }

      pageToken = data.nextPageToken || null;
    } while (pageToken);

    // Save all to SQLite
    await savePrecreatedFoldersAsync(allFetchedFolders);
    return allFetchedFolders;
  } catch (error) {
    console.error('fetchAndCacheDriveFoldersAsync error:', error);
    throw error;
  }
}

/**
 * Resolves the Google Drive folder ID for an attendee based on numeric ID or raw ID.
 * Follows the pre-created folder architecture:
 * 1. Checks in-memory cache.
 * 2. Checks local SQLite `precreated_folders` table (works 100% offline).
 * 3. If not found and online, refreshes folder cache from Drive.
 * 4. Throws error if folder does not exist in Drive (no dynamic creation).
 */
export async function resolveAttendeeFolderIdAsync(
  attendeeId: string,
  parentFolderId: string = DEFAULT_PARENT_FOLDER_ID,
  accessToken: string,
  isDemo: boolean = false
): Promise<string> {
  const normalizedInput = attendeeId.trim() || 'no_id';
  const cleanDigits = normalizedInput.replace(/\D/g, '');
  const cacheKey = `${parentFolderId}::${cleanDigits || normalizedInput}`;

  // 1. In-memory cache
  if (inMemoryFolderCache.has(cacheKey)) {
    return inMemoryFolderCache.get(cacheKey)!;
  }

  // 2. Query local SQLite pre-created folders table
  const localMatch = await findFolderByNumericIdAsync(cleanDigits || normalizedInput);
  if (localMatch) {
    inMemoryFolderCache.set(cacheKey, localMatch.drive_folder_id);
    await setCachedFolderIdAsync(cacheKey, localMatch.drive_folder_id);
    return localMatch.drive_folder_id;
  }

  // 3. If in demo mode, generate or return general demo folder
  if (isDemo) {
    const demoId = `demo_folder_${cleanDigits || 'general'}_${Date.now()}`;
    inMemoryFolderCache.set(cacheKey, demoId);
    return demoId;
  }

  // 4. If not found locally, fetch latest pre-created folders from Drive (if online)
  try {
    const refreshed = await fetchAndCacheDriveFoldersAsync(parentFolderId, accessToken, false);
    const postSyncMatch = refreshed.find(
      f =>
        f.numeric_id === cleanDigits ||
        f.raw_id.toLowerCase() === normalizedInput.toLowerCase() ||
        f.folder_name.toLowerCase().includes(normalizedInput.toLowerCase())
    );

    if (postSyncMatch) {
      inMemoryFolderCache.set(cacheKey, postSyncMatch.drive_folder_id);
      await setCachedFolderIdAsync(cacheKey, postSyncMatch.drive_folder_id);
      return postSyncMatch.drive_folder_id;
    }
  } catch (syncErr) {
    console.warn('Drive folder sync check failed:', syncErr);
  }

  // 5. Folder does NOT exist in Drive -> throw actionable error
  const idLabel = cleanDigits ? `#${cleanDigits}` : `"${normalizedInput}"`;
  throw new Error(
    `Pre-created folder for attendee ${idLabel} was not found in Google Drive. Ensure the folder exists (e.g. "[Name] - KOT-${cleanDigits || normalizedInput}") and tap "Sync Folders".`
  );
}

/**
 * Uploads a photo directly to the pre-created Google Drive folder.
 */
export async function uploadPhotoToDriveAsync(
  localUri: string,
  fileName: string,
  attendeeId: string,
  parentFolderId: string = DEFAULT_PARENT_FOLDER_ID,
  accessToken: string,
  isDemo: boolean = false,
  onTokenRefreshed?: (newToken: string) => void
): Promise<DriveUploadResult> {
  // Demo simulation mode
  if (isDemo) {
    await new Promise(resolve => setTimeout(resolve, 700));
    const targetFolderId = await resolveAttendeeFolderIdAsync(
      attendeeId,
      parentFolderId,
      accessToken,
      true
    );
    return {
      fileId: `demo_drive_file_${Date.now()}`,
      folderId: targetFolderId,
    };
  }

  // 1. Resolve pre-created attendee folder
  const targetFolderId = await resolveAttendeeFolderIdAsync(
    attendeeId,
    parentFolderId,
    accessToken,
    false
  );

  // 2. Initiate Resumable Upload session in the target folder
  const initUrl = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable';
  const metadata = {
    name: fileName,
    parents: [targetFolderId],
    mimeType: 'image/jpeg',
  };

  let initResponse = await fetch(initUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'image/jpeg',
    },
    body: JSON.stringify(metadata),
  });

  // Handle 401 Unauthorized
  if (initResponse.status === 401) {
    const refreshedToken = await refreshAccessTokenAsync();
    if (!refreshedToken) {
      throw new Error('Google OAuth token expired and refresh failed (401)');
    }
    if (onTokenRefreshed) {
      onTokenRefreshed(refreshedToken);
    }
    initResponse = await fetch(initUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${refreshedToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': 'image/jpeg',
      },
      body: JSON.stringify(metadata),
    });
  }

  if (!initResponse.ok) {
    const errorText = await initResponse.text();
    throw new Error(`Failed to initiate Drive upload (${initResponse.status}): ${errorText}`);
  }

  const uploadLocation = initResponse.headers.get('Location');
  if (!uploadLocation) {
    throw new Error('Google Drive API did not return resumable upload Location header');
  }

  // 3. Upload binary photo data to uploadLocation
  const uploadResult = await FileSystem.uploadAsync(uploadLocation, localUri, {
    httpMethod: 'PUT',
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      'Content-Type': 'image/jpeg',
    },
  });

  if (uploadResult.status !== 200 && uploadResult.status !== 201) {
    throw new Error(
      `Drive photo upload failed with HTTP status ${uploadResult.status}: ${uploadResult.body}`
    );
  }

  const uploadedFileInfo = JSON.parse(uploadResult.body);
  return {
    fileId: uploadedFileInfo.id,
    folderId: targetFolderId,
  };
}

/**
 * Tests connection to Google Drive and checks whether PARENT_DRIVE_FOLDER_ID exists.
 */
export async function testDriveConnectionAsync(
  parentFolderId: string,
  accessToken: string,
  isDemo: boolean = false
): Promise<{ success: boolean; message: string; folderName?: string }> {
  if (isDemo) {
    return {
      success: true,
      message: 'Demo Mode: Connected successfully (simulated)',
      folderName: 'Event Photos (Demo Root)',
    };
  }

  try {
    if (!parentFolderId || parentFolderId === 'root') {
      const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        return { success: true, message: 'Connected to Google Drive root folder' };
      }
      return { success: false, message: `Failed to connect to Google Drive: ${res.statusText}` };
    }

    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(parentFolderId)}?fields=id,name,mimeType,trashed`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!res.ok) {
      if (res.status === 404) {
        return { success: false, message: 'Folder not found. Please verify the Folder ID.' };
      }
      return { success: false, message: `Access error (${res.status}): ${res.statusText}` };
    }

    const data = await res.json();
    if (data.trashed) {
      return { success: false, message: 'The specified folder is in Google Drive trash.' };
    }

    return {
      success: true,
      message: `Connected successfully to folder: "${data.name}"`,
      folderName: data.name,
    };
  } catch (error: any) {
    return { success: false, message: error.message || 'Connection test failed' };
  }
}
