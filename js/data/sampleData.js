/**
 * Sample data provider — generates realistic synthetic tick data
 * that mirrors what Bloomberg IntradayBarRequest would return.
 *
 * Tick-level dynamics are modelled to capture:
 *   - Quiet pre-event drift
 *   - Possible early leak / positioning (small)
 *   - Sharp move at/near event time (with configurable offset for delayed reactions)
 *   - Overshoot + partial reversion (decay)
 *   - Realistic noise scaling per pair
 *
 * All ticks are 5-second intervals spanning [-45 min, +45 min] from event.
 */

// ── Helpers ────────────────────────────────────────────────────────────

function normalRandom() {
  // Box-Muller
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ── Pair profiles ──────────────────────────────────────────────────────

const PAIR_PROFILES = {
  EURUSD: {
    baseMid: 1.0845,
    pipSize: 0.0001,     // 1 pip = 0.0001
    quietNoiseBp: 0.3,   // typical 5s noise in quiet period (bp)
    eventNoiseBp: 1.2,   // 5s noise during event window
    typicalMoveBp: { NFP: 35, CPI_H: 25, CPI_C: 20, FOMC: 30, ECB: 25, BOJ: 8 },
  },
  USDJPY: {
    baseMid: 149.50,
    pipSize: 0.01,       // 1 pip = 0.01
    quietNoiseBp: 0.4,
    eventNoiseBp: 1.8,
    typicalMoveBp: { NFP: 45, CPI_H: 30, CPI_C: 25, FOMC: 40, ECB: 12, BOJ: 55 },
  },
};

// ── Event templates ────────────────────────────────────────────────────
// Each event type has a characteristic reaction shape.

const EVENT_TEMPLATES = {
  NFP: {
    label: "NFP headline (US)",
    typicalOffsetSec: 2,      // nearly instant
    mainDurationSec: 300,     // 5 min hard move
    overshootFrac: 0.20,      // 20% overshoot then revert
    decayHalfLifeSec: 600,    // 10 min half-life of reversion
    releaseTimes: [           // first Fri of month, 13:30 UTC
      "2024-01-05T13:30:00Z", "2024-02-02T13:30:00Z", "2024-03-08T13:30:00Z",
      "2024-04-05T13:30:00Z", "2024-05-03T13:30:00Z", "2024-06-07T13:30:00Z",
      "2024-07-05T13:30:00Z", "2024-08-02T13:30:00Z", "2024-09-06T13:30:00Z",
      "2024-10-04T13:30:00Z", "2024-11-01T13:30:00Z", "2024-12-06T13:30:00Z",
    ],
  },
  CPI_H: {
    label: "CPI headline (US)",
    typicalOffsetSec: 1,
    mainDurationSec: 240,
    overshootFrac: 0.15,
    decayHalfLifeSec: 480,
    releaseTimes: [
      "2024-01-11T13:30:00Z", "2024-02-13T13:30:00Z", "2024-03-12T13:30:00Z",
      "2024-04-10T13:30:00Z", "2024-05-15T13:30:00Z", "2024-06-12T13:30:00Z",
      "2024-07-11T13:30:00Z", "2024-08-14T13:30:00Z", "2024-09-11T13:30:00Z",
      "2024-10-10T13:30:00Z", "2024-11-13T13:30:00Z", "2024-12-11T13:30:00Z",
    ],
  },
  CPI_C: {
    label: "CPI core (US)",
    typicalOffsetSec: 1,
    mainDurationSec: 240,
    overshootFrac: 0.12,
    decayHalfLifeSec: 420,
    releaseTimes: [
      "2024-01-11T13:30:00Z", "2024-02-13T13:30:00Z", "2024-03-12T13:30:00Z",
      "2024-04-10T13:30:00Z", "2024-05-15T13:30:00Z", "2024-06-12T13:30:00Z",
      "2024-07-11T13:30:00Z", "2024-08-14T13:30:00Z", "2024-09-11T13:30:00Z",
      "2024-10-10T13:30:00Z", "2024-11-13T13:30:00Z", "2024-12-11T13:30:00Z",
    ],
  },
  FOMC: {
    label: "FOMC decision",
    typicalOffsetSec: 0,
    mainDurationSec: 600,     // 10 min — statement + dot plot digestion
    overshootFrac: 0.25,
    decayHalfLifeSec: 900,
    releaseTimes: [
      "2024-01-31T19:00:00Z", "2024-03-20T18:00:00Z", "2024-05-01T18:00:00Z",
      "2024-06-12T18:00:00Z", "2024-07-31T18:00:00Z", "2024-09-18T18:00:00Z",
      "2024-11-07T19:00:00Z", "2024-12-18T19:00:00Z",
    ],
  },
  ECB: {
    label: "ECB decision",
    typicalOffsetSec: 0,
    mainDurationSec: 480,
    overshootFrac: 0.18,
    decayHalfLifeSec: 720,
    releaseTimes: [
      "2024-01-25T13:15:00Z", "2024-03-07T13:15:00Z", "2024-04-11T13:15:00Z",
      "2024-06-06T13:15:00Z", "2024-07-18T13:15:00Z", "2024-09-12T13:15:00Z",
      "2024-10-17T13:15:00Z", "2024-12-12T13:15:00Z",
    ],
  },
  BOJ: {
    label: "BoJ decision",
    typicalOffsetSec: 5,      // slightly delayed — no fixed release second
    mainDurationSec: 360,
    overshootFrac: 0.30,
    decayHalfLifeSec: 540,
    releaseTimes: [
      "2024-01-23T03:00:00Z", "2024-03-19T03:00:00Z", "2024-04-26T03:00:00Z",
      "2024-06-14T03:00:00Z", "2024-07-31T03:00:00Z", "2024-09-20T03:00:00Z",
      "2024-10-31T03:00:00Z", "2024-12-19T03:00:00Z",
    ],
  },
};

// ── Tick generator ─────────────────────────────────────────────────────

function generateTicks(eventDateUTC, profile, template, surprise) {
  const eventMs = new Date(eventDateUTC).getTime();
  const startSec = -45 * 60;   // -45 min
  const endSec = 45 * 60;      // +45 min
  const stepSec = 5;

  const ticks = [];
  let mid = profile.baseMid + (normalRandom() * 0.002); // slight base variation
  const direction = surprise > 0 ? 1 : -1;
  const totalMoveBp = Math.abs(surprise) * (profile.typicalMoveBp[template.eventType] || 20);
  const totalMove = totalMoveBp * profile.pipSize;  // in price terms

  // Add some per-event offset jitter (±3 seconds)
  const offsetJitter = Math.round(normalRandom() * 1.5) * stepSec;
  const effectiveOffset = template.typicalOffsetSec + offsetJitter;

  for (let s = startSec; s <= endSec; s += stepSec) {
    const phase = getPhase(s, effectiveOffset, template.mainDurationSec);
    let noise;
    let drift = 0;

    if (phase === "pre") {
      noise = normalRandom() * profile.quietNoiseBp * profile.pipSize;
      // Small positioning leak in last 60s before event
      if (s > -60 && s <= 0) {
        drift = direction * totalMove * 0.02 * (stepSec / 60);
      }
    } else if (phase === "main") {
      noise = normalRandom() * profile.eventNoiseBp * profile.pipSize;
      // Main move: logistic-shaped accumulation
      const progress = (s - effectiveOffset) / template.mainDurationSec;
      drift = (direction * totalMove * (1 + template.overshootFrac) / (template.mainDurationSec / stepSec)) *
              logisticDerivative(progress) * 3;
    } else {
      // Post: exponential decay toward partial reversion
      noise = normalRandom() * (profile.quietNoiseBp * 1.5) * profile.pipSize;
      const timeSinceMainEnd = s - effectiveOffset - template.mainDurationSec;
      const decayFactor = Math.exp(-timeSinceMainEnd / template.decayHalfLifeSec * Math.LN2);
      // Drift back toward a partial reversion level
      drift = -direction * totalMove * template.overshootFrac *
              (stepSec / template.decayHalfLifeSec) * decayFactor;
    }

    mid += drift + noise;
    ticks.push({
      ts: eventMs + s * 1000,
      mid: parseFloat(mid.toFixed(profile.pipSize < 0.001 ? 5 : 3)),
    });
  }

  return ticks;
}

function getPhase(sec, offsetSec, mainDuration) {
  if (sec < offsetSec) return "pre";
  if (sec < offsetSec + mainDuration) return "main";
  return "post";
}

function logistic(x) {
  // S-curve 0→1 mapped over [0, 1]
  return 1 / (1 + Math.exp(-10 * (x - 0.5)));
}

function logisticDerivative(x) {
  const l = logistic(x);
  return 10 * l * (1 - l);
}

// ── Build sample event sets ────────────────────────────────────────────

function buildSampleEvents() {
  const events = {};

  for (const [eventType, template] of Object.entries(EVENT_TEMPLATES)) {
    template.eventType = eventType;

    for (const [ccyPair, profile] of Object.entries(PAIR_PROFILES)) {
      const key = `${eventType}:${ccyPair}`;
      events[key] = [];

      template.releaseTimes.forEach((dateUTC, i) => {
        const surprise = parseFloat((normalRandom() * 1.2).toFixed(2));

        events[key].push({
          id: `${eventType}-${ccyPair}-${i}`,
          eventType,
          ccyPair,
          dateUTC,
          actual: null,         // would come from Bloomberg ECO
          forecast: null,
          previous: null,
          surprise,             // standardised surprise (σ units)
          ticks: generateTicks(dateUTC, profile, template, surprise),
        });
      });
    }
  }

  return events;
}

// ── Sample provider (implements provider interface) ─────────────────────

const _cache = buildSampleEvents();

const SampleProvider = {
  async getEvents(eventType, ccyPair) {
    const key = `${eventType}:${ccyPair}`;
    const evts = _cache[key] || [];
    return evts.map(({ ticks, ...meta }) => meta);
  },

  async getTicks(eventId, ccyPair) {
    for (const evts of Object.values(_cache)) {
      const found = evts.find((e) => e.id === eventId);
      if (found) return found.ticks;
    }
    return [];
  },

  // Convenience: get events with ticks already attached (avoids N+1 in sample mode)
  async getEventsWithTicks(eventType, ccyPair) {
    const key = `${eventType}:${ccyPair}`;
    return _cache[key] || [];
  },
};

export default SampleProvider;
export { EVENT_TEMPLATES, PAIR_PROFILES };
