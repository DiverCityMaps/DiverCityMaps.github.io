**`utils.js`** — funzioni matematiche pure, nessuna dipendenza
- `haversineDistance` — distanza tra due coordinate
- `parseMaxSpeed` — parsing del tag OSM maxspeed con codici nazionali
- `simplifyCoords` — semplificazione geometria edge (algoritmo di Ramer-Douglas-Peucker)
- `debugNetworkSize` — log dimensioni grafo

---

**`graph.js`** — costruzione e manipolazione del grafo
- `buildGraph` — costruisce il grafo da GeoJSON
- `deepCopyGraph` — copia il grafo applicando il moltiplicatore di velocità degli attrattori
- `transformOSMDataToRoadsData` — converte dati OSM raw in GeoJSON semplificato

---

**`osm.js`** — download rete stradale e geocoding
- `buildOverpassQuery` — costruisce la query Overpass
- `fetchOverpass` — esegue la richiesta POST a Overpass
- `downloadRoadNetwork` — download da bbox
- `downloadRoadNetworkByRadius` — download da centro + raggio
- `searchCity` — geocoding via Photon/Komoot

---

**`routing.js`** — algoritmi di routing e metriche
- `dijkstra` — algoritmo di Dijkstra ottimizzato
- `computeKAlternativePaths` — path penalization per k alternative
- `filterNearShortest` / `filterNoNearShortest` — filtra NSR
- `weightedJaccardSimilarity` / `jaccardPairwiseWeighted` — similarità pesata tra route
- `computeDiverCity` — calcola PRD score
- `logDiverCity` — log del PRD score

---

**`ui.js`** — componenti interfaccia utente
- `createInfoBox` — box con info route e PRD score
- `createSliders` — pannello Route Settings con tutti gli slider
- `addAboutPanel` — bottone + modal About the measure
- `addLegend` — legenda mappa
- `addScaleControl` — scala
- `showMapLoader` / `hideMapLoader` — overlay di loading

---

**`map_controls.js`** — controlli mappa ed event handlers
- `styleRoads` / `filterLineString` — stile e filtro layer strade
- `updateLayerControl` / `initializeLayers` / `initializeGraphNetwork` — gestione layer
- `ensureCustomPanes` — creazione panes Leaflet
- `findClosestNode` — nodo più vicino al click
- `highlightNodes` — marker origin/destination con drag
- `drawPathsNSPAggr` — disegna le route calcolate sulla mappa
- `handleMapClick` / `handleAreaSelection` — gestione click mappa e selezione bbox
- `addDrawControl` — pannello "Load a new city" con search e draw
- `getAttractorStatus` — identifica attrattori

---

**`divercity.js`** — entry point
- Variabili globali (`map`, `graph`, `nodes`, `k`, `p`, `epsilon`, ecc.)
- `initializeMap` / `initializeControls` / `initializeEventListeners`
- `computeAndDrawPaths` — calcola e disegna le route
- `resetRoute` — resetta tutto
- `updateRoutesOnParameterChange` — ricalcola quando cambiano i parametri