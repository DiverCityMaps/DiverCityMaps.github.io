// Standalone tests for saving / opening a network file (no browser, no framework).
// Run: node tests/test_network_file.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console: { log() {}, warn: console.warn, error: console.error }, TextEncoder });
for (const f of ['utils.js', 'graph.js', 'network_file.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', f), 'utf8'), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);
const plain = o => JSON.parse(JSON.stringify(o));   // move across realms

function edge(start, end, length, tt, attr = 0, coords = [[12.1, 41.1], [12.2, 41.2]]) {
    return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords },
             properties: { start, end, length, travel_time: tt, is_attractor: attr } };
}
function pt(id, lon, lat) {
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties: { id } };
}
function network() {
    return {
        type: 'FeatureCollection',
        osmBaseTimestamp: '2026-11-15T10:00:00Z',
        features: [
            edge('1', '2', 100.123456789, 12.3456789, 0, [[12.123456789, 41.987654321], [12.2, 41.2]]),
            edge('2', '1', 100.123456789, 12.3456789),
            edge('1', '2', 250.5, 30.1, 1),                 // parallel edge
            pt('1', 12.123456789, 41.987654321), pt('2', 12.2, 41.2)
        ]
    };
}
function save(rd = network(), src = { type: 'bbox', bbox: [41, 12, 42, 13] }, name = 'Test') {
    ctx.__rd = rd; ctx.__src = src; ctx.__name = name;
    return run('serializeNetwork(__rd, __src, __name)');
}
function validate(obj) {
    ctx.__o = obj;
    return plain(run('validateNetworkFile(__o)'));
}
const edit = fn => { const o = JSON.parse(save()); fn(o); return o; };

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('roundtrip: the opened graph has the same edges, ids and weights', () => {
    const original = network();
    const res = validate(JSON.parse(save(original)));
    assert.ok(res.ok, res.error);
    ctx.__a = original; ctx.__b = res.roadsData;
    const ga = plain(run('(({graph, edges, edgeLength}) => ({graph, edges: edges.map(e => [e.start, e.end, e.length]), el: Array.from(edgeLength)}))(buildGraph(__a))'));
    const gb = plain(run('(({graph, edges, edgeLength}) => ({graph, edges: edges.map(e => [e.start, e.end, e.length]), el: Array.from(edgeLength)}))(buildGraph(__b))'));
    assert.deepStrictEqual(gb, ga);
});

test('coordinates are rounded to 5 decimals, weights are kept exactly', () => {
    const res = validate(JSON.parse(save()));
    const f = res.roadsData.features[0];
    assert.deepStrictEqual(f.geometry.coordinates[0], [12.12346, 41.98765]);
    assert.strictEqual(f.properties.length, 100.123456789);
    assert.strictEqual(f.properties.travel_time, 12.3456789);
});

test('metadata is saved and read back (source, OSM timestamp, converter version)', () => {
    const res = validate(JSON.parse(save()));
    assert.strictEqual(res.meta.name, 'Test');
    assert.deepStrictEqual(res.meta.source, { type: 'bbox', bbox: [41, 12, 42, 13] });
    assert.strictEqual(res.meta.osmBaseTimestamp, '2026-11-15T10:00:00Z');
    assert.strictEqual(res.meta.converterVersion, 2);
    assert.ok(!isNaN(Date.parse(res.meta.downloadedAt)));
});

test('numeric ids (as in rome.js) are accepted', () => {
    const rd = network();
    rd.features = [edge(21638011, 370042353, 10, 1), edge(370042353, 21638011, 10, 1),
                   pt(21638011, 12.1, 41.1), pt(370042353, 12.2, 41.2)];
    assert.ok(validate(JSON.parse(save(rd))).ok);
});

const rejects = [
    ['wrong format', o => { o.format = 'geojson'; }],
    ['newer version', o => { o.version = 2; }],
    ['not a FeatureCollection', o => { o.roadsData.type = 'Feature'; }],
    ['empty network', o => { o.roadsData.features = []; }],
    ['unsupported geometry', o => { o.roadsData.features[0].geometry.type = 'Polygon'; }],
    ['NaN travel time (null in JSON)', o => { o.roadsData.features[0].properties.travel_time = null; }],
    ['zero travel time', o => { o.roadsData.features[0].properties.travel_time = 0; }],
    ['negative length', o => { o.roadsData.features[0].properties.length = -1; }],
    ['bad attractor flag', o => { o.roadsData.features[0].properties.is_attractor = 2; }],
    ['edge coordinates out of range', o => { o.roadsData.features[0].geometry.coordinates[0] = [500, 41]; }],
    ['edge with one coordinate', o => { o.roadsData.features[0].geometry.coordinates = [[12, 41]]; }],
    ['node coordinates out of range', o => { o.roadsData.features[3].geometry.coordinates = [12, 95]; }],
    ['edge refers to a missing node', o => { o.roadsData.features[0].properties.end = '999'; }],
    ['missing properties', o => { delete o.roadsData.features[0].properties; }],
    ['no edges, only nodes', o => { o.roadsData.features = o.roadsData.features.filter(f => f.geometry.type === 'Point'); }]
];
for (const [name, mutate] of rejects) {
    test('rejects: ' + name, () => {
        const res = validate(edit(mutate));
        assert.strictEqual(res.ok, false);
        assert.ok(res.error && res.error.length > 0);
    });
}

test('rejects non-objects', () => {
    for (const v of [null, 5, 'x', []]) assert.strictEqual(validate(v).ok, false);
});

test('unknown or malformed source falls back to {type: unknown}', () => {
    const res = validate(edit(o => { o.meta.source = { type: 'radius', lat: 'x' }; }));
    assert.ok(res.ok);
    assert.deepStrictEqual(res.meta.source, { type: 'unknown' });
});

test('meta strings are length-capped', () => {
    const res = validate(edit(o => { o.meta.name = 'x'.repeat(5000); }));
    assert.ok(res.ok);
    assert.ok(res.meta.name.length <= 200);
});

let failed = 0;
for (const [name, fn] of tests) {
    try { fn(); console.log('ok   ', name); }
    catch (e) { failed++; console.log('FAIL ', name, '\n     ', e.message); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
