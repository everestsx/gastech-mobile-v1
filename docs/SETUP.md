# Gas Cylinder Delivery App – Setup

Use this **step-by-step** approach to get a working build and avoid Metro resolution issues.

---

## Step 1: Use Expo-recommended dependency versions

Always install/align dependencies with Expo’s recommendations:

```bash
cd /Users/mohammaduramsath/evx/projects/GasTech/gastech-mobile-v1
npx expo install --fix
```

This updates `package.json` to versions that match your Expo SDK and reduces “Unable to resolve” and SHA-1 errors.

---

## Step 2: Clean install

After changing dependencies or `package.json`:

```bash
rm -rf node_modules
npm install
npx expo start --clear
```

Then run the app (e.g. press `a` for Android, or `npx expo run android` in another terminal).

---

## Step 3: If you still see Metro “Unable to resolve” or SHA-1 errors

1. **Try Expo SDK 53** (often more stable with Metro):
   - In `package.json`, set `"expo": "~53.0.0"` and run `npx expo install --fix`, then Step 2 again.
2. **Or start from a fresh Expo app** and copy your code:
   - `npx create-expo-app gastech-fresh --template blank`
   - Copy `src/`, `assets/`, `App.tsx`, `app.json`, and update `package.json` scripts/deps as needed.
   - Run Step 1 and Step 2 in the new project.

---

## Step 4: Keep Metro config minimal

`metro.config.js` is kept minimal (only `unstable_enablePackageExports = false`). Avoid adding custom resolvers or `watchFolders` unless you have a specific, known fix; they often cause new SHA-1 or resolution issues.

---

## Summary

1. `npx expo install --fix`
2. `rm -rf node_modules && npm install && npx expo start --clear`
3. If issues persist → try Expo 53 or a fresh Expo app and migrate code.
