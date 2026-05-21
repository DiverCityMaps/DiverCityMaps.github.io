// ==========================
// Global Variables
// ==========================
let map, graph = {}, nodes = {}, edgeLayer, layerControl;
let selectedNodes = [], nodeMarkers = [], pathLayers = [];
let isRouteComputed = false;
let k = 5, p = 0.1, epsilon = 0.3, max_it = 100;


// Initialize overlayLayers as an empty object
let overlayLayers = {};
let previousBaseLayer = null;


const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors | Road network data © OpenStreetMap contributors, <a href="https://opendatacommons.org/licenses/odbl/" target="_blank">ODbL</a>'
});

document.addEventListener('DOMContentLoaded', function() {
    if (!map) {
        initializeMap();
    }
});


// ==========================
// Initialization Functions


// ==========================

function initializeMap() {
    map = L.map('map', {
        center: [0, 0],
        zoom: 2,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        maxZoom: 22,
        minZoom: 1,
        layers: []
    });

    initializeLayers();
    initializeControls();
    initializeEventListeners();
    map.fitBounds(edgeLayer.getBounds());

    // --- Custom Panes for Z-Index Control ---
    //map.createPane('roads');
    //map.getPane('roads').style.zIndex = 400;

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
        });}

    map.on('overlayadd', ensureRoutesOnTop);
    map.on('overlayremove', ensureRoutesOnTop);

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
        "Roads Data": edgeLayer,
        "OSM": osmLayer
    };

    // Ensure overlayLayers is defined and used correctly
    overlayLayers = {};  // Initialize or clear existing layers

    layerControl = L.control.layers(baseLayers, overlayLayers, {collapsed: false}).addTo(map);

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
// Graph & Network Functions
// ==========================

