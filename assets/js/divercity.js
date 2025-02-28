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
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
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
}

function initializeEventListeners() {
    map.on('draw:created', handleAreaSelection);
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

  // Ensure this code runs after the draw control is added to the map
    setTimeout(() => {
      const drawButton = document.querySelector('.leaflet-draw-draw-rectangle');
      if (drawButton) {
        drawButton.addEventListener('click', function() {
          // Switch to OSM base layer when the draw button is clicked
          if (!map.hasLayer(osmLayer)) {
            if (map.hasLayer(edgeLayer)) {
              previousBaseLayer = edgeLayer;
              map.removeLayer(edgeLayer);
            }
            map.addLayer(osmLayer);
          }
        });
      }
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
    return { graph, nodes };
}

function initializeGraphNetwork(RoadsData) {
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
    style: styleRoads,         // Function to style roads
    filter: filterLineString   // Filter to include only LineString features
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

//function styleRoads(feature) {
//    return feature.properties.is_attractor === 1
//        ? { color: "#D0D0D0", weight: 1.5 }
//        : { color: "#D3D3D3", weight: 0.35 };
//}

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
  // bbox as [south, west, north, east]
  var bbox = [
    bounds.getSouthWest().lat,
    bounds.getSouthWest().lng,
    bounds.getNorthEast().lat,
    bounds.getNorthEast().lng
  ];

  // Clear selected nodes (if any)
  selectedNodes = [];

  // Download and transform the road network data from Overpass API
  downloadRoadNetwork(bbox)
    .then(geojsonData => {
      // Replace the current RoadsData with the newly generated one
      RoadsData = geojsonData;
      // Reinitialize the graph and update the map layers
      initializeGraphNetwork(RoadsData);
      selectedNodes = [];
      highlightNodes();
    })
    .catch(error =>
      console.error("Error fetching road network data:", error)
    );
}


// Download road network data using Overpass API
function downloadRoadNetwork(bbox) {
  // bbox: [south, west, north, east]
  let bboxStr = bbox.join(",");
  // Overpass QL query: get driveable highways within the bbox
  let query = `
    [out:json][timeout:25];
    (
      way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential)$"](${bboxStr});
    );
    out body;
    >;
    out skel qt;
  `;
  let url =
    "https://overpass-api.de/api/interpreter?data=" +
    encodeURIComponent(query);

  return fetch(url)
    .then(response => {
      if (!response.ok)
        throw new Error("Network response was not ok");
      return response.json();
    })
    .then(osmData => transformOSMDataToRoadsData(osmData));
}




function transformOSMDataToRoadsData(osmData) {

    console.log(osmData)

  let nodes = {};
  // Build a mapping of node IDs to coordinates ([lon, lat])
  osmData.elements.forEach(el => {
    if (el.type === "node") {
      nodes[el.id] = [el.lon, el.lat];
    }
  });

  let features_edges = [];
  osmData.elements.forEach(el => {
    if (el.type === "way") {
      if (!el.nodes || el.nodes.length < 2) return;

      // Determine highway type and assign a default speed (km/h)
      let highwayType = el.tags ? el.tags.highway : "";
      let speed = 50; // default speed


      // Get maxspeed from OSM tags if present
      if (el.tags && el.tags.maxspeed) {
        speed = parseMaxSpeed(el.tags.maxspeed);
        console.log("parsed - ", speed)
      } else {
        // Fallback to default speed per road type
        if (highwayType === "motorway") speed = 100;
        else if (highwayType === "trunk") speed = 80;
        else if (highwayType === "primary") speed = 60;
        else if (highwayType === "secondary") speed = 50;
        else if (highwayType === "tertiary") speed = 40;
        else if (highwayType === "residential") speed = 30;
      }
      
      // Flag attractor roads (e.g., motorway or trunk)
      let is_attractor = (highwayType === "motorway" || highwayType === "trunk") ? 1 : 0;
      
      // Check if the road is one-way.
      // OSM typically uses the "oneway" tag with value "yes" (or sometimes "-1" for reverse one-way).
      let isOneWay = el.tags && (el.tags.oneway === "yes" || el.tags.oneway === "-1");
      
      // Create an edge for each consecutive pair of nodes in the way
      for (let i = 1; i < el.nodes.length; i++) {
        let start = el.nodes[i - 1];
        let end = el.nodes[i];
        if (!nodes[start] || !nodes[end]) continue;
        let seg_coords = [nodes[start], nodes[end]];
        // Compute segment length (in kilometers)
        let seg_length = haversineDistance(
          nodes[start][1], nodes[start][0],
          nodes[end][1], nodes[end][0]
        );
        // Compute travel time (in hours)
        let seg_travel_time = (seg_length / speed) * 3600;
        
        let feature = {
          type: "Feature",
          geometry: { type: "LineString", coordinates: seg_coords },
          properties: {
            start: start.toString(),
            end: end.toString(),
            length: seg_length,
            travel_time: seg_travel_time,
            is_attractor: is_attractor
          }
        };
        features_edges.push(feature);
        
        // If the road is not one-way, also add the reverse edge.
        if (!isOneWay) {
          let reverseFeature = {
            type: "Feature",
            geometry: { type: "LineString", coordinates: seg_coords.slice().reverse() },
            properties: {
              start: end.toString(),
              end: start.toString(),
              length: seg_length,
              travel_time: seg_travel_time,
              is_attractor: is_attractor
            }
          };
          features_edges.push(reverseFeature);
        }
      }
    }
  });

  // Create Point features for nodes (for markers or info)
  let features_nodes = [];
  for (let nodeId in nodes) {
    let feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: nodes[nodeId] },
      properties: { id: nodeId.toString() }
    };
    features_nodes.push(feature);
  }

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
        setTimeout(() => computeAndDrawPaths(), 0);
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
            style: feature => ({
                color: color,
                weight: feature.properties.weight
            })
        }).addTo(map);

        pathLayers.push(layer);
    });
}





