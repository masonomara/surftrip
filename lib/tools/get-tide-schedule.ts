import { tool } from "ai";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────────

// "H" = high tide, "L" = low tide.
type TidePrediction = { t: string; v: string; type: "H" | "L" };

type TideScheduleResult =
  | { stationId: string; stationName: string; predictions: TidePrediction[] }
  | { error: string };

type StationListResponse = {
  stationList?: Array<{
    stationId: string;
    etidesStnName: string;
    distance: number;
  }>;
};

type PredictionsResponse = {
  predictions?: TidePrediction[];
  error?: { message: string };
};

// ── Tool ───────────────────────────────────────────────────────────────────

export const get_tide_schedule = tool({
  description:
    "Fetch the tide schedule (high and low tides) for a surf spot using NOAA CO-OPS data. " +
    "Only works for US locations and US territories. " +
    "For international spots, return an error so the AI can note the gap.",
  inputSchema: z.object({
    latitude:   z.number().describe("Latitude of the surf spot"),
    longitude:  z.number().describe("Longitude of the surf spot"),
    begin_date: z.string().describe("Start date in YYYY-MM-DD format"),
    end_date:   z.string().describe("End date in YYYY-MM-DD format"),
  }),
  execute: async ({
    latitude,
    longitude,
    begin_date,
    end_date,
  }): Promise<TideScheduleResult> => {
    // Step 1 — find the nearest NOAA tide prediction station.
    const stationUrl = new URL(
      "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/tidepredstations.json",
    );
    stationUrl.searchParams.set("lat",    String(latitude));
    stationUrl.searchParams.set("lon",    String(longitude));
    stationUrl.searchParams.set("radius", "50");

    const stationRes = await fetch(stationUrl.toString());

    if (!stationRes.ok) {
      return { error: "Could not reach NOAA tide station API" };
    }

    const stationData = (await stationRes.json()) as StationListResponse;

    if (!stationData.stationList?.length) {
      return {
        error:
          "No NOAA tide station within 50km. This location may be outside US coverage — tide data is not available.",
      };
    }

    const station = stationData.stationList[0];

    // Step 2 — fetch tide predictions. NOAA requires YYYYMMDD (no dashes).
    const beginDateFormatted = begin_date.replace(/-/g, "");
    const endDateFormatted   = end_date.replace(/-/g, "");

    const predUrl = new URL(
      "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter",
    );
    predUrl.searchParams.set("station",     station.stationId);
    predUrl.searchParams.set("product",     "predictions");
    predUrl.searchParams.set("begin_date",  beginDateFormatted);
    predUrl.searchParams.set("end_date",    endDateFormatted);
    predUrl.searchParams.set("datum",       "MLLW");
    predUrl.searchParams.set("time_zone",   "lst_ldt");
    predUrl.searchParams.set("interval",    "hilo");
    predUrl.searchParams.set("units",       "english");
    predUrl.searchParams.set("application", "surftrip");
    predUrl.searchParams.set("format",      "json");

    const predRes = await fetch(predUrl.toString());

    if (!predRes.ok) {
      return { error: `NOAA predictions request failed: ${predRes.status}` };
    }

    const predData = (await predRes.json()) as PredictionsResponse;

    if (predData.error) {
      return { error: `NOAA error: ${predData.error.message}` };
    }

    if (!predData.predictions?.length) {
      return { error: "No tide predictions returned for this date range" };
    }

    return {
      stationId:   station.stationId,
      stationName: station.etidesStnName,
      predictions: predData.predictions,
    };
  },
});
