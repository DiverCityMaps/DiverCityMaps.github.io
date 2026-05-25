// ==========================
// osm.js
// OSM/Overpass network download and city search
// Depends on: graph.js (transformOSMDataToRoadsData)
// ==========================

function buildOverpassQuery(filter) {
    const highways = `"highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|unclassified|residential)$"`;
    const access = `["access"!="no"]["motor_vehicle"!="no"]`;
    return `[out:json][timeout:120];(way[${highways}]${access}${filter};);out body;>;out skel qt;`;
}

function fetchOverpass(query) {
    return fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: "data=" + encodeURIComponent(query)
    })
    .then(response => {
        if (!response.ok) throw new Error(`Overpass error: HTTP ${response.status}`);
        return response.json();
    })
    .catch(error => {
        console.error("Overpass fetch failed:", error.message);
        throw error;
    });
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
