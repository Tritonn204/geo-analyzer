// Leaflet map management

const MapManager = (() => {
    let map = null;
    let clickCallback = null;
    let maskLayer = null;
    let boundsLayer = null;
    let resultsLayer = null;
    let markerLayer = null;
    let queryMarker = null;

    const COLORS = [
        "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728",
        "#9467bd", "#8c564b", "#e377c2", "#7f7f7f",
        "#17becf", "#bcbd22",
    ];

    function init(containerId) {
        map = L.map(containerId, {
            center: [20, 0],
            zoom: 2,
            zoomControl: true,
        });

        L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
            attribution: '© OpenStreetMap © CARTO',
            maxZoom: 19,
        }).addTo(map);

        // Click handler
        map.on("click", (e) => {
            if (clickCallback) {
                clickCallback(e.latlng.lat, e.latlng.lng);
            }
        });

        // Coordinate display
        const coordsEl = document.getElementById("map-coords");
        map.on("mousemove", (e) => {
            coordsEl.textContent = `${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
        });

        resultsLayer = L.layerGroup().addTo(map);
        markerLayer = L.layerGroup().addTo(map);
    }

    function onMapClick(cb) {
        clickCallback = cb;
    }

    /**
     * Show raster boundary + gray mask outside.
     */
    function showRasterBounds(boundsPolygon) {
        // Remove old
        if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
        if (boundsLayer) { map.removeLayer(boundsLayer); boundsLayer = null; }

        // World polygon with hole = mask
        const worldRing = [[-90, -180], [-90, 180], [90, 180], [90, -180]];
        const holeRing = boundsPolygon.map(c => [c[1], c[0]]); // [lat, lon]

        maskLayer = L.polygon([worldRing, holeRing], {
            color: "#666",
            weight: 1,
            fillColor: "#111",
            fillOpacity: 0.65,
            interactive: false,
        }).addTo(map);

        // Raster boundary outline
        boundsLayer = L.polygon(holeRing, {
            color: "#00cc66",
            weight: 2,
            dashArray: "6 4",
            fillOpacity: 0,
            interactive: false,
        }).addTo(map);

        // Fit map to raster
        map.fitBounds(holeRing, { padding: [30, 30] });
    }

    /**
     * Clear raster boundary display.
     */
    function clearRasterBounds() {
        if (maskLayer) { map.removeLayer(maskLayer); maskLayer = null; }
        if (boundsLayer) { map.removeLayer(boundsLayer); boundsLayer = null; }
    }

    /**
     * Set query point marker.
     */
    function setQueryPoint(lat, lon) {
        if (queryMarker) map.removeLayer(queryMarker);
        queryMarker = L.circleMarker([lat, lon], {
            radius: 7,
            color: "#ff3333",
            fillColor: "#ff5555",
            fillOpacity: 0.9,
            weight: 2,
        }).addTo(map).bindTooltip(`Query: ${lat.toFixed(5)}, ${lon.toFixed(5)}`);
    }

    /**
     * Draw result geometries on the map.
     * Sort by area descending so smaller shapes render on top for proper hover.
     */
    function showResults(results) {
        resultsLayer.clearLayers();
        markerLayer.clearLayers();

        // Attach original index for consistent colors, then sort largest first
        // so smaller shapes are added last (on top) for proper hover
        const indexed = results.map((r, i) => ({ ...r, _origIndex: i }));
        indexed.sort((a, b) => {
            const areaA = L.geoJSON(a.geometry).getBounds().getNorthEast().distanceTo(
                L.geoJSON(a.geometry).getBounds().getSouthWest());
            const areaB = L.geoJSON(b.geometry).getBounds().getNorthEast().distanceTo(
                L.geoJSON(b.geometry).getBounds().getSouthWest());
            return areaB - areaA;
        });

        indexed.forEach((r) => {
            const color = COLORS[r._origIndex % COLORS.length];
            const geoLayer = L.geoJSON(r.geometry, {
                style: {
                    color: color,
                    weight: 2.5,
                    fillColor: color,
                    fillOpacity: 0.10,
                },
            }).bindTooltip(r.label);
            resultsLayer.addLayer(geoLayer);

            // If result has _lat/_lon (compare query), add marker
            if (r.stats && r.stats._lat !== undefined) {
                const marker = L.circleMarker([r.stats._lat, r.stats._lon], {
                    radius: 6,
                    color: color,
                    fillColor: color,
                    fillOpacity: 0.8,
                    weight: 2,
                }).bindTooltip(r.label);
                markerLayer.addLayer(marker);
            }
        });

        // Fit to results
        if (results.length > 0) {
            const allBounds = L.featureGroup(
                [...resultsLayer.getLayers(), ...markerLayer.getLayers()]
            );
            if (allBounds.getLayers().length > 0) {
                map.fitBounds(allBounds.getBounds(), { padding: [40, 40] });
            }
        }
    }

    function clearResults() {
        resultsLayer.clearLayers();
        markerLayer.clearLayers();
        if (queryMarker) { map.removeLayer(queryMarker); queryMarker = null; }
    }

    function invalidateSize() {
        if (map) setTimeout(() => map.invalidateSize(), 100);
    }

    return {
        init, onMapClick, showRasterBounds, clearRasterBounds,
        setQueryPoint, showResults, clearResults, invalidateSize,
    };
})();