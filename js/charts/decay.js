/**
 * Decay profile chart.
 *
 * Shows the median |displacement from event level| over time
 * after the main window ends, with the fitted exponential overlay.
 */

let chart = null;

function fmtSec(sec) {
  const sign = sec < 0 ? "\u2212" : "+";
  const m = Math.round(Math.abs(sec) / 60);
  return `${sign}${m}m`;
}

/**
 * @param {AnalysisResult} result
 */
export function renderDecay(result) {
  const container = document.getElementById("decayChart");

  if (!result || result.perEvent.length === 0 || !result.windows) {
    container.innerHTML = '<div class="loading-text">No data for decay profile.</div>';
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  // Build median displacement curve across events, sampled every 30s in post window
  const postStart = result.windows.post.startSec;
  const postEnd   = result.windows.post.endSec;
  const step = 30;

  const timePoints = [];
  for (let s = postStart; s <= postEnd; s += step) {
    timePoints.push(s);
  }

  const medianCurve = timePoints.map((sec) => {
    const disps = result.perEvent.map((ev) => {
      // Find closest return tick
      const mainStartCum = ev.returns.find((r) => r.offsetSec >= result.windows.main.startSec);
      const tick = ev.returns.find((r) => r.offsetSec >= sec);
      if (!mainStartCum || !tick) return 0;
      return Math.abs(tick.cumBp - (mainStartCum.cumBp - mainStartCum.bpReturn));
    });
    const sorted = [...disps].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return [sec / 60, parseFloat(med.toFixed(2))]; // x in minutes
  });

  // Build median fitted curve from per-event decay fits
  const fittedCurve = timePoints.map((sec) => {
    const vals = result.perEvent
      .map((ev) => {
        const pt = ev.decay.curve.find((c) => c.sec >= sec);
        return pt ? pt.bp : null;
      })
      .filter((v) => v !== null);
    if (!vals.length) return [sec / 60, 0];
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return [sec / 60, parseFloat((sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2).toFixed(2))];
  });

  if (chart) {
    chart.series[0].setData(medianCurve, false);
    chart.series[1].setData(fittedCurve, false);
    chart.redraw();
    return;
  }

  chart = Highcharts.chart(container, {
    chart: { type: "line", height: 260 },
    title: { text: null },
    xAxis: {
      title: { text: "Minutes from event", style: { fontSize: "11px" } },
      plotLines: [{
        value: result.windows.main.endSec / 60,
        color: "#db0011",
        width: 1,
        dashStyle: "Dash",
        label: { text: "Main window end", style: { fontSize: "9px", color: "#db0011" } },
      }],
    },
    yAxis: {
      title: { text: "|bp| from pre-event level", style: { fontSize: "11px" } },
      min: 0,
    },
    series: [
      {
        name: "Median observed",
        data: medianCurve,
        color: "#111111",
        lineWidth: 1.5,
        marker: { radius: 2 },
      },
      {
        name: "Fitted decay",
        data: fittedCurve,
        color: "#db0011",
        dashStyle: "ShortDash",
        lineWidth: 1.5,
        marker: { enabled: false },
      },
    ],
    legend: {
      align: "center",
      verticalAlign: "bottom",
      itemStyle: { fontSize: "10px" },
    },
    credits: { enabled: false },
    exporting: { enabled: false },
  });
}
