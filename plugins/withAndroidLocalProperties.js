const {
  withGradleProperties,
  withAppBuildGradle,
  withDangerousMod,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

/**
 * Expo Config Plugin to permanently configure Android builds across any prebuild:
 * 1. Guarantees android/local.properties is created with sdk.dir pointing to Android SDK.
 * 2. Guarantees android/gradle.properties has org.gradle.java.home pointing to JDK 21 (Android Studio JBR).
 * 3. Injects -DCMAKE_OBJECT_PATH_MAX=200 into app/build.gradle to prevent Windows 260-char path errors in CMake/Ninja.
 */
function withAndroidLocalProperties(config) {
  // 1. Ensure gradle.properties has JDK 21
  config = withGradleProperties(config, (gradleConfig) => {
    const javaHome = "C:/JRE-JDE/jdk-17.0.20.1+1";
    const existingJava = gradleConfig.modResults.find(
      (item) => item.type === "property" && item.key === "org.gradle.java.home",
    );
    if (existingJava) {
      existingJava.value = javaHome;
    } else {
      gradleConfig.modResults.push({
        type: "property",
        key: "org.gradle.java.home",
        value: javaHome,
      });
    }

    return gradleConfig;
  });

  // 2. Ensure app/build.gradle sets CMAKE_OBJECT_PATH_MAX=200
  config = withAppBuildGradle(config, (appConfig) => {
    if (!appConfig.modResults.contents.includes("CMAKE_OBJECT_PATH_MAX")) {
      appConfig.modResults.contents = appConfig.modResults.contents.replace(
        /defaultConfig\s*\{/,
        `defaultConfig {\n        externalNativeBuild {\n            cmake {\n                arguments "-DCMAKE_OBJECT_PATH_MAX=200"\n            }\n        }`,
      );
    }
    return appConfig;
  });

  // 3. Ensure android/local.properties is always created with sdk.dir
  config = withDangerousMod(config, [
    "android",
    async (dangerousConfig) => {
      const localPropertiesPath = path.join(
        dangerousConfig.modRequest.platformProjectRoot,
        "local.properties",
      );
      const sdkDir =
        process.env.ANDROID_HOME ||
        process.env.ANDROID_SDK_ROOT ||
        "C:/Users/EyonMiner/AppData/Local/Android/Sdk";
      const formattedSdkDir = sdkDir.replace(/\\/g, "/");
      const content = `## Automatically written by Expo config plugin\nsdk.dir=${formattedSdkDir}\n`;
      fs.writeFileSync(localPropertiesPath, content, "utf8");
      console.log(
        `[ConfigPlugin] Written ${localPropertiesPath} with sdk.dir=${formattedSdkDir}`,
      );
      return dangerousConfig;
    },
  ]);

  return config;
}

module.exports = withAndroidLocalProperties;
