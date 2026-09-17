import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQueue } from '../context/QueueContext';
import { Colors } from '../constants/colors';

interface LiveQueueBarProps {
  onPress?: () => void;
}

export const LiveQueueBar: React.FC<LiveQueueBarProps> = ({ onPress }) => {
  const { stats, isOnline, isWaitingForWifi } = useQueue();

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
            {
              backgroundColor: !isOnline
                ? Colors.error
                : isWaitingForWifi
                ? Colors.warning
                : Colors.success,
            },
          ]}
        />
        <Text style={styles.networkText}>
          {!isOnline ? 'Offline' : isWaitingForWifi ? 'Needs Wi-Fi' : 'Online'}
        </Text>
      </View>

      <View style={styles.divider} />

      <View style={styles.statsContainer}>
        {/* Pending */}
        <View style={styles.statItem}>
          <Ionicons name="time-outline" size={13} color={Colors.warning} />
          <Text style={styles.statLabel}>Pending:</Text>
          <Text style={[styles.statValue, { color: Colors.warning }]}>{stats.pending}</Text>
        </View>

        {/* Uploading */}
        <View style={styles.statItem}>
          <Ionicons name="cloud-upload-outline" size={13} color={Colors.primaryLight} />
          <Text style={styles.statLabel}>Syncing:</Text>
          <Text style={[styles.statValue, { color: Colors.primaryLight }]}>{stats.uploading}</Text>
        </View>

        {/* Done */}
        <View style={styles.statItem}>
          <Ionicons name="checkmark-circle-outline" size={13} color={Colors.success} />
          <Text style={styles.statLabel}>Done:</Text>
          <Text style={[styles.statValue, { color: Colors.success }]}>{stats.completed}</Text>
        </View>

        {/* Failed (if any) */}
        {stats.failed > 0 && (
          <View style={styles.statItem}>
            <Ionicons name="alert-circle" size={13} color={Colors.error} />
            <Text style={[styles.statValue, { color: Colors.error, fontWeight: '700' }]}>
              {stats.failed}
            </Text>
          </View>
        )}
      </View>

      <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 16, 56, 0.92)',
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
    borderWidth: 1,
    borderColor: Colors.border,
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
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '600',
  },
  divider: {
    width: 1,
    height: 14,
    backgroundColor: Colors.border,
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
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  statValue: {
    fontSize: 12,
    fontWeight: '700',
  },
});
