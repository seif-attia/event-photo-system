# Event Photo Booth System (Offline-First Expo Mobile App)

A robust, offline-first mobile application built with **React Native**, **Expo**, **TypeScript**, and **Expo Router** designed for high-throughput event photo booths. It seamlessly captures high-resolution attendee photos, matches them to pre-created attendee folders, saves a fail-safe backup directly to the device's native camera roll (`DCIM/Camera`), and syncs images to Google Drive.

---

## Key Features & Architecture

### 1. Attendee Identification & Session Screen (`app/(tabs)/index.tsx`)
- **Custom On-Screen Numeric Keypad:** Dedicated digits keypad preventing the mobile OS software keyboard from popping up and obstructing the screen, maximizing entry speed for high-volume booths.
- **Intelligent Pre-Created Folder Matching:** Automatically parses Drive folder names like `"Rawda - KOT-89487"` into **Attendee Name** (`Rawda`), **Ticket Code** (`KOT-89487`), and **Numeric ID** (`89487`). Staff only needs to type numeric digits (`89487`) to match 100% offline.
- **Real-Time Suggestions:** Live attendee match card with verified `"DRIVE READY"` badge and partial match chips as numbers are entered.
- **Session Lock:** Toggle to lock an attendee session across multiple photo sets without retyping.
- **Skip ID / General Shots:** One-tap mode for candid, crowd, or group photos without attendee tagging.
- **Auto-Sync on Page Focus:** Silently syncs pre-created attendee folders from Google Drive whenever staff navigates back to the ID page (throttled to 15 seconds) over both Wi-Fi and Cellular.

### 2. Pro Camera Capture Engine (`app/camera.tsx`)
- Full-screen viewfinder powered by `expo-camera` (`CameraView`).
- **Viewfinder Aspect Ratios:** Selectable framing ratios (`3:4`, `9:16`, `1:1`, and `Full`).
- **Auto Aspect-Ratio Cropping:** Post-capture hardware image manipulation via `expo-image-manipulator` ensuring the saved photo matches the framed viewfinder ratio.
- **Pro Controls:** Tap-to-focus ring animation, zoom presets (`0.6x`, `1.0x`, `2.0x`, `3.0x`, `5.0x`), pinch-to-zoom, rule-of-thirds grid, front/back lens flip, and flash/torch controls.
- **Tactile Shutter Feedback:** Haptic vibration and shutter button dip animation (no white flash).
- **Dual-Save Fail-Safe:** Saves to local app storage (`expo-file-system`) AND writes directly to the device's native `DCIM/Camera` album via `expo-media-library` before any upload starts.

### 3. In-App Review Gallery (`app/gallery.tsx`)
- In-app gallery accessible directly from the camera thumbnail or session screens.
- **Interactive Full-Screen Viewer:** 2-finger pinch-to-zoom (1x to 4x), 1-finger pan when zoomed, double-tap zoom, swipe down to dismiss, and swipe navigation.
- Real-time upload status badges (`Pending`, `Syncing`, `Completed`, `Failed`) for every photo.

### 4. Queue & Sync Screen (`app/(tabs)/queue.tsx`)
- Photos grouped by Attendee ID (including `"no_id"` for general shots).
- Real-time status indicators: `Pending`, `Uploading`, `Completed`, `Failed`.
- Queue diagnostics: file size, timestamps, retry counts, and error messages.
- Queue actions: "Sync Now", "Retry All Failed", "Clear Completed", and individual item deletion.
- Pull-to-refresh and network warning banner if waiting for Wi-Fi.

### 5. Background Sync Engine (`services/queueManager.ts` & `services/driveApi.ts`)
- **Persistent SQLite Ledger:** Photos and folder IDs are tracked in local SQLite database tables (`upload_queue`, `precreated_folders`, `folder_cache`).
- **Event-Driven Sync Loop:** Every return to the ID screen sweeps the queue and resumes uploads.
- **Network State Detection:** Continuous monitoring via `@react-native-community/netinfo`.
- **Granular Network Policies:** 
  - Attendee folder directory lookups work over both Wi-Fi and Cellular data.
  - Photo uploads can be set to **Wi-Fi Only** or **Wi-Fi & Cellular**.
- **Bandwidth Control:** Selectable upload concurrency (1 sequential worker vs. 2 parallel workers) to prevent choking limited venue hotspots.

### 6. Settings & Configuration (`app/settings.tsx`)
- **Visual Drive Folder Picker (`components/DriveFolderPickerModal.tsx`):** Browse and select the master event folder directly from Google Drive without copy-pasting folder IDs.
- **Connection Diagnostics:** Built-in "Test Folder Connection" tool.
- **Cache Maintenance:** View cached attendee folder count, preview records, manual sync trigger, and cache purge options.
- **Account Management:** Fast Google account sign-out and profile switching.

---

## Project Structure

```
├── app/
│   ├── _layout.tsx               # Root provider wrapper & auth gate
│   ├── auth.tsx                  # Google OAuth login & Sandbox Demo Mode
│   ├── camera.tsx                # Pro camera viewfinder & aspect-ratio capture
│   ├── gallery.tsx               # In-app photo review & zoomable viewer
│   ├── settings.tsx              # Google Drive configuration & network policies
│   └── (tabs)/
│       ├── _layout.tsx           # Tab navigation layout
│       ├── index.tsx             # Attendee ID entry, folder matching & keypad
│       └── queue.tsx             # Upload queue & attendee photo grouping
├── components/
│   ├── DriveFolderPickerModal.tsx# Visual folder browser for Google Drive
│   ├── LiveQueueBar.tsx          # Real-time queue progress bar
│   └── MiniGalleryModal.tsx      # Quick thumbnail drawer
├── context/
│   ├── AuthContext.tsx           # Google tokens, user profile, and demo mode
│   ├── QueueContext.tsx          # Live queue statistics and action triggers
│   └── SettingsContext.tsx       # Folder destinations and upload preferences
├── database/
│   ├── schema.ts                 # SQLite TypeScript models and schemas
│   └── sqlite.ts                 # expo-sqlite CRUD queries & migrations
├── plugins/
│   └── withAndroidLocalProperties.js # Expo config plugin for stable Android builds
├── services/
│   ├── driveApi.ts               # Google Drive API, folder parsing, photo upload
│   ├── googleAuth.ts             # OAuth 2.0 flow & token refresh via SecureStore
│   └── queueManager.ts           # Upload queue worker & NetInfo monitor
├── app.json                      # Expo app configuration and permissions
├── package.json                  # Dependencies
└── tsconfig.json                 # TypeScript strict configuration
```

---

## Quick Start

### 1. Install Dependencies
```bash
npm install --legacy-peer-deps
```

### 2. Start the Development Server
```bash
npx expo start
```

Press `a` to run on Android.

---

## Android Build & Environment Notes

- **Windows C++ Path Limit Workaround:** In `android/gradle.properties`, `newArchEnabled=false` is configured to bypass Windows CMake/Ninja 260-character path limits during C++ compilation.
- **Permissions:** The app requests `CAMERA`, `READ_MEDIA_IMAGES`, `WRITE_EXTERNAL_STORAGE`, and `READ_EXTERNAL_STORAGE` to support instant local gallery saving to `DCIM/Camera`.
- **Google Cloud OAuth:** Ensure your OAuth consent screen is configured with the `https://www.googleapis.com/auth/drive.file` scope. If the app is in "Testing" mode in Google Cloud Console, add staff email accounts to the **Test users** whitelist.
