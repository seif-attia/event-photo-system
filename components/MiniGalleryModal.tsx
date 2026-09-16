import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  FlatList,
  Image,
  Dimensions,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAllQueueItemsAsync } from '../database/sqlite';
import { UploadQueueRecord, QueueStatus } from '../database/schema';
import { Colors } from '../constants/colors';

interface MiniGalleryModalProps {
  visible: boolean;
  onClose: () => void;
  currentAttendeeId: string;
  currentAttendeeName?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const GRID_SPACING = 3;
const NUM_COLUMNS = 3;
const ITEM_SIZE = (SCREEN_WIDTH - GRID_SPACING * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

export const MiniGalleryModal: React.FC<MiniGalleryModalProps> = ({
  visible,
  onClose,
  currentAttendeeId,
  currentAttendeeName,
}) => {
  const [activeTab, setActiveTab] = useState<'current' | 'all'>('current');
  const [allItems, setAllItems] = useState<UploadQueueRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedPhoto, setSelectedPhoto] = useState<UploadQueueRecord | null>(null);

  const loadPhotos = useCallback(async () => {
    setIsLoading(true);
    try {
      const records = await getAllQueueItemsAsync();
      setAllItems(records || []);
    } catch (e) {
      console.warn('Could not load gallery photos from SQLite:', e);
      setAllItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadPhotos();
    }
  }, [visible, loadPhotos]);

  // Filter items based on active tab
  const displayedItems = React.useMemo(() => {
    if (activeTab === 'all') return allItems;

    const cleanCurrent = currentAttendeeId.replace(/\D/g, '');
    return allItems.filter(item => {
      const cleanItem = item.attendee_id.replace(/\D/g, '');
      if (cleanCurrent && cleanItem) {
        return cleanCurrent === cleanItem;
      }
      return item.attendee_id === currentAttendeeId;
    });
  }, [allItems, activeTab, currentAttendeeId]);

  const renderStatusIcon = (status: QueueStatus) => {
    switch (status) {
      case 'completed':
        return <Ionicons name="checkmark-circle" size={14} color={Colors.success} />;
      case 'uploading':
        return <ActivityIndicator size="small" color={Colors.primaryLight} style={{ transform: [{ scale: 0.6 }] }} />;
      case 'pending':
        return <Ionicons name="time" size={14} color={Colors.warning} />;
      case 'failed':
        return <Ionicons name="alert-circle" size={14} color={Colors.error} />;
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <View style={styles.container}>
        <SafeAreaView style={styles.safeHeader} edges={['top']}>
          {/* Top Bar */}
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>

            <View style={styles.headerTitleContainer}>
              <Text style={styles.headerTitle}>Photo Gallery</Text>
              <Text style={styles.headerSubtitle}>
                {displayedItems.length} photo(s) captured
              </Text>
            </View>

            <TouchableOpacity style={styles.refreshBtn} onPress={loadPhotos}>
              <Ionicons name="refresh" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Filter Tabs */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'current' && styles.tabBtnActive]}
              onPress={() => setActiveTab('current')}
            >
              <Ionicons
                name="person"
                size={14}
                color={activeTab === 'current' ? Colors.textPrimary : Colors.textMuted}
              />
              <Text style={[styles.tabText, activeTab === 'current' && styles.tabTextActive]}>
                {currentAttendeeName ? `${currentAttendeeName}` : `Code: ${currentAttendeeId}`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'all' && styles.tabBtnActive]}
              onPress={() => setActiveTab('all')}
            >
              <Ionicons
                name="images"
                size={14}
                color={activeTab === 'all' ? Colors.textPrimary : Colors.textMuted}
              />
              <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
                All Photos ({allItems.length})
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>

