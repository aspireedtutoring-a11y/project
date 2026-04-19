"""
Bloomberg DAPI Bridge Server.

Thin HTTP server that sits between the browser app and Bloomberg's
Desktop API (DAPI). Runs on the same machine as the Terminal.

Endpoints:
    GET /api/events?type=NFP&pair=EURUSD
        → historical event metadata (dates, actual, forecast, surprise)

    GET /api/ticks?event_id=NFP-EURUSD-0&pair=EURUSD&date=2024-01-05T13:30:00Z
        → 5-second mid ticks spanning ±45 min around the event

    GET /api/health
        → connection status

Requires:
    pip install blpapi

The blpapi Python package needs the Bloomberg C++ SDK (BLPAPI_ROOT),
which is pre-installed on Terminal machines under C:\\blp\\DAPI.
"""

import os
import json
import logging
from datetime import datetime, timedelta, timezone
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

# ---------------------------------------------------------------------------
# Bloomberg connection
# ---------------------------------------------------------------------------

try:
    import blpapi
    HAS_BLPAPI = True
except ImportError:
    HAS_BLPAPI = False
    logging.warning(
        "blpapi not installed — running in DEMO mode. "
        "Install with: pip install blpapi  (requires BLPAPI C++ SDK)"
    )

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

DAPI_HOST = "127.0.0.1"
DAPI_PORT = 8194
ALLOWED_ORIGIN = "http://localhost:3000"

TICK_WINDOW_MINUTES = 45  # ±45 min around event

# Bloomberg ECO tickers for each event type
ECO_TICKERS = {
    "NFP":   "NFP TCH Index",
    "CPI_H": "CPI YOY Index",
    "CPI_C": "CPI XYOY Index",
    "FOMC":  "FDTR Index",
    "ECB":   "EURR002W Index",    # ECB main refi rate
    "BOJ":   "BOJDTR Index",      # BoJ overnight rate
}

# FX spot tickers
FX_TICKERS = {
    "EURUSD": "EURUSD Curncy",
    "USDJPY": "USDJPY Curncy",
}

ECO_FIELDS = [
    "ECO_RELEASE_DT",
    "ACTUAL_RELEASE",
    "BN_SURVEY_MEDIAN",
    "BN_SURVEY_HIGH",
    "BN_SURVEY_LOW",
    "PX_LAST",
]

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bbg-bridge")


# ---------------------------------------------------------------------------
# Bloomberg session management
# ---------------------------------------------------------------------------

