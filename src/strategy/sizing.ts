import type { EdgeOpportunity, PortfolioState, CampaignConfig, TradeOrder } from "../types/index.js";

export type ConvictionLevel = "high" | "moderate" | "low";

export function getConvictionLevel(edgeScore: number): ConvictionLevel {
  if (edgeScore > 0.8) return "high";
  if (edgeScore > 0.5) return "moderate";
  return "low";
}

/**
 * Calculate position size based on edge score and portfolio state.
 */
export function calculatePositionSize(
  opportunity: EdgeOpportunity,
  portfolio: PortfolioState,
  config: CampaignConfig
): number {
  const conviction = getConvictionLevel(opportunity.edgeScore);
  let pct: number;

  switch (conviction) {
    case "high":
      pct = config.basePositionPct * 2; // 4%
      break;
    case "moderate":
      pct = config.basePositionPct; // 2%
      break;
    case "low":
      pct = config.basePositionPct * 0.5; // 1%
      break;
  }

  let size = portfolio.bankroll * pct;

  // Cap at max position size
  size = Math.min(size, portfolio.bankroll * config.maxPositionPct);

  // Don't go below minimum
  if (size < config.minPositionUsd) return 0;

  // Respect cash reserve
  const minCash = portfolio.bankroll * config.cashReservePct;
  const maxSpend = portfolio.cashAvailable - minCash;
  if (maxSpend < config.minPositionUsd) return 0;
  size = Math.min(size, maxSpend);

  return Math.round(size);
}

/**
 * Check portfolio constraints before allowing a trade.
 */
export function checkPortfolioConstraints(
  opportunity: EdgeOpportunity,
  portfolio: PortfolioState,
  config: CampaignConfig
): { allowed: boolean; reason?: string } {
  // Max open positions
  if (portfolio.positions.length >= config.maxOpenPositions) {
    return { allowed: false, reason: `Already at max ${config.maxOpenPositions} open positions` };
  }

  // Drawdown breaker
  if (portfolio.bankroll <= config.bankroll * config.drawdownBreakerPct) {
    return { allowed: false, reason: `Drawdown breaker active: bankroll at $${portfolio.bankroll}` };
  }

  // Theme exposure check (simplified — uses market question keywords)
  const marketTheme = opportunity.market.question.toLowerCase();
  const themeExposure = portfolio.positions
    .filter((p) => p.marketQuestion.toLowerCase().includes(marketTheme.split(" ")[0]))
    .reduce((sum, p) => sum + p.size, 0);

  if (themeExposure > portfolio.bankroll * config.maxThemeExposurePct) {
    return { allowed: false, reason: `Theme exposure too high for "${marketTheme.split(" ")[0]}"` };
  }

  // Already have a position in this exact market
  const existingPosition = portfolio.positions.find(
    (p) => p.marketId === opportunity.market.conditionId
  );
  if (existingPosition) {
    return { allowed: false, reason: `Already have a position in this market` };
  }

  return { allowed: true };
}

/**
 * Calculate stop loss and take profit prices.
 */
export function calculateExitLevels(
  entryPrice: number,
  direction: "YES" | "NO",
  config: CampaignConfig
): { stopLoss: number; takeProfit: number } {
  if (direction === "YES") {
    return {
      stopLoss: Math.max(0.01, entryPrice * (1 - config.stopLossPercent)),
      takeProfit: Math.min(0.99, entryPrice * config.takeProfitMultiple),
    };
  } else {
    // For NO positions, the logic is inverted
    return {
      stopLoss: Math.min(0.99, entryPrice * (1 + config.stopLossPercent)),
      takeProfit: Math.max(0.01, entryPrice / config.takeProfitMultiple),
    };
  }
}
