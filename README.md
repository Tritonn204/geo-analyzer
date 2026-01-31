# 🌍 Geo Analyzer

Desktop application for analyzing GeoTIFF raster data within
geographic regions (circles, bands, rectangles).

## Features
- **Circle query**: Sum/mean/max within radius
- **Band query**: Concentric ring analysis
- **Rectangle query**: Bounding box analysis  
- **Multi-point compare**: Side-by-side location comparison
- **Smart formatting**: Auto-scaled chart units
- **Raster masking**: Visual boundary on map
- **CSV export**: Download results
- **Drag & drop**: Drop .tif files onto the map

## Requirements
- Python 3.10+
- Node.js 18+
- GDAL system libraries (`apt install libgdal-dev` / `brew install gdal`)

## Quick Start (Development)
```bash
pip install -r requirements.txt
npm install

# Terminal 1
python -c "from backend.server import main; main()"

# Terminal 2
cd electron && npx electron .