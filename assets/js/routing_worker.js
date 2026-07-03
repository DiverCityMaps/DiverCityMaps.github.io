// ==========================
// routing_worker.js
// Runs Dijkstra + path penalization off the main thread.
// Receives a lightweight graph once per network load:
//   graph[node] = [{ n: neighbor, w: base travel_time, a: is_attractor }]
// Protocol:
//   in : { type:'setGraph', graph }
//   in : { type:'compute', requestId, start, end, k, p, max_it, attractorSpeedMultiplier }
//   out: { type:'result',  requestId, allPaths, pathCosts }
// ==========================

importScripts('heap.js');

let baseGraph = null;

self.onmessage = function (e) {
    const msg = e.data;

    if (msg.type === 'setGraph') {
        baseGraph = msg.graph;
        return;
    }

    if (msg.type === 'compute') {
        if (!baseGraph) {
            self.postMessage({ type: 'error', requestId: msg.requestId, error: 'Graph not loaded' });
            return;
        }
        const { allPaths, pathCosts } = computeKAlternativePaths(
            baseGraph, msg.start, msg.end,
            msg.k, msg.p, msg.max_it, msg.attractorSpeedMultiplier
        );
        self.postMessage({ type: 'result', requestId: msg.requestId, allPaths, pathCosts });
    }
};


function dijkstra(graph, start, end) {
    start = String(start);
    end   = String(end);

    const distances = {};
    const previous  = {};
    const visited   = new Set();
    const pq = new Heap((a, b) => a.priority - b.priority);

    distances[start] = 0;
    pq.push({ node: start, priority: 0 });

    while (!pq.empty()) {
        const { node: u, priority } = pq.pop();

        if (priority > (distances[u] ?? Infinity)) continue;
        if (visited.has(u)) continue;
        visited.add(u);

        if (u === end) break;

        const nbrs = graph[u];
        if (!nbrs) continue;

        for (const link of nbrs) {
            const v = String(link.n);
            if (visited.has(v)) continue;
            const alt = distances[u] + link.w;
            if (alt < (distances[v] ?? Infinity)) {
                distances[v] = alt;
                previous[v]  = u;
                pq.push({ node: v, priority: alt });
            }
        }
    }

    // Reconstruct path as [from, to] edge pairs
    const path = [];
    let cur = end;
    while (previous[cur] !== undefined) {
        path.unshift([previous[cur], cur]);
        cur = previous[cur];
    }
    return path;
}


function computeKAlternativePaths(base, startNode, endNode, k, p, max_it, mult) {
    const allPaths  = new Set();
    const pathCosts = [];

    // Working copy: w = penalizable weight, bw = base cost (attractor multiplier applied)
    const temp = {};
    for (const u in base) {
        temp[u] = base[u].map(l => {
            const bw = l.a === 1 ? l.w / mult : l.w;
            return { n: l.n, w: bw, bw };
        });
    }

    let iterations = 0;
    while (allPaths.size < k && iterations < max_it) {
        const pathEdges = dijkstra(temp, startNode, endNode);
        if (pathEdges.length === 0) break;

        const key = JSON.stringify(pathEdges);
        if (!allPaths.has(key)) {
            allPaths.add(key);

            // Cost along base (un-penalized) weights
            let cost = 0;
            for (const [u, v] of pathEdges) {
                const link = temp[u] && temp[u].find(l => String(l.n) === String(v));
                if (link) cost += link.bw;
            }
            pathCosts.push(cost);

            // Cumulative penalization, both directions
            for (const [u, v] of pathEdges) {
                if (temp[u]) temp[u].forEach(l => { if (String(l.n) === String(v)) l.w *= (1 + p); });
                if (temp[v]) temp[v].forEach(l => { if (String(l.n) === String(u)) l.w *= (1 + p); });
            }
        }

        iterations++;
    }

    return { allPaths: Array.from(allPaths).map(s => JSON.parse(s)), pathCosts };
}
