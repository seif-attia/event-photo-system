import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { listUserDriveFoldersAsync, DriveFolderItem } from '../services/driveApi';
import { useAuth } from '../context/AuthContext';
import { Colors } from '../constants/colors';

interface DriveFolderPickerModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectFolder: (folder: DriveFolderItem) => Promise<void> | void;
  currentFolderId?: string;
  currentFolderName?: string;
  title?: string;
}

export const DriveFolderPickerModal: React.FC<DriveFolderPickerModalProps> = ({
  visible,
  onClose,
  onSelectFolder,
  currentFolderId,
  currentFolderName,
  title = 'Select Google Drive Event Folder',
}) => {
  const { tokens, isDemo } = useAuth();
  const [folders, setFolders] = useState<DriveFolderItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSelecting, setIsSelecting] = useState(false);
  const [activeId, setActiveId] = useState<string>('');
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualIdInput, setManualIdInput] = useState('');
  const [manualNameInput, setManualNameInput] = useState('');

  const loadFolders = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const accessToken = tokens?.accessToken || 'demo_token';
      const items = await listUserDriveFoldersAsync(accessToken, isDemo);
      setFolders(items);

      // Auto-match activeId by folder name if currentFolderId was missing or stale root
      const isSpecificName =
        !!currentFolderName &&
        currentFolderName !== '' &&
        currentFolderName !== 'Root (My Drive)' &&
        currentFolderName !== 'My Drive (Root)';

      if (isSpecificName) {
        const match = items.find(
          f => f.name.trim().toLowerCase() === currentFolderName.trim().toLowerCase()
        );
        if (match) {
          setActiveId(match.id);
        }
      }
    } catch (e: any) {
      setError(e.message || 'Failed to fetch Google Drive folders');
    } finally {
      setIsLoading(false);
    }
  }, [tokens?.accessToken, isDemo, currentFolderName]);

  useEffect(() => {
    if (visible) {
      const isSpecificName =
        !!currentFolderName &&
        currentFolderName !== '' &&
        currentFolderName !== 'Root (My Drive)' &&
        currentFolderName !== 'My Drive (Root)';

      if (isSpecificName && (!currentFolderId || currentFolderId === 'root')) {
        // Stale closure recovery: don't default activeId to 'root' if the saved folder name is specific!
        setActiveId('');
      } else {
        setActiveId(currentFolderId || '');
      }

      loadFolders();
      setSearchQuery('');
      setShowManualInput(false);
      setManualIdInput('');
      setManualNameInput('');
    }
  }, [visible, currentFolderId, currentFolderName, loadFolders]);

  const checkIsSelected = (item: DriveFolderItem): boolean => {
    // 1. If activeId is set, it is the sole source of truth for the active selection
    if (activeId) {
      return item.id.toLowerCase() === activeId.toLowerCase();
    }

    // 2. If no activeId is set, check currentFolderName (if specific and not root)
    const isSpecificName =
      !!currentFolderName &&
      currentFolderName !== '' &&
      currentFolderName !== 'Root (My Drive)' &&
      currentFolderName !== 'My Drive (Root)';

    if (isSpecificName) {
      // Root must NEVER match when a specific folder name is designated
      if (item.isRoot || item.id.toLowerCase() === 'root') {
        return false;
      }
      return item.name.trim().toLowerCase() === currentFolderName.trim().toLowerCase();
    }

    // 3. Fallback to currentFolderId if valid and non-empty
    if (currentFolderId && currentFolderId !== '') {
      return item.id.toLowerCase() === currentFolderId.toLowerCase();
    }

    return false;
  };

  const handleSelect = async (folder: DriveFolderItem) => {
    setActiveId(folder.id);
    setIsSelecting(true);
    try {
      await onSelectFolder(folder);
      onClose();
    } catch (e: any) {
      Alert.alert('Selection Error', e.message || 'Could not select folder.');
    } finally {
      setIsSelecting(false);
    }
  };

  const handleManualSubmit = async () => {
    const trimmedId = manualIdInput.trim();
    if (!trimmedId) {
      Alert.alert('Missing ID', 'Please enter a valid Google Drive folder ID.');
      return;
    }
    const customFolder: DriveFolderItem = {
      id: trimmedId,
      name: manualNameInput.trim() || `Drive Folder (${trimmedId.slice(0, 8)}...)`,
      isRoot: trimmedId.toLowerCase() === 'root',
    };
    await handleSelect(customFolder);
  };

  const filteredFolders = folders.filter(f =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={false} onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header Bar */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="folder-open" size={24} color={Colors.primaryLight} />
            <Text style={styles.headerTitle}>{title}</Text>
          </View>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={onClose}
            disabled={isSelecting}
            accessibilityLabel="Close folder picker"
          >
            <Ionicons name="close" size={24} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        <Text style={styles.subtitle}>
          Choose the Google Drive folder containing pre-created attendee folders (e.g. &quot;Rawda - KOT-89487&quot;).
        </Text>

        {/* Current Active Selection Banner */}
        {(currentFolderName || (activeId && activeId !== 'root')) && (
          <View style={styles.activeSelectionBanner}>
            <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
            <Text style={styles.activeSelectionText} numberOfLines={1}>
              Active:{' '}
              <Text style={styles.activeSelectionBold}>
                {currentFolderName || activeId}
              </Text>
            </Text>
          </View>
        )}

        {/* Search Bar */}
        <View style={styles.searchRow}>
          <Ionicons name="search" size={18} color={Colors.textMuted} style={{ marginRight: 8 }} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search folders..."
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={loadFolders}
            disabled={isLoading || isSelecting}
          >
            <Ionicons name="refresh" size={18} color={Colors.primaryLight} />
          </TouchableOpacity>
        </View>

        {/* Loading / Error States */}
        {isLoading && (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={Colors.primaryLight} />
            <Text style={styles.loadingText}>Fetching folders from Google Drive...</Text>
          </View>
        )}

        {error && !isLoading && (
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle" size={20} color={Colors.error} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity style={styles.retryBtn} onPress={loadFolders}>
              <Text style={styles.retryBtnText}>Retry</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Folder List */}
        {!isLoading && (
          <FlatList
            data={filteredFolders}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isSelected = checkIsSelected(item);
              return (
                <TouchableOpacity
                  style={[styles.folderItem, isSelected && styles.folderItemSelected]}
                  onPress={() => handleSelect(item)}
                  disabled={isSelecting}
                  activeOpacity={0.7}
                >
                  <View style={[styles.folderIconWrap, isSelected && styles.folderIconWrapSelected]}>
                    <Ionicons
                      name={item.isRoot ? 'cloud-done' : 'folder'}
                      size={22}
                      color={isSelected ? Colors.primaryLight : Colors.textMuted}
                    />
                  </View>
                  <View style={styles.folderInfo}>
                    <Text
                      style={[styles.folderName, isSelected && styles.folderNameSelected]}
                      numberOfLines={1}
                    >
                      {item.name}
                    </Text>
                    <Text style={styles.folderSubtext} numberOfLines={1}>
                      {item.isRoot ? 'My Drive Root Directory' : `ID: ${item.id}`}
                    </Text>
                  </View>
                  {isSelected ? (
                    <View style={styles.activePill}>
                      <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                      <Text style={styles.activePillText}>SELECTED</Text>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
                  )}
                </TouchableOpacity>
              );
            }}
            ListEmptyComponent={
              <View style={styles.centerBox}>
                <Ionicons name="folder-outline" size={48} color={Colors.textMuted} />
                <Text style={styles.emptyTitle}>No Matching Folders</Text>
                <Text style={styles.emptySubtitle}>
                  We didn&apos;t find any folders matching &quot;{searchQuery}&quot;. You can type a folder ID manually below.
                </Text>
              </View>
            }
          />
        )}

        {/* Manual ID Input Toggle */}
        <View style={styles.footer}>
          {!showManualInput ? (
            <TouchableOpacity
              style={styles.manualToggleBtn}
              onPress={() => setShowManualInput(true)}
            >
              <Ionicons name="create-outline" size={16} color={Colors.primaryLight} />
              <Text style={styles.manualToggleText}>Or Enter Custom Folder ID Manually</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.manualBox}>
              <View style={styles.manualHeader}>
                <Text style={styles.manualTitle}>Manual Folder ID Entry</Text>
                <TouchableOpacity onPress={() => setShowManualInput(false)}>
                  <Ionicons name="close" size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <TextInput
                style={styles.manualInput}
                placeholder="Folder Display Name (e.g. Annual Gala)"
                placeholderTextColor={Colors.textMuted}
                value={manualNameInput}
                onChangeText={setManualNameInput}
              />
              <TextInput
                style={[styles.manualInput, { marginTop: 8 }]}
                placeholder="Google Drive Folder ID (e.g. 1a2b3c...)"
                placeholderTextColor={Colors.textMuted}
                value={manualIdInput}
                onChangeText={setManualIdInput}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity
                style={styles.manualSubmitBtn}
                onPress={handleManualSubmit}
                disabled={isSelecting}
              >
                {isSelecting ? (
                  <ActivityIndicator size="small" color={Colors.textPrimary} />
                ) : (
                  <>
                    <Ionicons name="checkmark-sharp" size={16} color={Colors.textPrimary} />
                    <Text style={styles.manualSubmitText}>Use This Folder ID</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Selecting Overlay */}
        {isSelecting && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color={Colors.primaryLight} />
            <Text style={styles.overlayText}>Setting up folder and caching attendee subfolders...</Text>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.textPrimary,
    flexShrink: 1,
  },
  closeButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
    lineHeight: 18,
  },
  activeSelectionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successBg,
    marginHorizontal: 20,
    marginTop: 4,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
    gap: 8,
  },
  activeSelectionText: {
    color: Colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  activeSelectionBold: {
    color: Colors.success,
    fontWeight: '700',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.cardElevated,
    borderRadius: 12,
    marginHorizontal: 20,
    marginVertical: 10,
    paddingHorizontal: 12,
    height: 46,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: Colors.textPrimary,
  },
  refreshBtn: {
    padding: 6,
    marginLeft: 6,
  },
  centerBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
    marginTop: 12,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.errorBg,
    marginHorizontal: 20,
    marginVertical: 10,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.3)',
    gap: 10,
  },
  errorText: {
    color: Colors.error,
    fontSize: 13,
    flex: 1,
  },
  retryBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: Colors.error,
    borderRadius: 6,
  },
  retryBtnText: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  folderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  folderItemSelected: {
    borderColor: Colors.primaryLight,
    borderWidth: 2,
    backgroundColor: Colors.cardElevated,
  },
  folderIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: Colors.cardElevated,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  folderIconWrapSelected: {
    backgroundColor: Colors.primaryGlow,
  },
  folderInfo: {
    flex: 1,
  },
  folderName: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  folderNameSelected: {
    color: Colors.primaryLight,
    fontWeight: '800',
  },
  folderSubtext: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 2,
  },
  activePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.successBg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  activePillText: {
    color: Colors.success,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  selectedBadge: {
    marginLeft: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginTop: 12,
  },
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 18,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.card,
  },
  manualToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  manualToggleText: {
    color: Colors.primaryLight,
    fontSize: 13,
    fontWeight: '600',
  },
  manualBox: {
    backgroundColor: Colors.cardElevated,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  manualHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  manualTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  manualInput: {
    backgroundColor: Colors.cardHover,
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 42,
    color: Colors.textPrimary,
    fontSize: 13,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  manualSubmitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 10,
    gap: 6,
  },
  manualSubmitText: {
    color: Colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(11, 6, 22, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 30,
  },
  overlayText: {
    color: Colors.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
});
