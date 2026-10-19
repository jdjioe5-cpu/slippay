# Maintenance & Automation Scripts

This directory houses operational tools, CI check scripts, and automation runners for SlipPay.

## Inventory

| Script | Purpose | Usage / Command |
| :--- | :--- | :--- |
| `check-root-hygiene.mjs` | Enforces that repository root remains clean of orphan scripts and stray assets | `pnpm check:root-hygiene` or `pnpm lint` |
| `demo-runner.mjs` | Deterministic Playwright-based demo video and audio recording runner | `pnpm demo:record` |
| `policy-checkout-spike-server.mjs` | Local mock spike server for policy checkout development | `pnpm policy-checkout:spike` |
| `autocharge-scheduler.mjs` | Periodic daemon for executing due subscription autocharges | `node scripts/autocharge-scheduler.mjs` |
| `attested-scheduler.mjs` | Periodic runner for integrity-attested subscription charges | `node scripts/attested-scheduler.mjs` |
| `platform-setup.mjs` | Platform setup and deployment utility | `node scripts/platform-setup.mjs` |
| `e2e-*.mjs` / `e2e-*.sh` | End-to-end integration and smoke test fixtures across testnet/mainnet | Invoked by automated CI and testnet smoke verification |
| `deploy-web.sh` | Web bundle deployment helper | Manual / ops deployment |

## Hygiene Standard
- No unreferenced scripts should remain in the project root.
- Retained scripts must be cataloged here and, where applicable, registered in `package.json`.
