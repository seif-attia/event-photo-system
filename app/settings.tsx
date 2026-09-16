import React, { useState, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useQueue } from '../context/QueueContext';
import { testDriveConnectionAsync, DriveFolderItem } from '../services/driveApi';
import { DriveFolderPickerModal } from '../components/DriveFolderPickerModal';
import {
  clearFolderCacheAsync,
  getPrecreatedFoldersCountAsync,
  getAllPrecreatedFoldersAsync,
  clearPrecreatedFoldersAsync,
} from '../database/sqlite';
import { PrecreatedFolderRecord } from '../database/schema';

export default function SettingsScreen() {
  const router = useRouter();
  const { settings, updateSetting, updateSettings } = useSettings();
  const { tokens, isDemo, user, signOut } = useAuth();
  const { syncFolders } = useQueue();

  const [parentFolderInput, setParentFolderInput] = useState(settings.parentFolderId);
  const [showFolderPicker, setShowFolderPicker] = useState(false);

  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const [folderCount, setFolderCount] = useState<number>(0);
  const [previewFolders, setPreviewFolders] = useState<PrecreatedFolderRecord[]>([]);
  const [isSyncingFolders, setIsSyncingFolders] = useState(false);

  useEffect(() => {
    loadCachedFolders();
  }, []);

  useEffect(() => {
    setParentFolderInput(settings.parentFolderId);
  }, [settings.parentFolderId]);

  const loadCachedFolders = async () => {
    try {
      const count = await getPrecreatedFoldersCountAsync();
      setFolderCount(count);
      const all = await getAllPrecreatedFoldersAsync();
      setPreviewFolders(all.slice(0, 5));
    } catch (e) {
      console.error('Failed to load precreated folders count:', e);
    }
  };

  const handleSignOut = () => {
    Alert.alert(
      'Switch Google Account',
      `Currently signed in as ${user?.email || user?.name || 'Staff'}.\n\nDo you want to sign out and switch to another Google account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out & Switch',
          style: 'destructive',
          onPress: async () => {
            await signOut();
            router.replace('/auth');
          },
        },
      ]
    );
  };

  const handleSelectFolder = async (folder: DriveFolderItem) => {
    setParentFolderInput(folder.id);
    await updateSettings({
      parentFolderId: folder.id,
      parentFolderName: folder.name,
    });

    setIsSyncingFolders(true);
    try {
      const count = await syncFolders();
      await loadCachedFolders();
      Alert.alert(
        'Folder Connected',
        `Destination set to "${folder.name}". Cached ${count} attendee folders from Google Drive.`
      );
    } catch (e: any) {
      Alert.alert(
        'Folder Connected',
        `Destination set to "${folder.name}". Ready for event capture.`
      );
    } finally {
      setIsSyncingFolders(false);
    }
  };

  const handleSaveSettings = async () => {
    const trimmedId = parentFolderInput.trim() || 'root';
    const folderName = trimmedId === 'root' ? 'Root (My Drive)' : `Folder (${trimmedId.slice(0, 8)}...)`;
    await updateSettings({
      parentFolderId: trimmedId,
      parentFolderName: folderName,
    });
    Alert.alert('Settings Saved', 'Configuration has been updated.');
  };

  const handleTestConnection = async () => {
    setIsTestingConnection(true);
    setTestResult(null);
    try {
      const accessToken = tokens?.accessToken || 'mock_token';
      const result = await testDriveConnectionAsync(parentFolderInput.trim(), accessToken, isDemo);
      setTestResult(result);
    } catch (e: any) {
      setTestResult({ success: false, message: e.message || 'Connection test failed' });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleSyncFoldersNow = async () => {
    setIsSyncingFolders(true);
    try {
      const count = await syncFolders();
      await loadCachedFolders();
      Alert.alert('Success', `Synced and cached ${count} pre-created folders from Google Drive.`);
    } catch (e: any) {
      Alert.alert('Sync Error', e.message || 'Failed to sync pre-created folders from Drive.');
    } finally {
      setIsSyncingFolders(false);
    }
  };

  const handleClearPrecreatedFolders = () => {
    Alert.alert(
      'Clear Folders Cache',
      'This will remove all locally cached folder names and numbers. You can re-sync anytime.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            await clearPrecreatedFoldersAsync();
            await clearFolderCacheAsync();
            await loadCachedFolders();
            Alert.alert('Cleared', 'Pre-created folders cache has been cleared.');
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Google Account & Switch Session */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="person-circle-outline" size={20} color="#38BDF8" />
          <Text style={styles.cardTitle}>Google Account & Staff Session</Text>
        </View>

        <View style={styles.accountRow}>
          <View style={styles.accountAvatar}>
            <Ionicons name="person" size={20} color="#60A5FA" />
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={styles.accountName}>{user?.name || 'Event Staff'}</Text>
            <Text style={styles.accountEmail}>
              {isDemo ? 'Demo Mode Active (Offline Sandbox)' : user?.email || 'Logged in'}
            </Text>
          </View>
        </View>

        {/* Prominent Sign Out / Switch Account Button */}
        <TouchableOpacity style={styles.switchAccountBtn} onPress={handleSignOut}>
          <Ionicons name="log-out-outline" size={18} color="#EF4444" />
          <Text style={styles.switchAccountBtnText}>Sign Out / Switch Google Account</Text>
        </TouchableOpacity>
      </View>

      {/* Google Drive Parent Folder Section */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="folder" size={20} color="#3B82F6" />
          <Text style={styles.cardTitle}>Google Drive Event Storage</Text>
        </View>

        {/* Active Folder Badge */}
        <View style={styles.activeFolderBadge}>
          <Ionicons name="checkmark-circle" size={20} color="#10B981" />
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.activeFolderLabel}>CURRENT DESTINATION FOLDER</Text>
            <Text style={styles.activeFolderName} numberOfLines={1}>
              {settings.parentFolderName ||
                (settings.parentFolderId === 'root'
                  ? 'Root (My Drive)'
                  : settings.parentFolderId || 'None Selected')}
            </Text>
          </View>
        </View>

        {/* Visual Folder Selector Button */}
        <TouchableOpacity
          style={styles.browseButton}
          onPress={() => setShowFolderPicker(true)}
        >
          <Ionicons name="folder-open" size={18} color="#FFFFFF" />
          <Text style={styles.browseButtonText}>Browse & Select Drive Folder</Text>
        </TouchableOpacity>

        <Text style={styles.label}>Or Folder ID</Text>
        <Text style={styles.hint}>
          The Google Drive folder containing pre-created attendee folders (e.g. &quot;Rawda - KOT-89487&quot;).
        </Text>
        <TextInput
          style={styles.input}
          value={parentFolderInput}
          onChangeText={setParentFolderInput}
          placeholder="e.g. 1a2b3c4d5e... or 'root'"
          placeholderTextColor="#64748B"
          autoCapitalize="none"
          autoCorrect={false}
        />

        {/* Test Connection Button */}
        <TouchableOpacity
          style={styles.testButton}
          onPress={handleTestConnection}
          disabled={isTestingConnection}
        >
          {isTestingConnection ? (
            <ActivityIndicator size="small" color="#3B82F6" />
          ) : (
            <>
              <Ionicons name="cloud-done-outline" size={16} color="#3B82F6" />
              <Text style={styles.testButtonText}>Test Folder Connection</Text>
            </>
          )}
        </TouchableOpacity>

        {testResult && (
          <View
            style={[
              styles.resultBox,
              testResult.success ? styles.resultSuccess : styles.resultError,
            ]}
          >
            <Ionicons
              name={testResult.success ? 'checkmark-circle' : 'alert-circle'}
              size={18}
              color={testResult.success ? '#10B981' : '#EF4444'}
            />
            <Text
              style={[
                styles.resultText,
                { color: testResult.success ? '#A7F3D0' : '#FCA5A5' },
              ]}
            >
              {testResult.message}
            </Text>
          </View>
        )}
      </View>

      {/* Pre-Created Attendee Folders Directory */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="people-outline" size={20} color="#10B981" />
          <Text style={styles.cardTitle}>Pre-Created Attendee Folders</Text>
        </View>
        <Text style={styles.hint}>
          Attendee folders are pre-created in Google Drive (e.g. "Rawda - KOT-89487"). Syncing downloads and caches them locally so staff only types numbers (89487) and matches 100% offline.
        </Text>

        <View style={styles.cachedFolderBanner}>
          <Ionicons name="server" size={18} color="#60A5FA" />
          <Text style={styles.cachedFolderCountText}>
            {folderCount} folder(s) cached locally in SQLite
          </Text>
        </View>

        {previewFolders.length > 0 && (
          <View style={styles.previewList}>
            <Text style={styles.previewTitle}>Sample Cached Folders:</Text>
            {previewFolders.map(f => (
              <View key={f.drive_folder_id} style={styles.previewItem}>
                <Ionicons name="folder-outline" size={14} color="#94A3B8" />
                <Text style={styles.previewText} numberOfLines={1}>
                  {f.folder_name} <Text style={{ color: '#60A5FA' }}>(#{f.numeric_id})</Text>
                </Text>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity
          style={styles.syncFoldersButton}
          onPress={handleSyncFoldersNow}
          disabled={isSyncingFolders}
        >
          {isSyncingFolders ? (
            <ActivityIndicator size="small" color="#FFFFFF" />
          ) : (
            <>
              <Ionicons name="sync-outline" size={18} color="#FFFFFF" />
              <Text style={styles.syncFoldersButtonText}>Sync Folders from Google Drive</Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {/* Sync Engine Concurrency */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="speedometer-outline" size={20} color="#F59E0B" />
          <Text style={styles.cardTitle}>Upload Concurrency</Text>
        </View>
        <Text style={styles.hint}>
          Maximum simultaneous photo uploads. Lower concurrency preserves bandwidth on mobile hotspots.
        </Text>
        <View style={styles.concurrencyRow}>
          {[1, 2].map(num => (
            <TouchableOpacity
              key={num}
              style={[
                styles.concurrencyButton,
                settings.maxConcurrency === num && styles.concurrencyButtonActive,
              ]}
              onPress={() => updateSetting('maxConcurrency', num)}
            >
              <Text
                style={[
                  styles.concurrencyText,
                  settings.maxConcurrency === num && styles.concurrencyTextActive,
                ]}
              >
                {num} {num === 1 ? 'Worker (Sequential)' : 'Workers (Parallel 2x)'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Database Maintenance */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="trash-outline" size={20} color="#EC4899" />
          <Text style={styles.cardTitle}>Cache Maintenance</Text>
        </View>

        <TouchableOpacity style={styles.dangerButton} onPress={handleClearPrecreatedFolders}>
          <Ionicons name="trash-bin-outline" size={16} color="#F43F5E" />
          <Text style={styles.dangerButtonText}>Clear Pre-Created Folders Cache</Text>
        </TouchableOpacity>
      </View>

      {/* Save Button */}
      <TouchableOpacity style={styles.saveButton} onPress={handleSaveSettings}>
        <Ionicons name="save-outline" size={20} color="#FFFFFF" />
        <Text style={styles.saveButtonText}>Save Configuration</Text>
      </TouchableOpacity>

      {/* Google Drive Visual Folder Picker Modal */}
      <DriveFolderPickerModal
        visible={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelectFolder={handleSelectFolder}
        currentFolderId={settings.parentFolderId}
        currentFolderName={settings.parentFolderName}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0A0F1D',
  },
  content: {
    padding: 20,
    paddingBottom: 40,
  },
  card: {
    backgroundColor: '#131D31',
    borderRadius: 16,
    padding: 18,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  accountAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1E293B',
    justifyContent: 'center',
    alignItems: 'center',
  },
  accountName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  accountEmail: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  switchAccountBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: 10,
    paddingVertical: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  switchAccountBtnText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '700',
  },
  activeFolderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.25)',
  },
  activeFolderLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#34D399',
    letterSpacing: 0.5,
  },
  activeFolderName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
    marginTop: 2,
  },
  browseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
    borderRadius: 10,
    paddingVertical: 12,
    marginBottom: 14,
    gap: 8,
  },
  browseButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#CBD5E1',
    marginTop: 10,
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: '#64748B',
    lineHeight: 16,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#F8FAFC',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  testButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    paddingVertical: 10,
    borderRadius: 10,
    marginTop: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.25)',
  },
  testButtonText: {
    color: '#3B82F6',
    fontSize: 13,
    fontWeight: '600',
  },
  resultBox: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 10,
    marginTop: 10,
    gap: 8,
  },
  resultSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
  },
  resultError: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  resultText: {
    fontSize: 12,
    fontWeight: '500',
    flex: 1,
  },
  cachedFolderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
    padding: 12,
    borderRadius: 10,
    gap: 8,
    marginVertical: 10,
  },
  cachedFolderCountText: {
    color: '#93C5FD',
    fontSize: 13,
    fontWeight: '700',
  },
  previewList: {
    backgroundColor: '#0F172A',
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  previewTitle: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '700',
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  previewItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  previewText: {
    color: '#CBD5E1',
    fontSize: 12,
  },
  syncFoldersButton: {
    backgroundColor: '#2563EB',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  syncFoldersButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  concurrencyRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  concurrencyButton: {
    flex: 1,
    backgroundColor: '#0F172A',
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  concurrencyButtonActive: {
    backgroundColor: '#2563EB',
    borderColor: '#3B82F6',
  },
  concurrencyText: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  concurrencyTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.25)',
    gap: 8,
    marginTop: 8,
  },
  dangerButtonText: {
    color: '#F43F5E',
    fontSize: 13,
    fontWeight: '600',
  },
  saveButton: {
    backgroundColor: '#10B981',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    marginTop: 8,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
});