/* Graph Utils */

function dijkstra(graph, start, end) {
  // Convert start and end to strings for consistency
  start = start.toString();
  end = end.toString();

  let distances = {};
  let previous = {};
  let pq = new Heap((a, b) => a.priority - b.priority); // Min Heap
  let edgePath = {};

  // Initialize distances and previous for every node in the graph
  for (let node in graph) {
    distances[node] = Infinity;
    previous[node] = null;
  }
  distances[start] = 0;
  pq.push({ node: start, priority: 0 });

  while (!pq.empty()) {
    let { node: minNode } = pq.pop();

    // Check if minNode exists in the graph
    if (!graph[minNode]) {
      console.error("Node not found in graph:", minNode);
      continue;
    }

    if (minNode === end) break;

    for (let neighbor of graph[minNode]) {
      let alt = distances[minNode] + neighbor.weight;
      // Ensure neighbor.node is a string
      let neighborId = neighbor.node.toString();
      if (alt < distances[neighborId]) {
        distances[neighborId] = alt;
        previous[neighborId] = minNode;
        pq.push({ node: neighborId, priority: alt });
        edgePath[neighborId] = neighbor.feature;
      }
    }
  }

  // Build the path by walking backward from the end node
  let path = [];
  let current = end;
  while (current) {
    if (edgePath[current]) {
      path.unshift(edgePath[current]);
    }
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
    infoBox.innerHTML = "<strong>Route Info</strong><br>Click to select origin and destination.";
    document.body.appendChild(infoBox);

    window.updateInfoBox = function (origin, destination, NSP_count, spatialSpread, diverCityScore) {
        let originCoords = nodes[origin];
        let destinationCoords = nodes[destination];

        let originLat = originCoords[1];
        let originLng = originCoords[0];
        let destinationLat = destinationCoords[1];
        let destinationLng = destinationCoords[0];

        let distance = haversineDistance(originLat, originLng, destinationLat, destinationLng);

        infoBox.innerHTML = `
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">Route Info</div>
            <strong>Origin:</strong> ${origin} <br>
            <strong>Destination:</strong> ${destination} <br>
            <strong>OD Distance:</strong> ${distance.toFixed(2)} km <br>
            <hr style="margin: 5px 0;">
            <strong>#NSR:</strong> ${NSP_count} <br>
            <strong>Spatial Spread:</strong> ${spatialSpread.toFixed(2)} <br>
            <div style="font-size: 16px; font-weight: bold; margin-top: 5px;">
                DiverCity: ${diverCityScore.toFixed(2)}
            </div>
        `;
    };

    window.updateInfoBoxDefault = function() {
        infoBox.innerHTML = `
            <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">Route Info</div>
            Click to select origin and destination.
        `;
    };
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
                <span class="legend-line" style="background: orange;"></span> Attractor Road
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
    let { allPaths, pathCosts } = computeKAlternativePaths(graph, selectedNodes[0], selectedNodes[1], k, p, max_it);

    // Draw paths with aggregation
    drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon);

    // Convert paths to edge weights for DiverCity metrics
    let edgeWeights = {};
    RoadsData.features.forEach(feature => {
        if (feature.geometry.type === "LineString") {
            let edge = [feature.properties.start, feature.properties.end];
            edgeWeights[edge] = feature.properties.length;
        }
    });

    // Compute DiverCity metrics
    let { diverCity, numNSP, spatialSpread } = computeDiverCity(allPaths, pathCosts, edgeWeights, epsilon);

    // Update the information box with the computed metrics
    updateInfoBox(selectedNodes[0], selectedNodes[1], numNSP, spatialSpread, diverCity);

    // Set the route computed flag to true
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


// Function to parse maxspeed values
function parseMaxSpeed(maxspeed) {
  if (!maxspeed) return 50; // Default to 50 km/h if not provided

  let speed = 50;
  // Extract numeric value
  let numericSpeed = parseInt(maxspeed.replace(/\D/g, ''));
  if (isNaN(numericSpeed)) return speed;

  // Check for units (assume km/h if none specified)
  if (maxspeed.includes('mph')) {
    speed = Math.round(numericSpeed * 1.60934); // Convert mph to km/h
  } else {
    speed = numericSpeed; // Assume km/h if no units specified
  }
  return speed;
}



function updateRoutesOnParameterChange() {
    // Check if two nodes are selected
    if (selectedNodes.length === 2) {
        console.log("Recomputing routes with updated parameters...");

        // Clear existing routes
        pathLayers.forEach(layer => map.removeLayer(layer));
        pathLayers = [];

        // Recompute and redraw paths with the new parameter values
        computeAndDrawPaths();
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
