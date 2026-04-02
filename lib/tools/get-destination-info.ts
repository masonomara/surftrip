import { tool } from "ai";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────────

type DestinationResult =
  | {
      name: string;
      currencyCode: string;
      currencyName: string;
      currencySymbol: string;
      languages: string[];
      timezone: string;
      capital: string;
      region: string;
    }
  | { error: string };

type RestCountriesResponse = Array<{
  name?: { common?: string };
  currencies?: Record<string, { name?: string; symbol?: string }>;
  languages?: Record<string, string>;
  timezones?: string[];
  capital?: string[];
  region?: string;
}>;

// ── Tool ───────────────────────────────────────────────────────────────────

export const get_destination_info = tool({
  description:
    "Fetch destination metadata for a country: currency, languages, timezone, and capital. " +
    "Use this for international surf destinations to get the local currency code for exchange rate lookups " +
    "and the timezone for session timing. Skip for domestic US trips.",
  inputSchema: z.object({
    country: z
      .string()
      .describe("Country name, e.g. 'Indonesia', 'Mexico', 'Portugal'"),
  }),
  execute: async ({ country }): Promise<DestinationResult> => {
    const url = new URL(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(country)}`,
    );
    url.searchParams.set(
      "fields",
      "name,currencies,languages,timezones,capital,region",
    );

    const res = await fetch(url);

    if (!res.ok) {
      return { error: `Country not found: ${country}` };
    }

    const data = (await res.json()) as RestCountriesResponse;

    if (!data.length) {
      return { error: `No results for country: ${country}` };
    }

    const countryData = data[0];
    const currencyEntries = Object.entries(countryData.currencies ?? {});
    const [currencyCode, currencyInfo] = currencyEntries[0] ?? ["", {}];

    return {
      name:           countryData.name?.common ?? country,
      currencyCode,
      currencyName:   currencyInfo?.name ?? "",
      currencySymbol: currencyInfo?.symbol ?? "",
      languages:      Object.values(countryData.languages ?? {}),
      timezone:       countryData.timezones?.[0] ?? "",
      capital:        countryData.capital?.[0] ?? "",
      region:         countryData.region ?? "",
    };
  },
});
