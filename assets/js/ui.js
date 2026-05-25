// ==========================
// ui.js
// UI components: info box, sliders, about panel, legend, loader
// Depends on: utils.js (haversineDistance)
// Uses globals: nodes, k, p, epsilon, max_it, attractorSpeedMultiplier,
//               selectedNodes, isComputing, computeAndDrawPaths, updateRoutesOnParameterChange
// ==========================

function createInfoBox() {
    var infoBox = L.DomUtil.create("div", "info-box");
    document.body.appendChild(infoBox);

    window.updateInfoBoxDefault = function() {
        infoBox.innerHTML = `
            <div style="font-size: 15px; font-weight: bold; margin-bottom: 6px;">Route Info</div>
            <div style="font-size: 12px; color: #555; line-height: 1.6;">
                🖱️ <b>Click</b> two points to set origin and destination.<br>
                🗺️ <b>Load a new city</b> using the button on the top left.
            </div>
        `;
    };

    window.updateInfoBoxLoading = function() {
        infoBox.innerHTML = `
            <div style="font-size: 15px; font-weight: bold; margin-bottom: 8px;">Route Info</div>
            <div style="font-size: 12px; color: #555; line-height: 2; text-align: center; padding: 10px 0;">
                <div style="font-size: 20px; margin-bottom: 6px;">⏳</div>
                <b>Computing routes…</b><br>
                <span style="font-size: 11px;">This may take a few seconds</span>
            </div>
        `;
    };

    window.updateInfoBox = function(origin, destination, NSP_count, spatialSpread, prdScore) {
        const originCoords = nodes[origin];
        const destCoords   = nodes[destination];

        const originLat = originCoords[1], originLng = originCoords[0];
        const destLat   = destCoords[1],   destLng   = destCoords[0];

        const distance = haversineDistance(originLat, originLng, destLat, destLng);

        const thresholds = [0.40, 0.55, 0.70, 0.82].map(t => t * k);
        const labels = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];
        const colors = ['#d3202f', '#e86c00', '#888', '#1a7a3f', '#0b4bd6'];

        let scoreLabel, scoreColor;
        const idx = thresholds.findIndex(t => prdScore < t);
        if (idx === -1) {
            scoreLabel = labels[4]; scoreColor = colors[4];
        } else {
            scoreLabel = labels[idx]; scoreColor = colors[idx];
        }

        infoBox.innerHTML = `
            <div style="font-size: 15px; font-weight: bold; margin-bottom: 8px;">Route Info</div>

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">Origin</div>
            <div style="font-size: 12px; margin-bottom: 6px;">
                ${originLat.toFixed(5)}, ${originLng.toFixed(5)}
            </div>

            <div style="text-align: left; margin: 4px 0;">
                <span id="swap-btn" style="
                    cursor: pointer;
                    font-size: 12px;
                    color: #0b4bd6;
                    padding: 2px 8px;
                    border: 1px solid #0b4bd6;
                    border-radius: 10px;
                    user-select: none;
                ">⇅ swap</span>
            </div>

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">Destination</div>
            <div style="font-size: 12px; margin-bottom: 6px;">
                ${destLat.toFixed(5)}, ${destLng.toFixed(5)}
            </div>

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">OD Distance</div>
            <div style="font-size: 12px; margin-bottom: 8px;">${distance.toFixed(2)} km</div>

            <hr style="margin: 6px 0; border: none; border-top: 1px solid #eee;">

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">Near Shortest Routes</div>
            <div style="font-size: 12px; margin-bottom: 4px;">${NSP_count}</div>

            <div style="font-size: 12px; color: #555; margin-bottom: 2px;">Spatial Spread</div>
            <div style="font-size: 12px; margin-bottom: 8px;">${spatialSpread.toFixed(3)}</div>

            <hr style="margin: 6px 0; border: none; border-top: 1px solid #eee;">

            <div style="font-weight: bold; font-size: 11px; color: #555; margin-bottom: 2px; text-transform: uppercase; letter-spacing: 0.5px;">
                Potential Route Diversification
            </div>
            <div style="font-size: 22px; font-weight: bold; color: ${scoreColor};">
                ${prdScore.toFixed(2)}
                <span style="font-size: 13px; font-weight: normal;">(${scoreLabel})</span>
            </div>
        `;

        document.getElementById("swap-btn").addEventListener("click", () => {
            selectedNodes.reverse();
            highlightNodes();
            updateInfoBoxLoading();
            setTimeout(() => computeAndDrawPaths(), 50);
        });
    };

    updateInfoBoxDefault();
}


