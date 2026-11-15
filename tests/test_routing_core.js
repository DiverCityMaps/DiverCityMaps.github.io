// Standalone tests for the routing core (no browser, no framework).
// Run: node tests/test_routing_core.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, TextEncoder });
for (const f of ['heap.js', 'utils.js', 'graph.js', 'routing.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'assets/js', f), 'utf8'), ctx, { filename: f });
}
const run = code => vm.runInContext(code, ctx);

// Silence the debug log of buildGraph
ctx.debugNetworkSize = () => {};

function edge(start, end, length, tt, attr = 0) {
    return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        properties: { start, end, length, travel_time: tt, is_attractor: attr }
    };
}
function twoWay(a, b, length, tt) { return [edge(a, b, length, tt), edge(b, a, length, tt)]; }
function build(features) {
    ctx.__fc = { type: 'FeatureCollection', features };
    return run('buildGraph(__fc)');
}
function kpaths(g, s, e, k, p, maxIt, mult = 1) {
    ctx.__g = g; ctx.__a = [s, e, k, p, maxIt, mult];
    return run('computeKAlternativePaths(__g.graph, __g.edges.length, ...__a)');
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('penalization is applied also when the same path is found again (cumulative PP)', () => {
    // Route 1: A-M-B, 5+5 = 10. Route 2: A-N-B, 10+10 = 20.
    // Route 1 keeps being the shortest until 10*1.1^n > 20 (n = 8): the second
    // route can only be found if repeated paths keep being penalized.
    const g = build([
        ...twoWay('A', 'M', 1, 5), ...twoWay('M', 'B', 1, 5),
        ...twoWay('A', 'N', 1, 10), ...twoWay('N', 'B', 1, 10)
    ]);
    const { allPaths, pathCosts } = kpaths(g, 'A', 'B', 2, 0.1, 25);
    assert.strictEqual(allPaths.length, 2);
    assert.deepStrictEqual(Array.from(pathCosts), [10, 20]);
});

test('parallel edges: cost uses the edge actually chosen, not the first one', () => {
    // A->B has two parallel edges: slow (listed first, 9s) and fast (2s).
    const g = build([edge('A', 'B', 100, 9), edge('A', 'B', 50, 2), edge('B', 'C', 10, 1)]);
    const { allPaths, pathCosts } = kpaths(g, 'A', 'C', 1, 0.1, 5);
    assert.deepStrictEqual(Array.from(allPaths[0]), [1, 2]);
    assert.strictEqual(pathCosts[0], 3);
});

test('parallel edges: second path uses the other parallel edge', () => {
    const g = build([edge('A', 'B', 100, 9), edge('A', 'B', 50, 2), edge('B', 'C', 10, 1)]);
    const { allPaths, pathCosts } = kpaths(g, 'A', 'C', 2, 0.5, 25);
    assert.strictEqual(allPaths.length, 2);
    assert.deepStrictEqual(Array.from(allPaths, p => p.join(',')), ['1,2', '0,2']);
    assert.deepStrictEqual(Array.from(pathCosts), [3, 10]);
});

test('weighted Jaccard distinguishes parallel edges (by id, with their own length)', () => {
    const g = build([edge('A', 'B', 100, 9), edge('A', 'B', 50, 2), edge('B', 'C', 10, 1)]);
    ctx.__w = g.edgeLength;
    // path [0,2] vs [1,2]: intersection = edge 2 (10), union = 100 + 50 + 10
    const j = run('weightedJaccardSimilarity([0,2],[1,2],__w)');
    assert.ok(Math.abs(j - 10 / 160) < 1e-12, `got ${j}`);
});

test('directed edges: a->b and b->a are different edges in Jaccard', () => {
    const g = build([...twoWay('A', 'B', 10, 1)]);
    ctx.__w = g.edgeLength;
    assert.strictEqual(run('weightedJaccardSimilarity([0],[1],__w)'), 0);
});

test('attractor multiplier scales attractor edges in costs', () => {
    const g = build([edge('A', 'B', 10, 10, 1), edge('B', 'C', 10, 10, 0)]);
    const { pathCosts } = kpaths(g, 'A', 'C', 1, 0.1, 5, 2.0);
    assert.strictEqual(pathCosts[0], 15);
});

test('unreachable destination returns no path', () => {
    const g = build([edge('A', 'B', 10, 1), edge('C', 'D', 10, 1)]);
    const { allPaths } = kpaths(g, 'A', 'D', 3, 0.1, 5);
    assert.strictEqual(allPaths.length, 0);
});

let failed = 0;
for (const [name, fn] of tests) {
    try { fn(); console.log('ok   ', name); }
    catch (e) { failed++; console.log('FAIL ', name, '\n     ', e.message); }
}
console.log(`\n${tests.length - failed}/${tests.length} passed`);
process.exit(failed ? 1 : 0);
