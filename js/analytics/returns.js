/**
 * Spot return calculations from 5-second tick data.
 *
 * All returns are in basis points (bp) = 10,000 × (P1 - P0) / P0.
 * We use simple returns (not log) because the desk thinks in bp moves.
 */

/**
 * Compute bp returns between consecutive ticks.
 * @param {Array<{ts: number, mid: number}>} ticks
 * @returns {Array<{ts: number, offsetSec: number, bpReturn: number, cumBp: number}>}
 *   offsetSec is relative to the first tick.
 */
export function computeReturns(ticks, eventTs) {
  if (ticks.length < 2) return [];

  const baseTs = eventTs || ticks[0].ts;
  const returns = [];
  let cumBp = 0;

  for (let i = 1; i < ticks.length; i++) {
    const bpReturn = ((ticks[i].mid - ticks[i - 1].mid) / ticks[i - 1].mid) * 10000;
    cumBp += bpReturn;

    returns.push({
      ts: ticks[i].ts,
      offsetSec: (ticks[i].ts - baseTs) / 1000,
      bpReturn: parseFloat(bpReturn.toFixed(4)),
      cumBp: parseFloat(cumBp.toFixed(4)),
    });
  }

  return returns;
}

/**
 * Compute the total absolute spot move (in bp) within a time window.
 * This is the headline metric — how many bp did spot physically travel?
 *
 * @param {Array} returns — output of computeReturns()
 * @param {number} startSec — window start (seconds from event)
 * @param {number} endSec — window end (seconds from event)
 * @returns {{ totalAbsBp: number, netBp: number, maxAbsBp: number, tickCount: number }}
 */
export function windowMetrics(returns, startSec, endSec) {
  const inWindow = returns.filter((r) => r.offsetSec >= startSec && r.offsetSec < endSec);

  if (inWindow.length === 0) {
    return { totalAbsBp: 0, netBp: 0, maxAbsBp: 0, tickCount: 0 };
  }

  let totalAbsBp = 0;
  let maxAbsBp = 0;

  // Net move = cumBp at end of window minus cumBp at start of window
  const netBp = inWindow[inWindow.length - 1].cumBp - (inWindow[0].cumBp - inWindow[0].bpReturn);

  for (const r of inWindow) {
    totalAbsBp += Math.abs(r.bpReturn);
    const absFromStart = Math.abs(r.cumBp - (inWindow[0].cumBp - inWindow[0].bpReturn));
    if (absFromStart > maxAbsBp) maxAbsBp = absFromStart;
  }

  return {
    totalAbsBp: parseFloat(totalAbsBp.toFixed(2)),
    netBp: parseFloat(netBp.toFixed(2)),
    maxAbsBp: parseFloat(maxAbsBp.toFixed(2)),
    tickCount: inWindow.length,
  };
}
