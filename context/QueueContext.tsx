import React, { createContext, useContext, useState, useEffect } from 'react';
import { QueueSummary } from '../database/schema';
import { queueManager } from '../services/queueManager';
import { clearCompletedAsync } from '../database/sqlite';

interface QueueContextType {
  stats: QueueSummary;
  isOnline: boolean;
  isWifi: boolean;
  isWaitingForWifi: boolean;
  triggerSync: () => void;
  syncFolders: () => Promise<number>;
  retryFailed: () => Promise<number>;
  clearCompleted: () => Promise<number>;
  refreshStats: () => Promise<void>;
}

const DEFAULT_STATS: QueueSummary = {
  pending: 0,
  uploading: 0,
  completed: 0,
  failed: 0,
  total: 0,
};

const QueueContext = createContext<QueueContextType>({
  stats: DEFAULT_STATS,
  isOnline: true,
  isWifi: true,
  isWaitingForWifi: false,
  triggerSync: () => {},
  syncFolders: async () => 0,
  retryFailed: async () => 0,
  clearCompleted: async () => 0,
  refreshStats: async () => {},
});

export const QueueProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [stats, setStats] = useState<QueueSummary>(DEFAULT_STATS);
  const [isOnline, setIsOnline] = useState<boolean>(queueManager.getNetworkStatus());
  const [isWifi, setIsWifi] = useState<boolean>(queueManager.getIsWifi());
  const [isWaitingForWifi, setIsWaitingForWifi] = useState<boolean>(queueManager.isWaitingForWifi());

  useEffect(() => {
    const updateNetwork = () => {
      setIsOnline(queueManager.getNetworkStatus());
      setIsWifi(queueManager.getIsWifi());
      setIsWaitingForWifi(queueManager.isWaitingForWifi());
    };

    // Subscribe to real-time queue stats
    const unsubscribe = queueManager.subscribe(newStats => {
      setStats(newStats);
      updateNetwork();
    });

    // Check network periodically or on change
    const interval = setInterval(updateNetwork, 2000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);

  const triggerSync = () => {
    queueManager.triggerSync();
  };

  const retryFailed = async () => {
    return await queueManager.retryFailed();
  };

  const clearCompleted = async () => {
    const changes = await clearCompletedAsync();
    await queueManager.notifyListeners();
    return changes;
  };

  const syncFolders = async () => {
    return await queueManager.syncFolders();
  };

  const refreshStats = async () => {
    await queueManager.notifyListeners();
  };

  return (
    <QueueContext.Provider
      value={{
        stats,
        isOnline,
        isWifi,
        isWaitingForWifi,
        triggerSync,
        syncFolders,
        retryFailed,
        clearCompleted,
        refreshStats,
      }}
    >
      {children}
    </QueueContext.Provider>
  );
};

export const useQueue = () => useContext(QueueContext);
