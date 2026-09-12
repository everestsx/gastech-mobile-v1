const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const PERMISSIONS = [
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  'android.permission.WAKE_LOCK',
];

const SERVICE_NAME = 'com.gastech.mobile.BackgroundSyncService';

function ensureUsesPermission(androidManifest, permission) {
  const usesPermissions = androidManifest.manifest['uses-permission'] || [];
  const already = usesPermissions.some((item) => item?.$?.['android:name'] === permission);
  if (!already) {
    usesPermissions.push({ $: { 'android:name': permission } });
  }
  androidManifest.manifest['uses-permission'] = usesPermissions;
}

module.exports = function withBackgroundSyncService(config) {
  config = AndroidConfig.Permissions.withPermissions(config, PERMISSIONS);
  return withAndroidManifest(config, (cfg) => {
    const androidManifest = cfg.modResults;
    for (const permission of PERMISSIONS) {
      ensureUsesPermission(androidManifest, permission);
    }
    const application = androidManifest.manifest.application?.[0];
    if (!application) return cfg;
    if (!application.service) application.service = [];
    const hasService = application.service.some((svc) => svc?.$?.['android:name'] === SERVICE_NAME);
    if (!hasService) {
      application.service.push({
        $: {
          'android:name': SERVICE_NAME,
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
          'android:stopWithTask': 'false',
        },
      });
    }
    return cfg;
  });
};
