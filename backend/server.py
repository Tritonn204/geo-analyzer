"""
Flask API server for the GeoTIFF analyzer.
Serves the frontend and handles all raster operations via REST.
"""

import os
import sys
import json
import signal
import atexit
from pathlib import Path

from flask import Flask, request, jsonify, send_from_directory, abort
from flask_cors import CORS

from .geotiff_engine import (
    RasterStore, HAS_EXACT,
    run_circle_query, run_band_query,
    run_rect_query, run_compare_query,
)

# ── Paths ────────────────────────────────────────────────────────────────────

# In packaged app, frontend is adjacent to backend
if getattr(sys, "frozen", False):
    BASE_DIR = Path(sys._MEIPASS)
else:
    BASE_DIR = Path(__file__).resolve().parent.parent

FRONTEND_DIR = BASE_DIR / "frontend"

# ── App Setup ────────────────────────────────────────────────────────────────

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
CORS(app)

store = RasterStore()
atexit.register(store.cleanup_all)

VALID_STATS = ["sum", "mean", "max", "min", "count", "stdev", "median"]


# ── Frontend Routes ──────────────────────────────────────────────────────────

@app.route("/")
def index():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.route("/css/<path:path>")
def serve_css(path):
    return send_from_directory(str(FRONTEND_DIR / "css"), path)


@app.route("/js/<path:path>")
def serve_js(path):
    return send_from_directory(str(FRONTEND_DIR / "js"), path)


# ── API Routes ───────────────────────────────────────────────────────────────

@app.route("/api/status", methods=["GET"])
def status():
    return jsonify({
        "ok": True,
        "exactextract": HAS_EXACT,
    })


@app.route("/api/upload", methods=["POST"])
def upload_raster():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    f = request.files["file"]
    if not f.filename:
        return jsonify({"error": "Empty filename"}), 400

    data = f.read()
    if len(data) == 0:
        return jsonify({"error": "Empty file"}), 400

    try:
        raster_id, info = store.load(f.filename, data)
    except Exception as e:
        return jsonify({"error": f"Failed to load raster: {e}"}), 400

    return jsonify({
        "raster_id": raster_id,
        "filename": f.filename,
        "crs": info.crs,
        "width": info.width,
        "height": info.height,
        "res": [info.res_x, info.res_y],
        "bands": info.bands,
        "nodata": info.nodata,
        "bounds": info.bounds,
        "bounds_polygon": info.bounds_polygon,
    })


@app.route("/api/unload/<raster_id>", methods=["DELETE"])
def unload_raster(raster_id):
    store.remove(raster_id)
    return jsonify({"ok": True})


def _parse_query_params(data: dict) -> tuple:
    """Extract and validate common query parameters."""
    raster_id = data.get("raster_id")
    if not raster_id:
        raise ValueError("Missing raster_id")

    info = store.get(raster_id)
    if not info:
        raise ValueError("Raster not found. Upload first.")

    stats = data.get("stats", ["sum"])
    stats = [s for s in stats if s in VALID_STATS]
    if not stats:
        stats = ["sum"]

    band = int(data.get("band", 1))
    return info, stats, band


@app.route("/api/query/circle", methods=["POST"])
def query_circle():
    data = request.get_json(force=True)
    try:
        info, stats, band = _parse_query_params(data)
        lon = float(data["lon"])
        lat = float(data["lat"])
        radii = [float(r) for r in data["radii_km"]]
        if not radii:
            raise ValueError("No radii provided")
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({"error": str(e)}), 400

    try:
        results = run_circle_query(info.path, lon, lat, radii, stats, band)
    except Exception as e:
        return jsonify({"error": f"Query failed: {e}"}), 500

    return jsonify({
        "results": [
            {"label": r.label, "geometry": r.geometry_geojson, "stats": r.stats}
            for r in results
        ]
    })


@app.route("/api/query/band", methods=["POST"])
def query_band():
    data = request.get_json(force=True)
    try:
        info, stats, band = _parse_query_params(data)
        lon = float(data["lon"])
        lat = float(data["lat"])
        edges = [float(e) for e in data["edges_km"]]
        if len(edges) < 2:
            raise ValueError("Need at least 2 edges")
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({"error": str(e)}), 400

    try:
        results = run_band_query(info.path, lon, lat, edges, stats, band)
    except Exception as e:
        return jsonify({"error": f"Query failed: {e}"}), 500

    return jsonify({
        "results": [
            {"label": r.label, "geometry": r.geometry_geojson, "stats": r.stats}
            for r in results
        ]
    })


@app.route("/api/query/rect", methods=["POST"])
def query_rect():
    data = request.get_json(force=True)
    try:
        info, stats, band = _parse_query_params(data)
        lon = float(data["lon"])
        lat = float(data["lat"])
        half_w = float(data["half_w_km"])
        half_h = float(data["half_h_km"])
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({"error": str(e)}), 400

    try:
        results = run_rect_query(info.path, lon, lat, half_w, half_h, stats, band)
    except Exception as e:
        return jsonify({"error": f"Query failed: {e}"}), 500

    return jsonify({
        "results": [
            {"label": r.label, "geometry": r.geometry_geojson, "stats": r.stats}
            for r in results
        ]
    })


@app.route("/api/query/compare", methods=["POST"])
def query_compare():
    data = request.get_json(force=True)
    try:
        info, stats, band = _parse_query_params(data)
        radius = float(data["radius_km"])
        points = data["points"]  # [{name, lat, lon}, ...]
        for pt in points:
            pt["lat"] = float(pt["lat"])
            pt["lon"] = float(pt["lon"])
    except (KeyError, ValueError, TypeError) as e:
        return jsonify({"error": str(e)}), 400

    try:
        results = run_compare_query(info.path, points, radius, stats, band)
    except Exception as e:
        return jsonify({"error": f"Query failed: {e}"}), 500

    return jsonify({
        "results": [
            {"label": r.label, "geometry": r.geometry_geojson, "stats": r.stats}
            for r in results
        ]
    })


@app.route("/api/export/csv", methods=["POST"])
def export_csv():
    """Convert results JSON to CSV string."""
    data = request.get_json(force=True)
    results = data.get("results", [])
    if not results:
        return jsonify({"error": "No results"}), 400

    import csv
    import io

    output = io.StringIO()
    # Collect all stat keys
    all_keys = set()
    for r in results:
        all_keys.update(r.get("stats", {}).keys())
    all_keys = sorted(k for k in all_keys if not k.startswith("_"))

    writer = csv.writer(output)
    writer.writerow(["label"] + all_keys)
    for r in results:
        row = [r["label"]]
        for k in all_keys:
            row.append(r.get("stats", {}).get(k, ""))
        writer.writerow(row)

    return jsonify({"csv": output.getvalue()})


# ── Main ─────────────────────────────────────────────────────────────────────

def main(port=8964):
    print(f"Starting Geo Analyzer backend on http://localhost:{port}")
    print(f"Frontend: {FRONTEND_DIR}")
    print(f"exactextract available: {HAS_EXACT}")
    app.run(host="127.0.0.1", port=port, debug=False, threaded=True)


if __name__ == "__main__":
    main()