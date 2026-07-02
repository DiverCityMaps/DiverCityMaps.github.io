// ==========================
// ui.js
// ==========================

const PRD_INTERPRETATIONS = {
    'Very Low':  'Very few distinct routes exist between this origin and destination.',
    'Low':       'Few distinct alternatives are available for this trip.',
    'Medium':    'A moderate number of distinct routes are available.',
    'High':      'Many distinct alternatives exist for this trip.',
    'Very High': 'Excellent diversification, with many well-separated alternatives.'
};

function createInfoBox() {
    // Attach to the sidebar anchor instead of body
    const anchor = document.getElementById('info-box-anchor');
    var infoBox = document.createElement("div");
    infoBox.className = "info-box";
    anchor.appendChild(infoBox);

    window.updateInfoBoxDefault = function() {
        infoBox.innerHTML = `
            <div class="dc-panel-header">
                <span class="dc-panel-title">Route Info</span>
            </div>
            <div class="dc-hint-text">
                <div style="margin-bottom:6px;">🖱️ <b>Click</b> two points on the map to set an origin and destination.</div>
                <div>🗺️ <b>Load a new city</b> using the button on the top left.</div>
            </div>
        `;
    };

    window.updateInfoBoxLoading = function() {
        infoBox.innerHTML = `
            <div class="dc-panel-header">
                <span class="dc-panel-title">Route Info</span>
            </div>
            <div style="text-align:center; padding:18px 0 10px;">
                <div style="font-size:11px; font-weight:600; color:var(--text-secondary); margin-bottom:4px;">Computing routes…</div>
                <div style="font-size:11px; color:var(--text-label);">This may take a few seconds</div>
            </div>
        `;
    };

    window.updateInfoBox = function(origin, destination, NSP_count, spatialSpread, prdScore, fastestTimeMin) {
        const originCoords = nodes[origin];
        const destCoords   = nodes[destination];
        const originLat = originCoords[1], originLng = originCoords[0];
        const destLat   = destCoords[1],   destLng   = destCoords[0];
        const distance  = haversineDistance(originLat, originLng, destLat, destLng);

        const thresholds = [0.40, 0.55, 0.70, 0.82].map(t => t * k);
        const labels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
        const colors = ['#dc2626', '#ea580c', '#6b7280', '#16a34a', '#2563eb'];
        let scoreLabel, scoreColor;
        const idx = thresholds.findIndex(t => prdScore < t);
        if (idx === -1) { scoreLabel = labels[4]; scoreColor = colors[4]; }
        else            { scoreLabel = labels[idx]; scoreColor = colors[idx]; }

        const interpretation = PRD_INTERPRETATIONS[scoreLabel] || '';
        const cityDisplay    = currentCity ? `<div class="dc-city-name">📍 ${currentCity}</div>` : '';

        // Gauge percentage
        const gaugePct = Math.min(100, Math.round((prdScore / k) * 100));

        infoBox.innerHTML = `
            <div class="dc-panel-header">
                <span class="dc-panel-title">Route Info</span>
                <span style="display:flex; gap:2px; align-items:center;">
                    <span id="share-btn" class="dc-share-btn">🔗 Share</span>
                    <span id="reset-btn" class="dc-reset-btn">↺ Reset</span>
                </span>
            </div>
            ${cityDisplay}
            <div class="dc-prd-block">
                <div class="dc-prd-label">Potential Route Diversification</div>
                <div class="dc-prd-score" style="color:${scoreColor};">
                    ${prdScore.toFixed(2)}<span class="dc-prd-tag" style="color:${scoreColor};"> (${scoreLabel})</span>
                </div>
                <div class="dc-prd-gauge-wrap">
                    <div class="dc-prd-gauge-track">
                        <div class="dc-prd-gauge-fill" id="prd-gauge-fill"
                             style="width:0%; background:${scoreColor};"></div>
                    </div>
                </div>
                <div class="dc-prd-interpretation">${interpretation}</div>
                <span class="dc-prd-whatdoes" id="whatdoes-btn">What does this mean? →</span>
            </div>
            <hr class="dc-divider">
            <div class="dc-field-label">Origin</div>
            <div class="dc-field-value">${originLat.toFixed(5)}, ${originLng.toFixed(5)}</div>
            <div class="dc-swap-row"><span id="swap-btn" class="dc-swap-btn">⇅ swap</span></div>
            <div class="dc-field-label">Destination</div>
            <div class="dc-field-value">${destLat.toFixed(5)}, ${destLng.toFixed(5)}</div>
            <hr class="dc-divider">
            <div class="dc-chips">
                <div class="dc-chip primary">
                    <span class="dc-chip-value">${NSP_count}</span>
                    <span class="dc-chip-label">Routes</span>
                </div>
                <div class="dc-chip primary">
                    <span class="dc-chip-value">${spatialSpread.toFixed(2)}</span>
                    <span class="dc-chip-label">Spread</span>
                </div>
            </div>
            <div class="dc-context-row">
                📍 ${distance.toFixed(1)} km${fastestTimeMin !== undefined ? ` · ${fastestTimeMin} min fastest` : ''}
            </div>
        `;

        // Animate gauge after paint
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                const fill = document.getElementById('prd-gauge-fill');
                if (fill) fill.style.width = gaugePct + '%';
            });
        });

        document.getElementById("swap-btn").addEventListener("click", () => {
            selectedNodes.reverse();
            highlightNodes();
            updateInfoBoxLoading();
            setTimeout(() => computeAndDrawPaths(), 50);
        });

        document.getElementById("reset-btn").addEventListener("click", () => resetRoute());

        document.getElementById("share-btn").addEventListener("click", () => {
            const url = buildShareURL();
            if (!url) return;
            copyTextToClipboard(url).then(() => showToast('🔗 Link copied!'));
        });

        document.getElementById("whatdoes-btn").addEventListener("click", () => {
            const overlay = document.getElementById('about-overlay');
            if (overlay) overlay.style.display = 'flex';
        });
    };

    updateInfoBoxDefault();
}


