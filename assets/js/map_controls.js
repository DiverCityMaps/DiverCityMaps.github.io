// ==========================
// map_controls.js
// Map controls, layers, styling and event handlers
// Depends on: graph.js (buildGraph), osm.js, routing.js, ui.js
// ==========================

function styleRoads(feature) {
    if (feature.properties.is_attractor === 1) {
        let color = "#f0b842";
        if (attractorSpeedMultiplier < 1.0) color = "#c0504a";
        if (attractorSpeedMultiplier > 1.0) color = "#4a9a4a";
        return { color, weight: 2.5 };
    }
    return { color: "#b8b8b8", weight: 0.35 };
}

function filterLineString(feature) {
    return feature.geometry.type === "LineString";
}

function updateLayerControl() {
    document.querySelectorAll('.layer-opt').forEach(o => o.classList.remove('active'));
    const roadsOption = document.getElementById('layer-opt-roads');
    if (roadsOption) roadsOption.classList.add('active');
}

function filterAttractor(feature) {
    return feature.geometry.type === "LineString" && feature.properties.is_attractor === 1;
}

function filterRegularRoad(feature) {
    return feature.geometry.type === "LineString" && feature.properties.is_attractor !== 1;
}

function ensureCustomPanes(map) {
    if (!map.getPane('roads')) {
        map.createPane('roads');
        map.getPane('roads').style.zIndex = 400;
    }
    if (!map.getPane('attractors')) {
        map.createPane('attractors');
        map.getPane('attractors').style.zIndex = 420;
    }
    if (!map.getPane('routes')) {
        map.createPane('routes');
        map.getPane('routes').style.zIndex = 650;
        map.getPane('routes').style.pointerEvents = 'none';
    }
    if (!map.getPane('markers')) {
        map.createPane('markers');
        map.getPane('markers').style.zIndex = 700;
    }
}

// ── Rasterize road network to ImageOverlay ──────────────────
// Draws the GeoJSON network onto an offscreen canvas at high
// resolution, converts to a static image, and replaces the
// vector layers with an ImageOverlay. Routes/markers stay as
// vectors above. This makes zooming fast regardless of network size.

let networkRasterOverlay = null;
let networkRasterBounds  = null;

function rasterizeNetworkToOverlay(roadsData, bounds) {

    const CANVAS_SIZE = 4096;
    const PADDING     = 0.04;

    const south = bounds.getSouth(), north = bounds.getNorth();
    const west  = bounds.getWest(),  east  = bounds.getEast();
    const padLat = (north - south) * PADDING;
    const padLng = (east  - west)  * PADDING;

    const rasterBounds = L.latLngBounds(
        [south - padLat, west  - padLng],
        [north + padLat, east  + padLng]
    );

    networkRasterBounds = bounds;

    const canvas = document.createElement('canvas');
    canvas.width  = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');

    // Transparent background — do NOT fill with any color
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const rW = rasterBounds.getEast()  - rasterBounds.getWest();
    const rH = rasterBounds.getNorth() - rasterBounds.getSouth();

    function toPixel(lat, lng) {
        return [
            ((lng - rasterBounds.getWest())  / rW) * CANVAS_SIZE,
            ((rasterBounds.getNorth() - lat) / rH) * CANVAS_SIZE
        ];
    }

    // Draw ONLY regular roads (not attractors — they stay as vector)
    ctx.strokeStyle = '#a8a8a8';
    ctx.lineWidth   = 1.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    roadsData.features.forEach(f => {
        if (f.geometry.type !== 'LineString') return;
        if (f.properties.is_attractor === 1) return;   // skip attractors
        const coords = f.geometry.coordinates;
        if (!coords || coords.length < 2) return;
        ctx.beginPath();
        const [x0, y0] = toPixel(coords[0][1], coords[0][0]);
        ctx.moveTo(x0, y0);
        for (let i = 1; i < coords.length; i++) {
            const [x, y] = toPixel(coords[i][1], coords[i][0]);
            ctx.lineTo(x, y);
        }
        ctx.stroke();
    });

    // Must use PNG to preserve transparency
    const dataURL = canvas.toDataURL('image/png');

    // Add new overlay before removing old to avoid flicker
    const newOverlay = L.imageOverlay(dataURL, rasterBounds, {
        opacity:     1,
        interactive: false,
        zIndex:      399
    }).addTo(map);

    if (networkRasterOverlay) map.removeLayer(networkRasterOverlay);
    networkRasterOverlay = newOverlay;

    // Remove the temporary regular-road vector layer (keep attractorLayer as vector)
    if (edgeLayer) {
        map.removeLayer(edgeLayer);
        edgeLayer = null;
    }
}