        {/* Photos Grid */}
        {isLoading ? (
          <View style={styles.centered}>
            <ActivityIndicator size="large" color={Colors.primaryLight} />
          </View>
        ) : displayedItems.length === 0 ? (
          <View style={styles.emptyContainer}>
            <Ionicons name="images-outline" size={56} color={Colors.textMuted} />
            <Text style={styles.emptyTitle}>No Photos in this View</Text>
            <Text style={styles.emptySubtitle}>
              {activeTab === 'current'
                ? `No photos have been snapped for ${currentAttendeeId} yet.`
                : 'No photos in local database yet.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={displayedItems}
            keyExtractor={item => item.id.toString()}
            numColumns={NUM_COLUMNS}
            contentContainerStyle={styles.gridContent}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.gridItem}
                activeOpacity={0.8}
                onPress={() => setSelectedPhoto(item)}
              >
                <Image source={{ uri: item.local_uri }} style={styles.gridImage} resizeMode="cover" />
                <View style={styles.gridBadgeContainer}>{renderStatusIcon(item.status)}</View>
              </TouchableOpacity>
            )}
          />
        )}

        {/* Selected Photo Single View Modal */}
        {selectedPhoto && (
          <Modal visible={Boolean(selectedPhoto)} transparent animationType="fade">
            <View style={styles.singleViewBackdrop}>
              <SafeAreaView style={styles.singleViewSafe} edges={['top', 'bottom']}>
                <View style={styles.singleViewHeader}>
                  <TouchableOpacity
                    style={styles.singleCloseBtn}
                    onPress={() => setSelectedPhoto(null)}
                  >
                    <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
                  </TouchableOpacity>
                  <Text style={styles.singleViewTitle} numberOfLines={1}>
                    Attendee: {selectedPhoto.attendee_id}
                  </Text>
                  <View style={{ width: 40 }} />
                </View>

                <Image
                  source={{ uri: selectedPhoto.local_uri }}
                  style={styles.singleImage}
                  resizeMode="contain"
                />

                <View style={styles.singleInfoCard}>
                  <View style={styles.singleInfoRow}>
                    <Text style={styles.singleInfoLabel}>Status:</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                      {renderStatusIcon(selectedPhoto.status)}
                      <Text style={[styles.singleInfoVal, { textTransform: 'capitalize' }]}>
                        {selectedPhoto.status}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.singleInfoRow}>
                    <Text style={styles.singleInfoLabel}>Captured:</Text>
                    <Text style={styles.singleInfoVal}>
                      {new Date(selectedPhoto.created_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </Text>
                  </View>

                  {selectedPhoto.drive_folder_id && (
                    <View style={styles.singleInfoRow}>
                      <Text style={styles.singleInfoLabel}>Drive Folder:</Text>
                      <Text style={styles.singleInfoVal} numberOfLines={1}>
                        {selectedPhoto.drive_folder_id}
                      </Text>
                    </View>
                  )}
                </View>
              </SafeAreaView>
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeHeader: {
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitleContainer: {
    alignItems: 'center',
  },
  headerTitle: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 2,
  },
  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6,
  },
  tabBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primaryLight,
  },
  tabText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  tabTextActive: {
    color: Colors.textPrimary,
    fontWeight: '700',
  },
  gridContent: {
    padding: GRID_SPACING,
  },
  gridItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    margin: GRID_SPACING / 2,
    position: 'relative',
    backgroundColor: Colors.cardElevated,
    borderRadius: 4,
    overflow: 'hidden',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  gridBadgeContainer: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: 'rgba(21, 11, 40, 0.85)',
    borderRadius: 10,
    padding: 3,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 12,
  },
  emptySubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 18,
  },
  singleViewBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(11, 6, 22, 0.96)',
  },
  singleViewSafe: {
    flex: 1,
  },
  singleViewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  singleCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  singleViewTitle: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  singleImage: {
    flex: 1,
    width: '100%',
    marginVertical: 10,
  },
  singleInfoCard: {
    backgroundColor: Colors.cardElevated,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  singleInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  singleInfoLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  singleInfoVal: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
});
