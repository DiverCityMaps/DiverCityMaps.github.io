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

document.addEventListener('DOMContentLoaded', function() {
    if (!map) initializeMap();
    applySharedStateFromURL();
});


// ==========================
// URL sharing — load shared state
// ==========================

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

    initializeLayers();
    initializeControls();
    initializeEventListeners();
    map.fitBounds(edgeLayer ? edgeLayer.getBounds() : [[41, 12], [42, 13]]);

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
    const { allPaths, pathCosts } = computeKAlternativePaths(graph, selectedNodes[0], selectedNodes[1], k, p, max_it);

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
