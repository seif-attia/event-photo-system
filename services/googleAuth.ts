import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';

WebBrowser.maybeCompleteAuthSession();

export interface GoogleUserProfile {
  id: string;
  name: string;
  email: string;
  picture?: string;
}

export interface AuthTokens {
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiry: number | null;
  isDemo: boolean;
}

const SECURE_KEYS = {
  ACCESS_TOKEN: 'google_access_token',
  REFRESH_TOKEN: 'google_refresh_token',
  TOKEN_EXPIRY: 'google_token_expiry',
  USER_PROFILE: 'google_user_profile',
  IS_DEMO: 'google_is_demo',
  WEB_CLIENT_ID: 'google_web_client_id',
  IOS_CLIENT_ID: 'google_ios_client_id',
  ANDROID_CLIENT_ID: 'google_android_client_id',
};

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'openid',
  'profile',
  'email',
];

export const GOOGLE_DISCOVERY: AuthSession.DiscoveryDocument = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  userInfoEndpoint: 'https://www.googleapis.com/oauth2/v3/userinfo',
};

export async function getStoredTokensAsync(): Promise<AuthTokens> {
  try {
    const [accessToken, refreshToken, expiryStr, isDemoStr] = await Promise.all([
      SecureStore.getItemAsync(SECURE_KEYS.ACCESS_TOKEN),
      SecureStore.getItemAsync(SECURE_KEYS.REFRESH_TOKEN),
      SecureStore.getItemAsync(SECURE_KEYS.TOKEN_EXPIRY),
      SecureStore.getItemAsync(SECURE_KEYS.IS_DEMO),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenExpiry: expiryStr ? parseInt(expiryStr, 10) : null,
      isDemo: isDemoStr === 'true',
    };
  } catch (error) {
    console.error('Error loading stored tokens:', error);
    return { accessToken: null, refreshToken: null, tokenExpiry: null, isDemo: false };
  }
}

export async function saveTokensAsync(tokens: {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  isDemo?: boolean;
}): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_KEYS.ACCESS_TOKEN, tokens.accessToken);

    if (tokens.refreshToken) {
      await SecureStore.setItemAsync(SECURE_KEYS.REFRESH_TOKEN, tokens.refreshToken);
    }

    if (tokens.expiresIn) {
      const expiry = Date.now() + tokens.expiresIn * 1000;
      await SecureStore.setItemAsync(SECURE_KEYS.TOKEN_EXPIRY, expiry.toString());
    }

    if (tokens.isDemo !== undefined) {
      await SecureStore.setItemAsync(SECURE_KEYS.IS_DEMO, tokens.isDemo ? 'true' : 'false');
    }
  } catch (error) {
    console.error('Error saving tokens:', error);
  }
}

export async function clearAuthSessionAsync(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(SECURE_KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(SECURE_KEYS.REFRESH_TOKEN),
      SecureStore.deleteItemAsync(SECURE_KEYS.TOKEN_EXPIRY),
      SecureStore.deleteItemAsync(SECURE_KEYS.USER_PROFILE),
      SecureStore.deleteItemAsync(SECURE_KEYS.IS_DEMO),
    ]);
  } catch (error) {
    console.error('Error clearing auth session:', error);
  }
}

export async function getStoredUserProfileAsync(): Promise<GoogleUserProfile | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_KEYS.USER_PROFILE);
    if (!raw) return null;
    return JSON.parse(raw) as GoogleUserProfile;
  } catch (error) {
    console.error('Error loading user profile:', error);
    return null;
  }
}

export async function saveUserProfileAsync(profile: GoogleUserProfile): Promise<void> {
  try {
    await SecureStore.setItemAsync(SECURE_KEYS.USER_PROFILE, JSON.stringify(profile));
  } catch (error) {
    console.error('Error saving user profile:', error);
  }
}

export async function fetchGoogleUserProfileAsync(accessToken: string): Promise<GoogleUserProfile | null> {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch user info: ${res.statusText}`);
    }
    const data = await res.json();
    return {
      id: data.sub,
      name: data.name || 'Event Staff',
      email: data.email || '',
      picture: data.picture,
    };
  } catch (error) {
    console.error('fetchGoogleUserProfileAsync error:', error);
    return null;
  }
}

export async function refreshAccessTokenAsync(clientId?: string): Promise<string | null> {
  try {
    const { refreshToken, isDemo } = await getStoredTokensAsync();

    if (isDemo) {
      const demoToken = `demo_token_${Date.now()}`;
      await saveTokensAsync({ accessToken: demoToken, expiresIn: 3600, isDemo: true });
      return demoToken;
    }

    if (!refreshToken) {
      console.warn('No refresh token available to refresh access token');
      return null;
    }

    const resolvedClientId = clientId || (await SecureStore.getItemAsync(SECURE_KEYS.WEB_CLIENT_ID)) || '';

    const params: Record<string, string> = {
      client_id: resolvedClientId,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    };

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      console.error('Token refresh failed:', res.status, errorBody);
      return null;
    }

    const data = await res.json();
    const newAccessToken = data.access_token;
    const expiresIn = data.expires_in || 3600;

    await saveTokensAsync({
      accessToken: newAccessToken,
      refreshToken: data.refresh_token || refreshToken,
      expiresIn,
      isDemo: false,
    });

    return newAccessToken;
  } catch (error) {
    console.error('refreshAccessTokenAsync exception:', error);
    return null;
  }
}

export async function signInWithDemoAccountAsync(): Promise<GoogleUserProfile> {
  const demoProfile: GoogleUserProfile = {
    id: 'demo_staff_001',
    name: 'Event Staff (Demo Mode)',
    email: 'photobooth.staff@event.demo',
    picture: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
  };

  await saveTokensAsync({
    accessToken: `demo_token_${Date.now()}`,
    refreshToken: 'demo_refresh_token',
    expiresIn: 7200,
    isDemo: true,
  });
  await saveUserProfileAsync(demoProfile);

  return demoProfile;
}
