
var map = []
let selectedNodes = [];
let pathLayers = [];
let nodeMarkers = [];
let isRouteComputed = false; // Flag to track if a route has been computed

let k = 5, p = 0.1, epsilon = 0.3;
let max_it = 100;


document.addEventListener('DOMContentLoaded', function() {
    // Initialize the map
    var map = L.map('map', {
        center: [0, 0],
        zoom: 2,
        zoomSnap: 0.25,
        zoomDelta: 0.5,
        maxZoom: 22,
        minZoom: 1,
        layers: []
    });

    // OSM Layer (standard layer)
    const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    });



    // Build the graph and nodes from RoadsData (which must be defined globally)
    let { graph, nodes } = buildGraph(RoadsData);

    let edgeLayer = L.geoJSON(RoadsData, {
        style: function (feature) {
            return { color: "grey", weight: 0.5 };
        },
        filter: function(feature) {
            return feature.geometry.type === "LineString";
        }
    }).addTo(map);


    // Add OSM layer to the map, but keep it deselected initially
    let baseLayers = {
        "Roads Data": edgeLayer,  // Roads data will be selected by default
        "OSM": osmLayer           // OSM layer will be available but deselected
    };

    // Overlay layers (you can add other layers like your graph data or edge layers)
    let overlayLayers = {};

    // Create the layer control and add it to the map
    L.control.layers(baseLayers, overlayLayers, {collapsed: false}).addTo(map);

    // Initially, add Roads Data to the map
    edgeLayer.addTo(map);


    function findClosestNode(latlng) {
        let minDist = Infinity;
        let closestNode = null;
        for (let nodeId in nodes) {
            let nodeCoords = nodes[nodeId];
            let dist = Math.sqrt(Math.pow(nodeCoords[1] - latlng.lat, 2) + Math.pow(nodeCoords[0] - latlng.lng, 2));
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

    // Add the destination marker first (in case of multiple selections)
    selectedNodes.forEach((nodeId, index) => {
        let color = index === 0 ? "green" : "red";
        
        // Create a marker for the destination node (after the origin node)
        let marker = L.marker([nodes[nodeId][1], nodes[nodeId][0]], {
            draggable: true,  // Enable dragging
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
                iconAnchor: [10, 10]  // Center the icon
            })
        }).addTo(map);
        nodeMarkers.push(marker);

        // Add a listener for when the marker is dragged
        marker.on('dragend', function (e) {
            let closestNode = findClosestNode(e.target.getLatLng());
            selectedNodes[index] = closestNode;

            // Trigger the recalculation of the routes after dragging
            if (selectedNodes.length === 2) {
                let { allPaths, pathCosts } = computeKAlternativePaths(graph, selectedNodes[0], selectedNodes[1], k, p, max_it=max_it);
                drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon);

                // Compute DiverCity metrics
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










    // Create the info box dynamically and position it just below the zoom controls
    var infoBox = L.DomUtil.create("div", "info-box");
    infoBox.innerHTML = "<strong>Route Info</strong><br>Select two nodes to see details.";
    document.body.appendChild(infoBox);

    // Function to update the info box when selecting nodes
        function updateInfoBox(origin, destination, NSP_count, spatialSpread, diverCityScore) {
            infoBox.innerHTML = `
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">Route Info</div>
                <strong>Origin:</strong> ${origin} <br>
                <strong>Destination:</strong> ${destination} <br>
                <hr style="margin: 5px 0;">
                <strong>#NSR:</strong> ${NSP_count} <br>
                <strong>Spatial Spread:</strong> ${spatialSpread.toFixed(2)} <br>
                <div style="font-size: 16px; font-weight: bold; margin-top: 5px;">
                    DiverCity: ${diverCityScore.toFixed(2)}
                </div>
            `;
        }

        function updateInfoBoxDefault() {
            infoBox.innerHTML = `
                <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">Route Info</div>
                Select two nodes to see details.
            `;
        }


        // Create sliders container with a toggleable section and tooltips
    var sliderContainer = L.DomUtil.create("div", "slider-container");
    sliderContainer.innerHTML = `
        <div class="slider-header" id="slider-toggle">
            Adjust Parameters
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


        // Toggle the visibility of the slider content
        document.getElementById("slider-toggle").addEventListener("click", function() {
            var sliderContent = document.getElementById("slider-content");
            if (sliderContent.style.display === "none") {
                sliderContent.style.display = "block";
            } else {
                sliderContent.style.display = "none";
            }
        });

        // Event listeners for sliders
        document.getElementById("slider-k").addEventListener("input", function() {
            k = parseInt(this.value);
            document.getElementById("value-k").innerText = k;
        });

        document.getElementById("slider-p").addEventListener("input", function() {
            p = parseFloat(this.value);
            document.getElementById("value-p").innerText = p.toFixed(2);
        });

        document.getElementById("slider-eps").addEventListener("input", function() {
            epsilon = parseFloat(this.value);
            document.getElementById("value-eps").innerText = epsilon.toFixed(2);
        });

        document.getElementById("slider-max-it").addEventListener("input", function() {
            max_it = parseInt(this.value);
            document.getElementById("value-max-it").innerText = max_it;
        });




        // Create a legend control and add it to the bottom-right of the map
        var legend = L.control({ position: "bottomright" });

        legend.onAdd = function (map) {
            let div = L.DomUtil.create("div", "legend-box");

            div.innerHTML = `
                <strong>Legend</strong>
                <div class="legend-item">
                    <span class="legend-line" style="background: darkblue;"></span> NSR (Near Shortest Route)
                </div>
                <div class="legend-item">
                    <span class="legend-line" style="background: red;"></span> Non-NSR
                </div>
            `;

            return div;
        };

        legend.addTo(map);

        // Add styles for the legend
        var legendCSS = document.createElement("style");
        legendCSS.innerHTML = `
            .legend-box {
                background: rgba(255, 255, 255, 0.9);
                border-radius: 8px;
                padding: 6px 10px; /* Smaller padding */
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
                font-family: Arial, sans-serif;
                font-size: 12px; /* Smaller text */
                color: #333;
                line-height: 16px;
            }
            .legend-item {
                display: flex;
                align-items: center;
                margin-top: 3px;
            }
            .legend-line {
                width: 25px; /* Slightly smaller width */
                height: 4px;  /* Thinner line */
                margin-right: 6px;
                display: inline-block;
                border-radius: 2px;
            }
        `;
        document.head.appendChild(legendCSS);

    map.on('click', function(event) {
    // Reset if a route was computed previously
    if (isRouteComputed) {
        selectedNodes = [];
        pathLayers.forEach(layer => map.removeLayer(layer));
        pathLayers = [];
        nodeMarkers.forEach(marker => map.removeLayer(marker));
        nodeMarkers = [];
        updateInfoBoxDefault();
        isRouteComputed = false;
    }

    let closestNode = findClosestNode(event.latlng);
    if (closestNode) {
        selectedNodes.push(closestNode);
        highlightNodes();
        console.log("node selected, it should be updated");
    }

    if (selectedNodes.length === 2) {
        // Use setTimeout to allow the marker to be rendered immediately
        setTimeout(() => {
            let { allPaths, pathCosts } = computeKAlternativePaths(graph, selectedNodes[0], selectedNodes[1], k, p, max_it);
            drawPathsNSPAggr(map, graph, nodes, allPaths, pathCosts, epsilon);

            // Convert paths to edge weights
            let edgeWeights = {};
            RoadsData.features.forEach(feature => {
                if (feature.geometry.type === "LineString") {
                    let edge = [feature.properties.start, feature.properties.end];
                    edgeWeights[edge] = feature.properties.length;
                }
            });

            // Compute DiverCity metrics
            let { diverCity, numNSP, spatialSpread } = computeDiverCity(allPaths, pathCosts, edgeWeights, epsilon);
            updateInfoBox(selectedNodes[0], selectedNodes[1], numNSP, spatialSpread, diverCity);
            isRouteComputed = true;
        }, 0);
    }
});




    map.fitBounds(edgeLayer.getBounds());
});


function buildGraph(roadsData) {
  let graph = {};
  let nodes = {};  // Declare nodes locally

  roadsData.features.forEach(feature => {
    if (feature.geometry.type === "LineString") {
      let start = feature.properties.start;
      let end = feature.properties.end;
      feature.properties.tmp_travel_time = feature.properties.travel_time;

      if (!graph[start]) {
        graph[start] = [];
      }
      graph[start].push({
        node: end,
        weight: feature.properties.tmp_travel_time,
        geometry: feature.geometry.coordinates,
        feature });

    } else if (feature.geometry.type === "Point") {
      nodes[feature.properties.id] = feature.geometry.coordinates;
    }
  });

  return { graph, nodes };
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

function logDiverCity(paths, costList, edgeWeights) {
    let formattedEdgeWeights = {};
    Object.keys(edgeWeights).forEach(edge => {
        let key = edge.split(',').map(Number).join(',');
        formattedEdgeWeights[key] = edgeWeights[edge];
    });

    let divercityScore = computeDiverCity(paths, costList, formattedEdgeWeights);
    console.log("DiverCity Score:", divercityScore);
}


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

    console.log(pathCosts)

    return { allPaths: Array.from(allPaths).map(path => JSON.parse(path)), pathCosts }; // Convert back to array format
}




/* Path-drawing functions */

 function drawPathsNSP(map, allPaths, pathCosts, epsilon) {
    // Remove existing path layers
    pathLayers.forEach(layer => map.removeLayer(layer));
    pathLayers = [];

    // Define path categories and corresponding styles
    const pathCategories = [
        { paths: filterNoNearShortest(allPaths, pathCosts, epsilon), color: "red", weight: 3 },  // NON-NSP
        { paths: filterNearShortest(allPaths, pathCosts, epsilon), color: "darkblue", weight: 5 }      // NSP
    ];

    // Log path counts
    pathCategories.forEach(({ paths }) => console.log(paths.length));

    // Loop over each category and draw paths
    pathCategories.forEach(({ paths, color, weight }) => {
        paths.forEach(pathEdges => {
            let geoJsonFeatures = pathEdges.map(([start, end]) => ({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [nodes[start], nodes[end]]
                },
                properties: {}
            }));

            let layer = L.geoJSON(geoJsonFeatures, { style: { color, weight } }).addTo(map);
            pathLayers.push(layer);
        });
    });
}


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
    let distances = {};
    let previous = {};
    let pq = new Heap((a, b) => a.priority - b.priority); // Min Heap
    let edgePath = {};

    for (let node in graph) {
        distances[node] = Infinity;
        previous[node] = null;
    }
    distances[start] = 0;
    pq.push({ node: start, priority: 0 });

    while (!pq.empty()) {
        let { node: minNode } = pq.pop(); // Fastest extraction

        if (minNode == end) break;

        for (let neighbor of graph[minNode]) {
            let alt = distances[minNode] + neighbor.weight;
            if (alt < distances[neighbor.node]) {
                distances[neighbor.node] = alt;
                previous[neighbor.node] = minNode;
                pq.push({ node: neighbor.node, priority: alt });
                edgePath[neighbor.node] = neighbor.feature;
            }
        }
    }

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
