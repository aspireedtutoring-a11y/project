/**
 * Single-event list and deep-dive panel.
 *
 * The list shows each historical release with its main-window bp move.
 * Clicking a row opens the detail tab with:
 *   - 5s tick price path with pre/main/post window bands
 *   - Window metrics table
 *   - Decay curve for that specific event
 */

let singleChart = null;

function fmtSec(sec) {
  const sign = sec < 0 ? "\u2212" : "+";
  const abs = Math.abs(sec);
  if (abs < 60) return `${sign}${abs}s`;
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return s ? `${sign}${m}m ${s}s` : `${sign}${m}m`;
}

/**
 * @param {AnalysisResult} result — full analysis result with perEvent[]
 */
export function renderEventList(result) {
  const list = document.getElementById("eventList");
  list.innerHTML = "";

  if (!result || result.perEvent.length === 0) {
    list.innerHTML = '<div style="padding:8px;color:#666;font-size:11px;">No events to display.</div>';
    return;
  }

  const events = [...result.perEvent].sort(
    (a, b) => new Date(b.dateUTC) - new Date(a.dateUTC)
  );

  events.forEach((ev, idx) => {
    const row = document.createElement("div");
    row.className = "single-event-row";
    row.dataset.index = idx;

    const dateStr = new Date(ev.dateUTC).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
    });
    const timeStr = new Date(ev.dateUTC).toLocaleTimeString("en-GB", {
      hour: "2-digit", minute: "2-digit",
    });

    const netBp = ev.windows.main.metrics.netBp;
    const absBp = ev.windows.main.metrics.totalAbsBp;

    const label = document.createElement("span");
    label.className = "event-label";
    label.textContent = `${dateStr} ${timeStr} `;

    const badge = document.createElement("span");
    badge.className = `badge ${Math.abs(ev.surprise) < 1.5 ? "badge-clean" : "badge-noisy"}`;
    badge.textContent = `${ev.surprise > 0 ? "+" : ""}${ev.surprise}\u03c3`;
    label.appendChild(badge);

    const meta = document.createElement("span");
    meta.className = "event-meta";
    meta.textContent = `${netBp > 0 ? "+" : ""}${netBp.toFixed(1)} bp `;

    const absSpan = document.createElement("span");
    absSpan.style.cssText = "color:#999;margin-left:4px;";
    absSpan.textContent = `(|${absBp.toFixed(1)}|)`;
    meta.appendChild(absSpan);

    row.appendChild(label);
    row.appendChild(meta);

    row.addEventListener("click", () => selectEvent(events, idx, result));
    list.appendChild(row);
  });
}

function selectEvent(events, idx, result) {
  document.querySelectorAll(".single-event-row").forEach((r) => r.classList.remove("active"));
  document.querySelector(`.single-event-row[data-index="${idx}"]`)?.classList.add("active");

  // Switch to detail tab
  const detailBtn = document.querySelector('[data-tab="tabEventDetail"]');
  if (detailBtn) detailBtn.click();

  const ev = events[idx];
  renderSingleEventChart(ev, result);
  renderSingleEventTable(ev);

  const dateStr = new Date(ev.dateUTC).toLocaleString("en-GB");
  document.getElementById("singleEventSummary").textContent =
    `${ev.eventType} \u2014 ${dateStr} \u2014 surprise ${ev.surprise}\u03c3 \u2014 ` +
    `window ${fmtSec(ev.windows.main.startSec)} \u2192 ${fmtSec(ev.windows.main.endSec)}`;
}

function renderSingleEventChart(ev, result) {
  const container = document.getElementById("singleEventChart");

  // Build price path in (minutes, mid) format
  const data = ev.ticks.map((t) => [
    (t.ts - ev.eventTs) / 60000, // minutes from event
    t.mid,
  ]);

  // Plot bands for the three windows
  const plotBands = [
    {
      from: ev.windows.pre.startSec / 60,
      to: ev.windows.pre.endSec / 60,
      color: "rgba(200,200,200,0.08)",
      label: { text: "Pre", style: { fontSize: "9px", color: "#999" } },
    },
    {
      from: ev.windows.main.startSec / 60,
      to: ev.windows.main.endSec / 60,
      color: "rgba(219,0,17,0.08)",
      label: { text: "Main", style: { fontSize: "9px", color: "#db0011" } },
    },
    {
      from: ev.windows.post.startSec / 60,
      to: ev.windows.post.endSec / 60,
      color: "rgba(200,200,200,0.05)",
      label: { text: "Post", style: { fontSize: "9px", color: "#999" } },
    },
  ];

  if (singleChart) {
    singleChart.destroy();
    singleChart = null;
  }

  singleChart = Highcharts.chart(container, {
    chart: { type: "line", height: 260, zoomType: "x" },
    title: { text: null },
    xAxis: {
      title: { text: "Minutes from event", style: { fontSize: "11px" } },
      plotBands,
      plotLines: [{
        value: 0,
        color: "#db0011",
        width: 1.5,
        dashStyle: "Dash",
        label: {
          text: "Event",
          style: { fontSize: "9px", color: "#db0011", fontWeight: "600" },
        },
      }],
    },
    yAxis: {
      title: { text: "Mid price", style: { fontSize: "11px" } },
    },
    series: [{
      name: "Mid",
      data,
      color: "#111111",
      lineWidth: 1,
      marker: { enabled: false },
      states: { hover: { lineWidth: 1.5 } },
    }],
    tooltip: {
      formatter() {
        const min = this.x.toFixed(1);
        return `<b>${min}m from event</b><br>Mid: ${this.y}`;
      },
    },
    legend: { enabled: false },
    credits: { enabled: false },
    exporting: { enabled: false },
  });
}

function renderSingleEventTable(ev) {
  const table = document.getElementById("singleEventTable");
  table.style.display = "";
  const tbody = table.querySelector("tbody");
  tbody.innerHTML = "";

  const rows = [
    { label: "Pre",  w: ev.windows.pre },
    { label: "Main", w: ev.windows.main },
    { label: "Post", w: ev.windows.post },
  ];

  rows.forEach(({ label, w }) => {
    const m = w.metrics;
    const tr = document.createElement("tr");
    const cells = [
      `${label} (${fmtSec(w.startSec)} \u2192 ${fmtSec(w.endSec)})`,
      `${m.netBp > 0 ? "+" : ""}${m.netBp.toFixed(1)}`,
      m.totalAbsBp.toFixed(1),
      m.maxAbsBp.toFixed(1),
      "\u2013",
      "\u2013",
    ];
    cells.forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // Add decay row if available
  if (ev.decay && ev.decay.halfLifeSec > 0) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.style.cssText = "font-style:italic;color:#666;";
    td.textContent =
      `Decay half-life: ${fmtSec(ev.decay.halfLifeSec)} \u00b7 ` +
      `Peak: ${ev.decay.peakBp.toFixed(1)} bp \u00b7 ` +
      `Residual: ${ev.decay.residualBp.toFixed(1)} bp`;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}