function addDrawControl() {
  // Create a FeatureGroup to store drawn layers
  let drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  // Initialize the draw control with only the rectangle tool enabled
  let drawControl = new L.Control.Draw({
    draw: {
      rectangle: true, // Enable rectangle drawing
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
    const drawButton = document.querySelector('.leaflet-draw-draw-rectangle');
    if (!drawButton) return;

    let step = 0;

    const btn = document.createElement('div');
    btn.className = 'load-city-btn';
    document.getElementById('map').appendChild(btn);

    function setStep(s) {
        step = s;
        if (s === 0) {
            btn.innerHTML = `
                <div class="btn-icon">🗺️</div>
                <div class="btn-text">
                    <div class="btn-title">Load a new city</div>
                    <div class="btn-subtitle">Draw a rectangle on the map</div>
                </div>`;
            btn.classList.remove('drawing');
        } else if (s === 1) {
            btn.innerHTML = `
                <div class="btn-icon">🔍</div>
                <div class="btn-text">
                    <div class="btn-title">Navigate to your city</div>
                    <div class="btn-subtitle">Then click here to draw</div>
                </div>`;
            btn.classList.remove('drawing');
            if (!map.hasLayer(osmLayer)) {
                if (map.hasLayer(edgeLayer)) {
                    previousBaseLayer = edgeLayer;
                    map.removeLayer(edgeLayer);
                }
                map.addLayer(osmLayer);
            }
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
        }
    }

    btn.addEventListener('click', () => {
        if (step === 0) setStep(1);
        else if (step === 1) setStep(2);
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




  // Listen for the draw:created event
  map.on('draw:created', function(e) {
    // Add the drawn rectangle to the feature group (if needed for processing)
    drawnItems.addLayer(e.layer);

     if (previousBaseLayer) {
        map.removeLayer(osmLayer);
        map.addLayer(previousBaseLayer);
        previousBaseLayer = null;
      }



    // Process the drawn area (download new road network, etc.)
    handleAreaSelection(e);

    // Remove the rectangle from the map after processing
    drawnItems.clearLayers();
  });

}




function buildGraph(roadsData) {
    let graph = {}, nodes = {};

    roadsData.features.forEach(feature => {
        if (feature.geometry.type === "LineString") {
            let start = feature.properties.start;
            let end = feature.properties.end;

            if (!graph[start]) graph[start] = [];
            graph[start].push({
                node: end,
                weight: feature.properties.travel_time,
                is_attractor: feature.properties.is_attractor,
                geometry: feature.geometry.coordinates,
                feature
            });
        } else if (feature.geometry.type === "Point") {
            nodes[feature.properties.id] = feature.geometry.coordinates;
        }
    });

    console.log("**** # nodes")
    console.log(Object.keys(nodes).length)

    return { graph, nodes };
}

function initializeGraphNetwork(RoadsData) {

  ensureCustomPanes(map);

  // Rebuild the graph and node data using your buildGraph() function
  let updatedGraph = buildGraph(RoadsData);
  graph = updatedGraph.graph;
  nodes = updatedGraph.nodes;

  // Optionally, clean the graph if you have a cleanGraph() function
  if (typeof cleanGraph === "function") {
    graph = cleanGraph(graph, nodes);
  }

  // Remove the existing edgeLayer from the map if it exists
  if (edgeLayer) {
    map.removeLayer(edgeLayer);
  }

  // Create a new GeoJSON layer for the updated road network data
    edgeLayer = L.geoJSON(RoadsData, {
        pane: 'roads',
        style: styleRoads,
        filter: filterLineString,
        interactive: false  // prevents blocking clicks
    }).addTo(map);

  // Reset overlayLayers (if you use additional overlays)
  overlayLayers = {};

  // Update the layer control on the map with the new layers
  updateLayerControl();

  // Adjust the map view to fit the bounds of the new road network
  map.fitBounds(edgeLayer.getBounds());
}


// ==========================
// Map Styling & Layer Filters
// ==========================

function styleRoads(feature) {
    return feature.properties.is_attractor === 1
        ? { color: "#FFE5B4", weight: 3}
        : { color: "#D3D3D3", weight: 0.35 };
}


function filterLineString(feature) {
    return feature.geometry.type === "LineString";
}

function updateLayerControl() {
    if (layerControl) map.removeControl(layerControl);

    let baseLayers = {
        "Roads Data": edgeLayer,
        "OSM": osmLayer
    };
    let overlayLayers = {};
    layerControl = L.control.layers(baseLayers, overlayLayers, {collapsed: false}).addTo(map);
}


// ==========================
// Event Handlers
// ==========================

// When the user draws a rectangle, get its bounds and download the road network.
function handleAreaSelection(event) {
  var layer = event.layer;
  var bounds = layer.getBounds();
  var bbox = [
    +bounds.getSouthWest().lat.toFixed(5),
    +bounds.getSouthWest().lng.toFixed(5),
    +bounds.getNorthEast().lat.toFixed(5),
    +bounds.getNorthEast().lng.toFixed(5)
  ];

  // Rimuovi grafo e route correnti
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


function showMapLoader(message) {
  let loader = document.getElementById('map-loader');
  if (!loader) {
    loader = document.createElement('div');
    loader.id = 'map-loader';
    loader.style.cssText = `
      position: fixed; top: 0; left: 0;
      width: 100%; height: 100%;
      background: rgba(255,255,255,0.85);
      display: flex; flex-direction: column;
      justify-content: center; align-items: center;
      z-index: 9999; font-family: Arial, sans-serif;
    `;
    loader.innerHTML = `
      <div class="spinner"></div>
      <div id="map-loader-msg" style="margin-top: 20px; font-size: 15px; font-weight: bold; color: #333;"></div>
    `;
    document.body.appendChild(loader);
  }
  document.getElementById('map-loader-msg').textContent = message;
  loader.style.display = 'flex';
}

function hideMapLoader() {
  const loader = document.getElementById('map-loader');
  if (loader) loader.style.display = 'none';
}


function downloadRoadNetwork(bbox) {

  const [s, w, n, e] = bbox.map(v => +v.toFixed(5));
  const query = `[out:json][timeout:120];(way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|unclassified|residential)$"]["access"!="no"]["motor_vehicle"!="no"](${s},${w},${n},${e}););out body;>;out skel qt;`;  
  return fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(query)
  })
    .then(response => {
      if (!response.ok) throw new Error("Network response was not ok");
      return response.json();
    })
    .then(osmData => transformOSMDataToRoadsData(osmData));
}


function transformOSMDataToRoadsData(osmData) {
 
  // ------------------------------------------------------------------
  // Step 1: Build coordinate map  nodeId → [lon, lat]
  // ------------------------------------------------------------------
  const nodeCoords = {};
  osmData.elements.forEach(el => {
    if (el.type === "node") {
      nodeCoords[el.id] = [el.lon, el.lat];
    }
  });
 
  // ------------------------------------------------------------------
  // Step 2: Count how many distinct ways reference each node.
  //         We use a Set per node to avoid double-counting a node that
  //         appears multiple times within the same way.
  // ------------------------------------------------------------------
  const nodeWayCount = {};   // nodeId → number of distinct ways
  osmData.elements.forEach(el => {
    if (el.type !== "way" || !el.nodes) return;
    const seen = new Set(el.nodes);
    seen.forEach(nodeId => {
      nodeWayCount[nodeId] = (nodeWayCount[nodeId] || 0) + 1;
    });
  });
 
  // ------------------------------------------------------------------
  // Step 3: Identify "true intersection" nodes.
  //         A node is kept in the simplified graph if:
  //           a) it is the first or last node of any way  (endpoint)
  //           b) it appears in more than one way          (real intersection)
  //
  //         Everything else is just a geometry shaping point and can be
  //         folded into the edge geometry without becoming a graph node.
  // ------------------------------------------------------------------
  const intersectionNodes = new Set();
  osmData.elements.forEach(el => {
    if (el.type !== "way" || !el.nodes || el.nodes.length < 2) return;
    // Endpoints are always kept
    intersectionNodes.add(el.nodes[0]);
    intersectionNodes.add(el.nodes[el.nodes.length - 1]);
    // Interior nodes shared by multiple ways
    for (let i = 1; i < el.nodes.length - 1; i++) {
      if ((nodeWayCount[el.nodes[i]] || 0) > 1) {
        intersectionNodes.add(el.nodes[i]);
      }
    }
  });
 
  // ------------------------------------------------------------------
  // Step 4: Walk each way and emit one simplified edge per pair of
  //         consecutive intersection nodes, accumulating geometry,
  //         length, and travel time along the way.
  // ------------------------------------------------------------------
  const features_edges = [];
 
  osmData.elements.forEach(el => {
    if (el.type !== "way" || !el.nodes || el.nodes.length < 2) return;
 
    // --- Road attributes ---
    const tags        = el.tags || {};
    const highwayType = tags.highway || "";
    const is_attractor = (highwayType === "motorway" || highwayType === "trunk") ? 1 : 0;
 
    // Speed (km/h): prefer explicit maxspeed tag, fall back to road-type default
    const parsedSpeed = (el.tags && el.tags.maxspeed) ? parseMaxSpeed(el.tags.maxspeed) : null;
    let speed = 50;

    if (parsedSpeed !== null) {
        speed = parsedSpeed;
    } else {
        if (highwayType === "motorway") speed = 130;
        else if (highwayType === "trunk") speed = 110;
        else if (highwayType === "primary") speed = 70;
        else if (highwayType === "secondary") speed = 60;
        else if (highwayType === "tertiary") speed = 50;
        else if (highwayType === "unclassified") speed = 40;
        else if (highwayType === "residential") speed = 30;
    }
   
    // Directionality
    const isReversed = tags.oneway === "-1";
    const isOneWay   = tags.oneway === "yes" || isReversed;
 
    // --- Walk the node sequence, splitting at intersection nodes ---
    // segStart      : OSM id of the intersection node where this segment begins
    // segCoords     : accumulated [lon, lat] coordinate list (full geometry)
    // segLength     : accumulated haversine length in km
    let segStart  = el.nodes[0];
    let segCoords = nodeCoords[segStart] ? [nodeCoords[segStart]] : [];
    let segLength = 0;
 
    for (let i = 1; i < el.nodes.length; i++) {
      const prevId = el.nodes[i - 1];
      const currId = el.nodes[i];
 
      const prevCoord = nodeCoords[prevId];
      const currCoord = nodeCoords[currId];
 
      // Skip sub-segments whose nodes are missing from the coordinate map
      // (can happen when the Overpass query clips at the bbox boundary)
      if (!prevCoord || !currCoord) {
        // If we have a partial segment and hit a gap, discard it and restart
        if (intersectionNodes.has(currId) && currCoord) {
          segStart  = currId;
          segCoords = [currCoord];
          segLength = 0;
        }
        continue;
      }
 
      // Accumulate sub-segment
      const subLength = haversineDistance(
        prevCoord[1], prevCoord[0],
        currCoord[1], currCoord[0]
      );
      segLength += subLength;
      segCoords.push(currCoord);
 
      // When we reach an intersection node, emit the simplified edge
      if (intersectionNodes.has(currId)) {
        if (segCoords.length >= 2 && segLength > 0) {
          const travelTime = (segLength / speed) * 3600; // seconds
 
          // Forward direction: segStart → currId
          // For oneway="-1" the physical travel goes currId → segStart,
          // so we swap start/end and reverse the coordinate array.
          const fwdCoords  = isReversed ? segCoords.slice().reverse() : segCoords.slice();
          const fwdStart   = isReversed ? currId.toString() : segStart.toString();
          const fwdEnd     = isReversed ? segStart.toString() : currId.toString();
 
          features_edges.push({
            type: "Feature",
            geometry: { type: "LineString", coordinates: fwdCoords },
            properties: {
              start:        fwdStart,
              end:          fwdEnd,
              length:       segLength,
              travel_time:  travelTime,
              is_attractor: is_attractor
            }
          });
 
          // Reverse direction for two-way roads
          if (!isOneWay) {
            features_edges.push({
              type: "Feature",
              geometry: { type: "LineString", coordinates: fwdCoords.slice().reverse() },
              properties: {
                start:        fwdEnd,
                end:          fwdStart,
                length:       segLength,
                travel_time:  travelTime,
                is_attractor: is_attractor
              }
            });
          }
        }
 
        // Reset for the next segment starting at this intersection node
        segStart  = currId;
        segCoords = [currCoord];
        segLength = 0;
      }
    }
  });
 
  const features_nodes = [];
  intersectionNodes.forEach(nodeId => {
    const coord = nodeCoords[nodeId];
    if (coord) {
      features_nodes.push({
        type: "Feature",
        geometry: { type: "Point", coordinates: coord },
        properties: { id: nodeId.toString() }
      });
    }
  });
 
  console.log(`[DiverCity] Graph simplified: ${intersectionNodes.size} intersection nodes, ${features_edges.length} edges`);
 
  return {
    type: "FeatureCollection",
    features: features_edges.concat(features_nodes)
  };
}






function handleMapClick(event) {
    if (isRouteComputed) resetRoute();
    let closestNode = findClosestNode(event.latlng);
    if (closestNode) {
        selectedNodes.push(closestNode);
        highlightNodes();
    }

    if (selectedNodes.length === 2) {
        updateInfoBoxLoading();
        setTimeout(() => computeAndDrawPaths(), 50);
    }
}



// Filtering Functions


function filterNearShortest(pathList, costList, eps) {
    if (pathList.length === 0 || costList.length === 0) return [];
    
    let minCost = Math.min(...costList);
    let maxCost = minCost * (1 + eps);
    
    return pathList.filter((_, index) => costList[index] <= maxCost);
}


function filterNoNearShortest(pathList, costList, eps) {
    if (pathList.length === 0 || costList.length === 0) return [];
    
    let minCost = Math.min(...costList);
    let maxCost = minCost * (1 + eps);
    
    return pathList.filter((_, index) => costList[index] > maxCost);
}

function weightedJaccardSimilarity(list1, list2, edgeWeights) {
    let set1 = new Set(list1.map(edge => edge.join(',')));
    let set2 = new Set(list2.map(edge => edge.join(',')));

    let intersection = [...set1].filter(x => set2.has(x));
    let union = new Set([...set1, ...set2]);

    let intersectionWeight = intersection.reduce((sum, edge) => sum + (edgeWeights[edge] || 0), 0);
    let unionWeight = [...union].reduce((sum, edge) => sum + (edgeWeights[edge] || 0), 0);

    return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}

function jaccardPairwiseWeighted(pathList, edgeWeights) {
    let jaccardScores = [];
    let n = pathList.length;

    if (n <= 1) return [1];

    for (let i = 0; i < n; i++) {
        let pathA = pathList[i];
        for (let j = i + 1; j < n; j++) {
            let pathB = pathList[j];
            let jacc = weightedJaccardSimilarity(pathA, pathB, edgeWeights);
            jaccardScores.push(jacc);
        }
    }

    return jaccardScores;
}

function computeDiverCity(paths, costList, edgeWeights, eps = 0.3) {
    let NSP = filterNearShortest(paths, costList, eps);
    let numNSP = NSP.length;

    if (numNSP === 0) {
        return { diverCity: 0, numNSP: 0, spatialSpread: 0 };
    }

    let jaccardScores = jaccardPairwiseWeighted(NSP, edgeWeights);
    let avgJaccard = jaccardScores.length > 0 
        ? jaccardScores.reduce((sum, val) => sum + val, 0) / jaccardScores.length 
        : 1;

    let spatialSpread = 1 - avgJaccard;
    let diverCity = numNSP * spatialSpread;

    return { diverCity, numNSP, spatialSpread };
}


// Function to log DiverCity Score
function logDiverCity(paths, costList, edgeWeights) {
    let formattedEdgeWeights = {};
    Object.keys(edgeWeights).forEach(edge => {
        let key = edge.split(',').map(Number).join(','); // Ensure edge keys match the formatted paths
        formattedEdgeWeights[key] = edgeWeights[edge];
    });

    let divercityScore = computeDiverCity(paths, costList, formattedEdgeWeights);
    console.log("DiverCity Score:", divercityScore);
}


function computeKAlternativePaths(graph, startNode, endNode, k, p, max_it=50) {
     let allPaths = new Set();
      let pathCosts = [];
      let tempGraph = deepCopyGraph(graph);
      let iterations = 0;

    while (allPaths.size < k && iterations < max_it) {
        let pathEdges = dijkstra(tempGraph, startNode, endNode);
        if (pathEdges.length === 0) break; // Stop if no more paths exist

        // Convert path to a string to ensure uniqueness
        let pathString = JSON.stringify(pathEdges.map(edge => [edge.properties.start, edge.properties.end]));

        if (!allPaths.has(pathString)) {
            allPaths.add(pathString);

            // Compute total path cost
            let pathCost = pathEdges.reduce((sum, edge) => sum + edge.properties.travel_time, 0);
            pathCosts.push(pathCost);

            // Apply penalties to used edges to encourage route diversity
            pathEdges.forEach(edge => {
                let start = edge.properties.start;
                let end = edge.properties.end;

                if (tempGraph[start]) {
                    tempGraph[start].forEach(link => {
                        if (link.node === end) {
                            link.weight *= (1 + p);
                        }
                    });
                }

                if (tempGraph[end]) {
                    tempGraph[end].forEach(link => {
                        if (link.node === start) {
                            link.weight *= (1 + p);
                        }
                    });
                }
            });
        }

        iterations++; // Increment iteration count
    }

    // Log if max iterations were reached before finding k paths
    if (iterations === max_it) {
        console.warn(`Max iterations (${max_it}) reached before finding ${k} distinct paths.`);
    }

    return { allPaths: Array.from(allPaths).map(path => JSON.parse(path)), pathCosts }; // Convert back to array format
}




/* Path-drawing functions */


function drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon) {
    // Remove existing path layers
    pathLayers.forEach(layer => map.removeLayer(layer));
    pathLayers = [];

    // Define path categories
    const pathCategories = [
        { paths: filterNoNearShortest(allPaths, pathCosts, epsilon), color: "red" }, // NON-NSP
        { paths: filterNearShortest(allPaths, pathCosts, epsilon), color: "darkblue"}  // NSP
        ];

    // Object to count edge occurrences
    let edgeCounts = {};

    // Count how many times each edge appears in paths
    pathCategories.forEach(({ paths }) => {
        paths.forEach(pathEdges => {
            pathEdges.forEach(([start, end]) => {
                let key = start < end ? `${start}-${end}` : `${end}-${start}`; // Keep order consistent
                edgeCounts[key] = (edgeCounts[key] || 0) + 1;
            });
        });
    });

    // Normalize edge counts to determine weight scaling
    let maxCount = Math.max(...Object.values(edgeCounts), 1); // Avoid division by zero

    // Draw aggregated paths
    pathCategories.forEach(({ paths, color }) => {
        let geoJsonFeatures = [];

        paths.forEach(pathEdges => {
            pathEdges.forEach(([start, end]) => {
                let key = start < end ? `${start}-${end}` : `${end}-${start}`; // Keep order consistent
                let weight = 1 + (edgeCounts[key] / maxCount) * 8; // Scale weight dynamically

                // Get the full geometry for the edge
                let edgeGeometry = graph[start].find(link => link.node === end)?.geometry;

                if (edgeGeometry){
                    geoJsonFeatures.push({
                        type: "Feature",
                        geometry: {
                            type: "LineString",
                            coordinates: edgeGeometry  // Use the full geometry
                        },
                        properties: { weight }
                    });}
            });
        });

        let layer = L.geoJSON(geoJsonFeatures, {
            pane: 'routes', 
            style: feature => ({
                color: color,
                weight: feature.properties.weight
            })
        }).addTo(map);

        layer.bringToFront(); // optional, helps in edge cases

        pathLayers.push(layer);
    });
}




/* Graph Utils */

function dijkstra(graph, start, end) {
    start = start.toString();
    end = end.toString();

    const distances = {};
    const previous = {};
    const edgePath = {};
    const visited = new Set();
    const pq = new Heap((a, b) => a.priority - b.priority);

    // Lazy init: solo il nodo di partenza
    distances[start] = 0;
    pq.push({ node: start, priority: 0 });

    while (!pq.empty()) {
        const { node: minNode, priority } = pq.pop();

        // Scarta entry stale
        if (priority > (distances[minNode] ?? Infinity)) continue;
        // Scarta nodi già processati
        if (visited.has(minNode)) continue;
        visited.add(minNode);

        if (minNode === end) break;

        if (!graph[minNode]) continue;

        for (const neighbor of graph[minNode]) {
            const neighborId = neighbor.node.toString();
            if (visited.has(neighborId)) continue;

            const alt = distances[minNode] + neighbor.weight;
            if (alt < (distances[neighborId] ?? Infinity)) {
                distances[neighborId] = alt;
                previous[neighborId] = minNode;
                edgePath[neighborId] = neighbor.feature;
                pq.push({ node: neighborId, priority: alt });
            }
        }
    }

    // Ricostruisci il path
    const path = [];
    let current = end;
    while (current) {
        if (edgePath[current]) path.unshift(edgePath[current]);
        current = previous[current];
    }
    return path;
}



function deepCopyGraph(graph) {
  const copy = {};
  for (let node in graph) {
    // Copy each link object for the node
    copy[node] = graph[node].map(link => ({
      node: link.node,
      weight: link.weight,
      feature: link.feature  // Assuming you don't need a deep copy of feature
    }));
  }
  return copy;
}



function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}



function getAttractorStatus(feature) {
    // Example logic: Mark major roads as attractors
    const attractorTypes = ["motorway", "trunk"];
    if (feature.properties.tags && feature.properties.tags.highway) {
        return attractorTypes.includes(feature.properties.tags.highway) ? 1 : 0;
    }
    return 0;
}




function createInfoBox() {
    var infoBox = L.DomUtil.create("div", "info-box");
    document.body.appendChild(infoBox);

    window.updateInfoBoxDefault = function() {
        infoBox.innerHTML = `
            <div style="font-size: 15px; font-weight: bold; margin-bottom: 6px;">Route Info</div>
            <div style="font-size: 12px; color: #555; line-height: 1.6;">
                🖱️ <b>Click</b> two points to set origin and destination.<br>
                🗺️ <b>Load a new city</b> using the button on the top left.
            </div>
        `;
    };

    window.updateInfoBoxLoading = function() {
    infoBox.innerHTML = `
        <div style="font-size: 15px; font-weight: bold; margin-bottom: 8px;">Route Info</div>
        <div style="font-size: 12px; color: #555; line-height: 2; text-align: center; padding: 10px 0;">
            <div style="font-size: 20px; margin-bottom: 6px;">⏳</div>
            <b>Computing routes…</b><br>
            <span style="font-size: 11px;">This may take a few seconds</span>
        </div>
    `;
};

    window.updateInfoBox = function (origin, destination, NSP_count, spatialSpread, prdScore) {
        const originCoords = nodes[origin];
        const destCoords   = nodes[destination];

        const originLat = originCoords[1], originLng = originCoords[0];
        const destLat   = destCoords[1],   destLng   = destCoords[0];

        const distance = haversineDistance(originLat, originLng, destLat, destLng);

        // Colore e label qualitativa del PRD score
        const thresholds = [0.40, 0.55, 0.70, 0.82].map(t => t * k);
        const labels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
        const colors = ['#d3202f', '#e86c00', '#888', '#1a7a3f', '#0b4bd6'];

        let scoreLabel, scoreColor;
        const idx = thresholds.findIndex(t => prdScore < t);
        if (idx === -1) {
            scoreLabel = labels[4]; scoreColor = colors[4];
        } else {
            scoreLabel = labels[idx]; scoreColor = colors[idx];
        }

        infoBox.innerHTML = `
            <div style="font-size: 15px; font-weight: bold; margin-bottom: 8px;">Route Info</div>

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">Origin</div>
            <div style="font-size: 12px; margin-bottom: 6px;">
                ${originLat.toFixed(5)}, ${originLng.toFixed(5)}
            </div>

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">Destination</div>
            <div style="font-size: 12px; margin-bottom: 6px;">
                ${destLat.toFixed(5)}, ${destLng.toFixed(5)}
            </div>

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">OD Distance</div>
            <div style="font-size: 12px; margin-bottom: 8px;">${distance.toFixed(2)} km</div>

            <hr style="margin: 6px 0; border: none; border-top: 1px solid #eee;">

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">Near Shortest Routes</div>
            <div style="font-size: 12px; margin-bottom: 4px;">${NSP_count}</div>

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">Spatial Spread</div>
            <div style="font-size: 12px; margin-bottom: 8px;">${spatialSpread.toFixed(3)}</div>

            <hr style="margin: 6px 0; border: none; border-top: 1px solid #eee;">

            <div style="font-weight: bold; font-size: 11px; color: #555; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;">
                Potential Route Diversification
            </div>
            <div style="font-size: 22px; font-weight: bold; color: ${scoreColor};">
                ${prdScore.toFixed(2)}
                <span style="font-size: 13px; font-weight: normal;">(${scoreLabel})</span>
            </div>
        `;
    };

    updateInfoBoxDefault();
}



function createSliders() {
    var sliderContainer = L.DomUtil.create("div", "slider-container");
    sliderContainer.innerHTML = `
        <div class="slider-header" id="slider-toggle">
            Route Settings
        </div>
        <div class="slider-content" id="slider-content" style="display: none;">
            <label class="tooltip" for="slider-k">
                k: <span id="value-k">${k}</span>
                <span class="tooltiptext">Number of alternative routes</span>
            </label>
            <input type="range" id="slider-k" min="1" max="10" step="1" value="${k}">
            <br>
            <label class="tooltip" for="slider-p">
                p: <span id="value-p">${p}</span>
                <span class="tooltiptext">The penalty factor for the Path Penalization algorithm</span>
            </label>
            <input type="range" id="slider-p" min="0" max="1" step="0.01" value="${p}">
            <br>
            <label class="tooltip" for="slider-eps">
                ε (epsilon): <span id="value-eps">${epsilon}</span>
                <span class="tooltiptext">The cost threshold for near-shortest routes</span>
            </label>
            <input type="range" id="slider-eps" min="0" max="1" step="0.01" value="${epsilon}">
            <br>
            <label class="tooltip" for="slider-max-it">
                Max Iterations: <span id="value-max-it">${max_it}</span>
                <span class="tooltiptext">Limit on pathfinding attempts</span>
            </label>
            <input type="range" id="slider-max-it" min="10" max="300" step="10" value="${max_it}">
            <br>
        </div>
    `;
    document.body.appendChild(sliderContainer);

    document.getElementById("slider-toggle").addEventListener("click", function() {
        var sliderContent = document.getElementById("slider-content");
        sliderContent.style.display = sliderContent.style.display === "none" ? "block" : "none";
    });

    // Event listeners for sliders using 'change' event
    document.getElementById("slider-k").addEventListener("input", function() {
        k = parseInt(this.value);
        document.getElementById("value-k").innerText = k;
    });
    document.getElementById("slider-k").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });

    document.getElementById("slider-p").addEventListener("input", function() {
        p = parseFloat(this.value);
        document.getElementById("value-p").innerText = p.toFixed(2);
    });
    document.getElementById("slider-p").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });

    document.getElementById("slider-eps").addEventListener("input", function() {
        epsilon = parseFloat(this.value);
        document.getElementById("value-eps").innerText = epsilon.toFixed(2);
    });
    document.getElementById("slider-eps").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });

    document.getElementById("slider-max-it").addEventListener("input", function() {
        max_it = parseInt(this.value);
        document.getElementById("value-max-it").innerText = max_it;
    });
    document.getElementById("slider-max-it").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });
}


