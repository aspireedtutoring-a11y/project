/**
 * Post-window decay fitting.
 *
 * After the main impact window, spot typically reverts partially.
 * We fit an exponential decay: |displacement|(t) = A × exp(−λt) + C
 *
 *   A = initial displacement at end of main window
 *   λ = decay rate  →  half-life = ln(2) / λ
 *   C = residual (permanent) shift
 *
 * The fit is done via simple least-squares on log-transformed data.
 */

/**
 * @param {Array<ReturnTick>} returns — full returns array for one event
 * @param {{ startSec: number, endSec: number }} mainWindow
 * @param {{ startSec: number, endSec: number }} postWindow
 * @returns {{ halfLifeSec: number, residualBp: number, peakBp: number, curve: Array<{sec: number, bp: number}> }}
 */
export function fitDecay(returns, mainWindow, postWindow) {
  if (!returns.length) {
    return { halfLifeSec: 0, residualBp: 0, peakBp: 0, curve: [] };
  }

  // Find displacement at end of main window (reference point)
  const mainEnd = returns.filter((r) => r.offsetSec <= mainWindow.endSec);
  const mainStart = returns.filter((r) => r.offsetSec <= mainWindow.startSec);

  const cumAtMainEnd = mainEnd.length ? mainEnd[mainEnd.length - 1].cumBp : 0;
  const cumAtMainStart = mainStart.length ? mainStart[mainStart.length - 1].cumBp : 0;
  const peakBp = cumAtMainEnd - cumAtMainStart;

  // Sample post-window displacements at 30-second intervals
  const postReturns = returns.filter(
    (r) => r.offsetSec >= postWindow.startSec && r.offsetSec <= postWindow.endSec
  );

  if (postReturns.length < 3 || Math.abs(peakBp) < 0.5) {
    return { halfLifeSec: 0, residualBp: 0, peakBp, curve: [] };
  }

  // Build (t, displacement) series relative to end of main window
  const points = [];
  const step = 30; // sample every 30s
  for (let s = postWindow.startSec; s <= postWindow.endSec; s += step) {
    const tick = returns.find((r) => r.offsetSec >= s);
    if (tick) {
      const displacement = Math.abs(tick.cumBp - cumAtMainStart);
      points.push({ t: s - postWindow.startSec, disp: displacement });
    }
  }

  if (points.length < 3) {
    return { halfLifeSec: 0, residualBp: 0, peakBp, curve: points.map((p) => ({ sec: p.t + postWindow.startSec, bp: p.disp })) };
  }

  // Estimate residual as the last few points' average
  const lastN = points.slice(-5);
  const residual = lastN.reduce((s, p) => s + p.disp, 0) / lastN.length;

  // Fit ln(disp - residual) = ln(A) - λt via linear regression
  const adjusted = points
    .map((p) => ({ t: p.t, y: p.disp - residual * 0.9 })) // slight buffer to keep positive
    .filter((p) => p.y > 0.1);

  if (adjusted.length < 3) {
    return {
      halfLifeSec: 0,
      residualBp: parseFloat(residual.toFixed(2)),
      peakBp: parseFloat(peakBp.toFixed(2)),
      curve: points.map((p) => ({ sec: p.t + postWindow.startSec, bp: p.disp })),
    };
  }

  const logY = adjusted.map((p) => Math.log(p.y));
  const tVals = adjusted.map((p) => p.t);

  // Simple linear regression on (t, logY)
  const n = tVals.length;
  const sumT = tVals.reduce((a, b) => a + b, 0);
  const sumLogY = logY.reduce((a, b) => a + b, 0);
  const sumTLogY = tVals.reduce((a, t, i) => a + t * logY[i], 0);
  const sumT2 = tVals.reduce((a, t) => a + t * t, 0);

  const denom = n * sumT2 - sumT * sumT;
  const lambda = denom !== 0 ? -(n * sumTLogY - sumT * sumLogY) / denom : 0;

  const halfLifeSec = lambda > 0 ? Math.LN2 / lambda : 0;

  // Build fitted curve for charting
  const curve = [];
  const A = Math.abs(peakBp);
  for (let t = 0; t <= postWindow.endSec - postWindow.startSec; t += step) {
    const fitted = lambda > 0
      ? A * Math.exp(-lambda * t) + residual
      : A + residual;
    curve.push({
      sec: t + postWindow.startSec,
      bp: parseFloat(fitted.toFixed(2)),
    });
  }

  return {
    halfLifeSec: parseFloat(halfLifeSec.toFixed(0)),
    residualBp: parseFloat(residual.toFixed(2)),
    peakBp: parseFloat(peakBp.toFixed(2)),
    curve,
  };
}

/**
 * Aggregate decay stats across multiple events.
 */
export function aggregateDecay(decayResults) {
  const valid = decayResults.filter((d) => d.halfLifeSec > 0);
  if (!valid.length) return { medianHalfLifeSec: 0, medianResidualBp: 0 };

  const halves = valid.map((d) => d.halfLifeSec).sort((a, b) => a - b);
  const residuals = valid.map((d) => d.residualBp).sort((a, b) => a - b);

  const mid = Math.floor(halves.length / 2);
  return {
    medianHalfLifeSec: halves.length % 2 ? halves[mid] : (halves[mid - 1] + halves[mid]) / 2,
    medianResidualBp: residuals.length % 2 ? residuals[mid] : (residuals[mid - 1] + residuals[mid]) / 2,
  };
}
