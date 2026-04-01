import { tool } from "ai";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────────

type CoordinatesResult =
  | { lat: number; lon: number; displayName: string }
  | { error: string };

// ── Tool ───────────────────────────────────────────────────────────────────

export const get_coordinates = tool({
  description:
    "Convert a place name or surf spot (e.g. 'Uluwatu, Bali') into latitude and longitude coordinates. " +
    "Call this first before any other tool that requires coordinates.",
  inputSchema: z.object({
    query: z
      .string()
      .describe(
        "The place name to geocode, e.g. 'Uluwatu, Bali' or 'Mavericks, California'",
      ),
  }),
  execute: async ({ query }): Promise<CoordinatesResult> => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("q", query);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");

    const res = await fetch(url.toString(), {
      headers: { "User-Agent": "Surftrip/1.0 (contact@surftrip.fun)" },
    });

    if (!res.ok) {
      return { error: `Geocoding request failed: ${res.status}` };
    }

    const data = (await res.json()) as Array<{
      lat: string;
      lon: string;
      display_name: string;
    }>;

    if (!data.length) {
      return { error: `Location not found: ${query}` };
    }

    return {
      lat: parseFloat(data[0].lat),
      lon: parseFloat(data[0].lon),
      displayName: data[0].display_name,
    };
  },
});
