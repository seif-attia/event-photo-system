import React, { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';

export default function ExpoAuthSessionScreen() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/auth');
  }, [router]);

  return (
    <View style={{ flex: 1, backgroundColor: '#0A0F1D', justifyContent: 'center', alignItems: 'center' }}>
      <ActivityIndicator size='large' color='#3B82F6' />
    </View>
  );
}

