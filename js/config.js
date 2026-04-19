/**
 * Application constants and default configuration.
 */
export const EVENT_TYPES = {
  NFP:   { label: "NFP headline (US)",  releaseOffset: 0 },
  CPI_H: { label: "CPI headline (US)",  releaseOffset: 0 },
  CPI_C: { label: "CPI core (US)",      releaseOffset: 0 },
  FOMC:  { label: "FOMC decision",      releaseOffset: 0 },
  ECB:   { label: "ECB decision",       releaseOffset: 0 },
  BOJ:   { label: "BoJ decision",       releaseOffset: 0 },
};

export const CCY_PAIRS = ["EURUSD", "USDJPY"];

export const VOL_REGIMES = ["ALL", "LOW", "NORMAL", "HIGH"];

export const MODES = {
  HISTORICAL: "historical",
  UPCOMING:   "upcoming",
};

/** Default window sizes (minutes relative to event time). */
export const DEFAULT_WINDOWS = {
  preMins:   30,   // minutes before event
  mainMins:  15,   // main impact window length
  postMins:  60,   // post / decay observation period
};
