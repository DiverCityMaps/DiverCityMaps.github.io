// ==========================
// osm.js
// OSM/Overpass network download and city search
// Depends on: graph.js (transformOSMDataToRoadsData)
// ==========================

function buildOverpassQuery(filter) {
    const highways = `"highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|unclassified|residential)$"`;
    const access = `["access"!="no"]["motor_vehicle"!="no"]`;
    return `[out:json][timeout:180];(way[${highways}]${access}${filter};);out body;>;out skel qt;`;
}

// Public Overpass mirrors — each backed by the same OSM database.
// Tried in order; on failure we move to the next.
const OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter"
];

// Errors worth retrying (transient server-side issues).
// 400/403/413 = permanent query problems — don't retry.
function isTransientStatus(status) {
    return status === 429 || status === 502 || status === 503 ||
           status === 504 || status === 0;   // 0 = network error
}

function fetchOverpassFromMirror(url, query, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query),
        signal: controller.signal
    })
    .then(response => {
        clearTimeout(timer);
        if (!response.ok) {
            const err = new Error(`Overpass HTTP ${response.status}`);
            err.status = response.status;
            throw err;
        }
        return response.json();
    })
    .catch(err => {
        clearTimeout(timer);
        // Normalize aborts and network failures to status 0 (retryable)
        if (err.name === 'AbortError' || err.status === undefined) {
            const wrapped = new Error(err.message || 'Network error');
            wrapped.status = 0;
            throw wrapped;
        }
        throw err;
    });
}

// Try each mirror in order; retry transient failures; give up on permanent ones.
function fetchOverpass(query) {
    const CLIENT_TIMEOUT_MS = 90000;   // client-side ceiling, in case server hangs

    let attempt = 0;
    function tryNext() {
        if (attempt >= OVERPASS_MIRRORS.length) {
            return Promise.reject(new Error("All Overpass mirrors failed"));
        }
        const url = OVERPASS_MIRRORS[attempt++];
        console.log(`[Overpass] Trying mirror ${attempt}/${OVERPASS_MIRRORS.length}: ${new URL(url).host}`);

        return fetchOverpassFromMirror(url, query, CLIENT_TIMEOUT_MS)
            .catch(err => {
                console.warn(`[Overpass] Mirror ${new URL(url).host} failed:`, err.message);
                // Permanent errors → stop trying, surface immediately
                if (err.status && !isTransientStatus(err.status)) throw err;
                // Transient → next mirror
                return tryNext();
            });
    }

    return tryNext();
}

function downloadRoadNetwork(bbox) {
    const [s, w, n, e] = bbox.map(v => +v.toFixed(5));
    return fetchOverpass(buildOverpassQuery(`(${s},${w},${n},${e})`))
        .then(osmData => transformOSMDataToRoadsData(osmData));
}

function downloadRoadNetworkByRadius(lat, lng, radiusKm) {
    return fetchOverpass(buildOverpassQuery(`(around:${radiusKm * 1000},${lat},${lng})`))
        .then(osmData => transformOSMDataToRoadsData(osmData));
}

function searchCity(query) {
    const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5&lang=en`;
    return fetch(url)
    .then(response => response.json())
    .then(data => {
        if (!data.features || data.features.length === 0) throw new Error("City not found");

        const priorities = ['city', 'town', 'village'];
        const best = data.features.find(f =>
            priorities.includes(f.properties.type)
        ) || data.features[0];

        return {
            lat: best.geometry.coordinates[1],
            lng: best.geometry.coordinates[0],
            name: `${best.properties.name}, ${best.properties.country}`
        };
    });
}
