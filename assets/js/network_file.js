// ==========================
// network_file.js
// Save / open a road network as a file (pure functions, no DOM).
// Format (JSON):
//   { format: "divercity-network", version: 1,
//     meta: { name, source, downloadedAt, osmBaseTimestamp, converterVersion },
//     roadsData: FeatureCollection  (same shape as data/road_networks/rome.js) }
// Opened files are untrusted: validateNetworkFile checks everything that
// buildGraph / the map rely on, and never evaluates anything.
// ==========================

const NETWORK_FILE_FORMAT  = 'divercity-network';
const NETWORK_FILE_VERSION = 1;
// Bump when transformOSMDataToRoadsData changes what it produces
// (2 = oneway/roundabout/motorway rules, *_link speeds, main-component cleanup).
const NETWORK_CONVERTER_VERSION = 2;
const MAX_NETWORK_FEATURES   = 1500000;
const MAX_NETWORK_FILE_BYTES = 250 * 1024 * 1024;

function _round5(v) { return Math.round(v * 1e5) / 1e5; }

function _validLonLat(c) {
    return Array.isArray(c) && c.length >= 2 &&
           Number.isFinite(c[0]) && Number.isFinite(c[1]) &&
           Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;
}

function _cleanSource(src) {
    if (!src || typeof src !== 'object') return { type: 'unknown' };
    if (src.type === 'radius' && Number.isFinite(src.lat) && Number.isFinite(src.lng) && Number.isFinite(src.r)) {
        return { type: 'radius', lat: src.lat, lng: src.lng, r: src.r };
    }
    if (src.type === 'bbox' && Array.isArray(src.bbox) && src.bbox.length === 4 && src.bbox.every(Number.isFinite)) {
        return { type: 'bbox', bbox: src.bbox.slice() };
    }
    if (src.type === 'default') return { type: 'default' };
    return { type: 'unknown' };
}

// Returns the file content as a JSON string. Coordinates are rounded to 5
// decimals (~1 m, as in rome.js): they only affect drawing and click snapping.
function serializeNetwork(roadsData, source, name) {
    const features = roadsData.features.map(f => {
        if (f.geometry.type === 'LineString') {
            return {
                type: 'Feature',
                geometry: { type: 'LineString',
                            coordinates: f.geometry.coordinates.map(c => [_round5(c[0]), _round5(c[1])]) },
                properties: f.properties
            };
        }
        return {
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [_round5(f.geometry.coordinates[0]), _round5(f.geometry.coordinates[1])] },
            properties: f.properties
        };
    });

    return JSON.stringify({
        format: NETWORK_FILE_FORMAT,
        version: NETWORK_FILE_VERSION,
        meta: {
            name: String(name || ''),
            source: _cleanSource(source),
            downloadedAt: new Date().toISOString(),
            osmBaseTimestamp: roadsData.osmBaseTimestamp || null,
            converterVersion: NETWORK_CONVERTER_VERSION
        },
        roadsData: { type: 'FeatureCollection', features }
    });
}

// Returns { ok: true, roadsData, meta } or { ok: false, error }.
function validateNetworkFile(obj) {
    const fail = error => ({ ok: false, error });

    if (!obj || typeof obj !== 'object') return fail('Not a DiverCity network file.');
    if (obj.format !== NETWORK_FILE_FORMAT) return fail('Not a DiverCity network file.');
    if (obj.version !== NETWORK_FILE_VERSION) return fail('Unsupported file version: ' + String(obj.version).slice(0, 20));

    const rd = obj.roadsData;
    if (!rd || rd.type !== 'FeatureCollection' || !Array.isArray(rd.features)) return fail('Missing road network data.');
    if (rd.features.length === 0) return fail('The network is empty.');
    if (rd.features.length > MAX_NETWORK_FEATURES) return fail('The network is too large.');

    const nodeIds = new Set();
    let edgeCount = 0;
    for (const f of rd.features) {
        if (!f || !f.geometry || !f.properties) return fail('Malformed feature.');
        const g = f.geometry, p = f.properties;
        if (g.type === 'Point') {
            if (!_validLonLat(g.coordinates)) return fail('Invalid node coordinates.');
            if (typeof p.id !== 'string' && !Number.isFinite(p.id)) return fail('Invalid node id.');
            nodeIds.add(String(p.id));
        } else if (g.type === 'LineString') {
            if (!Array.isArray(g.coordinates) || g.coordinates.length < 2 || !g.coordinates.every(_validLonLat)) {
                return fail('Invalid edge geometry.');
            }
            for (const k of ['start', 'end']) {
                if (typeof p[k] !== 'string' && !Number.isFinite(p[k])) return fail('Invalid edge endpoint.');
            }
            if (!Number.isFinite(p.length) || p.length < 0) return fail('Invalid edge length.');
            if (!Number.isFinite(p.travel_time) || p.travel_time <= 0) return fail('Invalid edge travel time.');
            if (p.is_attractor !== 0 && p.is_attractor !== 1) return fail('Invalid attractor flag.');
            edgeCount++;
        } else {
            return fail('Unsupported geometry type.');
        }
    }
    if (edgeCount === 0) return fail('The network has no edges.');

    for (const f of rd.features) {
        if (f.geometry.type !== 'LineString') continue;
        if (!nodeIds.has(String(f.properties.start)) || !nodeIds.has(String(f.properties.end))) {
            return fail('An edge refers to a missing node.');
        }
    }

    const m = (obj.meta && typeof obj.meta === 'object') ? obj.meta : {};
    return {
        ok: true,
        roadsData: rd,
        meta: {
            name: typeof m.name === 'string' ? m.name.slice(0, 200) : '',
            source: _cleanSource(m.source),
            downloadedAt: typeof m.downloadedAt === 'string' ? m.downloadedAt.slice(0, 40) : null,
            osmBaseTimestamp: typeof m.osmBaseTimestamp === 'string' ? m.osmBaseTimestamp.slice(0, 40) : null,
            converterVersion: Number.isFinite(m.converterVersion) ? m.converterVersion : null
        }
    };
}
