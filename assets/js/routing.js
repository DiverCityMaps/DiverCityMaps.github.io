// ==========================
// routing.js
// Dijkstra, path penalization and DiverCity metrics.
// Pure logic, no DOM: loaded both by the page and by routing_worker.js
// (importScripts), so there is a single implementation of the algorithm.
// Depends on: Heap (heap.js)
//
// Graph format (see buildGraph in graph.js):
//   graph[u] = [{ n, w, a, id }]   n: neighbor id (string), w: base travel time,
//                                 a: is_attractor, id: unique edge id.
// A path is an array of edge ids.
// ==========================

// Dijkstra on per-edge weights W (indexed by edge id). Returns the list of edge ids.
function dijkstra(graph, W, start, end) {
    start = String(start);
    end = String(end);

    const distances = {};
    const prevNode = {};
    const prevEdge = {};
    const visited = new Set();
    const pq = new Heap((a, b) => a.priority - b.priority);

    distances[start] = 0;
    pq.push({ node: start, priority: 0 });

    while (!pq.empty()) {
        const { node: u, priority } = pq.pop();

        if (priority > (distances[u] ?? Infinity)) continue;
        if (visited.has(u)) continue;
        visited.add(u);

        if (u === end) break;

        const links = graph[u];
        if (!links) continue;

        for (const link of links) {
            const v = link.n;
            if (visited.has(v)) continue;
            const alt = distances[u] + W[link.id];
            if (alt < (distances[v] ?? Infinity)) {
                distances[v] = alt;
                prevNode[v] = u;
                prevEdge[v] = link.id;
                pq.push({ node: v, priority: alt });
            }
        }
    }

    const path = [];
    let cur = end;
    while (prevEdge[cur] !== undefined) {
        path.push(prevEdge[cur]);
        cur = prevNode[cur];
    }
    return path.reverse();
}


// Path penalization: at each iteration take the shortest path under the current
// weights, then multiply the weight of its (directed) edges by (1 + p);
// the opposite direction is NOT penalized. The penalization is cumulative and
// applied at EVERY iteration, even when the path was already found, so repeated paths keep getting more expensive.
// pathCosts are computed on the base (non-penalized) weights, with the attractor
// speed multiplier applied.
function computeKAlternativePaths(graph, edgeCount, startNode, endNode, k, p, max_it = 50, mult = 1.0) {
    const found = new Set();
    const allPaths = [];
    const pathCosts = [];

    const BW = new Float64Array(edgeCount);   // base weights (attractor multiplier applied)
    for (const u in graph) {
        for (const l of graph[u]) {
            BW[l.id] = l.a === 1 ? l.w / mult : l.w;
        }
    }
    const W = Float64Array.from(BW);          // penalizable weights

    let iterations = 0;
    while (allPaths.length < k && iterations < max_it) {
        iterations++;

        const path = dijkstra(graph, W, startNode, endNode);
        if (path.length === 0) break;

        const key = path.join(',');
        if (!found.has(key)) {
            found.add(key);
            allPaths.push(path);
            pathCosts.push(path.reduce((sum, id) => sum + BW[id], 0));
        }

        // Directed penalization: only the traversed edge (a->b), not b->a.
        for (const id of path) W[id] *= (1 + p);
    }

    if (allPaths.length < k) {
        console.warn(`Found ${allPaths.length}/${k} distinct paths after ${iterations} iterations (max_it=${max_it}).`);
    }

    return { allPaths, pathCosts };
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


// Weighted Jaccard between two paths (arrays of edge ids).
// edgeWeights[id] = weight of edge id (length in meters).
// Edges are directed: a->b and b->a are different edges.
function weightedJaccardSimilarity(list1, list2, edgeWeights) {
    const set1 = new Set(list1);
    const set2 = new Set(list2);

    let intersectionWeight = 0;
    let unionWeight = 0;
    for (const id of set1) {
        const w = edgeWeights[id] || 0;
        unionWeight += w;
        if (set2.has(id)) intersectionWeight += w;
    }
    for (const id of set2) {
        if (!set1.has(id)) unionWeight += edgeWeights[id] || 0;
    }

    return unionWeight > 0 ? intersectionWeight / unionWeight : 0;
}


function jaccardPairwiseWeighted(pathList, edgeWeights) {
    let jaccardScores = [];
    let n = pathList.length;

    if (n <= 1) return [1];

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            jaccardScores.push(weightedJaccardSimilarity(pathList[i], pathList[j], edgeWeights));
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
