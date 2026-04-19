/**
 * Data provider abstraction.
 *
 * All data access goes through a provider. The active provider is set at
 * boot — either the built-in SampleProvider or the BloombergProvider
 * that talks to the Python bridge server.
 *
 * Provider interface:
 *   getEvents(eventType, ccyPair)       → Promise<EventMeta[]>
 *   getTicks(ccyPair, eventDateUTC)     → Promise<Tick[]>
 *   getEventsWithTicks(eventType, pair) → Promise<EventWithTicks[]>
 *
 * EventMeta: { id, eventType, ccyPair, dateUTC, actual, forecast, surprise }
 * Tick:      { ts (epoch ms), mid (number) }
 */

let _provider = null;

export function setProvider(provider) {
  _provider = provider;
}

export function getProvider() {
  if (!_provider) throw new Error("No data provider registered. Call setProvider() first.");
  return _provider;
}

// ---------------------------------------------------------------------------
// Bloomberg provider — HTTP client to server/bloomberg_bridge.py
// ---------------------------------------------------------------------------

export class BloombergProvider {
  /**
   * @param {Object} config
   * @param {string} config.baseUrl — bridge server URL (default http://127.0.0.1:8085)
   */
  constructor(config = {}) {
    this.baseUrl = (config.baseUrl || "http://127.0.0.1:8085").replace(/\/$/, "");
    this.connected = false;
  }

  async connect() {
    const resp = await fetch(`${this.baseUrl}/api/health`);
    const data = await resp.json();
    if (data.status === "connected") {
      this.connected = true;
    } else if (data.status === "demo_mode") {
      console.warn("Bloomberg bridge running in demo mode — blpapi not installed on server");
      this.connected = false;
    } else {
      throw new Error(`Unexpected health status: ${data.status}`);
    }
    return data;
  }

  /**
   * Fetch event metadata from Bloomberg ECO calendar via the bridge.
   */
  async getEvents(eventType, ccyPair) {
    const url = `${this.baseUrl}/api/events?type=${eventType}&pair=${ccyPair}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Bridge error: ${resp.status} ${resp.statusText}`);
    const data = await resp.json();

    if (data.demo_mode) {
      console.warn("Bridge in demo mode — no Bloomberg data available");
      return [];
    }

    return (data.events || []).map((ev) => ({
      id: ev.id,
      eventType: ev.event_type || eventType,
      ccyPair: ev.ccy_pair || ccyPair,
      dateUTC: ev.date_utc,
      actual: ev.actual,
      forecast: ev.forecast,
      surprise: ev.surprise_std || 0,
    }));
  }

  /**
   * Fetch 5-second mid ticks (BID+ASK→mid) around an event time.
   */
  async getTicks(ccyPair, eventDateUTC) {
    const url = `${this.baseUrl}/api/ticks?pair=${ccyPair}&date=${encodeURIComponent(eventDateUTC)}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Bridge error: ${resp.status} ${resp.statusText}`);
    const data = await resp.json();

    if (data.demo_mode) return [];
    return data.ticks || [];
  }

  /**
   * Convenience: fetch events then attach ticks to each.
   * Calls getTicks for each event in parallel.
   */
  async getEventsWithTicks(eventType, ccyPair) {
    const events = await this.getEvents(eventType, ccyPair);
    if (!events.length) return [];

    const withTicks = await Promise.all(
      events.map(async (ev) => {
        const ticks = await this.getTicks(ccyPair, ev.dateUTC);
        return { ...ev, ticks };
      })
    );

    // Filter out events where ticks are empty (outside 140-day window)
    return withTicks.filter((ev) => ev.ticks.length > 0);
  }
}
