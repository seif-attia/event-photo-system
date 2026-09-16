import React, { useState, useRef, useMemo } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Animated,
  Vibration,
  Image,
  GestureResponderEvent,
  Dimensions,
} from 'react-native';
import { CameraView, CameraType, FlashMode, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { addToQueueAsync } from '../database/sqlite';
import { queueManager } from '../services/queueManager';
import { useQueue } from '../context/QueueContext';
import { Colors } from '../constants/colors';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('screen');
const PHOTOS_DIR = `${FileSystem.documentDirectory}photos/`;

export type SamsungAspectRatio = '3:4' | '9:16' | '1:1' | 'Full';

/**
 * Accurately crops the captured photo so its aspect ratio exactly matches
 * what the user framed in the viewfinder on screen.
 */
async function cropPhotoToRatio(
  uri: string,
  width: number,
  height: number,
  aspectRatio: SamsungAspectRatio,
  screenWidth: number,
  screenHeight: number
): Promise<string> {
  let targetRatio: number;
  switch (aspectRatio) {
    case '1:1':
      targetRatio = 1.0;
      break;
    case '3:4':
      targetRatio = 3 / 4;
      break;
    case '9:16':
      targetRatio = 9 / 16;
      break;
    case 'Full':
    default:
      targetRatio = screenWidth / screenHeight;
      break;
  }

  const isPortrait = height >= width;
  const currentRatio = isPortrait ? width / height : height / width;

  // If already matches target aspect ratio within 1.5% margin, no crop needed
  if (Math.abs(currentRatio - targetRatio) < 0.015) {
    return uri;
  }

  let originX = 0;
  let originY = 0;
  let cropWidth = width;
  let cropHeight = height;

  if (isPortrait) {
    if (targetRatio > currentRatio) {
      // Target is wider than current (e.g. 3:4 -> 1:1), crop top & bottom
      cropWidth = width;
      cropHeight = Math.round(width / targetRatio);
      originX = 0;
      originY = Math.max(0, Math.round((height - cropHeight) / 2));
    } else {
      // Target is narrower than current (e.g. 3:4 -> 9:16 or Full), crop sides
      cropHeight = height;
      cropWidth = Math.round(height * targetRatio);
      originX = Math.max(0, Math.round((width - cropWidth) / 2));
      originY = 0;
    }
  } else {
    // Landscape orientation
    const targetLandscapeRatio = 1 / targetRatio;
    const currentLandscapeRatio = width / height;

    if (targetLandscapeRatio > currentLandscapeRatio) {
      cropWidth = width;
      cropHeight = Math.round(width / targetLandscapeRatio);
      originX = 0;
      originY = Math.max(0, Math.round((height - cropHeight) / 2));
    } else {
      cropHeight = height;
      cropWidth = Math.round(height * targetLandscapeRatio);
      originX = Math.max(0, Math.round((width - cropWidth) / 2));
      originY = 0;
    }
  }

  cropWidth = Math.min(cropWidth, width - originX);
  cropHeight = Math.min(cropHeight, height - originY);

  try {
    const result = await manipulateAsync(
      uri,
      [
        {
          crop: {
            originX,
            originY,
            width: cropWidth,
            height: cropHeight,
          },
        },
      ],
      {
        compress: 0.90,
        format: SaveFormat.JPEG,
      }
    );
    return result.uri;
  } catch (err) {
    console.warn('Failed to crop photo to aspect ratio:', err);
    return uri;
  }
}

export default function CameraScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const { stats, isOnline } = useQueue();

  // Route parameters from the pre-camera Code Entry screen
  const params = useLocalSearchParams<{
    attendeeId: string;
    folderId?: string;
    attendeeName?: string;
  }>();

  const attendeeId = params.attendeeId || 'no_id';
  const attendeeName = params.attendeeName || (attendeeId === 'no_id' ? 'General' : attendeeId);
  const resolvedFolderId = params.folderId || null;

  // Permissions
  const [permission, requestPermission] = useCameraPermissions();

  // Camera Settings
  const [facing, setFacing] = useState<CameraType>('back');
  const [flashMode, setFlashMode] = useState<'auto' | 'on' | 'off' | 'torch'>('auto');
  const [isFlashMenuOpen, setIsFlashMenuOpen] = useState<boolean>(false);
  const [aspectRatio, setAspectRatio] = useState<SamsungAspectRatio>('3:4');
  const [isRatioMenuOpen, setIsRatioMenuOpen] = useState<boolean>(false);
  const [zoom, setZoom] = useState<number>(0);
  const [showGrid, setShowGrid] = useState<boolean>(false);

  // Dynamic bottom bar height for positioning zoom on camera feed
  const [bottomBarHeight, setBottomBarHeight] = useState<number>(128);

  // Focus point state & animations
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const focusScale = useRef(new Animated.Value(1.4)).current;
  const focusOpacity = useRef(new Animated.Value(0)).current;
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Native Shutter feedback animations (NO white flash!)
  const shutterDipAnim = useRef(new Animated.Value(0)).current;
  const shutterButtonScale = useRef(new Animated.Value(1)).current;

  // Session photo count & latest photo
  const [sessionCount, setSessionCount] = useState<number>(0);
  const [latestPhotoUri, setLatestPhotoUri] = useState<string | null>(null);

  // Pinch-to-zoom tracking
  const initialDistanceRef = useRef<number | null>(null);
  const initialZoomRef = useRef<number>(0);

  // -------------------------------------------------------------
  // Samsung Camera Viewfinder Geometry Calculations
  // -------------------------------------------------------------
  const vfDimensions = useMemo(() => {
    const topBarBudget = insets.top + 50;
    const bottomBarBudget = insets.bottom + 124;
    const availableViewportHeight = SCREEN_HEIGHT - topBarBudget - bottomBarBudget;

    switch (aspectRatio) {
      case '1:1': {
        const size = SCREEN_WIDTH;
        const top = topBarBudget + Math.max(0, (availableViewportHeight - size) / 2);
        return { width: size, height: size, top };
      }
      case '3:4': {
        const targetH = Math.round(SCREEN_WIDTH * (4 / 3));
        if (targetH <= availableViewportHeight) {
          const top = topBarBudget + (availableViewportHeight - targetH) / 2;
          return { width: SCREEN_WIDTH, height: targetH, top };
        } else {
          const h = availableViewportHeight;
          const w = Math.round(h * (3 / 4));
          return { width: w, height: h, top: topBarBudget };
        }
      }
      case '9:16': {
        const targetH = Math.round(SCREEN_WIDTH * (16 / 9));
        const h = Math.min(SCREEN_HEIGHT, targetH);
        // Center vertically so there are equal parts black letterboxing at top and bottom
        const top = Math.max(0, (SCREEN_HEIGHT - h) / 2);
        return { width: SCREEN_WIDTH, height: h, top };
      }
      case 'Full':
      default:
        return { width: SCREEN_WIDTH, height: SCREEN_HEIGHT, top: 0 };
    }
  }, [aspectRatio, insets.top, insets.bottom]);

  // -------------------------------------------------------------
  // Tap-to-Focus Handler
  // -------------------------------------------------------------
  const handleViewfinderPress = (event: GestureResponderEvent) => {
    // If any menu is open, tapping viewfinder closes it
    if (isFlashMenuOpen || isRatioMenuOpen) {
      setIsFlashMenuOpen(false);
      setIsRatioMenuOpen(false);
      return;
    }

    const { locationX, locationY } = event.nativeEvent;

    if (focusTimerRef.current) {
      clearTimeout(focusTimerRef.current);
    }

    setFocusPoint({ x: locationX, y: locationY });
    focusScale.setValue(1.35);
    focusOpacity.setValue(1);

    Animated.parallel([
      Animated.spring(focusScale, {
        toValue: 1.0,
        friction: 6,
        tension: 100,
        useNativeDriver: true,
      }),
      Animated.timing(focusOpacity, {
        toValue: 1.0,
        duration: 50,
        useNativeDriver: true,
      }),
    ]).start();

    focusTimerRef.current = setTimeout(() => {
      Animated.timing(focusOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setFocusPoint(null));
    }, 850);
  };

  // -------------------------------------------------------------
  // Pinch-to-Zoom Handlers
  // -------------------------------------------------------------
  const calculateDistance = (e: GestureResponderEvent): number => {
    const touches = e.nativeEvent.touches;
    if (touches.length < 2) return 0;
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  };

  const onTouchStart = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length === 2) {
      initialDistanceRef.current = calculateDistance(e);
      initialZoomRef.current = zoom;
    }
  };

  const onTouchMove = (e: GestureResponderEvent) => {
    if (e.nativeEvent.touches.length === 2 && initialDistanceRef.current !== null) {
      const currentDist = calculateDistance(e);
      const delta = currentDist - initialDistanceRef.current;
      const zoomChange = delta / 250;
      const newZoom = Math.min(1.0, Math.max(0.0, initialZoomRef.current + zoomChange));
      setZoom(parseFloat(newZoom.toFixed(2)));
    }
  };

  const onTouchEnd = () => {
    initialDistanceRef.current = null;
  };

  const handleSetZoomPreset = (targetZoom: number) => {
    setZoom(targetZoom);
    try {
      Vibration.vibrate(10);
    } catch {}
  };

  // -------------------------------------------------------------
  // Instant Shutter (NO white flash!)
  // -------------------------------------------------------------
  const triggerNativeShutterFeedback = () => {
    try {
      Vibration.vibrate(25);
    } catch {}

    shutterButtonScale.setValue(0.90);
    Animated.spring(shutterButtonScale, {
      toValue: 1.0,
      friction: 5,
      tension: 120,
      useNativeDriver: true,
    }).start();

    shutterDipAnim.setValue(0.30);
    Animated.timing(shutterDipAnim, {
      toValue: 0,
      duration: 50,
      useNativeDriver: true,
    }).start();
  };

  const handleCapture = async () => {
    triggerNativeShutterFeedback();
    setSessionCount(prev => prev + 1);

    const targetAttendeeId = attendeeId;
    const timestamp = Date.now();
    const cleanNumber = targetAttendeeId.replace(/\D/g, '');
    const fileName = `${cleanNumber || targetAttendeeId}_${timestamp}.jpg`;
    const destinationUri = `${PHOTOS_DIR}${fileName}`;

    // Non-blocking async background capture
    (async () => {
      try {
        let photoUri: string | null = null;
        let photoWidth = 0;
        let photoHeight = 0;

        if (cameraRef.current) {
          const photo = await cameraRef.current.takePictureAsync({
            quality: 0.90,
            shutterSound: false,
          });
          if (photo?.uri) {
            photoUri = photo.uri;
            photoWidth = photo.width;
            photoHeight = photo.height;
          }
        }

        if (!photoUri) {
          await FileSystem.writeAsStringAsync(
            destinationUri,
            'simulated_photo_' + timestamp,
            { encoding: FileSystem.EncodingType.UTF8 }
          );
        } else {
          // Crop photo so its aspect ratio exactly matches what was displayed in the feed!
          let finalPhotoUri = photoUri;
          if (photoWidth > 0 && photoHeight > 0) {
            finalPhotoUri = await cropPhotoToRatio(
              photoUri,
              photoWidth,
              photoHeight,
              aspectRatio,
              SCREEN_WIDTH,
              SCREEN_HEIGHT
            );
          }

          await FileSystem.copyAsync({
            from: finalPhotoUri,
            to: destinationUri,
          });
        }

        setLatestPhotoUri(destinationUri);
        await addToQueueAsync(targetAttendeeId, destinationUri, resolvedFolderId);
        queueManager.enqueueTrigger();
      } catch (err) {
        console.error('Background capture processing error:', err);
      }
    })();
  };

  const toggleFacing = () => {
    setFacing(prev => (prev === 'back' ? 'front' : 'back'));
    try {
      Vibration.vibrate(12);
    } catch {}
  };

  const toggleGrid = () => {
    setShowGrid(prev => !prev);
    try {
      Vibration.vibrate(10);
    } catch {}
  };

  if (!permission) {
    return <View style={styles.darkBackground} />;
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={[styles.darkBackground, styles.centered]}>
        <Ionicons name="camera-outline" size={64} color={Colors.primaryLight} />
        <Text style={styles.permissionTitle}>Camera Access Required</Text>
        <TouchableOpacity style={styles.permissionButton} onPress={requestPermission}>
          <Text style={styles.permissionButtonText}>Grant Camera Permission</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const effectiveFlash: FlashMode = flashMode === 'torch' ? 'off' : flashMode;
  const effectiveTorch: boolean = flashMode === 'torch';
  const displayZoomMultiplier = (1 + zoom * 4).toFixed(1) + 'x';

  return (
    <View style={styles.container}>
      {/* Viewfinder Viewport Container (Solid Samsung Black Letterboxing) */}
      <View style={styles.viewportArea}>
        <View
          style={[
            styles.viewfinderFrame,
            {
              width: vfDimensions.width,
              height: vfDimensions.height,
              top: vfDimensions.top,
            },
          ]}
        >
          {/* Camera Feed Component */}
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing={facing}
            flash={effectiveFlash}
            enableTorch={effectiveTorch}
            zoom={zoom}
            autofocus="on"
          />

          {/* Viewfinder Touch Surface for Tap-to-Focus & Pinch-to-Zoom */}
          <View
            style={StyleSheet.absoluteFill}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            <TouchableOpacity
              activeOpacity={1}
              style={StyleSheet.absoluteFill}
              onPress={handleViewfinderPress}
            />
          </View>

          {/* 3x3 Composition Grid (Framed to the chosen aspect ratio) */}
          {showGrid && (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <View style={[styles.gridLineHorizontal, { top: '33.33%' }]} />
              <View style={[styles.gridLineHorizontal, { top: '66.66%' }]} />
              <View style={[styles.gridLineVertical, { left: '33.33%' }]} />
              <View style={[styles.gridLineVertical, { left: '66.66%' }]} />
            </View>
          )}

          {/* Tap-to-Focus Reticle */}
          {focusPoint && (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.focusBox,
                {
                  left: focusPoint.x - 32,
                  top: focusPoint.y - 32,
                  opacity: focusOpacity,
                  transform: [{ scale: focusScale }],
                },
              ]}
            >
              <View style={[styles.focusCorner, styles.focusCornerTL]} />
              <View style={[styles.focusCorner, styles.focusCornerTR]} />
              <View style={[styles.focusCorner, styles.focusCornerBL]} />
              <View style={[styles.focusCorner, styles.focusCornerBR]} />
            </Animated.View>
          )}

          {/* Subtle Shutter Feedback (NO white flash!) */}
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              styles.shutterDipOverlay,
              { opacity: shutterDipAnim },
            ]}
          />
        </View>
      </View>

      {/* Samsung Floating Zoom Pills (Positioned at bottom of camera UI container, above buttons) */}
      <View
        style={[
          styles.zoomBarContainer,
          { bottom: bottomBarHeight - 2 },
        ]}
        pointerEvents="box-none"
      >
        <View style={styles.zoomPills}>
          {[
            { label: '1x', val: 0 },
            { label: '2x', val: 0.25 },
            { label: '3x', val: 0.5 },
            { label: '5x', val: 0.8 },
          ].map(p => {
            const isSelected = Math.abs(zoom - p.val) < 0.12;
            return (
              <TouchableOpacity
                key={p.label}
                style={[styles.zoomPill, isSelected && styles.zoomPillActive]}
                onPress={() => handleSetZoomPreset(p.val)}
              >
                <Text style={[styles.zoomPillText, isSelected && styles.zoomPillTextActive]}>
                  {p.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {zoom > 0 && (
          <View style={styles.zoomMultiplierTag}>
            <Text style={styles.zoomIndicatorText}>{displayZoomMultiplier}</Text>
          </View>
        )}
      </View>

      {/* Clean Samsung Top Bar */}
      <SafeAreaView
        style={[
          styles.topBarOverlay,
          (aspectRatio === 'Full' || aspectRatio === '9:16') && styles.topBarOverlayTransparent,
        ]}
        edges={['top']}
        pointerEvents="box-none"
      >
        <View style={styles.topBarRow}>
          {/* Back / Change Code Button */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
            <Text style={styles.backButtonText}>Code</Text>
          </TouchableOpacity>

          {/* Active Attendee Session Pill */}
          <View style={styles.sessionPill}>
            <Ionicons
              name={attendeeId === 'no_id' ? 'images' : 'person'}
              size={13}
              color={Colors.primaryLight}
              style={{ flexShrink: 0 }}
            />
            <Text style={styles.sessionPillText} numberOfLines={1} ellipsizeMode="tail">
              {attendeeName}
            </Text>
            <View style={styles.sessionCountBadge}>
              <Text style={styles.sessionCountText}>{sessionCount}</Text>
            </View>
          </View>

          {/* Right Top Actions: Aspect Ratio, Grid & Flash Dropdown */}
          <View style={styles.topActionsGroup}>
            {/* Samsung Aspect Ratio Button */}
            <TouchableOpacity
              style={[
                styles.samsungRatioTriggerBtn,
                isRatioMenuOpen && styles.samsungRatioTriggerBtnActive,
              ]}
              onPress={() => {
                try {
                  Vibration.vibrate(10);
                } catch {}
                setIsRatioMenuOpen(prev => !prev);
                setIsFlashMenuOpen(false);
              }}
              accessibilityLabel="Select camera aspect ratio"
            >
              <Text style={styles.samsungRatioTriggerText}>{aspectRatio}</Text>
            </TouchableOpacity>

            {/* Grid Toggle Button */}
            <TouchableOpacity
              style={[styles.smallActionBtn, showGrid && styles.smallActionBtnActive]}
              onPress={toggleGrid}
            >
              <Ionicons
                name="grid-outline"
                size={16}
                color={showGrid ? Colors.primaryLight : '#FFFFFF'}
              />
            </TouchableOpacity>

            {/* Flash Dropdown Trigger Button - Clean Icon Only */}
            <TouchableOpacity
              style={[
                styles.smallActionBtn,
                (isFlashMenuOpen || flashMode !== 'off') && styles.smallActionBtnActive,
              ]}
              onPress={() => {
                try {
                  Vibration.vibrate(10);
                } catch {}
                setIsFlashMenuOpen(prev => !prev);
                setIsRatioMenuOpen(false);
              }}
              accessibilityLabel="Select flash mode"
            >
              <Ionicons
                name={
                  flashMode === 'torch'
                    ? 'flashlight'
                    : flashMode === 'on'
                    ? 'flash'
                    : flashMode === 'off'
                    ? 'flash-off'
                    : 'flash-outline'
                }
                size={18}
                color={flashMode !== 'off' ? Colors.primaryLight : '#FFFFFF'}
              />
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>

      {/* Samsung Aspect Ratio Dropdown Quick Bar */}
      {isRatioMenuOpen && (
        <>
          <TouchableOpacity
            style={styles.dropdownBackdrop}
            activeOpacity={1}
            onPress={() => setIsRatioMenuOpen(false)}
          />
          <View style={[styles.samsungRatioBar, { top: insets.top + 52 }]}>
            {(['3:4', '9:16', '1:1', 'Full'] as const).map(r => {
              const isSelected = aspectRatio === r;
              return (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.samsungRatioOption,
                    isSelected && styles.samsungRatioOptionActive,
                  ]}
                  onPress={() => {
                    try {
                      Vibration.vibrate(12);
                    } catch {}
                    setAspectRatio(r);
                    setIsRatioMenuOpen(false);
                  }}
                >
                  <Text
                    style={[
                      styles.samsungRatioOptionText,
                      isSelected && styles.samsungRatioOptionTextActive,
                    ]}
                  >
                    {r}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* Flash Mode Dropdown Menu & Backdrop */}
      {isFlashMenuOpen && (
        <>
          <TouchableOpacity
            style={styles.dropdownBackdrop}
            activeOpacity={1}
            onPress={() => setIsFlashMenuOpen(false)}
          />
          <View style={[styles.flashDropdownMenu, { top: insets.top + 52 }]}>
            <View style={styles.dropdownHeaderRow}>
              <Text style={styles.dropdownHeaderText}>FLASH MODE</Text>
              <TouchableOpacity onPress={() => setIsFlashMenuOpen(false)}>
                <Ionicons name="close" size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            </View>

            {[
              { mode: 'auto' as const, label: 'Auto', icon: 'flash-outline', desc: 'Fires when dark' },
              { mode: 'on' as const, label: 'On', icon: 'flash', desc: 'Always fires' },
              { mode: 'torch' as const, label: 'Torch', icon: 'flashlight', desc: 'Continuous torch' },
              { mode: 'off' as const, label: 'Off', icon: 'flash-off', desc: 'Disabled' },
            ].map(item => {
              const isSelected = flashMode === item.mode;
              return (
                <TouchableOpacity
                  key={item.mode}
                  style={[
                    styles.dropdownItem,
                    isSelected && styles.dropdownItemActive,
                  ]}
                  onPress={() => {
                    try {
                      Vibration.vibrate(12);
                    } catch {}
                    setFlashMode(item.mode);
                    setIsFlashMenuOpen(false);
                  }}
                >
                  <View style={styles.dropdownItemLeft}>
                    <Ionicons
                      name={item.icon as any}
                      size={17}
                      color={isSelected ? Colors.primaryLight : Colors.textSecondary}
                    />
                    <View style={{ marginLeft: 10 }}>
                      <Text
                        style={[
                          styles.dropdownItemLabel,
                          isSelected && styles.dropdownItemLabelActive,
                        ]}
                      >
                        {item.label}
                      </Text>
                      <Text style={styles.dropdownItemDesc}>{item.desc}</Text>
                    </View>
                  </View>
                  {isSelected && (
                    <Ionicons name="checkmark-circle" size={16} color={Colors.primaryLight} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </>
      )}

      {/* Bottom Area: Minimalist Text Status + Centered Controls */}
      <View
        style={[
          styles.bottomContainer,
          (aspectRatio === 'Full' || aspectRatio === '9:16') && styles.bottomContainerTransparent,
          { paddingBottom: insets.bottom + 8 },
        ]}
        onLayout={e => {
          const { height } = e.nativeEvent.layout;
          if (height > 0 && Math.abs(height - bottomBarHeight) > 1) {
            setBottomBarHeight(height);
          }
        }}
      >
        {/* Simple Text Status Directly Above Buttons (No Heavy UI Box!) */}
        <View style={styles.statusTextRow}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: isOnline ? '#10B981' : '#EF4444' },
            ]}
          />
          <Text style={styles.statusText}>
            {isOnline ? 'Online' : 'Offline'}  •  Pending: {stats.pending}  •  Syncing: {stats.uploading}  •  Done: {stats.completed}
          </Text>
        </View>

        {/* Camera Buttons Row: Perfectly Centered Shutter, Right Preview */}
        <View style={styles.buttonsRow}>
          {/* Left Slot: Flip Camera (Centered) */}
          <View style={styles.sideSlot}>
            <TouchableOpacity style={styles.sideBtn} onPress={toggleFacing}>
              <Ionicons name="camera-reverse-outline" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* Center Slot: Shutter Circle (Exact Horizontal Center) */}
          <View style={styles.centerSlot}>
            <Animated.View style={{ transform: [{ scale: shutterButtonScale }] }}>
              <TouchableOpacity
                style={styles.shutterOuterRing}
                activeOpacity={0.8}
                onPress={handleCapture}
              >
                <View style={styles.shutterInnerCircle} />
              </TouchableOpacity>
            </Animated.View>
          </View>

          {/* Right Slot: Gallery Preview Button (Centered) */}
          <View style={styles.sideSlot}>
            <TouchableOpacity
              style={styles.galleryPreviewBtn}
              onPress={() => {
                router.push({
                  pathname: '/gallery',
                  params: {
                    attendeeId,
                    attendeeName,
                  },
                });
              }}
              accessibilityLabel="View photo gallery"
            >
              {latestPhotoUri ? (
                <Image source={{ uri: latestPhotoUri }} style={styles.previewImage} />
              ) : (
                <View style={styles.previewPlaceholder}>
                  <Ionicons name="images" size={20} color={Colors.textMuted} />
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  viewportArea: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000',
    alignItems: 'center',
  },
  viewfinderFrame: {
    position: 'absolute',
    overflow: 'hidden',
    backgroundColor: '#000000',
  },
  darkBackground: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  centered: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  permissionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 20,
  },
  permissionButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 14,
    marginTop: 24,
  },
  permissionButtonText: {
    color: Colors.textPrimary,
    fontWeight: '700',
    fontSize: 15,
  },
  // 3x3 Grid
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  gridLineVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.22)',
  },
  // Tap-to-Focus Reticle
  focusBox: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderColor: 'transparent',
    zIndex: 40,
  },
  focusCorner: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderColor: '#EAB308',
  },
  focusCornerTL: {
    top: 0,
    left: 0,
    borderTopWidth: 2.5,
    borderLeftWidth: 2.5,
    borderTopLeftRadius: 4,
  },
  focusCornerTR: {
    top: 0,
    right: 0,
    borderTopWidth: 2.5,
    borderRightWidth: 2.5,
    borderTopRightRadius: 4,
  },
  focusCornerBL: {
    bottom: 0,
    left: 0,
    borderBottomWidth: 2.5,
    borderLeftWidth: 2.5,
    borderBottomLeftRadius: 4,
  },
  focusCornerBR: {
    bottom: 0,
    right: 0,
    borderBottomWidth: 2.5,
    borderRightWidth: 2.5,
    borderBottomRightRadius: 4,
  },
  // Subtle Shutter Aperture Dip
  shutterDipOverlay: {
    backgroundColor: '#000000',
    zIndex: 35,
  },
  // Top Navigation & Action Bar
  topBarOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    backgroundColor: '#000000',
  },
  topBarOverlayTransparent: {
    backgroundColor: 'transparent',
  },
  topBarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 8,
    gap: 8,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(21, 11, 40, 0.75)',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 2,
    flexShrink: 0,
  },
  backButtonText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  sessionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(21, 11, 40, 0.85)',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 6,
    flexShrink: 1,
    maxWidth: 180,
  },
  sessionPillText: {
    color: Colors.textPrimary,
    fontSize: 12.5,
    fontWeight: '700',
    flexShrink: 1,
  },
  sessionCountBadge: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    flexShrink: 0,
  },
  sessionCountText: {
    color: Colors.textPrimary,
    fontSize: 11,
    fontWeight: '800',
  },
  topActionsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  smallActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(21, 11, 40, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  smallActionBtnActive: {
    borderColor: Colors.primaryLight,
    backgroundColor: Colors.primaryGlow,
  },
  // Samsung Aspect Ratio Trigger Button
  samsungRatioTriggerBtn: {
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    backgroundColor: 'rgba(21, 11, 40, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  samsungRatioTriggerBtnActive: {
    borderColor: Colors.primaryLight,
    backgroundColor: Colors.primaryGlow,
  },
  samsungRatioTriggerText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  // Samsung Aspect Ratio Floating Quick Bar
  samsungRatioBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    backgroundColor: Colors.cardElevated,
    borderRadius: 24,
    padding: 4,
    gap: 6,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 12,
    zIndex: 100,
  },
  samsungRatioOption: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'transparent',
  },
  samsungRatioOptionActive: {
    backgroundColor: Colors.primary,
  },
  samsungRatioOptionText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  samsungRatioOptionTextActive: {
    color: Colors.textPrimary,
    fontWeight: '800',
  },
  // Flash Dropdown Menu
  dropdownBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.35)',
    zIndex: 90,
  },
  flashDropdownMenu: {
    position: 'absolute',
    right: 16,
    width: 195,
    backgroundColor: Colors.cardElevated,
    borderRadius: 16,
    padding: 8,
    borderWidth: 1.5,
    borderColor: Colors.borderLight,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 12,
    zIndex: 100,
    gap: 4,
  },
  dropdownHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    marginBottom: 4,
  },
  dropdownHeaderText: {
    fontSize: 10,
    fontWeight: '800',
    color: Colors.textMuted,
    letterSpacing: 0.8,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  dropdownItemActive: {
    backgroundColor: Colors.primaryGlow,
  },
  dropdownItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dropdownItemLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  dropdownItemLabelActive: {
    color: Colors.primaryLight,
    fontWeight: '800',
  },
  dropdownItemDesc: {
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 1,
  },
  // Zoom Controls - Overlaid on the Camera Feed Component, floating right above bottom bar
  zoomBarContainer: {
    position: 'absolute',
    alignSelf: 'center',
    alignItems: 'center',
    zIndex: 55,
  },
  zoomPills: {
    flexDirection: 'row',
    backgroundColor: 'rgba(21, 11, 40, 0.75)',
    borderRadius: 22,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 4,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 4,
  },
  zoomPill: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 14,
  },
  zoomPillActive: {
    backgroundColor: Colors.primary,
  },
  zoomPillText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
  },
  zoomPillTextActive: {
    color: Colors.textPrimary,
    fontWeight: '800',
  },
  zoomMultiplierTag: {
    backgroundColor: 'rgba(21, 11, 40, 0.85)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    marginTop: 4,
    borderWidth: 0.5,
    borderColor: Colors.borderLight,
  },
  zoomIndicatorText: {
    color: Colors.primaryLight,
    fontSize: 10,
    fontWeight: '800',
  },
  // Bottom Controls Container (Tight, Centered Padding)
  bottomContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#000000',
    paddingTop: 8,
    zIndex: 50,
  },
  bottomContainerTransparent: {
    backgroundColor: 'transparent',
  },
  // Minimalist Text Status Above Buttons
  statusTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusText: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '500',
    letterSpacing: 0.2,
  },
  // Compact, Perfectly Centered Buttons Row
  buttonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
  },
  sideSlot: {
    width: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(30, 16, 56, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  shutterOuterRing: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Colors.primaryGlow,
  },
  shutterInnerCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#FFFFFF',
  },
  galleryPreviewBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: {
    width: '100%',
    height: '100%',
  },
  previewPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
