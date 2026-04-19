/**
 * Analytics engine — orchestrates the full pipeline.
 *
 * Input:  event type + ccy pair + optional vol regime filter
 * Output: calibrated windows, heatmap grid, per-event metrics, decay stats
 *
 * Pipeline:
 *   1. Fetch events + ticks from provider
 *   2. Compute 5s spot returns per event
 *   3. (Optional) filter by vol regime
 *   4. Run sliding-window optimiser across all events → best (offset, length)
 *   5. Derive pre / main / post windows
 *   6. Compute per-event window metrics
 *   7. Fit post-window decay per event → aggregate half-life
 */

import { computeReturns, windowMetrics } from "./returns.js";
import { optimiseWindow, deriveWindows } from "./windowOptimizer.js";
import { fitDecay, aggregateDecay } from "./decayFit.js";

/**
 * @param {Array<EventWithTicks>} events — from provider.getEventsWithTicks()
 * @param {string} volRegime — "ALL" | "LOW" | "NORMAL" | "HIGH"
 * @returns {AnalysisResult}
 */
export function runAnalysis(events, volRegime = "ALL") {
  if (!events || events.length === 0) {
    return emptyResult();
  }

  // ── 1. Compute returns per event ────────────────────────────────────
  const enriched = events.map((ev) => {
    const eventTs = new Date(ev.dateUTC).getTime();
    const returns = computeReturns(ev.ticks, eventTs);
    return { ...ev, returns, eventTs };
  });

  // ── 2. Classify vol regime per event (if not already set) ───────────
  enriched.forEach((ev) => {
    if (!ev.volRegime) {
      // Simple classification: total absolute move in [-45m, +45m]
      const total = ev.returns.reduce((s, r) => s + Math.abs(r.bpReturn), 0);
      const median = 30; // approximate calibration placeholder
      if (total < median * 0.6) ev.volRegime = "LOW";
      else if (total > median * 1.4) ev.volRegime = "HIGH";
      else ev.volRegime = "NORMAL";
    }
  });

  // ── 3. Filter by vol regime ─────────────────────────────────────────
  const filtered = volRegime === "ALL"
    ? enriched
    : enriched.filter((ev) => ev.volRegime === volRegime);

  if (filtered.length === 0) return emptyResult();

  // ── 4. Window optimisation ──────────────────────────────────────────
  const allReturns = filtered.map((ev) => ev.returns);
  const optimResult = optimiseWindow(allReturns);
  const windows = deriveWindows(optimResult.best);

  // ── 5. Per-event metrics for each window ────────────────────────────
  const perEvent = filtered.map((ev) => {
    const preMetrics  = windowMetrics(ev.returns, windows.pre.startSec,  windows.pre.endSec);
    const mainMetrics = windowMetrics(ev.returns, windows.main.startSec, windows.main.endSec);
    const postMetrics = windowMetrics(ev.returns, windows.post.startSec, windows.post.endSec);

    const decay = fitDecay(ev.returns, windows.main, windows.post);

    return {
      id: ev.id,
      eventType: ev.eventType,
      ccyPair: ev.ccyPair,
      dateUTC: ev.dateUTC,
      surprise: ev.surprise,
      volRegime: ev.volRegime,
      returns: ev.returns,
      ticks: ev.ticks,
      eventTs: ev.eventTs,
      windows: {
        pre:  { ...windows.pre,  metrics: preMetrics },
        main: { ...windows.main, metrics: mainMetrics },
        post: { ...windows.post, metrics: postMetrics },
      },
      decay,
    };
  });

  // ── 6. Aggregate stats ──────────────────────────────────────────────
  const mainAbsBps = perEvent.map((e) => e.windows.main.metrics.totalAbsBp);
  const preAbsBps  = perEvent.map((e) => e.windows.pre.metrics.totalAbsBp);
  const postAbsBps = perEvent.map((e) => e.windows.post.metrics.totalAbsBp);

  const decayAgg = aggregateDecay(perEvent.map((e) => e.decay));

  const sortedMain = [...mainAbsBps].sort((a, b) => a - b);
  const mid = Math.floor(sortedMain.length / 2);
  const medianMainAbsBp = sortedMain.length % 2
    ? sortedMain[mid]
    : (sortedMain[mid - 1] + sortedMain[mid]) / 2;

  const sortedPre = [...preAbsBps].sort((a, b) => a - b);
  const medianPreAbsBp = sortedPre.length % 2
    ? sortedPre[Math.floor(sortedPre.length / 2)]
    : (sortedPre[Math.floor(sortedPre.length / 2) - 1] + sortedPre[Math.floor(sortedPre.length / 2)]) / 2;

  const sortedPost = [...postAbsBps].sort((a, b) => a - b);
  const medianPostAbsBp = sortedPost.length % 2
    ? sortedPost[Math.floor(sortedPost.length / 2)]
    : (sortedPost[Math.floor(sortedPost.length / 2) - 1] + sortedPost[Math.floor(sortedPost.length / 2)]) / 2;

  return {
    eventCount: filtered.length,
    totalEventCount: events.length,

    // Calibrated window parameters
    bestOffset: optimResult.best.offset,
    bestLength: optimResult.best.length,
    windows,

    // Aggregate metrics
    medianMainAbsBp: parseFloat(medianMainAbsBp.toFixed(2)),
    medianPreAbsBp: parseFloat(medianPreAbsBp.toFixed(2)),
    medianPostAbsBp: parseFloat(medianPostAbsBp.toFixed(2)),
    decayHalfLifeSec: decayAgg.medianHalfLifeSec,
    decayResidualBp: decayAgg.medianResidualBp,

    // Full grid for heatmap
    heatmapGrid: optimResult.grid,
    heatmapOffsets: optimResult.offsets,
    heatmapLengths: optimResult.lengths,

    // Per-event results for drill-down
    perEvent,
  };
}

function emptyResult() {
  return {
    eventCount: 0,
    totalEventCount: 0,
    bestOffset: 0,
    bestLength: 0,
    windows: null,
    medianMainAbsBp: 0,
    medianPreAbsBp: 0,
    medianPostAbsBp: 0,
    decayHalfLifeSec: 0,
    decayResidualBp: 0,
    heatmapGrid: [],
    heatmapOffsets: [],
    heatmapLengths: [],
    perEvent: [],
  };
}
