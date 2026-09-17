import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ScrollView,
  Switch,
  Vibration,
  ActivityIndicator,
  Alert,
  Keyboard,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  findFolderByNumericIdAsync,
  searchFoldersByNumberAsync,
  getPrecreatedFoldersCountAsync,
} from '../../database/sqlite';
import { PrecreatedFolderRecord } from '../../database/schema';
import { useQueue } from '../../context/QueueContext';
import { useAuth } from '../../context/AuthContext';
import { useSettings } from '../../context/SettingsContext';
import { Colors } from '../../constants/colors';

export default function SessionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { stats, isOnline, syncFolders } = useQueue();
  const { user, isDemo } = useAuth();
  const { settings } = useSettings();

  // Numeric Attendee ID State
  const [numericIdInput, setNumericIdInput] = useState('');
  const [matchedFolder, setMatchedFolder] = useState<PrecreatedFolderRecord | null>(null);
  const [suggestions, setSuggestions] = useState<PrecreatedFolderRecord[]>([]);
  const [isLocked, setIsLocked] = useState(false);
  const [isSkipped, setIsSkipped] = useState(false);
  const [cachedFolderCount, setCachedFolderCount] = useState(0);
  const [isSyncingFolders, setIsSyncingFolders] = useState(false);

  const lastSyncTimeRef = React.useRef<number>(0);

  // Load pre-created Drive folder count
  const loadFolderCount = useCallback(async () => {
    try {
      const count = await getPrecreatedFoldersCountAsync();
      setCachedFolderCount(count);
    } catch (e) {
      console.error('Error getting folder count:', e);
    }
  }, []);

  // Auto-sync folders each time staff navigates to the Enter ID page (works on both mobile data and Wi-Fi)
  useFocusEffect(
    useCallback(() => {
      loadFolderCount();

      const hasFolder = Boolean(settings.parentFolderId && settings.parentFolderId !== 'root' && settings.parentFolderId.trim() !== '');
      const now = Date.now();
      // 15-second throttle to avoid spamming Google Drive when switching tabs rapidly
      if (hasFolder && now - lastSyncTimeRef.current > 15000) {
        lastSyncTimeRef.current = now;
        console.log('[SessionScreen] Auto-syncing attendee folders on page focus (Mobile/Wi-Fi)...');
        syncFolders()
          .then(count => {
            loadFolderCount();
            console.log(`[SessionScreen] Auto-sync completed: ${count} folder(s) cached.`);
          })
          .catch(err => {
            console.log('[SessionScreen] Auto-sync non-fatal error:', err);
          });
      }
    }, [settings.parentFolderId, syncFolders, loadFolderCount])
  );

  // Match folder whenever numericIdInput changes
  useEffect(() => {
    if (isSkipped) {
      setMatchedFolder(null);
      setSuggestions([]);
      return;
    }

    const trimmed = numericIdInput.trim();
    if (!trimmed) {
      setMatchedFolder(null);
      setSuggestions([]);
      return;
    }

    let isMounted = true;
    (async () => {
      try {
        const match = await findFolderByNumericIdAsync(trimmed);
        if (!isMounted) return;

        setMatchedFolder(match);

        if (!match) {
          const partials = await searchFoldersByNumberAsync(trimmed, 4);
          if (isMounted) setSuggestions(partials);
        } else {
          setSuggestions([]);
        }
      } catch (err) {
        console.error('Lookup folder error:', err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [numericIdInput, isSkipped]);

  // Handle on-screen keypad press
  const handleKeypadPress = (digit: string) => {
    if (isLocked) return;
    try {
      Vibration.vibrate(10);
    } catch {}

    if (isSkipped) {
      setIsSkipped(false);
    }

    setNumericIdInput(prev => prev + digit);
  };

  const handleKeypadBackspace = () => {
    if (isLocked) return;
    try {
      Vibration.vibrate(10);
    } catch {}

    setNumericIdInput(prev => prev.slice(0, -1));
  };

  const handleKeypadClear = () => {
    if (isLocked) return;
    try {
      Vibration.vibrate(15);
    } catch {}

    setNumericIdInput('');
    setMatchedFolder(null);
    setSuggestions([]);
    setIsSkipped(false);
  };

  const handleSelectSuggestion = (folder: PrecreatedFolderRecord) => {
    try {
      Vibration.vibrate(15);
    } catch {}
    setNumericIdInput(folder.numeric_id || folder.raw_id || '');
    setMatchedFolder(folder);
    setSuggestions([]);
    setIsSkipped(false);
    Keyboard.dismiss();
  };

  const handleToggleSkip = () => {
    try {
      Vibration.vibrate(12);
    } catch {}
    if (!isSkipped) {
      setIsSkipped(true);
      setNumericIdInput('');
      setMatchedFolder(null);
      setSuggestions([]);
    } else {
      setIsSkipped(false);
    }
  };

  const handleSyncFolders = async () => {
    setIsSyncingFolders(true);
    try {
      Vibration.vibrate(15);
    } catch {}
    try {
      const count = await syncFolders();
      await loadFolderCount();
      Alert.alert('Drive Folders Synced', `Successfully cached ${count} pre-created attendee folders from Google Drive.`);
    } catch (e: any) {
      Alert.alert('Sync Failed', e.message || 'Could not sync Drive folders. Please check your internet connection and Drive settings.');
    } finally {
      setIsSyncingFolders(false);
    }
  };

  // Launch Camera with resolved parameters
  const handleLaunchCamera = () => {
    try {
      Vibration.vibrate(20);
    } catch {}

    let targetAttendeeId = 'no_id';
    let targetFolderId = '';
    let targetAttendeeName = 'General Shots';

    if (isSkipped) {
      targetAttendeeId = 'no_id';
      targetFolderId = '';
      targetAttendeeName = 'General Shots';
    } else if (matchedFolder) {
      targetAttendeeId = matchedFolder.raw_id || matchedFolder.numeric_id || numericIdInput.trim();
      targetFolderId = matchedFolder.drive_folder_id;
      targetAttendeeName = matchedFolder.attendee_name || matchedFolder.raw_id || targetAttendeeId;
    } else if (numericIdInput.trim()) {
      targetAttendeeId = numericIdInput.trim();
      targetFolderId = '';
      targetAttendeeName = `ID #${targetAttendeeId}`;
    } else {
      Alert.alert(
        'No ID Entered',
        'Please enter an attendee ticket number or tap "Skip ID / General Shots" before opening the camera.',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Take General Shots',
            onPress: () => {
              setIsSkipped(true);
              router.push({
                pathname: '/camera',
                params: {
                  attendeeId: 'no_id',
                  folderId: '',
                  attendeeName: 'General Shots',
                },
              });
            },
          },
        ]
      );
      return;
    }

    router.push({
      pathname: '/camera',
      params: {
        attendeeId: targetAttendeeId,
        folderId: targetFolderId,
        attendeeName: targetAttendeeName,
      },
    });
  };

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top', 'left', 'right']}>
      {/* Top Header Bar */}
      <View style={styles.headerBar}>
        <View>
          <Text style={styles.headerTitle}>Attendee Session</Text>
          <Text style={styles.headerSubtitle}>
            {user
              ? isDemo
                ? __DEV__
                  ? 'Dev Mode (Mock Sync)'
                  : ''
                : `Staff: ${user.name || user.email}`
              : 'Ready'}
          </Text>
        </View>

        <View style={styles.headerActions}>
          <View style={styles.networkBadge}>
            <View style={[styles.statusDot, { backgroundColor: isOnline ? '#10B981' : '#EF4444' }]} />
            <Text style={styles.networkBadgeText}>{isOnline ? 'Online' : 'Offline'}</Text>
          </View>

          <TouchableOpacity
            style={styles.settingsIconBtn}
            onPress={() => router.push('/settings')}
            accessibilityLabel="Settings"
          >
            <Ionicons name="settings-outline" size={20} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: Math.max(insets.bottom, 16) + 48 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Drive Folders Status Pill */}
        <View style={styles.driveStatusCard}>
          <View style={styles.driveStatusLeft}>
            <Ionicons name="folder-open" size={20} color={Colors.primaryLight} />
            <View style={{ marginLeft: 10, flex: 1 }}>
              <Text style={styles.driveStatusTitle} numberOfLines={1}>
                {settings.parentFolderName || 'Google Drive Pre-created Folders'}
              </Text>
              <Text style={styles.driveStatusSubtitle}>
                {cachedFolderCount > 0
                  ? `${cachedFolderCount} attendee folders ready in cache`
                  : 'No folders cached yet'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.syncButton}
            onPress={handleSyncFolders}
            disabled={isSyncingFolders}
          >
            {isSyncingFolders ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <>
                <Ionicons name="refresh" size={14} color="#FFFFFF" />
                <Text style={styles.syncButtonText}>Sync</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Attendee ID Input Card */}
        <View style={styles.inputCard}>
          <View style={styles.inputHeaderRow}>
            <Text style={styles.inputSectionLabel}>TICKET / ATTENDEE NUMBER</Text>
            {numericIdInput.length > 0 && !isLocked && (
              <TouchableOpacity onPress={handleKeypadClear} style={styles.clearInlineBtn}>
                <Ionicons name="close-circle" size={18} color="#94A3B8" />
                <Text style={styles.clearInlineText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Large Digit Input Display (Touch does NOT summon mobile software keyboard) */}
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => {
              if (isLocked) {
                Alert.alert('Locked', 'Unlock the attendee before changing the number.');
              }
            }}
            style={[styles.inputWrapper, isLocked && styles.inputWrapperLocked]}
          >
            <Ionicons
              name={isLocked ? 'lock-closed' : 'keypad'}
              size={22}
              color={isLocked ? Colors.warning : Colors.primaryLight}
              style={{ marginRight: 6 }}
            />
            <View style={styles.numericDisplayCenter}>
              <Text
                style={[
                  styles.numericInput,
                  !numericIdInput && !isSkipped && styles.numericInputPlaceholder,
                  isSkipped && styles.numericInputSkipped,
                  isLocked && styles.numericInputLocked,
                ]}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.7}
              >
                {isSkipped
                  ? 'GENERAL SHOTS (NO ID)'
                  : numericIdInput || 'Enter digits (e.g. 89487)'}
              </Text>
            </View>
            {isLocked ? (
              <View style={styles.lockPill}>
                <Text style={styles.lockPillText}>LOCKED</Text>
              </View>
            ) : (
              <View style={{ width: 28 }} />
            )}
          </TouchableOpacity>

          <Text style={styles.inputHintText}>
            Type ticket numbers using the keypad below — no need to type &quot;KOT-&quot; or names.
          </Text>

          {/* Matched Attendee Card (Live Preview) */}
          {matchedFolder ? (
            <View style={styles.matchCard}>
              <View style={styles.matchIconCircle}>
                <Ionicons name="checkmark-circle" size={26} color={Colors.success} />
              </View>
              <View style={styles.matchDetails}>
                <View style={styles.matchHeaderRow}>
                  <Text style={styles.attendeeNameText}>
                    {matchedFolder.attendee_name || 'Matched Attendee'}
                  </Text>
                  <View style={styles.verifiedBadge}>
                    <Ionicons name="shield-checkmark" size={11} color={Colors.success} />
                    <Text style={styles.verifiedBadgeText}>DRIVE READY</Text>
                  </View>
                </View>

                <View style={styles.codeRow}>
                  <Text style={styles.codeLabel}>Ticket Code:</Text>
                  <Text style={styles.codeValue}>{matchedFolder.raw_id || matchedFolder.numeric_id}</Text>
                </View>

                <View style={styles.targetFolderRow}>
                  <Ionicons name="folder" size={13} color={Colors.primaryLight} />
                  <Text style={styles.targetFolderName} numberOfLines={1}>
                    {matchedFolder.folder_name}
                  </Text>
                </View>
              </View>
            </View>
          ) : suggestions.length > 0 ? (
            <View style={styles.suggestionsContainer}>
              <Text style={styles.suggestionsHeader}>Suggested Matches in Drive:</Text>
              <View style={styles.suggestionsList}>
                {suggestions.map(s => (
                  <TouchableOpacity
                    key={s.drive_folder_id}
                    style={styles.suggestionChip}
                    onPress={() => handleSelectSuggestion(s)}
                  >
                    <Ionicons name="person-circle-outline" size={16} color={Colors.primaryLight} />
                    <Text style={styles.suggestionChipText}>
                      {s.attendee_name} ({s.numeric_id || s.raw_id})
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : numericIdInput.trim().length >= 3 && !matchedFolder && !isSkipped ? (
            <View style={styles.unmatchedNotice}>
              <Ionicons name="alert-circle-outline" size={18} color={Colors.warning} />
              <Text style={styles.unmatchedNoticeText}>
                No folder found for &quot;{numericIdInput}&quot;. Photos will upload with ID #{numericIdInput}.
              </Text>
            </View>
          ) : isSkipped ? (
            <View style={styles.skippedNotice}>
              <Ionicons name="images-outline" size={18} color={Colors.primaryLight} />
              <Text style={styles.skippedNoticeText}>
                General Shot Session active. Photos will be saved under General / no ID.
              </Text>
            </View>
          ) : null}
        </View>

        {/* Quick Numeric Keypad for Rapid Booth Operation */}
        <View style={styles.keypadCard}>
          <View style={styles.keypadRow}>
            {['1', '2', '3'].map(k => (
              <TouchableOpacity
                key={k}
                style={[styles.keypadKey, isLocked && styles.keypadKeyDisabled]}
                disabled={isLocked}
                onPress={() => handleKeypadPress(k)}
              >
                <Text style={styles.keypadKeyText}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.keypadRow}>
            {['4', '5', '6'].map(k => (
              <TouchableOpacity
                key={k}
                style={[styles.keypadKey, isLocked && styles.keypadKeyDisabled]}
                disabled={isLocked}
                onPress={() => handleKeypadPress(k)}
              >
                <Text style={styles.keypadKeyText}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.keypadRow}>
            {['7', '8', '9'].map(k => (
              <TouchableOpacity
                key={k}
                style={[styles.keypadKey, isLocked && styles.keypadKeyDisabled]}
                disabled={isLocked}
                onPress={() => handleKeypadPress(k)}
              >
                <Text style={styles.keypadKeyText}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.keypadRow}>
            <TouchableOpacity
              style={[styles.keypadKey, styles.keypadUtilityKey, isLocked && styles.keypadKeyDisabled]}
              disabled={isLocked}
              onPress={handleKeypadClear}
            >
              <Text style={styles.keypadUtilityText}>CLEAR</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.keypadKey, isLocked && styles.keypadKeyDisabled]}
              disabled={isLocked}
              onPress={() => handleKeypadPress('0')}
            >
              <Text style={styles.keypadKeyText}>0</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.keypadKey, styles.keypadUtilityKey, isLocked && styles.keypadKeyDisabled]}
              disabled={isLocked}
              onPress={handleKeypadBackspace}
            >
              <Ionicons name="backspace-outline" size={22} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Session Options: Lock & Skip */}
        <View style={styles.optionsCard}>
          {/* Lock Session Switch */}
          <View style={styles.optionRow}>
            <View style={styles.optionInfo}>
              <View style={styles.optionLabelRow}>
                <Ionicons
                  name={isLocked ? 'lock-closed' : 'lock-open-outline'}
                  size={18}
                  color={isLocked ? Colors.warning : Colors.textSecondary}
                />
                <Text style={styles.optionLabel}>Lock Session</Text>
              </View>
              <Text style={styles.optionDescription}>
                Keep this attendee active across multiple camera shoots without retyping
              </Text>
            </View>
            <Switch
              value={isLocked}
              onValueChange={val => {
                try {
                  Vibration.vibrate(10);
                } catch {}
                setIsLocked(val);
              }}
              trackColor={{ false: Colors.border, true: Colors.primaryDark }}
              thumbColor={isLocked ? Colors.primaryLight : Colors.textSecondary}
            />
          </View>

          <View style={styles.optionDivider} />

          {/* Skip ID / General Shots Button */}
          <TouchableOpacity
            style={[styles.skipButton, isSkipped && styles.skipButtonActive]}
            onPress={handleToggleSkip}
          >
            <Ionicons
              name={isSkipped ? 'checkmark-circle' : 'images-outline'}
              size={18}
              color={isSkipped ? Colors.success : Colors.textSecondary}
            />
            <Text style={[styles.skipButtonText, isSkipped && styles.skipButtonTextActive]}>
              {isSkipped ? 'General Shots Mode Active' : 'Skip ID / General Shots'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Primary CTA: Open Camera */}
        <TouchableOpacity
          style={[
            styles.openCameraBtn,
            (!numericIdInput && !isSkipped) && styles.openCameraBtnSecondary,
          ]}
          activeOpacity={0.85}
          onPress={handleLaunchCamera}
        >
          <Ionicons name="camera" size={24} color="#FFFFFF" style={{ marginRight: 10 }} />
          <Text style={styles.openCameraBtnText}>
            {isSkipped
              ? 'Open Camera (General Shots)'
              : matchedFolder
              ? `Open Camera for ${matchedFolder.attendee_name || matchedFolder.numeric_id}`
              : numericIdInput.trim()
              ? `Open Camera (${numericIdInput.trim()})`
              : 'Open Camera'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color="#FFFFFF" style={{ marginLeft: 6 }} />
        </TouchableOpacity>

        {/* Minimal Queue Summary Footer */}
        <TouchableOpacity
          style={styles.queueFooterRow}
          onPress={() => router.push('/(tabs)/queue')}
        >
          <Ionicons name="cloud-upload-outline" size={16} color="#64748B" />
          <Text style={styles.queueFooterText}>
            Queue: {stats.pending} pending • {stats.uploading} syncing • {stats.completed} completed
          </Text>
          <Ionicons name="chevron-forward" size={14} color="#64748B" />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    backgroundColor: Colors.card,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardElevated,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginRight: 6,
  },
  networkBadgeText: {
    color: '#E2E8F0',
    fontSize: 11,
    fontWeight: '600',
  },
  settingsIconBtn: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.cardElevated,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 18,
    gap: 16,
  },
  driveStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.card,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  driveStatusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  driveStatusTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  driveStatusSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryDark,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  syncButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  inputCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  inputHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  inputSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 1.0,
  },
  clearInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  clearInlineText: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: '600',
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardElevated,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    height: 56,
  },
  inputWrapperLocked: {
    borderColor: '#F59E0B',
    backgroundColor: '#1E1B18',
  },
  numericDisplayCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  numericInput: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 2,
    textAlign: 'center',
  },
  numericInputLocked: {
    color: '#F59E0B',
  },
  numericInputPlaceholder: {
    color: Colors.textMuted,
    fontSize: 18,
    fontWeight: '500',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  numericInputSkipped: {
    color: Colors.primaryLight,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  lockPill: {
    backgroundColor: '#78350F',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  lockPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FCD34D',
  },
  inputHintText: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 8,
    marginLeft: 2,
  },
  matchCard: {
    flexDirection: 'row',
    backgroundColor: 'rgba(16, 185, 129, 0.10)',
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    alignItems: 'center',
  },
  matchIconCircle: {
    marginRight: 12,
  },
  matchDetails: {
    flex: 1,
  },
  matchHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  attendeeNameText: {
    fontSize: 17,
    fontWeight: '800',
    color: '#10B981',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.20)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    gap: 4,
  },
  verifiedBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: '#10B981',
    letterSpacing: 0.5,
  },
  codeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  codeLabel: {
    fontSize: 12,
    color: '#94A3B8',
  },
  codeValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  targetFolderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: Colors.primaryGlow,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  targetFolderName: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.primaryLight,
    flex: 1,
  },
  suggestionsContainer: {
    marginTop: 12,
  },
  suggestionsHeader: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  suggestionsList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardElevated,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    gap: 6,
  },
  suggestionChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  unmatchedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    gap: 8,
  },
  unmatchedNoticeText: {
    fontSize: 11,
    color: '#FCD34D',
    flex: 1,
    lineHeight: 16,
  },
  skippedNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.primaryGlow,
    borderRadius: 10,
    padding: 10,
    marginTop: 12,
    gap: 8,
  },
  skippedNoticeText: {
    fontSize: 12,
    color: Colors.primaryLight,
    flex: 1,
    lineHeight: 16,
  },
  keypadCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  keypadRow: {
    flexDirection: 'row',
    gap: 10,
  },
  keypadKey: {
    flex: 1,
    height: 52,
    backgroundColor: Colors.cardElevated,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  keypadKeyDisabled: {
    opacity: 0.4,
  },
  keypadKeyText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  keypadUtilityKey: {
    backgroundColor: Colors.card,
    borderColor: Colors.border,
  },
  keypadUtilityText: {
    fontSize: 12,
    fontWeight: '800',
    color: Colors.textSecondary,
    letterSpacing: 0.5,
  },
  optionsCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  optionInfo: {
    flex: 1,
    marginRight: 12,
  },
  optionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  optionDescription: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 3,
    lineHeight: 15,
  },
  optionDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 12,
  },
  skipButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
  },
  skipButtonActive: {
    borderColor: Colors.primaryLight,
    backgroundColor: Colors.primaryGlow,
  },
  skipButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  skipButtonTextActive: {
    color: Colors.primaryLight,
    fontWeight: '700',
  },
  openCameraBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 20,
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 5,
  },
  openCameraBtnSecondary: {
    backgroundColor: Colors.primaryDark,
  },
  openCameraBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  queueFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 6,
  },
  queueFooterText: {
    fontSize: 11,
    color: Colors.textMuted,
    fontWeight: '500',
  },
});
