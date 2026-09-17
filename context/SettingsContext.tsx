import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { queueManager } from '../services/queueManager';
import { DEFAULT_PARENT_FOLDER_ID } from '../services/driveApi';

export interface AppSettings {
  parentFolderId: string;
  parentFolderName?: string;
  maxConcurrency: number;
  autoCleanCompleted: boolean;
  uploadOnlyOnWifi: boolean;
  webClientId: string;
  iosClientId: string;
  androidClientId: string;
}

interface SettingsContextType {
  settings: AppSettings;
  updateSetting: <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => Promise<void>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>;
  isLoading: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  parentFolderId: '',
  parentFolderName: '',
  maxConcurrency: 2,
  autoCleanCompleted: false,
  uploadOnlyOnWifi: true,
  webClientId: '',
  iosClientId: '',
  androidClientId: '',
};

const SETTINGS_STORAGE_KEY = 'event_photo_app_settings';

const SettingsContext = createContext<SettingsContextType>({
  settings: DEFAULT_SETTINGS,
  updateSetting: async () => {},
  updateSettings: async () => {},
  isLoading: true,
});

export const SettingsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const stored = await SecureStore.getItemAsync(SETTINGS_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const merged = { ...DEFAULT_SETTINGS, ...parsed };

        // Auto-heal: If parentFolderId was previously overwritten to 'root'
        // while parentFolderName was a specific demo or event folder, repair parentFolderId
        if (merged.parentFolderId === 'root' && merged.parentFolderName) {
          const fn = merged.parentFolderName.trim().toLowerCase();
          if (fn === 'rawda & kot event 2026') {
            merged.parentFolderId = 'demo_folder_rawda_2026';
          } else if (fn === 'annual gala 2026') {
            merged.parentFolderId = 'demo_folder_gala_2026';
          } else if (fn === 'event photo booth destination') {
            merged.parentFolderId = 'demo_folder_booth_photos';
          } else if (fn === 'vip & corporate party 2026') {
            merged.parentFolderId = 'demo_folder_wedding_2026';
          }
        }

        setSettings(merged);
        queueManager.setParentFolderId(merged.parentFolderId || 'root');
        queueManager.setMaxConcurrency(merged.maxConcurrency);
        queueManager.setUploadOnlyOnWifi(merged.uploadOnlyOnWifi ?? true);
      } else {
        queueManager.setParentFolderId(DEFAULT_SETTINGS.parentFolderId || 'root');
        queueManager.setMaxConcurrency(DEFAULT_SETTINGS.maxConcurrency);
        queueManager.setUploadOnlyOnWifi(DEFAULT_SETTINGS.uploadOnlyOnWifi);
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const updateSettings = async (partial: Partial<AppSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...partial };
      return updated;
    });

    if (partial.parentFolderId !== undefined) {
      queueManager.setParentFolderId(partial.parentFolderId || 'root');
    }
    if (partial.maxConcurrency !== undefined) {
      queueManager.setMaxConcurrency(partial.maxConcurrency);
    }
    if (partial.uploadOnlyOnWifi !== undefined) {
      queueManager.setUploadOnlyOnWifi(partial.uploadOnlyOnWifi);
    }

    try {
      const stored = await SecureStore.getItemAsync(SETTINGS_STORAGE_KEY);
      const current = stored ? JSON.parse(stored) : {};
      const updated = { ...current, ...partial };
      await SecureStore.setItemAsync(SETTINGS_STORAGE_KEY, JSON.stringify(updated));
    } catch (e) {
      console.error('Failed to persist settings:', e);
    }
  };

  const updateSetting = async <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    await updateSettings({ [key]: value } as Partial<AppSettings>);
  };

  return (
    <SettingsContext.Provider value={{ settings, updateSetting, updateSettings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
