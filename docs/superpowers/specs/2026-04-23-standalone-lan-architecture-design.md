# Standalone LAN Architecture for MabizPOS — Design Spec

**Date:** 2026-04-23
**Status:** Draft — pending review
**Author:** Sabir + Claude
**Supersedes:** The existing MabizPOS in-process server pattern (`server/*` with tsyringe, 95+ IPC handlers).

---

## 1. Context

### What we are building

A **single installer** for shop owners that turns their PC into a self-contained Zyncount ERP node, with additional stations (tablets, second PCs) on the same shop LAN connecting back to it.

### Why

- Target user: **shop owners**, not IT professionals. The product must work with zero server administration.
- Must work **offline** — power cuts, bad ISP, rural connectivity.
- Must scale from **1 to N stations** on an intranet without re-deployment.
- Must later **sync to the cloud** zyncount-be so head-office visibility and cross-shop reporting remain possible.

### What we are not building

- A cloud-hosted multi-tenant system — that's what [zyncount-master](../../../../zyncount-master) + cloud zyncount-be is for.
- A pure single-device app — stations are first-class.
- A fresh POS backend — we **reuse zyncount-be and zyncount-admin unchanged**.

### Current state we're replacing

The existing MabizPOS ([`main/background.ts`](../../../main/background.ts), [`server/`](../../../server/), [`renderer/`](../../../renderer/)) is a **custom Mongoose+tsyringe backend exposed over IPC**. It has:
- A hardcoded `mongodb://localhost:27017/mabizpos` connection (fails if Mongo isn't running).
- 95+ preload IPC handlers, untyped on the renderer side.
- Its own domain schemas (Item, Stock, Order, etc.) independent of zyncount-be.
- No sync, no multi-station, Windows-only build target.

We discard the custom server and IPC layer. We keep the Electron shell + Nextron build pipeline + POS-focused renderer pages. Those become a **thin frontend** talking to the embedded zyncount-be over HTTP/GraphQL (same as the web admin does).

---

## 2. Architecture

### 2.1 Topology

```
┌──────────────────────── Shop LAN (192.168.x.x) ────────────────────────┐
│                                                                        │
│   ┌─── Main Station (the shop owner's PC) ─────────────────────────┐   │
│   │                                                                │   │
│   │  MongoDB service (installed separately, OS-managed)            │   │
│   │   └─ mongod                   (127.0.0.1:27017, data in /var/lib/mongodb) │
│   │                                                                │   │
│   │  Electron main process (MabizPOS)                              │   │
│   │   ├─ spawn: zyncount-be       (0.0.0.0:4060, GraphQL + REST)  │   │
│   │   ├─ spawn: zyncount-admin    (0.0.0.0:3060, Next.js server)  │   │
│   │   ├─ mDNS advertise: _mabizpos._tcp.local on :3060            │   │
│   │   └─ BrowserWindow → http://127.0.0.1:3060                    │   │
│   │                                                                │   │
│   └───────────┬────────────────────────────────────────────────────┘   │
│               │                                                        │
│        LAN-reachable http://<main-ip>:3060                             │
│               │                                                        │
│   ┌───────────▼──────────────────┐ ┌────────────────────────────────┐  │
│   │ Station A (tablet)           │ │ Station B (second PC)          │  │
│   │  Electron main               │ │  Electron main                 │  │
│   │   ├─ mDNS browse for main    │ │   ├─ mDNS browse for main      │  │
│   │   └─ BrowserWindow → main    │ │   └─ BrowserWindow → main      │  │
│   └──────────────────────────────┘ └────────────────────────────────┘  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
             │ (phase 3, optional, internet)
             ▼
      Cloud zyncount-be (for backup + head-office reporting)
```

### 2.2 Two modes in one installer

Same `.exe` / `.dmg`. First launch asks:

> **Is this the main computer, or a cashier station?**
>
> **Main:** hosts the database and ERP for this shop. Pick this on one PC per shop.
>
> **Station:** connects to a main computer over the shop WiFi.

| Mode | Responsibilities | Processes spawned by MabizPOS |
|---|---|---|
| **Main** | Backend + admin UI + mDNS advertise + backups. (MongoDB runs as an OS service, installed separately, not spawned by us.) | zyncount-be, zyncount-admin |
| **Station** | mDNS discover + BrowserWindow pointing at main | none |

Mode is persisted in `<userData>/config.json` so subsequent launches skip the wizard.

### 2.3 Dataflow for a cashier action

```
Cashier taps "Pay" on station tablet
  └─▶ React button in zyncount-admin (served from main)
        └─▶ Apollo mutation CREATE_SALES_INVOICE
              └─▶ HTTP POST → http://<main>:4060/graphql
                    └─▶ zyncount-be SalesInvoiceResolver
                          └─▶ Service → Repository → Mongoose → mongod (:27018)
                    ◀── response with invoice _id
              ◀── UI updates, receipt prints (via WebUSB from station)
```

No IPC. No custom POS server. The station's Electron shell is effectively a browser. The main PC's Mongo never accepts LAN connections — only `zyncount-be` does, so auth stays centralised in JWT.

---

## 3. Key design decisions

### 3.1 Reuse zyncount-be / zyncount-admin unchanged

The env-var contract we built (`mongodb_url`, `tenant_key`, `TZ`, etc.) already lets you boot a single-tenant instance. We hardcode:

| Env var | Value |
|---|---|
| `mongodb_url` | `mongodb://127.0.0.1:27017/pos_desktop` (OS-managed Mongo service) |
| `mongodb_master_url` | _(unset — TenantConfigService falls back gracefully)_ |
| `tenant_key` | `shop` |
| `internal_master_secret` | _(unset)_ |
| `port` | `4060` |
| `TZ` | chosen by user in first-launch wizard (IANA name) |
| `app_env` | `production` |

No fork of the upstream repos. Bug fixes in zyncount-be automatically benefit the desktop build.

### 3.2 MongoDB installed manually by the shop owner (not bundled)

**Decision: MongoDB Community 7.0, installed as a service on the main PC by us during setup.** Not shipped inside the installer.

Rationale:
- Avoids SSPL redistribution concerns entirely.
- Cuts ~200MB per platform off the installer.
- We install the product on each client manually (pilot customers), so adding a second install step (MongoDB) is trivial.
- Official MongoDB installers (MSI for Windows, .pkg for macOS) give us a proper Windows Service / macOS LaunchDaemon for free — survives reboots, starts at boot, handled by the OS supervisor.
- Upgrading Mongo later is independent of upgrading MabizPOS.

Setup on the main PC (one-time, per install):
- **Windows:** download MongoDB Community MSI → install with "Install MongoDB as a Service" option checked (default). Service listens on `127.0.0.1:27017`.
- **macOS:** install via official .pkg or Homebrew: `brew tap mongodb/brew && brew install mongodb-community@7.0 && brew services start mongodb-community@7.0`.
- Verify: `mongosh --quiet --eval 'db.runCommand({ping:1})'` returns `{ ok: 1 }`.

What MabizPOS does at runtime:
- **Does not spawn mongod.** Electron main only spawns zyncount-be and zyncount-admin.
- zyncount-be connects to `mongodb://127.0.0.1:27017/pos_desktop` (overridable via `MABIZPOS_MONGO_URL`).
- Database `pos_desktop` is auto-created on first write.
- If Mongo isn't running, zyncount-be startup fails; Electron main surfaces a clear error window ("MongoDB is not running. Start the MongoDB service and relaunch MabizPOS.").
- Mongo remains on port `27017` binding `127.0.0.1` (its install default). Never LAN-exposed.

Stations don't need MongoDB installed at all — they just point their BrowserWindow at the main PC's `:3060`.

### 3.3 Two spawned Node processes, orchestrated by a ServiceManager

One `ServiceManager` class in Electron main:

```ts
class ServiceManager {
  async startAll() {
    await this.checkMongo();        // ping 127.0.0.1:27017; fail fast with clear error
    await this.startBackend();      // wait for GraphQL /health
    await this.startAdmin();        // wait for HTTP 200 on /
    this.advertiseMdns();
  }
  async stopAll() { /* reverse order, kill trees */ }
  onCrash(service, handler) { /* restart with backoff */ }
}
```

Split into `main/services/backend.ts`, `main/services/admin.ts`, each with `start() / stop() / health()`. A small `main/services/mongo-check.ts` just verifies connectivity.

**Not in-process.** NestJS in the Electron main process is brittle (Node version mismatch, native rebuild issues). Child processes make crash recovery possible: if backend crashes, restart it without killing the UI.

**If MongoDB isn't reachable** at startup, `ServiceManager` surfaces a modal with: the expected URI, a "Retry" button, and a link to our Mongo install guide. No progress past this point until Mongo responds.

### 3.4 Station discovery via mDNS

Package: [`bonjour-service`](https://www.npmjs.com/package/bonjour-service) (pure JS, no native deps).

- **Main advertises:** service name `_mabizpos._tcp`, port `3060`, txt record `{ version, shopName, be: 4060 }`.
- **Station browses** at launch. If it finds ≥1 advertiser → auto-fill connection field. If 0 → manual IP entry.
- After pairing, station remembers `lastKnownMain` and tries that first before browsing.

### 3.5 First-launch wizard

Replaces the current signin screen for unconfigured installs.

```
Step 1: Welcome — "Main computer" / "Cashier station"
Step 2 (Main only): Shop name, currency, timezone, admin email + password
Step 3 (Main only): Restore from backup? (select .zync-backup file)
Step 3 (Station only): Pick a main from discovered list OR enter IP
Step 4: Done
```

Timezone picker is the same component we built in zyncount-master's Deployment tab — lifted into a shared package, or copied (it's <100 lines).

### 3.6 Keep the existing POS renderer as a Cashier Mode view

The current MabizPOS renderer has a tight POS UX (item grid, cart, payment, receipt). It's worth preserving, but rewired to hit `http://127.0.0.1:4060/graphql` instead of IPC.

- Main station default view: zyncount-admin on :3060 (full ERP).
- A prominent "Cashier Mode" button opens the POS UI (served from :3060 as a special route `/cashier`).
- Station default view: cashier UI. Full admin accessible via a hidden/advanced menu.

This means the existing `renderer/` code becomes part of zyncount-admin under `src/modules/pos/` or `src/modules/cashier/`. The Electron-specific IPC dependencies are stripped; network calls go through the standard Apollo context.

### 3.7 Electron-builder config: extraResources for zyncount-be / zyncount-admin only

```js
// package.json → build.extraResources
[
  { "from": "resources/be",    "to": "be",    "filter": ["**/*"] },
  { "from": "resources/admin", "to": "admin", "filter": ["**/*"] }
]
```

No `mongod` binary shipped (MongoDB installed separately, §3.2). Installer size budget: **~150MB Windows, ~200MB Mac** (reduced from the bundled-Mongo plan).

### 3.8 Auto-update

`electron-updater` pointed at GitHub releases (private repo with a pre-signed release feed). Update downloads silently, applies on quit. Auto-updating **the database** is a separate concern — Mongoose schema migrations bundled with the backend run on boot (same as server-side).

### 3.9 Backups

- **Automatic:** nightly at 02:00 local time. `mongodump --uri=… --archive=<userData>/backups/<date>.gz --gzip`. Keep last 7.
- **Manual:** "Backup now" button in admin settings.
- **Export .zync-backup:** single file containing the archive + metadata (shop name, version, date). User can email it, put on USB, send to us for recovery support.

---

## 4. Phased delivery

### Phase 1 — "It runs on my PC" (2 weeks)

**Exit criteria:** We install MongoDB + MabizPOS on a shop owner's PC, they open the app, see zyncount-admin logged in, create a sales invoice that persists after reboot.

Tasks:
- [x] **Spike:** prove spawn + copy + packaged launch works (background.ts + build/copy-sources.js + package.json updates, 2026-04-24).
- [ ] Document MongoDB install steps for Windows + macOS in `docs/install/mongodb.md`.
- [ ] `main/services/mongo-check.ts` — ping Mongo, fail fast with clear error modal if not running.
- [ ] `main/services/backend.ts` — wrap the spawn logic from the spike.
- [ ] `main/services/admin.ts` — same for zyncount-admin.
- [ ] `main/services/manager.ts` — orchestrator (§3.3).
- [ ] First-launch wizard React component. Persist to `<userData>/config.json`.
- [ ] `main/background.ts` — on ready: check Mongo → read config → if configured, boot services; else show wizard.
- [ ] Startup splash with a live log tail (shop owner can see "Checking database… Starting backend… Ready").
- [ ] Delete the old `server/` directory and IPC preload handlers. Replace preload with a minimal `{ openDevTools, getVersion, quit }`.
- [ ] Package Win NSIS + Mac DMG, smoke test on clean VMs.

### Phase 2 — "It runs in my shop" (2 weeks)

**Exit criteria:** Owner installs on 3 devices (1 main + 2 stations). Stations auto-discover. Cashier can take a sale from any station, all persist to the same DB.

- [ ] mDNS advertise on main (§3.4).
- [ ] mDNS browse on station.
- [ ] Station mode: no services spawned, just a BrowserWindow pointing at `http://<main-ip>:3060`.
- [ ] Windows firewall: installer adds inbound TCP rule for 3060/4060 (NSIS `nsisinclude` script).
- [ ] Mac firewall: show native prompt at first main-mode boot.
- [ ] `electron-updater` wired to GitHub releases.
- [ ] Backups: scheduled job + manual button (§3.9).
- [ ] Cashier Mode UX: migrate existing MabizPOS `renderer/app/*` pages into `zyncount-admin/src/modules/cashier/`. Delete the old `renderer/` dir.

### Phase 3 — "It works disconnected" (2 weeks)

**Exit criteria:** Main station loses internet; shop continues operating; when internet returns, all transactions flow to cloud; head office sees them within 2 minutes.

- [ ] Add `syncedAt?: Date` field to `BaseSchema` in zyncount-be (behind a flag).
- [ ] `SyncWorker` service on main station (child process or embedded in backend).
- [ ] Mongo change streams → outbound queue → cloud GraphQL mutations.
- [ ] Cloud-to-local pull on reconnect (users, permissions, price lists, items).
- [ ] Conflict UI in admin (two-pane diff, manual resolve).
- [ ] "Offline" indicator in admin header with queue depth tooltip.

---

## 5. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| ~~MongoDB SSPL licensing~~ | ~~Can't distribute commercially~~ | **No longer applicable** — MongoDB is not bundled. Shop owners install it separately via the official MongoDB installer. |
| **Unsigned app → Windows/Mac AV warnings** | Users see scary install screens, uninstall | Buy EV code-signing cert (~$250/yr Win + Apple $99 Mac). Budget this up front. |
| **Power loss corrupts DB** | Shop data loss | WiredTiger journaling (default ON). Nightly automated `mongodump`. Journal replay on boot. |
| **Main PC hardware failure** | Total shop data loss | Backup files on USB drive; phase 3 cloud sync is the real fix. |
| **Mongo port exposed to LAN** | Anyone on shop WiFi reads all data | Mongo binds `127.0.0.1` only, never `0.0.0.0`. zyncount-be is the only LAN-accessible process. |
| **JWT secret leaked** | Station pretends to be another station | Generate secret on first boot, store in `<userData>/config.json` (mode 600 on Unix, ACL-restricted on Windows). Rotate on each major update. |
| **Clock drift between main/stations** | Invoice timestamps wrong | Don't rely on client clock — all timestamps generated server-side by `zyncount-be`. |
| **Electron Node version vs native deps** | Build fails on each Electron bump | Lock Electron version per release. Rebuild any native deps (mainly `bonjour-service` — which is pure JS, so OK) against each bump. |
| ~~Installer size too large~~ | ~~Shop owner gives up~~ | **Mitigated** by not bundling Mongo. MabizPOS installer is ~150-200MB; Mongo installer (~200MB) downloaded separately by owner or pre-staged on USB by us during pilot installs. |
| **MongoDB service not running on boot** | App fails to start | Install Mongo as Windows Service / macOS LaunchDaemon (default in official installers). Surface a clear error modal with retry button if unreachable at startup. |
| **zyncount-be schema drift between versions** | Upgrade breaks shop data | Migrations in `src/migrations/` run automatically on boot, same as cloud. Pre-upgrade backup required. |

---

## 6. Changes to zyncount-be / zyncount-admin

Most work is in `zyncount-pos`. Upstream changes are deliberately small.

**zyncount-be:**
- [ ] Make `TenantConfigService` tolerant of missing `mongodb_master_url` (already warns & continues — confirm no downstream code assumes loaded config).
- [ ] Add `syncedAt` field to `BaseSchema` behind a config flag (phase 3).
- [ ] Add a `/health` REST endpoint for spawn orchestrator health-check.

**zyncount-admin:**
- [ ] Absorb the MabizPOS renderer into `src/modules/cashier/` (phase 2).
- [ ] Add "Offline" indicator to header (phase 3).
- [ ] Read a runtime config flag (e.g. `NEXT_PUBLIC_MODE=desktop`) to hide cloud-only features (tenant switcher, subscription page).

---

## 7. Open questions

Decisions needed before implementation begins:

1. ~~DB choice~~ → **Resolved 2026-04-23: MongoDB Community 7.0** (see §3.2).
2. ~~Distribution channel~~ → **Resolved 2026-04-23: direct download from zyncount.com**. Stores deferred (Mac App Store sandboxing is incompatible with bundled `mongod` anyway).
3. ~~Licensing model~~ → **Resolved 2026-04-23: one-time purchase with online activation.** Flow: shop owner enters activation key on first launch → app validates once against a licensing endpoint → stores signed license payload locally → works offline forever. Key includes `shopId`, `tier`, `issuedAt`, `supportExpiresAt`. Add a small `licensing/` module to zyncount-be exposing the `activateShop(key)` GraphQL mutation; cloud-side issuer lives in zyncount-master (new page: Licenses).
4. ~~Target platforms for v1~~ → **Resolved 2026-04-23: Windows 10/11 and macOS (Intel + Apple Silicon)**. Linux deferred.
5. ~~Target customers for the MVP~~ → **Resolved 2026-04-23: internal pilot (1–3 shops you know).** Implications: installer can be rough, code signing can be deferred to v1.1, auto-update not required for pilot (manual re-install is fine), onboarding can be done in person. Cuts ~40% off packaging polish work. AV signing still recommended even for pilot to avoid scary warnings during the walkthrough.
6. ~~Cashier Mode scope~~ → **Resolved 2026-04-23: redesign to match zyncount-admin styling.** Rebuild the POS UI using `Ap*` components, Tailwind theme tokens, and the same module layout as the rest of zyncount-admin. Adds ~1 week to phase 2 but gives visual consistency across the product and removes the raw AntD dependencies from the current POS renderer.
7. ~~Fate of existing `server/` tsyringe code~~ → **Resolved 2026-04-23: delete entirely.** No production users. Replace with zyncount-be spawned as a child process (§3.3). Approx 5000 lines of custom backend code gone; one backend architecture (NestJS) going forward.

---

## 8. Non-goals (explicit)

To keep scope tight, v1 **does not** include:

- Running on Linux (can be added in v1.1 if a customer asks; mongod Linux binaries are trivial).
- Hot-standby / HA main station (if the main PC dies, use backup).
- Peer-to-peer merging between shops.
- End-to-end encryption of LAN traffic (TLS on :3060/:4060 is phase 2).
- A browser-accessible shop instance (e.g. remote admin from owner's phone over WAN).
- Importing from the old MabizPOS custom schemas (there's no prod data to migrate).
