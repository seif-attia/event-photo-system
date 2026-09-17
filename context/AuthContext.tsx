import React, { createContext, useContext, useState, useEffect } from 'react';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  GoogleUserProfile,
  AuthTokens,
  getStoredTokensAsync,
  getStoredUserProfileAsync,
  saveTokensAsync,
  saveUserProfileAsync,
  clearAuthSessionAsync,
  fetchGoogleUserProfileAsync,
  signInWithDemoAccountAsync,
  GOOGLE_DRIVE_SCOPES,
  GOOGLE_DISCOVERY,
} from '../services/googleAuth';
import { queueManager } from '../services/queueManager';
import { useSettings } from './SettingsContext';

interface AuthContextType {
  user: GoogleUserProfile | null;
  tokens: AuthTokens | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  isDemo: boolean;
  signInWithGoogle: (customClientId?: string) => Promise<{ success: boolean; error?: string }>;
  signInWithDemo: () => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  tokens: null,
  isAuthenticated: false,
  isLoading: true,
  isDemo: false,
  signInWithGoogle: async () => ({ success: false }),
  signInWithDemo: async () => {},
  signOut: async () => {},
  refreshProfile: async () => {},
});

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<GoogleUserProfile | null>(null);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { settings, updateSetting } = useSettings();

  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = async () => {
    try {
      const [storedTokens, storedUser] = await Promise.all([
        getStoredTokensAsync(),
        getStoredUserProfileAsync(),
      ]);

      // If in production build, completely discard any demo mode tokens
      if (!__DEV__ && storedTokens.isDemo) {
        await clearAuthSessionAsync();
        setTokens({ accessToken: null, refreshToken: null, tokenExpiry: null, isDemo: false });
        setUser(null);
        return;
      }

      // Do NOT automatically log into dev mode on launch!
      // Require the user to explicitly choose to enter Dev Mode.
      if (storedTokens.isDemo) {
        await clearAuthSessionAsync();
        setTokens({ accessToken: null, refreshToken: null, tokenExpiry: null, isDemo: false });
        setUser(null);
        return;
      }

      setTokens(storedTokens);
      if (storedTokens.accessToken) {
        setUser(storedUser);
        queueManager.setAuthContext(storedTokens.accessToken, storedTokens.isDemo);
      }
    } catch (e) {
      console.error('Failed to restore auth session:', e);
    } finally {
      setIsLoading(false);
    }
  };

  const getClientId = (override?: string): string => {
    if (override && override.trim()) return override.trim();
    if (Platform.OS === 'android' && process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID) {
      return process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID.trim();
    }
    if (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID) return process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID.trim();
    if (Constants.expoConfig?.extra?.googleClientId) return (Constants.expoConfig.extra.googleClientId as string).trim();
    if (Platform.OS === 'ios' && settings.iosClientId) return settings.iosClientId.trim();
    if (Platform.OS === 'android' && settings.androidClientId) return settings.androidClientId.trim();
    if (settings.webClientId) return settings.webClientId.trim();
    return '';
  };

  const signInWithGoogle = async (customClientId?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const clientId = getClientId(customClientId);
      if (!clientId || clientId === 'YOUR_GOOGLE_CLIENT_ID') {
        return {
          success: false,
          error: 'MISSING_CLIENT_ID',
        };
      }

      if (customClientId) {
        await updateSetting('webClientId', customClientId);
      }

      // For Google OAuth with a Web Client ID, Google strictly requires an HTTPS redirect URI.
      // The Expo Auth Proxy provides the authorized HTTPS endpoint and forwards the auth token
      // back to the app scheme (eventphotosystem://) on the device.
      const hasCustomRedirect = Boolean(process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI);
      const redirectUri = hasCustomRedirect
        ? process.env.EXPO_PUBLIC_GOOGLE_REDIRECT_URI!.trim()
        : 'https://auth.expo.io/@anonymous/EventPhotoSystem';

      console.log('[Auth] Google OAuth Redirect URI:', redirectUri);

      const request = new AuthSession.AuthRequest({
        clientId,
        scopes: GOOGLE_DRIVE_SCOPES,
        redirectUri,
        responseType: AuthSession.ResponseType.Token,
        usePKCE: false,
      });

      let result: any;

      if (!hasCustomRedirect) {
        const googleAuthUrl = await request.makeAuthUrlAsync(GOOGLE_DISCOVERY);
        const returnUrl = AuthSession.getDefaultReturnUrl(undefined, { scheme: 'eventphotosystem' });
        const startUrl = `https://auth.expo.io/@anonymous/EventPhotoSystem/start?authUrl=${encodeURIComponent(
          googleAuthUrl
        )}&returnUrl=${encodeURIComponent(returnUrl)}`;

        console.log('[Auth] Opening proxy start URL:', startUrl);
        console.log('[Auth] Device return URL:', returnUrl);

        const browserResult = await WebBrowser.openAuthSessionAsync(startUrl, returnUrl);
        if (browserResult.type === 'success' && (browserResult as any).url) {
          result = request.parseReturnUrl((browserResult as any).url);
        } else {
          result = { type: browserResult.type };
        }
      } else {
        result = await request.promptAsync(GOOGLE_DISCOVERY);
      }

      if (result.type === 'success') {
        const accessToken = result.params.access_token;
        const expiresIn = result.params.expires_in ? parseInt(result.params.expires_in, 10) : 3600;

        await saveTokensAsync({
          accessToken,
          expiresIn,
          isDemo: false,
        });

        // Fetch user profile from Google
        const profile = await fetchGoogleUserProfileAsync(accessToken);
        const userProfile: GoogleUserProfile = profile || {
          id: 'user_' + Date.now(),
          name: 'Event Staff',
          email: 'staff@event.com',
        };

        await saveUserProfileAsync(userProfile);
        setUser(userProfile);
        setTokens({
          accessToken,
          refreshToken: null,
          tokenExpiry: Date.now() + expiresIn * 1000,
          isDemo: false,
        });

        queueManager.setAuthContext(accessToken, false);
        return { success: true };
      } else if (result.type === 'cancel' || result.type === 'dismiss') {
        return { success: false, error: 'Sign in was cancelled.' };
      } else {
        return { success: false, error: 'Sign in failed. Please try again.' };
      }
    } catch (err: any) {
      console.error('Google sign-in error:', err);
      return { success: false, error: err.message || 'An unexpected error occurred during sign in.' };
    }
  };

  const signInWithDemo = async (): Promise<void> => {
    const demoProfile = await signInWithDemoAccountAsync();
    const storedTokens = await getStoredTokensAsync();
    setUser(demoProfile);
    setTokens(storedTokens);
    queueManager.setAuthContext(storedTokens.accessToken, true);
  };

  const signOut = async () => {
    await clearAuthSessionAsync();
    setUser(null);
    setTokens(null);
    queueManager.setAuthContext(null, false);
  };

  const refreshProfile = async () => {
    if (tokens?.accessToken && !tokens.isDemo) {
      const profile = await fetchGoogleUserProfileAsync(tokens.accessToken);
      if (profile) {
        setUser(profile);
        await saveUserProfileAsync(profile);
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        tokens,
        isAuthenticated: Boolean(tokens?.accessToken),
        isLoading,
        isDemo: Boolean(tokens?.isDemo),
        signInWithGoogle,
        signInWithDemo,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
