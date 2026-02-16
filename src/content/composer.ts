import type { TradeOrder, PortfolioState, TopicCluster, EnrichedSignal, Contributor } from "../types/index.js";

const MAX_TWEET_LENGTH = 280;

/**
 * Compose tweet threads for different campaign events.
 */
export class ContentComposer {
  /**
   * Trade entry thread — the core content showing Vincent's reasoning.
   */
  composeTradeEntry(order: TradeOrder, portfolio: PortfolioState): string[] {
    const topContributors = this.getTopContributors(order.contributingSignals, 3);
    const signalCount = order.contributingSignals.length;

    const tweets: string[] = [];

    // Tweet 1: Hook
    tweets.push(
      `CT flagged something. ${signalCount} of you mentioned ${order.market.question.slice(0, 80)} in the last few hours. Here's what I'm seeing.`
    );

    // Tweet 2: Signal summary
    const contributorMentions = topContributors
      .map((c) => `@${c}`)
      .join(", ");
    tweets.push(
      `The signal: ${order.reasoning}\n\n` +
      `Key contributors: ${contributorMentions}`
    );

    // Tweet 3: Trade details
    tweets.push(
      `Entering ${order.direction} at $${order.entryPrice.toFixed(2)}\n` +
      `Position: $${order.size} (${((order.size / portfolio.bankroll) * 100).toFixed(1)}% of bankroll)\n` +
      `SL: $${order.stopLoss.toFixed(2)} | TP: $${order.takeProfit.toFixed(2)}\n` +
      `Edge score: ${order.edgeScore.toFixed(2)}\n\n` +
      `Bankroll: $${portfolio.bankroll.toLocaleString()}`
    );

    // Tweet 4: CTA
    tweets.push(
      `Vincent read ${signalCount} signals, cross-referenced sources, found the edge, sized the position, and set the stop loss — autonomously.\n\n` +
      `This is one agent running one strategy. You can run your own.\n` +
      `→ heyvincent.ai`
    );

    return tweets.map((t) => this.truncate(t));
  }

  /**
   * Trade pass / no-trade tweet — shows Vincent thinking and deciding not to act.
   */
  composeTradePass(order: TradeOrder): string[] {
    const signalCount = order.contributingSignals.length;

    return [
      `${signalCount} of you tagged me about "${order.market.question.slice(0, 60)}"\n\n` +
      `I looked into it. ${order.reasoning}\n\n` +
      `Decision: PASS\n` +
      (order.passReason ? `Reason: ${order.passReason}\n\n` : "\n") +
      `I only trade when there's a discrepancy between what CT sees and what the market prices. Keep the signals coming.`,
    ].map((t) => this.truncate(t));
  }

  /**
   * Watch tweet — Vincent is monitoring but not acting yet.
   */
  composeTradeWatch(order: TradeOrder): string[] {
    return [
      `Watching: "${order.market.question.slice(0, 80)}"\n\n` +
      `${order.contributingSignals.length} signals so far. ${order.reasoning}\n\n` +
      (order.watchCondition ? `Next move: ${order.watchCondition}\n\n` : "") +
      `Tag me with more signal if you have it.`,
    ].map((t) => this.truncate(t));
  }

  /**
   * Trade exit thread.
   */
  composeTradeExit(
    order: TradeOrder,
    exitPrice: number,
    pnl: number,
    portfolio: PortfolioState
  ): string[] {
    const pnlSign = pnl >= 0 ? "+" : "";
    const pnlPct = ((pnl / order.size) * 100).toFixed(1);
    const topContributors = this.getTopContributors(order.contributingSignals, 3);

    const tweets: string[] = [];

    tweets.push(
      `Position closed: "${order.market.question.slice(0, 60)}"\n\n` +
      `${order.direction} | Entry: $${order.entryPrice.toFixed(2)} → Exit: $${exitPrice.toFixed(2)}\n` +
      `P&L: ${pnlSign}$${Math.abs(pnl).toFixed(0)} (${pnlSign}${pnlPct}%)\n\n` +
      `Bankroll: $${portfolio.bankroll.toLocaleString()} (${portfolio.totalPnlPercent >= 0 ? "+" : ""}${portfolio.totalPnlPercent.toFixed(1)}% all time)`
    );

    if (topContributors.length > 0) {
      tweets.push(
        `Top signal contributors: ${topContributors.map((c) => `@${c}`).join(", ")}\n\n` +
        (pnl >= 0
          ? `CT's signal was right on this one.`
          : `The crowd missed this one. It happens. Moving on.`)
      );
    }

    return tweets.map((t) => this.truncate(t));
  }

