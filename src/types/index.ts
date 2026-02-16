// ---- Raw Twitter Signal ----

export interface ConversationTweet {
  tweetId: string;
  text: string;
  authorHandle: string;
  authorFollowers: number;
  urls: string[];
  engagement: {
    likes: number;
    retweets: number;
    replies: number;
    quoteTweets: number;
  };
  timestamp: Date;
}

export interface RawMention {
  tweetId: string;
  text: string;
  user: {
    id: string;
    handle: string;
    followers: number;
    accountAgeDays: number;
  };
  urls: string[];
  engagement: {
    likes: number;
    retweets: number;
    replies: number;
    quoteTweets: number;
  };
  timestamp: Date;
  inReplyToId?: string;
  /** Parent tweets in the conversation chain, ordered root → leaf (closest parent last) */
  conversationContext: ConversationTweet[];
  /** The tweet being quoted, if this is a quote tweet */
  quotedTweet?: ConversationTweet;
}

// ---- Enriched Signal ----

export type SignalType =
  | "news"
  | "data"
  | "rumor"
  | "sentiment"
  | "onchain"
  | "market_pointer"
  | "noise";

export type Urgency = "breaking" | "developing" | "slow";

export interface EnrichedSignal {
  id: string;
  raw: RawMention;
  signalType: SignalType;
  coreClaim: string;
  urgency: Urgency;
  topics: string[];
  corroboration: string[];
  weight: number;
  processedAt: Date;
}

// ---- Topic Cluster ----

export interface TopicCluster {
  id: string;
  name: string;
  signals: EnrichedSignal[];
  signalCount: number;
  avgEngagement: number;
  sentiment: {
    direction: string;
    confidence: number;
  };
  firstSeenAt: Date;
  lastUpdatedAt: Date;
}

// ---- Polymarket Market ----

export interface PolymarketMarket {
  conditionId: string;
  slug: string;
  question: string;
  outcomes: string[];
  outcomePrices: number[];
  volume: number;
  liquidity: number;
  endDate: string;
  active: boolean;
}

// ---- Edge Opportunity ----

export interface EdgeOpportunity {
  cluster: TopicCluster;
  market: PolymarketMarket;
  direction: "YES" | "NO";
  signalImpliedProbability: number;
  currentMarketPrice: number;
  priceDiscrepancy: number;
  edgeScore: number;
  reasoningChain: string;
}

// ---- Trade Decision ----

export type TradeDecision = "TRADE" | "PASS" | "WATCH";

export interface TradeOrder {
  decision: TradeDecision;
  market: PolymarketMarket;
  direction: "YES" | "NO";
  size: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  edgeScore: number;
  reasoning: string;
  contributingSignals: EnrichedSignal[];
  watchCondition?: string;
  passReason?: string;
}

// ---- Portfolio State ----

export interface Position {
  marketId: string;
  marketQuestion: string;
  direction: "YES" | "NO";
  entryPrice: number;
  currentPrice: number;
  size: number;
  pnl: number;
  pnlPercent: number;
  enteredAt: Date;
  theme: string;
}

export interface PortfolioState {
  bankroll: number;
  startingBankroll: number;
  cashAvailable: number;
  positions: Position[];
  totalPnl: number;
  totalPnlPercent: number;
  dayNumber: number;
  tradesEntered: number;
  tradesExited: number;
  winCount: number;
  lossCount: number;
}

// ---- Contributor Tracking ----

export interface Contributor {
  handle: string;
  userId: string;
  signalsSent: number;
  signalsThatLedToTrades: number;
  profitableContributions: number;
  firstToFlagCount: number;
  totalPnlFromSignals: number;
  bestSignal?: string;
}

// ---- Campaign Config ----

export interface CampaignConfig {
  bankroll: number;
  twitterHandle: string;

  // Position sizing
  basePositionPct: number; // 0.02 = 2%
  maxPositionPct: number; // 0.05 = 5%
  minPositionUsd: number; // 50

  // Portfolio constraints
  maxOpenPositions: number; // 10
  maxThemeExposurePct: number; // 0.15
  cashReservePct: number; // 0.20
  drawdownBreakerPct: number; // 0.50

  // Exit rules
  takeProfitMultiple: number; // 2.0 (100% gain)
  stopLossPercent: number; // 0.40 (40% loss)

  // Signal thresholds
  minSignalsToAct: number; // 5
  minEdgeScore: number; // 0.3
  minAccountAgeDays: number; // 30
  minFollowers: number; // 50
  maxSignalsPerUserPerDay: number; // 5

  // Timing
  pollIntervalSeconds: number;
}

export const DEFAULT_CONFIG: CampaignConfig = {
  bankroll: 10_000,
  twitterHandle: "VincentPlays",

  basePositionPct: 0.02,
  maxPositionPct: 0.05,
  minPositionUsd: 50,

  maxOpenPositions: 10,
  maxThemeExposurePct: 0.15,
  cashReservePct: 0.20,
  drawdownBreakerPct: 0.50,

  takeProfitMultiple: 2.0,
  stopLossPercent: 0.40,

  minSignalsToAct: 5,
  minEdgeScore: 0.3,
  minAccountAgeDays: 30,
  minFollowers: 50,
  maxSignalsPerUserPerDay: 5,

  pollIntervalSeconds: 60,
};
