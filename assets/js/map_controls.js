// ==========================
// map_controls.js
// Map controls, layers, styling and event handlers
// Depends on: graph.js (buildGraph), osm.js, routing.js, ui.js
// Uses globals: map, osmLayer, edgeLayer, graph, nodes, RoadsData,
//               selectedNodes, nodeMarkers, pathLayers, overlayLayers,
//               previousBaseLayer, isComputing, isRouteComputed, layerControl
// ==========================

function styleRoads(feature) {
    return feature.properties.is_attractor === 1
        ? { color: "#FFE5B4", weight: 3 }
        : { color: "#D3D3D3", weight: 0.35 };
}

function filterLineString(feature) {
    return feature.geometry.type === "LineString";
}

function updateLayerControl() {
    if (layerControl) map.removeControl(layerControl);
    let baseLayers = {
        "Road Network": edgeLayer,
        "Street Map": osmLayer
    };
    let overlayLayers = {};
    layerControl = L.control.layers(baseLayers, overlayLayers, { collapsed: false }).addTo(map);
}

function ensureCustomPanes(map) {
    if (!map.getPane('roads')) {
        map.createPane('roads');
        map.getPane('roads').style.zIndex = 400;
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

function initializeLayers() {
    let bgraph = buildGraph(RoadsData);
    graph = bgraph.graph;
    nodes = bgraph.nodes;

    edgeLayer = L.geoJSON(RoadsData, {
        style: styleRoads,
        filter: filterLineString
    }).addTo(map);

    let baseLayers = {
        "Road Network": edgeLayer,
        "Street Map": osmLayer
    };

    overlayLayers = {};
    layerControl = L.control.layers(baseLayers, overlayLayers, { collapsed: false }).addTo(map);
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
    if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);

    edgeLayer = L.geoJSON(RoadsData, {
        pane: 'roads',
        style: styleRoads,
        filter: filterLineString,
        interactive: false
    }).addTo(map);

    overlayLayers = {};
    updateLayerControl();
    map.fitBounds(edgeLayer.getBounds());
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

    if (!closestNode) {
        console.error("No closest node found for coordinates:", latlng);
    }

    return closestNode;
}

function highlightNodes() {
    nodeMarkers.forEach(marker => map.removeLayer(marker));
    nodeMarkers = [];

    selectedNodes.forEach((nodeId, index) => {
        let color = index === 0 ? "green" : "red";

        let marker = L.marker([nodes[nodeId][1], nodes[nodeId][0]], {
            pane: 'markers',
            draggable: true,
            icon: L.divIcon({
                className: 'custom-marker',
                html: `<div style="
                    background-color: ${color};
                    width: 16px;
                    height: 16px;
                    border-radius: 50%;
                    border: 2px solid white;
                    box-shadow: 0 0 5px rgba(0,0,0,0.5);">
                </div>`,
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            })
        }).addTo(map);

        nodeMarkers.push(marker);

        marker.on('dragend', function(e) {
            let closestNode = findClosestNode(e.target.getLatLng());
            selectedNodes[index] = closestNode;

            if (selectedNodes.length === 2) {
                let { allPaths, pathCosts } = computeKAlternativePaths(graph, selectedNodes[0], selectedNodes[1], k, p, max_it);
                drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon);

                let edgeWeights = {};
                RoadsData.features.forEach(feature => {
                    if (feature.geometry.type === "LineString") {
                        let edge = [feature.properties.start, feature.properties.end];
                        edgeWeights[edge] = feature.properties.length;
                    }
                });

                let { diverCity, numNSP, spatialSpread } = computeDiverCity(allPaths, pathCosts, edgeWeights, epsilon);
                updateInfoBox(selectedNodes[0], selectedNodes[1], numNSP, spatialSpread, diverCity);
            }
        });
    });
}

function drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon) {
    pathLayers.forEach(layer => map.removeLayer(layer));
    pathLayers = [];

    const pathCategories = [
        { paths: filterNoNearShortest(allPaths, pathCosts, epsilon), color: "red" },
        { paths: filterNearShortest(allPaths, pathCosts, epsilon), color: "darkblue" }
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

                let edgeGeometry = graph[start].find(link => link.node === end)?.geometry;

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
            style: feature => ({
                color: color,
                weight: feature.properties.weight
            })
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
    if (edgeLayer) {
        map.removeLayer(edgeLayer);
        edgeLayer = null;
    }

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
            rectangle: {
                showArea: true,
                metric: true
            },
            polygon: false,
            polyline: false,
            circle: false,
            marker: false,
            circlemarker: false
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

        let step = 0;

        const btn = document.createElement('div');
        btn.className = 'load-city-btn';
        document.getElementById('map').appendChild(btn);
        L.DomEvent.disableClickPropagation(btn);

        function handleCitySearch() {
            const query = document.getElementById('city-search-input').value.trim();
            if (!query) return;

            showMapLoader("Searching...");

            searchCity(query)
                .then(({ lat, lng, name }) => {
                    hideMapLoader();
                    setStep('search', { lat, lng, name });
                })
                .catch(err => {
                    console.error("Error:", err);
                    hideMapLoader();
                    showMapLoader("City not found. Try again.", "error");
                });
        }

        function setStep(s, opts = {}) {
            step = s;

            if (s === 0) {
                btn.innerHTML = `
                    <div class="btn-text" style="width:100%">
                        <div class="btn-title" style="margin-bottom:8px;">🗺️ Load a new city</div>
                        <div style="display:flex; gap:6px; margin-bottom:8px;">
                            <input id="city-search-input" type="text" placeholder="Search a city..."
                                style="flex:1; padding:6px 8px; border:1px solid #ccc;
                                border-radius:6px; font-size:12px; outline:none;"/>
                            <button id="city-search-btn" style="
                                padding:6px 10px; background:#0b4bd6; color:white;
                                border:none; border-radius:6px; cursor:pointer; font-size:13px;">
                                🔍
                            </button>
                        </div>
                        <div style="text-align:center; font-size:11px; color:#aaa; margin-bottom:6px;">or</div>
                        <button id="btn-draw-area" style="
                            width:100%; padding:6px; background:#f0f0f0; color:#333;
                            border:1px solid #ddd; border-radius:6px; cursor:pointer;
                            font-size:12px;">
                            ✏️ Draw a custom area
                        </button>
                    </div>`;
                btn.classList.remove('drawing');

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

                document.querySelector('.info-box').style.top = '280px';

            } else if (s === 1) {
                resetRoute();
                btn.innerHTML = `
                    <div class="btn-text" style="width:100%">
                        <div class="btn-title" style="margin-bottom:8px;">🗺️ Load a new city</div>
                        <hr style="margin:0 0 8px 0; border:none; border-top:1px solid #eee;">
                        <div style="font-size:11px; color:#555; margin-bottom:10px;">
                            1. Navigate to your city using the map<br>
                            2. Click <b>Start drawing</b> to select the area
                        </div>
                        <div style="display:flex; gap:6px;">
                            <button id="btn-start-draw" style="
                                flex:1; padding:6px; background:#0b4bd6; color:white;
                                border:none; border-radius:6px; cursor:pointer;
                                font-size:12px; font-weight:bold;">
                                ✏️ Start drawing
                            </button>
                            <button id="btn-cancel" style="
                                padding:6px 10px; background:#f0f0f0; color:#333;
                                border:none; border-radius:6px; cursor:pointer;
                                font-size:12px;">
                                ✕
                            </button>
                        </div>
                    </div>`;
                btn.classList.remove('drawing');

                if (!map.hasLayer(osmLayer)) {
                    if (map.hasLayer(edgeLayer)) {
                        previousBaseLayer = edgeLayer;
                        map.removeLayer(edgeLayer);
                    }
                    map.addLayer(osmLayer);
                }

                document.getElementById('btn-start-draw').addEventListener('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    setStep(2);
                });
                document.getElementById('btn-cancel').addEventListener('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (map.hasLayer(osmLayer) && previousBaseLayer) {
                        map.removeLayer(osmLayer);
                        map.addLayer(previousBaseLayer);
                    }
                    setStep(0);
                });

            } else if (s === 2) {
                map.off('click', handleMapClick);
                btn.innerHTML = `
                    <div class="btn-icon">✏️</div>
                    <div class="btn-text">
                        <div class="btn-title">Draw the area</div>
                        <div class="btn-subtitle">Click and drag on the map</div>
                    </div>`;
                btn.classList.add('drawing');
                drawButton.click();

            } else if (s === 'search') {
                const { lat, lng, name } = opts;
                let radius = 15;

                resetRoute();
                if (!map.hasLayer(osmLayer)) {
                    if (map.hasLayer(edgeLayer)) {
                        previousBaseLayer = edgeLayer;
                        map.removeLayer(edgeLayer);
                    }
                    map.addLayer(osmLayer);
                }

                map.setView([lat, lng], 11);

                let centerMarker = L.marker([lat, lng], {
                    draggable: true,
                    icon: L.divIcon({
                        className: '',
                        html: `<div style="
                            width: 14px; height: 14px;
                            background: #333; border-radius: 50%;
                            border: 2px solid white;
                            box-shadow: 0 0 5px rgba(0,0,0,0.5);
                            cursor: grab;">
                        </div>`,
                        iconSize: [14, 14],
                        iconAnchor: [7, 7]
                    })
                }).addTo(map);

                centerMarker.on('drag', function(e) {
                    const pos = e.target.getLatLng();
                    radiusCircle.setLatLng(pos);
                });

                let radiusCircle = L.circle([lat, lng], {
                    radius: radius * 1000,
                    color: '#0b4bd6', fillColor: '#0b4bd6',
                    fillOpacity: 0.1, weight: 2
                }).addTo(map);

                btn.innerHTML = `
                    <div class="btn-text" style="width:100%">
                        <div class="btn-title" style="margin-bottom:6px;">📍 ${name}</div>
                        <hr style="margin:0 0 8px 0; border:none; border-top:1px solid #eee;">
                        <label style="font-size:11px; color:#555;">
                            Radius: <b><span id="radius-value">${radius}</span> km</b>
                        </label>
                        <input type="range" id="radius-slider" min="1" max="30" step="1" value="${radius}"
                            style="width:100%; margin: 4px 0 10px 0;">
                        <div style="display:flex; gap:6px;">
                            <button id="btn-download-radius" style="
                                flex:1; padding:6px; background:#0b4bd6; color:white;
                                border:none; border-radius:6px; cursor:pointer;
                                font-size:12px; font-weight:bold;">
                                ⬇️ Download
                            </button>
                            <button id="btn-cancel-search" style="
                                padding:6px 10px; background:#f0f0f0; color:#333;
                                border:none; border-radius:6px; cursor:pointer;
                                font-size:12px;">✕
                            </button>
                        </div>
                    </div>`;

                document.getElementById('radius-slider').addEventListener('input', (e) => {
                    radius = parseInt(e.target.value);
                    document.getElementById('radius-value').textContent = radius;
                    radiusCircle.setRadius(radius * 1000);
                });

                document.getElementById('btn-download-radius').addEventListener('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    const pos = centerMarker.getLatLng();
                    map.removeLayer(centerMarker);
                    map.removeLayer(radiusCircle);
                    showMapLoader("Downloading road network…");
                    downloadRoadNetworkByRadius(pos.lat, pos.lng, radius)
                        .then(geojsonData => {
                            RoadsData = geojsonData;
                            initializeGraphNetwork(RoadsData);
                            selectedNodes = [];
                            highlightNodes();
                            hideMapLoader();
                            setStep(0);
                        })
                        .catch(error => {
                            hideMapLoader();
                            showMapLoader("Download failed. Try a smaller area.", "error");
                            console.error(error);
                        });
                });

                document.getElementById('btn-cancel-search').addEventListener('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    map.removeLayer(centerMarker);
                    map.removeLayer(radiusCircle);
                    if (map.hasLayer(osmLayer) && previousBaseLayer) {
                        map.removeLayer(osmLayer);
                        map.addLayer(previousBaseLayer);
                    }
                    setStep(0);
                });
            }
        }

        btn.addEventListener('click', (e) => {
            L.DomEvent.stopPropagation(e);
        });

        map.on('draw:created', () => {
            map.on('click', handleMapClick);
            setStep(0);
        });
        map.on('draw:drawstop', () => {
            map.on('click', handleMapClick);
            if (step === 2) setStep(0);
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
    });
}

function getAttractorStatus(feature) {
    const attractorTypes = ["motorway", "trunk"];
    if (feature.properties.tags && feature.properties.tags.highway) {
        return attractorTypes.includes(feature.properties.tags.highway) ? 1 : 0;
    }
    return 0;
}
