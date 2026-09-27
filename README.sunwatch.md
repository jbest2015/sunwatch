# SunWatch

![SunWatch](sunwatch/public/sunwatch-logo.png)

A lightweight branch-network and hurricane-awareness preview, starting with 81 Suncoast Credit Union locations in 20 Florida counties. Built for John Best's Innovation Club demonstration. This is an independent prototype, not an official Suncoast service or a replacement for emergency-management systems.

## Included

- Search branches by name, city, address or ZIP; filter by county or user-entered status.
- Click a branch to zoom to its address, see published hours and services, and retrieve point-specific NWS alerts and forecasts.
- Toggle NWS alert boundaries, observed NOAA radar, NHC hurricane tracks/cones, NASA satellite heat detections, and satellite imagery.
- Add an address using server-side TomTom geocoding and confirm its match. Import CSV/JSON/GeoJSON coordinates, or review address-only CSV rows one by one.
- Record manual operational status and notes. Export locations and notes as JSON.
- Responsive interface, SunWatch logo, container health check, and server-side API keys.

The first version uses a fast 2D street map. No Google Maps billing, voice, AI subscription, or Cesium token is required. The original God's Eye application remains in this fork for reference; SunWatch runs separately from `sunwatch/`.

## Run

Use Node 24 or newer:

```sh
cd sunwatch
npm ci
cp .env.deploy .env
# Or use .env.example and supply your own optional TomTom/NASA keys.
npm test
npm start
```

Open http://localhost:4180. `HOST=0.0.0.0` allows LAN access if the host firewall permits TCP 4180. Missing optional keys disable only their respective features. NWS alerts/forecasts, NHC tracks, NOAA radar and street maps do not require keys.

Test the same Docker image used in production:

```sh
docker compose -f compose.sunwatch.local.yml up --build -d
# Open http://127.0.0.1:4181 and verify the UI and /api/health.
docker compose -f compose.sunwatch.local.yml down
```

## Data and boundaries

- Seed directory: https://locations.suncoastcreditunion.com, collected September 27, 2026. Branch IDs are public directory IDs, not verified internal branch numbers. Hours are published regular schedules, not confirmed current openings.
- Alerts/forecasts: https://api.weather.gov. Some zone-based alerts do not have polygons. The statewide alert count can exceed the number of visible polygons; selecting a branch makes a point-specific alert request.
- Radar: NOAA nowCOAST MRMS reflectivity, with observation time displayed. It is an observation, not a rain forecast.
- Cyclones: NOAA NHC/CPHC current advisories. Coverage includes Atlantic and eastern/central North Pacific. Track/cone availability is separately reported. Hazards extend beyond the cone; a location outside it is not necessarily safe.
- Heat: NASA FIRMS satellite detections in the bounding box west -88, south 24, east -79, north 32; trailing 24 hours, up to four MODIS/VIIRS feeds. This rectangle includes neighboring regions. Detections may be industrial heat or other sources; these are not fire perimeters or confirmed incidents. Separate sensors may report the same heat source.
- Streets: OpenStreetMap standard tiles, with attribution. Satellite imagery: Esri World Imagery, with attribution. Reassess hosting/usage terms before scaling beyond the small preview; do not bulk-download tiles.

Requests are cached, coalesced and timeout-limited. Stale/partial failures are labeled. Address lookup is limited globally to 20 requests/minute and 500 requests/UTC day per running server process; a restart resets these in-memory limits. Set provider-side limits for a hard account-level cap.

## Persistence and privacy

Imports and operational notes are stored in **this browser's local storage**, not on the server. They are not shared between devices or coworkers. Clearing site data removes them. JSON exports include notes, but the current importer imports locations only; it does not restore operational notes. Coordinates are handled locally. Address lookup sends the address to TomTom through the server. Map requests reveal the viewed area to the map provider.

Every branch starts at **Unknown** operational status. Weather data never sets a branch to Open or Closed. Manual notes carry a timestamp and are labeled user reported. Power, staffing, connectivity, generator status, outages, evacuation-zone classifications, and road closures are not supplied by this prototype. A shared production operations system would need authenticated roles, an audit trail, approved internal data, durable storage and a continuity process.

## Deploy to Aech

See [DEPLOY.sunwatch.md](DEPLOY.sunwatch.md) for the complete Aech handoff. At the owner's explicit request, `sunwatch/.env.deploy` publishes the two TomTom/NASA data-service keys for deployment convenience. They are publicly usable against the owner's quotas. Other credentials and runtime `.env` files remain ignored. The deployment config is excluded from container images. The production image copies only SunWatch and the required MIT-licensed upstream provider modules; it does not bundle God's Eye's optional third-party datasets.

## Credits

Forked from [Bilawal Sidhu's God's Eye View](https://github.com/bilawalsidhu/gods-eye-view), under the existing MIT [LICENSE](LICENSE). SunWatch reuses the upstream cyclone/weather providers and FIRMS CSV parser. Leaflet is BSD-2-Clause; Express and Papa Parse are MIT. Service data and map tiles retain their respective providers' terms.

The SunWatch logo was created with the built-in image generation tool. See `sunwatch/LOGO.md` for its prompt and asset path.
