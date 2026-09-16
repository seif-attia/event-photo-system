import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueue } from '../context/QueueContext';

interface LiveQueueBarProps {
  onPress?: () => void;
}

export const LiveQueueBar: React.FC<LiveQueueBarProps> = ({ onPress }) => {
  const { stats, isOnline } = useQueue();

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={styles.container}
    >
      <View style={styles.networkBadge}>
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isOnline ? '#10B981' : '#EF4444' },
          ]}
        />
        <Text style={styles.networkText}>{isOnline ? 'Online' : 'Offline'}</Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.statsContainer}>
        {/* Pending */}
        <View style={styles.statItem}>
          <Ionicons name="time-outline" size={13} color="#F59E0B" />
          <Text style={styles.statLabel}>Pending:</Text>
          <Text style={[styles.statValue, { color: '#F59E0B' }]}>{stats.pending}</Text>
        </View>

        {/* Uploading */}
        <View style={styles.statItem}>
          <Ionicons name="cloud-upload-outline" size={13} color="#3B82F6" />
          <Text style={styles.statLabel}>Syncing:</Text>
          <Text style={[styles.statValue, { color: '#3B82F6' }]}>{stats.uploading}</Text>
        </View>

        {/* Done */}
        <View style={styles.statItem}>
          <Ionicons name="checkmark-circle-outline" size={13} color="#10B981" />
          <Text style={styles.statLabel}>Done:</Text>
          <Text style={[styles.statValue, { color: '#10B981' }]}>{stats.completed}</Text>
        </View>

        {/* Failed (if any) */}
        {stats.failed > 0 && (
          <View style={styles.statItem}>
            <Ionicons name="alert-circle" size={13} color="#EF4444" />
            <Text style={[styles.statValue, { color: '#EF4444', fontWeight: '700' }]}>
              {stats.failed}
            </Text>
          </View>
        )}
      </View>

      <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.6)" />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.15)',
  },
  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 5,
  },
  networkText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    marginRight: 10,
  },
  statsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginRight: 6,
  },
  statItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  statLabel: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 12,
    fontWeight: '700',
  },
});
