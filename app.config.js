const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function loadProjectEnv() {
  try {
    const dotenv = require("dotenv");
    const envFile = path.join(__dirname, ".env");
    if (fs.existsSync(envFile)) {
      dotenv.config({ path: envFile, override: true });
      console.log("[app.config] Loaded .env from", envFile);
    } else {
      console.log("[app.config] No .env at", envFile);
    }
  } catch (e) {
    console.log("[app.config] dotenv load skipped:", e?.message || e);
  }
}

loadProjectEnv();

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

  const extraOdooUrl = process.env.ODOO_URL || "";
  let extraOdooHost = "(empty)";
  try {
    if (extraOdooUrl) extraOdooHost = new URL(extraOdooUrl).host;
  } catch {
    extraOdooHost = "(invalid url)";
  }
  console.log("[app.config] extra Odoo bake", {
    hasUrl: !!extraOdooUrl,
    host: extraOdooHost,
    hasDb: !!(process.env.ODOO_DB || ""),
    hasApiKey: !!(process.env.ODOO_API_KEY || ""),
    uidOk: !!(process.env.UID || ""),
  });

  return {
    expo: {
      name: selectedVariant.name,
      slug: selectedVariant.slug,
      version: "1.0.0",
      runtimeVersion: "1.0.0",
      updates: {
        url: selectedVariant.updatesUrl,
        checkAutomatically: "NEVER",
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
        ODOO_URL: process.env.ODOO_URL || "",
        ODOO_DB: process.env.ODOO_DB || "",
        ODOO_API_KEY: process.env.ODOO_API_KEY || "",
        UID: process.env.UID || "",
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || "",
        GOOGLE_REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN || "",
        ROOT_FOLDER_ID: process.env.ROOT_FOLDER_ID || "",
      },
    },
  };
};