function initializeLayers() {
    ensureCustomPanes(map);
    let bgraph = buildGraph(RoadsData);
    graph = bgraph.graph;
    nodes = bgraph.nodes;

    // Draw vectors temporarily to get bounds, then rasterize
    edgeLayer = L.geoJSON(RoadsData, {
        pane: 'roads',
        style: styleRoads,
        filter: filterRegularRoad,
        interactive: false
    }).addTo(map);

    window.attractorLayer = L.geoJSON(RoadsData, {
        pane: 'attractors',
        style: styleRoads,
        filter: filterAttractor,
        interactive: false
    }).addTo(map);

    // Rasterize after next frame so Leaflet has computed bounds
    const bounds = edgeLayer.getBounds();
    requestAnimationFrame(() => rasterizeNetworkToOverlay(RoadsData, bounds));
}

function initializeGraphNetwork(RoadsData) {
    ensureCustomPanes(map);

    let updatedGraph = buildGraph(RoadsData);
    graph = updatedGraph.graph;
    nodes = updatedGraph.nodes;

    if (typeof cleanGraph === "function") {
        graph = cleanGraph(graph, nodes);
    }

    if (edgeLayer) map.removeLayer(edgeLayer);
    if (window.attractorLayer) map.removeLayer(window.attractorLayer);
    if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);

    // Draw vectors briefly to compute bounds
    edgeLayer = L.geoJSON(RoadsData, {
        pane: 'roads',
        style: styleRoads,
        filter: filterRegularRoad,
        interactive: false
    }).addTo(map);

    window.attractorLayer = L.geoJSON(RoadsData, {
        pane: 'attractors',
        style: styleRoads,
        filter: filterAttractor,
        interactive: false
    }).addTo(map);

    const bounds = edgeLayer.getBounds();
    map.fitBounds(bounds);

    // Rasterize on next frame
    requestAnimationFrame(() => rasterizeNetworkToOverlay(RoadsData, bounds));

    overlayLayers = {};
    updateLayerControl();
}

function findClosestNode(latlng) {
    let minDist = Infinity;
    let closestNode = null;

    for (let nodeId in nodes) {
        if (!graph.hasOwnProperty(nodeId)) continue;
        let nodeCoords = nodes[nodeId];
        if (!nodeCoords) continue;
        let dist = Math.sqrt(
            Math.pow(nodeCoords[1] - latlng.lat, 2) +
            Math.pow(nodeCoords[0] - latlng.lng, 2)
        );
        if (dist < minDist) {
            minDist = dist;
            closestNode = nodeId;
        }
    }
    return closestNode;
}

function highlightNodes() {
    nodeMarkers.forEach(marker => map.removeLayer(marker));
    nodeMarkers = [];

    selectedNodes.forEach((nodeId, index) => {
        const color = index === 0 ? "green" : "red";

        let marker = L.marker([nodes[nodeId][1], nodes[nodeId][0]], {
            pane: 'markers',
            draggable: true,
            icon: L.divIcon({
                className: 'custom-marker',
                html: `<div style="
                    background-color:${color};
                    width:16px; height:16px;
                    border-radius:50%;
                    border:2px solid white;
                    box-shadow:0 0 5px rgba(0,0,0,0.5);">
                </div>`,
                iconSize: [22, 22],
                iconAnchor: [11, 11]
            })
        }).addTo(map);

        nodeMarkers.push(marker);

        marker.on('dragend', function(e) {
            let closestNode = findClosestNode(e.target.getLatLng());
            selectedNodes[index] = closestNode;

            if (selectedNodes.length === 2) {
                let { allPaths, pathCosts } = computeKAlternativePaths(
                    graph, selectedNodes[0], selectedNodes[1], k, p, max_it
                );
                drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon);

                let edgeWeights = {};
                RoadsData.features.forEach(feature => {
                    if (feature.geometry.type === "LineString") {
                        let edge = [feature.properties.start, feature.properties.end];
                        edgeWeights[edge] = feature.properties.length;
                    }
                });

                let { diverCity, numNSP, spatialSpread } = computeDiverCity(
                    allPaths, pathCosts, edgeWeights, epsilon
                );
                updateInfoBox(selectedNodes[0], selectedNodes[1], numNSP, spatialSpread, diverCity);
            }
        });
    });
}

function drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon) {
    pathLayers.forEach(layer => map.removeLayer(layer));
    pathLayers = [];

    const pathCategories = [
        { paths: filterNoNearShortest(allPaths, pathCosts, epsilon), color: "#ef4444" },
        { paths: filterNearShortest(allPaths, pathCosts, epsilon),   color: "#1e3a8a" }
    ];

    let edgeCounts = {};
    pathCategories.forEach(({ paths }) => {
        paths.forEach(pathEdges => {
            pathEdges.forEach(([start, end]) => {
                let key = start < end ? `${start}-${end}` : `${end}-${start}`;
                edgeCounts[key] = (edgeCounts[key] || 0) + 1;
            });
        });
    });

    let maxCount = Math.max(...Object.values(edgeCounts), 1);

    pathCategories.forEach(({ paths, color }) => {
        let geoJsonFeatures = [];
        paths.forEach(pathEdges => {
            pathEdges.forEach(([start, end]) => {
                let key = start < end ? `${start}-${end}` : `${end}-${start}`;
                let weight = 1 + (edgeCounts[key] / maxCount) * 8;
                let edgeGeometry = graph[start]?.find(link => link.node === end)?.geometry;
                if (edgeGeometry) {
                    geoJsonFeatures.push({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: edgeGeometry },
                        properties: { weight }
                    });
                }
            });
        });

        let layer = L.geoJSON(geoJsonFeatures, {
            pane: 'routes',
            style: feature => ({ color, weight: feature.properties.weight })
        }).addTo(map);

        layer.bringToFront();
        pathLayers.push(layer);
    });
}

function handleMapClick(event) {
    if (isComputing) return;
    if (isRouteComputed) resetRoute();

    let closestNode = findClosestNode(event.latlng);
    if (closestNode) {
        selectedNodes.push(closestNode);
        highlightNodes();
    }

    if (selectedNodes.length === 2) {
        isComputing = true;
        updateInfoBoxLoading();
        setTimeout(() => computeAndDrawPaths(), 50);
    }
}

function handleAreaSelection(event) {
    var layer = event.layer;
    var bounds = layer.getBounds();
    var bbox = [
        +bounds.getSouthWest().lat.toFixed(5),
        +bounds.getSouthWest().lng.toFixed(5),
        +bounds.getNorthEast().lat.toFixed(5),
        +bounds.getNorthEast().lng.toFixed(5)
    ];

    resetRoute();
    if (edgeLayer) { map.removeLayer(edgeLayer); edgeLayer = null; }

    currentCity = "Custom area";
    showMapLoader("Downloading road network…");

    downloadRoadNetwork(bbox)
        .then(geojsonData => {
            RoadsData = geojsonData;
            initializeGraphNetwork(RoadsData);
            selectedNodes = [];
            highlightNodes();
            hideMapLoader();
        })
        .catch(error => {
            hideMapLoader();
            console.error("Error fetching road network data:", error);
        });
}