class BloombergSession:
    """Manages a single DAPI session."""

    def __init__(self):
        self._session = None

    def connect(self):
        if not HAS_BLPAPI:
            raise RuntimeError("blpapi not available")

        opts = blpapi.SessionOptions()
        opts.setServerHost(DAPI_HOST)
        opts.setServerPort(DAPI_PORT)
        # DAPI on Terminal: no auth needed
        self._session = blpapi.Session(opts)

        if not self._session.start():
            raise RuntimeError("Failed to start Bloomberg session — is the Terminal logged in?")
        if not self._session.openService("//blp/refdata"):
            raise RuntimeError("Failed to open //blp/refdata service")

        log.info("Bloomberg DAPI session connected on %s:%s", DAPI_HOST, DAPI_PORT)

    @property
    def session(self):
        if self._session is None:
            self.connect()
        return self._session

    def get_refdata_service(self):
        return self.session.getService("//blp/refdata")

    # ------------------------------------------------------------------
    # ECO event history — HistoricalDataRequest
    # ------------------------------------------------------------------

    def fetch_events(self, event_type, lookback_days=140):
        """Fetch historical economic releases for the given event type.

        Bloomberg limits intraday tick data to 140 calendar days,
        so we only pull events within that window.

        Returns list of dicts:
            { date_utc, actual, forecast, surprise, surprise_std }
        """
        ticker = ECO_TICKERS.get(event_type)
        if not ticker:
            raise ValueError(f"Unknown event type: {event_type}")

        svc = self.get_refdata_service()
        req = svc.createRequest("HistoricalDataRequest")

        req.getElement("securities").appendValue(ticker)
        for f in ECO_FIELDS:
            req.getElement("fields").appendValue(f)

        end_dt = datetime.now(timezone.utc)
        start_dt = end_dt - timedelta(days=lookback_days)
        req.set("startDate", start_dt.strftime("%Y%m%d"))
        req.set("endDate", end_dt.strftime("%Y%m%d"))
        req.set("periodicitySelection", "DAILY")

        self.session.sendRequest(req)

        events = []
        while True:
            ev = self.session.nextEvent(5000)
            for msg in ev:
                if msg.hasElement("securityData"):
                    sec_data = msg.getElement("securityData")
                    if sec_data.hasElement("fieldData"):
                        field_data = sec_data.getElement("fieldData")
                        for i in range(field_data.numValues()):
                            row = field_data.getValueAsElement(i)
                            events.append(self._parse_eco_row(row))
            if ev.eventType() == blpapi.Event.RESPONSE:
                break

        # Filter to rows that actually have a release date
        return [e for e in events if e.get("date_utc")]

    def _parse_eco_row(self, row):
        result = {}
        if row.hasElement("ECO_RELEASE_DT"):
            dt = row.getElementAsDatetime("ECO_RELEASE_DT")
            result["date_utc"] = dt.isoformat() if hasattr(dt, "isoformat") else str(dt)

        result["actual"] = (
            row.getElementAsFloat("ACTUAL_RELEASE")
            if row.hasElement("ACTUAL_RELEASE") and not row.getElement("ACTUAL_RELEASE").isNull()
            else None
        )
        result["forecast"] = (
            row.getElementAsFloat("BN_SURVEY_MEDIAN")
            if row.hasElement("BN_SURVEY_MEDIAN") and not row.getElement("BN_SURVEY_MEDIAN").isNull()
            else None
        )

        if result["actual"] is not None and result["forecast"] is not None:
            result["surprise"] = round(result["actual"] - result["forecast"], 4)
            # Rough standardisation using survey range as proxy for σ
            high = (
                row.getElementAsFloat("BN_SURVEY_HIGH")
                if row.hasElement("BN_SURVEY_HIGH") and not row.getElement("BN_SURVEY_HIGH").isNull()
                else None
            )
            low = (
                row.getElementAsFloat("BN_SURVEY_LOW")
                if row.hasElement("BN_SURVEY_LOW") and not row.getElement("BN_SURVEY_LOW").isNull()
                else None
            )
            if high is not None and low is not None and (high - low) > 0:
                # Survey range ≈ 4σ (approximate)
                sigma = (high - low) / 4
                result["surprise_std"] = round(result["surprise"] / sigma, 2)
            else:
                result["surprise_std"] = 0.0
        else:
            result["surprise"] = None
            result["surprise_std"] = 0.0

        return result

    # ------------------------------------------------------------------
    # Intraday tick data — IntradayTickRequest (BID + ASK → mid)
    # ------------------------------------------------------------------

    def fetch_ticks(self, ccy_pair, event_datetime_utc, window_minutes=TICK_WINDOW_MINUTES):
        """Fetch BID and ASK ticks, compute mid, bucket to 5-second bars.

        Bloomberg IntradayTickRequest returns raw ticks. For FX spot,
        we request BID and ASK (not TRADE — OTC market has no trades).
        We then align bid/ask by timestamp and compute mid.

        Returns list of dicts:
            { ts (epoch ms), mid (float) }
        """
        ticker = FX_TICKERS.get(ccy_pair)
        if not ticker:
            raise ValueError(f"Unknown pair: {ccy_pair}")

        event_dt = datetime.fromisoformat(event_datetime_utc.replace("Z", "+00:00"))
        start_dt = event_dt - timedelta(minutes=window_minutes)
        end_dt = event_dt + timedelta(minutes=window_minutes)

        # Fetch BID ticks
        bid_ticks = self._fetch_tick_type(ticker, start_dt, end_dt, "BID")
        # Fetch ASK ticks
        ask_ticks = self._fetch_tick_type(ticker, start_dt, end_dt, "ASK")

        # Merge into 5-second mid bars
        return self._merge_to_mid_bars(bid_ticks, ask_ticks, start_dt, end_dt)

    def _fetch_tick_type(self, ticker, start_dt, end_dt, event_type):
        """Raw IntradayTickRequest for one event type."""
        svc = self.get_refdata_service()
        req = svc.createRequest("IntradayTickRequest")

        req.set("security", ticker)
        req.getElement("eventTypes").appendValue(event_type)
        req.set("startDateTime", start_dt)
        req.set("endDateTime", end_dt)

        self.session.sendRequest(req)

        ticks = []
        while True:
            ev = self.session.nextEvent(5000)
            for msg in ev:
                if msg.hasElement("tickData"):
                    tick_data_top = msg.getElement("tickData")
                    if tick_data_top.hasElement("tickData"):
                        tick_array = tick_data_top.getElement("tickData")
                        for i in range(tick_array.numValues()):
                            tick = tick_array.getValueAsElement(i)
                            ts = tick.getElementAsDatetime("time")
                            val = tick.getElementAsFloat("value")
                            # Convert to epoch ms
                            if hasattr(ts, "timestamp"):
                                epoch_ms = int(ts.timestamp() * 1000)
                            else:
                                epoch_ms = int(
                                    datetime.fromisoformat(str(ts)).timestamp() * 1000
                                )
                            ticks.append({"ts": epoch_ms, "value": val})
            if ev.eventType() == blpapi.Event.RESPONSE:
                break

        return ticks

    def _merge_to_mid_bars(self, bid_ticks, ask_ticks, start_dt, end_dt):
        """Bucket raw bid/ask ticks into 5-second mid bars.

        For each 5-second bucket:
            1. Take the last bid and last ask in that bucket
            2. Mid = (bid + ask) / 2
            3. If only one side is available, use that side
            4. Forward-fill from previous bucket if a bucket is empty
        """
        bucket_ms = 5000  # 5 seconds
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int(end_dt.timestamp() * 1000)

        # Index ticks by bucket
        def bucket_key(ts):
            return ((ts - start_ms) // bucket_ms) * bucket_ms + start_ms

        bid_buckets = {}
        for t in bid_ticks:
            k = bucket_key(t["ts"])
            bid_buckets[k] = t["value"]  # last value wins

        ask_buckets = {}
        for t in ask_ticks:
            k = bucket_key(t["ts"])
            ask_buckets[k] = t["value"]

        # Build output with forward-fill
        bars = []
        last_bid = None
        last_ask = None

        ts = start_ms
        while ts <= end_ms:
            bid = bid_buckets.get(ts, last_bid)
            ask = ask_buckets.get(ts, last_ask)

            if bid is not None:
                last_bid = bid
            if ask is not None:
                last_ask = ask

            if last_bid is not None and last_ask is not None:
                mid = (last_bid + last_ask) / 2
            elif last_bid is not None:
                mid = last_bid
            elif last_ask is not None:
                mid = last_ask
            else:
                ts += bucket_ms
                continue

            bars.append({
                "ts": ts,
                "mid": round(mid, 5 if mid < 10 else 3),
            })

            ts += bucket_ms

        return bars


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

bbg = BloombergSession()


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------

class BridgeHandler(BaseHTTPRequestHandler):
    """Minimal HTTP handler — no framework dependency for Terminal machines."""

    def _send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", len(body))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, msg, status=500):
        self._send_json({"error": msg}, status)

    def do_OPTIONS(self):
        """CORS preflight."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", ALLOWED_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        params = parse_qs(parsed.query)

        def param(name, default=None):
            return params.get(name, [default])[0]

        try:
            if path == "/api/health":
                self._handle_health()
            elif path == "/api/events":
                self._handle_events(param("type"), param("pair"))
            elif path == "/api/ticks":
                self._handle_ticks(param("pair"), param("date"))
            else:
                self._send_error("Not found", 404)
        except ValueError as e:
            log.warning("Bad request: %s", e)
            self._send_error("Invalid request parameters.", 400)
        except Exception as e:
            log.exception("Request failed: %s", e)
            self._send_error("Internal server error. Check bridge server logs.")

    def _handle_health(self):
        status = "connected" if HAS_BLPAPI else "demo_mode"
        self._send_json({"status": status, "blpapi_available": HAS_BLPAPI})

    def _handle_events(self, event_type, ccy_pair):
        if not event_type:
            return self._send_error("Missing 'type' parameter", 400)

        if not HAS_BLPAPI:
            return self._send_json({
                "events": [],
                "demo_mode": True,
                "message": "blpapi not available — use sample data in browser",
            })

        events = bbg.fetch_events(event_type)

        # Attach IDs for the frontend
        result = []
        for i, ev in enumerate(events):
            ev["id"] = f"{event_type}-{ccy_pair or 'ALL'}-{i}"
            ev["event_type"] = event_type
            ev["ccy_pair"] = ccy_pair
            result.append(ev)

        self._send_json({"events": result})

    def _handle_ticks(self, ccy_pair, event_date):
        if not ccy_pair or not event_date:
            return self._send_error("Missing 'pair' or 'date' parameter", 400)

        if not HAS_BLPAPI:
            return self._send_json({
                "ticks": [],
                "demo_mode": True,
                "message": "blpapi not available — use sample data in browser",
            })

        ticks = bbg.fetch_ticks(ccy_pair, event_date)
        self._send_json({"ticks": ticks})

    def log_message(self, format, *args):
        log.info(format, *args)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    port = int(os.environ.get("BBG_BRIDGE_PORT", "8085"))
    server = HTTPServer(("127.0.0.1", port), BridgeHandler)
    log.info("Bloomberg bridge server listening on http://127.0.0.1:%d", port)
    log.info("DAPI target: %s:%s", DAPI_HOST, DAPI_PORT)
    log.info("blpapi available: %s", HAS_BLPAPI)

    if not HAS_BLPAPI:
        log.warning("Running in DEMO mode — install blpapi for live data")
    else:
        try:
            bbg.connect()
        except Exception as e:
            log.error("Failed to connect to Bloomberg: %s", e)
            log.warning("Server will start but Bloomberg requests will fail")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log.info("Shutting down")
        server.server_close()


if __name__ == "__main__":
    main()
