// ==========================
// ui.js — uses sidebar HTML elements defined in leaflet_alternative_routes.html
// ==========================

function createInfoBox() {
    var infoBox = L.DomUtil.create("div", "info-box");
    document.body.appendChild(infoBox);

    window.updateInfoBoxDefault = function() {
        infoBox.innerHTML = `
            <div class="dc-panel-header">
                <span class="dc-panel-title">Route Info</span>
            </div>
            <div style="font-size:12px; color:var(--text-label); line-height:1.7;">
                🖱️ <b>Click</b> two points to set origin and destination.<br>
                🗺️ <b>Load a new city</b> using the button on the top left.
            </div>
        `;
    };

    window.updateInfoBoxLoading = function() {
        infoBox.innerHTML = `
            <div class="dc-panel-header">
                <span class="dc-panel-title">Route Info</span>
            </div>
            <div style="text-align:center; padding:14px 0;">
                <div style="font-size:22px; margin-bottom:8px;">⏳</div>
                <div style="font-size:13px; font-weight:600; color:var(--text-secondary);">Computing routes…</div>
                <div style="font-size:11px; color:var(--text-label); margin-top:4px;">This may take a few seconds</div>
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
        const colors = ['#d3202f', '#e86c00', '#888', '#1a7a3f', '#0b4bd6'];
        let scoreLabel, scoreColor;
        const idx = thresholds.findIndex(t => prdScore < t);
        if (idx === -1) { scoreLabel = labels[4]; scoreColor = colors[4]; }
        else            { scoreLabel = labels[idx]; scoreColor = colors[idx]; }

        const cityDisplay = currentCity ? `<div class="dc-city-name">📍 ${currentCity}</div>` : '';
        const ttDisplay   = fastestTimeMin !== undefined ? `<span>~${fastestTimeMin} min fastest</span>` : '';

        infoBox.innerHTML = `
            <div class="dc-panel-header">
                <span class="dc-panel-title">Route Info</span>
                <span id="reset-btn" class="dc-reset-btn">↺ Reset</span>
            </div>
            ${cityDisplay}
            <div class="dc-prd-block">
                <div class="dc-prd-label">Potential Route Diversification</div>
                <div class="dc-prd-score" style="color:${scoreColor};">
                    ${prdScore.toFixed(2)} <span class="dc-prd-tag">(${scoreLabel})</span>
                </div>
            </div>
            <hr class="dc-divider">
            <div class="dc-field-label">Origin</div>
            <div class="dc-field-value">${originLat.toFixed(5)}, ${originLng.toFixed(5)}</div>
            <div class="dc-swap-row"><span id="swap-btn" class="dc-swap-btn">⇅ swap</span></div>
            <div class="dc-field-label">Destination</div>
            <div class="dc-field-value">${destLat.toFixed(5)}, ${destLng.toFixed(5)}</div>
            <hr class="dc-divider">
            <div class="dc-metrics-row">
                <div class="dc-metric">
                    <div class="dc-field-label">Distance</div>
                    <div class="dc-field-value">${distance.toFixed(1)} km</div>
                </div>
                <div class="dc-metric">
                    <div class="dc-field-label">NSR</div>
                    <div class="dc-field-value">${NSP_count}</div>
                </div>
                <div class="dc-metric">
                    <div class="dc-field-label">Spread</div>
                    <div class="dc-field-value">${spatialSpread.toFixed(2)}</div>
                </div>
            </div>
            <div class="dc-extra-row">
                <span>ε = ${epsilon.toFixed(2)}</span>
                ${ttDisplay}
            </div>
        `;

        document.getElementById("swap-btn").addEventListener("click", () => {
            selectedNodes.reverse();
            highlightNodes();
            updateInfoBoxLoading();
            setTimeout(() => computeAndDrawPaths(), 50);
        });
        document.getElementById("reset-btn").addEventListener("click", () => resetRoute());
    };

    updateInfoBoxDefault();
}


function createSliders() {
    // Sliders are already in the HTML sidebar — just wire up the event listeners

    document.getElementById("settings-toggle").addEventListener("click", function() {
        const content = document.getElementById("settings-content");
        const chevron = document.querySelector(".sidebar-chevron");
        const visible = content.style.display !== "none";
        content.style.display = visible ? "none" : "block";
        chevron.style.transform = visible ? "rotate(-90deg)" : "rotate(0deg)";
    });

    document.getElementById("slider-k").addEventListener("input", function() {
        k = parseInt(this.value);
        document.getElementById("value-k").innerText = k;
    });
    document.getElementById("slider-k").addEventListener("change", updateRoutesOnParameterChange);

    document.getElementById("slider-p").addEventListener("input", function() {
        p = parseFloat(this.value);
        document.getElementById("value-p").innerText = p.toFixed(2);
    });
    document.getElementById("slider-p").addEventListener("change", updateRoutesOnParameterChange);

    document.getElementById("slider-eps").addEventListener("input", function() {
        epsilon = parseFloat(this.value);
        document.getElementById("value-eps").innerText = epsilon.toFixed(2);
    });
    document.getElementById("slider-eps").addEventListener("change", updateRoutesOnParameterChange);

    document.getElementById("slider-max-it").addEventListener("input", function() {
        max_it = parseInt(this.value);
        document.getElementById("value-max-it").innerText = max_it;
    });
    document.getElementById("slider-max-it").addEventListener("change", updateRoutesOnParameterChange);

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

        if (edgeLayer) edgeLayer.setStyle(styleRoads);

    });
    document.getElementById("slider-attractor-reduction").addEventListener("change", updateRoutesOnParameterChange);

    // Layer toggle
    document.querySelectorAll('.layer-option').forEach(option => {
        option.addEventListener('click', function() {
            const value = this.querySelector('input').value;
            document.querySelectorAll('.layer-option').forEach(o => o.classList.remove('active'));
            this.classList.add('active');

            if (value === 'roads') {
                if (map.hasLayer(osmLayer)) map.removeLayer(osmLayer);
                if (edgeLayer && !map.hasLayer(edgeLayer)) map.addLayer(edgeLayer);
            } else {
                if (edgeLayer && map.hasLayer(edgeLayer)) map.removeLayer(edgeLayer);
                if (!map.hasLayer(osmLayer)) map.addLayer(osmLayer);
            }
        });
    });
}



function addAboutPanel() {
    const overlay = document.createElement('div');
    overlay.className = 'about-modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
        <div class="about-modal">
            <span class="about-modal-close" id="about-close">✕</span>
            <h2>Potential Route Diversification</h2>
            <p>Measures how effectively a road network supports multiple efficient and spatially distinct routes between an origin and destination.</p>
            <div class="about-formula">D(u,v) = S(NSR) ⋅ |NSR|</div>
            <p><b>|NSR|</b> — number of <i>near-shortest routes</i>: paths whose travel time is within <b>ε%</b> of the fastest route, generated via path penalization with factor <b>p</b>.</p>
            <p><b>S(NSR)</b> — spatial spread: <span style="font-family:monospace">1 − J(NSR)</span>, where J is the average weighted Jaccard similarity among route pairs.</p>
            <p>D(u,v) ranges in <b>[0, k]</b>. Values close to k indicate high diversification.</p>
            <div style="margin-top:10px; display:flex; gap:12px;">
                <a href="https://arxiv.org/abs/2510.02582" target="_blank" class="about-link">📄 Paper (pre-print)</a>
                <a href="https://github.com/GiulianoCornacchia/DiverCity" target="_blank" class="about-link">💻 Code</a>
            </div>
            <div style="margin-top:14px; padding-top:10px; border-top:1px solid #eee; font-size:11px; color:#aaa;">
                Dashboard designed by <a href="https://linkedin.com/in/giuliano-cornacchia/" target="_blank" style="color:#aaa; text-decoration:underline;">Giuliano Cornacchia</a>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById('about-btn-sidebar').addEventListener('click', () => {
        overlay.style.display = 'flex';
    });
    document.getElementById('about-close').addEventListener('click', () => {
        overlay.style.display = 'none';
    });
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) overlay.style.display = 'none';
    });
}


function addLegend() {
    // Legend is in the HTML sidebar — nothing to do here
}


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
        loader.style.cssText = `
            position: fixed; top: 0; left: 0;
            width: calc(100% - var(--sidebar-width, 260px)); height: 100%;
            background: rgba(255,255,255,0.88);
            display: flex; flex-direction: column;
            justify-content: center; align-items: center;
            z-index: 9999; font-family: system-ui;
        `;
        loader.innerHTML = `
            <div class="spinner"></div>
            <div id="map-loader-msg" style="margin-top:18px; font-size:15px; font-weight:600; color:#333;"></div>
        `;
        document.body.appendChild(loader);
    }
    const msgEl  = document.getElementById('map-loader-msg');
    const spinner = loader.querySelector('.spinner');
    msgEl.textContent = message;
    loader.style.display = 'flex';

    if (type === "error") {
        if (spinner) spinner.style.display = 'none';
        msgEl.style.color = '#d3202f';
        setTimeout(hideMapLoader, 4000);
    } else {
        if (spinner) spinner.style.display = '';
        msgEl.style.color = '#333';
    }
}


function hideMapLoader() {
    const loader = document.getElementById('map-loader');
    if (loader) loader.style.display = 'none';
}
