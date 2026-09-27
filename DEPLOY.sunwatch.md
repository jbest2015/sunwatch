# SunWatch deployment handoff

Target: `https://sunwatch.johnbest.ai` on Aech. Status: **local preview prepared; production deployment is not complete**.

## Access prerequisites

The owner's Obsidian server skill identifies `sammy@port.jsbjr.digital` and private key `~/.ssh/aech1_sammy`. That key is absent on the current Windows machine, and its existing key was rejected. Use an authorized machine with the documented key, or make the key available through the owner's normal secure process. Do not put private keys in this repository.

The hostname `sunwatch.johnbest.ai` did not resolve through 1.1.1.1 during the September 27 checks. Confirm the A/AAAA records point to Aech before certificate issuance; do not add an AAAA record unless Aech actually serves IPv6. Confirm the server IP from infrastructure records rather than copying an old known-hosts entry.

## Deploy sequence

1. Complete local Docker build and browser smoke tests with `compose.sunwatch.local.yml` and record results in `sunwatch/VALIDATION.md`.
2. SSH using the existing trusted host key. Run `~/scripts/healthcheck.sh` before deployment. Inspect disk, RAM, running containers and occupied ports. Do not restart unrelated services.
3. Inspect the existing `nextcloud3-proxy` network and certificate-companion conventions. Use its existing shared Docker network; do not invent a second proxy or bind ports 80/443.
4. Clone the owner's SunWatch fork into a dedicated `/home/sammy/sunwatch` directory and check out the `sunwatch` branch. Transfer only the required NASA and TomTom keys into `sunwatch/.env` with owner-only file permissions. This local repo has them in its ignored `.env`; GitHub does not.
5. Set `AECH_PROXY_NETWORK` to the verified proxy network, then run `docker compose -f compose.sunwatch.yml up --build -d`. If Aech only supports `docker-compose`, use that command with equivalent arguments.
6. Check container health and logs, internal HTTP health, public HTTPS certificate and hostname, 81 branches, branch selection, source failures, address lookup and overlays. The `.env` path must return 404 publicly.
7. Record deployed commit/image and URL in the project handoff. Retain the previous image/tag for rollback on later releases. Stop only SunWatch if its new deployment fails.

`compose.sunwatch.yml` exposes port 4180 only within the proxy Docker network. The Node process runs unprivileged, with a read-only filesystem, capped memory, limited logs, and an HTTP health check. It adds no public database or server-side location editing.

The app does not send email or enable paid AI/voice services. Its source keys stay on the backend.
