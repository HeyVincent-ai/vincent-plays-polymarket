import { getDb } from "./db.js";
import type { EnrichedSignal, Contributor, TradeOrder } from "../types/index.js";

export function saveSignal(signal: EnrichedSignal) {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO signals (
      id, tweet_id, user_handle, user_id, user_followers, user_account_age_days,
      text, urls, likes, retweets, replies, quote_tweets,
      signal_type, core_claim, urgency, topics, corroboration, weight,
      timestamp, processed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    signal.id,
    signal.raw.tweetId,
    signal.raw.user.handle,
    signal.raw.user.id,
    signal.raw.user.followers,
    signal.raw.user.accountAgeDays,
    signal.raw.text,
    JSON.stringify(signal.raw.urls),
    signal.raw.engagement.likes,
    signal.raw.engagement.retweets,
    signal.raw.engagement.replies,
    signal.raw.engagement.quoteTweets,
    signal.signalType,
    signal.coreClaim,
    signal.urgency,
    JSON.stringify(signal.topics),
    JSON.stringify(signal.corroboration),
    signal.weight,
    signal.raw.timestamp.toISOString(),
    signal.processedAt.toISOString()
  );
}

export function getRecentSignals(hoursBack = 24): EnrichedSignal[] {
  const db = getDb();
  const cutoff = new Date(Date.now() - hoursBack * 60 * 60 * 1000).toISOString();
  const rows: any[] = db.prepare(`
    SELECT * FROM signals WHERE timestamp > ? ORDER BY timestamp DESC
  `).all(cutoff);

  return rows.map(rowToSignal);
}

export function getSignalCountToday(): { count: number; uniqueUsers: number } {
  const db = getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const row: any = db.prepare(`
    SELECT COUNT(*) as count, COUNT(DISTINCT user_handle) as unique_users
    FROM signals WHERE timestamp > ?
  `).get(today.toISOString());
  return { count: row.count, uniqueUsers: row.unique_users };
}

export function getUserSignalCountToday(userHandle: string): number {
  const db = getDb();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const row: any = db.prepare(`
    SELECT COUNT(*) as count FROM signals
    WHERE user_handle = ? AND timestamp > ?
  `).get(userHandle, today.toISOString());
  return row.count;
}

export function updateContributor(signal: EnrichedSignal) {
  const db = getDb();
  db.prepare(`
    INSERT INTO contributors (user_id, handle, signals_sent, updated_at)
    VALUES (?, ?, 1, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      signals_sent = signals_sent + 1,
      updated_at = excluded.updated_at
  `).run(signal.raw.user.id, signal.raw.user.handle, new Date().toISOString());
}

/**
 * When a trade is executed, attribute it to the contributing signal senders.
 * Increments signals_that_led_to_trades for each unique contributor,
 * and sets best_signal for the earliest contributor (first to flag).
 */
export function attributeTradeToContributors(order: TradeOrder) {
  const db = getDb();
  const now = new Date().toISOString();

  // Deduplicate contributors for this trade
  const seenUsers = new Set<string>();
  const sortedSignals = [...order.contributingSignals].sort(
    (a, b) => a.raw.timestamp.getTime() - b.raw.timestamp.getTime()
  );

  for (let i = 0; i < sortedSignals.length; i++) {
    const signal = sortedSignals[i];
    const userId = signal.raw.user.id;
    if (seenUsers.has(userId)) continue;
    seenUsers.add(userId);

    // Increment signals_that_led_to_trades
    db.prepare(`
      UPDATE contributors SET
        signals_that_led_to_trades = signals_that_led_to_trades + 1,
        updated_at = ?
      WHERE user_id = ?
    `).run(now, userId);

    // First contributor in the sorted list was first to flag
    if (i === 0) {
      db.prepare(`
        UPDATE contributors SET
          first_to_flag_count = first_to_flag_count + 1,
          best_signal = ?
        WHERE user_id = ? AND (best_signal IS NULL OR best_signal = '')
      `).run(
        `Flagged "${order.market.question.slice(0, 60)}" early`,
        userId
      );
    }
  }
}

/**
 * When a trade is closed profitably, update contributor stats.
 */
export function attributeProfitToContributors(
  contributingSignals: EnrichedSignal[],
  pnl: number,
  marketQuestion: string
) {
  const db = getDb();
  const now = new Date().toISOString();
  const seenUsers = new Set<string>();
  const perUserPnl = pnl / Math.max(1, new Set(contributingSignals.map(s => s.raw.user.id)).size);

  for (const signal of contributingSignals) {
    const userId = signal.raw.user.id;
    if (seenUsers.has(userId)) continue;
    seenUsers.add(userId);

    if (pnl > 0) {
      db.prepare(`
        UPDATE contributors SET
          profitable_contributions = profitable_contributions + 1,
          total_pnl_from_signals = total_pnl_from_signals + ?,
          best_signal = ?,
          updated_at = ?
        WHERE user_id = ?
      `).run(
        perUserPnl,
        `Contributed to +$${Math.abs(pnl).toFixed(0)} trade on "${marketQuestion.slice(0, 50)}"`,
        now,
        userId
      );
    } else {
      db.prepare(`
        UPDATE contributors SET
          total_pnl_from_signals = total_pnl_from_signals + ?,
          updated_at = ?
        WHERE user_id = ?
      `).run(perUserPnl, now, userId);
    }
  }
}

export function getTopContributors(limit = 5): Contributor[] {
  const db = getDb();
  const rows: any[] = db.prepare(`
    SELECT * FROM contributors
    ORDER BY signals_that_led_to_trades DESC, profitable_contributions DESC
    LIMIT ?
  `).all(limit);

  return rows.map((r) => ({
    handle: r.handle,
    userId: r.user_id,
    signalsSent: r.signals_sent,
    signalsThatLedToTrades: r.signals_that_led_to_trades,
    profitableContributions: r.profitable_contributions,
    firstToFlagCount: r.first_to_flag_count,
    totalPnlFromSignals: r.total_pnl_from_signals,
    bestSignal: r.best_signal,
  }));
}

function rowToSignal(row: any): EnrichedSignal {
  return {
    id: row.id,
    raw: {
      tweetId: row.tweet_id,
      text: row.text,
      user: {
        id: row.user_id,
        handle: row.user_handle,
        followers: row.user_followers,
        accountAgeDays: row.user_account_age_days,
      },
      urls: JSON.parse(row.urls),
      engagement: {
        likes: row.likes,
        retweets: row.retweets,
        replies: row.replies,
        quoteTweets: row.quote_tweets,
      },
      timestamp: new Date(row.timestamp),
      conversationContext: [],
    },
    signalType: row.signal_type,
    coreClaim: row.core_claim,
    urgency: row.urgency,
    topics: JSON.parse(row.topics),
    corroboration: JSON.parse(row.corroboration),
    weight: row.weight,
    processedAt: new Date(row.processed_at),
  };
}
