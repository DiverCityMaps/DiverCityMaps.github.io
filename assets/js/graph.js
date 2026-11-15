// ==========================
// graph.js
// Graph construction and manipulation
// Depends on: utils.js (haversineDistance, parseMaxSpeed, simplifyCoords, debugNetworkSize)
// ==========================

// Builds the routing graph. Every directed edge gets a unique integer id, so
// parallel edges (same start/end) are distinguishable everywhere downstream.
//   graph[u] = [{ n: neighborId (string), w: travel_time, a: is_attractor, id }]
//   edges[id] = { start, end, length, geometry }
//   edgeLength[id] = length in meters (weights for the weighted Jaccard)
function buildGraph(roadsData) {
    const graph = {}, nodes = {}, edges = [];

    roadsData.features.forEach(feature => {
        if (feature.geometry.type === "LineString") {
            const start = String(feature.properties.start);
            const end   = String(feature.properties.end);
            const id = edges.length;

            edges.push({
                start, end,
                length: feature.properties.length,
                geometry: feature.geometry.coordinates
            });

            if (!graph[start]) graph[start] = [];
            graph[start].push({
                n: end,
                w: feature.properties.travel_time,
                a: feature.properties.is_attractor,
                id
            });
        } else if (feature.geometry.type === "Point") {
            nodes[feature.properties.id] = feature.geometry.coordinates;
        }
    });

    const edgeLength = new Float64Array(edges.length);
    edges.forEach((e, id) => { edgeLength[id] = e.length; });

    debugNetworkSize(roadsData, nodes);

    return { graph, nodes, edges, edgeLength };
}


// Speed (km/h): explicit maxspeed if parsable, else a default per highway type.
// *_link values are heuristic (about half of the parent road: ramps are slower).
const DEFAULT_SPEED_KMH = {
    motorway: 130, motorway_link: 60,
    trunk: 110,    trunk_link: 55,
    primary: 70,   primary_link: 35,
    secondary: 60, secondary_link: 30,
    tertiary: 50, unclassified: 40, residential: 30
};
function defaultSpeedKmh(highwayType, maxspeedTag) {
    const parsed = maxspeedTag ? parseMaxSpeed(maxspeedTag) : null;
    if (parsed !== null) return parsed;
    return DEFAULT_SPEED_KMH[highwayType] || 50;
}

// Oneway semantics of OSM: explicit tag wins (yes/true/1 forward, -1/reverse
// backward, no/false/0 bidirectional); otherwise oneway is implied for
// motorways and roundabouts (junction=roundabout|circular).
function parseOneway(tags, highwayType) {
    const v = String(tags.oneway || "").toLowerCase();
    if (v === "-1" || v === "reverse") return { isOneWay: true, isReversed: true };
    if (v === "yes" || v === "true" || v === "1") return { isOneWay: true, isReversed: false };
    if (v === "no" || v === "false" || v === "0") return { isOneWay: false, isReversed: false };
    const implied = highwayType === "motorway" ||
                    tags.junction === "roundabout" || tags.junction === "circular";
    return { isOneWay: implied, isReversed: false };
}

// Keeps the largest strongly connected component (iterative Kosaraju, no
// recursion: networks have 10^5 nodes) PLUS every node with in-degree 0 or
// out-degree 0 (pure sources/sinks), which can still be an origin/destination.
// Drops edges with a removed endpoint. Returns { edges, nodes }.
function keepMainComponent(edgeFeatures, nodeFeatures) {
    const out = new Map(), inn = new Map();
    const add = (m, a, b) => { if (!m.has(a)) m.set(a, []); m.get(a).push(b); };
    for (const f of edgeFeatures) {
        const a = f.properties.start, b = f.properties.end;
        add(out, a, b); add(inn, b, a);
        if (!out.has(b)) out.set(b, []);
        if (!inn.has(a)) inn.set(a, []);
    }
    const ids = Array.from(out.keys());

    // Pass 1: finishing order on the graph
    const visited = new Set(), order = [];
    for (const r of ids) {
        if (visited.has(r)) continue;
        visited.add(r);
        const stack = [[r, 0]];
        while (stack.length) {
            const top = stack[stack.length - 1];
            const nb = out.get(top[0]);
            if (top[1] < nb.length) {
                const v = nb[top[1]++];
                if (!visited.has(v)) { visited.add(v); stack.push([v, 0]); }
            } else {
                order.push(top[0]);
                stack.pop();
            }
        }
    }

    // Pass 2: components on the reversed graph, in reverse finishing order
    const comp = new Map();
    let best = -1, bestSize = 0, c = 0;
    for (let i = order.length - 1; i >= 0; i--) {
        const r = order[i];
        if (comp.has(r)) continue;
        let size = 0;
        const stack = [r];
        comp.set(r, c);
        while (stack.length) {
            const u = stack.pop();
            size++;
            for (const v of inn.get(u)) {
                if (!comp.has(v)) { comp.set(v, c); stack.push(v); }
            }
        }
        if (size > bestSize) { bestSize = size; best = c; }
        c++;
    }

    const keep = new Set();
    for (const id of ids) {
        if (comp.get(id) === best || out.get(id).length === 0 || inn.get(id).length === 0) {
            keep.add(id);
        }
    }
    return {
        edges: edgeFeatures.filter(f => keep.has(f.properties.start) && keep.has(f.properties.end)),
        nodes: nodeFeatures.filter(f => keep.has(f.properties.id))
    };
}

