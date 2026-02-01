# Metro "Unable to resolve" – root cause and fix

## Why it keeps happening

Two things in Expo / React Native 0.81+ cause these errors:

### 1. Package `exports` (Metro 0.72+)

Metro uses Node’s `package.json` `"exports"` field. Some dependencies (e.g. `pretty-format`, `expo-splash-screen`, `@react-navigation/native`) don’t match what Metro expects, so you get “Unable to resolve X”.

**Fix in this project:** `metro.config.js` sets `resolver.unstable_enablePackageExports = false` so Metro uses the legacy `"main"` entry instead of `"exports"`.

### 2. Nested `node_modules`

Metro mainly resolves from the **project root** `node_modules`. If a dependency lives only inside another package (e.g. `react-native/node_modules/@react-native/virtualized-lists`), Metro may not find it.

**Fix in this project:** Any such package is added as a **direct dependency** in `package.json` so npm hoists it to the top-level `node_modules` (e.g. `@react-native/virtualized-lists`).

### 3. Relative paths in some packages (e.g. `@ungap/structured-clone`)

Metro can fail to resolve relative requires like `./types.js` from within a package (e.g. from `cjs/serialize.js`), even when the file exists.

**Fix in this project:** `metro.config.js` uses a custom `resolveRequest` that, for relative requires inside `@ungap/structured-clone`, resolves them with `path.resolve` from the requiring file’s directory.

## If you see another “Unable to resolve X”

1. Check if `X` exists under `node_modules` (e.g. `node_modules/some-pkg/node_modules/X`).
2. If it does, add `X` to `package.json` with the same version as the parent (e.g. `"@react-native/virtualized-lists": "0.81.5"`).
3. Run `npm install`, then `npx expo start --clear`.

## After changing Metro or dependencies

```bash
npm install
npx expo start --clear
```

Then run the app again (e.g. `npx expo run android`).
