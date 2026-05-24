const { execSync } = require("child_process");

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
];

const APP_VARIANTS = {
  production: {
    name: "GasTechMobileStage",
    slug: "GasTechMobileStage",
    updatesUrl: "https://u.expo.dev/2f94bcdc-e805-4cfb-a4d1-b9e15c833662",
    projectId: "2f94bcdc-e805-4cfb-a4d1-b9e15c833662",
  },
  stage: {
    name: "GasTechMobileStage",
    slug: "GasTechMobileStage",
    updatesUrl: "https://u.expo.dev/2f94bcdc-e805-4cfb-a4d1-b9e15c833662",
    projectId: "2f94bcdc-e805-4cfb-a4d1-b9e15c833662",
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
      },
    },
  };
};
