# SunWatch deployment memo

Prepared September 27, 2026 for deployment from a machine with Aech SSH access.

| Item | Value |
| --- | --- |
| Public URL | https://sunwatch.johnbest.ai |
| Repository | https://github.com/jbest2015/sunwatch |
| Branch | `sunwatch` (default branch) |
| Server | `port.jsbjr.digital` (Aech), deployed as `claude` (docker group) |
| Deployed directory | `/home/claude/sunwatch` (`/home/sammy` is not writable by `claude`) |
| Status | **God's Eye globe rebuild (`6287c1a`) deployed to Aech September 27, 2026** — see [Deployment record](#deployment-record) |

## Ready to deploy

Deploy the latest `sunwatch` branch. This rebuild supersedes the Leaflet prototype at `b90a0de`: SunWatch now runs the original God's Eye Cesium globe with tactical branding, live aircraft/traffic/environmental layers and a Suncoast location panel. It includes 81 branches and 88 ATM records; 75 ATMs have estimated coordinates and 13 need address review. See [validation](sunwatch/VALIDATION.md) for current checks and remaining limitations.

DNS resolves both `sunwatch.johnbest.ai` and `port.jsbjr.digital` to `64.111.21.67`. The documented `aech1_sammy` key was absent on both the Windows and Mac deployment machines; the Mac's existing `~/.ssh/config` entry for Aech (user `claude`, docker group) was used instead, at the owner's direction.

## 1. Connect and inspect Aech

The Obsidian vault's `Resources/Skills/aech-server/SKILL.md` identifies this connection:

```bash
ssh -i ~/.ssh/aech1_sammy sammy@port.jsbjr.digital
```

Keep normal SSH host-key verification. On Aech, run its documented health check first:

```bash
~/scripts/healthcheck.sh
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
docker compose version
```

If Aech uses standalone Compose, substitute `docker-compose` below and verify that version supports the configuration. Do not upgrade shared infrastructure or restart unrelated services for this deployment.

## 2. Find the existing proxy network

The vault identifies `nextcloud3-proxy` and `nextcloud3-letsencrypt` as the reverse proxy and certificate companion. Confirm the names against `docker ps`, then inspect their networks:

```bash
docker inspect nextcloud3-proxy --format '{{json .NetworkSettings.Networks}}'
docker inspect nextcloud3-letsencrypt --format '{{json .NetworkSettings.Networks}}'
```

Use the existing network through which the proxy reaches hosted applications. If multiple networks exist, inspect a working neighboring application to establish the convention. Check whether the certificate companion requires a per-app `LETSENCRYPT_EMAIL`; if so, add the owner's existing certificate contact to the SunWatch service environment. Do not invent a network/email or change the shared proxy.

## 3. Clone and configure

For a fresh deployment:

```bash
cd /home/claude
git clone --branch sunwatch --single-branch https://github.com/jbest2015/sunwatch.git sunwatch
cd /home/claude/sunwatch
git rev-parse HEAD
umask 077
cp sunwatch/.env.deploy sunwatch/.env
touch .env
chmod 600 .env sunwatch/.env
${EDITOR:-nano} .env
```

If the directory already exists, inspect its remote, branch and local changes first. Do not overwrite configuration or discard edits. Use a fast-forward-only pull when appropriate.

Set the **root** `.env` to the actual network name:

```dotenv
AECH_PROXY_NETWORK=REPLACE_WITH_VERIFIED_EXISTING_PROXY_NETWORK
```

There are two configuration files: root `.env` supplies the Compose network; `sunwatch/.env` supplies application settings. The checked-in [sunwatch/.env.deploy](sunwatch/.env.deploy) contains TomTom, NASA FIRMS and the Cesium browser token **at the owner's explicit request**. These keys are publicly usable against the owner's quotas. No SSH, GitHub, direct Google, AI, voice or AIS credentials are included. For an existing checkout, add `CESIUM_ION_TOKEN` from the deployment config to the existing application environment without overwriting other settings.

