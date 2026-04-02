package com.gastech.mobile;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.util.Base64;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.ReadableMap;
import com.facebook.react.bridge.WritableArray;
import com.facebook.react.bridge.WritableMap;
import com.facebook.react.modules.core.DeviceEventManagerModule;
import com.rt.printerlibrary.bean.BluetoothEdrConfigBean;
import com.rt.printerlibrary.cmd.Cmd;
import com.rt.printerlibrary.exception.SdkException;
import com.rt.printerlibrary.cmd.EscFactory;
import com.rt.printerlibrary.connect.PrinterInterface;
import com.rt.printerlibrary.factory.connect.BluetoothFactory;
import com.rt.printerlibrary.factory.connect.PIFactory;
import com.rt.printerlibrary.factory.printer.PrinterFactory;
import com.rt.printerlibrary.factory.printer.ThermalPrinterFactory;
import com.rt.printerlibrary.enumerate.BmpPrintMode;
import com.rt.printerlibrary.printer.RTPrinter;
import com.rt.printerlibrary.setting.BitmapSetting;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Set;

public class RongtaNativeModule extends ReactContextBaseJavaModule {
    /** Safe default for common 80mm thermal mode. */
    private static final int DEFAULT_PRINT_WIDTH_DOTS = 576;
    private static final int MIN_PRINT_WIDTH_DOTS = 200;
    /** Matches EscCmd.getBitmapCmd cap. */
    private static final int MAX_PRINT_WIDTH_DOTS = 880;

    private final ReactApplicationContext reactContext;
    private final PrinterFactory printerFactory = new ThermalPrinterFactory();
    private final PIFactory bluetoothFactory = new BluetoothFactory();
    private RTPrinter rtPrinter;
    private String connectedAddress;

    RongtaNativeModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
        this.rtPrinter = printerFactory.create();
    }

    @Override
    public String getName() {
        return "RongtaNativeModule";
    }

    @ReactMethod
    public void addListener(String eventName) {
        // Required by RN event emitter contract.
    }

    @ReactMethod
    public void removeListeners(double count) {
        // Required by RN event emitter contract.
    }

    @ReactMethod
    public void disconnect(Promise promise) {
        try {
            synchronized (RongtaNativeModule.this) {
                disconnectBluetoothSilently();
            }
            promise.resolve(true);
        } catch (Exception e) {
            promise.reject("RONGTA_DISCONNECT_FAILED", e);
        }
    }

    /**
     * Establishes a fresh SPP connection to the paired printer. Call from JS before printing so the
     * socket is ready; always disconnects any previous session first.
     */
    @SuppressLint("MissingPermission")
    @ReactMethod
    public void connectToPrinter(final ReadableMap printer, final Promise promise) {
        new Thread(() -> {
            try {
                String address = readPrinterAddress(printer);
                synchronized (RongtaNativeModule.this) {
                    disconnectBluetoothSilently();
                    connectOpenPrinter(address);
                }
                // Allow SPP/socket to settle before JS enables the Print button.
                Thread.sleep(450);
                promise.resolve(true);
            } catch (Exception e) {
                promise.reject("RONGTA_CONNECT_FAILED", e.getMessage(), e);
            }
        }).start();
    }

    private static String readPrinterAddress(ReadableMap printer) {
        if (printer == null) {
            throw new IllegalArgumentException("Printer is required.");
        }
        if (printer.hasKey("address") && !printer.isNull("address")) {
            String a = printer.getString("address");
            if (a != null && !a.trim().isEmpty()) {
                return a.trim();
            }
        }
        if (printer.hasKey("mac") && !printer.isNull("mac")) {
            String m = printer.getString("mac");
            if (m != null && !m.trim().isEmpty()) {
                return m.trim();
            }
        }
        throw new IllegalArgumentException("Printer address is required.");
    }

    private void disconnectBluetoothSilently() {
        if (rtPrinter != null) {
            try {
                rtPrinter.disConnect();
            } catch (Exception ignored) {
            }
        }
        connectedAddress = null;
    }

    @SuppressLint("MissingPermission")
    private void connectOpenPrinter(String address) throws Exception {
        if (address == null || address.trim().isEmpty()) {
            throw new IllegalArgumentException("Printer address is required.");
        }

        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            throw new IllegalStateException("Bluetooth adapter not available.");
        }

        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded == null) {
            throw new IllegalStateException("No paired Bluetooth devices found.");
        }

        BluetoothDevice target = null;
        for (BluetoothDevice device : bonded) {
            if (address.equalsIgnoreCase(device.getAddress())) {
                target = device;
                break;
            }
        }

        if (target == null) {
            throw new IllegalStateException("Selected printer is not paired: " + address);
        }

        BluetoothEdrConfigBean config = new BluetoothEdrConfigBean(target);
        PrinterInterface printerInterface = bluetoothFactory.create();
        printerInterface.setConfigObject(config);

        rtPrinter.setPrinterInterface(printerInterface);
        rtPrinter.connect(config);
        connectedAddress = address;
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    public void findPrinters(String type, Promise promise) {
        if (!"Bluetooth".equalsIgnoreCase(type)) {
            promise.reject("RONGTA_UNSUPPORTED_TYPE", "Only Bluetooth discovery is supported.");
            return;
        }

        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                promise.reject("RONGTA_NO_BLUETOOTH", "Bluetooth adapter not available.");
                return;
            }

            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            WritableArray array = Arguments.createArray();

            if (bonded != null) {
                for (BluetoothDevice device : bonded) {
                    WritableMap item = Arguments.createMap();
                    item.putString("name", device.getName() == null ? "Unknown Printer" : device.getName());
                    item.putString("address", device.getAddress());
                    item.putString("mac", device.getAddress());
                    item.putString("connectionType", "Bluetooth");
                    array.pushMap(item);
                }
            }

            // Do not reuse the same WritableArray for both event + promise.
            // RN bridge consumes it once and throws "Array already consumed".
            promise.resolve(array);
        } catch (Exception e) {
            promise.reject("RONGTA_DISCOVERY_FAILED", e);
        }
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    public void printImage(final String base64OrFileUri, final ReadableMap printer, final Promise promise) {
        new Thread(() -> {
            try {
                String address = null;
                if (printer.hasKey("address") && !printer.isNull("address")) {
                    address = printer.getString("address");
                } else if (printer.hasKey("mac") && !printer.isNull("mac")) {
                    address = printer.getString("mac");
                }

                if (address == null || address.trim().isEmpty()) {
                    throw new IllegalArgumentException("Printer address is required.");
                }

                synchronized (RongtaNativeModule.this) {
                    connectIfNeeded(address);
                }

                byte[] payloadBytes = decodePrintPayload(base64OrFileUri);
                payloadBytes = stripLeadingNonPdfPrefix(payloadBytes);

                Cmd cmd = new EscFactory().create();
                int limitDots = resolvePrintWidthDots(printer);
                BitmapSetting bitmapSetting = createThermalBitmapSetting(limitDots);

                if (isPdf(payloadBytes)) {
                    appendPdfPagesAsBitmaps(
                            cmd, bitmapSetting, payloadBytes, limitDots, rasterTargetWidthPx(limitDots));
                } else {
                    Bitmap bitmap = BitmapFactory.decodeByteArray(payloadBytes, 0, payloadBytes.length);
                    if (bitmap == null) {
                        throw new IllegalStateException("Failed to decode receipt image.");
                    }
                    Bitmap fitted = fitBitmapToThermalRasterWidth(bitmap, limitDots);
                    try {
                        appendBitmapEsc(cmd, bitmapSetting, fitted);
                    } finally {
                        if (fitted != bitmap) {
                            bitmap.recycle();
                        }
                        fitted.recycle();
                    }
                }

                appendTailPaperFeedBeforeCut(cmd, limitDots);
                cmd.append(cmd.getAllCutCmd());

                rtPrinter.writeMsgAsync(cmd.getAppendCmds());
                Thread.sleep(500);

                WritableMap payload = Arguments.createMap();
                payload.putBoolean("success", true);
                payload.putString("address", address);
                emitEvent("onPrintImage", payload);
                promise.resolve(true);
            } catch (Exception e) {
                WritableMap payload = Arguments.createMap();
                payload.putBoolean("success", false);
                payload.putString("error", e.getMessage());
                emitEvent("onPrintImage", payload);
                promise.reject("RONGTA_PRINT_FAILED", e);
            }
        }).start();
    }

    @SuppressLint("MissingPermission")
    @ReactMethod
    public void printText(final String textPayload, final ReadableMap printer, final Promise promise) {
        new Thread(() -> {
            try {
                String address = null;
                if (printer.hasKey("address") && !printer.isNull("address")) {
                    address = printer.getString("address");
                } else if (printer.hasKey("mac") && !printer.isNull("mac")) {
                    address = printer.getString("mac");
                }

                if (address == null || address.trim().isEmpty()) {
                    throw new IllegalArgumentException("Printer address is required.");
                }
                if (textPayload == null || textPayload.trim().isEmpty()) {
                    throw new IllegalArgumentException("Text payload is empty.");
                }

                synchronized (RongtaNativeModule.this) {
                    connectIfNeeded(address);
                }

                Cmd cmd = new EscFactory().create();
                // ESC @ (initialize) + ESC t 0 (code page default)
                cmd.append(new byte[]{0x1B, 0x40});
                cmd.append(new byte[]{0x1B, 0x74, 0x00});
                // ESC a n alignment. Default center so receipt starts centered on wide paper.
                int align = resolveTextAlign(printer);
                cmd.append(new byte[]{0x1B, 0x61, (byte) align});
                // Small initial feed so the first line doesn't get cut off.
                cmd.append(new byte[]{0x0A, 0x0A});
                cmd.append(textPayload.getBytes(StandardCharsets.UTF_8));
                cmd.append("\r\n\r\n".getBytes(StandardCharsets.UTF_8));
                cmd.append(cmd.getAllCutCmd());

                rtPrinter.writeMsgAsync(cmd.getAppendCmds());
                Thread.sleep(500);

                WritableMap payload = Arguments.createMap();
                payload.putBoolean("success", true);
                payload.putString("address", address);
                emitEvent("onPrintImage", payload);
                promise.resolve(true);
            } catch (Exception e) {
                WritableMap payload = Arguments.createMap();
                payload.putBoolean("success", false);
                payload.putString("error", e.getMessage());
                emitEvent("onPrintImage", payload);
                promise.reject("RONGTA_PRINT_FAILED", e);
            }
        }).start();
    }

    /**
     * Reuses an existing connection when the address matches; otherwise closes the previous SPP
     * session before opening a new one (required when switching printers or after errors).
     */
    @SuppressLint("MissingPermission")
    private void connectIfNeeded(String address) throws Exception {
        if (address == null || address.trim().isEmpty()) {
            throw new IllegalArgumentException("Printer address is required.");
        }
        if (address.equalsIgnoreCase(connectedAddress)) {
            return;
        }
        disconnectBluetoothSilently();
        connectOpenPrinter(address);
    }

    private void emitEvent(String name, Object payload) {
        reactContext
                .getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter.class)
                .emit(name, payload);
    }

    /**
     * Prefer a {@code file://} URI from JS (Expo Print) so large PDFs are not truncated on the RN bridge.
     * Falls back to raw/base64 or data-URL base64 strings.
     */
    private byte[] decodePrintPayload(String base64OrFileUri) throws IOException {
        if (base64OrFileUri == null || base64OrFileUri.trim().isEmpty()) {
            throw new IllegalArgumentException("Print payload is empty.");
        }
        String trimmed = base64OrFileUri.trim();
        if (trimmed.startsWith("file:") || trimmed.startsWith("content:")) {
            Uri uri = Uri.parse(trimmed);
            if ("file".equals(uri.getScheme())) {
                String path = uri.getPath();
                if (path == null || path.isEmpty()) {
                    throw new IllegalArgumentException("Invalid file URI for print payload.");
                }
                return readFileFully(new File(path));
            }
            try (InputStream in = reactContext.getContentResolver().openInputStream(uri)) {
                if (in == null) {
                    throw new IllegalArgumentException("Could not open print payload URI.");
                }
                return readStreamFully(in);
            }
        }
        String cleanBase64 =
                trimmed.contains(",") ? trimmed.substring(trimmed.indexOf(',') + 1) : trimmed;
        cleanBase64 = cleanBase64.replaceAll("\\s+", "");
        return Base64.decode(cleanBase64, Base64.DEFAULT);
    }

    private static byte[] readFileFully(File file) throws IOException {
        try (FileInputStream in = new FileInputStream(file)) {
            return readStreamFully(in);
        }
    }

    private static byte[] readStreamFully(InputStream in) throws IOException {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[8192];
        int n;
        while ((n = in.read(chunk)) != -1) {
            buffer.write(chunk, 0, n);
        }
        return buffer.toByteArray();
    }

    /**
     * PDFs from some pipelines start with a UTF-8 BOM or whitespace; {@link PdfRenderer} needs a file
     * beginning with "%PDF".
     */
    private static byte[] stripLeadingNonPdfPrefix(byte[] bytes) {
        if (bytes == null || bytes.length == 0) {
            return bytes;
        }
        int idx = indexOfPdfHeader(bytes);
        if (idx <= 0) {
            return bytes;
        }
        return Arrays.copyOfRange(bytes, idx, bytes.length);
    }

    private static int indexOfPdfHeader(byte[] bytes) {
        int i = 0;
        if (bytes.length >= 3 && bytes[0] == (byte) 0xEF && bytes[1] == (byte) 0xBB && bytes[2] == (byte) 0xBF) {
            i = 3;
        }
        while (i < bytes.length) {
            byte b = bytes[i];
            if (b == ' ' || b == '\r' || b == '\n' || b == '\t') {
                i++;
                continue;
            }
            if (i + 3 < bytes.length && bytes[i] == '%' && bytes[i + 1] == 'P' && bytes[i + 2] == 'D'
                    && bytes[i + 3] == 'F') {
                return i;
            }
            return -1;
        }
        return -1;
    }

    private static int resolvePrintWidthDots(ReadableMap printer) {
        try {
            if (printer != null
                    && printer.hasKey("limitWidthDots")
                    && !printer.isNull("limitWidthDots")) {
                int v = printer.getInt("limitWidthDots");
                if (v >= MIN_PRINT_WIDTH_DOTS && v <= MAX_PRINT_WIDTH_DOTS) {
                    return v;
                }
            }
        } catch (Exception ignored) {
        }
        return DEFAULT_PRINT_WIDTH_DOTS;
    }

    private static int resolveTextAlign(ReadableMap printer) {
        try {
            if (printer != null && printer.hasKey("textAlign") && !printer.isNull("textAlign")) {
                String align = printer.getString("textAlign");
                if ("left".equalsIgnoreCase(align)) return 0;
                if ("right".equalsIgnoreCase(align)) return 2;
            }
        } catch (Exception ignored) {
        }
        return 1; // center
    }

    /**
     * Library default is {@link BmpPrintMode#MODE_MULTI_COLOR} which dithers lightly; thermal receipts
     * need {@link BmpPrintMode#MODE_SINGLE_COLOR} for solid blacks.
     */
    private static BitmapSetting createThermalBitmapSetting(int limitDots) {
        BitmapSetting bitmapSetting = new BitmapSetting();
        bitmapSetting.setBmpPrintMode(BmpPrintMode.MODE_SINGLE_COLOR);
        bitmapSetting.setBimtapLimitWidth(limitDots);
        return bitmapSetting;
    }

    private static int rasterTargetWidthPx(int limitDots) {
        return Math.min(MAX_PRINT_WIDTH_DOTS * 2, Math.max(limitDots * 2, 384));
    }

    /** Matches JS invoice layout (104mm wide PDF). Used to convert mm tail margin to pixels. */
    private static final float RECEIPT_PAPER_WIDTH_MM = 104f;
    /** Target tear margin (~10mm). Kept modest — ESC d “lines” are large on many heads. */
    private static final float BOTTOM_PRINT_MARGIN_MM = 10f;

    /**
     * Removes blank rows from the bottom of the receipt bitmap (tall PDF pages with little content
     * would otherwise print a long white tail before cut).
     */
    private static Bitmap trimTrailingWhiteRows(Bitmap src) {
        int w = src.getWidth();
        int h = src.getHeight();
        if (w <= 0 || h <= 0) {
            return src;
        }
        final int threshold = 250;
        int[] row = new int[w];
        int bottom = h - 1;
        outer:
        for (; bottom >= 0; bottom--) {
            src.getPixels(row, 0, w, 0, bottom, w, 1);
            for (int x = 0; x < w; x++) {
                int c = row[x];
                int r = (c >> 16) & 0xff;
                int g = (c >> 8) & 0xff;
                int b = c & 0xff;
                if (r < threshold || g < threshold || b < threshold) {
                    break outer;
                }
            }
        }
        int newH = bottom + 1;
        if (newH <= 0) {
            return src;
        }
        if (newH >= h) {
            return src;
        }
        Bitmap out = Bitmap.createBitmap(src, 0, 0, w, newH);
        src.recycle();
        return out;
    }

    /**
     * Physical feed before cut. Previously ESC d + many LFs were both sent; each stacks and one
     * “line” can be several mm, which produced ~8–10 cm of blank. Use a single small ESC d only.
     */
    private static void appendTailPaperFeedBeforeCut(Cmd cmd, int limitWidthDots) {
        int w = Math.max(MIN_PRINT_WIDTH_DOTS, limitWidthDots);
        float ratio = BOTTOM_PRINT_MARGIN_MM / RECEIPT_PAPER_WIDTH_MM;
        // ~25 dot-units per ESC line heuristic → n in a tight band (about 10–15 mm total feed).
        int n = Math.round(w * ratio / 25f);
        n = Math.max(3, Math.min(7, n));
        cmd.append(new byte[]{0x1B, 0x64, (byte) n});
    }

    private static Bitmap fitBitmapToThermalRasterWidth(Bitmap src, int limitDots) {
        int targetW = rasterTargetWidthPx(limitDots);
        int w = src.getWidth();
        int h = src.getHeight();
        if (w <= 0 || h <= 0) {
            return src;
        }
        if (w == targetW) {
            return src;
        }
        int nh = Math.max(1, Math.round(h * (targetW / (float) w)));
        return Bitmap.createScaledBitmap(src, targetW, nh, true);
    }

    private void appendBitmapEsc(Cmd cmd, BitmapSetting bitmapSetting, Bitmap bitmap) {
        try {
            cmd.append(cmd.getBitmapCmd(bitmapSetting, bitmap));
        } catch (SdkException e) {
            throw new IllegalStateException("Rongta bitmap command failed: " + e.getMessage(), e);
        }
    }

    /**
     * HTML from Expo Print is rendered to PDF. Each PDF page is rasterized and appended so
     * multi-page receipts print in full without merging into one huge bitmap.
     */
    private void appendPdfPagesAsBitmaps(
            Cmd cmd,
            BitmapSetting bitmapSetting,
            byte[] pdfBytes,
            int limitDots,
            int pdfRasterTargetWidth)
            throws IOException {
        File temp = File.createTempFile("rongta_receipt", ".pdf", reactContext.getCacheDir());
        try {
            try (FileOutputStream fos = new FileOutputStream(temp)) {
                fos.write(pdfBytes);
            }
            try (ParcelFileDescriptor pfd =
                            ParcelFileDescriptor.open(temp, ParcelFileDescriptor.MODE_READ_ONLY);
                    PdfRenderer renderer = new PdfRenderer(pfd)) {
                int pageCount = renderer.getPageCount();
                if (pageCount < 1) {
                    throw new IllegalStateException("Receipt PDF has no pages.");
                }
                for (int i = 0; i < pageCount; i++) {
                    try (PdfRenderer.Page page = renderer.openPage(i)) {
                        Bitmap bmp = renderPdfPageToBitmap(page, pdfRasterTargetWidth);
                        Bitmap fitted = fitBitmapToThermalRasterWidth(bmp, limitDots);
                        if (fitted != bmp) {
                            bmp.recycle();
                        }
                        Bitmap trimmed = trimTrailingWhiteRows(fitted);
                        if (trimmed != fitted) {
                            fitted.recycle();
                        }
                        try {
                            appendBitmapEsc(cmd, bitmapSetting, trimmed);
                            if (i < pageCount - 1) {
                                cmd.append("\n".getBytes(StandardCharsets.UTF_8));
                            }
                        } finally {
                            trimmed.recycle();
                        }
                    }
                }
            }
        } finally {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
        }
    }

    private Bitmap renderPdfPageToBitmap(PdfRenderer.Page page, int targetW) {
        int pageW = page.getWidth();
        int pageH = page.getHeight();
        int targetH = Math.max(1, Math.round(pageH * (targetW / (float) pageW)));
        final int maxH = 8192;
        if (targetH > maxH) {
            float scale = maxH / (float) targetH;
            int scaledW = Math.max(1, Math.round(targetW * scale));
            int scaledH = maxH;
            Bitmap bmp = Bitmap.createBitmap(scaledW, scaledH, Bitmap.Config.ARGB_8888);
            // Transparent PDF background can print as solid black on thermal heads.
            new Canvas(bmp).drawColor(Color.WHITE);
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
            return bmp;
        }
        Bitmap bmp = Bitmap.createBitmap(targetW, targetH, Bitmap.Config.ARGB_8888);
        new Canvas(bmp).drawColor(Color.WHITE);
        page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT);
        return bmp;
    }

    private static boolean isPdf(byte[] bytes) {
        return bytes != null
                && bytes.length >= 5
                && bytes[0] == '%'
                && bytes[1] == 'P'
                && bytes[2] == 'D'
                && bytes[3] == 'F';
    }
}
