# Credits and data sources

SFO Flight is built from public data and published aircraft figures. Every raw file is fetched by
`pipelines/data/fetch.mjs`, checksummed into `data/raw/MANIFEST.sha256`, and only the cache is read by the pipelines
(gate F0). The world is re-baked here from the same caches as SFO Approach (Phase 2).

## Elevation, seabed, imagery, tides
- `terrain-3dep.tif` — USGS 3D Elevation Program (3DEP), 6 m resample over the 24 km square, 2 × 2 mosaic. Public domain (US Government work, USGS). https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits
- `bathy-ncei.tif` — NOAA NCEI DEM mosaic (topobathy), 6 m resample, 2 × 2 mosaic. Public domain (US Government work, NOAA NCEI). https://www.ncei.noaa.gov/access/metadata/landing-page/bin/iso?id=gov.noaa.ngdc.mgg.dem:999919
- `naip-bay.tif` — USDA NAIP natural-colour orthoimagery, 6 m resample over the square (ground colour map). Public domain (US Government work, USDA FSA). https://naip-usdaonline.hub.arcgis.com/
- `naip-airport.tif`, `naip-shore.tif` — USDA NAIP, 2 m resample over the building boxes (roof colours). Public domain (US Government work, USDA FSA).
- `noaa-datums-9414523.json` — NOAA CO-OPS tidal datums, Redwood City 9414523 (local MSL = NAVD88 + 0.982 m). Public domain (US Government work, NOAA CO-OPS).
- `ring-3dep.tif` — USGS 3DEP elevation, 30 m over the 120 km low-detail ring (8 × 8 mosaic, pieces cached). Public domain (US Government work, USGS).
- `ring-ncei.tif` — NOAA NCEI DEM mosaic, 30 m over the ring: the water mask. Public domain (US Government work, NOAA NCEI).
- `ring-naip.tif` — USDA NAIP, downsampled to 60 m over the ring, colour-matched to the square's aerial map. Public domain (US Government work, USDA FSA).

## OpenStreetMap (ODbL 1.0, © OpenStreetMap contributors, https://www.openstreetmap.org/copyright)
- `osm-buildings-airport.json`, `osm-buildings-shore.json` — building ways. ODbL 1.0.
- `osm-relations-airport.json`, `osm-relations-shore.json` — multipolygon buildings. ODbL 1.0.
- `osm-airport.json` — SFO aerodrome, runways, taxiways, aprons (the paved mask and the ramp start), the tower. ODbL 1.0.
- `osm-bridge.json` — San Mateo–Hayward Bridge carriageways. ODbL 1.0.

## FAA (via sfo-tower, github.com/icomppower/sfo-tower, pinned)
- NASR (runway ends, displaced thresholds, elevations, ILS, TCH, glide path angles, approach lights, widths). Public domain (FAA).
- Aircraft Characteristics Database (B77W approach speed 149 kt). Public domain (FAA).
- IEM ASOS archive of KSFO METARs 2023–2025 (the METAR picker, `public/flight/metars.json`), as derived by sfo-tower. NWS observations, public domain.

## Aircraft data (fdm/aircraft; every number tagged with its source and VERIFIED / APPROX)
- Cessna Model 172S Pilot's Operating Handbook (1998, Rev 5): dimensions, weights, speeds, stall, take-off, climb and landing performance (facts cited; no text reproduced).
- R. C. Nelson, *Flight Stability and Automatic Control*, App. B: the Navion general-aviation derivatives (after G. L. Teper, STI TR 176-1, 1969) and the Boeing 747 derivatives of NASA CR-2144.
- R. K. Heffley, W. F. Jewell, *Aircraft Handling Qualities Data*, NASA CR-2144 (1972). Public domain (NASA).
- Boeing D6-58329-2, *777-200LR/-300ER Airplane Characteristics for Airport Planning*: dimensions, weights, field-length charts.
- EUROCONTROL Aircraft Performance Database (B77W, C172 pages): climb rate and speeds.
- MIL-F-8785C, *Flying Qualities of Piloted Airplanes* (US DoD, public domain): handling criteria and turbulence model.
- ICAO Annex 10 Vol I: ILS displacement sensitivities. 14 CFR 25.125 / 25.473 / 33.73 (public domain).
- D. P. Raymer, *Aircraft Design: A Conceptual Approach*; B. W. McCormick, *Aerodynamics, Aeronautics and Flight Mechanics*: class values and ground effect.
- Clean-room: no code or data from JSBSim, FlightGear or any other GPL/LGPL flight model was used or opened.

## Models (pipelines/aircraft, Blender 5.2, headless)
- The two aircraft are Phase 3's generic silhouettes built at the published dimensions of the 777-300ER (ACAP) and the C172S (POH). No airline livery or trademark. Cockpit frames are low-poly shells.
- SFO control tower and San Mateo–Hayward Bridge: SFO Approach's landmark scripts (OSM geometry, published heights).

## Software
- Harbor Engine (github.com/icomppower/harbor-engine, MIT) — rendering, water, sky, pipelines, gate runner.
- SFO Tower (github.com/icomppower/sfo-tower, MIT) — FAA NASR and METAR data as derived there.
- Fonts: Inter, JetBrains Mono (Google Fonts, OFL).
