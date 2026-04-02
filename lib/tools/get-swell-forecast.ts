import { tool } from "ai";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────────

type SwellForecastResult =
  | {
      hourly_units: Record<string, string>;
      hourly: Record<string, (number | null)[]> & { time: string[] };
      daily_units: Record<string, string>;
      daily: Record<string, (number | null)[]> & { time: string[] };
      timezone: string;
    }
  | { error: string };

// ── Tool ───────────────────────────────────────────────────────────────────

export const get_swell_forecast = tool({
  description:
    "Fetch a 7-day hourly swell forecast for a surf spot. " +
    "Returns wave height, swell height, swell period, swell direction, wind wave height, " +
    "and sea surface temperature. Requires latitude and longitude from get_coordinates.",
  inputSchema: z.object({
    latitude:     z.number().describe("Latitude of the surf spot"),
    longitude:    z.number().describe("Longitude of the surf spot"),
    forecast_days: z
      .number()
      .min(1)
      .max(7)
      .default(5)
      .describe("Number of forecast days (1–7)"),
    timezone: z
      .string()
      .default("auto")
      .describe(
        "Timezone for timestamps, e.g. 'Asia/Makassar'. Use 'auto' to detect from coordinates.",
      ),
  }),
  execute: async ({
    latitude,
    longitude,
    forecast_days,
    timezone,
  }): Promise<SwellForecastResult> => {
    const url = new URL("https://marine-api.open-meteo.com/v1/marine");
    url.searchParams.set("latitude",      String(latitude));
    url.searchParams.set("longitude",     String(longitude));
    url.searchParams.set("forecast_days", String(forecast_days));
    url.searchParams.set("timezone",      timezone);
    url.searchParams.set(
      "hourly",
      [
        "wave_height",
        "wave_period",
        "wave_direction",
        "swell_wave_height",
        "swell_wave_period",
        "swell_wave_direction",
        "swell_wave_peak_period",
        "wind_wave_height",
        "wind_wave_period",
        "sea_surface_temperature",
      ].join(","),
    );
    url.searchParams.set(
      "daily",
      [
        "wave_height_max",
        "swell_wave_height_max",
        "swell_wave_period_max",
        "wave_direction_dominant",
      ].join(","),
    );

    const res = await fetch(url);

    if (!res.ok) {
      return { error: `Marine API request failed: ${res.status}` };
    }

    return res.json() as Promise<SwellForecastResult>;
  },
});
