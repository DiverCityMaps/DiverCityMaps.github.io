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


function computeKAlternativePaths(startNode, endNode, k, p, max_it=50) {
    let allPaths = new Set(); // Store distinct paths as strings
    let pathCosts = [];       // Store path costs separately
    let tempGraph = buildGraph(); // Build the graph only ONCE
    let iterations = 0;       // Track number of iterations

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
                            coordinates: [nodes[start], nodes[end]] // Convert node IDs to coordinates
                        },
                        properties: {}
                    }));

                    let layer = L.geoJSON(geoJsonFeatures, { style: { color, weight } }).addTo(map);
                    pathLayers.push(layer);
                });
            });
        }

        function drawPathsNSPAggr(map, allPaths, pathCosts, epsilon) {
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

                        geoJsonFeatures.push({
                            type: "Feature",
                            geometry: {
                                type: "LineString",
                                coordinates: [nodes[start], nodes[end]] // Convert node IDs to coordinates
                            },
                            properties: { weight }
                        });
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