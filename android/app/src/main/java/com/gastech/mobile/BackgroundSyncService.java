package com.gastech.mobile;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;

/**
 * Keeps the JS runtime alive while order uploads run, and shows a WhatsApp-style
 * progress notification. Does not perform sync itself.
 */
public class BackgroundSyncService extends Service {
    public static final String ACTION_START = "com.gastech.mobile.SYNC_START";
    public static final String ACTION_UPDATE = "com.gastech.mobile.SYNC_UPDATE";
    public static final String ACTION_COMPLETE = "com.gastech.mobile.SYNC_COMPLETE";
    public static final String ACTION_STOP = "com.gastech.mobile.SYNC_STOP";

    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    public static final String EXTRA_MAX = "max";
    public static final String EXTRA_CURRENT = "current";
    public static final String EXTRA_INDETERMINATE = "indeterminate";
    public static final String EXTRA_LINES = "lines";

    static final int NOTIFICATION_ID = 41001;
    static final String CHANNEL_ID = "gastech_order_sync";

    private static final long COMPLETE_DISMISS_MS = 1800L;
    private static final long WAKELOCK_MS = 30 * 60 * 1000L;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private String title = "Uploading order";
    private String text = "Sending delivery to back office";
    private final List<String> lines = new ArrayList<>();
    private int max = 1;
    private int current = 0;
    private boolean indeterminate = true;
    private boolean completed = false;
    private final Runnable stopRunnable = this::stopSelfSafely;
    private final Runnable midnightRunnable = this::stopSelfSafely;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannel();
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelfSafely();
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        if (action == null) action = ACTION_START;

        if (ACTION_STOP.equals(action)) {
            stopSelfSafely();
            return START_NOT_STICKY;
        }

        applyExtras(intent);
        scheduleMidnightStop();

        if (ACTION_COMPLETE.equals(action)) {
            completed = true;
            indeterminate = false;
            if (max < 1) max = 1;
            current = max;
            lines.clear();
            mainHandler.removeCallbacks(stopRunnable);
            promoteToForeground();
            mainHandler.postDelayed(stopRunnable, COMPLETE_DISMISS_MS);
            return START_NOT_STICKY;
        }

        completed = false;
        mainHandler.removeCallbacks(stopRunnable);
        promoteToForeground();
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onTimeout(int startId, int fgsType) {
        stopSelfSafely();
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacks(stopRunnable);
        mainHandler.removeCallbacks(midnightRunnable);
        releaseWakeLock();
        super.onDestroy();
    }

    private void applyExtras(@Nullable Intent intent) {
        if (intent == null) return;
        if (intent.hasExtra(EXTRA_TITLE)) {
            String next = intent.getStringExtra(EXTRA_TITLE);
            if (next != null && !next.isEmpty()) title = next;
        }
        if (intent.hasExtra(EXTRA_TEXT)) {
            String next = intent.getStringExtra(EXTRA_TEXT);
            if (next != null && !next.isEmpty()) text = next;
        }
        if (intent.hasExtra(EXTRA_MAX)) {
            max = Math.max(1, intent.getIntExtra(EXTRA_MAX, max));
        }
        if (intent.hasExtra(EXTRA_CURRENT)) {
            current = Math.max(0, intent.getIntExtra(EXTRA_CURRENT, current));
            if (current > max) max = current;
        }
        if (intent.hasExtra(EXTRA_INDETERMINATE)) {
            indeterminate = intent.getBooleanExtra(EXTRA_INDETERMINATE, indeterminate);
        }
        if (intent.hasExtra(EXTRA_LINES)) {
            lines.clear();
            ArrayList<String> nextLines = intent.getStringArrayListExtra(EXTRA_LINES);
            if (nextLines != null) {
                for (String line : nextLines) {
                    if (line != null && !line.trim().isEmpty()) {
                        lines.add(line.trim());
                    }
                }
            }
        }
    }

    private void scheduleMidnightStop() {
        mainHandler.removeCallbacks(midnightRunnable);
        Calendar calendar = Calendar.getInstance();
        calendar.add(Calendar.DAY_OF_YEAR, 1);
        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 1);
        calendar.set(Calendar.MILLISECOND, 0);
        long delay = calendar.getTimeInMillis() - System.currentTimeMillis();
        if (delay < 1000L) delay = 1000L;
        mainHandler.postDelayed(midnightRunnable, delay);
    }

    private void promoteToForeground() {
        Notification notification = buildNotification();
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
                );
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception e) {
            try {
                startForeground(NOTIFICATION_ID, notification);
            } catch (Exception ignored) {
                // OS refused FGS; notification may still post below.
            }
        }
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIFICATION_ID, notification);
        }
    }

    private Notification buildNotification() {
        Intent launch = new Intent(this, MainActivity.class);
        launch.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) {
            piFlags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0, launch, piFlags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setContentTitle(title)
            .setContentText(text)
            .setContentIntent(contentIntent)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_PROGRESS)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(0xFF6366F1)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setPriority(completed
                ? NotificationCompat.PRIORITY_DEFAULT
                : NotificationCompat.PRIORITY_LOW);

        if (!completed && lines.size() > 1) {
            NotificationCompat.InboxStyle inbox = new NotificationCompat.InboxStyle()
                .setBigContentTitle(title)
                .setSummaryText(text);
            for (String line : lines) {
                inbox.addLine(line);
            }
            builder.setStyle(inbox);
        } else {
            builder.setStyle(new NotificationCompat.BigTextStyle().bigText(text));
        }

        if (completed) {
            builder.setOngoing(false)
                .setAutoCancel(true)
                .setProgress(max, max, false);
        } else {
            builder.setOngoing(true)
                .setAutoCancel(false)
                .setProgress(Math.max(1, max), Math.min(current, Math.max(1, max)), indeterminate);
        }
        return builder.build();
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "Order sync",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("Shows progress while completed orders upload to the back office");
        channel.setShowBadge(false);
        channel.enableVibration(false);
        channel.setSound(null, null);
        nm.createNotificationChannel(channel);
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gastech:order-sync");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire(WAKELOCK_MS);
        } catch (Exception ignored) {
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
        wakeLock = null;
    }

    private void stopSelfSafely() {
        mainHandler.removeCallbacks(stopRunnable);
        mainHandler.removeCallbacks(midnightRunnable);
        try {
            if (Build.VERSION.SDK_INT >= 24) {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } else {
                stopForeground(true);
            }
        } catch (Exception ignored) {
        }
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIFICATION_ID);
        } catch (Exception ignored) {
        }
        stopSelf();
    }
}