The runtime `.env` files remain ignored. The published deployment config is excluded from the container image and from the app's static web directory; it is public through GitHub. Provider-side limits are the appropriate place to enforce account-wide usage caps.

## 4. Build and launch only SunWatch

```bash
cd /home/claude/sunwatch
docker compose -p sunwatch -f compose.sunwatch.yml config --quiet
docker compose -p sunwatch -f compose.sunwatch.yml up --build -d
docker compose -p sunwatch -f compose.sunwatch.yml ps
docker compose -p sunwatch -f compose.sunwatch.yml logs --tail=80 sunwatch
```

The Dockerfile already passed local testing. The production Compose file exposes 4180 only inside the existing proxy network; it does not publish another host port. Its `VIRTUAL_HOST`, `VIRTUAL_PORT` and `LETSENCRYPT_HOST` settings target this domain. The existing proxy/certificate companion should handle HTTPS.

The multi-stage image builds the root Vite/Cesium frontend into `sunwatch/dist`, then serves it through `sunwatch/server.mjs`. The container uses Node 24 Alpine, runs unprivileged, and has a read-only filesystem, 1 GB memory limit, capped logs and health check. Its named `sunwatch-cache` volume permits persistent provider caches and traffic budget counters under `/app/sunwatch/.gev-cache`. Do not remove that volume during routine upgrades. Aech's Docker/kernel compatibility remains unverified.

## 5. Verify the container and public site

```bash
sunwatch_cid=$(docker compose -p sunwatch -f compose.sunwatch.yml ps -q sunwatch)
docker inspect "$sunwatch_cid" --format '{{.State.Health.Status}}'
docker compose -p sunwatch -f compose.sunwatch.yml exec -T sunwatch node -e \
  "fetch('http://127.0.0.1:4180/api/health').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"
```

The health state starts at `starting`; allow the check to run and confirm `healthy`. From the deployment machine, verify public routing and the trusted HTTPS certificate without bypassing TLS verification:

```bash
curl --fail --show-error https://sunwatch.johnbest.ai/api/health
curl --silent --output /dev/null --write-out '%{http_code}\n' https://sunwatch.johnbest.ai/.env
curl --silent --output /dev/null --write-out '%{http_code}\n' https://sunwatch.johnbest.ai/sunwatch/.env
```

Expected: health JSON with `ok: true`, then two `404` responses. If internal health works but the public URL fails, inspect DNS/proxy/certificate routing before rebuilding the app.

Open the public site and verify:

- The tactical SunWatch logo and 3D globe load, with 81 branches / 88 ATMs. Selecting a mapped branch or ATM flies to it without clearing active layers.
- Traffic and aircraft render around the selected location. Traffic dots illustrate measured flow, not individually tracked cars. Test Nearby and the street/surroundings/airspace camera buttons.
- Point forecasts and alert responses load; radar, hurricane and fire toggles show timestamps and clear errors when providers fail. Counts change over time.
- Address lookup returns candidates. Satellite and street-label map modes work; test optional photorealistic 3D separately on the demo machine. The globe uses client-side WebGL, so a faster server alone does not fix slow rendering.
- A temporary imported location and test note survive reload; remove the test location afterward.
- Mobile layout works and there are no unexpected browser console errors.

## 6. Rollback and record the result

If this first launch fails verification, stop only SunWatch while investigating:

```bash
docker compose -p sunwatch -f compose.sunwatch.yml stop sunwatch
```

Do not stop the proxy, certificate companion or neighboring applications. Do not run a global Docker prune. Before future upgrades, record the deployed commit and image ID and retain/tag the working image alongside its matching Compose configuration. Roll back using that retained image/configuration and recreate only SunWatch.

After a successful deployment, update this memo and [runlog](sunwatch/memory-bank/runlog.md) with the deployment time, commit, image ID, actual proxy network, URL and verification results, then commit/push the handoff update.

## Deployment record

### Current: God's Eye globe rebuild — `6287c1a`

