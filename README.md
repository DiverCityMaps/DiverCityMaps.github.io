# DiverCity Maps

Interactive map to explore the Potential Route Diversification (PRD) of an origin-destination pair on a road network. It computes k alternative paths with cumulative, directed path penalization and scores them with weighted Jaccard similarity.

## Run locally

No build step. Serve the folder over http and open the map app:

```
python -m http.server 8765
```

Then open `http://localhost:8765/leaflet_alternative_routes.html`. Rome loads by default. Other cities are downloaded from Overpass (OpenStreetMap), by search, radius (max 30 km) or drawn area (max 3000 km2).

## Save and open a network

"Save current network" downloads the current road network as a `divercity_*.json` file. "Open network file" loads it back without contacting Overpass. A network opened from a file cannot be shared by link.

## Tests

Standalone Node scripts, no dependencies:

```
node tests/test_routing_core.js
node tests/test_graph_construction.js
node tests/test_network_file.js
```

## Credits

- Road data: OpenStreetMap contributors, via the Overpass API.
- Map: Leaflet, leaflet.draw, osmtogeojson, KDBush.
- Site template: "Stellar" by HTML5 UP (html5up.net), licensed under CC BY 3.0 (see `LICENSE.txt`).
