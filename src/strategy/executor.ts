import type { TradeOrder } from "../types/index.js";

/**
 * Execute a trade via the Vincent API (Trade Manager on the VPS).
 * In production this calls the local Trade Manager HTTP API.
 * Currently a placeholder for integration.
 */
export class TradeExecutor {
  private vincentApiUrl: string;
  private vincentApiKey: string;

  constructor(vincentApiUrl: string, vincentApiKey: string) {
    this.vincentApiUrl = vincentApiUrl;
    this.vincentApiKey = vincentApiKey;
  }

  /**
   * Place a bet on Polymarket via the Vincent API.
   */
  async placeBet(order: TradeOrder): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const response = await fetch(`${this.vincentApiUrl}/api/skills/polymarket/bet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.vincentApiKey}`,
        },
        body: JSON.stringify({
          marketId: order.market.conditionId,
          outcome: order.direction,
          amount: order.size,
          price: order.entryPrice,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error };
      }

      const result: any = await response.json();
      return { success: true, txHash: result.txHash || result.orderHash };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Set stop-loss and take-profit rules on the Trade Manager daemon.
   */
  async setExitRules(order: TradeOrder): Promise<void> {
    const tradeManagerUrl = "http://localhost:19000";

    // Set stop loss
    if (order.stopLoss > 0) {
      await fetch(`${tradeManagerUrl}/api/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: order.market.conditionId,
          ruleType: "STOP_LOSS",
          triggerPrice: order.stopLoss,
          action: { type: "SELL_ALL" },
        }),
      }).catch((err) => console.error("Failed to set stop loss:", err));
    }

    // Set take profit
    if (order.takeProfit > 0) {
      await fetch(`${tradeManagerUrl}/api/rules`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId: order.market.conditionId,
          ruleType: "TAKE_PROFIT",
          triggerPrice: order.takeProfit,
          action: { type: "SELL_ALL" },
        }),
      }).catch((err) => console.error("Failed to set take profit:", err));
    }
  }

  /**
   * Fetch current positions from Vincent API.
   */
  async getPositions(): Promise<any[]> {
    try {
      const response = await fetch(`${this.vincentApiUrl}/api/skills/polymarket/positions`, {
        headers: {
          Authorization: `Bearer ${this.vincentApiKey}`,
        },
      });
      if (!response.ok) return [];
      return await response.json();
    } catch {
      return [];
    }
  }
}