function transformOSMDataToRoadsData(osmData) {

    // Step 1: Build coordinate map nodeId → [lon, lat]
    const nodeCoords = {};
    osmData.elements.forEach(el => {
        if (el.type === "node") {
            nodeCoords[el.id] = [el.lon, el.lat];
        }
    });

    // Step 2: Count how many distinct ways reference each node
    const nodeWayCount = {};
    osmData.elements.forEach(el => {
        if (el.type !== "way" || !el.nodes) return;
        const seen = new Set(el.nodes);
        seen.forEach(nodeId => {
            nodeWayCount[nodeId] = (nodeWayCount[nodeId] || 0) + 1;
        });
    });

    // Step 3: Identify true intersection nodes
    const intersectionNodes = new Set();
    osmData.elements.forEach(el => {
        if (el.type !== "way" || !el.nodes || el.nodes.length < 2) return;
        intersectionNodes.add(el.nodes[0]);
        intersectionNodes.add(el.nodes[el.nodes.length - 1]);
        for (let i = 1; i < el.nodes.length - 1; i++) {
            if ((nodeWayCount[el.nodes[i]] || 0) > 1) {
                intersectionNodes.add(el.nodes[i]);
            }
        }
    });

    // Step 4: Walk each way and emit simplified edges
    const features_edges = [];

    osmData.elements.forEach(el => {
        if (el.type !== "way" || !el.nodes || el.nodes.length < 2) return;

        const tags        = el.tags || {};
        const highwayType = tags.highway || "";
        const is_attractor = (highwayType === "motorway" || highwayType === "trunk") ? 1 : 0;

        const speed = defaultSpeedKmh(highwayType, tags.maxspeed);
        const { isOneWay, isReversed } = parseOneway(tags, highwayType);

        let segStart  = el.nodes[0];
        let segCoords = nodeCoords[segStart] ? [nodeCoords[segStart]] : [];
        let segLength = 0;

        for (let i = 1; i < el.nodes.length; i++) {
            const prevId = el.nodes[i - 1];
            const currId = el.nodes[i];

            const prevCoord = nodeCoords[prevId];
            const currCoord = nodeCoords[currId];

            if (!prevCoord || !currCoord) {
                if (intersectionNodes.has(currId) && currCoord) {
                    segStart  = currId;
                    segCoords = [currCoord];
                    segLength = 0;
                }
                continue;
            }

            const subLength = haversineDistance(
                prevCoord[1], prevCoord[0],
                currCoord[1], currCoord[0]
            );
            segLength += subLength;
            segCoords.push(currCoord);

            if (intersectionNodes.has(currId)) {
                if (segCoords.length >= 2 && segLength > 0) {
                    const travelTime = (segLength / speed) * 3600;

                    const simplifiedCoords = simplifyCoords(
                        isReversed ? segCoords.slice().reverse() : segCoords.slice()
                    );
                    const fwdStart = isReversed ? currId.toString() : segStart.toString();
                    const fwdEnd   = isReversed ? segStart.toString() : currId.toString();

                    features_edges.push({
                        type: "Feature",
                        geometry: { type: "LineString", coordinates: simplifiedCoords },
                        properties: {
                            start:        fwdStart,
                            end:          fwdEnd,
                            length:       segLength,
                            travel_time:  travelTime,
                            is_attractor: is_attractor
                        }
                    });

                    if (!isOneWay) {
                        features_edges.push({
                            type: "Feature",
                            geometry: { type: "LineString", coordinates: simplifiedCoords.slice().reverse() },
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

    const kept = keepMainComponent(features_edges, features_nodes);

    console.log(`[DiverCity] Graph simplified: ${intersectionNodes.size} intersection nodes, ${features_edges.length} edges; ` +
                `kept ${kept.nodes.length} nodes, ${kept.edges.length} edges after main-component cleanup`);

    return {
        type: "FeatureCollection",
        features: kept.edges.concat(kept.nodes)
    };
}
