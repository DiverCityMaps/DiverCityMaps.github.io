// Standalone tests for OSM -> roads graph construction (no browser, no framework).
// Run: node tests/test_graph_construction.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console: { log() {}, warn: console.warn, error: console.error } });
for (const f of ['utils.js', 'graph.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', f), 'utf8'), ctx, { filename: f });
}
ctx.debugNetworkSize = () => {};

// Mini OSM: nodes on a line (lat 0, lon = id * 0.001), ways given as node-id lists.
function osm(ways, nodeIds) {
    const elements = nodeIds.map(id => ({ type: 'node', id, lat: 0, lon: id * 0.001 }));
    ways.forEach((w, i) => elements.push({ type: 'way', id: 100 + i, nodes: w.nodes, tags: w.tags }));
    return { elements };
}
function convert(data) {
    ctx.__d = data;
    const fc = vm.runInContext('transformOSMDataToRoadsData(__d)', ctx);
    const edges = fc.features.filter(f => f.geometry.type === 'LineString')
        .map(f => `${f.properties.start}>${f.properties.end}`);
    const nodes = fc.features.filter(f => f.geometry.type === 'Point').map(f => f.properties.id);
    // Copy into this realm's arrays (vm arrays fail deepStrictEqual on prototype)
    return { fc, edges: Array.from(edges).sort(), nodes: Array.from(nodes).sort() };
}
// Splits a polyline into 2-node ways so every node is an intersection.
function seg(nodeIds, tags) {
    const w = [];
    for (let i = 1; i < nodeIds.length; i++) w.push({ nodes: [nodeIds[i - 1], nodeIds[i]], tags });
    return w;
}
const run = code => vm.runInContext(code, ctx);

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('oneway: yes / true / 1 are forward, -1 / reverse are backward, no is bidirectional', () => {
    const cases = [
        [{ highway: 'residential', oneway: 'yes' }, ['1>2']],
        [{ highway: 'residential', oneway: 'true' }, ['1>2']],
        [{ highway: 'residential', oneway: '1' }, ['1>2']],
        [{ highway: 'residential', oneway: '-1' }, ['2>1']],
        [{ highway: 'residential', oneway: 'reverse' }, ['2>1']],
        [{ highway: 'residential', oneway: 'no' }, ['1>2', '2>1']],
        [{ highway: 'residential' }, ['1>2', '2>1']]
    ];
    for (const [tags, expected] of cases) {
        // keep sources/sinks so a single one-way edge survives the cleanup
        assert.deepStrictEqual(convert(osm([{ nodes: [1, 2], tags }], [1, 2])).edges, expected, JSON.stringify(tags));
    }
});

test('oneway is implied for motorway and roundabouts, unless explicitly oneway=no', () => {
    const e = tags => convert(osm([{ nodes: [1, 2], tags }], [1, 2])).edges;
    assert.deepStrictEqual(e({ highway: 'motorway' }), ['1>2']);
    assert.deepStrictEqual(e({ highway: 'residential', junction: 'roundabout' }), ['1>2']);
    assert.deepStrictEqual(e({ highway: 'residential', junction: 'circular' }), ['1>2']);
    assert.deepStrictEqual(e({ highway: 'motorway', oneway: 'no' }), ['1>2', '2>1']);
});

test('*_link roads get their own default speed (not the generic 50 km/h)', () => {
    const sp = (h, m) => run(`defaultSpeedKmh(${JSON.stringify(h)}, ${JSON.stringify(m)})`);
    assert.strictEqual(sp('motorway_link'), 60);
    assert.strictEqual(sp('trunk_link'), 55);
    assert.strictEqual(sp('primary_link'), 35);
    assert.strictEqual(sp('secondary_link'), 30);
    assert.strictEqual(sp('motorway_link', '80'), 80);   // explicit maxspeed wins
    assert.strictEqual(sp('residential'), 30);
    assert.strictEqual(sp('service'), 50);               // unknown type: fallback
});

test('main component: a disconnected island is removed', () => {
    // Big two-way cycle 1-2-3-4-1 and a separate two-way island 10-11.
    const ways = [
        ...seg([1, 2, 3, 4, 1], { highway: 'residential' }),
        ...seg([10, 11], { highway: 'residential' })
    ];
    const r = convert(osm(ways, [1, 2, 3, 4, 10, 11]));
    assert.ok(!r.nodes.includes('10') && !r.nodes.includes('11'));
    assert.ok(r.edges.every(e => !e.includes('10') && !e.includes('11')));
    assert.ok(r.edges.length > 0);
});

test('main component: a one-way trap outside the SCC is removed when it has both in and out edges', () => {
    // Two-way cycle 1-2-3-1, plus a one-way cycle 20->21->20 reachable only from 1 (1>20 one-way)
    // and not returning: 20 has in (from 1 and 21) and out (to 21) edges, not in the main SCC.
    const ways = [
        ...seg([1, 2, 3, 1], { highway: 'residential' }),
        ...seg([1, 20], { highway: 'residential', oneway: 'yes' }),
        ...seg([20, 21, 20], { highway: 'residential', oneway: 'yes' })
    ];
    const r = convert(osm(ways, [1, 2, 3, 20, 21]));
    assert.ok(!r.nodes.includes('20') && !r.nodes.includes('21'));
});

test('main component: pure sources and sinks (in or out degree 0) are kept', () => {
    // Two-way cycle 1-2-3-1, sink 5 (one-way 1>5) and source 6 (one-way 6>1).
    const ways = [
        ...seg([1, 2, 3, 1], { highway: 'residential' }),
        ...seg([1, 5], { highway: 'residential', oneway: 'yes' }),
        ...seg([6, 1], { highway: 'residential', oneway: 'yes' })
    ];
    const r = convert(osm(ways, [1, 2, 3, 5, 6]));
    assert.ok(r.nodes.includes('5'), 'sink kept');
    assert.ok(r.nodes.includes('6'), 'source kept');
    assert.ok(r.edges.includes('1>5') && r.edges.includes('6>1'));
});

test('main component: handles a long chain without recursion limits', () => {
    const n = 60000, ids = [];
    for (let i = 1; i <= n; i++) ids.push(i);
    const r = convert(osm(seg(ids, { highway: 'residential' }), ids));
    assert.ok(r.edges.length >= 2 * (n - 1) - 2);
});

let failed = 0;
for (const [name, fn] of tests) {
    try { fn(); console.log('ok   ', name); }
    catch (e) { failed++; console.log('FAIL ', name, '\n     ', e.message); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
