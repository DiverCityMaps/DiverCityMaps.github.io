// ==========================
// utils.js
// Pure utility functions — no dependencies on other DiverCity modules
// ==========================

function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

function parseMaxSpeed(maxspeed) {
    if (!maxspeed) return null;

    const nationalCodes = {
        'motorway': 130, 'rural': 90,
        'urban': 50, 'living_street': 10,
        'walk': 10, 'bicycle': 25
    };

    const codeMatch = maxspeed.match(/^[A-Z]{2}:(.+)$/i);
    if (codeMatch) {
        const code = codeMatch[1].toLowerCase();
        if (nationalCodes[code]) return nationalCodes[code];
        return null;
    }

    const numericSpeed = parseInt(maxspeed);
    if (isNaN(numericSpeed)) return null;

    return maxspeed.includes('mph')
        ? Math.round(numericSpeed * 1.60934)
        : numericSpeed;
}

function simplifyCoords(coords, tolerance = 0.00005) {
    if (coords.length <= 2) return coords;
    const result = [coords[0]];
    for (let i = 1; i < coords.length - 1; i++) {
        const [x0, y0] = result[result.length - 1];
        const [x1, y1] = coords[i];
        const [x2, y2] = coords[i + 1];
        const denom = Math.sqrt((y2-y0)**2 + (x2-x0)**2);
        if (denom === 0) continue;
        const d = Math.abs((y2-y0)*(x1-x0) - (x2-x0)*(y1-y0)) / denom;
        if (d > tolerance) result.push(coords[i]);
    }
    result.push(coords[coords.length - 1]);
    return result;
}

function debugNetworkSize(roadsData, nodes) {
    const edges = roadsData.features.filter(f => f.geometry.type === "LineString");
    const totalCoords = edges.reduce((sum, f) => sum + f.geometry.coordinates.length, 0);
    const sizeBytes = new TextEncoder().encode(JSON.stringify(roadsData)).length;

    console.log(`--- Network Size Debug ---`);
    console.log(`Edges: ${edges.length}`);
    console.log(`Nodes: ${Object.keys(nodes).length}`);
    console.log(`Total coords: ${totalCoords}`);
    console.log(`Avg coords per edge: ${(totalCoords/edges.length).toFixed(1)}`);
    console.log(`Data size: ${(sizeBytes/1024/1024).toFixed(2)} MB`);
}
