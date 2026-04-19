/**
 * Offset / Length heatmap — shows median |bp| move for each
 * (offset, length) cell in the optimiser grid.
 *
 * The cell with the highest score is the calibrated best window.
 */

let chart = null;

function fmtSec(sec) {
  const sign = sec < 0 ? "\u2212" : "+";
  const abs = Math.abs(sec);
  if (abs < 60) return `${sign}${abs}s`;
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return s ? `${sign}${m}m${s}s` : `${sign}${m}m`;
}

/**
 * @param {AnalysisResult} result
 */
export function renderHeatmap(result) {
  const container = document.getElementById("heatmapChart");

  if (!result || result.heatmapGrid.length === 0) {
    container.innerHTML = '<div class="loading-text">No data for heatmap.</div>';
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  const offsets = result.heatmapOffsets;
  const lengths = result.heatmapLengths;

  // Build index maps
  const offsetIdx = {};
  offsets.forEach((o, i) => { offsetIdx[o] = i; });
  const lengthIdx = {};
  lengths.forEach((l, i) => { lengthIdx[l] = i; });

  const data = result.heatmapGrid.map((cell) => [
    offsetIdx[cell.offset],
    lengthIdx[cell.length],
    cell.medianAbsBp,
  ]);

  // Find max for colour scale
  const maxBp = Math.max(...result.heatmapGrid.map((c) => c.medianAbsBp), 1);

  const xCategories = offsets.map(fmtSec);
  const yCategories = lengths.map((l) => `${l / 60}m`);

  // Highlight best cell
  const bestOI = offsetIdx[result.bestOffset];
  const bestLI = lengthIdx[result.bestLength];

  if (chart) {
    chart.series[0].setData(data, false);
    chart.xAxis[0].setCategories(xCategories, false);
    chart.yAxis[0].setCategories(yCategories, false);
    chart.colorAxis[0].update({ max: maxBp }, false);
    chart.redraw();
    return;
  }

  chart = Highcharts.chart(container, {
    chart: { type: "heatmap", height: 260 },
    title: { text: null },
    xAxis: {
      categories: xCategories,
      title: { text: "Offset from event time", style: { fontSize: "11px" } },
      labels: {
        style: { fontSize: "9px" },
        step: 4,
      },
    },
    yAxis: {
      categories: yCategories,
      title: { text: "Window length", style: { fontSize: "11px" } },
      labels: { style: { fontSize: "9px" } },
      reversed: false,
    },
    colorAxis: {
      min: 0,
      max: maxBp,
      minColor: "#ffffff",
      maxColor: "#db0011",
      labels: { style: { fontSize: "9px" } },
    },
    tooltip: {
      formatter() {
        return `<b>Offset:</b> ${xCategories[this.point.x]}<br>` +
               `<b>Length:</b> ${yCategories[this.point.y]}<br>` +
               `<b>Median |bp|:</b> ${this.point.value.toFixed(1)}`;
      },
    },
    legend: {
      align: "right",
      layout: "vertical",
      verticalAlign: "middle",
      symbolHeight: 180,
    },
    series: [{
      name: "Median |bp|",
      borderWidth: 0.5,
      borderColor: "#e0e0e0",
      data,
      dataLabels: { enabled: false },
    }],
    credits: { enabled: false },
    exporting: { enabled: false },
  });
}
