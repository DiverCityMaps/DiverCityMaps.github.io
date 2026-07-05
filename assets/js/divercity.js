// ==========================
// divercity.js
// Main entry point — global variables and core app functions
// ==========================

// ==========================
// Global Variables
// ==========================
let map, graph = {}, nodes = {}, edgeLayer, layerControl, osmLayer;
let selectedNodes = [], nodeMarkers = [], pathLayers = [];
let isRouteComputed = false;
let k = 5, p = 0.1, epsilon = 0.3, max_it = 25;
let attractorSpeedMultiplier = 1.0;
let isComputing = false;
let overlayLayers = {};
let previousBaseLayer = null;
let currentCity = "Rome, Italy";
let networkSource = { type: 'default' };   // how the current network was loaded

// Routing worker — keeps heavy Dijkstra iterations off the main thread
let routingWorker = null;
let workerRequestId = 0;

document.addEventListener('DOMContentLoaded', function() {
    initRoutingWorker();
    if (!map) initializeMap();
    applySharedStateFromURL();
});


// ==========================
// Routing worker
// ==========================

function initRoutingWorker() {
    try {
        routingWorker = new Worker('./assets/js/routing_worker.js');
        routingWorker.onmessage = handleWorkerMessage;
        routingWorker.onerror = function (e) {
            console.warn('[DiverCity] Routing worker failed, falling back to main thread.', e.message);
            routingWorker = null;
        };
    } catch (e) {
        console.warn('[DiverCity] Web Worker unavailable, using main-thread routing.');
        routingWorker = null;
    }
}

// Lightweight graph for the worker: strips geometries and feature references.
// Node IDs forced to strings so === comparisons never fail due to
// string-vs-number mismatches after JSON serialization or mixed dataset sources.
function buildLightGraph() {
    const light = {};
    for (const u in graph) {
        const key = String(u);
        light[key] = graph[u].map(l => ({ n: String(l.node), w: l.weight, a: l.is_attractor }));
    }
    return light;
}

// Ensure main-thread graph node IDs are also strings, so drawPathsNSPAggr
// finds geometries whether paths come from worker (strings) or fallback (numbers).
function normalizeGraphNodeIds() {
    for (const u in graph) {
        for (const link of graph[u]) {
            if (typeof link.node !== 'string') link.node = String(link.node);
        }
    }
}

// Called after every buildGraph (initial load and new network downloads)
function syncGraphToWorker() {
    normalizeGraphNodeIds();   // main-thread graph must have string node IDs too
    if (!routingWorker) return;
    routingWorker.postMessage({ type: 'setGraph', graph: buildLightGraph() });
}

function handleWorkerMessage(e) {
    const msg = e.data;
    if (msg.type === 'error') {
        console.error('[DiverCity] Worker error:', msg.error);
        isComputing = false;
        return;
    }
    if (msg.type !== 'result') return;
    if (msg.requestId !== workerRequestId) return;   // stale result — a newer request superseded it
    if (selectedNodes.length !== 2) {                 // route was reset while computing
        isComputing = false;
        return;
    }
    finishComputation(msg.allPaths, msg.pathCosts);
}


// ==========================
// URL sharing — load shared state
// ==========================

// Top-level location (parent when in same-origin iframe).
// Defined here (not only in ui.js) so divercity.js is self-contained.
function getAppLocation() {
    try {
        if (window.parent !== window) return window.parent.location;
    } catch (e) { /* cross-origin — fall through */ }
    return window.location;
}

// Limits matching the legitimate UI ranges
const MAX_RADIUS_KM    = 30;      // radius slider max
const MAX_BBOX_AREA_KM2 = 3000;   // ≈ area of a 30 km radius circle

function bboxAreaKm2(bbox) {
    const [s, w, n, e] = bbox;
    const latSpanKm = (n - s) * 111;
    const midLat    = (n + s) / 2;
    const lngSpanKm = (e - w) * 111 * Math.cos(midLat * Math.PI / 180);
    return Math.abs(latSpanKm * lngSpanKm);
}

function isValidLatLng(lat, lng) {
    return !isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
}

