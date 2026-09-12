package com.gastech.mobile;

import android.content.Intent;
import android.os.Build;

import androidx.annotation.Nullable;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableArray;
import com.facebook.react.bridge.ReadableMap;

import java.util.ArrayList;

public class BackgroundSyncNativeModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    BackgroundSyncNativeModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "BackgroundSyncNativeModule";
    }

    @ReactMethod
    public void start(ReadableMap options, Promise promise) {
        try {
            startService(BackgroundSyncService.ACTION_START, options);
            promise.resolve(true);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void update(ReadableMap options, Promise promise) {
        try {
            startService(BackgroundSyncService.ACTION_UPDATE, options);
            promise.resolve(true);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void complete(ReadableMap options, Promise promise) {
        try {
            startService(BackgroundSyncService.ACTION_COMPLETE, options);
            promise.resolve(true);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    @ReactMethod
    public void stop(Promise promise) {
        try {
            Intent intent = new Intent(reactContext, BackgroundSyncService.class);
            intent.setAction(BackgroundSyncService.ACTION_STOP);
            reactContext.startService(intent);
            promise.resolve(true);
        } catch (Exception e) {
            promise.resolve(false);
        }
    }

    private void startService(String action, @Nullable ReadableMap options) {
        Intent intent = new Intent(reactContext, BackgroundSyncService.class);
        intent.setAction(action);
        applyOptions(intent, options);
        if (Build.VERSION.SDK_INT >= 26) {
            reactContext.startForegroundService(intent);
        } else {
            reactContext.startService(intent);
        }
    }

    private void applyOptions(Intent intent, @Nullable ReadableMap options) {
        if (options == null) return;
        if (options.hasKey("title") && !options.isNull("title")) {
            intent.putExtra(BackgroundSyncService.EXTRA_TITLE, options.getString("title"));
        }
        if (options.hasKey("text") && !options.isNull("text")) {
            intent.putExtra(BackgroundSyncService.EXTRA_TEXT, options.getString("text"));
        }
        if (options.hasKey("max") && !options.isNull("max")) {
            intent.putExtra(BackgroundSyncService.EXTRA_MAX, options.getInt("max"));
        }
        if (options.hasKey("current") && !options.isNull("current")) {
            intent.putExtra(BackgroundSyncService.EXTRA_CURRENT, options.getInt("current"));
        }
        if (options.hasKey("indeterminate") && !options.isNull("indeterminate")) {
            intent.putExtra(BackgroundSyncService.EXTRA_INDETERMINATE, options.getBoolean("indeterminate"));
        }
        if (options.hasKey("lines") && !options.isNull("lines")) {
            ReadableArray arr = options.getArray("lines");
            ArrayList<String> lines = new ArrayList<>();
            if (arr != null) {
                for (int i = 0; i < arr.size(); i++) {
                    String line = arr.getString(i);
                    if (line != null && !line.trim().isEmpty()) {
                        lines.add(line.trim());
                    }
                }
            }
            intent.putStringArrayListExtra(BackgroundSyncService.EXTRA_LINES, lines);
        }
    }
}