function createSliders() {
    var sliderContainer = L.DomUtil.create("div", "slider-container");
    sliderContainer.innerHTML = `
        <div class="slider-header" id="slider-toggle">
            Route Settings
        </div>
        <div class="slider-content" id="slider-content" style="display: none;">
            <label class="tooltip" for="slider-k">
                k: <span id="value-k">${k}</span>
                <span class="tooltiptext">Number of alternative routes</span>
            </label>
            <input type="range" id="slider-k" min="1" max="10" step="1" value="${k}">
            <br>
            <label class="tooltip" for="slider-p">
                p: <span id="value-p">${p}</span>
                <span class="tooltiptext">The penalty factor for the Path Penalization algorithm</span>
            </label>
            <input type="range" id="slider-p" min="0" max="1" step="0.01" value="${p}">
            <br>
            <label class="tooltip" for="slider-eps">
                ε (epsilon): <span id="value-eps">${epsilon}</span>
                <span class="tooltiptext">The cost threshold for near-shortest routes</span>
            </label>
            <input type="range" id="slider-eps" min="0" max="1" step="0.01" value="${epsilon}">
            <br>
            <label class="tooltip" for="slider-max-it">
                Max Iterations: <span id="value-max-it">${max_it}</span>
                <span class="tooltiptext">Limit on pathfinding attempts</span>
            </label>
            <input type="range" id="slider-max-it" min="10" max="300" step="10" value="${max_it}">
            <br>
            <hr style="margin: 8px 0; border: none; border-top: 1px solid #eee;">
            <label class="tooltip" for="slider-attractor-reduction">
                Attractor speed: <span id="value-attractor-reduction">100%</span>
                <span class="tooltiptext">Reduces speed limits on motorways and trunk roads</span>
            </label>
            <input type="range" id="slider-attractor-reduction" min="0" max="2.0" step="0.1" value="1.0">
            <br>
        </div>
    `;
    document.body.appendChild(sliderContainer);

    document.getElementById("slider-toggle").addEventListener("click", function() {
        var sliderContent = document.getElementById("slider-content");
        sliderContent.style.display = sliderContent.style.display === "none" ? "block" : "none";
    });

    document.getElementById("slider-k").addEventListener("input", function() {
        k = parseInt(this.value);
        document.getElementById("value-k").innerText = k;
    });
    document.getElementById("slider-k").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });

    document.getElementById("slider-p").addEventListener("input", function() {
        p = parseFloat(this.value);
        document.getElementById("value-p").innerText = p.toFixed(2);
    });
    document.getElementById("slider-p").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });

    document.getElementById("slider-eps").addEventListener("input", function() {
        epsilon = parseFloat(this.value);
        document.getElementById("value-eps").innerText = epsilon.toFixed(2);
    });
    document.getElementById("slider-eps").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });

    document.getElementById("slider-max-it").addEventListener("input", function() {
        max_it = parseInt(this.value);
        document.getElementById("value-max-it").innerText = max_it;
    });
    document.getElementById("slider-max-it").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });

    document.getElementById("slider-attractor-reduction").addEventListener("input", function() {
        attractorSpeedMultiplier = parseFloat(this.value);
        document.getElementById("value-attractor-reduction").innerText =
            Math.round(attractorSpeedMultiplier * 100) + "%";
    });
    document.getElementById("slider-attractor-reduction").addEventListener("change", function() {
        updateRoutesOnParameterChange();
    });
}


