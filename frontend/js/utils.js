// Coordinate parsing and number formatting utilities

const Utils = (() => {

    /**
     * Parse flexible coordinate strings.
     * Accepts: "12.8298", "12° 49' 47.25\" N", "12 49 47.25 N", "-12.8298"
     */
    function parseCoord(s, isLat) {
        s = s.trim();
        if (!s) throw new Error("Empty coordinate");

        // Try plain number first
        const plain = parseFloat(s);
        if (!isNaN(plain) && /^-?\d+(\.\d+)?$/.test(s.trim())) {
            return plain;
        }

        // Extract hemisphere
        let hemi = null;
        const upper = s.toUpperCase();
        for (const h of ["N", "S", "E", "W"]) {
            if (upper.includes(h)) {
                hemi = h;
                s = s.replace(new RegExp(h, "gi"), "").trim();
                break;
            }
        }

        // Replace non-numeric chars with spaces
        const cleaned = s.replace(/[^\d.\-]/g, " ");
        const parts = cleaned.split(/\s+/).filter(p => p.length > 0);

        if (parts.length === 0) throw new Error("No numeric parts found");

        const deg = parseFloat(parts[0]) || 0;
        const min = parts.length > 1 ? parseFloat(parts[1]) || 0 : 0;
        const sec = parts.length > 2 ? parseFloat(parts[2]) || 0 : 0;

        let dd = Math.abs(deg) + min / 60.0 + sec / 3600.0;

        if (hemi) {
            if (isLat && !["N", "S"].includes(hemi))
                throw new Error("Latitude must use N or S");
            if (!isLat && !["E", "W"].includes(hemi))
                throw new Error("Longitude must use E or W");
            if (hemi === "S" || hemi === "W") dd = -dd;
        } else {
            if (deg < 0) dd = -dd;
        }

        if (isLat && (dd < -90 || dd > 90))
            throw new Error(`Latitude ${dd} out of range`);
        if (!isLat && (dd < -180 || dd > 180))
            throw new Error(`Longitude ${dd} out of range`);

        return dd;
    }


    /**
     * Pick display unit so largest value has ≤4 digits before decimal.
     * Single-digit millions → K, double-digit millions → M.
     */
    function pickUnit(maxVal) {
        const abs = Math.abs(maxVal);
        if (abs >= 10_000_000_000) return { suffix: "B", divisor: 1_000_000_000 };
        if (abs >= 10_000_000)     return { suffix: "M", divisor: 1_000_000 };
        if (abs >= 10_000)         return { suffix: "K", divisor: 1_000 };
        return { suffix: "", divisor: 1 };
    }


    /**
     * Format a number for chart display (scaled with 2 decimals).
     */
    function fmtChart(value, divisor) {
        return (value / divisor).toFixed(2);
    }


    /**
     * Format a number for table display (full integer with commas).
     */
    function fmtTable(value) {
        return Math.round(value).toLocaleString("en-US");
    }


    /**
     * Parse a comma-separated list of numbers.
     */
    function parseNumberList(s) {
        return s.replace(/;/g, ",")
            .split(",")
            .map(x => x.trim())
            .filter(x => x.length > 0)
            .map(x => parseFloat(x))
            .filter(x => !isNaN(x));
    }


    /**
     * Parse multi-point text: "name, lat, lon" per line.
     */
    function parsePoints(text) {
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
        const points = [];
        const errors = [];

        for (let i = 0; i < lines.length; i++) {
            const parts = lines[i].split(",").map(p => p.trim());
            if (parts.length < 3) {
                errors.push(`Line ${i + 1}: expected name, lat, lon`);
                continue;
            }
            try {
                points.push({
                    name: parts[0],
                    lat: parseCoord(parts[1], true),
                    lon: parseCoord(parts[2], false),
                });
            } catch (e) {
                errors.push(`Line ${i + 1} (${parts[0]}): ${e.message}`);
            }
        }
        return { points, errors };
    }

    return { parseCoord, pickUnit, fmtChart, fmtTable, parseNumberList, parsePoints };
})();