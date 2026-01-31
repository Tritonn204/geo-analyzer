const ChartManager = (() => {
    let chartInstance = null;
    let lastChartConfig = null;

    const COLORS = {
        fills: [
            "#4c78a8", "#f58518", "#e45756", "#72b7b2",
            "#54a24b", "#eeca3b", "#b279a2", "#ff9da6",
            "#9d755d", "#bab0ac",
        ],
        borders: [
            "#3b6291", "#d4700e", "#c93d3b", "#5a9995",
            "#438a3c", "#c9a82e", "#955f87", "#e07d86",
            "#7f5e49", "#9a938f",
        ],
    };

    // ── Formatting ──────────────────────────────────────────────

    function makeAxisLabel(statName, suffix) {
        return suffix ? `${statName} (${suffix})` : statName;
    }

    function makeSubtitle(values, statName, suffix, divisor) {
        const total = values.reduce((a, b) => a + b, 0);
        const min = Math.min(...values);
        const max = Math.max(...values);
        return `Total: ${Utils.fmtTable(total)} · ` +
               `Range: ${Utils.fmtTable(min)} – ${Utils.fmtTable(max)} · ` +
               `${values.length} items`;
    }

    // ── Bar Chart ───────────────────────────────────────────────

    function renderBar(canvasId, labels, values, statName, options = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        destroyChart();

        const maxVal = Math.max(...values.map(Math.abs), 0);
        const { suffix, divisor } = Utils.pickUnit(maxVal);
        const scaled = values.map(v => v / divisor);
        const axisLabel = makeAxisLabel(statName, suffix);

        const bgColors = values.map((_, i) => COLORS.fills[i % COLORS.fills.length]);
        const borderColors = values.map((_, i) => COLORS.borders[i % COLORS.borders.length]);

        // Update modal subtitle
        const subtitleEl = document.getElementById("chart-modal-subtitle");
        if (subtitleEl) {
            subtitleEl.textContent = makeSubtitle(values, statName, suffix, divisor);
        }

        chartInstance = new Chart(canvas, {
            type: "bar",
            data: {
                labels,
                datasets: [{
                    label: axisLabel,
                    data: scaled,
                    backgroundColor: bgColors,
                    borderColor: borderColors,
                    borderWidth: 1.5,
                    borderRadius: 4,
                    borderSkipped: false,
                }],
            },
            options: {
                indexAxis: "y",
                responsive: true,
                maintainAspectRatio: false,
                animation: {
                    duration: 500,
                    easing: "easeOutCubic",
                },
                layout: {
                    padding: { right: 80, top: 10, bottom: 10, left: 10 },
                },
                plugins: {
                    title: {
                        display: true,
                        text: options.title || `${statName} by region`,
                        color: "#1f2937",
                        font: { size: 16, weight: "700", family: "system-ui, sans-serif" },
                        padding: { bottom: 20 },
                    },
                    legend: {
                        display: true,
                        position: "bottom",
                        labels: {
                            color: "#6b7280",
                            font: { size: 12 },
                            boxWidth: 14,
                            padding: 16,
                            usePointStyle: true,
                            pointStyle: "rectRounded",
                            generateLabels: () => [{
                                text: axisLabel,
                                fillStyle: COLORS.fills[0],
                                strokeStyle: COLORS.borders[0],
                                lineWidth: 1,
                            }],
                        },
                    },
                    tooltip: {
                        backgroundColor: "#fff",
                        titleColor: "#1f2937",
                        bodyColor: "#374151",
                        borderColor: "#e5e7eb",
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        boxPadding: 4,
                        titleFont: { weight: "700", size: 13 },
                        bodyFont: { size: 12 },
                        callbacks: {
                            title: (items) => items[0].label,
                            label: (ctx) => {
                                const raw = values[ctx.dataIndex];
                                return ` ${statName}: ${Utils.fmtTable(raw)}`;
                            },
                            afterLabel: (ctx) => {
                                const parts = [];
                                if (suffix) {
                                    parts.push(` Scaled: ${scaled[ctx.dataIndex].toFixed(2)} ${suffix}`);
                                }
                                if (values.length > 1) {
                                    const total = values.reduce((a, b) => a + b, 0);
                                    if (total > 0) {
                                        const pct = ((values[ctx.dataIndex] / total) * 100).toFixed(1);
                                        parts.push(` Share: ${pct}%`);
                                    }
                                }
                                return parts;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        grid: {
                            color: "#f3f4f6",
                            drawBorder: false,
                        },
                        ticks: {
                            color: "#6b7280",
                            font: { size: 11 },
                            callback: (v) => `${v.toFixed(2)}`,
                            maxTicksLimit: 8,
                        },
                        title: {
                            display: true,
                            text: axisLabel,
                            color: "#374151",
                            font: { size: 13, weight: "600" },
                            padding: { top: 10 },
                        },
                    },
                    y: {
                        grid: { display: false },
                        ticks: {
                            color: "#1f2937",
                            font: { size: 12, weight: "500" },
                            padding: 8,
                        },
                        title: {
                            display: labels.length > 2,
                            text: options.yLabel || "",
                            color: "#6b7280",
                            font: { size: 12 },
                        },
                    },
                },
            },
            plugins: [{
                id: "barEndLabels",
                afterDatasetsDraw(chart) {
                    const { ctx } = chart;
                    const meta = chart.getDatasetMeta(0);
                    meta.data.forEach((bar, i) => {
                        const val = scaled[i];
                        const text = suffix
                            ? `${val.toFixed(2)} ${suffix}`
                            : Utils.fmtTable(values[i]);

                        ctx.save();
                        ctx.fillStyle = "#374151";
                        ctx.font = "600 12px system-ui, sans-serif";
                        ctx.textAlign = "left";
                        ctx.textBaseline = "middle";
                        ctx.fillText(text, bar.x + 8, bar.y);
                        ctx.restore();
                    });
                },
            }],
        });
    }

    // ── Pie / Doughnut Chart ────────────────────────────────────

    function renderPie(canvasId, labels, values, statName, options = {}) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        destroyChart();

        const total = values.reduce((a, b) => a + b, 0);
        const bgColors = values.map((_, i) => COLORS.fills[i % COLORS.fills.length]);

        const subtitleEl = document.getElementById("chart-modal-subtitle");
        if (subtitleEl) {
            subtitleEl.textContent = `Total: ${Utils.fmtTable(total)} · ${values.length} segments`;
        }

        chartInstance = new Chart(canvas, {
            type: "doughnut",
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: bgColors,
                    borderColor: "#ffffff",
                    borderWidth: 3,
                    hoverBorderWidth: 0,
                    hoverOffset: 8,
                }],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "45%",
                animation: {
                    duration: 600,
                    easing: "easeOutCubic",
                },
                layout: {
                    padding: 20,
                },
                plugins: {
                    title: {
                        display: true,
                        text: options.title || `${statName} distribution`,
                        color: "#1f2937",
                        font: { size: 16, weight: "700", family: "system-ui, sans-serif" },
                        padding: { bottom: 16 },
                    },
                    legend: {
                        position: "right",
                        labels: {
                            color: "#374151",
                            font: { size: 12 },
                            padding: 12,
                            usePointStyle: true,
                            pointStyle: "circle",
                            generateLabels: (chart) => {
                                return chart.data.labels.map((label, i) => {
                                    const val = chart.data.datasets[0].data[i];
                                    const pct = total > 0
                                        ? ((val / total) * 100).toFixed(1) : "0.0";
                                    return {
                                        text: `${label}: ${Utils.fmtTable(val)} (${pct}%)`,
                                        fillStyle: bgColors[i],
                                        strokeStyle: "#fff",
                                        lineWidth: 2,
                                        index: i,
                                    };
                                });
                            },
                        },
                    },
                    tooltip: {
                        backgroundColor: "#fff",
                        titleColor: "#1f2937",
                        bodyColor: "#374151",
                        borderColor: "#e5e7eb",
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 12,
                        callbacks: {
                            label: (ctx) => {
                                const val = ctx.raw;
                                const pct = total > 0
                                    ? ((val / total) * 100).toFixed(1) : "0.0";
                                return ` ${statName}: ${Utils.fmtTable(val)} (${pct}%)`;
                            },
                        },
                    },
                },
            },
            plugins: [{
                // Center label showing total
                id: "centerText",
                afterDraw(chart) {
                    const { ctx, chartArea } = chart;
                    const centerX = (chartArea.left + chartArea.right) / 2;
                    const centerY = (chartArea.top + chartArea.bottom) / 2;

                    const { suffix, divisor } = Utils.pickUnit(total);
                    const scaledTotal = (total / divisor).toFixed(1);
                    const displayTotal = suffix ? `${scaledTotal}${suffix}` : Utils.fmtTable(total);

                    ctx.save();
                    ctx.fillStyle = "#9ca3af";
                    ctx.font = "500 11px system-ui, sans-serif";
                    ctx.textAlign = "center";
                    ctx.textBaseline = "bottom";
                    ctx.fillText("Total", centerX, centerY - 2);

                    ctx.fillStyle = "#1f2937";
                    ctx.font = "700 18px system-ui, sans-serif";
                    ctx.textBaseline = "top";
                    ctx.fillText(displayTotal, centerX, centerY + 2);
                    ctx.restore();
                },
            }],
        });
    }

    // ── Public API ──────────────────────────────────────────────

    function render(canvasId, labels, values, statName, options = {}) {
        lastChartConfig = { canvasId, labels, values, statName, options };
        renderBar(canvasId, labels, values, statName, options);
    }

    function renderAsPie(canvasId, labels, values, statName, options = {}) {
        lastChartConfig = { canvasId, labels, values, statName, options, type: "pie" };
        renderPie(canvasId, labels, values, statName, options);
    }

    function rerender() {
        if (!lastChartConfig) return;
        const c = lastChartConfig;
        const chartType = document.getElementById("chart-type-select")?.value || "bar";
        if (chartType === "pie") {
            renderPie(c.canvasId, c.labels, c.values, c.statName, c.options);
        } else {
            renderBar(c.canvasId, c.labels, c.values, c.statName, c.options);
        }
    }

    function updateStat(statName, values) {
        if (!lastChartConfig) return;
        lastChartConfig.statName = statName;
        lastChartConfig.values = values;
        rerender();
    }

    function exportPNG(filename = "chart.png") {
        if (!chartInstance) return;
        // Render at higher res for export
        const url = chartInstance.toBase64Image("image/png", 1.0);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
    }

    function destroyChart() {
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
    }

    function clear() {
        destroyChart();
        lastChartConfig = null;
    }

    function hasChart() {
        return chartInstance !== null;
    }

    function getConfig() {
        return lastChartConfig;
    }

    return {
        render, renderAsPie, rerender, updateStat,
        exportPNG, clear, hasChart, getConfig,
    };
})();