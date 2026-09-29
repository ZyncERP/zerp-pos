# MabizPOS

Electron desktop shell that packages [zyncount-be](../zyncount-be) and [zyncount-admin](../zyncount-admin) into a single installable app for shop owners. LAN-first, offline-capable; cloud sync is a future phase.

This project contains **only** the Electron shell, the build-time copy script, and the electron-builder packaging config. The backend and admin UI live in their sibling repos and are copied into `resources/` at build time.

## Architecture

See [docs/superpowers/specs/2026-04-23-standalone-lan-architecture-design.md](docs/superpowers/specs/2026-04-23-standalone-lan-architecture-design.md) for the full design.

## Prerequisites

- Node 18+
- `npm` only (pnpm/yarn forbidden via the `preinstall` hook)
- `../zyncount-be` and `../zyncount-admin` checked out as siblings, both on the commit you want to ship
- MongoDB Community installed and running on `127.0.0.1:27017` on the target machine (users install it themselves via the official MongoDB installer — it is *not* bundled in MabizPOS)

## Build

```bash
# Dry run — builds siblings and copies their output into resources/, no packaging
npm run build:copy

# Full build for the current platform
npm run build        # whatever host you're on
npm run build:mac    # macOS dmg (Intel + Apple Silicon)
npm run build:win    # Windows NSIS installer
```

Output lands in `release/`.

## Runtime

On launch MabizPOS:
1. spawns `node resources/be/dist/main.js` (zyncount-be) on `127.0.0.1:4060`
2. spawns `node resources/admin/server.js` (zyncount-admin) on `127.0.0.1:3060`
3. opens a BrowserWindow pointing at `http://127.0.0.1:3060`

Override ports / Mongo URL via env vars: `MABIZPOS_BE_PORT`, `MABIZPOS_ADMIN_PORT`, `MABIZPOS_MONGO_URL`.
