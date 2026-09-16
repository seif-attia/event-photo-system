import React, { useState } from "react";
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  ScrollView,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { useQueue } from "../context/QueueContext";
import { useSettings } from "../context/SettingsContext";
import { getPrecreatedFoldersCountAsync } from "../database/sqlite";
import { DriveFolderPickerModal } from "../components/DriveFolderPickerModal";
import { DriveFolderItem } from "../services/driveApi";
import { Colors } from "../constants/colors";

export default function AuthScreen() {
  const router = useRouter();
  const {
    user,
    isAuthenticated,
    isDemo,
    signInWithGoogle,
    signInWithDemo,
    signOut,
  } = useAuth();
  const { stats, isOnline, syncFolders } = useQueue();
  const { settings, updateSetting, updateSettings } = useSettings();
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [folderCount, setFolderCount] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [showFolderPicker, setShowFolderPicker] = useState<boolean>(false);

  React.useEffect(() => {
    getPrecreatedFoldersCountAsync()
      .then(setFolderCount)
      .catch((e) => console.warn("Failed to load folder count:", e));
  }, []);

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    setErrorMessage(null);
    try {
      const result = await signInWithGoogle();
      if (!result.success) {
        if (result.error === "MISSING_CLIENT_ID") {
          Alert.alert(
            "Google Sign-In Configuration",
            "To connect to your personal Google Drive, a Google OAuth Web Client ID needs to be set in the project's .env file (EXPO_PUBLIC_GOOGLE_CLIENT_ID).\n\nWould you like to launch Sandbox / Dev Mode to test the camera booth now?",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Launch Sandbox Mode", onPress: handleDemoSignIn },
            ],
          );
        } else if (result.error) {
          setErrorMessage(result.error);
        }
      } else {
        // Authenticated! Prompt to choose Google Drive event folder
        setShowFolderPicker(true);
      }
    } catch (e: any) {
      setErrorMessage(e.message || "Failed to sign in");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleDemoSignIn = async () => {
    Alert.alert(
      "Enter Dev / Sandbox Mode?",
      "Dev Mode simulates Google Drive authentication and uploads for testing without requiring Google Cloud credentials.\n\nDo you want to enter Dev Mode?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Enter Dev Mode",
          onPress: async () => {
            setIsSigningIn(true);
            setErrorMessage(null);
            try {
              await signInWithDemo();
              // Immediately prompt to pick Drive folder
              setShowFolderPicker(true);
            } catch (e: any) {
              setErrorMessage(e.message || "Failed to enter Dev Mode");
            } finally {
              setIsSigningIn(false);
            }
          },
        },
      ],
    );
  };

  const handleSelectFolder = async (folder: DriveFolderItem) => {
    await updateSettings({
      parentFolderId: folder.id,
      parentFolderName: folder.name,
    });

    try {
      const count = await syncFolders();
      setFolderCount(count);
      Alert.alert(
        "Drive Folder Ready",
        `Selected "${folder.name}".\nCached ${count} attendee folders.\n\nOpening Photo Booth!`,
        [
          {
            text: "Open Booth",
            onPress: () => router.replace("/(tabs)"),
          },
        ],
      );
    } catch (e: any) {
      Alert.alert(
        "Drive Folder Ready",
        `Selected "${folder.name}".\n\nOpening Photo Booth!`,
        [
          {
            text: "Open Booth",
            onPress: () => router.replace("/(tabs)"),
          },
        ],
      );
    }
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign Out", style: "destructive", onPress: () => signOut() },
    ]);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent} bounces={false}>
        {/* Top Header Controls */}
        <View style={styles.topBar}>
          <View style={styles.onlineBadge}>
            <View
              style={[
                styles.dot,
                { backgroundColor: isOnline ? "#10B981" : "#EF4444" },
              ]}
            />
            <Text style={styles.onlineText}>
              {isOnline ? "System Online" : "System Offline"}
            </Text>
          </View>
        </View>

        {/* Hero Branding */}
        <View style={styles.heroSection}>
          <View style={styles.iconCircle}>
            <Ionicons name="camera" size={44} color={Colors.primaryLight} />
          </View>
          <Text style={styles.appTitle}>Event Photo Booth</Text>
          <Text style={styles.subtitle}>
            Offline-First Cloud Sync to Google Drive
          </Text>
        </View>

        {/* Auth Gate State */}
        {isAuthenticated && user ? (
          <View style={styles.profileCard}>
            <View style={styles.profileHeader}>
              {user.picture ? (
                <Image source={{ uri: user.picture }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarPlaceholder]}>
                  <Ionicons name="person" size={28} color={Colors.textMuted} />
                </View>
              )}
              <View style={styles.profileText}>
                <Text style={styles.userName}>{user.name}</Text>
                <Text style={styles.userEmail}>{user.email}</Text>
                {__DEV__ && isDemo && (
                  <View style={styles.demoBadge}>
                    <Text style={styles.demoBadgeText}>DEMO MODE ACTIVE</Text>
                  </View>
                )}
              </View>
            </View>

            {/* Folder Destination Info */}
            <View style={styles.infoRow}>
              <Ionicons name="folder-open-outline" size={18} color={Colors.primaryLight} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.infoLabel}>Drive Destination Folder</Text>
                <Text style={styles.infoValue} numberOfLines={1}>
                  {settings.parentFolderName ||
                    (settings.parentFolderId === "root"
                      ? "Root Google Drive"
                      : settings.parentFolderId)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.changeFolderBtn}
                onPress={() => setShowFolderPicker(true)}
              >
                <Ionicons name="swap-horizontal" size={14} color={Colors.primaryLight} />
                <Text style={styles.changeFolderBtnText}>Change</Text>
              </TouchableOpacity>
            </View>

            {/* Pre-Created Attendee Folders Row */}
            <View style={styles.infoRow}>
              <Ionicons name="people-outline" size={18} color={Colors.success} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={styles.infoLabel}>
                  Pre-Created Folders (Offline Cache)
                </Text>
                <Text style={styles.infoValue}>
                  {folderCount} Attendee Folder(s) Synced (e.g. Rawda -
                  KOT-89487)
                </Text>
              </View>
              <TouchableOpacity
                style={styles.quickSyncBtn}
                onPress={async () => {
                  setIsSyncing(true);
                  try {
                    const c = await syncFolders();
                    setFolderCount(c);
                  } finally {
                    setIsSyncing(false);
                  }
                }}
                disabled={isSyncing}
              >
                {isSyncing ? (
                  <ActivityIndicator size="small" color={Colors.primaryLight} />
                ) : (
                  <Ionicons name="sync-outline" size={16} color={Colors.primaryLight} />
                )}
              </TouchableOpacity>
            </View>

            {/* Live Queue Summary Box */}
            <View style={styles.queueBox}>
              <Text style={styles.queueBoxTitle}>Current Queue Status</Text>
              <View style={styles.queueStatsRow}>
                <View style={styles.queueStat}>
                  <Text style={[styles.statNumber, { color: Colors.warning }]}>
                    {stats.pending}
                  </Text>
                  <Text style={styles.statDescription}>Pending</Text>
                </View>
                <View style={styles.queueStat}>
                  <Text style={[styles.statNumber, { color: Colors.primaryLight }]}>
                    {stats.uploading}
                  </Text>
                  <Text style={styles.statDescription}>Syncing</Text>
                </View>
                <View style={styles.queueStat}>
                  <Text style={[styles.statNumber, { color: Colors.success }]}>
                    {stats.completed}
                  </Text>
                  <Text style={styles.statDescription}>Uploaded</Text>
                </View>
              </View>
            </View>

            {/* Primary Action: Enter Booth */}
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => router.replace("/(tabs)")}
            >
              <Ionicons
                name="camera-reverse-outline"
                size={22}
                color={Colors.textPrimary}
              />
              <Text style={styles.primaryButtonText}>Enter Photo Booth</Text>
            </TouchableOpacity>

            {/* Secondary Action: Sign Out */}
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={handleSignOut}
            >
              <Ionicons name="log-out-outline" size={18} color={Colors.error} />
              <Text style={styles.signOutText}>Sign Out Staff Account</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.signInCard}>
            <Text style={styles.cardHeading}>Staff Authentication</Text>
            <Text style={styles.cardSubtext}>
              Sign in with your Google account to grant permission for uploading
              event photos directly to the configured Google Drive folders.
            </Text>

            {errorMessage && (
              <View style={styles.errorBox}>
                <Ionicons name="warning-outline" size={18} color={Colors.error} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            )}

            {/* Google Sign In Button */}
            <TouchableOpacity
              style={styles.googleButton}
              onPress={() => handleGoogleSignIn()}
              disabled={isSigningIn}
            >
              {isSigningIn ? (
                <ActivityIndicator color={Colors.background} />
              ) : (
                <>
                  <Ionicons name="logo-google" size={20} color="#EA4335" />
                  <Text style={styles.googleButtonText}>
                    Sign In with Google
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {__DEV__ && (
              <>
                <View style={styles.orDivider}>
                  <View style={styles.line} />
                  <Text style={styles.orText}>DEVELOPMENT & TESTING</Text>
                  <View style={styles.line} />
                </View>

                {/* Demo Mode Button - Stripped in Production Builds */}
                <TouchableOpacity
                  style={styles.demoButton}
                  onPress={handleDemoSignIn}
                  disabled={isSigningIn}
                >
                  <Ionicons name="flask-outline" size={20} color={Colors.primaryLight} />
                  <Text style={styles.demoButtonText}>
                    Launch Demo Mode (Offline / Sandbox)
                  </Text>
                </TouchableOpacity>

                <Text style={styles.demoCaption}>
                  Demo mode simulates Google Drive folder creation and uploads
                  without requiring a Google Cloud OAuth Client ID. (Hidden in
                  production builds)
                </Text>
              </>
            )}
          </View>
        )}
      </ScrollView>

      {/* Google Drive Visual Folder Picker Modal */}
      <DriveFolderPickerModal
        visible={showFolderPicker}
        onClose={() => setShowFolderPicker(false)}
        onSelectFolder={handleSelectFolder}
        currentFolderId={settings.parentFolderId}
        currentFolderName={settings.parentFolderName}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 24,
    flexGrow: 1,
    justifyContent: "space-between",
  },
  topBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  onlineBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.cardElevated,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  onlineText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
  },
  settingsIconButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: Colors.cardElevated,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroSection: {
    alignItems: "center",
    marginVertical: 20,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.cardElevated,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 2,
    borderColor: Colors.primaryLight,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: Colors.textPrimary,
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    marginTop: 6,
  },
  signInCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cardHeading: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  cardSubtext: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 16,
  },
  scopeNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: Colors.successBg,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.3)",
  },
  scopeNoticeText: {
    fontSize: 12,
    color: Colors.success,
    marginLeft: 10,
    flex: 1,
    lineHeight: 16,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.errorBg,
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(244, 63, 94, 0.3)",
  },
  errorText: {
    color: Colors.error,
    fontSize: 12,
    marginLeft: 8,
    flex: 1,
  },
  googleButton: {
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    gap: 10,
  },
  googleButtonText: {
    color: Colors.background,
    fontSize: 15,
    fontWeight: "700",
  },
  orDivider: {
    flexDirection: "row",
    alignItems: "center",
    marginVertical: 18,
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.border,
  },
  orText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: "600",
    marginHorizontal: 10,
  },
  demoButton: {
    backgroundColor: Colors.cardElevated,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    gap: 10,
  },
  demoButtonText: {
    color: Colors.primaryLight,
    fontSize: 14,
    fontWeight: "600",
  },
  demoCaption: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
    marginTop: 10,
    lineHeight: 15,
  },
  profileCard: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  profileHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    backgroundColor: Colors.cardElevated,
    justifyContent: "center",
    alignItems: "center",
  },
  profileText: {
    marginLeft: 14,
    flex: 1,
  },
  userName: {
    color: Colors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
  },
  userEmail: {
    color: Colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  demoBadge: {
    backgroundColor: Colors.primaryGlow,
    alignSelf: "flex-start",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginTop: 6,
  },
  demoBadgeText: {
    color: Colors.primaryLight,
    fontSize: 10,
    fontWeight: "800",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.cardElevated,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  infoValue: {
    fontSize: 13,
    color: Colors.textPrimary,
    fontWeight: "500",
    marginTop: 2,
  },
  queueBox: {
    backgroundColor: Colors.cardElevated,
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  queueBoxTitle: {
    fontSize: 12,
    color: Colors.textSecondary,
    fontWeight: "600",
    marginBottom: 10,
  },
  queueStatsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
  },
  queueStat: {
    alignItems: "center",
  },
  statNumber: {
    fontSize: 20,
    fontWeight: "800",
  },
  statDescription: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  primaryButton: {
    backgroundColor: Colors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    marginBottom: 12,
  },
  primaryButtonText: {
    color: Colors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: Colors.errorBg,
    gap: 6,
  },
  signOutText: {
    color: Colors.error,
    fontSize: 13,
    fontWeight: "600",
  },
  quickSyncBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: Colors.primaryGlow,
  },
  changeFolderBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.primaryGlow,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  changeFolderBtnText: {
    color: Colors.primaryLight,
    fontSize: 12,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(11, 6, 22, 0.85)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 22,
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: Colors.textPrimary,
  },
  modalSubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 18,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: Colors.cardElevated,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 48,
    color: Colors.textPrimary,
    fontSize: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    marginBottom: 14,
  },
  modalPrimaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalPrimaryBtnText: {
    color: Colors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  modalSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primaryGlow,
    borderRadius: 10,
    paddingVertical: 12,
    gap: 8,
  },
  modalSecondaryBtnText: {
    color: Colors.primaryLight,
    fontSize: 13,
    fontWeight: "600",
  },
  modalCancelBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 6,
  },
  modalCancelBtnText: {
    color: Colors.textMuted,
    fontSize: 13,
  },
});
