import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  FlatList,
  Image,
  Dimensions,
  ActivityIndicator,
  BackHandler,
  Animated,
  GestureResponderEvent,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { getAllQueueItemsAsync } from '../database/sqlite';
import { UploadQueueRecord, QueueStatus } from '../database/schema';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');
const GRID_SPACING = 3;
const NUM_COLUMNS = 3;
const ITEM_SIZE = (SCREEN_WIDTH - GRID_SPACING * (NUM_COLUMNS + 1)) / NUM_COLUMNS;

function getDistance(t1: { pageX: number; pageY: number }, t2: { pageX: number; pageY: number }): number {
  const dx = t1.pageX - t2.pageX;
  const dy = t1.pageY - t2.pageY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Interactive Pinch-to-Zoom & Pan Fullscreen Image Viewer.
 * Supports:
 * - 2-finger pinch to zoom (1x to 4x)
 * - 1-finger pan when zoomed
 * - Double-tap to zoom in / out
 * - 1-finger swipe down to dismiss at 1x
 */
function ZoomablePhotoViewer({
  uri,
  onDismiss,
  onSwipeNext,
  onSwipePrev,
}: {
  uri: string;
  onDismiss: () => void;
  onSwipeNext?: () => void;
  onSwipePrev?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;

  const currentScale = useRef(1);
  const currentTranslateX = useRef(0);
  const currentTranslateY = useRef(0);

  const initialDistance = useRef<number | null>(null);
  const initialScale = useRef(1);
  const lastTouch = useRef<{ x: number; y: number } | null>(null);
  const startTouch = useRef<{ x: number; y: number } | null>(null);
  const lastTapTime = useRef<number>(0);

  useEffect(() => {
    resetZoom();
  }, [uri]);

  useEffect(() => {
    const scaleSub = scale.addListener(v => {
      currentScale.current = v.value;
    });
    const xSub = translateX.addListener(v => {
      currentTranslateX.current = v.value;
    });
    const ySub = translateY.addListener(v => {
      currentTranslateY.current = v.value;
    });
    return () => {
      scale.removeListener(scaleSub);
      translateX.removeListener(xSub);
      translateY.removeListener(ySub);
    };
  }, [scale, translateX, translateY]);

  const resetZoom = () => {
    translateX.setValue(0);
    translateY.setValue(0);
    scale.setValue(1);
    currentScale.current = 1;
    currentTranslateX.current = 0;
    currentTranslateY.current = 0;
  };

  const handleDoubleTap = () => {
    if (currentScale.current > 1.2) {
      resetZoom();
    } else {
      Animated.parallel([
        Animated.spring(scale, { toValue: 2.5, useNativeDriver: true, tension: 120, friction: 8 }),
        Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 120, friction: 8 }),
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 120, friction: 8 }),
      ]).start();
    }
  };

  const onTouchStart = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    const now = Date.now();

    if (touches.length === 1) {
      if (now - lastTapTime.current < 280) {
        handleDoubleTap();
        lastTapTime.current = 0;
        return;
      }
      lastTapTime.current = now;
      lastTouch.current = { x: touches[0].pageX, y: touches[0].pageY };
      startTouch.current = { x: touches[0].pageX, y: touches[0].pageY };
    } else if (touches.length === 2) {
      initialDistance.current = getDistance(touches[0], touches[1]);
      initialScale.current = currentScale.current;
    }
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;

    if (touches.length === 2 && initialDistance.current !== null) {
      const dist = getDistance(touches[0], touches[1]);
      const factor = dist / initialDistance.current;
      const targetScale = Math.min(4.0, Math.max(0.8, initialScale.current * factor));
      scale.setValue(targetScale);
    } else if (touches.length === 1 && lastTouch.current && startTouch.current) {
      const dx = touches[0].pageX - lastTouch.current.x;
      const dy = touches[0].pageY - lastTouch.current.y;
      lastTouch.current = { x: touches[0].pageX, y: touches[0].pageY };

      if (currentScale.current > 1.05) {
        const maxPan = (currentScale.current - 1) * (SCREEN_WIDTH * 0.45);
        const newX = Math.min(maxPan, Math.max(-maxPan, currentTranslateX.current + dx));
        const newY = Math.min(maxPan * 1.6, Math.max(-maxPan * 1.6, currentTranslateY.current + dy));
        translateX.setValue(newX);
        translateY.setValue(newY);
      } else {
        const totalDx = touches[0].pageX - startTouch.current.x;
        const totalDy = touches[0].pageY - startTouch.current.y;

        // Dominant horizontal motion: follow finger for photo swipe
        if (Math.abs(totalDx) > Math.abs(totalDy) * 0.75) {
          translateX.setValue(totalDx);
        } else if (totalDy > 0) {
          // Drag down to dismiss at 1x
          translateY.setValue(totalDy);
        }
      }
    }
  };

  const onTouchEnd = (e: GestureResponderEvent) => {
    const touches = e.nativeEvent.touches;
    if (touches.length === 0) {
      initialDistance.current = null;
      lastTouch.current = null;
      startTouch.current = null;

      if (currentScale.current <= 1.05) {
        const totalDx = currentTranslateX.current;
        const totalDy = currentTranslateY.current;

        // Vertical swipe down to dismiss
        if (totalDy > 80 && Math.abs(totalDx) < 60) {
          onDismiss();
          return;
        }

        // Horizontal swipe: left -> next photo
        if (totalDx < -50 && onSwipeNext) {
          Animated.timing(translateX, {
            toValue: -SCREEN_WIDTH,
            duration: 140,
            useNativeDriver: true,
          }).start(() => {
            onSwipeNext();
          });
          return;
        }

        // Horizontal swipe: right -> previous photo
        if (totalDx > 50 && onSwipePrev) {
          Animated.timing(translateX, {
            toValue: SCREEN_WIDTH,
            duration: 140,
            useNativeDriver: true,
          }).start(() => {
            onSwipePrev();
          });
          return;
        }

        // Snap back
        Animated.parallel([
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, tension: 160, friction: 9 }),
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 160, friction: 9 }),
        ]).start();
      } else if (currentScale.current < 1.0) {
        resetZoom();
      }
    }
  };

  return (
    <View
      style={styles.zoomTouchArea}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      <Animated.Image
        source={{ uri }}
        style={[
          styles.singleImage,
          {
            transform: [
              { translateX },
              { translateY },
              { scale },
            ],
          },
        ]}
        resizeMode="contain"
      />
    </View>
  );
}