function addAboutPanel() {
    const btn = document.createElement('div');
    btn.className = 'about-btn';
    btn.textContent = 'About the measure ℹ️';
    document.body.appendChild(btn);

    const overlay = document.createElement('div');
    overlay.className = 'about-modal-overlay';
    overlay.style.display = 'none';
    overlay.innerHTML = `
        <div class="about-modal">
            <span class="about-modal-close" id="about-close">✕</span>
            <h2>Potential Route Diversification</h2>
            <p>
                Measures how effectively a road network supports multiple
                efficient and spatially distinct routes between an origin and destination.
            </p>
            <div class="about-formula">D(u,v) = S(NSR) ⋅ |NSR|</div>
            <p>
                <b>|NSR|</b> - number of <i>near-shortest routes</i>: paths whose
                travel time is within <b>ε%</b> of the fastest route, generated
                via path penalization with factor <b>p</b>.
            </p>
            <p>
                <b>S(NSR)</b> - spatial spread: <span style="font-family:monospace">1 − J(NSR)</span>,
                where J is the average weighted Jaccard similarity among route pairs.
                High spread means routes are spatially distinct.
            </p>
            <p>
                D(u,v) ranges in <b>[0, k]</b>. Values close to k indicate high diversification,
                with many near-shortest routes that overlap little in space.
            </p>
            <div style="margin-top: 10px; display: flex; gap: 12px;">
                <a href="https://arxiv.org/abs/2510.02582" target="_blank" class="about-link">📄 Paper (pre-print)</a>
                <a href="https://github.com/GiulianoCornacchia/DiverCity" target="_blank" class="about-link">💻 Code</a>
            </div>
            <div style="margin-top: 14px; padding-top: 10px; border-top: 1px solid #eee; font-size: 11px; color: #aaa;">
                Dashboard designed by <a href="https://linkedin.com/in/giuliano-cornacchia/" target="_blank" style="color: #aaa; text-decoration: underline;">Giuliano Cornacchia</a>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    btn.addEventListener('click', () => { overlay.style.display = 'flex'; });
    document.getElementById('about-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.style.display = 'none'; });
}


function addLegend() {
    var legend = L.control({ position: "bottomright" });

    legend.onAdd = function() {
        let div = L.DomUtil.create("div", "legend-box");
        div.innerHTML = `
            <strong>Legend</strong>
            <div class="legend-item">
                <span class="legend-line" style="background: darkblue;"></span> NSR (Near Shortest Route)
            </div>
            <div class="legend-item">
                <span class="legend-line" style="background: red;"></span> Non-NSR
            </div>
            <div class="legend-item">
                <span class="legend-line" style="background: #FFE5B4;"></span> Attractor Road
            </div>
        `;
        return div;
    };

    legend.addTo(map);

    var legendCSS = document.createElement("style");
    legendCSS.innerHTML = `
        .legend-box {
            background: rgba(255, 255, 255, 0.9);
            border-radius: 8px;
            padding: 6px 10px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
            font-family: Arial, sans-serif;
            font-size: 12px;
            color: #333;
            line-height: 16px;
        }
        .legend-item {
            display: flex;
            align-items: center;
            margin-top: 3px;
        }
        .legend-line {
            width: 25px;
            height: 4px;
            margin-right: 6px;
            display: inline-block;
            border-radius: 2px;
        }
    `;
    document.head.appendChild(legendCSS);
}


function addScaleControl() {
    L.control.scale({
        position: 'bottomleft',
        metric: true,
        imperial: false,
        maxWidth: 200
    }).addTo(map);
}


function showMapLoader(message) {
    let loader = document.getElementById('map-loader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'map-loader';
        loader.style.cssText = `
            position: fixed; top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(255,255,255,0.85);
            display: flex; flex-direction: column;
            justify-content: center; align-items: center;
            z-index: 9999; font-family: Arial, sans-serif;
        `;
        loader.innerHTML = `
            <div class="spinner"></div>
            <div id="map-loader-msg" style="margin-top: 20px; font-size: 15px; font-weight: bold; color: #333;"></div>
        `;
        document.body.appendChild(loader);
    }
    document.getElementById('map-loader-msg').textContent = message;
    loader.style.display = 'flex';
}


function hideMapLoader() {
    const loader = document.getElementById('map-loader');
    if (loader) loader.style.display = 'none';
}