function addDrawControl() {
    let drawnItems = new L.FeatureGroup();
    map.addLayer(drawnItems);

    let drawControl = new L.Control.Draw({
        draw: {
            rectangle: { showArea: true, metric: true },
            polygon: false, polyline: false,
            circle: false, marker: false, circlemarker: false
        },
        edit: false
    });
    map.addControl(drawControl);

    setTimeout(() => {
        L.GeometryUtil.readableArea = function(area) {
            return (area / 1000000).toFixed(2) + ' km²';
        };

        const drawButton = document.querySelector('.leaflet-draw-draw-rectangle');
        if (!drawButton) return;

        // ── Pill & city panel state machine ──────────────────────
        const pill      = document.getElementById('load-city-pill');
        const cityPanel = document.getElementById('city-panel');
        let step = 0;
        let centerMarker = null, radiusCircle = null;

        function openPanel()  {
            cityPanel.classList.add('open');
            pill.classList.add('active');
        }
        function closePanel() {
            cityPanel.classList.remove('open');
            pill.classList.remove('active');
            pill.classList.remove('drawing');
        }

        pill.addEventListener('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (cityPanel.classList.contains('open')) {
                closePanel();
            } else {
                setStep(0);
                openPanel();
            }
        });

        // Close on outside click — but never during draw steps
        document.addEventListener('click', (e) => {
            if (step === 1 || step === 2) return;
            if (!cityPanel.contains(e.target) && e.target !== pill) {
                if (!pill.classList.contains('drawing')) closePanel();
            }
        });

        function handleCitySearch() {
            const query = document.getElementById('city-search-input').value.trim();
            if (!query) return;
            showMapLoader("Searching…");
            searchCity(query)
                .then(({ lat, lng, name }) => {
                    hideMapLoader();
                    openPanel();   // ensure panel is open before switching sub-panel
                    setStep('search', { lat, lng, name });
                })
                .catch(err => {
                    hideMapLoader();
                    showMapLoader("City not found. Try again.", "error");
                });
        }

        function showRoadNetwork() {
            // After rasterization edgeLayer is null — use networkRasterOverlay instead
            if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
            if (networkRasterOverlay && !map.hasLayer(networkRasterOverlay)) map.addLayer(networkRasterOverlay);
            if (window.attractorLayer && !map.hasLayer(window.attractorLayer)) map.addLayer(window.attractorLayer);
        }

        function setStep(s, opts = {}) {
            step = s;

            // Reset sub-panels
            const subRadius = document.getElementById('cp-sub-radius');
            const subDraw   = document.getElementById('cp-sub-draw');
            const subMain   = document.getElementById('cp-sub-main');
            if (subMain)   subMain.style.display   = 'flex';
            if (subRadius) subRadius.style.display = 'none';
            if (subDraw)   subDraw.style.display   = 'none';
            pill.classList.remove('drawing');

            if (s === 0) {
                // default — main search UI visible
            } else if (s === 1) {
                // Draw area — show instructions
                resetRoute();
                if (subMain)  subMain.style.display  = 'none';
                if (subDraw)  subDraw.style.display  = 'flex';
                if (!map.hasLayer(osmLayer)) {
                    if (networkRasterOverlay) map.removeLayer(networkRasterOverlay);
                    if (window.attractorLayer) map.removeLayer(window.attractorLayer);
                    map.addLayer(osmLayer);
                }
            } else if (s === 2) {
                // Active drawing
                map.off('click', handleMapClick);
                closePanel();
                pill.classList.add('drawing');
                pill.querySelector('.pill-label').textContent = 'Drawing…';
                drawButton.click();
            } else if (s === 'search') {
                const { lat, lng, name } = opts;
                let radius = 15;

                resetRoute();

                // Switch to OSM so user can see the city location
                if (!map.hasLayer(osmLayer)) {
                    if (networkRasterOverlay) map.removeLayer(networkRasterOverlay);
                    if (window.attractorLayer) map.removeLayer(window.attractorLayer);
                    map.addLayer(osmLayer);
                }
                map.setView([lat, lng], 11);

                // Clean up previous markers
                if (centerMarker) { map.removeLayer(centerMarker); centerMarker = null; }
                if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }

                centerMarker = L.marker([lat, lng], {
                    draggable: true,
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="
                            width:12px; height:12px;
                            background:#2563eb; border-radius:50%;
                            border:2px solid white;
                            box-shadow:0 0 5px rgba(0,0,0,.4);
                            cursor:grab;">
                        </div>`,
                        iconSize: [12, 12], iconAnchor: [6, 6]
                    })
                }).addTo(map);

                radiusCircle = L.circle([lat, lng], {
                    radius: radius * 1000,
                    color: '#2563eb', fillColor: '#2563eb',
                    fillOpacity: 0.07, weight: 1.5
                }).addTo(map);

                centerMarker.on('drag', (e) => {
                    radiusCircle.setLatLng(e.target.getLatLng());
                });

                // Show radius sub-panel
                if (subMain)   subMain.style.display   = 'none';
                if (subRadius) {
                    subRadius.style.display = 'flex';
                    document.getElementById('cp-city-name').textContent = '📍 ' + name;
                    document.getElementById('cp-radius-val').textContent = radius;
                    document.getElementById('cp-radius-slider').value = radius;
                }

                document.getElementById('cp-radius-slider').oninput = (e) => {
                    radius = parseInt(e.target.value);
                    document.getElementById('cp-radius-val').textContent = radius;
                    radiusCircle.setRadius(radius * 1000);
                };

                document.getElementById('cp-btn-download').onclick = (e) => {
                    L.DomEvent.stopPropagation(e);
                    const pos = centerMarker.getLatLng();
                    map.removeLayer(centerMarker); centerMarker = null;
                    map.removeLayer(radiusCircle); radiusCircle = null;
                    currentCity = name;
                    closePanel();
                    pill.querySelector('.pill-label').textContent = 'Load city';
                    showMapLoader("Downloading road network…");
                    downloadRoadNetworkByRadius(pos.lat, pos.lng, radius)
                        .then(geojsonData => {
                            RoadsData = geojsonData;
                            initializeGraphNetwork(RoadsData);
                            selectedNodes = [];
                            highlightNodes();
                            hideMapLoader();
                        })
                        .catch(error => {
                            hideMapLoader();
                            showMapLoader("Download failed. Try a smaller area.", "error");
                            console.error(error);
                        });
                };

                document.getElementById('cp-btn-cancel-search').onclick = (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (centerMarker) { map.removeLayer(centerMarker); centerMarker = null; }
                    if (radiusCircle) { map.removeLayer(radiusCircle); radiusCircle = null; }
                    // Restore road network view
                    if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
                    showRoadNetwork();
                    setStep(0);
                };
            }
        }

        // Wire up main panel buttons (they exist in HTML)
        document.getElementById('city-search-btn').addEventListener('click', (e) => {
            L.DomEvent.stopPropagation(e);
            handleCitySearch();
        });
        document.getElementById('city-search-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') handleCitySearch();
        });
        L.DomEvent.disableClickPropagation(document.getElementById('city-search-input'));

        document.getElementById('btn-draw-area').addEventListener('click', (e) => {
            L.DomEvent.stopPropagation(e);
            setStep(1);
        });

        // Sub-panel: draw
        document.getElementById('cp-btn-start-draw').addEventListener('click', (e) => {
            L.DomEvent.stopPropagation(e);
            setStep(2);
        });
        document.getElementById('cp-btn-cancel-draw').addEventListener('click', (e) => {
            L.DomEvent.stopPropagation(e);
            if (map.hasLayer(osmLayer) && previousBaseLayer) {
                map.removeLayer(osmLayer);
                map.addLayer(previousBaseLayer);
            }
            setStep(0);
            openPanel();
        });

        map.on('draw:created', () => { map.on('click', handleMapClick); setStep(0); closePanel(); });
        map.on('draw:drawstop', () => {
            map.on('click', handleMapClick);
            if (step === 2) { setStep(0); pill.querySelector('.pill-label').textContent = 'Load city'; }
        });

        setStep(0);

    }, 500);

    map.on('draw:created', function(e) {
        drawnItems.addLayer(e.layer);
        if (previousBaseLayer) {
            map.removeLayer(osmLayer);
            map.addLayer(previousBaseLayer);
            previousBaseLayer = null;
        }
        handleAreaSelection(e);
        drawnItems.clearLayers();
        // Reset pill label
        const pill = document.getElementById('load-city-pill');
        if (pill) pill.querySelector('.pill-label').textContent = 'Load city';
    });
}

function getAttractorStatus(feature) {
    const attractorTypes = ["motorway", "trunk"];
    if (feature.properties.tags && feature.properties.tags.highway) {
        return attractorTypes.includes(feature.properties.tags.highway) ? 1 : 0;
    }
    return 0;
}
