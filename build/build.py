"""
Cross-platform build script.
Creates a standalone app bundle with embedded Python + Electron.

Usage:
    python build/build.py          # builds for current platform
    python build/build.py --all    # guidance for all platforms
"""

import os
import sys
import shutil
import subprocess
import shutil as _shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"


def _resolve_command(cmd0: str) -> str:
    """
    Resolve an executable name in a cross-platform way.
    On Windows, prefer .cmd shims (npm.cmd, npx.cmd, etc.) when present.
    """
    # If user already provided a path or has an extension, keep it
    base, ext = os.path.splitext(cmd0)
    if ext or os.path.sep in cmd0 or (os.path.altsep and os.path.altsep in cmd0):
        return cmd0

    if os.name == "nt":
        # Prefer npm.cmd-style shims first
        for candidate in (cmd0 + ".cmd", cmd0 + ".exe", cmd0 + ".bat"):
            found = _shutil.which(candidate)
            if found:
                return found
        # Fall back to plain resolution
        found = _shutil.which(cmd0)
        if found:
            return found
        return cmd0

    # POSIX: normal which resolution
    found = _shutil.which(cmd0)
    return found or cmd0


def run(cmd, **kwargs):
    cmd = list(cmd)
    cmd[0] = _resolve_command(cmd[0])
    print(f"  → {' '.join(cmd)}")
    subprocess.check_call(cmd, **kwargs)


def check_deps():
    """Verify build tools are available."""
    errors = []

    # Node / npm
    try:
        run(["node", "--version"])
    except Exception:
        errors.append("Node.js not found or not on PATH. Install from https://nodejs.org")

    try:
        run(["npm", "--version"])
    except Exception:
        errors.append("npm not found or not on PATH (Windows often needs npm.cmd). Reinstall Node.js or fix PATH.")

    # Python
    try:
        run([sys.executable, "--version"])
    except Exception:
        errors.append("Python not found")

    if errors:
        print("\n".join(["BUILD ERRORS:"] + errors))
        sys.exit(1)


def install_npm_deps():
    print("\n[1/4] Installing npm dependencies…")
    run(["npm", "install"], cwd=str(ROOT))
    run(["npm", "install"], cwd=str(ROOT / "electron"))


def install_python_deps():
    print("\n[2/4] Installing Python dependencies…")
    run([sys.executable, "-m", "pip", "install", "-r", str(ROOT / "requirements.txt")])


def build_backend_exe():
    print("\n[3/4] Building backend executable…")
    out_dir = DIST / "backend_bin"
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    # Ensure pyinstaller is available
    run([sys.executable, "-m", "pip", "install", "pyinstaller"])

    spec_file = ROOT / "geo_backend.spec"
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--noconfirm",
        "--clean",
        "--distpath", str(out_dir),
        str(spec_file),
    ]

    run(cmd)

    # Path to the built executable (onedir: folder/exe)
    exe_name = "geo_backend.exe" if os.name == "nt" else "geo_backend"
    exe_path = out_dir / "geo_backend" / exe_name

    if not exe_path.exists():
        raise RuntimeError(f"Backend executable not found: {exe_path}")

    # Ensure executable bit on macOS/Linux
    if os.name != "nt":
        exe_path.chmod(exe_path.stat().st_mode | 0o111)

    print(f"  Backend exe: {exe_path}")


def build_electron():
    print("\n[4/4] Building Electron app…")
    run(["npx", "electron-builder"], cwd=str(ROOT / "electron"))


def main():
    print("=" * 60)
    print("  Geo Analyzer — Build Script")
    print("=" * 60)

    check_deps()
    install_npm_deps()
    install_python_deps()
    build_backend_exe()
    build_electron()

    print("\n" + "=" * 60)
    print("  BUILD COMPLETE")
    print(f"  Output: {DIST}")
    print("=" * 60)


if __name__ == "__main__":
    if "--all" in sys.argv:
        print("""
Cross-platform builds:

  Windows:  python build/build.py        → dist/Geo Analyzer Setup.exe
  macOS:    python build/build.py        → dist/Geo Analyzer.dmg
  Linux:    python build/build.py        → dist/Geo Analyzer.AppImage

Note: Electron apps must be built ON the target platform.
For CI, use GitHub Actions with a matrix of os: [ubuntu, windows, macos].
        """)
    else:
        main()
