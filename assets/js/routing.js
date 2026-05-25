// ==========================
// routing.js
// Dijkstra and path computation algorithms
// Depends on: graph.js (deepCopyGraph)
// Uses globals: attractorSpeedMultiplier, Heap (from heap.js)
// ==========================

function dijkstra(graph, start, end) {
    start = start.toString();
    end = end.toString();

    const distances = {};
    const previous = {};
    const edgePath = {};
    const visited = new Set();
    const pq = new Heap((a, b) => a.priority - b.priority);

    distances[start] = 0;
    pq.push({ node: start, priority: 0 });

    while (!pq.empty()) {
        const { node: minNode, priority } = pq.pop();

        if (priority > (distances[minNode] ?? Infinity)) continue;
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

    const path = [];
    let current = end;
    while (current) {
        if (edgePath[current]) path.unshift(edgePath[current]);
        current = previous[current];
    }
    return path;
}


function computeKAlternativePaths(graph, startNode, endNode, k, p, max_it = 50) {
    let allPaths = new Set();
    let pathCosts = [];
    let tempGraph = deepCopyGraph(graph, attractorSpeedMultiplier);
    let iterations = 0;

    while (allPaths.size < k && iterations < max_it) {
        let pathEdges = dijkstra(tempGraph, startNode, endNode);
        if (pathEdges.length === 0) break;

        let pathString = JSON.stringify(pathEdges.map(edge => [edge.properties.start, edge.properties.end]));

        if (!allPaths.has(pathString)) {
            allPaths.add(pathString);

            let pathCost = pathEdges.reduce((sum, edge) => {
                let cost = edge.properties.travel_time;
                if (edge.properties.is_attractor === 1) {
                    cost = cost / attractorSpeedMultiplier;
                }
                return sum + cost;
            }, 0);
            pathCosts.push(pathCost);

            pathEdges.forEach(edge => {
                let start = edge.properties.start;
                let end = edge.properties.end;

                if (tempGraph[start]) {
                    tempGraph[start].forEach(link => {
                        if (link.node === end) link.weight *= (1 + p);
                    });
                }
                if (tempGraph[end]) {
                    tempGraph[end].forEach(link => {
                        if (link.node === start) link.weight *= (1 + p);
                    });
                }
            });
        }

        iterations++;
    }

    if (iterations === max_it) {
        console.warn(`Max iterations (${max_it}) reached before finding ${k} distinct paths.`);
    }

    return { allPaths: Array.from(allPaths).map(path => JSON.parse(path)), pathCosts };
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
        for (let j = i + 1; j < n; j++) {
            let jacc = weightedJaccardSimilarity(pathList[i], pathList[j], edgeWeights);
            jaccardScores.push(jacc);
        }
    }
    return jaccardScores;
}


function computeDiverCity(paths, costList, edgeWeights, eps = 0.3) {
    let NSP = filterNearShortest(paths, costList, eps);
    let numNSP = NSP.length;

    if (numNSP === 0) return { diverCity: 0, numNSP: 0, spatialSpread: 0 };

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
