/**
 * App bootstrap — wires controls → data provider → analytics engine → UI.
 *
 * On startup, tries to connect to the Bloomberg bridge server.
 * If unavailable, falls back to sample data.
 */

import { initControls }              from "./controls.js";
import { updateStats }                from "./stats.js";
import { renderHeatmap }              from "./charts/heatmap.js";
import { renderDistribution }         from "./charts/distribution.js";
import { renderDecay }                from "./charts/decay.js";
import { renderEventList }            from "./eventList.js";
import { runAnalysis }                from "./analytics/engine.js";
import { setProvider, BloombergProvider } from "./data/provider.js";
import SampleProvider                 from "./data/sampleData.js";

// ── Data source state ──────────────────────────────────────────────────
let activeProvider = null;
let dataSource = "sample"; // "bloomberg" | "sample"

async function initProvider() {
  // Try Bloomberg bridge first
  try {
    const bbg = new BloombergProvider();
    const health = await bbg.connect();
    if (health.blpapi_available) {
      activeProvider = bbg;
      dataSource = "bloomberg";
      setProvider(bbg);
      log("Connected to Bloomberg DAPI via bridge server.");
      return;
    }
  } catch (e) {
    // Bridge not running — expected during development
  }

  // Fall back to sample data
  activeProvider = SampleProvider;
  dataSource = "sample";
  setProvider(SampleProvider);
  log("Using sample data. Start server/bloomberg_bridge.py for live data.");
}

function log(msg) {
  const note = document.getElementById("regimeNote");
  if (note) note.textContent = msg;
  console.log(`[FX-Impact] ${msg}`);
}

// ── Tab switching ──────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const parent = btn.closest(".panel") || btn.parentElement.parentElement;
    parent.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    parent.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab)?.classList.add("active");
  });
});

// ── Main refresh pipeline ──────────────────────────────────────────────
let _lastResult = null;

async function refresh(detail) {
  const { eventType, ccyPair, volRegime, mode } = detail;

  try {
    // Fetch events with tick data
    const events = await activeProvider.getEventsWithTicks(eventType, ccyPair);

    // Run the full analytics pipeline
    const result = runAnalysis(events, volRegime);
    _lastResult = result;

    // Update all UI panels
    updateStats(result);
    renderHeatmap(result);
    renderDistribution(result);
    renderDecay(result);
    renderEventList(result);

    const src = dataSource === "bloomberg" ? "Bloomberg DAPI" : "sample data";
    log(`${result.eventCount} events loaded from ${src}. Best window: offset ${result.bestOffset}s, length ${result.bestLength}s.`);
  } catch (err) {
    console.error("Refresh failed:", err);
    log(`Error: ${err.message}`);
  }

  // Mark page ready
  const marker = document.getElementById("ready-marker");
  if (marker) {
    marker.dataset.status = "ready";
    marker.textContent = "ready";
  }
}

// ── Listen for control changes ─────────────────────────────────────────
document.addEventListener("controls:change", (e) => refresh(e.detail));

// ── Init ───────────────────────────────────────────────────────────────
initProvider().then(() => initControls());
