# Hearth — living-room TV mode

The `home` branch adds a TV dashboard at `/tv` to SunWatch. The God's Eye globe slowly circles north Tampa. Every ~75 s it flies to the worst nearby traffic incident, showing a live FDOT camera snapshot, then returns. Glass panels show time, NWS weather, today/tomorrow from Google Calendar, commute times, countdowns, notes from Claude, and a SITREP ticker written by Ollama. On guest dates it switches to a welcome screen with a Wi‑Fi QR code.

The TV mode only mounts when `HEARTH_DIR` is set, so the public Suncoast deployment (`sunwatch` branch, Aech) is unaffected.

## Where it runs

| Item | Value |
| --- | --- |
| Box | `pop-os` (i7‑6700T, HD 530, 32 GB), Wi‑Fi `trasker` 192.168.5.16, Ethernet .18 |
| Access | `ssh claude@192.168.5.16` (key only, passwordless sudo) |
| Code | `~/sunwatch` on branch `home`; Node 24 at `~/node24` |
| Server | `hearth.service`, binds to **127.0.0.1:4180** only (the API serves the guest Wi‑Fi password) |
| Screen | `hearth-kiosk.service`: `cage` on tty1 runs Chromium `--kiosk` via `~/hearth/bin/kiosk.sh`. The COSMIC greeter is disabled; re-enable with `sudo systemctl disable hearth-kiosk && sudo systemctl enable cosmic-greeter` |
| TV | LG 65SM8600PUA (webOS 4.10) at 192.168.4.44. `~/hearth/bin/tv-power.sh on/off/status`; timers `hearth-tv-on.timer` (06:45) and `hearth-tv-off.timer` (23:30) are enabled after pairing |
| LLM | Ollama on the box. `ollamaModel` in config is a preference list (Kimi cloud first, local `llama3.2:3b` fallback) |

## Private files (on the box only, never in git)

`~/hearth/` (mode 700):

- `secrets.env`: `CAL_ICS_URL` (Google secret iCal), `GUEST_SSID`, `GUEST_WIFI_PASS`, `LGTV_IP`, `LGTV_MAC`
- `config.json`: home address, destinations, countdowns, guests, `calendarHide` keywords, orbit/rotation timing, model list
- `notes.json`: `{ "updated": "YYYY-MM-DD", "lines": [ ... ] }`, the "From Claude" panel (max 4 lines, hidden in guest mode)

Rules: never put dollar amounts, alarm or door codes on screen. Calendar titles are stripped of amounts, and `calendarHide` removes whole events.

## Updating

```bash
# code
ssh claude@192.168.5.16 'cd ~/sunwatch && git pull -q origin home && sudo systemctl restart hearth'
# the page reloads itself daily at 04:10; force it now:
ssh claude@192.168.5.16 'sudo systemctl restart hearth-kiosk'
# notes / guests / countdowns: edit ~/hearth/*.json (picked up within 60 s, no restart)
```

## Previews

- `/tv/?visit`: fly to the top incident immediately
- `/tv/?guest=Melissa`: render a configured guest's welcome screen regardless of date
- Screenshots: `~/shot/shot.mjs URL out.png waitMs`, run with `sg render -c` (uses the real GPU)

## Provider budget

TomTom (free tier, 2,500/day): routing for 4 destinations every 8 min plus incidents every 3 min comes to ~1,200/day, plus the globe's traffic tiles. NWS, FL511 and Google iCal need no keys.

## Screen mirror (phones, Pi, Chromecast)

`hearth-go2rtc.service` runs go2rtc (`~/hearth/bin/go2rtc`, config `~/hearth/go2rtc.yaml`, API on 127.0.0.1:1984, base path `/mirror`, WebRTC on :8555). The `tv` stream is `exec:~/hearth/bin/mirror.sh`: wf-recorder captures HDMI-A-1, scales to 720p at 10 fps and encodes x264 (software, baseline, capped at 1.5 Mbps, ~1 core) only while someone is watching. The Hearth server proxies `/mirror` behind the same key.

- Watch (WebRTC): `http://192.168.5.16:4180/mirror/stream.html?src=tv&k=KEY`
- MP4 for casting: `http://192.168.5.16:4180/mirror/api/stream.mp4?src=tv&k=KEY`
- The mirror shows exactly what the LG shows, so keep it public-only once private mode exists.
- HD 530 hardware encode (VAAPI) needs HuC firmware (`i915.enable_guc=2`); untested.
- Cast to a Chromecast (Bravia "TV 1" = 192.168.4.33, Nest Hubs .37 kitchen / .52 bedroom): `~/hearth/bin/cast.py IP` (MP4, live); `cast.py IP stop`. HLS fails on the Bravia's old Cast firmware; MP4 capped at ~3 Mbps is stable.
- `~/hearth/bin/display-watchdog.sh` (started from the sway config): when the LG switches inputs, sway can stop getting page flips and all frame consumers freeze. Every 30 s it probes screencopy with grim and power-cycles the output if it hangs (logged as `hearth-watchdog`).
- Kiosk runs sway with `WLR_NO_DIRECT_SCANOUT=1`: with direct scanout, screencopy stalled and froze the mirror. The watchdog now only power-cycles after 3 consecutive failed probes.

## Daily rhythm (added Sept 30)

| Time | What happens |
|---|---|
| 06:34 | Page warms the morning briefing (Ollama) so it's ready |
| 06:44 | `hearth-tv-on.timer` → `tv-power.sh on`: output un-blanked, Wake-on-LAN ×6 to the LG (needs "Turn on via Wi-Fi"), input set if paired |
| 06:45 | "Good morning, John" overlay for 80 s: weather, today's events (on-site ones in amber), leave-by for a calendar trip, AI briefing; camera drifts over the house |
| 40 min before sunrise → 20 min after sunset | normal satellite look; otherwise night-vision (`night.style`, default `surveillance`) |
| 22:00–05:00 | amber HUD; 23:00–05:00 also dimmed |
| 23:30 | `hearth-tv-off.timer` → `tv-power.sh off`: output blanked (flag `~/hearth/.display-off` pauses the watchdog), power-off if paired |

Config keys (`~/hearth/config.json`): `wake.time`, `wake.greetSeconds`, `night.style`, `night.lateAmberHour`, `features.{houseDip,planeTags,storm}`, `storm.{lightningKm,rainKm}`, `onsitePlaces[]` (`match`/`name`/`address`), `tripLookaheadHours`, `tripBufferMin`, `flightBufferMin`.

## Director rotation

Each cycle (`rotate.orbitSeconds`, default 75 s) ends in one visit: worst traffic incident (with FDOT camera), every 4th cycle a dip to the house (HOME marker), every 3rd cycle a radar pass when rain is within `storm.rainKm`. Storm mode (lightning within `storm.lightningKm` ≈ 10 mi, or any NWS *Warning*) overrides everything: radar + lightning layers on, camera pulled back, banner; clears 30 min after the last hit. Plane tags label up to 6 aircraft near the camera target using the flights layer's billboards.

## Endpoints

`/api/hearth/storm` (nowCOAST lightning + radar nearest-pixel around the house), `/api/hearth/brief` (morning briefing), `/api/hearth/commutes` now includes a calendar trip (`featured: true`, `leaveBy`). Previews: `/tv/?greet`, `?storm=test`, `?dip`, `?radar`, `?night=0|1`, `?late`, `?focus=lat,lon`, `?tagradius=km`. Probe runner: `sunwatch/tv-dev/run.mjs`.