function addAboutPanel() {
    const btn = document.createElement('div');
    btn.className = 'about-btn';
    btn.textContent = 'About the measure ℹ️';
    document.body.appendChild(btn);

    // Modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'about-modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
        <div class="about-modal">
            <span class="about-modal-close" id="about-close">✕</span>
            <h2>Potential Route Diversification</h2>
            <p>
                Measures how effectively a road network supports multiple 
                efficient and spatially distinct routes between an origin and destination.
            </p>
            <div class="about-formula">D(u,v) = S(NSR) ⋅ |NSR|</div>
            <p>
                <b>|NSR|</b> - number of <i>near-shortest routes</i>: paths whose 
                travel time is within <b>ε%</b> of the fastest route, generated 
                via path penalization with factor <b>p</b>.
            </p>
            <p>
                <b>S(NSR)</b> - spatial spread: <span style="font-family:monospace">1 − J(NSR)</span>, 
                where J is the average weighted Jaccard similarity among route pairs. 
                High spread means routes are spatially distinct.
            </p>
            <p>
            D(u,v) ranges in <b>[0, k]</b>. Values close to k indicate high diversification, with many near-shortest routes that overlap little in space.

            </p>
            <div style="margin-top: 10px; display: flex; gap: 12px;">
            <a href="https://arxiv.org/abs/2510.02582" target="_blank" class="about-link">📄 Paper (pre-print)</a>
            <a href="https://github.com/GiulianoCornacchia/DiverCity" target="_blank" class="about-link">💻 Code</a>
          </div>
          <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #eee; font-size: 11px; color: #aaa;">
              Dashboard designed by <a href="www.linkedin.com/in/giuliano-cornacchia/" target="_blank" style="color: #aaa; text-decoration: underline;">Giuliano Cornacchia</a>
          </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Apri
    btn.addEventListener('click', () => {
        overlay.style.display = 'flex';
    });

    // Chiudi con X
    document.getElementById('about-close').addEventListener('click', () => {
        overlay.style.display = 'none';
    });

    // Chiudi cliccando fuori dal modal
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
}


