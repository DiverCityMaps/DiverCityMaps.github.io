// ==========================
// divercity.js
// Main entry point — global variables and core app functions
// Depends on: utils.js, graph.js, osm.js, routing.js, ui.js, map_controls.js
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


document.addEventListener('DOMContentLoaded', function() {
    if (!map) {
        initializeMap();
    }
});


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
    map.fitBounds(edgeLayer.getBounds());

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
    updateInfoBox(selectedNodes[0], selectedNodes[1], numNSP, spatialSpread, diverCity);

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
}

function updateRoutesOnParameterChange() {
    if (selectedNodes.length === 2 && !isComputing) {
        pathLayers.forEach(layer => map.removeLayer(layer));
        pathLayers = [];
        updateInfoBoxLoading();
        setTimeout(() => computeAndDrawPaths(), 50);
    }
}
