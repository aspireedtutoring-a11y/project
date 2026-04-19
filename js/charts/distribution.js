/**
 * Pre / Main / Post distribution chart.
 *
 * Shows per-event absolute bp moves in each window as a
 * grouped column chart so you can see the spread across events.
 */

let chart = null;

/**
 * @param {AnalysisResult} result
 */
export function renderDistribution(result) {
  const container = document.getElementById("distributionChart");

  if (!result || result.perEvent.length === 0) {
    container.innerHTML = '<div class="loading-text">No data for distribution.</div>';
    if (chart) { chart.destroy(); chart = null; }
    return;
  }

  // Sort events by date
  const sorted = [...result.perEvent].sort(
    (a, b) => new Date(a.dateUTC) - new Date(b.dateUTC)
  );

  const categories = sorted.map((e) =>
    new Date(e.dateUTC).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })
  );

  const preSeries  = sorted.map((e) => e.windows.pre.metrics.totalAbsBp);
  const mainSeries = sorted.map((e) => e.windows.main.metrics.totalAbsBp);
  const postSeries = sorted.map((e) => e.windows.post.metrics.totalAbsBp);

  if (chart) {
    chart.xAxis[0].setCategories(categories, false);
    chart.series[0].setData(preSeries, false);
    chart.series[1].setData(mainSeries, false);
    chart.series[2].setData(postSeries, false);
    chart.redraw();
    return;
  }

  chart = Highcharts.chart(container, {
    chart: { type: "column", height: 260 },
    title: { text: null },
    xAxis: {
      categories,
      labels: { style: { fontSize: "9px" }, rotation: -45 },
    },
    yAxis: {
      title: { text: "Total |bp| move", style: { fontSize: "11px" } },
      min: 0,
    },
    plotOptions: {
      column: { grouping: true, pointPadding: 0.1, groupPadding: 0.15 },
    },
    series: [
      { name: "Pre-window",  data: preSeries,  color: "#999999" },
      { name: "Main window", data: mainSeries, color: "#db0011" },
      { name: "Post-window", data: postSeries, color: "#ffb3b8" },
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
