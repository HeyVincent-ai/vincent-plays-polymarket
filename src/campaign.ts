import type { CampaignConfig, PortfolioState, EnrichedSignal, EdgeOpportunity, TradeOrder } from "./types/index.js";
import { TwitterClient } from "./ingestion/twitter.js";
import { SignalEnricher } from "./ingestion/enricher.js";
import { TopicClusterer } from "./sensemaking/clustering.js";
import { EdgeScorer } from "./sensemaking/edge-scorer.js";
import { SanityChecker } from "./strategy/sanity-check.js";
import { TradeExecutor } from "./strategy/executor.js";
import { ContentComposer } from "./content/composer.js";
import {
  saveSignal,
  getRecentSignals,
  updateContributor,
  getUserSignalCountToday,
  getSignalCountToday,
  saveTrade,
  getOpenTrades,
  getTopContributors,
} from "./store/index.js";

export class Campaign {
  private twitter: TwitterClient;
  private enricher: SignalEnricher;
  private clusterer: TopicClusterer;
  private edgeScorer: EdgeScorer;
  private sanityChecker: SanityChecker;
  private executor: TradeExecutor;
  private composer: ContentComposer;
  private config: CampaignConfig;
  private running = false;
  private startDate: Date;

  constructor(deps: {
    twitter: TwitterClient;
    anthropicApiKey: string;
    vincentApiUrl: string;
    vincentApiKey: string;
    config: CampaignConfig;
  }) {
    this.twitter = deps.twitter;
    this.enricher = new SignalEnricher(deps.anthropicApiKey, deps.config);
    this.clusterer = new TopicClusterer(deps.anthropicApiKey);
    this.edgeScorer = new EdgeScorer(deps.anthropicApiKey);
    this.sanityChecker = new SanityChecker(deps.anthropicApiKey, deps.config);
    this.executor = new TradeExecutor(deps.vincentApiUrl, deps.vincentApiKey);
    this.composer = new ContentComposer();
    this.config = deps.config;
    this.startDate = new Date();
  }

  /**
   * Start the main campaign loop.
   */
  async start() {
    this.running = true;
    console.log(`[Campaign] Starting "Vincent Plays Polymarket" campaign`);
    console.log(`[Campaign] Bankroll: $${this.config.bankroll}`);
    console.log(`[Campaign] Poll interval: ${this.config.pollIntervalSeconds}s`);

    while (this.running) {
      try {
        await this.tick();
      } catch (err) {
        console.error("[Campaign] Error in main loop:", err);
      }
      await this.sleep(this.config.pollIntervalSeconds * 1000);
    }
  }

  stop() {
    this.running = false;
    console.log("[Campaign] Stopping...");
  }

  /**
   * One cycle of the campaign loop:
   * 1. Fetch new @mentions
   * 2. Enrich into signals
   * 3. Cluster by topic
   * 4. Find edge opportunities
   * 5. Sanity check and decide
   * 6. Execute trades
   * 7. Publish content
   */
  async tick() {
    console.log(`[Campaign] Tick at ${new Date().toISOString()}`);

    // 1. Fetch mentions
    const mentions = await this.twitter.fetchMentions();
    if (mentions.length === 0) {
      console.log("[Campaign] No new mentions");
      return;
    }
    console.log(`[Campaign] Fetched ${mentions.length} new mentions`);

    // Rate limit per user
    const rateLimited = mentions.filter((m) => {
      const count = getUserSignalCountToday(m.user.handle);
      return count < this.config.maxSignalsPerUserPerDay;
    });

    // 2. Enrich
    const signals = await this.enricher.enrichBatch(rateLimited);
    console.log(`[Campaign] Enriched ${signals.length} signals (${mentions.length - signals.length} filtered/noise)`);

    // Save signals and update contributors
    for (const signal of signals) {
      saveSignal(signal);
      updateContributor(signal);
    }

    // 3. Cluster — use all recent signals, not just this batch
    const recentSignals = getRecentSignals(24);
    if (recentSignals.length < 2) {
      console.log("[Campaign] Not enough recent signals to cluster");
      return;
    }

    const clusters = await this.clusterer.clusterSignals(recentSignals);
    console.log(`[Campaign] Found ${clusters.length} topic clusters`);

    // 4. Find edge opportunities
    const allOpportunities: EdgeOpportunity[] = [];
    for (const cluster of clusters) {
      const weight = this.clusterer.clusterWeight(cluster);
      const opportunities = await this.edgeScorer.findEdge(cluster, weight);
      allOpportunities.push(...opportunities);
    }
    console.log(`[Campaign] Found ${allOpportunities.length} edge opportunities`);

    // 5. Sanity check top opportunities
    const portfolio = await this.getPortfolioState();
    const topOpportunities = allOpportunities
      .sort((a, b) => b.edgeScore - a.edgeScore)
      .slice(0, 3); // evaluate top 3

    for (const opp of topOpportunities) {
      const order = await this.sanityChecker.evaluate(opp, portfolio);
      console.log(`[Campaign] ${order.market.question.slice(0, 50)} → ${order.decision}`);

      // 6. Execute if TRADE
      if (order.decision === "TRADE" && order.size > 0) {
        const result = await this.executor.placeBet(order);
        if (result.success) {
          saveTrade(order, result.txHash);
          await this.executor.setExitRules(order);
          console.log(`[Campaign] Trade placed: ${order.direction} on "${order.market.question.slice(0, 50)}" for $${order.size}`);

          // Publish trade entry thread
          const tweets = this.composer.composeTradeEntry(order, portfolio);
          await this.twitter.postThread(tweets);
        } else {
          console.error(`[Campaign] Trade failed: ${result.error}`);
          saveTrade({ ...order, decision: "PASS" }, undefined);
        }
      } else if (order.decision === "PASS") {
        saveTrade(order);
        // Only tweet about passes if there were enough signals (interesting content)
        if (order.contributingSignals.length >= this.config.minSignalsToAct) {
          const tweets = this.composer.composeTradePass(order);
          await this.twitter.postThread(tweets);
        }
      } else if (order.decision === "WATCH") {
        saveTrade(order);
        if (order.contributingSignals.length >= 3) {
          const tweets = this.composer.composeTradeWatch(order);
          await this.twitter.postThread(tweets);
        }
      }
    }
  }

  /**
   * Build portfolio state from Vincent API and local data.
   */
  async getPortfolioState(): Promise<PortfolioState> {
    const positions = await this.executor.getPositions();
    const openTrades = getOpenTrades();
    const dayNumber = Math.floor(
      (Date.now() - this.startDate.getTime()) / (1000 * 60 * 60 * 24)
    ) + 1;

    const totalPositionValue = openTrades.reduce(
      (sum, t) => sum + (t.size || 0),
      0
    );

    // Simplified portfolio state — in production, reconcile with on-chain data
    const bankroll = this.config.bankroll; // TODO: fetch real balance from Vincent
    const cashAvailable = bankroll - totalPositionValue;

    return {
      bankroll,
      startingBankroll: this.config.bankroll,
      cashAvailable,
      positions: openTrades.map((t: any) => ({
        marketId: t.market_id,
        marketQuestion: t.market_question,
        direction: t.direction,
        entryPrice: t.entry_price,
        currentPrice: t.entry_price, // TODO: fetch live prices
        size: t.size,
        pnl: 0, // TODO: calculate from current price
        pnlPercent: 0,
        enteredAt: new Date(t.created_at),
        theme: "",
      })),
      totalPnl: 0,
      totalPnlPercent: 0,
      dayNumber,
      tradesEntered: 0,
      tradesExited: 0,
      winCount: 0,
      lossCount: 0,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