// ── URL sharing ─────────────────────────────────────────────

// Returns the top-level location (parent when in iframe, same-origin)
function getAppLocation() {
    try {
        if (window.parent !== window) return window.parent.location;
    } catch (e) { /* cross-origin — fall through */ }
    return window.location;
}

function buildShareURL() {
    if (selectedNodes.length !== 2) return null;

    const params = new URLSearchParams();

    // Network descriptor
    if (networkSource.type === 'radius') {
        params.set('c', `${networkSource.lat.toFixed(5)},${networkSource.lng.toFixed(5)}`);
        params.set('r', networkSource.r);
        if (networkSource.name) params.set('name', networkSource.name);
    } else if (networkSource.type === 'bbox') {
        params.set('bbox', networkSource.bbox.join(','));
    } else {
        params.set('net', 'default');
    }

    // Origin / destination (node coordinates — re-snapped on load)
    const o = nodes[selectedNodes[0]];
    const d = nodes[selectedNodes[1]];
    params.set('o', `${o[1].toFixed(5)},${o[0].toFixed(5)}`);
    params.set('d', `${d[1].toFixed(5)},${d[0].toFixed(5)}`);

    // Computation parameters — always included for scientific reproducibility
    // (results must replicate even if site defaults change in the future)
    params.set('k',   k);
    params.set('eps', epsilon.toFixed(2));
    params.set('p',   p.toFixed(2));
    params.set('as',  attractorSpeedMultiplier.toFixed(1));
    params.set('mi',  max_it);
    if (max_it !== 25)                      params.set('mi', max_it);

    const loc = getAppLocation();
    let path = loc.pathname;
    // Extensionless URLs work on GitHub Pages and similar hosts,
    // but not on local dev servers — strip .html only in production
    const isLocal = /^(localhost|127\.|192\.168\.|0\.0\.0\.0)/.test(loc.hostname);
    if (!isLocal) path = path.replace(/\.html$/, '');
    return loc.origin + path + '#' + params.toString();
}

// Keep the address bar in sync with the current computed route.
// replaceState: no history pollution, back button unaffected.
function updateURLHash() {
    const url = buildShareURL();
    if (!url) return;
    const hash = url.split('#')[1];
    try {
        const w = (window.parent !== window) ? window.parent : window;
        w.history.replaceState(null, '', '#' + hash);
    } catch (e) { /* cross-origin — skip */ }
}

function clearURLHash() {
    try {
        const w = (window.parent !== window) ? window.parent : window;
        w.history.replaceState(null, '', w.location.pathname + w.location.search);
    } catch (e) { /* cross-origin — skip */ }
}

function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
}

function showToast(msg) {
    let toast = document.getElementById('dc-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'dc-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2000);
}


function updateSettingsSummary() {
    const summary = document.getElementById('settings-summary');
    if (summary) {
        summary.innerHTML = `${k} routes &nbsp;·&nbsp; ${Math.round(epsilon * 100)}% max detour`;
    }
}

