# API Layer

## Context

This is Phase Two of Surftrip. The full project context, architecture decision, and scaffolding plan are in `docs/01-init/01-goal.md`.

Phase One built the chat shell: Next.js App Router, Supabase auth and message history, Vercel AI SDK streaming, process log. Phase Two replaces the static system prompt with a real tool-calling agent. The AI now calls structured APIs to fetch surf, weather, tide, buoy, and travel data — then reasons over the results to produce actionable surf intelligence.

All tools are implemented as OpenAI function calls via the Vercel AI SDK `streamText` `tools` parameter. Each tool call is surfaced in the process log as a `type: "process"` data event before and after execution.

---

## What I'm Building

An AI agent (built on OpenAI) that acts as a surf forecast and travel research assistant. Given a surf spot, a date, and a user's home location, it fetches raw ocean and weather data from free APIs, derives actionable surf intelligence, and combines it with travel logistics — all without paying for a single external API.

---

## The Tool Stack

### Tool 01 — `get_swell_forecast`

**Source:** `open-meteo.com/en/docs/marine-weather-api`
**Cost:** Free, no key, no sign-up
**Licence:** Non-commercial free tier. Commercial use requires $29/mo plan.

Returns hourly forecast data for any coordinate:

- Swell height (primary, secondary, tertiary) in m or ft
- Swell period (seconds between crests — the most important number)
- Swell direction (degrees true — where it's coming from)
- Wind wave height, period, direction (local chop, separate from swell)
- Sea surface temperature (°C — drives wetsuit decision)
- Ocean current velocity and direction

**Example call:**

```http
GET marine-api.open-meteo.com/v1/marine
  ?latitude=-8.72
  &longitude=115.17
  &hourly=wave_height,wave_period,wave_direction,
          swell_wave_height,swell_wave_period,swell_wave_direction,
          secondary_swell_wave_height,wind_wave_height,
          sea_surface_temperature
  &forecast_days=7
```

16-day forecast range. 8km resolution (MeteoFrance model). Hourly data.

---

### Tool 02 — `get_wind_and_weather`

**Source:** `open-meteo.com/en/docs`
**Cost:** Free, no key, no sign-up

Returns hourly atmospheric forecast:

- Wind speed and direction at 10m (derives onshore/offshore from break orientation)
- Wind gusts (max per hour)
- Air temperature (what to wear outside the water)
- UV index (sun protection required)
- Sunrise and sunset times (daily — defines the surfable window)
- Precipitation probability and cloud cover (storm risk, visibility)

**Example call:**

```http
GET api.open-meteo.com/v1/forecast
  ?latitude=-8.72
  &longitude=115.17
  &hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,
          temperature_2m,uv_index,precipitation,cloud_cover
  &daily=sunrise,sunset
  &forecast_days=7
```

---

### Tool 03 — `get_tide_schedule`

**Sources:**

- Global: `tidecheck.com/developers` — 50 requests/day free, no credit card, 176 countries
- US only: `api.tidesandcurrents.noaa.gov` — unlimited, no key, US stations only

Returns:

- High and low tide times (exact timestamps + heights in m or ft)
- Tidal range (macro vs micro tidal environment)
- Spring/neap indicator (big vs small tidal range period)
- Moon phase

**Strategy:**

```http
// Step 1 — find nearest tide station to coordinates
GET tidecheck.com/api/stations/nearest?lat=-8.72&lng=115.17
  Header: X-API-Key: {your_free_key}

// Step 2 — fetch tide schedule
GET tidecheck.com/api/station/{station_id}/tides?days=3&datum=LAT
```

TideCheck launched March 2026 — new service but data sourced from NOAA CO-OPS, TICON-4 (SHOM), and FES2022 global ocean tide model (AVISO+/CNES). Use NOAA CO-OPS directly for any US surf spot (unlimited, no key, highly accurate).

---

### Tool 04 — `get_buoy_observations`

**Source:** `ndbc.noaa.gov/data/realtime2/{station}.txt`
**Cost:** Free, no key. Mostly US and Pacific coverage.

Real buoy observations — not a forecast. The ground truth of what's actually in the water right now. Use this to verify that a forecast swell is actually arriving before committing to a session or trip.

Returns:

- Actual significant wave height (measured, not modelled)
- Dominant wave period (peak energy right now)
- Swell direction (where it's arriving from)
- Sea surface temperature (measured)

**How to use:**

```text
// 1. Store the nearest NDBC buoy ID for each known surf spot
//    e.g. 46221 = Santa Monica Bay, 51201 = Waimea Bay, HI

// 2. Fetch flat text file
GET ndbc.noaa.gov/data/realtime2/46221.txt

// 3. Parse whitespace-delimited columns: WVHT, DPD, MWD, WTMP
//    Last 45 days of hourly observations available
```

Note: Text file format, not JSON — needs parsing. Worth building a small parser for known spots.

---

### Tool 05 — `get_destination_info`

**Source:** `restcountries.com/v3.1/name/{country}`
**Cost:** Free, no key, no sign-up

Returns destination metadata relevant to a surf trip:

- Languages spoken (official and regional, with native names)
- Currency (code, name, symbol)
- Timezone (UTC offset — for session timing and scheduling)
- Capital and region
- International calling code (for emergencies)
- Neighbouring countries (for multi-destination trip planning)

**Example call:**

```http
GET restcountries.com/v3.1/name/indonesia
  ?fields=name,languages,currencies,timezones,capital,borders,idd
```

---

### Tool 06 — `get_exchange_rate`

**Sources:**

- `api.frankfurter.dev/v2/rates` — ECB-sourced, no key, no limits, self-hostable
- `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json` — 200+ currencies, no key, no rate limits

Returns:

- Live exchange rates for any currency pair (daily updates)
- Historical rates back to 1999 (useful for budget planning)

**Example calls:**

```http
// Frankfurter — clean, reliable, major currencies
GET api.frankfurter.dev/v2/rates?base=USD&quotes=IDR,AUD,EUR

// fawazahmed0 — 200+ currencies including minor ones, CDN-hosted
GET cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json
```

---

### Tool 07 — `get_coordinates`

**Source:** `nominatim.openstreetmap.org`
**Cost:** Free, no key. Rate limit: 1 request/second.

Converts a place name (e.g. "Uluwatu, Bali") into latitude/longitude coordinates, which are then passed to all other tools.

Returns:

- Latitude and longitude (WGS84)
- Country and region from OpenStreetMap data
- Full structured address

**Example call:**

```http
GET nominatim.openstreetmap.org/search
  ?q=Uluwatu+Bali
  &format=json
  &limit=1
  Header: User-Agent: {your-app-name}
```

**Important:** OSM policy requires a `User-Agent` header. Rate limit is 1 req/sec. Cache every result — coordinates for a surf spot never change.

---

### Tool 08 — `web_search`

**Source:** OpenAI `web_search_preview` hosted tool (Responses API)
**Cost:** Billed per call through existing OpenAI account — no separate API key or service

Used for everything no structured API covers cleanly:

- **Flight prices and routes** — search Google Flights or Skyscanner (no free flight API is worth using; all have severe caps or real costs)
- **Accommodation costs** — Hostelworld, Booking.com, surf camp websites
- **Local food and daily costs** — Numbeo, Nomad List, budget travel blogs
- **Spot-specific local knowledge** — Surfline spot guides, Surf-Forecast.com reviews, local surf club reports
- **Visa requirements** — government websites, IATA Travel Centre
- **Board bag airline fees** — airline surf policy pages
- **Webcam links** — live cam feeds to visually confirm conditions

This is the honest answer for travel cost data. Flight price APIs either cost real money or give you 100 requests per month — not enough for a useful tool. Web search pointed at the right sources is more useful and requires no additional account or key beyond the existing OpenAI setup.

---

## Derived Outputs — What the AI Computes

These require no additional API calls. The AI reasons over data already fetched.

### Onshore / Offshore / Cross-Shore Classification

- Input: `wind_direction_10m` (tool 02) + break facing direction (user input or stored)
- Method: Calculate angular difference between wind direction and break orientation
  - 0–45° into wave face = offshore (good)
  - 135–180° behind wave = onshore (bad)
  - 45–135° = cross-shore (context-dependent)

### Best Session Window

- Input: tools 01 + 02 + 03 + sunrise/sunset from tool 02
- Method: Find hours where all of these are true simultaneously:
  - Wind is offshore or light cross-shore
  - Tide is within the spot's known optimal range
  - Swell period meets minimum threshold
  - It is daylight
- Output: Time range (e.g. "06:30–09:00")

### Wetsuit Recommendation

- Input: `sea_surface_temperature` from tool 01
- Rule table:
  - \> 24°C → boardshorts
  - 20–24°C → springsuit / shorty
  - 17–20°C → 3/2mm full suit
  - 13–17°C → 4/3mm full suit
  - < 13°C → 5/4mm + boots + hood

### Daily Budget Estimate

- Input: tools 05 + 06 + web_search for local cost benchmarks
- Method: Get local currency from tool 05, live rate from tool 06, apply web-sourced cost data (hostel, meals, transport). Convert to user's home currency.

### Board Recommendation

- Input: swell data from tool 01 + AI surf knowledge (no extra API call)
- Face height ≈ swell height × 1.3–1.5 (as a rough proxy)
- Higher period + hollow bottom = step-up or gun
- Lower period + mushy = fish or mid-length
- Intermediate or beginner = longer, more volume regardless of conditions

---

## Free API Licence Summary

| API | Truly Free? | Key Required? | Restriction |
| --- | --- | --- | --- |
| Open-Meteo Marine | Yes | No | Non-commercial only |
| Open-Meteo Weather | Yes | No | Non-commercial only |
| NOAA CO-OPS (tides) | Yes | No | US stations only |
| TideCheck | 50 req/day | Yes (free) | Global |
| NOAA NDBC (buoys) | Yes | No | Text format, mostly US |
| REST Countries | Yes | No | None |
| Frankfurter (FX) | Yes | No | Major currencies only |
| fawazahmed0 (FX) | Yes | No | None |
| Nominatim (OSM) | Yes | No | 1 req/sec, User-Agent required |
| OpenAI web_search | Per call (OpenAI billing) | No (uses existing key) | None |

---

## What's Not Covered by Free APIs

- **Real-time flight prices** — no free tier worth using. Use web_search → Google Flights.
- **Accommodation availability/pricing** — same. Use web_search → Booking.com / Hostelworld.
- **Surfline spot ratings and cams** — proprietary, paywalled. Use web_search for spot guide text.
- **MagicSeaweed** — acquired by Surfline, API shut down 2023. Do not reference.

---

## Trusted Reference Sites for Web Search to Target

| Site | Best For |
| --- | --- |
| surfline.com | Spot guides, expert forecasts, webcams |
| surf-forecast.com | 7,000+ global spots, community reviews |
| windguru.cz | Wind forecasts, offshore window planning |
| windy.com | Visual swell and wind maps, storm tracking |
| stormsurf.com | Raw buoy data, swell train analysis |
| swellnet.com | Australia, Indonesia, Pacific — expert commentary |
| ndbc.noaa.gov | Real-time buoy observations (also via API) |
| earth.nullschool.net | Global wind/wave/current visualisation |
| numbeo.com | Local cost of living data |
| nomadlist.com | Digital nomad cost benchmarks by city |
