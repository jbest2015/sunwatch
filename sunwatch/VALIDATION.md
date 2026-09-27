# Validation — September 27, 2026

## Current God's Eye globe rebuild

- Production Vite build passed. Expected warnings: runtime configuration is an external classic script; the Cesium application has large chunks.
- 27 focused tests passed across SunWatch location filtering/import validation, traffic navigation and flight records/lifecycle. The earlier combined ALPR/traffic/location run also passed (24 tests).
- Multi-stage Docker build passed after including the provider helper scripts. Container is healthy, with the persistent provider-cache volume and unprivileged runtime.
- All 12 HTTP smoke checks listed below passed again against the rebuilt container. Additional checks returned 169 directory records, 156 mapped records, runtime Cesium configuration and configured TomTom status.
- Browser: tactical logo visible in the original globe HUD. Selected Citrus Park, then a nearby Odessa ATM; both camera jumps and point forecast panels worked. Clearing search and selecting Nearby showed seven locations within 10 km of Citrus Park.
- Browser: aircraft feed reported 200 records; traffic rendered on roads; radar toggle enabled. This is not a comprehensive validation of every upstream layer or every Florida camera feed.
- Screenshot inspection confirmed satellite imagery, road traffic and SunWatch markers inside the tactical globe. Container-served startup showed the logo and 81 branches / 88 ATMs, with satellite mode selected.
- Photorealistic 3D produced sluggish/unresponsive previews on this machine. The default is now satellite imagery on the Cesium globe; photorealistic mode remains optional and needs performance testing on the demo machine. Removed synchronous per-road 3D height picks, reduced detailed aircraft range/cap, and bounded tile cache/frame rate.
- No Aech deployment of this globe rebuild has occurred. The merged Mac deployment record verifies only the earlier b90a0de Leaflet build.

## Earlier Leaflet prototype checks (historical)

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

