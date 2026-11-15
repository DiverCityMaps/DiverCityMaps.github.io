// ==========================
// routing_worker.js
// Runs Dijkstra + path penalization off the main thread.
// Receives a lightweight graph once per network load:
//   graph[node] = [{ n, w, a, id }] (see buildGraph in graph.js)
// Protocol:
//   in : { type:'setGraph', graph, edgeCount }
//   in : { type:'compute', requestId, start, end, k, p, max_it, attractorSpeedMultiplier }
//   out: { type:'result',  requestId, allPaths, pathCosts }
// ==========================

importScripts('heap.js', 'routing.js');

let baseGraph = null;
let edgeCount = 0;

self.onmessage = function (e) {
    const msg = e.data;

    if (msg.type === 'setGraph') {
        baseGraph = msg.graph;
        edgeCount = msg.edgeCount;
        return;
    }

    if (msg.type === 'compute') {
        if (!baseGraph) {
            self.postMessage({ type: 'error', requestId: msg.requestId, error: 'Graph not loaded' });
            return;
        }
        const { allPaths, pathCosts } = computeKAlternativePaths(
            baseGraph, edgeCount, msg.start, msg.end,
            msg.k, msg.p, msg.max_it, msg.attractorSpeedMultiplier
        );
        self.postMessage({ type: 'result', requestId: msg.requestId, allPaths, pathCosts });
    }
};