function createSliders() {
    // Settings accordion
    document.getElementById("settings-toggle").addEventListener("click", function() {
        const content = document.getElementById("settings-content");
        const chevron = document.getElementById("settings-chevron");
        const summary = document.getElementById("settings-summary");
        const open = content.classList.toggle("open");
        chevron.classList.toggle("open", open);
        if (summary) summary.style.display = open ? "none" : "";
    });

    // Advanced toggle
    document.getElementById("advanced-toggle").addEventListener("click", function() {
        const content = document.getElementById("advanced-content");
        const visible = content.style.display !== "none";
        content.style.display = visible ? "none" : "block";
        this.textContent = visible ? "Advanced ▾" : "Advanced ▴";
    });

    // k
    document.getElementById("slider-k").addEventListener("input", function() {
        k = parseInt(this.value);
        document.getElementById("value-k").innerText = k;
        updateSettingsSummary();
    });
    document.getElementById("slider-k").addEventListener("change", updateRoutesOnParameterChange);

    // p
    document.getElementById("slider-p").addEventListener("input", function() {
        p = parseFloat(this.value);
        document.getElementById("value-p").innerText = p.toFixed(2);
    });
    document.getElementById("slider-p").addEventListener("change", updateRoutesOnParameterChange);

    // epsilon
    document.getElementById("slider-eps").addEventListener("input", function() {
        epsilon = parseFloat(this.value);
        document.getElementById("value-eps").innerText = Math.round(epsilon * 100) + "%";
        updateSettingsSummary();
    });
    document.getElementById("slider-eps").addEventListener("change", updateRoutesOnParameterChange);

    // max_it
    document.getElementById("slider-max-it").addEventListener("input", function() {
        max_it = parseInt(this.value);
        document.getElementById("value-max-it").innerText = max_it;
    });
    document.getElementById("slider-max-it").addEventListener("change", updateRoutesOnParameterChange);

    // attractor speed
    document.getElementById("slider-attractor-reduction").addEventListener("input", function() {
        attractorSpeedMultiplier = parseFloat(this.value);
        const pct = Math.round(attractorSpeedMultiplier * 100);
        document.getElementById("value-attractor-reduction").innerText = pct + "%";

        const badge = document.getElementById("attractor-badge");
        if (attractorSpeedMultiplier < 1.0) {
            badge.className = "dc-attractor-badge slower";
            badge.textContent = "slower";
        } else if (attractorSpeedMultiplier > 1.0) {
            badge.className = "dc-attractor-badge faster";
            badge.textContent = "faster";
        } else {
            badge.className = "";
            badge.textContent = "";
        }
        // Attractors are vectors — just restyle, no re-rasterize needed
        if (window.attractorLayer) window.attractorLayer.setStyle(styleRoads);
    });
    document.getElementById("slider-attractor-reduction").addEventListener("change", updateRoutesOnParameterChange);

    // Layer toggle
    document.querySelectorAll('.layer-opt').forEach(option => {
        option.addEventListener('click', function() {
            const value = this.querySelector('input').value;
            document.querySelectorAll('.layer-opt').forEach(o => o.classList.remove('active'));
            this.classList.add('active');
            if (value === 'roads') {
                if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
                if (networkRasterOverlay && !map.hasLayer(networkRasterOverlay)) map.addLayer(networkRasterOverlay);
                if (window.attractorLayer && !map.hasLayer(window.attractorLayer)) map.addLayer(window.attractorLayer);
            } else {
                if (networkRasterOverlay && map.hasLayer(networkRasterOverlay)) map.removeLayer(networkRasterOverlay);
                if (window.attractorLayer && map.hasLayer(window.attractorLayer)) map.removeLayer(window.attractorLayer);
                if (!map.hasLayer(osmLayer)) map.addLayer(osmLayer);
            }
        });
    });

    document.getElementById('layer-opt-roads').classList.add('active');
}


