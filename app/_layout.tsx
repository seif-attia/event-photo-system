import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { SettingsProvider } from '../context/SettingsContext';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { QueueProvider } from '../context/QueueContext';
import { ActivityIndicator, View, StyleSheet } from 'react-native';

WebBrowser.maybeCompleteAuthSession();

import { ThemeProvider, DarkTheme } from 'expo-router/react-navigation';
import { Colors } from '../constants/colors';

const appTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: Colors.background,
    card: Colors.card,
    text: Colors.textPrimary,
    border: Colors.border,
    primary: Colors.primary,
  },
};

function RootNavigation() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === 'auth';

    if (!isAuthenticated && !inAuthGroup) {
      // User is not signed in -> redirect to /auth
      router.replace('/auth');
    } else if (isAuthenticated && inAuthGroup) {
      // User is signed in but on /auth -> redirect to tabs
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={Colors.primaryLight} />
      </View>
    );
  }

  return (
    <ThemeProvider value={appTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
        }}
      >
      <Stack.Screen name="auth" options={{ headerShown: false, animation: 'fade' }} />
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="camera" options={{ headerShown: false, animation: 'none' }} />
      <Stack.Screen
        name="gallery"
        options={{
          headerShown: false,
          animation: 'none',
        }}
      />
      <Stack.Screen
        name="settings"
        options={{
          presentation: 'modal',
          headerShown: true,
          title: 'App Settings',
          headerStyle: { backgroundColor: Colors.card },
          headerTintColor: Colors.textPrimary,
        }}
      />
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <AuthProvider>
          <QueueProvider>
            <StatusBar style="light" />
            <RootNavigation />
          </QueueProvider>
        </AuthProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
