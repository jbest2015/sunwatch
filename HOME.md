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

`hearth-go2rtc.service` runs go2rtc (`~/hearth/bin/go2rtc`, config `~/hearth/go2rtc.yaml`, API on 127.0.0.1:1984, base path `/mirror`, WebRTC on :8555). The `tv` stream is `exec:~/hearth/bin/mirror.sh`: wf-recorder captures HDMI-A-1 at 15 fps and encodes x264 (software, baseline, ~1 core) only while someone is watching. The Hearth server proxies `/mirror` behind the same key.

- Watch (WebRTC): `http://192.168.5.16:4180/mirror/stream.html?src=tv&k=KEY`
- MP4 for casting: `http://192.168.5.16:4180/mirror/api/stream.mp4?src=tv&k=KEY`
- The mirror shows exactly what the LG shows, so keep it public-only once private mode exists.
- HD 530 hardware encode (VAAPI) needs HuC firmware (`i915.enable_guc=2`); untested.