Deployed **2026-09-27 22:40 UTC** from John's Mac as `claude@port.jsbjr.digital`, replacing the `b90a0de` Leaflet build in place (same directory, project, domain and network).

| Item | Value |
| --- | --- |
| Commit | `6287c1a1f7d5d18087c428c0e7134ee02e4d95a0` (`sunwatch` branch) |
| Directory | `/home/claude/sunwatch` (`git pull --ff-only` from `2f6e415`) |
| Configuration | Appended `CESIUM_ION_TOKEN` from `sunwatch/.env.deploy` to the existing `sunwatch/.env` (mode 600); root `.env` unchanged (`AECH_PROXY_NETWORK=nextcloud_network`) |
| Image | `sunwatch-sunwatch:latest` = `sha256:50d36b9949394877168fd26e771f07271ddf91fe53d9177c187f4893f9c8b55d` (437 MB), also tagged `sunwatch-sunwatch:6287c1a` |
| Rollback image | `sunwatch-sunwatch:b90a0de` (`sha256:8029780ad2ad…`, Leaflet build) retained |
| Container | `sunwatch-sunwatch-1`, healthy, 0 restarts, ~265 MiB of 1 GiB after layers loaded |
| Volume | `sunwatch_sunwatch-cache` → `/app/sunwatch/.gev-cache` (created on this deploy) |
| Network / TLS | `nextcloud_network`; existing Let's Encrypt certificate reused |

Build used standalone `docker-compose build`, then `up -d --no-build`, so the old container served traffic until the swap. Proxy `nginx -t` passed afterward; neighbor sites responded normally.

Verification (public URL, normal TLS verification):

- `/api/health`, `/runtime-config.js`, `/api/locations`, `/api/branches`, `/api/alerts`, `/api/forecast`, `/api/weather/manifest?product=radar`, `/api/cyclones`, `/api/fires`, `/api/geocode` all `200`. `/api/locations`: 169 records (81 branches, 88 ATMs; 156 mapped). `/.env`, `/sunwatch/.env`, `/sunwatch/.env.deploy`, `/.gev-cache/` all `404`. The runtime config exposes only the Cesium browser token, as intended.
- Headless Chrome with WebGL (desktop 1600×1000): Cesium globe, tactical SunWatch logo, "81 BRANCHES / 88 ATMs", 169 list rows. Aircraft enabled by default and reported 200 records; street traffic rendered on roads. Charlotte Harbor search → fly-to; Street Area view shows the branch marker with traffic; point forecast and NWS alerts loaded. Nearby (10 km) returned 7 locations. Address lookup added a test location; it and a test note survived reload, then both were removed. Radar, hurricanes, wind, cameras and fire detections all switched ON from the Live Layers panel.
- Mobile 390×844: loads, no horizontal overflow; the location panel overlays much of the globe HUD.
- Console: one expected `404` for `/api/local-receivers/aircraft`. The server deliberately omits the local ADS-B receiver proxy; the client probes it once.

Rollback to the Leaflet build: `cd /home/claude/sunwatch && git checkout b90a0de && docker tag sunwatch-sunwatch:b90a0de sunwatch-sunwatch:latest && docker-compose -p sunwatch -f compose.sunwatch.yml up -d --no-build`. The `sunwatch-cache` volume can stay; the Leaflet build ignores it.

### Previous: Leaflet prototype — `b90a0de`

Deployed **2026-09-27 20:21 UTC** from John's Mac. Superseded by `6287c1a` at 22:40 UTC.

