/**
 * Sliding-window optimizer.
 *
 * Scans a grid of (offset, length) pairs and scores each by
 * the median cumulative absolute bp move across a set of historical events.
 *
 * The "best" window is the (offset, length) that maximises this score —
 * i.e. the time region where spot physically moves the most.
 *
 * Grid resolution:
 *   - Offset:  -600s to +600s  (−10 min to +10 min) in 30s steps → 41 values
 *   - Length:  60s to 1800s     (1 min to 30 min) in 60s steps   → 30 values
 *   → 1,230 cells, each scored across all events — fast enough in JS.
 */

import { windowMetrics } from "./returns.js";

// ── Grid parameters ────────────────────────────────────────────────────

const OFFSET_MIN  = -600;   // seconds
const OFFSET_MAX  =  600;
const OFFSET_STEP =   30;

const LENGTH_MIN  =   60;
const LENGTH_MAX  = 1800;
const LENGTH_STEP =   60;

export function getOffsets() {
  const arr = [];
  for (let o = OFFSET_MIN; o <= OFFSET_MAX; o += OFFSET_STEP) arr.push(o);
  return arr;
}

export function getLengths() {
  const arr = [];
  for (let l = LENGTH_MIN; l <= LENGTH_MAX; l += LENGTH_STEP) arr.push(l);
  return arr;
}

// ── Helpers ────────────────────────────────────────────────────────────

function median(arr) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// ── Core optimiser ─────────────────────────────────────────────────────

/**
 * @param {Array<Array<ReturnTick>>} allReturns — one returns array per event
 * @returns {{
 *   grid: Array<{ offset, length, medianAbsBp, p25, p75 }>,
 *   best: { offset, length, medianAbsBp },
 *   offsets: number[],
 *   lengths: number[],
 * }}
 */
export function optimiseWindow(allReturns) {
  const offsets = getOffsets();
  const lengths = getLengths();
  const grid = [];

  let bestScore = -1;
  let best = null;

  for (const offset of offsets) {
    for (const length of lengths) {
      const startSec = offset;
      const endSec = offset + length;

      const scores = allReturns.map((returns) => {
        const m = windowMetrics(returns, startSec, endSec);
        return m.totalAbsBp;
      });

      const med = median(scores);
      const entry = {
        offset,
        length,
        medianAbsBp: parseFloat(med.toFixed(2)),
        p25: parseFloat(percentile(scores, 25).toFixed(2)),
        p75: parseFloat(percentile(scores, 75).toFixed(2)),
      };
      grid.push(entry);

      if (med > bestScore) {
        bestScore = med;
        best = entry;
      }
    }
  }

  return { grid, best, offsets, lengths };
}

/**
 * Given the optimal main window, derive pre and post windows.
 *
 * Pre-window:  from −45 min (or data start) to optimal offset.
 * Post-window: from end of main window to +45 min (or data end).
 */
export function deriveWindows(best) {
  const pre = {
    startSec: -45 * 60,
    endSec: best.offset,
    label: "Pre",
  };
  const main = {
    startSec: best.offset,
    endSec: best.offset + best.length,
    label: "Main",
  };
  const post = {
    startSec: best.offset + best.length,
    endSec: 45 * 60,
    label: "Post",
  };
  return { pre, main, post };
}
