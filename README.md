# Event Photo Booth System (Offline-First Expo Mobile App)

A robust, offline-first mobile application built with **React Native**, **Expo SDK 57**, **TypeScript**, and **Expo Router** designed for event photo booths. It seamlessly captures high-resolution attendee photos and syncs them to Google Drive with automated folder categorization per attendee.

---

## Key Features

1. **Auth Gate Screen (`app/auth.tsx`)**
   - OAuth 2.0 authentication with Google via `expo-auth-session`.
   - Requesting `https://www.googleapis.com/auth/drive.file` scope.
   - Encrypted token persistence (access token, refresh token, expiry) via `expo-secure-store`.
   - Automatic token refresh on HTTP 401 responses.
   - Live queue status indicator and staff profile card.
   - **Sandbox / Demo Mode**: Full offline simulation mode for immediate evaluation without pre-configuring Google Cloud Console.

2. **Instantaneous Shutter & Capture Screen (`app/(tabs)/index.tsx`)**
   - Full-screen camera interface powered by `expo-camera` (`CameraView`).
   - Non-blocking capture: immediate white screen flash, counter increment, and camera readiness without delay.
   - **Attendee ID & Locking**:
     - Input field for attendee / ticket badge ID.
     - "Lock Session / Set Active ID" toggle to photograph multiple shots for the same attendee without re-typing.
     - "Skip ID / General Shot" toggle automatically defaulting to `"no_id"`.
   - Local on-disk persistence via `expo-file-system` (`${documentDirectory}photos/${attendeeId}_${timestamp}.jpg`).
   - SQLite queue insertion (`status = 'pending'`).
   - Floating **Live Queue Bar** with live counts (`Pending | Syncing | Done | Failed`) and network state (`Online / Offline`).

3. **Queue & Sync Screen (`app/(tabs)/queue.tsx`)**
   - Photos grouped by Attendee ID (including `"no_id"`).
   - Real-time status badges: `pending`, `uploading`, `completed`, `failed`.
   - Local image thumbnail previews, timestamps, and error diagnostics.
   - "Sync Now", "Retry Failed", and "Clear Done" actions.
   - Pull-to-refresh.

4. **Folder Resolution & Caching (`services/driveApi.ts`)**
   - Configurable `PARENT_DRIVE_FOLDER_ID` (defaults to `'root'`).
   - 4-step folder resolution algorithm:
     1. In-memory cache lookup (`parentFolderId::attendeeId`).
     2. SQLite database table `folder_cache` lookup.
     3. Google Drive API query for existing folder under parent.
     4. If not found, creates folder via `POST https://www.googleapis.com/drive/v3/files` and caches the folder ID.

5. **Background Sync Engine (`services/queueManager.ts`)**
   - Network connectivity monitoring via `@react-native-community/netinfo`.
   - Automatically pauses queue when offline; resumes when connectivity is restored.
   - Concurrency control (default 2 workers) to preserve mobile hotspot bandwidth.
   - Resumable/Binary photo uploads to Google Drive with parent folder linking.

6. **Settings & Configuration Modal (`app/settings.tsx`)**
   - Configurable `PARENT_DRIVE_FOLDER_ID` with built-in "Test Connection" tool.
   - Google Cloud OAuth Web, iOS, and Android Client ID inputs.
   - Upload concurrency switch (1 sequential vs. 2 parallel).
   - Database and folder cache cleanup tools.

---

## Project Structure

```
├── app/
│   ├── _layout.tsx           # Root provider wrapper & auth redirection
│   ├── auth.tsx              # Auth Gate screen (Google Sign In & Demo Mode)
│   ├── settings.tsx          # Settings & Drive configuration modal
│   └── (tabs)/
│       ├── _layout.tsx       # Bottom tab layout with badge counts
│       ├── index.tsx         # Main Camera capture & ID locking screen
│       └── queue.tsx         # Upload queue grouped by attendee
├── components/
│   └── LiveQueueBar.tsx      # Floating status badge (Pending/Syncing/Done)
├── context/
│   ├── AuthContext.tsx       # OAuth tokens, profile, and demo state
│   ├── QueueContext.tsx      # Live queue statistics and action triggers
│   └── SettingsContext.tsx   # Parent folder, concurrency, and client IDs
├── database/
│   ├── schema.ts             # TypeScript types for queue & cache
│   └── sqlite.ts             # expo-sqlite initialization & CRUD queries
├── services/
│   ├── driveApi.ts           # Google Drive folder resolution & photo upload
│   ├── googleAuth.ts         # OAuth 2.0 flow, token refresh, SecureStore
│   └── queueManager.ts       # Background sync engine & NetInfo listener
├── app.json                  # Expo config with scheme & camera plugin
├── package.json              # Expo SDK 57 dependencies
└── tsconfig.json             # TypeScript configuration with strict types
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Development Server
```bash
npx expo start
```

Press `a` for Android Emulator, `i` for iOS Simulator, or scan the QR code using the Expo Go mobile app.

---

## Testing & Demo Mode

If you don't have Google Cloud Console credentials ready:
1. Launch the app.
2. On the **Auth Gate** screen, tap **"Launch Demo Mode (Offline / Sandbox)"**.
3. You will immediately enter the Camera screen with a simulated staff profile.
4. Capture photos with or without an Attendee ID locked.
5. Watch the **Live Queue Bar** and switch to the **Queue & Sync** tab to see photos transition from `Pending` -> `Syncing` -> `Completed`!
