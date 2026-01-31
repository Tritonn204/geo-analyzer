"""
Core GeoTIFF processing engine.
Handles raster loading, zonal statistics, and geometry building.
"""

import os
import tempfile
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer, Geod
from shapely.geometry import Point, Polygon, box, mapping

try:
    from exactextract import exact_extract
    HAS_EXACT = True
except ImportError:
    HAS_EXACT = False

WGS84 = "EPSG:4326"
CIRCLE_PTS = 360

# ── Dataclasses ──────────────────────────────────────────────────────────────

@dataclass
class RasterInfo:
    path: str
    crs: str
    width: int
    height: int
    res_x: float
    res_y: float
    bands: int
    nodata: float | None
    bounds: dict  # {west, south, east, north} in WGS84
    bounds_polygon: list  # [[lon, lat], ...] ring in WGS84


@dataclass
class QueryResult:
    label: str
    geometry_geojson: dict
    stats: dict[str, float]


# ── Raster Store ─────────────────────────────────────────────────────────────

class RasterStore:
    """
    Manages loaded rasters. Stores temp files and metadata.
    Thread-safe enough for single-user Electron use.
    """

    def __init__(self):
        self._rasters: dict[str, RasterInfo] = {}
        self._tmp_dir = tempfile.mkdtemp(prefix="geo_analyzer_")

    def load(self, filename: str, data: bytes) -> tuple[str, RasterInfo]:
        """Save uploaded bytes, read metadata, return (raster_id, info)."""
        raster_id = uuid.uuid4().hex[:12]
        ext = Path(filename).suffix or ".tif"
        path = os.path.join(self._tmp_dir, f"{raster_id}{ext}")

        with open(path, "wb") as f:
            f.write(data)

        with rasterio.open(path) as ds:
            # get bounds in WGS84
            b = ds.bounds
            if ds.crs and not ds.crs.is_geographic:
                to_wgs = Transformer.from_crs(ds.crs, WGS84, always_xy=True)
                corners = [
                    to_wgs.transform(b.left, b.bottom),
                    to_wgs.transform(b.right, b.bottom),
                    to_wgs.transform(b.right, b.top),
                    to_wgs.transform(b.left, b.top),
                ]
            else:
                corners = [
                    (b.left, b.bottom),
                    (b.right, b.bottom),
                    (b.right, b.top),
                    (b.left, b.top),
                ]

            bounds_wgs = {
                "west": min(c[0] for c in corners),
                "south": min(c[1] for c in corners),
                "east": max(c[0] for c in corners),
                "north": max(c[1] for c in corners),
            }
            ring = [[c[0], c[1]] for c in corners]
            ring.append(ring[0])

            info = RasterInfo(
                path=path,
                crs=str(ds.crs),
                width=ds.width,
                height=ds.height,
                res_x=ds.res[0],
                res_y=ds.res[1],
                bands=ds.count,
                nodata=ds.nodata,
                bounds=bounds_wgs,
                bounds_polygon=ring,
            )

        self._rasters[raster_id] = info
        return raster_id, info

    def get(self, raster_id: str) -> RasterInfo | None:
        return self._rasters.get(raster_id)

    def remove(self, raster_id: str):
        info = self._rasters.pop(raster_id, None)
        if info and os.path.exists(info.path):
            try:
                os.unlink(info.path)
            except OSError:
                pass

    def cleanup_all(self):
        for rid in list(self._rasters.keys()):
            self.remove(rid)
        try:
            os.rmdir(self._tmp_dir)
        except OSError:
            pass


# ── Geometry Builders ────────────────────────────────────────────────────────

def geodesic_circle(lon: float, lat: float, radius_m: float,
                    n: int = CIRCLE_PTS) -> Polygon:
    geod = Geod(ellps="WGS84")
    az = np.linspace(0, 360, n, endpoint=False)
    lons, lats, _ = geod.fwd(
        np.full(n, lon), np.full(n, lat), az, np.full(n, radius_m)
    )
    coords = list(zip(lons.tolist(), lats.tolist()))
    coords.append(coords[0])
    return Polygon(coords)


def geodesic_annulus(lon, lat, inner_m, outer_m, n=CIRCLE_PTS):
    outer = geodesic_circle(lon, lat, outer_m, n)
    inner = geodesic_circle(lon, lat, inner_m, n)
    return outer.difference(inner)


