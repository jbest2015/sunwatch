# SunWatch runlog

## 2026-09-27 — initial local build

- Created a local branch from God's Eye View and a GitHub fork at `jbest2015/sunwatch`.
- Built isolated SunWatch app with 81 official branch records, a generated logo, browser-local imports/status notes, and weather overlays.
- Copied only relevant TomTom/NASA keys into ignored local `.env`; no credentials included in Git staging.
- `npm install --ignore-scripts`: installed application dependencies.
- `node --test test.mjs`: 5 passing tests.
- Node syntax and Git whitespace checks passed.
- Docker Desktop initially stopped; started the installed application and waited for its Linux engine to become available.
- Local Docker compose build/start passed. No unrelated containers restarted.
- 12 endpoint smoke checks passed against the container on 127.0.0.1:4181.
- Desktop/mobile browser and import/status/persistence verification passed. Temporary test location removed.
- Deployment blocked: documented `aech1_sammy` SSH key absent here; existing key rejected by Aech. Public DNS initially did not resolve but subsequently propagated: `sunwatch.johnbest.ai` and Aech's hostname both resolve to `64.111.21.67`.
- Final container health: healthy; UID 1000; key file absent from image; license present.

See `../VALIDATION.md` and `../../DEPLOY.sunwatch.md` for checks and continuation steps.

## 2026-09-27 — deployment handoff and owner-approved data keys

- Expanded the deployment memo with connection, network discovery, configuration, launch, HTTPS/browser verification, rollback and remaining product boundaries.
- Owner explicitly requested publishing the TomTom and NASA data keys in GitHub. Added only those two keys to `sunwatch/.env.deploy`, with a narrow Git ignore exception. Runtime environment files and unrelated credentials remain excluded; Docker still excludes all `.env.*` files.
- Updated the startup instructions to copy the published deployment configuration. This does not deploy to Aech; the owner will continue from a machine with SSH access.
# September 27, 2026 — God's Eye portal correction

Owner rejected the separate Leaflet dashboard and requested the original God's Eye experience centered on Suncoast. Replaced the served frontend with the original Cesium globe, added a tactical SunWatch logo and branch/ATM portal, preserved live-layer/navigation controls, and disabled voice/AI setup. Added 88 official ATM directory records (75 estimated coordinates, 13 needing review) to the existing 81 branches. Nearby filtering, branch/ATM camera jumps, local notes and imports are integrated into the globe.

Build and focused tests pass; Docker container is healthy and all 12 endpoint smoke checks pass. Satellite globe imagery, logo, traffic, branch/ATM navigation, nearby filtering and point weather were checked in the browser. Photorealistic mode remains slow on this machine; satellite is the default. See VALIDATION.md for limits.

Updated deployment memo and public data-key config (now including the Cesium browser token, per owner authorization). Deploy latest sunwatch branch, not the earlier b90a0de Leaflet build. Aech still requires deployment from the user's other machine; no remote changes made here.