function addAboutPanel() {
    const overlay = document.createElement('div');
    overlay.className = 'about-modal-overlay';
    overlay.id = 'about-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
        <div class="about-modal">
            <span class="about-modal-close" id="about-close">✕</span>
            <h2>Potential Route Diversification</h2>
            <p>Measures how effectively a road network supports multiple efficient and spatially distinct routes between an origin and destination.</p>
            <div class="about-formula">D(u,v) = S(NSR) · |NSR|</div>

            <!-- Animated diagram -->
            <div class="about-diagram">
                <div class="about-diagram-col">
                    <div class="about-diagram-label low">Low spread</div>
                    <svg class="spread-svg" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="18" cy="40" r="6" fill="#16a34a"/>
                        <circle cx="102" cy="40" r="6" fill="#dc2626"/>
                        <!-- shared trunk, then barely diverge -->
                        <path class="route-path low-r1" d="M24,40 L65,40 Q82,34 96,40" stroke="#1e3a8a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
                        <path class="route-path low-r2" d="M24,40 L65,40 Q82,40 96,40" stroke="#1e3a8a" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.55"/>
                        <path class="route-path low-r3" d="M24,40 L65,40 Q82,46 96,40" stroke="#1e3a8a" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.3"/>
                    </svg>
                    <div class="about-diagram-sub">Routes overlap heavily,<br>low diversification</div>
                </div>
                <div class="about-diagram-divider"></div>
                <div class="about-diagram-col">
                    <div class="about-diagram-label high">High spread</div>
                    <svg class="spread-svg" viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg">
                        <circle cx="18" cy="40" r="6" fill="#16a34a"/>
                        <circle cx="102" cy="40" r="6" fill="#dc2626"/>
                        <path class="route-path high-r1" d="M24,40 Q60,8  96,40" stroke="#1e3a8a" stroke-width="2.5" fill="none" stroke-linecap="round"/>
                        <path class="route-path high-r2" d="M24,40 Q60,40 96,40" stroke="#1e3a8a" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.7"/>
                        <path class="route-path high-r3" d="M24,40 Q60,72 96,40" stroke="#1e3a8a" stroke-width="2.5" fill="none" stroke-linecap="round" opacity="0.45"/>
                    </svg>
                    <div class="about-diagram-sub">Routes spread out,<br>high diversification</div>
                </div>
            </div>

            <p><b>|NSR|</b> — number of <i>near-shortest routes</i>: paths whose travel time is within <b>ε%</b> of the fastest route, generated via path penalization with factor <b>p</b>.</p>
            <p><b>S(NSR)</b> — spatial spread: <span style="font-family:monospace">1 − J(NSR)</span>, where J is the average weighted Jaccard similarity among route pairs.</p>
            <p>D(u,v) ranges in <b>[0, k]</b>. Values close to k indicate high diversification.</p>
            <p style="font-size:11px; color:#9ca3af;">Shared links re-download current OpenStreetMap data; results may vary slightly as the map evolves.</p>
            <div style="margin-top:12px; display:flex; gap:10px; flex-wrap:wrap;">
                <a href="https://arxiv.org/abs/2510.02582" target="_blank" class="about-link">📄 Paper (pre-print)</a>
                <a href="https://github.com/GiulianoCornacchia/DiverCity" target="_blank" class="about-link">💻 Code</a>
            </div>
            <div style="margin-top:16px; padding-top:12px; border-top:1px solid #e5e7eb; font-size:11px; color:#9ca3af;">
                Dashboard by <a href="https://linkedin.com/in/giuliano-cornacchia/" target="_blank"
                style="color:#9ca3af; text-decoration:underline;">Giuliano Cornacchia</a>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    // Animate paths when modal opens
    function animatePaths() {
        const paths = overlay.querySelectorAll('.route-path');
        paths.forEach((path, i) => {
            const len = path.getTotalLength();
            path.style.strokeDasharray = len;
            path.style.strokeDashoffset = len;
            path.style.transition = 'none';
            setTimeout(() => {
                path.style.transition = `stroke-dashoffset 0.7s cubic-bezier(.4,0,.2,1) ${i * 0.15}s`;
                path.style.strokeDashoffset = '0';
            }, 80);
        });
    }

    document.getElementById('about-close').addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });

    // Wire up the trigger inside the bottom-left box
    const trigger = document.getElementById('about-trigger');
    if (trigger) {
        trigger.addEventListener('click', () => {
            overlay.style.display = 'flex';
            setTimeout(animatePaths, 50);
        });
    }
    // Also wire the whatdoes button (injected dynamically by updateInfoBox)
    document.addEventListener('click', (e) => {
        if (e.target && e.target.id === 'whatdoes-btn') {
            overlay.style.display = 'flex';
            setTimeout(animatePaths, 50);
        }
    });
}


function addLegend() { /* legend is in HTML */ }

function addScaleControl() {
    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
        maxWidth: 120
    }).addTo(map);
}


function showMapLoader(message, type = "info") {
    let loader = document.getElementById('map-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'map-loader';
        loader.innerHTML = `
            <div class="spinner"></div>
            <div id="map-loader-msg" style="font-size:13px; font-weight:600; color:#374151; font-family:system-ui;"></div>
        `;
        document.body.appendChild(loader);
    }
    const msgEl   = document.getElementById('map-loader-msg');
    const spinner = loader.querySelector('.spinner');
    loader.style.display = 'flex';

    if (type === "error") {
        if (spinner) spinner.style.display = 'none';
        msgEl.textContent = message;
        msgEl.style.color = '#dc2626';
        setTimeout(hideMapLoader, 4000);
    } else {
        if (spinner) spinner.style.display = '';
        msgEl.textContent = '';  // no text, just spinner
    }
}

function hideMapLoader() {
    const loader = document.getElementById('map-loader');
    if (loader) loader.style.display = 'none';
}
