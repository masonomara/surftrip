import { openai } from "@ai-sdk/openai";
import { get_coordinates }      from "./get-coordinates";
import { get_swell_forecast }   from "./get-swell-forecast";
import { get_wind_and_weather } from "./get-wind-and-weather";
import { get_tide_schedule }    from "./get-tide-schedule";
import { get_buoy_observations } from "./get-buoy-observations";
import { get_destination_info } from "./get-destination-info";
import { get_exchange_rate }    from "./get-exchange-rate";

// ── OpenAI hosted tools ────────────────────────────────────────────────────
//
// web_search_preview is provided by OpenAI, not implemented here. It requires
// openai.responses() as the model (not openai()). It has no execute function;
// OpenAI handles the search server-side and returns results in the stream.

const web_search_preview = openai.tools.webSearchPreview({
  searchContextSize: "medium",
});

// ── Tool registry ──────────────────────────────────────────────────────────

export const tools = {
  get_coordinates,
  get_swell_forecast,
  get_wind_and_weather,
  get_tide_schedule,
  get_buoy_observations,
  get_destination_info,
  get_exchange_rate,
  web_search_preview,
};
