// Main application controller

const App = (() => {
    const API = "";
    let currentRasterId = null;
    let lastResults = null;
    let lastStats = null;

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // DOM refs
    const fileInput       = $("#file-input");
    const fileNameEl      = $("#file-name");
    const statusBadge     = $("#status-badge");
    const rasterInfoBar   = $("#raster-info");
    const loadingOverlay  = $("#loading-overlay");
    const loadingText     = $("#loading-text");
    const resultsPanel    = $("#results-panel");
    const resultsTable    = $("#results-table");
    const chartModal      = $("#chart-modal");
    const chartTypeSelect = $("#chart-type-select");
    const chartStatSelect = $("#chart-stat-select");
    const viewChartBtn    = $("#view-chart-btn");

    // ── Helpers ──────────────────────────────────────────────────

    function showLoading(msg) {
        loadingText.textContent = msg || "Processing…";
        loadingOverlay.classList.remove("hidden");
    }
    function hideLoading() {
        loadingOverlay.classList.add("hidden");
    }
    function showError(msg) {
        hideLoading();
        alert("Error: " + msg);
    }

    function getSelectedStats() {
        const checked = [];
        $$("#stat-checkboxes input:checked").forEach(cb => checked.push(cb.value));
        return checked.length > 0 ? checked : ["sum"];
    }

    function getBand() {
        return parseInt($("#band-input").value) || 1;
    }

    function getActiveTabName() {
        const tab = $(".tab-content.active");
        return tab ? tab.dataset.tab : "circle";
    }

    async function apiPost(endpoint, body) {
        const resp = await fetch(API + endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        const data = await resp.json();
        if (!resp.ok || data.error) throw new Error(data.error || `HTTP ${resp.status}`);
        return data;
    }

    // ── Modal Management ────────────────────────────────────────

    function openChartModal() {
        if (!lastResults || lastResults.length === 0) return;

        chartModal.classList.remove("hidden");
        chartModal.classList.remove("closing");

        // Small delay so the canvas is visible before Chart.js measures it
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                renderCurrentChart();
            });
        });

        // Trap focus
        document.body.style.overflow = "hidden";
    }

    function closeChartModal() {
        chartModal.classList.add("closing");
        setTimeout(() => {
            chartModal.classList.add("hidden");
            chartModal.classList.remove("closing");
            ChartManager.clear();
            document.body.style.overflow = "";
        }, 200);
    }

    // ── Chart Rendering ─────────────────────────────────────────

    function populateStatSelector(stats) {
        chartStatSelect.innerHTML = "";
        const displayStats = stats.filter(s => !s.startsWith("_"));
        displayStats.forEach(s => {
            const opt = document.createElement("option");
            opt.value = s;
            opt.textContent = s.charAt(0).toUpperCase() + s.slice(1);
            chartStatSelect.appendChild(opt);
        });
    }

    function renderCurrentChart() {
        if (!lastResults || lastResults.length === 0) return;

        const statName = chartStatSelect.value;
        const chartType = chartTypeSelect.value;
        const tabName = getActiveTabName();

        if (!statName) return;

        const labels = lastResults.map(r => r.label);
        const values = lastResults.map(r => r.stats[statName] || 0);

        const yLabels = {
            circle: "Radius",
            band: "Band",
            rect: "Region",
            compare: "Location",
        };

        const titleMap = {
            circle: `${statName} by radius`,
            band: `${statName} by distance band`,
            rect: `${statName} — rectangle query`,
            compare: `${statName} — location comparison`,
        };

        const chartOptions = {
            title: titleMap[tabName] || `${statName} results`,
            yLabel: yLabels[tabName] || "",
            queryType: tabName,
        };

        // Update modal title
        const modalTitle = document.getElementById("chart-modal-title");
        if (modalTitle) {
            modalTitle.textContent = chartOptions.title;
        }

        if (chartType === "pie") {
            ChartManager.renderAsPie("results-chart", labels, values, statName, chartOptions);
        } else {
            ChartManager.render("results-chart", labels, values, statName, chartOptions);
        }
    }

    // ── Results Display ─────────────────────────────────────────

    function renderResults(results, stats) {
        lastResults = results;
        lastStats = stats;

        const statKeys = stats.filter(s => !s.startsWith("_"));

        // Table
        const thead = document.createElement("thead");
        const headerRow = document.createElement("tr");
        headerRow.innerHTML = `<th>Label</th>` +
            statKeys.map(s => `<th>${s}</th>`).join("");
        thead.appendChild(headerRow);

        const tbody = document.createElement("tbody");
        results.forEach(r => {
            const tr = document.createElement("tr");
            tr.innerHTML = `<td>${r.label}</td>` +
                statKeys.map(s => {
                    const v = r.stats[s];
                    return `<td>${v !== undefined ? Utils.fmtTable(v) : "—"}</td>`;
                }).join("");
            tbody.appendChild(tr);
        });

        resultsTable.innerHTML = "";
        resultsTable.appendChild(thead);
        resultsTable.appendChild(tbody);

        // Enable chart button
        populateStatSelector(stats);
        viewChartBtn.disabled = false;

        resultsPanel.classList.remove("hidden");
        MapManager.invalidateSize();
    }

    function clearResults() {
        lastResults = null;
        lastStats = null;
        resultsTable.innerHTML = "";
        viewChartBtn.disabled = true;
        ChartManager.clear();
        resultsPanel.classList.add("hidden");
        MapManager.clearResults();
        MapManager.invalidateSize();

        // Close modal if open
        if (!chartModal.classList.contains("hidden")) {
            closeChartModal();
        }
    }

    // ── Map Click ───────────────────────────────────────────────

    function setupMapClick() {
        MapManager.onMapClick((lat, lon) => {
            const activeTab = $(".tab-content.active");
            if (!activeTab) return;
            const tab = activeTab.dataset.tab;
            const latInput = $(`#${tab}-lat`);
            const lonInput = $(`#${tab}-lon`);
            if (latInput) latInput.value = lat.toFixed(6);
            if (lonInput) lonInput.value = lon.toFixed(6);
            MapManager.setQueryPoint(lat, lon);
        });
    }

    // ── File Upload ─────────────────────────────────────────────

    async function handleFileUpload(file) {
        if (!file) return;
        showLoading("Loading raster…");

        if (currentRasterId) {
            try {
                await fetch(`${API}/api/unload/${currentRasterId}`, { method: "DELETE" });
            } catch (e) { /* ignore */ }
        }

        const formData = new FormData();
        formData.append("file", file);

        try {
            const resp = await fetch(`${API}/api/upload`, { method: "POST", body: formData });
            const data = await resp.json();
            if (!resp.ok || data.error) throw new Error(data.error);

            currentRasterId = data.raster_id;
            fileNameEl.textContent = data.filename;
            $("#raster-crs").textContent = `CRS: ${data.crs}`;
            $("#raster-size").textContent = `Size: ${data.width}×${data.height}`;
            $("#raster-res").textContent = `Res: ${data.res[0].toFixed(6)}°`;
            $("#raster-nodata").textContent = `NoData: ${data.nodata ?? "none"}`;
            rasterInfoBar.classList.remove("hidden");

            MapManager.showRasterBounds(data.bounds_polygon);
            clearResults();
            hideLoading();
        } catch (e) {
            showError(e.message);
            currentRasterId = null;
        }
    }

    // ── Query Runners ───────────────────────────────────────────

    async function runCircleQuery() {
        if (!currentRasterId) return showError("Load a raster first");
        try {
            const lat = Utils.parseCoord($("#circle-lat").value, true);
            const lon = Utils.parseCoord($("#circle-lon").value, false);
            const radii = Utils.parseNumberList($("#circle-radii").value);
            if (!radii.length) throw new Error("No radii");
            const stats = getSelectedStats();
            showLoading("Running circle query…");
            MapManager.setQueryPoint(lat, lon);
            const data = await apiPost("/api/query/circle", {
                raster_id: currentRasterId, lat, lon, radii_km: radii, stats, band: getBand(),
            });
            MapManager.showResults(data.results);
            renderResults(data.results, stats);
            hideLoading();
        } catch (e) { showError(e.message); }
    }

    async function runBandQuery() {
        if (!currentRasterId) return showError("Load a raster first");
        try {
            const lat = Utils.parseCoord($("#band-lat").value, true);
            const lon = Utils.parseCoord($("#band-lon").value, false);
            const edges = Utils.parseNumberList($("#band-edges").value);
            if (edges.length < 2) throw new Error("Need at least 2 edges");
            const stats = getSelectedStats();
            showLoading("Running band query…");
            MapManager.setQueryPoint(lat, lon);
            const data = await apiPost("/api/query/band", {
                raster_id: currentRasterId, lat, lon, edges_km: edges, stats, band: getBand(),
            });
            MapManager.showResults(data.results);
            renderResults(data.results, stats);
            hideLoading();
        } catch (e) { showError(e.message); }
    }

    async function runRectQuery() {
        if (!currentRasterId) return showError("Load a raster first");
        try {
            const lat = Utils.parseCoord($("#rect-lat").value, true);
            const lon = Utils.parseCoord($("#rect-lon").value, false);
            const hw = parseFloat($("#rect-hw").value);
            const hh = parseFloat($("#rect-hh").value);
            const stats = getSelectedStats();
            showLoading("Running rectangle query…");
            MapManager.setQueryPoint(lat, lon);
            const data = await apiPost("/api/query/rect", {
                raster_id: currentRasterId, lat, lon, half_w_km: hw, half_h_km: hh, stats, band: getBand(),
            });
            MapManager.showResults(data.results);
            renderResults(data.results, stats);
            hideLoading();
        } catch (e) { showError(e.message); }
    }

    async function runCompareQuery() {
        if (!currentRasterId) return showError("Load a raster first");
        try {
            const { points, errors } = Utils.parsePoints($("#compare-points").value);
            if (errors.length) alert("Warnings:\n" + errors.join("\n"));
            if (!points.length) throw new Error("No valid points");
            const radius = parseFloat($("#compare-radius").value);
            const stats = getSelectedStats();
            showLoading("Running comparison…");
            const data = await apiPost("/api/query/compare", {
                raster_id: currentRasterId, points, radius_km: radius, stats, band: getBand(),
            });
            MapManager.showResults(data.results);
            renderResults(data.results, stats);
            hideLoading();
        } catch (e) { showError(e.message); }
    }

    // ── Export ───────────────────────────────────────────────────

    async function exportCSV() {
        if (!lastResults?.length) return;
        try {
            const data = await apiPost("/api/export/csv", { results: lastResults });
            const blob = new Blob([data.csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `geo_results_${getActiveTabName()}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) { showError("CSV export failed: " + e.message); }
    }

    function exportChartPNG() {
        if (!ChartManager.hasChart()) return;
        ChartManager.exportPNG(`geo_chart_${getActiveTabName()}.png`);
    }

    // ── Init ────────────────────────────────────────────────────

    async function init() {
        MapManager.init("map");
        setupMapClick();

        // Status check
        try {
            const resp = await fetch(`${API}/api/status`);
            const data = await resp.json();
            if (data.ok) {
                statusBadge.textContent = data.exactextract
                    ? "ready (exactextract ✓)" : "ready (fallback mode)";
                statusBadge.className = "badge " +
                    (data.exactextract ? "badge-ok" : "badge-warn");
            }
        } catch {
            statusBadge.textContent = "backend offline";
            statusBadge.className = "badge badge-warn";
        }

        // Tabs
        $$(".tab-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                $$(".tab-btn").forEach(b => b.classList.remove("active"));
                $$(".tab-content").forEach(c => c.classList.remove("active"));
                btn.classList.add("active");
                $(`.tab-content[data-tab="${btn.dataset.tab}"]`).classList.add("active");
            });
        });

        // File upload
        fileInput.addEventListener("change", (e) => {
            if (e.target.files.length) handleFileUpload(e.target.files[0]);
        });

        // Drag & drop
        const mapEl = document.getElementById("map");
        mapEl.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
        mapEl.addEventListener("drop", (e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) {
                const file = e.dataTransfer.files[0];
                file.name.match(/\.tiff?$/i) ? handleFileUpload(file) : showError("Drop a .tif file");
            }
        });

        // Query buttons
        $("#run-circle").addEventListener("click", runCircleQuery);
        $("#run-band").addEventListener("click", runBandQuery);
        $("#run-rect").addEventListener("click", runRectQuery);
        $("#run-compare").addEventListener("click", runCompareQuery);

        // Chart modal
        viewChartBtn.addEventListener("click", openChartModal);
        $("#chart-modal-close").addEventListener("click", closeChartModal);
        $(".chart-modal-backdrop").addEventListener("click", closeChartModal);
        chartTypeSelect.addEventListener("change", renderCurrentChart);
        chartStatSelect.addEventListener("change", renderCurrentChart);
        $("#export-chart-png").addEventListener("click", exportChartPNG);

        // Close modal on Escape
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && !chartModal.classList.contains("hidden")) {
                closeChartModal();
                return;
            }
            // Enter runs query
            if (e.key === "Enter" && !e.shiftKey && e.target.tagName !== "TEXTAREA") {
                const activeTab = $(".tab-content.active");
                if (activeTab) {
                    const btn = activeTab.querySelector(".run-btn");
                    if (btn) btn.click();
                }
            }
        });

        // Results controls
        $("#export-csv").addEventListener("click", exportCSV);
        $("#clear-results").addEventListener("click", clearResults);
    }

    return { init };
})();

document.addEventListener("DOMContentLoaded", App.init);