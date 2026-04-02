import { tool } from "ai";
import { z } from "zod";

// ── Types ──────────────────────────────────────────────────────────────────

type ExchangeRateResult =
  | { rate: number; from: string; to: string; date: string; source: string }
  | { error: string };

// Frankfurter returns { rates: { "IDR": 16000 }, date: "2024-01-01" }
type FrankfurterResponse = {
  rates?: Record<string, number>;
  date?: string;
};

// fawazahmed0 returns { date: "2024-01-01", "usd": { "idr": 16000 } }
// Keys are lowercase currency codes.
type FawazResponse = {
  date?: string;
  [key: string]: Record<string, number> | string | undefined;
};

// ── Tool ───────────────────────────────────────────────────────────────────

export const get_exchange_rate = tool({
  description:
    "Get the current exchange rate between two currencies. " +
    "Use the currency code from get_destination_info as the 'to' currency. " +
    "Primary source is Frankfurter (ECB-backed). " +
    "Falls back to fawazahmed0 CDN for currencies not covered by Frankfurter.",
  inputSchema: z.object({
    from: z.string().length(3).describe("Source currency code, e.g. 'USD'"),
    to:   z.string().length(3).describe("Target currency code, e.g. 'IDR'"),
  }),
  execute: async ({ from, to }): Promise<ExchangeRateResult> => {
    const fromUpper = from.toUpperCase();
    const toUpper   = to.toUpperCase();

    // Primary: Frankfurter (ECB-sourced, covers ~30 major currencies).
    try {
      const res = await fetch(
        `https://api.frankfurter.app/latest?from=${fromUpper}&to=${toUpper}`,
      );
      if (res.ok) {
        const data = (await res.json()) as FrankfurterResponse;
        const rate = data.rates?.[toUpper];
        if (rate != null) {
          return {
            rate,
            from:   fromUpper,
            to:     toUpper,
            date:   data.date ?? "",
            source: "frankfurter",
          };
        }
      }
    } catch {
      // fall through to backup
    }

    // Fallback: fawazahmed0 CDN (150+ currencies, keys are lowercase).
    try {
      const res = await fetch(
        `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${fromUpper.toLowerCase()}.min.json`,
      );
      if (res.ok) {
        const data = (await res.json()) as FawazResponse;
        const ratesMap = data[fromUpper.toLowerCase()];
        if (ratesMap && typeof ratesMap === "object") {
          const rate = ratesMap[toUpper.toLowerCase()];
          if (rate != null) {
            return {
              rate,
              from:   fromUpper,
              to:     toUpper,
              date:   data.date ?? "",
              source: "fawazahmed0",
            };
          }
        }
      }
    } catch {
      // fall through to error
    }

    return {
      error: `Could not fetch exchange rate for ${fromUpper}/${toUpper}`,
    };
  },
});
