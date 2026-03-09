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

3. **Why does the pulled DB sometimes not have the latest data?**  
   The app uses **WAL (Write-Ahead Logging)**. Recent writes are stored in **`gastech.db-wal`** (and optionally `gastech.db-shm`) until SQLite checkpoints them into the main `gastech.db`. If you only pull `gastech.db` while the app is running, you get the main file **without** the latest uncheckpointed changes.

   **Options to get a complete snapshot:**

   - **Option A – Pull all WAL files and open together**  
     Pull the main DB and the WAL file so your client can see the latest data:
     ```bash
     adb exec-out run-as com.gastech.mobile cat /data/data/com.gastech.mobile/files/SQLite/gastech.db       > gastech.db
     adb exec-out run-as com.gastech.mobile cat /data/data/com.gastech.mobile/files/SQLite/gastech.db-wal  > gastech.db-wal
     ```
     Then open **`gastech.db`** in your client. Many clients (e.g. DB Browser for SQLite) will automatically use the `-wal` file if it is in the same directory with the same base name, so you see the latest data.

   - **Option B – Close the app, then pull**  
     Fully close the GasTech app (swipe away from recents). That allows SQLite to checkpoint WAL into the main file. Then run the `cat gastech.db > gastech.db` command once. The single `gastech.db` file will then contain the latest data.

4. Open the pulled `gastech.db` in your client:
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

## Why `stock_pickings` state shows “cancel” or “assigned” instead of “done”

The app **syncs** delivery orders (stock pickings) **from Odoo**. On each sync:

1. The app fetches all pickings for the synced sale orders from Odoo (`stock.picking` with `state`).
2. It writes them into the local `stock_pickings` table. For **most** pickings it uses the **state returned by Odoo** (e.g. `done`, `assigned`, `cancel`).
3. The app only **keeps** the existing local state (e.g. `done`) for sale orders that still have **pending** delivery or payment in the sync queue (not yet uploaded). Once the queue item is marked synced, the next sync **overwrites** local state with Odoo’s state.

So if you see **cancel** or **assigned** in the app’s `stock_pickings` table, it is because **Odoo** currently has that state for those delivery orders. Common causes:

- The delivery was **cancelled** in Odoo.
- The delivery was never **validated** in Odoo (still `assigned` / waiting).
- The mobile “Validate delivery” was only stored locally and the upload to Odoo failed or never ran, so Odoo still has the old state; after sync, the app then overwrites local `done` with Odoo’s `assigned`.

**Yes, you can fix it in Odoo and re-sync:**

1. In **Odoo**, open **Inventory** (or **Delivery**) and find the delivery orders (stock pickings) for the affected sale orders.
2. For each picking that should be delivered:
   - If it is **cancelled**: either uncancel/restore it (if your Odoo allows) or create a new delivery and validate it.
   - If it is **assigned** (or waiting): use **Validate** (or **Mark as done**) so the picking state becomes **Done**.
3. In the **app**, run **Sync** (pull from Odoo). The app will fetch the updated pickings and update the local `stock_pickings` table with `state = 'done'` for those pickings.

After that, the Dashboard “delivered today”, delivery progress, and lists that use picking state will show the correct delivered state.

---

## Main tables (for reference)

Defined in `src/database/db.js` and related modules:

- `partners`, `sale_orders`, `sale_order_lines`, `products`
- `stock_pickings`, `stock_moves`, `stock_move_lines`
- `account_journals`, `routes`, `vehicles`, `vehicle_warehouses`, `vehicle_inventories`
- `sync_queue`, `sync_log`

Schema and migrations are in `src/database/db.js` (`runMigrations`).