// Strip anything HTML-ish and cap length — name flows into innerHTML
function sanitizeName(s) {
    return String(s).replace(/[<>"'&`]/g, '').slice(0, 60).trim();
}

function applySharedStateFromURL() {
    const loc = getAppLocation();
    const hash = loc.hash.replace(/^#/, '');
    if (!hash) return;

    const params = new URLSearchParams(hash);
    if (!params.has('o') || !params.has('d')) return;

    const [olat, olng] = params.get('o').split(',').map(Number);
    const [dlat, dlng] = params.get('d').split(',').map(Number);
    if (!isValidLatLng(olat, olng) || !isValidLatLng(dlat, dlng)) return;

    applySharedParams(params);

    const proceed = () => {
        const oNode = findClosestNode({ lat: olat, lng: olng });
        const dNode = findClosestNode({ lat: dlat, lng: dlng });
        if (!oNode || !dNode) return;
        selectedNodes = [oNode, dNode];
        highlightNodes();
        map.fitBounds(L.latLngBounds(
            [[olat, olng], [dlat, dlng]]
        ).pad(0.3));
        isComputing = true;
        updateInfoBoxLoading();
        setTimeout(() => computeAndDrawPaths(), 50);
    };

    if (params.has('c') && params.has('r')) {
        const [clat, clng] = params.get('c').split(',').map(Number);
        const r = parseFloat(params.get('r'));

        // ── Validation: reject out-of-range center or radius ──
        if (!isValidLatLng(clat, clng) || isNaN(r) || r < 1 || r > MAX_RADIUS_KM) {
            showMapLoader("Invalid shared link.", "error");
            return;
        }

        currentCity = params.has('name') ? sanitizeName(params.get('name')) : 'Shared area';
        if (!currentCity) currentCity = 'Shared area';
        showMapLoader("Loading shared route…");
        downloadRoadNetworkByRadius(clat, clng, r)
            .then(geojsonData => {
                RoadsData = geojsonData;
                initializeGraphNetwork(RoadsData);
                networkSource = { type: 'radius', lat: clat, lng: clng, r, name: currentCity };
                hideMapLoader();
                proceed();
            })
            .catch(err => {
                hideMapLoader();
                showMapLoader("Failed to load shared route.", "error");
                console.error(err);
            });
    } else if (params.has('bbox')) {
        const bbox = params.get('bbox').split(',').map(Number);

        // ── Validation: shape, coordinate ranges, and area cap ──
        if (bbox.length !== 4 || bbox.some(isNaN)) return;
        const [s, w, n, e] = bbox;
        if (s >= n || w >= e ||
            !isValidLatLng(s, w) || !isValidLatLng(n, e)) {
            showMapLoader("Invalid shared link.", "error");
            return;
        }
        if (bboxAreaKm2(bbox) > MAX_BBOX_AREA_KM2) {
            showMapLoader("Invalid shared link: area too large.", "error");
            return;
        }

        currentCity = "Custom area";
        showMapLoader("Loading shared route…");
        downloadRoadNetwork(bbox)
            .then(geojsonData => {
                RoadsData = geojsonData;
                initializeGraphNetwork(RoadsData);
                networkSource = { type: 'bbox', bbox };
                hideMapLoader();
                proceed();
            })
            .catch(err => {
                hideMapLoader();
                showMapLoader("Failed to load shared route.", "error");
                console.error(err);
            });
    } else {
        // Default network (rome.js) — already loaded
        proceed();
    }
}

function applySharedParams(params) {
    // All values clamped to the ranges the UI sliders allow
    if (params.has('k')) {
        const v = parseInt(params.get('k'));
        if (!isNaN(v)) {
            k = Math.min(10, Math.max(1, v));
            const s = document.getElementById('slider-k');
            if (s) { s.value = k; document.getElementById('value-k').innerText = k; }
        }
    }
    if (params.has('eps')) {
        const v = parseFloat(params.get('eps'));
        if (!isNaN(v)) {
            epsilon = Math.min(1, Math.max(0, v));
            const s = document.getElementById('slider-eps');
            if (s) { s.value = epsilon; document.getElementById('value-eps').innerText = Math.round(epsilon * 100) + '%'; }
        }
    }
    if (params.has('p')) {
        const v = parseFloat(params.get('p'));
        if (!isNaN(v)) {
            p = Math.min(1, Math.max(0, v));
            const s = document.getElementById('slider-p');
            if (s) { s.value = p; document.getElementById('value-p').innerText = p.toFixed(2); }
        }
    }
    if (params.has('as')) {
        const v = parseFloat(params.get('as'));
        if (!isNaN(v)) {
            attractorSpeedMultiplier = Math.min(2.0, Math.max(0.1, v));
            const s = document.getElementById('slider-attractor-reduction');
            if (s) {
                s.value = attractorSpeedMultiplier;
                document.getElementById('value-attractor-reduction').innerText = Math.round(attractorSpeedMultiplier * 100) + '%';
                s.dispatchEvent(new Event('input'));  // updates badge + attractor layer style
            }
        }
    }
    if (params.has('mi')) {
        const v = parseInt(params.get('mi'));
        if (!isNaN(v)) {
            max_it = Math.min(300, Math.max(10, v));
            const s = document.getElementById('slider-max-it');
            if (s) { s.value = max_it; document.getElementById('value-max-it').innerText = max_it; }
        }
    }
    if (typeof updateSettingsSummary === 'function') updateSettingsSummary();
}


// ==========================
// Initialization
// ==========================

function initializeMap() {
    osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Road network data © OpenStreetMap contributors, <a href="https://opendatacommons.org/licenses/odbl/" target="_blank">ODbL</a>'
    });

    map = L.map('map', {
        center: [0, 0],
        zoom: 2,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        maxZoom: 22,
        minZoom: 1,
        layers: [],
        preferCanvas: true
    });

    // Controls first — so showMapLoader is guaranteed to work
    initializeControls();
    initializeEventListeners();

    // Show spinner immediately, then build the network in the next frame
    // so the browser can paint the UI+spinner before we block for buildGraph.
    showMapLoader("Building road network…");

    requestAnimationFrame(function () {
        initializeLayers();
        map.fitBounds(edgeLayer ? edgeLayer.getBounds() : [[41, 12], [42, 13]]);
        hideMapLoader();
    });

    map.createPane('routes');
    map.getPane('routes').style.zIndex = 650;
    map.getPane('routes').style.pointerEvents = 'none';

    map.createPane('markers');
    map.getPane('markers').style.zIndex = 700;

    function ensureRoutesOnTop() {
        pathLayers.forEach(layer => {
            if (!layer) return;
            if (layer.eachLayer) layer.eachLayer(l => l.bringToFront());
            else if (layer.bringToFront) layer.bringToFront();
        });
    }

    map.on('overlayadd', ensureRoutesOnTop);
    map.on('overlayremove', ensureRoutesOnTop);
}

function initializeControls() {
    addDrawControl();
    createInfoBox();
    createSliders();
    addLegend();
    addScaleControl();
    addAboutPanel();
}

function initializeEventListeners() {
    map.on('click', handleMapClick);
}


// ==========================
// Core App Functions
// ==========================

function computeAndDrawPaths() {
    const start = selectedNodes[0];
    const end   = selectedNodes[1];

    if (routingWorker) {
        // Off-main-thread: UI stays responsive during Dijkstra iterations
        const requestId = ++workerRequestId;
        routingWorker.postMessage({
            type: 'compute',
            requestId,
            start, end,
            k, p, max_it,
            attractorSpeedMultiplier
        });
        // Result arrives in handleWorkerMessage → finishComputation
        return;
    }

    // Fallback: synchronous main-thread computation
    const { allPaths, pathCosts } = computeKAlternativePaths(graph, start, end, k, p, max_it);
    finishComputation(allPaths, pathCosts);
}

function finishComputation(allPaths, pathCosts) {
    drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon);

    const edgeWeights = {};
    RoadsData.features.forEach(f => {
        if (f.geometry.type === "LineString") {
            const e = [f.properties.start, f.properties.end];
            edgeWeights[e] = f.properties.length;
        }
    });

    const { diverCity, numNSP, spatialSpread } = computeDiverCity(allPaths, pathCosts, edgeWeights, epsilon);

    const fastestTimeMin = pathCosts.length > 0
        ? Math.round(Math.min(...pathCosts) / 60)
        : undefined;

    updateInfoBox(selectedNodes[0], selectedNodes[1], numNSP, spatialSpread, diverCity, fastestTimeMin);

    // Keep address bar in sync with current route
    if (typeof updateURLHash === 'function') updateURLHash();

    isRouteComputed = true;
    isComputing = false;
}

function resetRoute() {
    selectedNodes = [];

    pathLayers.forEach(layer => map.removeLayer(layer));
    pathLayers = [];

    nodeMarkers.forEach(marker => map.removeLayer(marker));
    nodeMarkers = [];

    updateInfoBoxDefault();
    isRouteComputed = false;

    // URL no longer describes a route
    if (typeof clearURLHash === 'function') clearURLHash();
}

function updateRoutesOnParameterChange() {
    if (selectedNodes.length === 2 && !isComputing) {
        pathLayers.forEach(layer => map.removeLayer(layer));
        pathLayers = [];
        updateInfoBoxLoading();
        setTimeout(() => computeAndDrawPaths(), 50);
    }
}