  /**
   * Daily digest tweet.
   */
  composeDailyDigest(
    portfolio: PortfolioState,
    signalsToday: number,
    uniqueUsers: number,
    topTopics: string[],
    bestContributor?: { handle: string; signal: string }
  ): string[] {
    const pnlSign = portfolio.totalPnlPercent >= 0 ? "+" : "";

    const tweets: string[] = [];

    tweets.push(
      `Day ${portfolio.dayNumber} digest:\n\n` +
      `Signals: ${signalsToday} from ${uniqueUsers} users\n` +
      `Topics trending: ${topTopics.slice(0, 3).join(", ")}\n` +
      `Trades: ${portfolio.tradesEntered} entered, ${portfolio.tradesExited} exited\n\n` +
      `Bankroll: $${portfolio.bankroll.toLocaleString()} (${pnlSign}${portfolio.totalPnlPercent.toFixed(1)}% all time)\n\n` +
      (bestContributor
        ? `Best signal today: @${bestContributor.handle} flagged ${bestContributor.signal}`
        : "")
    );

    tweets.push(
      `Vincent processed ${signalsToday} signals today, managed ${portfolio.positions.length} open positions with automated stop-losses.\n\n` +
      `Run your own Vincent → heyvincent.ai`
    );

    return tweets.map((t) => this.truncate(t));
  }

  /**
   * Weekly intelligence report thread.
   */
  composeWeeklyReport(
    weekNumber: number,
    portfolio: PortfolioState,
    topClusters: TopicCluster[],
    topContributors: Contributor[],
    weeklyStats: { trades: number; wins: number; losses: number; pnl: number }
  ): string[] {
    const tweets: string[] = [];

    tweets.push(
      `WEEK ${weekNumber} INTELLIGENCE REPORT\n\n` +
      `What CT sees that the market doesn't.`
    );

    tweets.push(
      `Top themes this week:\n` +
      topClusters
        .slice(0, 3)
        .map((c, i) => `${i + 1}. ${c.name} — ${c.signalCount} signals, ${c.sentiment.direction}`)
        .join("\n")
    );

    tweets.push(
      `Performance: ${weeklyStats.trades} trades, ${weeklyStats.wins} wins, ${weeklyStats.losses} losses\n` +
      `P&L: ${weeklyStats.pnl >= 0 ? "+" : ""}$${Math.abs(weeklyStats.pnl).toFixed(0)} | Win rate: ${weeklyStats.trades > 0 ? ((weeklyStats.wins / weeklyStats.trades) * 100).toFixed(0) : 0}%\n\n` +
      `Bankroll: $${portfolio.bankroll.toLocaleString()}`
    );

    if (topContributors.length > 0) {
      tweets.push(
        `Top contributors:\n` +
        topContributors
          .slice(0, 3)
          .map((c, i) => `${["1st", "2nd", "3rd"][i]} @${c.handle} — ${c.signalsThatLedToTrades} signals that led to trades`)
          .join("\n") +
        `\n\nTag @VincentPlays with what you see next.`
      );
    }

    tweets.push(
      `What you're watching is an AI agent that:\n` +
      `- Reads unstructured signals from Twitter\n` +
      `- Cross-references with real-time data\n` +
      `- Maps signals to prediction markets\n` +
      `- Sizes positions with risk management\n` +
      `- Executes trades with policy guardrails\n\n` +
      `This is Vincent. One campaign, one strategy. Your agent, your strategy.\n` +
      `→ heyvincent.ai`
    );

    return tweets.map((t) => this.truncate(t));
  }

  private getTopContributors(signals: EnrichedSignal[], limit: number): string[] {
    const counts = new Map<string, number>();
    for (const s of signals) {
      counts.set(s.raw.user.handle, (counts.get(s.raw.user.handle) || 0) + s.weight);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([handle]) => handle);
  }

  private truncate(text: string): string {
    if (text.length <= MAX_TWEET_LENGTH) return text;
    return text.slice(0, MAX_TWEET_LENGTH - 3) + "...";
  }
}
