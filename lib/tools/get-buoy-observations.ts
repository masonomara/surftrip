import { tool } from "ai";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────────

type BuoyObservation = {
  stationId: string;
  timestamp: string;
  windDirection: number | null;
  windSpeed: number | null;
  windGust: number | null;
  waveHeight: number | null;
  dominantPeriod: number | null;
  averagePeriod: number | null;
  meanWaveDirection: number | null;
  pressure: number | null;
  airTemp: number | null;
  waterTemp: number | null;
};

type BuoyResult = BuoyObservation | { error: string };

// ── Helpers ────────────────────────────────────────────────────────────────

// NDBC uses "MM" to signal a missing or unavailable measurement.
function parseCol(value: string): number | null {
  return value === "MM" ? null : parseFloat(value);
}

// ── Tool ───────────────────────────────────────────────────────────────────

export const get_buoy_observations = tool({
  description:
    "Fetch the most recent real buoy observation from a NOAA NDBC station. " +
    "This is ground truth for what is actually in the water right now, as opposed to forecast data. " +
    "You must supply a known NDBC station ID — common ones include 46026 (San Francisco), " +
    "46025 (Santa Monica), 51001 (Hawaii NW), 41047 (NE US). " +
    "If no buoy is known for the area, do not call this tool.",
  inputSchema: z.object({
    station_id: z
      .string()
      .describe(
        "NDBC buoy station ID, e.g. '46026' for San Francisco or '51001' for Hawaii NW",
      ),
  }),
  execute: async ({ station_id }): Promise<BuoyResult> => {
    const res = await fetch(
      `https://www.ndbc.noaa.gov/data/realtime2/${station_id}.txt`,
    );

    if (!res.ok) {
      return { error: `Buoy station ${station_id} not found or unavailable` };
    }

    const text = await res.text();

    // NDBC text format: lines starting with "#" are header/comment rows.
    const lines = text
      .trim()
      .split("\n")
      .filter((line) => !line.startsWith("#"));

    if (!lines.length) {
      return { error: `No data available for buoy ${station_id}` };
    }

    // Columns: YY MM DD hh mm WDIR WSPD GST WVHT DPD APD MWD PRES ATMP WTMP ...
    const cols = lines[0].trim().split(/\s+/);

    if (cols.length < 15) {
      return { error: `Unexpected data format from buoy ${station_id}` };
    }

    const [yr, mo, dy, hr, mn, wdir, wspd, gst, wvht, dpd, apd, mwd, pres, atmp, wtmp] = cols;

    return {
      stationId: station_id,
      timestamp: `${yr}-${mo}-${dy}T${hr}:${mn}:00Z`,
      windDirection:     parseCol(wdir),
      windSpeed:         parseCol(wspd),
      windGust:          parseCol(gst),
      waveHeight:        parseCol(wvht),
      dominantPeriod:    parseCol(dpd),
      averagePeriod:     parseCol(apd),
      meanWaveDirection: parseCol(mwd),
      pressure:          parseCol(pres),
      airTemp:           parseCol(atmp),
      waterTemp:         parseCol(wtmp),
    };
  },
});