function addLegend() {
    var legend = L.control({ position: "bottomright" });

    legend.onAdd = function () {
        let div = L.DomUtil.create("div", "legend-box");
        div.innerHTML = `
            <strong>Legend</strong>
            <div class="legend-item">
                <span class="legend-line" style="background: darkblue;"></span> NSR (Near Shortest Route)
            </div>
            <div class="legend-item">
                <span class="legend-line" style="background: red;"></span> Non-NSR
            </div>
            <div class="legend-item">
                <span class="legend-line" style="background: #FFE5B4;"></span> Attractor Road
            </div>
        `;
        return div;
    };

    legend.addTo(map);

    var legendCSS = document.createElement("style");
    legendCSS.innerHTML = `
        .legend-box {
            background: rgba(255, 255, 255, 0.9);
            border-radius: 8px;
            padding: 6px 10px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            font-family: Arial, sans-serif;
            font-size: 12px;
            color: #333;
            line-height: 16px;
        }
        .legend-item {
            display: flex;
            align-items: center;
            margin-top: 3px;
        }
        .legend-line {
            width: 25px;
            height: 4px;
            margin-right: 6px;
            display: inline-block;
            border-radius: 2px;
        }
    `;
    document.head.appendChild(legendCSS);
}


function findClosestNode(latlng) {
  let minDist = Infinity;
  let closestNode = null;

  // Iterate only over nodes that also exist in the graph
  for (let nodeId in nodes) {
    // Skip nodes that are not present in the graph
    if (!graph.hasOwnProperty(nodeId)) continue;
    
    let nodeCoords = nodes[nodeId];
    if (!nodeCoords) continue; // safeguard against undefined coordinates

    // Compute distance (using simple Euclidean distance for this example)
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
    // Clear existing markers
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

        marker.on('dragend', function (e) {
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



function computeAndDrawPaths() {

   
        // Compute K alternative paths
        const { allPaths, pathCosts } = computeKAlternativePaths(graph, selectedNodes[0], selectedNodes[1], k, p, max_it);

        // Draw aggregated paths
        drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon);

        // Build edge weights once from current RoadsData
        const edgeWeights = {};
        RoadsData.features.forEach(f => {
            if (f.geometry.type === "LineString") {
                const e = [f.properties.start, f.properties.end];
                edgeWeights[e] = f.properties.length;
            }
        });

        // Metrics
        const { diverCity, numNSP, spatialSpread } = computeDiverCity(allPaths, pathCosts, edgeWeights, epsilon);
        updateInfoBox(selectedNodes[0], selectedNodes[1], numNSP, spatialSpread, diverCity);

        isRouteComputed = true;
  
    }


function resetRoute() {
    // Clear selected nodes array
    selectedNodes = [];

    // Remove all path layers from the map
    pathLayers.forEach(layer => map.removeLayer(layer));
    pathLayers = [];

    // Remove all node markers from the map
    nodeMarkers.forEach(marker => map.removeLayer(marker));
    nodeMarkers = [];

    // Reset the info box to its default message
    updateInfoBoxDefault();

    // Reset the route computed flag
    isRouteComputed = false;
}


function parseMaxSpeed(maxspeed) {
    if (!maxspeed) return null;

    // Codici nazionali standard ISO (es. IT:motorway, DE:rural, FR:urban)
    const nationalCodes = {
        'motorway':  130, 'rural':    90,
        'urban':      50, 'living_street': 10,
        'walk':       10, 'bicycle':  25
    };

    // Controlla se è un codice tipo "IT:motorway" o "DE:rural"
    const codeMatch = maxspeed.match(/^[A-Z]{2}:(.+)$/i);
    if (codeMatch) {
        const code = codeMatch[1].toLowerCase();
        if (nationalCodes[code]) return nationalCodes[code];
        return null; // codice sconosciuto → usa default per tipo di strada
    }

    // Valore numerico (es. "130", "50 mph")
    const numericSpeed = parseInt(maxspeed);
    if (isNaN(numericSpeed)) return null;

    return maxspeed.includes('mph')
        ? Math.round(numericSpeed * 1.60934)
        : numericSpeed;
}



function updateRoutesOnParameterChange() {
    if (selectedNodes.length === 2) {
        pathLayers.forEach(layer => map.removeLayer(layer));
        pathLayers = [];
        updateInfoBoxLoading();
        setTimeout(() => computeAndDrawPaths(), 50);
    }
}


function addScaleControl() {
    // Add a scale control to the map
    L.control.scale({
        position: 'bottomleft',  // Position of the scale (options: 'bottomleft', 'bottomright', 'topleft', 'topright')
        metric: true,            // Display in metric units (kilometers)
        imperial: false,         // Disable imperial units (miles)
        maxWidth: 200            // Maximum width of the scale bar (in pixels)
    }).addTo(map);
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
