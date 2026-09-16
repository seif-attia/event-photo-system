import NetInfo, { NetInfoState } from '@react-native-community/netinfo';
import {
  getPendingQueueItemsAsync,
  updateQueueItemStatusAsync,
  incrementRetriesAsync,
  getQueueStatsAsync,
  retryFailedItemsAsync,
} from '../database/sqlite';
import {
  uploadPhotoToDriveAsync,
  fetchAndCacheDriveFoldersAsync,
  DEFAULT_PARENT_FOLDER_ID,
} from './driveApi';
import { getStoredTokensAsync, refreshAccessTokenAsync } from './googleAuth';
import { QueueSummary, UploadQueueRecord } from '../database/schema';

export type QueueEventCallback = (stats: QueueSummary) => void;

class QueueManager {
  private isOnline: boolean = true;
  private isPaused: boolean = false;
  private activeUploads: number = 0;
  private maxConcurrency: number = 2;
  private inFlightIds = new Set<number>();
  private listeners = new Set<QueueEventCallback>();
  private parentFolderId: string = DEFAULT_PARENT_FOLDER_ID;
  private unsubscribeNetInfo: (() => void) | null = null;
  private currentAccessToken: string | null = null;
  private isDemoMode: boolean = false;

  constructor() {
    this.initNetInfo();
  }

  public initNetInfo(): void {
    if (this.unsubscribeNetInfo) {
      this.unsubscribeNetInfo();
    }

    this.unsubscribeNetInfo = NetInfo.addEventListener((state: NetInfoState) => {
      const connected = Boolean(state.isConnected && state.isInternetReachable !== false);
      const wasOffline = !this.isOnline;
      this.isOnline = connected;

      if (wasOffline && connected && !this.isPaused) {
        console.log('[QueueManager] Network restored. Resuming queue processing.');
        this.syncFolders().catch(e => console.warn('Sync folders on reconnect:', e));
        this.processQueue();
      }
    });

    NetInfo.fetch().then(state => {
      this.isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
    });
  }

  public setParentFolderId(folderId: string): void {
    this.parentFolderId = folderId || DEFAULT_PARENT_FOLDER_ID;
  }

  public setMaxConcurrency(concurrency: number): void {
    this.maxConcurrency = Math.max(1, Math.min(concurrency, 3));
  }

  public setAuthContext(accessToken: string | null, isDemo: boolean): void {
    this.currentAccessToken = accessToken;
    this.isDemoMode = isDemo;
    if (accessToken || isDemo) {
      this.syncFolders().catch(e => console.warn('[QueueManager] Initial folder sync failed:', e));
      this.processQueue();
    }
  }

  public async syncFolders(): Promise<number> {
    try {
      let token = this.currentAccessToken;
      let isDemo = this.isDemoMode;

      if (!token && !isDemo) {
        const stored = await getStoredTokensAsync();
        token = stored.accessToken;
        isDemo = stored.isDemo;
      }

      if (token || isDemo) {
        const folders = await fetchAndCacheDriveFoldersAsync(
          this.parentFolderId,
          token || 'demo',
          isDemo
        );
        console.log(`[QueueManager] Synced ${folders.length} pre-created folders from Drive.`);
        return folders.length;
      }
    } catch (e) {
      console.warn('[QueueManager] syncFolders error:', e);
    }
    return 0;
  }

  public subscribe(callback: QueueEventCallback): () => void {
    this.listeners.add(callback);
    // Send immediate initial stats
    this.notifyListeners();
    return () => {
      this.listeners.delete(callback);
    };
  }

  public async notifyListeners(): Promise<void> {
    try {
      const stats = await getQueueStatsAsync();
      this.listeners.forEach(cb => {
        try {
          cb(stats);
        } catch (e) {
          console.error('[QueueManager] Listener error:', e);
        }
      });
    } catch (e) {
      console.error('[QueueManager] Failed to get stats:', e);
    }
  }

  public getNetworkStatus(): boolean {
    return this.isOnline;
  }

  public pause(): void {
    this.isPaused = true;
  }

  public resume(): void {
    this.isPaused = false;
    this.processQueue();
  }

  public async retryFailed(): Promise<number> {
    const count = await retryFailedItemsAsync();
    await this.notifyListeners();
    this.processQueue();
    return count;
  }

  public triggerSync(): void {
    this.isPaused = false;
    this.processQueue();
  }

  public async enqueueTrigger(): Promise<void> {
    await this.notifyListeners();
    this.processQueue();
  }

  public async processQueue(): Promise<void> {
    if (this.isPaused || !this.isOnline) {
      return;
    }

    if (this.activeUploads >= this.maxConcurrency) {
      return;
    }

    // Ensure we have access token or demo mode
    let token = this.currentAccessToken;
    let isDemo = this.isDemoMode;

    if (!token && !isDemo) {
      const stored = await getStoredTokensAsync();
      token = stored.accessToken;
      isDemo = stored.isDemo;
      this.currentAccessToken = token;
      this.isDemoMode = isDemo;
    }

    if (!token && !isDemo) {
      console.log('[QueueManager] No auth token available. Queue processing paused.');
      return;
    }

    const availableSlots = this.maxConcurrency - this.activeUploads;
    if (availableSlots <= 0) return;

    // Fetch batch of pending items
    const pendingItems = await getPendingQueueItemsAsync(availableSlots * 2);
    const candidates = pendingItems.filter(item => !this.inFlightIds.has(item.id));

    if (candidates.length === 0) {
      return;
    }

    // Launch uploads up to availableSlots
    const toLaunch = candidates.slice(0, availableSlots);
    for (const item of toLaunch) {
      this.inFlightIds.add(item.id);
      this.activeUploads++;
      this.uploadItem(item, token!, isDemo);
    }
  }

  private async uploadItem(item: UploadQueueRecord, token: string, isDemo: boolean): Promise<void> {
    try {
      // Mark item as uploading in DB
      await updateQueueItemStatusAsync(item.id, 'uploading');
      await this.notifyListeners();

      // Extract filename from localUri
      const fileName = item.local_uri.split('/').pop() || `${item.attendee_id}_${item.created_at}.jpg`;

      // Upload to Drive
      const result = await uploadPhotoToDriveAsync(
        item.local_uri,
        fileName,
        item.attendee_id,
        this.parentFolderId,
        token,
        isDemo,
        newToken => {
          this.currentAccessToken = newToken;
        }
      );

      // Successfully uploaded!
      await updateQueueItemStatusAsync(item.id, 'completed', result.folderId, null);
      console.log(`[QueueManager] Item ${item.id} successfully uploaded to folder ${result.folderId}`);
    } catch (error: any) {
      console.error(`[QueueManager] Upload failed for item ${item.id}:`, error);

      // Check if error is 401 and try one refresh
      if (error.message?.includes('401') && !isDemo) {
        const refreshedToken = await refreshAccessTokenAsync();
        if (refreshedToken) {
          this.currentAccessToken = refreshedToken;
        }
      }

      await incrementRetriesAsync(item.id, error.message || 'Upload failed', 3);
    } finally {
      this.inFlightIds.delete(item.id);
      this.activeUploads = Math.max(0, this.activeUploads - 1);
      await this.notifyListeners();

      // Continue processing remainder of the queue
      this.processQueue();
    }
  }
}

export const queueManager = new QueueManager();
