# -*- mode: python ; coding: utf-8 -*-
import os
import sys
from pathlib import Path
from PyInstaller.utils.hooks import collect_dynamic_libs, collect_data_files, collect_submodules

# SPECPATH is set by PyInstaller to the directory containing this spec file
ROOT = Path(SPECPATH)

# Geo packages with hidden imports
geo_packages = ['rasterio', 'pyproj', 'geopandas', 'shapely', 'exactextract']
binaries = sum([collect_dynamic_libs(p) for p in geo_packages], [])
datas = sum([collect_data_files(p) for p in geo_packages], [])
hiddenimports = sum([collect_submodules(p) for p in geo_packages], [])

# Bundle frontend files
datas += [(str(ROOT / 'frontend'), 'frontend')]

# Windows-specific
if sys.platform == 'win32':
    binaries += collect_dynamic_libs('pywin32')
    hiddenimports += ['pywintypes', 'pythoncom']

a = Analysis(
    [str(ROOT / 'backend' / '__main__.py')],
    pathex=[str(ROOT)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Video/media - not needed
        'moviepy', 'cv2', 'opencv',
        # GUI toolkits - headless backend
        'tkinter', 'PyQt5', 'PyQt6', 'PySide2', 'PySide6', 'wx',
        # Plotting - not needed for API
        'matplotlib', 'plotly', 'bokeh', 'seaborn',
        # Interactive/notebooks - not needed in prod
        'IPython', 'notebook', 'jupyter', 'ipykernel', 'ipywidgets',
        # Testing - not needed in prod
        'pytest', 'unittest', 'nose', 'coverage',
        # Build tools - not needed at runtime
        'setuptools', 'pip', 'wheel', 'distutils',
        # ML frameworks - not needed
        'torch', 'tensorflow', 'keras', 'sklearn', 'scipy',
        # Other heavy packages unlikely to be needed
        'sympy', 'nltk', 'spacy',
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='geo_backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='geo_backend',
)
