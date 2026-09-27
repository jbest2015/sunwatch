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
- Deployment blocked: documented `aech1_sammy` SSH key absent here; existing key rejected by Aech. Public `sunwatch.johnbest.ai` DNS did not resolve from 1.1.1.1 during checks.

See `../VALIDATION.md` and `../../DEPLOY.sunwatch.md` for checks and continuation steps.
