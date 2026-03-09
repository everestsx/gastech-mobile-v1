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

## How to open the DB in any DB client

The DB file lives on the device/emulator. To open it in a desktop client (DB Browser for SQLite, DBeaver, TablePlus, VS Code SQLite extension, etc.) you must **pull the file to your computer** first.

### Android (emulator or device with USB debugging)

1. Find your app package id (e.g. from `app.json` — e.g. `com.gastech.mobile`).
2. Pull the DB to your computer (no write on device, so no permission issues):

   ```bash
   adb exec-out run-as <your.package.id> cat /data/data/<your.package.id>/files/SQLite/gastech.db > gastech.db
   ```

   Example for package `com.gastech.mobile`:

   ```bash
   adb exec-out run-as com.gastech.mobile cat /data/data/com.gastech.mobile/files/SQLite/gastech.db > gastech.db
   ```

   This streams the file from the app’s private storage to your current directory. No copy to `/sdcard` is needed.

   # adb exec-out run-as com.gastech.mobile cat /data/data/com.gastech.mobile/files/SQLite/gastech.db > gastech.db

3. Open the pulled `gastech.db` in your client:
   - **[DB Browser for SQLite](https://sqlitebrowser.org/)** — File → Open Database → select `gastech.db`
   - **DBeaver** — New Database Connection → SQLite → choose `gastech.db`
   - **TablePlus** — New connection → SQLite → Database file: `gastech.db`
   - **VS Code** — Install “SQLite Viewer” or “SQLite” extension, then open `gastech.db`

### iOS (simulator)

1. In Finder, go to **~/Library/Developer/CoreSimulator/Devices/**.
2. Pick your simulator device → **data/Containers/Data/Application/**.
3. Find your app’s folder (e.g. by date modified) → **Documents/** or **Library/LocalDatabase/** — look for `gastech.db` or under a `SQLite` subfolder.
4. Copy `gastech.db` to your Mac, then open it in any of the clients above.

### Other ways to view data

- **Drizzle Studio (Expo)**  
  Use the [drizzle-studio-expo](https://github.com/drizzle-team/drizzle-studio-expo) plugin to browse the on-device DB from Expo CLI (no pull needed).  
  [Expo SQLite – Browse an on-device database](https://docs.expo.dev/versions/latest/sdk/sqlite/#browse-an-on-device-database).

- **Android Studio Device Explorer**  
  **View → Tool Windows → Device Explorer** → your app → `files/SQLite/` — you can save `gastech.db` from there, then open it in a DB client.

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

The app exposes **`resetDatabaseAndRecreate()`** in `src/database/db.js`:

1. Drains the DB queue, then closes the connection.
2. Deletes the DB file using `expo-file-system` at `db.databasePath` (or `SQLite/gastech.db` under document directory).
3. Clears the in-memory reference so the next `getDb()` opens a new DB and runs all migrations from scratch.

**How to use:**

- **One-time from code (e.g. after a bad migration):**  
  In your app entry or a dev screen, call:
  ```js
  import { resetDatabaseAndRecreate } from './src/database/db';
  await resetDatabaseAndRecreate();
  ```
  Then reload the app so all modules get a fresh DB on first access.

- **From a “Reset DB” button:**  
  Add a dev-only button that calls `resetDatabaseAndRecreate()`, then navigates or reloads so the app reopens the DB.

Use this only in development or for user-initiated “Clear all data” flows.

---

## Main tables (for reference)

Defined in `src/database/db.js` and related modules:

- `partners`, `sale_orders`, `sale_order_lines`, `products`
- `stock_pickings`, `stock_moves`, `stock_move_lines`
- `account_journals`, `routes`, `vehicles`, `vehicle_warehouses`, `vehicle_inventories`
- `sync_queue`, `sync_log`

Schema and migrations are in `src/database/db.js` (`runMigrations`).
