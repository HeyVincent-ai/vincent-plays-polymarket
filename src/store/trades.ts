import { getDb } from "./db.js";
import type { TradeOrder } from "../types/index.js";
import { generateId } from "../utils/id.js";

export function saveTrade(order: TradeOrder, txHash?: string): string {
  const db = getDb();
  const id = generateId("trd");
  db.prepare(`
    INSERT INTO trades (
      id, market_id, market_question, direction, decision,
      size, entry_price, stop_loss, take_profit, edge_score,
      reasoning, contributing_signal_ids, pass_reason, watch_condition,
      status, tx_hash, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    order.market.conditionId,
    order.market.question,
    order.direction,
    order.decision,
    order.size,
    order.entryPrice,
    order.stopLoss,
    order.takeProfit,
    order.edgeScore,
    order.reasoning,
    JSON.stringify(order.contributingSignals.map((s) => s.id)),
    order.passReason || null,
    order.watchCondition || null,
    order.decision === "TRADE" ? "open" : order.decision.toLowerCase(),
    txHash || null,
    new Date().toISOString()
  );
  return id;
}

export function getOpenTrades(): any[] {
  const db = getDb();
  return db.prepare(`SELECT * FROM trades WHERE status = 'open'`).all();
}

export function closeTrade(tradeId: string, exitPrice: number, pnl: number) {
  const db = getDb();
  db.prepare(`
    UPDATE trades SET status = 'closed', exit_price = ?, pnl = ?, closed_at = ?
    WHERE id = ?
  `).run(exitPrice, pnl, new Date().toISOString(), tradeId);
}

export function getTradeStats(since?: Date): { trades: number; wins: number; losses: number; pnl: number } {
  const db = getDb();
  const sinceStr = since ? since.toISOString() : "1970-01-01";
  const rows: any[] = db.prepare(`
    SELECT pnl FROM trades WHERE status = 'closed' AND closed_at > ?
  `).all(sinceStr);

  return {
    trades: rows.length,
    wins: rows.filter((r) => r.pnl > 0).length,
    losses: rows.filter((r) => r.pnl <= 0).length,
    pnl: rows.reduce((sum, r) => sum + (r.pnl || 0), 0),
  };
}
