import type { PolymarketMarket } from "../types/index.js";

const POLYMARKET_API = "https://gamma-api.polymarket.com";

/**
 * Fetch active markets from Polymarket's public API.
 */
export async function fetchActiveMarkets(limit = 100): Promise<PolymarketMarket[]> {
  const url = `${POLYMARKET_API}/markets?closed=false&limit=${limit}&order=volume&ascending=false`;
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Polymarket API error: ${resp.status} ${resp.statusText}`);
  }

  const data: any[] = await resp.json();

  return data.map((m) => ({
    conditionId: m.conditionId || m.condition_id || "",
    slug: m.slug || "",
    question: m.question || "",
    outcomes: m.outcomes ? JSON.parse(m.outcomes) : [],
    outcomePrices: m.outcomePrices ? JSON.parse(m.outcomePrices).map(Number) : [],
    volume: Number(m.volume) || 0,
    liquidity: Number(m.liquidity) || 0,
    endDate: m.endDate || m.end_date_iso || "",
    active: m.active !== false,
  }));
}

/**
 * Search markets by keyword. Uses the Polymarket search endpoint.
 */
export async function searchMarkets(query: string, limit = 20): Promise<PolymarketMarket[]> {
  const all = await fetchActiveMarkets(200);
  const lowerQuery = query.toLowerCase();
  return all
    .filter((m) => m.question.toLowerCase().includes(lowerQuery))
    .slice(0, limit);
}
