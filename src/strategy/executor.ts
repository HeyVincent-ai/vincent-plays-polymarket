import type { TradeOrder } from "../types/index.js";
import { withRetry } from "../utils/retry.js";

/**
 * Execute a trade via the Vincent API (Trade Manager on the VPS).
 * In production this calls the local Trade Manager HTTP API.
 */
export class TradeExecutor {
  private vincentApiUrl: string;
  private vincentApiKey: string;
  private tradeManagerUrl: string;

  constructor(vincentApiUrl: string, vincentApiKey: string, tradeManagerUrl: string) {
    this.vincentApiUrl = vincentApiUrl;
    this.vincentApiKey = vincentApiKey;
    this.tradeManagerUrl = tradeManagerUrl;
  }

  /**
   * Place a bet on Polymarket via the Vincent API.
   */
  async placeBet(order: TradeOrder): Promise<{ success: boolean; txHash?: string; error?: string }> {
    try {
      const response = await withRetry(
        () => fetch(`${this.vincentApiUrl}/api/skills/polymarket/bet`, {
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
        }),
        "VincentAPI.placeBet()",
        { maxRetries: 2, baseDelayMs: 2000 }
      );

      if (!response.ok) {
        const error = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${error}` };
      }

      const result: any = await response.json();
      return { success: true, txHash: result.txHash || result.orderHash };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  }

  /**
   * Set stop-loss and take-profit rules on the Trade Manager daemon.
   * Logs errors but does not throw — exit rules are important but
   * a failure shouldn't block the trade from being recorded.
   */
  async setExitRules(order: TradeOrder): Promise<{ stopLossSet: boolean; takeProfitSet: boolean }> {
    const results = { stopLossSet: false, takeProfitSet: false };

    // Set stop loss
    if (order.stopLoss > 0) {
      try {
        const resp = await withRetry(
          () => fetch(`${this.tradeManagerUrl}/api/rules`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              marketId: order.market.conditionId,
              ruleType: "STOP_LOSS",
              triggerPrice: order.stopLoss,
              action: { type: "SELL_ALL" },
            }),
          }),
          "TradeManager.setStopLoss()",
          { maxRetries: 2, baseDelayMs: 1000 }
        );

        if (resp.ok) {
          results.stopLossSet = true;
          console.log(`[Executor] Stop loss set at $${order.stopLoss.toFixed(2)} for ${order.market.conditionId}`);
        } else {
          const body = await resp.text();
          console.error(`[Executor] Failed to set stop loss: HTTP ${resp.status} — ${body}`);
        }
      } catch (err) {
        console.error(`[Executor] Failed to set stop loss (network error):`, err);
      }
    }

    // Set take profit
    if (order.takeProfit > 0) {
      try {
        const resp = await withRetry(
          () => fetch(`${this.tradeManagerUrl}/api/rules`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              marketId: order.market.conditionId,
              ruleType: "TAKE_PROFIT",
              triggerPrice: order.takeProfit,
              action: { type: "SELL_ALL" },
            }),
          }),
          "TradeManager.setTakeProfit()",
          { maxRetries: 2, baseDelayMs: 1000 }
        );

        if (resp.ok) {
          results.takeProfitSet = true;
          console.log(`[Executor] Take profit set at $${order.takeProfit.toFixed(2)} for ${order.market.conditionId}`);
        } else {
          const body = await resp.text();
          console.error(`[Executor] Failed to set take profit: HTTP ${resp.status} — ${body}`);
        }
      } catch (err) {
        console.error(`[Executor] Failed to set take profit (network error):`, err);
      }
    }

    if (!results.stopLossSet || !results.takeProfitSet) {
      console.warn(`[Executor] ⚠ Exit rules incomplete for ${order.market.conditionId} — SL: ${results.stopLossSet}, TP: ${results.takeProfitSet}`);
    }

    return results;
  }

  /**
   * Fetch current positions from Vincent API.
   */
  async getPositions(): Promise<any[]> {
    try {
      const response = await withRetry(
        () => fetch(`${this.vincentApiUrl}/api/skills/polymarket/positions`, {
          headers: {
            Authorization: `Bearer ${this.vincentApiKey}`,
          },
        }),
        "VincentAPI.getPositions()",
        { maxRetries: 2, baseDelayMs: 2000 }
      );
      if (!response.ok) return [];
      return await response.json();
    } catch {
      return [];
    }
  }
}
