# Debugging the GasTech Android App (Expo)

Ways to debug the app on Android (emulator or device).

---

## 1. In-app Dev Menu + Chrome DevTools (no extra setup)

1. **Start the app**
   ```bash
   npm start
   ```
   Then press **`a`** to run on Android (emulator or connected device).

2. **Open the developer menu**
   - **Emulator:** `Ctrl + M` (Windows/Linux) or `Cmd + M` (Mac)
   - **Physical device:** Shake the device

3. **Enable JS debugging**
   - Tap **"Debug Remote JS"** (or **"Open Debugger"** on newer Expo).
   - Chrome (or your default browser) opens with DevTools.

4. **Debug in Chrome**
   - **Console:** See `console.log`, errors, and run JS.
   - **Sources:** Set breakpoints in your JS/JSX (e.g. under `localhost:8081` → your files).
   - **Network:** Inspect API calls.

5. **Stop debugging**
   - Close the Chrome tab or tap **"Stop Remote JS Debugging"** in the app dev menu.

---

## 2. Console logs (quickest)

- Use `console.log()`, `console.warn()`, `console.error()` in your code.
- Logs show in the **terminal where `npm start` is running** (Metro bundler), or in **Android Studio Logcat** if you run the app from Android Studio.
- For more context: `console.log('[Sync]', { orders, count })`.

---

## 3. React DevTools (inspect components)

1. Install React DevTools (standalone or browser extension).
2. Start the app and ensure it’s connected to Metro.
3. Open React DevTools; it should detect the app so you can inspect the component tree and props/state.

---

## 4. VS Code / Cursor with React Native extension

1. **Install extension**
   - In Cursor/VS Code: open Extensions, search for **"React Native Tools"** (by Microsoft), install.

2. **Start Metro**
   ```bash
   npm start
   ```

3. **Run app on Android**
   - Press **`a`** in the Metro terminal, or run the app from your device/emulator.

4. **Attach debugger**
   - Run → Start Debugging (F5) or open **Run and Debug** (Ctrl/Cmd + Shift + D).
   - Choose **"Attach to Expo (Android)"**.
   - Set breakpoints in your `.js`/`.jsx` files; execution will stop there when the app hits them.

If **"Attach to Expo (Android)"** doesn’t appear or fails, use **method 1** (Chrome DevTools) instead.

---

## 5. Android Studio / Logcat (native and JS logs)

1. Open **Android Studio** → **Device Manager** (or connect a device).
2. Run the app (e.g. `npx expo run:android` or build from Android Studio).
3. **View → Tool Windows → Logcat**.
4. Filter by your app package: `com.gastech.mobile`, or by tag `ReactNativeJS` for JS logs.

Useful for:
- Native crashes and ANRs
- All `console.log` output (tagged as ReactNativeJS)
- SQLite or other native module errors

---

## Quick checklist

| Goal                    | Use this                          |
|-------------------------|-----------------------------------|
| Breakpoints in JS       | Chrome DevTools or RN Tools attach |
| See logs quickly        | `console.log` + Metro terminal    |
| Inspect component tree   | React DevTools                    |
| Native / SQLite errors  | Logcat (Android Studio)           |

Start with **method 1** (Dev Menu → Debug Remote JS) if you’re not sure; it works without any extra extensions.
