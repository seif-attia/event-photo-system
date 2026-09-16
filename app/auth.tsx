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
  const [showClientIdModal, setShowClientIdModal] = useState<boolean>(false);
  const [customClientId, setCustomClientId] = useState<string>(settings.webClientId || "");

  React.useEffect(() => {
    getPrecreatedFoldersCountAsync()
      .then(setFolderCount)
      .catch((e) => console.warn("Failed to load folder count:", e));
  }, []);

  const handleGoogleSignIn = async (overrideClientId?: string) => {
    setIsSigningIn(true);
    setErrorMessage(null);
    try {
      const result = await signInWithGoogle(overrideClientId);
      if (!result.success) {
        if (result.error === "MISSING_CLIENT_ID") {
          setShowClientIdModal(true);
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

  const handleCustomClientIdSubmit = async () => {
    if (!customClientId.trim()) {
      Alert.alert("Missing Client ID", "Please enter your Google OAuth Client ID.");
      return;
    }
    setShowClientIdModal(false);
    await handleGoogleSignIn(customClientId.trim());
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
        ]
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
        ]
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
            <Ionicons name="camera" size={44} color="#3B82F6" />
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
                  <Ionicons name="person" size={28} color="#94A3B8" />
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
              <Ionicons name="folder-open-outline" size={18} color="#60A5FA" />
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
                <Ionicons name="swap-horizontal" size={14} color="#60A5FA" />
                <Text style={styles.changeFolderBtnText}>Change</Text>
              </TouchableOpacity>
            </View>

            {/* Pre-Created Attendee Folders Row */}
            <View style={styles.infoRow}>
              <Ionicons name="people-outline" size={18} color="#10B981" />
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
                  <ActivityIndicator size="small" color="#60A5FA" />
                ) : (
                  <Ionicons name="sync-outline" size={16} color="#60A5FA" />
                )}
              </TouchableOpacity>
            </View>

            {/* Live Queue Summary Box */}
            <View style={styles.queueBox}>
              <Text style={styles.queueBoxTitle}>Current Queue Status</Text>
              <View style={styles.queueStatsRow}>
                <View style={styles.queueStat}>
                  <Text style={[styles.statNumber, { color: "#F59E0B" }]}>
                    {stats.pending}
                  </Text>
                  <Text style={styles.statDescription}>Pending</Text>
                </View>
                <View style={styles.queueStat}>
                  <Text style={[styles.statNumber, { color: "#3B82F6" }]}>
                    {stats.uploading}
                  </Text>
                  <Text style={styles.statDescription}>Syncing</Text>
                </View>
                <View style={styles.queueStat}>
                  <Text style={[styles.statNumber, { color: "#10B981" }]}>
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
                color="#FFFFFF"
              />
              <Text style={styles.primaryButtonText}>Enter Photo Booth</Text>
            </TouchableOpacity>

            {/* Secondary Action: Sign Out */}
            <TouchableOpacity
              style={styles.signOutButton}
              onPress={handleSignOut}
            >
              <Ionicons name="log-out-outline" size={18} color="#EF4444" />
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

            {/* Permissions summary */}
            <View style={styles.scopeNotice}>
              <Ionicons
                name="shield-checkmark-outline"
                size={20}
                color="#10B981"
              />
              <Text style={styles.scopeNoticeText}>
                Requested scope:{" "}
                <Text style={{ fontWeight: "700" }}>Google Drive File</Text>{" "}
                (allows creating folders and storing photos captured in this
                session).
              </Text>
            </View>

            {errorMessage && (
              <View style={styles.errorBox}>
                <Ionicons name="warning-outline" size={18} color="#EF4444" />
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
                <ActivityIndicator color="#0F172A" />
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
                  <Ionicons name="flask-outline" size={20} color="#60A5FA" />
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

      {/* Google OAuth Web Client ID Connect Modal */}
      <Modal
        visible={showClientIdModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowClientIdModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Ionicons name="logo-google" size={24} color="#EA4335" />
              <Text style={styles.modalTitle}>Connect Google Account</Text>
            </View>
            <Text style={styles.modalSubtitle}>
              To connect directly to your personal Google Drive, enter your Google OAuth Client ID once below:
            </Text>
            <TextInput
              style={styles.modalInput}
              placeholder="XXXXX.apps.googleusercontent.com"
              placeholderTextColor="#64748B"
              value={customClientId}
              onChangeText={setCustomClientId}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TouchableOpacity
              style={styles.modalPrimaryBtn}
              onPress={handleCustomClientIdSubmit}
              disabled={isSigningIn}
            >
              {isSigningIn ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.modalPrimaryBtnText}>Connect & Sign In</Text>
              )}
            </TouchableOpacity>

            <View style={styles.orDivider}>
              <View style={styles.line} />
              <Text style={styles.orText}>OR</Text>
              <View style={styles.line} />
            </View>

            <TouchableOpacity
              style={styles.modalSecondaryBtn}
              onPress={() => {
                setShowClientIdModal(false);
                handleDemoSignIn();
              }}
            >
              <Ionicons name="flask-outline" size={16} color="#60A5FA" />
              <Text style={styles.modalSecondaryBtnText}>Use Instant Sandbox Mode Instead</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.modalCancelBtn}
              onPress={() => setShowClientIdModal(false)}
            >
              <Text style={styles.modalCancelBtnText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0A0F1D",
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
    backgroundColor: "#1E293B",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  onlineText: {
    color: "#94A3B8",
    fontSize: 12,
    fontWeight: "600",
  },
  settingsIconButton: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: "#1E293B",
  },
  heroSection: {
    alignItems: "center",
    marginVertical: 20,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#1E293B",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 16,
    borderWidth: 2,
    borderColor: "#3B82F6",
  },
  appTitle: {
    fontSize: 28,
    fontWeight: "800",
    color: "#F8FAFC",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#94A3B8",
    textAlign: "center",
    marginTop: 6,
  },
  signInCard: {
    backgroundColor: "#131D31",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1E293B",
  },
  cardHeading: {
    fontSize: 18,
    fontWeight: "700",
    color: "#F8FAFC",
    marginBottom: 8,
  },
  cardSubtext: {
    fontSize: 13,
    color: "#94A3B8",
    lineHeight: 18,
    marginBottom: 16,
  },
  scopeNotice: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "rgba(16, 185, 129, 0.1)",
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "rgba(16, 185, 129, 0.25)",
  },
  scopeNoticeText: {
    fontSize: 12,
    color: "#A7F3D0",
    marginLeft: 10,
    flex: 1,
    lineHeight: 16,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(239, 68, 68, 0.15)",
    padding: 12,
    borderRadius: 10,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "rgba(239, 68, 68, 0.3)",
  },
  errorText: {
    color: "#FCA5A5",
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
    color: "#0F172A",
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
    backgroundColor: "#2A374F",
  },
  orText: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    marginHorizontal: 10,
  },
  demoButton: {
    backgroundColor: "#1E293B",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#3B82F6",
    gap: 10,
  },
  demoButtonText: {
    color: "#60A5FA",
    fontSize: 14,
    fontWeight: "600",
  },
  demoCaption: {
    fontSize: 11,
    color: "#64748B",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 15,
  },
  profileCard: {
    backgroundColor: "#131D31",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: "#1E293B",
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
    backgroundColor: "#1E293B",
    justifyContent: "center",
    alignItems: "center",
  },
  profileText: {
    marginLeft: 14,
    flex: 1,
  },
  userName: {
    color: "#F8FAFC",
    fontSize: 17,
    fontWeight: "700",
  },
  userEmail: {
    color: "#94A3B8",
    fontSize: 13,
    marginTop: 2,
  },
  demoBadge: {
    backgroundColor: "#1E3A8A",
    alignSelf: "flex-start",
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginTop: 6,
  },
  demoBadgeText: {
    color: "#93C5FD",
    fontSize: 10,
    fontWeight: "800",
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0F172A",
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
  },
  infoLabel: {
    fontSize: 11,
    color: "#64748B",
    textTransform: "uppercase",
    fontWeight: "600",
  },
  infoValue: {
    fontSize: 13,
    color: "#CBD5E1",
    fontWeight: "500",
    marginTop: 2,
  },
  queueBox: {
    backgroundColor: "#0F172A",
    borderRadius: 12,
    padding: 14,
    marginBottom: 20,
  },
  queueBoxTitle: {
    fontSize: 12,
    color: "#94A3B8",
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
    color: "#64748B",
    marginTop: 2,
  },
  primaryButton: {
    backgroundColor: "#2563EB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderRadius: 14,
    gap: 8,
    marginBottom: 12,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: "rgba(239, 68, 68, 0.1)",
    gap: 6,
  },
  signOutText: {
    color: "#EF4444",
    fontSize: 13,
    fontWeight: "600",
  },
  quickSyncBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: "rgba(59, 130, 246, 0.1)",
  },
  changeFolderBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(59, 130, 246, 0.15)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    gap: 4,
  },
  changeFolderBtnText: {
    color: "#60A5FA",
    fontSize: 12,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(10, 15, 29, 0.8)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    backgroundColor: "#131D31",
    borderRadius: 18,
    padding: 22,
    width: "100%",
    maxWidth: 420,
    borderWidth: 1,
    borderColor: "#1E293B",
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
    color: "#F8FAFC",
  },
  modalSubtitle: {
    fontSize: 13,
    color: "#94A3B8",
    lineHeight: 18,
    marginBottom: 16,
  },
  modalInput: {
    backgroundColor: "#0F172A",
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 48,
    color: "#FFFFFF",
    fontSize: 14,
    borderWidth: 1,
    borderColor: "#334155",
    marginBottom: 14,
  },
  modalPrimaryBtn: {
    backgroundColor: "#2563EB",
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalPrimaryBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  modalSecondaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(96, 165, 250, 0.1)",
    borderRadius: 10,
    paddingVertical: 12,
    gap: 8,
  },
  modalSecondaryBtnText: {
    color: "#60A5FA",
    fontSize: 13,
    fontWeight: "600",
  },
  modalCancelBtn: {
    alignItems: "center",
    paddingVertical: 10,
    marginTop: 6,
  },
  modalCancelBtnText: {
    color: "#94A3B8",
    fontSize: 13,
  },
});