export default function GalleryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{
    attendeeId?: string;
    attendeeName?: string;
  }>();

  const currentAttendeeId = params.attendeeId || 'no_id';
  const currentAttendeeName = params.attendeeName || currentAttendeeId;

  const [activeTab, setActiveTab] = useState<'current' | 'all'>('current');
  const [allItems, setAllItems] = useState<UploadQueueRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [selectedPhoto, setSelectedPhoto] = useState<UploadQueueRecord | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);

  const loadPhotos = useCallback(async () => {
    setIsLoading(true);
    try {
      const records = await getAllQueueItemsAsync();
      setAllItems(records || []);
    } catch (e) {
      console.warn('Could not load gallery photos:', e);
      setAllItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleOpenPhoto = (item: UploadQueueRecord, index: number) => {
    setSelectedIndex(index);
    setSelectedPhoto(item);
  };

  const handleNextPhoto = () => {
    if (selectedIndex < displayedItems.length - 1) {
      const nextIdx = selectedIndex + 1;
      setSelectedIndex(nextIdx);
      setSelectedPhoto(displayedItems[nextIdx]);
    }
  };

  const handlePrevPhoto = () => {
    if (selectedIndex > 0) {
      const prevIdx = selectedIndex - 1;
      setSelectedIndex(prevIdx);
      setSelectedPhoto(displayedItems[prevIdx]);
    }
  };

  useEffect(() => {
    loadPhotos();
  }, [loadPhotos]);

  // Intercept Hardware & Gesture Back on Android
  useEffect(() => {
    const backAction = () => {
      if (selectedPhoto) {
        // If single photo is open, close photo back to gallery grid
        setSelectedPhoto(null);
        return true;
      }
      // Otherwise navigate back to camera
      router.back();
      return true;
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', backAction);
    return () => backHandler.remove();
  }, [selectedPhoto, router]);

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
        return <Ionicons name="checkmark-circle" size={14} color="#10B981" />;
      case 'uploading':
        return <ActivityIndicator size="small" color="#3B82F6" style={{ transform: [{ scale: 0.6 }] }} />;
      case 'pending':
        return <Ionicons name="time" size={14} color="#F59E0B" />;
      case 'failed':
        return <Ionicons name="alert-circle" size={14} color="#EF4444" />;
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Header */}
      <SafeAreaView style={styles.safeHeader} edges={['top']}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
            <Text style={styles.backButtonText}>Camera</Text>
          </TouchableOpacity>

          <View style={styles.headerTitleContainer}>
            <Text style={styles.headerTitle}>Photo Gallery</Text>
            <Text style={styles.headerSubtitle}>
              {displayedItems.length} photo(s) captured
            </Text>
          </View>

          <TouchableOpacity style={styles.refreshBtn} onPress={loadPhotos}>
            <Ionicons name="refresh" size={18} color="#94A3B8" />
          </TouchableOpacity>
        </View>

        {/* Tab Switcher: Current Code vs All Photos */}
        <View style={styles.tabContainer}>
          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'current' && styles.tabButtonActive]}
            onPress={() => setActiveTab('current')}
          >
            <Text style={[styles.tabText, activeTab === 'current' && styles.tabTextActive]}>
              Current ({currentAttendeeName})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.tabButton, activeTab === 'all' && styles.tabButtonActive]}
            onPress={() => setActiveTab('all')}
          >
            <Text style={[styles.tabText, activeTab === 'all' && styles.tabTextActive]}>
              All Photos ({allItems.length})
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Grid Content */}
      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#3B82F6" />
          <Text style={styles.loadingText}>Loading photos...</Text>
        </View>
      ) : displayedItems.length === 0 ? (
        <View style={styles.centered}>
          <Ionicons name="images-outline" size={54} color="#475569" />
          <Text style={styles.emptyTitle}>No Photos Found</Text>
          <Text style={styles.emptySubtitle}>
            {activeTab === 'current'
              ? `No photos snapped for ${currentAttendeeName} yet.`
              : 'No photos in local storage yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={displayedItems}
          keyExtractor={item => item.id.toString()}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={[
            styles.gridContent,
            { paddingBottom: Math.max(insets.bottom, 16) + 24 },
          ]}
          renderItem={({ item, index }) => (
            <TouchableOpacity
              style={styles.gridItem}
              activeOpacity={0.8}
              onPress={() => handleOpenPhoto(item, index)}
            >
              <Image source={{ uri: item.local_uri }} style={styles.gridImage} resizeMode="cover" />
              <View style={styles.gridBadgeContainer}>{renderStatusIcon(item.status)}</View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Fullscreen Photo Inspector with Pinch, Pan & Swipe Between Photos */}
      {selectedPhoto && (
        <View style={styles.inspectorBackdrop}>
          <SafeAreaView style={styles.inspectorSafe} edges={['top', 'bottom']}>
            {/* Inspector Top Bar */}
            <View style={styles.inspectorHeader}>
              <TouchableOpacity
                style={styles.inspectorBackBtn}
                onPress={() => setSelectedPhoto(null)}
              >
                <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
                <Text style={styles.inspectorBackText}>Gallery</Text>
              </TouchableOpacity>

              <View style={styles.inspectorTitleContainer}>
                <Text style={styles.inspectorTitle} numberOfLines={1}>
                  Attendee: {selectedPhoto.attendee_id}
                </Text>
                <Text style={styles.inspectorPageCounter}>
                  Photo {selectedIndex + 1} of {displayedItems.length}
                </Text>
              </View>

              <TouchableOpacity
                style={styles.inspectorCloseBtn}
                onPress={() => setSelectedPhoto(null)}
              >
                <Ionicons name="close" size={20} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            {/* Pinchable, Zoomable & Swipeable Image Area */}
            <View style={styles.imageContainer}>
              <ZoomablePhotoViewer
                uri={selectedPhoto.local_uri}
                onDismiss={() => setSelectedPhoto(null)}
                onSwipeNext={selectedIndex < displayedItems.length - 1 ? handleNextPhoto : undefined}
                onSwipePrev={selectedIndex > 0 ? handlePrevPhoto : undefined}
              />

              <Text style={styles.zoomHintText}>
                Swipe left / right to change photos • Pinch to zoom • Swipe down to dismiss
              </Text>
            </View>

            {/* Bottom Metadata Card */}
            <View style={styles.inspectorInfoCard}>
              <View style={styles.inspectorInfoRow}>
                <Text style={styles.inspectorInfoLabel}>Upload Status:</Text>
                <View style={styles.statusPill}>
                  {renderStatusIcon(selectedPhoto.status)}
                  <Text style={[styles.inspectorInfoVal, { textTransform: 'capitalize' }]}>
                    {selectedPhoto.status}
                  </Text>
                </View>
              </View>

              <View style={styles.inspectorInfoRow}>
                <Text style={styles.inspectorInfoLabel}>Captured:</Text>
                <Text style={styles.inspectorInfoVal}>
                  {new Date(selectedPhoto.created_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </Text>
              </View>

              {selectedPhoto.drive_folder_id && (
                <View style={styles.inspectorInfoRow}>
                  <Text style={styles.inspectorInfoLabel}>Google Drive Folder:</Text>
                  <Text style={styles.inspectorInfoVal} numberOfLines={1}>
                    {selectedPhoto.drive_folder_id}
                  </Text>
                </View>
              )}
            </View>
          </SafeAreaView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0F1D',
  },
  safeHeader: {
    backgroundColor: '#0F172A',
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingRight: 10,
    gap: 2,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  headerTitleContainer: {
    alignItems: 'center',
    flex: 1,
  },
  headerTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: '#94A3B8',
    fontSize: 11,
    marginTop: 2,
  },
  refreshBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#1E293B',
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 8,
  },
  tabButton: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: '#1E293B',
  },
  tabButtonActive: {
    backgroundColor: '#2563EB',
  },
  tabText: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '700',
  },
  tabTextActive: {
    color: '#FFFFFF',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  loadingText: {
    color: '#94A3B8',
    fontSize: 13,
    marginTop: 12,
  },
  emptyTitle: {
    color: '#F8FAFC',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 14,
  },
  emptySubtitle: {
    color: '#64748B',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  gridContent: {
    padding: GRID_SPACING,
  },
  gridItem: {
    width: ITEM_SIZE,
    height: ITEM_SIZE,
    margin: GRID_SPACING / 2,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#1E293B',
  },
  gridImage: {
    width: '100%',
    height: '100%',
  },
  gridBadgeContainer: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 10,
    padding: 3,
  },
  // Fullscreen Inspector
  inspectorBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.96)',
    zIndex: 100,
  },
  inspectorSafe: {
    flex: 1,
  },
  inspectorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  inspectorBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  inspectorBackText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  inspectorTitleContainer: {
    alignItems: 'center',
    flex: 1,
    marginHorizontal: 12,
  },
  inspectorTitle: {
    color: '#F8FAFC',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  inspectorPageCounter: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  inspectorCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  imageContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomTouchArea: {
    width: SCREEN_WIDTH,
    height: SCREEN_HEIGHT * 0.65,
    justifyContent: 'center',
    alignItems: 'center',
  },
  singleImage: {
    width: SCREEN_WIDTH,
    height: '100%',
  },
  zoomHintText: {
    color: '#64748B',
    fontSize: 11,
    marginTop: 8,
    textAlign: 'center',
  },
  inspectorInfoCard: {
    backgroundColor: '#1E293B',
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    padding: 14,
    gap: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  inspectorInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  inspectorInfoLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: '600',
  },
  inspectorInfoVal: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '700',
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
});
