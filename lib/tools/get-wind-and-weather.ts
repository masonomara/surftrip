import { tool } from "ai";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────────

type WindWeatherResult =
  | {
      hourly_units: Record<string, string>;
      hourly: Record<string, (number | null)[]> & { time: string[] };
      daily_units: Record<string, string>;
      daily: Record<string, (string | number | null)[]> & { time: string[] };
      timezone: string;
    }
  | { error: string };

// ── Tool ───────────────────────────────────────────────────────────────────

export const get_wind_and_weather = tool({
  description:
    "Fetch a 7-day hourly wind and weather forecast for a surf spot. " +
    "Returns wind speed and direction, gusts, air temperature, UV index, " +
    "precipitation probability, cloud cover, and daily sunrise/sunset times. " +
    "Requires latitude and longitude from get_coordinates.",
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
  }): Promise<WindWeatherResult> => {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude",      String(latitude));
    url.searchParams.set("longitude",     String(longitude));
    url.searchParams.set("forecast_days", String(forecast_days));
    url.searchParams.set("timezone",      timezone);
    url.searchParams.set("wind_speed_unit", "mph");
    url.searchParams.set(
      "hourly",
      [
        "windspeed_10m",
        "winddirection_10m",
        "windgusts_10m",
        "temperature_2m",
        "uv_index",
        "precipitation_probability",
        "cloudcover",
      ].join(","),
    );
    url.searchParams.set(
      "daily",
      ["sunrise", "sunset", "uv_index_max"].join(","),
    );

    const res = await fetch(url);

    if (!res.ok) {
      return { error: `Weather API request failed: ${res.status}` };
    }

    return res.json() as Promise<WindWeatherResult>;
  },
});
