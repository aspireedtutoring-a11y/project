/**
 * Key-stats panel — displays calibrated window parameters
 * from the analytics engine.
 */

function fmtSec(sec) {
  const sign = sec < 0 ? "−" : "+";
  const abs = Math.abs(sec);
  if (abs < 60) return `${sign}${abs}s`;
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  return s ? `${sign}${m}m ${s}s` : `${sign}${m}m`;
}

/**
 * @param {AnalysisResult} result — from engine.runAnalysis()
 */
export function updateStats(result) {
  const mainWindow  = document.getElementById("statMainWindow");
  const medianImpact = document.getElementById("statMedianImpact");
  const prePost     = document.getElementById("statPrePost");
  const halfLife    = document.getElementById("statHalfLife");
  const subtitle    = document.getElementById("statsSubtitle");
  const mainFoot    = document.getElementById("statMainWindowFoot");
  const regimeNote  = document.getElementById("regimeNote");

  if (!result || result.eventCount === 0) {
    mainWindow.textContent  = "\u2013";
    medianImpact.textContent = "\u2013";
    prePost.textContent     = "\u2013";
    halfLife.textContent    = "\u2013";
    subtitle.textContent    = "No events match the current filters.";
    return;
  }

  // Main window: offset → offset + length
  mainWindow.textContent =
    `${fmtSec(result.bestOffset)} \u2192 ${fmtSec(result.bestOffset + result.bestLength)}`;
  mainFoot.textContent =
    `Offset ${fmtSec(result.bestOffset)}, length ${fmtSec(result.bestLength)}. ` +
    `${result.eventCount} events (of ${result.totalEventCount}).`;

  // Median absolute bp move in the main window
  medianImpact.textContent = `${result.medianMainAbsBp.toFixed(1)} bp`;

  // Pre vs post
  prePost.textContent =
    `${result.medianPreAbsBp.toFixed(1)} / ${result.medianPostAbsBp.toFixed(1)} bp`;

  // Decay half-life
  halfLife.textContent = result.decayHalfLifeSec > 0
    ? fmtSec(result.decayHalfLifeSec)
    : "\u2013";

  subtitle.textContent =
    `Calibrated from ${result.eventCount} historical events. Best window maximises cumulative |spot move|.`;

  regimeNote.textContent =
    `Grid: offsets ${fmtSec(result.heatmapOffsets[0])} to ${fmtSec(result.heatmapOffsets[result.heatmapOffsets.length - 1])}, ` +
    `lengths 1m\u201330m. Sample data \u2014 wire Bloomberg for live calibration.`;
}
