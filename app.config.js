const { execSync } = require("child_process");
const { getPublicEnvExtra, describeEnvForLog } = require("./scripts/loadBuildEnv");

const SHARED_PERMISSIONS = [
  "android.permission.INTERNET",
  "android.permission.ACCESS_NETWORK_STATE",
  "android.permission.CAMERA",
  "android.permission.RECORD_AUDIO",
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_ADMIN",
  "android.permission.BLUETOOTH_SCAN",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
  "android.permission.POST_NOTIFICATIONS",
  "android.permission.FOREGROUND_SERVICE",
  "android.permission.FOREGROUND_SERVICE_DATA_SYNC",
  "android.permission.WAKE_LOCK",
];

const APP_VARIANTS = {
  production: {
    name: "GasTechMobile",
    slug: "GasTechMobile",
    updatesUrl: "https://u.expo.dev/af65ddf8-bf52-4856-9eff-cd08773a7bab",
    projectId: "af65ddf8-bf52-4856-9eff-cd08773a7bab",
  },
  stage: {
    name: "GasTechMobile",
    slug: "GasTechMobile",
    updatesUrl: "https://u.expo.dev/af65ddf8-bf52-4856-9eff-cd08773a7bab",
    projectId: "af65ddf8-bf52-4856-9eff-cd08773a7bab",
  },
};

function getCurrentGitBranch() {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { stdio: "pipe" })
      .toString()
      .trim()
      .toLowerCase();
  } catch {
    return "";
  }
}

function resolveAppVariant() {
  const explicitVariant = (process.env.APP_VARIANT || "").toLowerCase().trim();
  if (explicitVariant === "stage" || explicitVariant === "staging") {
    return "stage";
  }
  if (explicitVariant === "prod" || explicitVariant === "production") {
    return "production";
  }

  const gitBranch = getCurrentGitBranch();
  if (gitBranch.includes("stage") || gitBranch.includes("staging")) {
    return "stage";
  }
  if (
    gitBranch.includes("prod") ||
    gitBranch.includes("production") ||
    gitBranch === "main" ||
    gitBranch === "master"
  ) {
    return "production";
  }

  return "production";
}

module.exports = () => {
  const variantKey = resolveAppVariant();
  const selectedVariant = APP_VARIANTS[variantKey];

  // Helpful for `eas update` logs, so you can confirm target project quickly.
  console.log(
    `[app.config] Using ${variantKey} config: ${selectedVariant.name} (${selectedVariant.projectId})`
  );

  const envExtra = getPublicEnvExtra();
  console.log("[app.config] extra Odoo bake", describeEnvForLog(envExtra));

  return {
    expo: {
      name: selectedVariant.name,
      slug: selectedVariant.slug,
      version: "1.0.0",
      runtimeVersion: "1.0.0",
      updates: {
        url: selectedVariant.updatesUrl,
        checkAutomatically: "ON_LOAD",
        fallbackToCacheTimeout: 0,
      },
      orientation: "portrait",
      icon: "./assets/icon.png",
      userInterfaceStyle: "light",
      newArchEnabled: true,
      splash: {
        image: "./assets/icon.png",
        resizeMode: "contain",
        backgroundColor: "#312e81",
      },
      ios: {
        supportsTablet: true,
        bundleIdentifier: "com.gastech.mobile",
      },
      android: {
        package: "com.gastech.mobile",
        adaptiveIcon: {
          foregroundImage: "./assets/icon.png",
          backgroundColor: "#6366f1",
        },
        edgeToEdgeEnabled: true,
        predictiveBackGestureEnabled: false,
        permissions: SHARED_PERMISSIONS,
      },
      web: {
        favicon: "./assets/favicon.png",
      },
      plugins: [
        [
          "expo-camera",
          {
            cameraPermission: "Allow GasTech to scan customer QR codes",
          },
        ],
        [
          "expo-media-library",
          {
            photosPermission: "Allow GasTech to save customer QR codes to your gallery.",
            savePhotosPermission: "Allow GasTech to save customer QR codes to your gallery.",
            isAccessMediaLocationEnabled: true,
            granularPermissions: ["photo"],
          },
        ],
        "./plugins/withBackgroundSyncService.js",
      ],
      build: {
        preview: {
          android: {
            buildType: "apk",
          },
        },
      },
      extra: {
        eas: {
          projectId: selectedVariant.projectId,
        },
        ...envExtra,
      },
    },
  };
};