def rect_from_center(lon, lat, half_w_m, half_h_m):
    geod = Geod(ellps="WGS84")
    n_lon, n_lat, _ = geod.fwd(lon, lat, 0, half_h_m)
    s_lon, s_lat, _ = geod.fwd(lon, lat, 180, half_h_m)
    e_lon, e_lat, _ = geod.fwd(lon, lat, 90, half_w_m)
    w_lon, w_lat, _ = geod.fwd(lon, lat, 270, half_w_m)
    return box(float(w_lon), float(s_lat), float(e_lon), float(n_lat))


# ── Zonal Stats ──────────────────────────────────────────────────────────────

def compute_stats(tif_path: str, geom: Polygon,
                  stats: list[str], band: int = 1) -> dict[str, float]:
    """
    Compute zonal statistics using exactextract (preferred)
    or rasterio.mask fallback.
    """
    import geopandas as gpd

    gdf = gpd.GeoDataFrame(geometry=[geom], crs=WGS84)

    if HAS_EXACT:
        result = exact_extract(tif_path, gdf, stats, output="pandas")
        row = result.iloc[0]
        return {s: float(row[s]) for s in stats}
    else:
        from rasterio.mask import mask as rio_mask
        with rasterio.open(tif_path) as ds:
            if ds.crs and not ds.crs.is_geographic:
                to_crs = Transformer.from_crs(WGS84, ds.crs, always_xy=True)
                xs, ys = to_crs.transform(*geom.exterior.xy)
                geom_native = Polygon(zip(xs, ys))
            else:
                geom_native = geom

            arr, _ = rio_mask(
                ds, [mapping(geom_native)], crop=True,
                filled=False, all_touched=True, indexes=band
            )
            arr = arr[0]
            nd = ds.nodata
            if nd is not None:
                arr = np.ma.masked_where(arr == nd, arr)

            out = {}
            for s in stats:
                if s == "sum":
                    out[s] = float(arr.sum())
                elif s == "mean":
                    out[s] = float(arr.mean())
                elif s == "max":
                    out[s] = float(arr.max())
                elif s == "min":
                    out[s] = float(arr.min())
                elif s == "count":
                    out[s] = float(arr.count())
                elif s == "stdev":
                    out[s] = float(arr.std())
                elif s == "median":
                    out[s] = float(np.ma.median(arr))
                else:
                    out[s] = float("nan")
            return out


# ── Query Runners ────────────────────────────────────────────────────────────

def run_circle_query(tif_path: str, lon: float, lat: float,
                     radii_km: list[float], stats: list[str],
                     band: int = 1) -> list[QueryResult]:
    results = []
    for r in sorted(radii_km):
        circ = geodesic_circle(lon, lat, r * 1000)
        vals = compute_stats(tif_path, circ, stats, band)
        results.append(QueryResult(
            label=f"{r} km",
            geometry_geojson=mapping(circ),
            stats=vals,
        ))
    return results


def run_band_query(tif_path: str, lon: float, lat: float,
                   edges_km: list[float], stats: list[str],
                   band: int = 1) -> list[QueryResult]:
    edges = sorted(set(edges_km))
    results = []
    for i in range(len(edges) - 1):
        inner, outer = edges[i], edges[i + 1]
        ring = geodesic_annulus(lon, lat, inner * 1000, outer * 1000)
        vals = compute_stats(tif_path, ring, stats, band)
        results.append(QueryResult(
            label=f"{inner}–{outer} km",
            geometry_geojson=mapping(ring),
            stats=vals,
        ))
    return results


def run_rect_query(tif_path: str, lon: float, lat: float,
                   half_w_km: float, half_h_km: float,
                   stats: list[str], band: int = 1) -> list[QueryResult]:
    rect = rect_from_center(lon, lat, half_w_km * 1000, half_h_km * 1000)
    vals = compute_stats(tif_path, rect, stats, band)
    return [QueryResult(
        label=f"{half_w_km*2}×{half_h_km*2} km",
        geometry_geojson=mapping(rect),
        stats=vals,
    )]


def run_compare_query(tif_path: str,
                      points: list[dict],  # [{name, lat, lon}, ...]
                      radius_km: float,
                      stats: list[str],
                      band: int = 1) -> list[QueryResult]:
    results = []
    for pt in points:
        circ = geodesic_circle(pt["lon"], pt["lat"], radius_km * 1000)
        vals = compute_stats(tif_path, circ, stats, band)
        results.append(QueryResult(
            label=pt["name"],
            geometry_geojson=mapping(circ),
            stats={**vals, "_lat": pt["lat"], "_lon": pt["lon"]},
        ))
    return results