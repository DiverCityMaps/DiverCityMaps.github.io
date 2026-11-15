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

        const isReversed = tags.oneway === "-1";
        const isOneWay   = tags.oneway === "yes" || isReversed;

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

    console.log(`[DiverCity] Graph simplified: ${intersectionNodes.size} intersection nodes, ${features_edges.length} edges`);

    return {
        type: "FeatureCollection",
        features: features_edges.concat(features_nodes)
    };
}
