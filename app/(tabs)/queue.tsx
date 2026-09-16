import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAllQueueItemsAsync, deleteQueueItemAsync } from '../../database/sqlite';
import { UploadQueueRecord, QueueStatus } from '../../database/schema';
import { useQueue } from '../../context/QueueContext';
import { LiveQueueBar } from '../../components/LiveQueueBar';

interface GroupedQueue {
  attendeeId: string;
  items: UploadQueueRecord[];
}

export default function QueueScreen() {
  const { stats, isOnline, triggerSync, retryFailed, clearCompleted } = useQueue();
  const [items, setItems] = useState<UploadQueueRecord[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isActionLoading, setIsActionLoading] = useState(false);

  const loadQueue = useCallback(async () => {
    try {
      const records = await getAllQueueItemsAsync();
      setItems(records);
    } catch (e) {
      console.error('Failed to load queue items:', e);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue, stats]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadQueue();
    setIsRefreshing(false);
  };

  const handleManualSync = () => {
    triggerSync();
  };

  const handleRetryFailed = async () => {
    setIsActionLoading(true);
    try {
      const retried = await retryFailed();
      Alert.alert('Retrying', `Re-queued ${retried} failed photo(s) for upload.`);
      await loadQueue();
    } catch (e: any) {
      Alert.alert('Error', e.message || 'Failed to retry uploads.');
    } finally {
      setIsActionLoading(false);
    }
  };

  const handleClearCompleted = () => {
    Alert.alert(
      'Clear Completed Photos',
      'This will remove all successfully uploaded photos from the local queue history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            const count = await clearCompleted();
            await loadQueue();
            Alert.alert('Cleaned', `Removed ${count} completed photo record(s).`);
          },
        },
      ]
    );
  };

  const handleDeleteItem = (id: number) => {
    Alert.alert('Remove Photo', 'Are you sure you want to remove this item from the upload queue?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteQueueItemAsync(id);
          await loadQueue();
        },
      },
    ]);
  };

  // Group items by attendee_id
  const groupedData: GroupedQueue[] = React.useMemo(() => {
    const map = new Map<string, UploadQueueRecord[]>();
    for (const item of items) {
      const groupKey = item.attendee_id;
      if (!map.has(groupKey)) {
        map.set(groupKey, []);
      }
      map.get(groupKey)!.push(item);
    }

    const groups: GroupedQueue[] = [];
    map.forEach((records, attendeeId) => {
      groups.push({ attendeeId, items: records });
    });
    return groups;
  }, [items]);

  const renderStatusBadge = (status: QueueStatus, retries: number) => {
    switch (status) {
      case 'pending':
        return (
          <View style={[styles.badge, styles.badgePending]}>
            <Ionicons name="time-outline" size={12} color="#F59E0B" />
            <Text style={[styles.badgeText, { color: '#F59E0B' }]}>Pending</Text>
          </View>
        );
      case 'uploading':
        return (
          <View style={[styles.badge, styles.badgeUploading]}>
            <ActivityIndicator size="small" color="#3B82F6" style={{ transform: [{ scale: 0.7 }] }} />
            <Text style={[styles.badgeText, { color: '#3B82F6' }]}>Uploading</Text>
          </View>
        );
      case 'completed':
        return (
          <View style={[styles.badge, styles.badgeCompleted]}>
            <Ionicons name="checkmark-circle" size={12} color="#10B981" />
            <Text style={[styles.badgeText, { color: '#10B981' }]}>Completed</Text>
          </View>
        );
      case 'failed':
        return (
          <View style={[styles.badge, styles.badgeFailed]}>
            <Ionicons name="alert-circle" size={12} color="#EF4444" />
            <Text style={[styles.badgeText, { color: '#EF4444' }]}>
              Failed ({retries})
            </Text>
          </View>
        );
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Top Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Upload Queue</Text>
          <Text style={styles.headerSubtitle}>
            {items.length} total photo(s) in local SQLite database
          </Text>
        </View>
      </View>

      {/* Live Queue Floating Bar */}
      <View style={styles.queueBarBox}>
        <LiveQueueBar />
      </View>

      {/* Action Buttons Row */}
      <View style={styles.actionButtonsRow}>
        {/* Sync Now */}
        <TouchableOpacity
          style={[styles.actionBtn, styles.syncBtn]}
          onPress={handleManualSync}
          disabled={!isOnline}
        >
          <Ionicons name="sync-outline" size={16} color="#FFFFFF" />
          <Text style={styles.actionBtnText}>Sync Now</Text>
        </TouchableOpacity>

        {/* Retry Failed */}
        {stats.failed > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.retryBtn]}
            onPress={handleRetryFailed}
            disabled={isActionLoading}
          >
            {isActionLoading ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="refresh-outline" size={16} color="#FFFFFF" />
                <Text style={styles.actionBtnText}>Retry ({stats.failed})</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Clear Completed */}
        {stats.completed > 0 && (
          <TouchableOpacity
            style={[styles.actionBtn, styles.clearBtn]}
            onPress={handleClearCompleted}
          >
            <Ionicons name="trash-outline" size={16} color="#94A3B8" />
            <Text style={[styles.actionBtnText, { color: '#94A3B8' }]}>Clear Done</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Grouped Queue List */}
      <FlatList
        data={groupedData}
        keyExtractor={group => group.attendeeId}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#3B82F6"
          />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Ionicons name="images-outline" size={56} color="#334155" />
            <Text style={styles.emptyTitle}>No Photos in Queue</Text>
            <Text style={styles.emptyDescription}>
              Photos captured in the booth will appear here and upload automatically to Google Drive.
            </Text>
          </View>
        }
        renderItem={({ item: group }) => (
          <View style={styles.groupCard}>
            {/* Group Header */}
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <Ionicons
                  name={group.attendeeId === 'no_id' ? 'people-outline' : 'ticket-outline'}
                  size={18}
                  color={group.attendeeId === 'no_id' ? '#64748B' : '#60A5FA'}
                />
                <Text style={styles.groupTitle}>
                  {group.attendeeId === 'no_id'
                    ? 'General Photos (no_id)'
                    : `Attendee: ${group.attendeeId}`}
                </Text>
              </View>
              <View style={styles.groupCountBadge}>
                <Text style={styles.groupCountText}>{group.items.length} photo(s)</Text>
              </View>
            </View>

            {/* Photos inside Group */}
            {group.items.map(photo => {
              const fileName = photo.local_uri.split('/').pop() || 'photo.jpg';
              const dateStr = new Date(photo.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });

              return (
                <View key={photo.id} style={styles.photoRow}>
                  {/* Photo Thumbnail */}
                  <Image
                    source={{ uri: photo.local_uri }}
                    style={styles.thumbnail}
                    resizeMode="cover"
                  />

                  {/* Photo Details */}
                  <View style={styles.photoInfo}>
                    <Text style={styles.photoFileName} numberOfLines={1}>
                      {fileName}
                    </Text>
                    <Text style={styles.photoTime}>Captured: {dateStr}</Text>

                    {/* Status Badge */}
                    <View style={styles.statusRow}>
                      {renderStatusBadge(photo.status, photo.retries)}
                      {photo.drive_folder_id && (
                        <Text style={styles.folderTag} numberOfLines={1}>
                          Folder: {photo.drive_folder_id.slice(0, 10)}...
                        </Text>
                      )}
                    </View>

                    {/* Error message preview if failed */}
                    {photo.status === 'failed' && photo.error_message && (
                      <Text style={styles.errorText} numberOfLines={2}>
                        Error: {photo.error_message}
                      </Text>
                    )}
                  </View>

                  {/* Delete Item button */}
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => handleDeleteItem(photo.id)}
                  >
                    <Ionicons name="close" size={18} color="#64748B" />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0F1D',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#94A3B8',
    marginTop: 2,
  },
  queueBarBox: {
    alignItems: 'center',
    marginVertical: 10,
    paddingHorizontal: 20,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 12,
    gap: 8,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    gap: 6,
  },
  syncBtn: {
    backgroundColor: '#2563EB',
  },
  retryBtn: {
    backgroundColor: '#DC2626',
  },
  clearBtn: {
    backgroundColor: '#1E293B',
    marginLeft: 'auto',
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 30,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 80,
    paddingHorizontal: 30,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#F8FAFC',
    marginTop: 14,
  },
  emptyDescription: {
    fontSize: 13,
    color: '#64748B',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  groupCard: {
    backgroundColor: '#131D31',
    borderRadius: 16,
    marginBottom: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  groupHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  groupTitle: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '700',
  },
  groupCountBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  groupCountText: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
  },
  photoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  thumbnail: {
    width: 60,
    height: 60,
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  photoInfo: {
    flex: 1,
    marginLeft: 12,
  },
  photoFileName: {
    color: '#F8FAFC',
    fontSize: 13,
    fontWeight: '600',
  },
  photoTime: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 8,
    gap: 4,
  },
  badgePending: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
  },
  badgeUploading: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
  },
  badgeCompleted: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  badgeFailed: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  folderTag: {
    fontSize: 10,
    color: '#64748B',
  },
  errorText: {
    fontSize: 10,
    color: '#F87171',
    marginTop: 4,
  },
  deleteButton: {
    padding: 8,
  },
});
