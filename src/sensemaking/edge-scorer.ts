import Anthropic from "@anthropic-ai/sdk";
import type {
  TopicCluster,
  PolymarketMarket,
  EdgeOpportunity,
} from "../types/index.js";
import { fetchActiveMarkets } from "./polymarket.js";

const MARKET_MAPPING_PROMPT = `You are a prediction market analyst. Given a topic cluster (a group of signals from Crypto Twitter) and a list of active Polymarket markets, determine:

1. Which markets are relevant to this topic cluster?
2. What direction (YES or NO) does the signal evidence suggest?
3. What is the implied probability based on the signals?

Respond with JSON only (no markdown fencing):
{
  "mappings": [
    {
      "market_index": 0,
      "direction": "YES" | "NO",
      "signal_implied_probability": 0.0-1.0,
      "reasoning": "Brief explanation of why the signals suggest this direction and probability"
    }
  ]
}

Rules:
- Only include markets that are genuinely relevant to the cluster topic
- Be conservative with implied probability — don't overfit to noisy signals
- If the cluster sentiment is "mixed", the implied probability should be near 0.5
- Consider signal quality: corroborated claims > single sources > rumors > vibes
- It's fine to return an empty mappings array if no markets are relevant`;

export class EdgeScorer {
  private anthropic: Anthropic;
  private marketCache: PolymarketMarket[] = [];
  private lastCacheTime = 0;
  private cacheIntervalMs = 15 * 60 * 1000; // 15 minutes

  constructor(anthropicApiKey: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
  }

  /**
   * Get active markets with caching.
   */
  async getMarkets(): Promise<PolymarketMarket[]> {
    const now = Date.now();
    if (now - this.lastCacheTime > this.cacheIntervalMs || this.marketCache.length === 0) {
      this.marketCache = await fetchActiveMarkets(200);
      this.lastCacheTime = now;
    }
    return this.marketCache;
  }

  /**
   * Find edge opportunities by mapping a topic cluster to Polymarket markets.
   */
  async findEdge(
    cluster: TopicCluster,
    clusterWeight: number
  ): Promise<EdgeOpportunity[]> {
    const markets = await this.getMarkets();

    // Summarize markets for the prompt (top 50 by volume to keep prompt manageable)
    const topMarkets = markets.slice(0, 50);
    const marketSummaries = topMarkets.map((m, i) => ({
      index: i,
      question: m.question,
      yes_price: m.outcomePrices[0] || 0.5,
      no_price: m.outcomePrices[1] || 0.5,
      volume: m.volume,
    }));

    const clusterSummary = {
      name: cluster.name,
      signal_count: cluster.signalCount,
      avg_engagement: cluster.avgEngagement,
      sentiment: cluster.sentiment,
      top_claims: cluster.signals.slice(0, 5).map((s) => s.coreClaim),
    };

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `Topic cluster:\n${JSON.stringify(clusterSummary, null, 2)}\n\nActive Polymarket markets:\n${JSON.stringify(marketSummaries, null, 2)}`,
        },
      ],
      system: MARKET_MAPPING_PROMPT,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const parsed = JSON.parse(text);

    const opportunities: EdgeOpportunity[] = [];

    for (const mapping of parsed.mappings || []) {
      const market = topMarkets[mapping.market_index];
      if (!market) continue;

      const currentPrice =
        mapping.direction === "YES"
          ? market.outcomePrices[0] || 0.5
          : market.outcomePrices[1] || 0.5;

      const priceDiscrepancy = Math.abs(
        mapping.signal_implied_probability - currentPrice
      );

      // edge_score = signal_strength * price_discrepancy * time_value
      const signalStrength = Math.min(1.0, clusterWeight / 20); // normalize to 0-1
      const timeValue = cluster.signals.some((s) => s.urgency === "breaking")
        ? 1.0
        : cluster.signals.some((s) => s.urgency === "developing")
          ? 0.7
          : 0.4;

      const edgeScore = signalStrength * priceDiscrepancy * timeValue;

      opportunities.push({
        cluster,
        market,
        direction: mapping.direction,
        signalImpliedProbability: mapping.signal_implied_probability,
        currentMarketPrice: currentPrice,
        priceDiscrepancy,
        edgeScore,
        reasoningChain: mapping.reasoning,
      });
    }

    return opportunities.sort((a, b) => b.edgeScore - a.edgeScore);
  }
}