| Item | Value |
| --- | --- |
| Commit | `b90a0def1d5e564b7b6ac88786b0e0b5c81a9c2b` (`sunwatch` branch) |
| Directory | `/home/claude/sunwatch` on Aech |
| Compose | standalone `docker-compose` v2.20.3 (Aech has no `docker compose` plugin): `docker-compose -p sunwatch -f compose.sunwatch.yml ...` |
| Image | `sunwatch-sunwatch:latest` = `sha256:8029780ad2ad9e411f480df8696fd77dbdca521ba969c47d442c4dd809cc1581` (180 MB); retained as rollback tag `sunwatch-sunwatch:b90a0de` |
| Container | `sunwatch-sunwatch-1`, healthy, 0 restarts |
| Proxy network | `nextcloud_network` (shared by `nextcloud3-proxy` and `nextcloud3-letsencrypt`; same convention as `five-demo-prod`). Root `.env`: `AECH_PROXY_NETWORK=nextcloud_network` |
| Certificate | Let's Encrypt (YR2) for `sunwatch.johnbest.ai`, issued automatically by `nextcloud3-letsencrypt` at 20:22 UTC, valid to 2026-12-26. No per-app `LETSENCRYPT_EMAIL` needed (companion has no email configured; neighbors issue without one) |
| URL | https://sunwatch.johnbest.ai |

Pre-deploy health check: `WARNING` (32 warnings), all pre-existing: `/` at 83%, 29 long-exited containers, 6 zombie processes. RAM 59%, load 1.8/16 CPUs. The health script lives at `/home/sammy/scripts/healthcheck.sh` (readable by `claude`). No shared infrastructure was changed or restarted; proxy config test passed afterward and neighbor sites responded normally.

Verification (all passed):

- Container health `healthy`; in-container `/api/health` returned `{"ok":true,"app":"SunWatch","version":"0.1.0"}`.
- Public `https://sunwatch.johnbest.ai/api/health` passed with normal TLS verification; HTTP redirects 301 to HTTPS. `/.env`, `/sunwatch/.env`, `/sunwatch/.env.deploy` all `404`.
- Public API: `/api/branches` 81 records, 81 unique IDs, none missing coordinates; `/api/alerts` (statewide and point), `/api/forecast`, `/api/weather/manifest?product=radar`, `/api/cyclones`, `/api/fires`, `/api/geocode` all `200`. TomTom returned "3801 Tamiami Trail, Port Charlotte, FL 33952".
- Headless Chrome against the public site (desktop 1440×900 and mobile 390×844): logo loads; 81 locations / 20 counties / 12 NWS alerts; Charlotte Harbor search → selection zooms to 23141 Harbor View Road with NWS forecast and point alerts. Address lookup added a temporary location; it and a test status note survived reload; both removed afterward. Radar (MRMS observed 4:16 PM EDT), hurricanes (5 active NHC systems), fires (169 FIRMS detections) and the Esri satellite basemap all loaded with timestamps. No console errors; no horizontal overflow on mobile. The only failed requests were OpenStreetMap tiles aborted by Leaflet during zoom animation (expected).

Rollback / upgrade: `cd /home/claude/sunwatch`, then for a new commit `git pull --ff-only && docker tag sunwatch-sunwatch:latest sunwatch-sunwatch:<old-commit> && docker-compose -p sunwatch -f compose.sunwatch.yml up --build -d`. To roll back, `git checkout <old-commit>`, `docker tag sunwatch-sunwatch:<old-commit> sunwatch-sunwatch:latest`, then `docker-compose -p sunwatch -f compose.sunwatch.yml up -d --no-build`.

## Product boundaries for the October demo

This is an independent preview, not an official Suncoast operations system. Published hours are not confirmation of storm opening status. Every branch starts at **Unknown**; weather data never sets a branch to Open or Closed.

Imports and status notes live in **each browser**, not a shared server database. Local-preview data does not automatically migrate to the public hostname. JSON exports include notes, but the importer currently restores locations only. Shared status, authentication, audit history and internal operational integrations remain future work.

Address lookup sends addresses to TomTom through the backend. App limits are 20 requests/minute and 500 requests/UTC day per running process; restarts reset those counters, and requests using the published key directly bypass app limits. No paid AI, voice or direct Google billing is enabled. Photorealistic tiles use the existing Cesium ion asset access; service quotas and applicable account terms still apply. Public camera coverage varies; ALPR markers represent locations, not camera access. The optional noncommercial submarine-cable dataset is not included.

