import Anthropic from "@anthropic-ai/sdk";
import type { EdgeOpportunity, PortfolioState, TradeOrder, CampaignConfig } from "../types/index.js";
import { calculatePositionSize, calculateExitLevels, checkPortfolioConstraints } from "./sizing.js";
import { generateId } from "../utils/id.js";
import { safeParseLLMJson } from "../utils/parse.js";

const SANITY_CHECK_PROMPT = `You are a risk-aware prediction market analyst for the "Vincent Plays Polymarket" campaign.
You are the final check before Vincent commits real capital ($10K bankroll) to a trade.

Given an edge opportunity (topic cluster → Polymarket market mapping), evaluate whether this trade should proceed.

Respond with JSON only (no markdown fencing):
{
  "decision": "TRADE" | "PASS" | "WATCH",
  "reasoning": "2-3 sentence explanation of your decision. This will be tweeted, so make it clear and insightful.",
  "pass_reason": "If PASS, explain why (e.g., 'market already priced in', 'signal too noisy')",
  "watch_condition": "If WATCH, what would change the decision (e.g., 'waiting for CPI print at 8:30am')",
  "confidence_adjustment": -0.2 to 0.2,
  "theme": "A short label for portfolio tracking (e.g., 'US politics', 'crypto prices', 'macro')"
}

You should PASS if:
- The market price is already very close to the signal-implied probability (no edge)
- The signals are too noisy, conflicting, or low quality
- The signal is based purely on rumor with no corroboration
- Risk/reward is poor (e.g., buying YES at $0.90)

You should WATCH if:
- There's a pending catalyst (data release, event, announcement) that would clarify
- The signal is forming but not mature enough yet

You should TRADE if:
- Clear price discrepancy between signal and market
- Signal is corroborated by multiple independent sources
- Reasonable risk/reward at current price`;

export class SanityChecker {
  private anthropic: Anthropic;
  private config: CampaignConfig;

  constructor(anthropicApiKey: string, config: CampaignConfig) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.config = config;
  }

  /**
   * Run the full sanity check pipeline on an edge opportunity.
   * Returns a TradeOrder with the final decision.
   */
  async evaluate(
    opportunity: EdgeOpportunity,
    portfolio: PortfolioState
  ): Promise<TradeOrder> {
    // Check portfolio constraints first
    const constraintCheck = checkPortfolioConstraints(opportunity, portfolio, this.config);
    if (!constraintCheck.allowed) {
      return {
        decision: "PASS",
        market: opportunity.market,
        direction: opportunity.direction,
        size: 0,
        entryPrice: opportunity.currentMarketPrice,
        stopLoss: 0,
        takeProfit: 0,
        edgeScore: opportunity.edgeScore,
        reasoning: constraintCheck.reason!,
        contributingSignals: opportunity.cluster.signals,
        passReason: constraintCheck.reason,
      };
    }

    // Check minimum edge score
    if (opportunity.edgeScore < this.config.minEdgeScore) {
      return {
        decision: "PASS",
        market: opportunity.market,
        direction: opportunity.direction,
        size: 0,
        entryPrice: opportunity.currentMarketPrice,
        stopLoss: 0,
        takeProfit: 0,
        edgeScore: opportunity.edgeScore,
        reasoning: `Edge score ${opportunity.edgeScore.toFixed(2)} below minimum threshold ${this.config.minEdgeScore}`,
        contributingSignals: opportunity.cluster.signals,
        passReason: "Edge score too low",
      };
    }

    // Check minimum signal count
    if (opportunity.cluster.signalCount < this.config.minSignalsToAct) {
      return {
        decision: "WATCH",
        market: opportunity.market,
        direction: opportunity.direction,
        size: 0,
        entryPrice: opportunity.currentMarketPrice,
        stopLoss: 0,
        takeProfit: 0,
        edgeScore: opportunity.edgeScore,
        reasoning: `Only ${opportunity.cluster.signalCount} signals — need at least ${this.config.minSignalsToAct} before acting`,
        contributingSignals: opportunity.cluster.signals,
        watchCondition: `Waiting for more signals on "${opportunity.cluster.name}"`,
      };
    }

    // LLM sanity check
    const oppSummary = {
      cluster_name: opportunity.cluster.name,
      signal_count: opportunity.cluster.signalCount,
      sentiment: opportunity.cluster.sentiment,
      top_claims: opportunity.cluster.signals.slice(0, 5).map((s) => ({
        claim: s.coreClaim,
        type: s.signalType,
        urgency: s.urgency,
        source: s.raw.user.handle,
      })),
      market_question: opportunity.market.question,
      direction: opportunity.direction,
      signal_implied_probability: opportunity.signalImpliedProbability,
      current_market_price: opportunity.currentMarketPrice,
      price_discrepancy: opportunity.priceDiscrepancy,
      edge_score: opportunity.edgeScore,
      bankroll: portfolio.bankroll,
      open_positions: portfolio.positions.length,
    };

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Evaluate this edge opportunity:\n\n${JSON.stringify(oppSummary, null, 2)}`,
        },
      ],
      system: SANITY_CHECK_PROMPT,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const parsed: any = safeParseLLMJson(
      text,
      { decision: "PASS", reasoning: "Failed to parse LLM response", pass_reason: "LLM parse error" },
      "SanityChecker"
    );

    const size =
      parsed.decision === "TRADE"
        ? calculatePositionSize(opportunity, portfolio, this.config)
        : 0;

    const exitLevels =
      parsed.decision === "TRADE"
        ? calculateExitLevels(opportunity.currentMarketPrice, opportunity.direction, this.config)
        : { stopLoss: 0, takeProfit: 0 };

    // If size calculation returned 0, downgrade to PASS
    const finalDecision = parsed.decision === "TRADE" && size === 0 ? "PASS" : parsed.decision;

    return {
      decision: finalDecision,
      market: opportunity.market,
      direction: opportunity.direction,
      size,
      entryPrice: opportunity.currentMarketPrice,
      stopLoss: exitLevels.stopLoss,
      takeProfit: exitLevels.takeProfit,
      edgeScore: opportunity.edgeScore,
      reasoning: parsed.reasoning,
      contributingSignals: opportunity.cluster.signals,
      passReason: parsed.pass_reason,
      watchCondition: parsed.watch_condition,
    };
  }
}
