# Validation — September 27, 2026

Local Node 24 and Docker Desktop Linux-engine checks completed.

- `node --test test.mjs`: 5 tests passed. Covers invalid/blank coordinates, untrusted-text escaping, status filters, polygon holes, and 81 valid unique source locations.
- Node syntax checks and `git diff --check`: passed.
- `docker compose -p sunwatch-local -f compose.sunwatch.local.yml up --build -d`: built and started successfully.
- Docker HTTP smoke checks: 12/12 passed. Health, 81 branches, NWS statewide alerts, branch-specific forecast, NHC cyclones, NOAA radar manifest, NASA heat detections, TomTom geocoding, invalid-coordinate rejection, unknown API routes, and protection of both `/.env` and `/sunwatch/.env`.
- Dependency audit during container build: 0 reported vulnerabilities.
- Browser: desktop and 390 × 844 mobile layout inspected. No horizontal overflow at the mobile viewport. No browser errors observed during the tested overlay flow.
- Browser: selected Charlotte Harbor and verified address, published hours, current NWS point alert response and forecast periods.
- Browser: loaded radar, hurricane and fire overlays; retrieved source timestamps and heat-detection markers.
- Browser: imported a temporary JSON location, saved a Limited service status with a test note, reloaded and verified persistence, then removed the temporary record. Seed network restored to 81.
- Docker-served browser: 81 locations, search, click-to-zoom and forecast details worked.

Feed values during the checks included 12 Florida NWS alerts, 5 active NHC/CPHC storms, and 166 trailing-day heat detections in the configured region. These are observations from the test time, not fixed expected values.

Final container checks: healthy, unprivileged UID 1000, no `.env` file baked into the image, upstream license present. DNS now resolves `sunwatch.johnbest.ai` to `64.111.21.67`, matching Aech's hostname.

Not complete: Aech SSH access, production container/network inspection, HTTPS issuance and public-host smoke checks. Shared cross-device status persistence is outside this preview implementation.
