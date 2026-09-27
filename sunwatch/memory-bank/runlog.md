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

## 2026-09-27 — deployed to Aech

- `aech1_sammy` key absent on the Mac too; used the Mac's existing SSH config entry for Aech (`claude@port.jsbjr.digital`, docker group) at the owner's direction. Cloned to `/home/claude/sunwatch` because `/home/sammy` is not writable by `claude`.
- Health check before deploy: WARNING, all pre-existing (disk 83%, old exited containers, 6 zombies). Nothing restarted.
- Proxy network verified as `nextcloud_network` (shared by `nextcloud3-proxy` and `nextcloud3-letsencrypt`, used by `five-demo-prod`). Copied `sunwatch/.env.deploy` → `sunwatch/.env`; root `.env` sets `AECH_PROXY_NETWORK=nextcloud_network`; both mode 600.
- Aech has standalone `docker-compose` v2.20.3 only; used it in place of `docker compose`. Build and start succeeded first try; only a harmless "kernel does not support swap limit" notice.
- Deployed commit `b90a0de`, image `sha256:8029780ad2ad…1581`, tagged `sunwatch-sunwatch:b90a0de` for rollback. Container `sunwatch-sunwatch-1` healthy.
- Let's Encrypt certificate issued automatically within a minute; public HTTPS verified with normal TLS checks.
- Verified all 8 public API endpoints, 81 branches, TomTom lookup, NWS/NOAA/NHC/NASA overlays, satellite/street basemaps, import + note persistence (test data removed), and mobile layout via headless Chrome. No console errors.
- Neighbor sites and proxy unaffected (`nginx -t` OK; `fivedemo` 401 is its own basic auth).
- Remaining: status notes and imports are per-browser only; no shared storage, auth or audit trail.


The deployment record above describes the old b90a0de Leaflet build; both histories were retained when merging the Mac update.

## 2026-09-27 — God's Eye globe rebuild deployed to Aech

- Pulled `6287c1a` fast-forward into `/home/claude/sunwatch`. Appended `CESIUM_ION_TOKEN` to the existing `sunwatch/.env`; network config unchanged (`nextcloud_network`).
- Built the multi-stage image first (`docker-compose build`), then swapped with `up -d --no-build`. Image `sha256:50d36b99…b55d`, tagged `sunwatch-sunwatch:6287c1a`. Leaflet image kept as `sunwatch-sunwatch:b90a0de` for rollback. New volume `sunwatch_sunwatch-cache`.
- Container healthy, 0 restarts, ~265 MiB. Proxy config test OK; neighbors unaffected; existing certificate reused.
- Public checks: all API routes 200; 169 locations (81 branches, 88 ATMs, 156 mapped); secret/cache paths 404.
- Headless Chrome + WebGL: globe, logo, aircraft (200), traffic, Charlotte Harbor fly-to and point weather, Nearby, address add/note persistence (test data removed), and all Live Layers toggles ON. Mobile loads with no horizontal overflow.
- Known: one expected 404 probe for the excluded local ADS-B receiver route. CCTV sources are upstream's (Austin, TxDOT, Caltrans, London, etc.); the server log lists no Florida camera feed, so Cameras shows non-Florida feeds. Mobile panel covers much of the globe.

