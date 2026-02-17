import type { PolymarketMarket } from "../types/index.js";
import { withRetry } from "../utils/retry.js";

const POLYMARKET_API = "https://gamma-api.polymarket.com";

/**
 * Safely parse a JSON string field that might already be an array/object.
 */
function safeParseJsonField<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value as T; // already parsed
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/**
 * Validate and transform a raw market object from the Polymarket API.
 * Returns null if the market is missing critical fields.
 */
function parseMarket(m: any): PolymarketMarket | null {
  // Must have an identifier and a question
  const conditionId = m.conditionId || m.condition_id;
  const question = m.question;
  if (!conditionId || !question) return null;

  const outcomes = safeParseJsonField<string[]>(m.outcomes, []);
  const outcomePrices = safeParseJsonField<(string | number)[]>(m.outcomePrices, [])
    .map(Number)
    .filter((n) => !isNaN(n));

  return {
    conditionId,
    slug: m.slug || "",
    question,
    outcomes,
    outcomePrices,
    volume: Number(m.volume) || 0,
    liquidity: Number(m.liquidity) || 0,
    endDate: m.endDate || m.end_date_iso || "",
    active: m.active !== false,
  };
}

/**
 * Fetch active markets from Polymarket's public API.
 * Includes retry logic and response validation.
 */
export async function fetchActiveMarkets(limit = 100): Promise<PolymarketMarket[]> {
  const url = `${POLYMARKET_API}/markets?closed=false&limit=${limit}&order=volume&ascending=false`;

  const resp = await withRetry(
    () => fetch(url),
    "Polymarket.fetchActiveMarkets()",
    { maxRetries: 3, baseDelayMs: 2000 }
  );

  if (!resp.ok) {
    throw new Error(`Polymarket API error: ${resp.status} ${resp.statusText}`);
  }

  const raw = await resp.json();

  // The API should return an array
  if (!Array.isArray(raw)) {
    console.error(`[Polymarket] Unexpected response shape — expected array, got ${typeof raw}`);
    return [];
  }

  const markets: PolymarketMarket[] = [];
  for (const item of raw) {
    const market = parseMarket(item);
    if (market) {
      markets.push(market);
    }
  }

  console.log(`[Polymarket] Fetched ${markets.length} valid markets (${raw.length - markets.length} skipped)`);
  return markets;
}

/**
 * Search markets by keyword. Uses client-side filtering on cached data.
 */
export async function searchMarkets(query: string, limit = 20): Promise<PolymarketMarket[]> {
  const all = await fetchActiveMarkets(200);
  const lowerQuery = query.toLowerCase();
  return all
    .filter((m) => m.question.toLowerCase().includes(lowerQuery))
    .slice(0, limit);
}
