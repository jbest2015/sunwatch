# SunWatch deployment memo

Prepared September 27, 2026 for deployment from a machine with Aech SSH access.

| Item | Value |
| --- | --- |
| Public URL | https://sunwatch.johnbest.ai |
| Repository | https://github.com/jbest2015/sunwatch |
| Branch | `sunwatch` (default branch) |
| Server | `sammy@port.jsbjr.digital` |
| Expected directory | `/home/sammy/sunwatch` |
| Status | Tested locally; **not deployed to Aech yet** |

## Ready to deploy

The app includes 81 official Suncoast branch records, the SunWatch logo, address lookup/import, branch selection, browser-local status notes, and NWS/NOAA/NHC/NASA weather overlays. Five unit tests, twelve container endpoint checks, desktop/mobile browser checks and import/persistence checks passed. See [validation](sunwatch/VALIDATION.md).

DNS resolved both `sunwatch.johnbest.ai` and `port.jsbjr.digital` to `64.111.21.67` at the final September 27 check. Recheck before certificate issuance. This Windows machine lacked the documented SSH key; no Aech deployment or server changes were performed.

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
cd /home/sammy
git clone --branch sunwatch --single-branch https://github.com/jbest2015/sunwatch.git sunwatch
cd /home/sammy/sunwatch
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

There are two configuration files: root `.env` supplies the Compose network; `sunwatch/.env` supplies the application settings. The checked-in [sunwatch/.env.deploy](sunwatch/.env.deploy) contains the TomTom and NASA FIRMS keys **at the owner's explicit request**. Copying it as above configures both integrations. These keys are publicly available and can be used against the owner's service quotas. No SSH, GitHub, Cesium, Google, AI, voice or AIS credentials are included.

The runtime `.env` files remain ignored. The published deployment config is excluded from the container image and from the app's static web directory; it is public through GitHub. Provider-side limits are the appropriate place to enforce account-wide usage caps.

## 4. Build and launch only SunWatch

```bash
cd /home/sammy/sunwatch
docker compose -p sunwatch -f compose.sunwatch.yml config --quiet
docker compose -p sunwatch -f compose.sunwatch.yml up --build -d
docker compose -p sunwatch -f compose.sunwatch.yml ps
docker compose -p sunwatch -f compose.sunwatch.yml logs --tail=80 sunwatch
```

The Dockerfile already passed local testing. The production Compose file exposes 4180 only inside the existing proxy network; it does not publish another host port. Its `VIRTUAL_HOST`, `VIRTUAL_PORT` and `LETSENCRYPT_HOST` settings target this domain. The existing proxy/certificate companion should handle HTTPS.

The container uses Node 24 Alpine, runs unprivileged, and has a read-only filesystem, memory limit, capped logs and health check. Aech's actual Docker/kernel compatibility remains unverified. If startup fails, inspect the error before changing host settings.

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

- Logo and 81 branches load; searching/selecting Charlotte Harbor zooms to its address.
- Point forecasts and alert responses load; radar, hurricane and fire toggles show timestamps and clear errors when providers fail. Counts change over time.
- Address lookup returns candidates. Satellite and street basemaps work.
- A temporary imported location and test note survive reload; remove the test location afterward.
- Mobile layout works and there are no unexpected browser console errors.

## 6. Rollback and record the result

If this first launch fails verification, stop only SunWatch while investigating:

```bash
docker compose -p sunwatch -f compose.sunwatch.yml stop sunwatch
```

Do not stop the proxy, certificate companion or neighboring applications. Do not run a global Docker prune. Before future upgrades, record the deployed commit and image ID and retain/tag the working image alongside its matching Compose configuration. Roll back using that retained image/configuration and recreate only SunWatch.

After a successful deployment, update this memo and [runlog](sunwatch/memory-bank/runlog.md) with the deployment time, commit, image ID, actual proxy network, URL and verification results, then commit/push the handoff update.

## Product boundaries for the October demo

This is an independent preview, not an official Suncoast operations system. Published hours are not confirmation of storm opening status. Every branch starts at **Unknown**; weather data never sets a branch to Open or Closed.

Imports and status notes live in **each browser**, not a shared server database. Local-preview data does not automatically migrate to the public hostname. JSON exports include notes, but the importer currently restores locations only. Shared status, authentication, audit history and internal operational integrations remain future work.

Address lookup sends addresses to TomTom through the backend. App limits are 20 requests/minute and 500 requests/UTC day per running process; restarts reset those counters, and requests using the published key directly bypass app limits. No paid AI, voice or direct Google billing is enabled.
