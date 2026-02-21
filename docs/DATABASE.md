# GasTech offline database (expo-sqlite)

The app uses **expo-sqlite** for client-side offline storage. Database name: **`gastech.db`**.

---

## Where is the DB file?

- **Android (emulator / dev build):**  
  `/data/data/<your.package.id>/files/SQLite/gastech.db`  
  (Replace `<your.package.id>` with your app id, e.g. from `app.json`.)

- **Android (Expo Go):**  
  `/data/data/host.exp.exponent/files/SQLite/gastech.db`  
  (Direct access usually needs root.)

- **iOS (simulator):**  
  Under the app’s Documents directory, e.g.:  
  `~/Library/Developer/CoreSimulator/Devices/<Device-ID>/data/Containers/Data/Application/<App-ID>/Documents/`  
  (Exact path can vary; you can search for `gastech.db` in the simulator device folder.)

You can also get the path in code from the opened database instance: `db.databasePath` (expo-sqlite).

---

## How to view tables and data

1. **Drizzle Studio (recommended)**  
   Use the [drizzle-studio-expo](https://github.com/drizzle-team/drizzle-studio-expo) dev tools plugin to open Drizzle Studio from Expo CLI and browse the on-device database.  
   Docs: [Expo SQLite – Browse an on-device database](https://docs.expo.dev/versions/latest/sdk/sqlite/#browse-an-on-device-database).

2. **Android: pull DB and open on PC**  
   ```bash
   adb shell run-as <your.package.id> cp /data/data/<your.package.id>/files/SQLite/gastech.db /sdcard/gastech.db
   adb pull /sdcard/gastech.db .
   ```  
   Then open `gastech.db` with [DB Browser for SQLite](https://sqlitebrowser.org/) or any SQLite GUI.

3. **Android Studio Device Explorer**  
   View app files under: **View → Tool Windows → Device Explorer** → your app’s `files/SQLite/`.

---

## How to drop and recreate the DB (fix “duplicate column” / reset)

### Option 1: Rely on the fixed migration (recommended)

The **“duplicate column name: password”** error came from migration version 6:

- It ran `ALTER TABLE vehicles ADD COLUMN password` every time.
- It also set `PRAGMA user_version = 5` instead of `6`, so the migration kept re-running.

This is fixed in `src/database/db.js`:

- The migration now checks if the `password` column exists before adding it.
- It sets `PRAGMA user_version = 6` so the migration runs only once.

**Action:** Update the app (or reload so the new code runs). The next time the app opens the DB, the migration will either add the column once (if missing) or skip it (if already there) and set version to 6. No need to drop the DB unless you want a full reset.

### Option 2: Clear app data (full reset)

- **Android:** Settings → Apps → GasTech → Storage → **Clear data** (or **Clear storage**).  
  Or uninstall and reinstall the app.
- **iOS:** Delete the app and reinstall.

This removes the DB file. On next launch the app will create a new `gastech.db` and run all migrations from scratch.

### Option 3: Programmatic reset (for development)

You can add a dev-only “Reset database” that:

1. Closes the DB (if expo-sqlite exposes a close API).
2. Deletes the file using `expo-file-system` at the path returned by `db.databasePath` (or `defaultDatabaseDirectory` + `gastech.db`).
3. Clears any in-memory reference so the next `getDb()` opens a new DB.

Use this only in development and behind a clear “Reset DB” button or flag.

---

## Main tables (for reference)

Defined in `src/database/db.js` and related modules:

- `partners`, `sale_orders`, `sale_order_lines`, `products`
- `stock_pickings`, `stock_moves`, `stock_move_lines`
- `account_journals`, `routes`, `vehicles`, `vehicle_warehouses`, `vehicle_inventories`
- `sync_queue`, `sync_log`

Schema and migrations are in `src/database/db.js` (`runMigrations`).
