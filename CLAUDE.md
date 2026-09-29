# MabizPOS — Claude Instructions

Electron desktop shell that packages [zyncount-be](../zyncount-be) and [zyncount-admin](../zyncount-admin) into a single installable app. **No application code lives here** — the backend and admin UI live in their sibling repos and are copied into `resources/` at build time by `build/copy-sources.js`.

## Canonical architecture doc

Read [docs/superpowers/specs/2026-04-23-standalone-lan-architecture-design.md](docs/superpowers/specs/2026-04-23-standalone-lan-architecture-design.md) for the full design: main vs station modes, spawn-based orchestration, LAN topology, licensing, etc.

## What lives in this repo

- `main/background.ts` — Electron main process; spawns zyncount-be and zyncount-admin, opens the window.
- `main/preload.ts` — minimal stub (no IPC currently used). Extend when we add Electron-native integrations (printer, cash drawer).
- `renderer/` — fallback stub page shown only if admin server fails to start. Does **not** host the POS UI — that's in zyncount-admin.
- `build/copy-sources.js` — builds the sibling repos and copies their dist into `resources/`.
- `resources/` — gitignored; populated by the copy script at build time.
- `docs/superpowers/specs/` — design specs.
- `docs/superpowers/plans/` — implementation plans.

## What does NOT live here

- Any business logic — that's in `zyncount-be`.
- Any UI code for shop owners / cashiers — that's in `zyncount-admin` (especially `src/modules/pos/`).
- MongoDB — installed separately by the shop owner via the official MongoDB installer.

## Rules

- Do not add domain logic (invoices, items, orders) to this repo. Add it in `zyncount-be`.
- Do not add POS UI components here. Add them in `zyncount-admin/src/modules/pos/` or elsewhere in admin.
- Do not bundle native DB binaries (MongoDB) — installer stays light, users install DB via MongoDB's official installer.
- Keep dependencies minimal. If a package would only be used by the renderer stub, reconsider — the stub is just a fallback page.
- Use `npm` only. The `preinstall` hook enforces this.
- Electron main may add native integrations (mDNS, printer, filesystem backup) — that's the legitimate scope for this repo.

## Testing the build locally

```bash
# Prereq: ../zyncount-be and ../zyncount-admin checked out on the desired commit; MongoDB running on 127.0.0.1:27017

npm install
npm run build:copy     # builds siblings and populates resources/
npm run build:mac      # produces .dmg in release/
open release/mac-arm64/MabizPOS.app
```

Watch `Console.app` for `MabizPOS` to see the startup log stream.
