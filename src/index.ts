import "dotenv/config";
import { Campaign } from "./campaign.js";
import { TwitterClient } from "./ingestion/twitter.js";
import { DEFAULT_CONFIG, type CampaignConfig } from "./types/index.js";
import { closeDb } from "./store/db.js";

function loadConfig(): CampaignConfig {
  return {
    ...DEFAULT_CONFIG,
    bankroll: Number(process.env.CAMPAIGN_BANKROLL) || DEFAULT_CONFIG.bankroll,
    twitterHandle: process.env.CAMPAIGN_TWITTER_HANDLE || DEFAULT_CONFIG.twitterHandle,
    pollIntervalSeconds: Number(process.env.POLL_INTERVAL_SECONDS) || DEFAULT_CONFIG.pollIntervalSeconds,
    minAccountAgeDays: Number(process.env.MIN_ACCOUNT_AGE_DAYS) || DEFAULT_CONFIG.minAccountAgeDays,
    minFollowers: Number(process.env.MIN_FOLLOWERS) || DEFAULT_CONFIG.minFollowers,
    maxSignalsPerUserPerDay: Number(process.env.MAX_SIGNALS_PER_USER_PER_DAY) || DEFAULT_CONFIG.maxSignalsPerUserPerDay,
    minEdgeScore: Number(process.env.MIN_EDGE_SCORE) || DEFAULT_CONFIG.minEdgeScore,
    minSignalsToAct: Number(process.env.MIN_SIGNALS_TO_ACT) || DEFAULT_CONFIG.minSignalsToAct,
  };
}

/**
 * Validate the loaded config has sane values.
 */
function validateConfig(config: CampaignConfig): string[] {
  const errors: string[] = [];

  if (config.bankroll <= 0) errors.push("bankroll must be > 0");
  if (config.basePositionPct <= 0 || config.basePositionPct > 1) errors.push("basePositionPct must be 0-1");
  if (config.maxPositionPct <= 0 || config.maxPositionPct > 1) errors.push("maxPositionPct must be 0-1");
  if (config.maxPositionPct < config.basePositionPct) errors.push("maxPositionPct must be >= basePositionPct");
  if (config.minPositionUsd <= 0) errors.push("minPositionUsd must be > 0");
  if (config.maxOpenPositions <= 0) errors.push("maxOpenPositions must be > 0");
  if (config.cashReservePct < 0 || config.cashReservePct >= 1) errors.push("cashReservePct must be 0-1");
  if (config.drawdownBreakerPct <= 0 || config.drawdownBreakerPct > 1) errors.push("drawdownBreakerPct must be 0-1");
  if (config.stopLossPercent <= 0 || config.stopLossPercent > 1) errors.push("stopLossPercent must be 0-1");
  if (config.takeProfitMultiple <= 1) errors.push("takeProfitMultiple must be > 1");
  if (config.pollIntervalSeconds < 10) errors.push("pollIntervalSeconds must be >= 10 (API rate limits)");
  if (config.minEdgeScore < 0 || config.minEdgeScore > 1) errors.push("minEdgeScore must be 0-1");
  if (config.minSignalsToAct < 1) errors.push("minSignalsToAct must be >= 1");

  return errors;
}

async function main() {
  const config = loadConfig();

  // Validate config values
  const configErrors = validateConfig(config);
  if (configErrors.length > 0) {
    console.error("Invalid configuration:");
    for (const err of configErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  // Validate required env vars
  const required = [
    "TWITTER_API_KEY",
    "TWITTER_API_SECRET",
    "TWITTER_ACCESS_TOKEN",
    "TWITTER_ACCESS_SECRET",
    "ANTHROPIC_API_KEY",
    "VINCENT_API_URL",
    "VINCENT_API_KEY",
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error("Missing required environment variables:");
    for (const key of missing) {
      console.error(`  - ${key}`);
    }
    console.error(`\nCopy .env.example to .env and fill in the values.`);
    process.exit(1);
  }

  const tradeManagerUrl = process.env.TRADE_MANAGER_URL || "http://localhost:19000";

  const twitter = new TwitterClient({
    apiKey: process.env.TWITTER_API_KEY!,
    apiSecret: process.env.TWITTER_API_SECRET!,
    accessToken: process.env.TWITTER_ACCESS_TOKEN!,
    accessSecret: process.env.TWITTER_ACCESS_SECRET!,
    handle: config.twitterHandle,
  });

  const campaign = new Campaign({
    twitter,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY!,
    vincentApiUrl: process.env.VINCENT_API_URL!,
    vincentApiKey: process.env.VINCENT_API_KEY!,
    tradeManagerUrl,
    config,
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log("\nShutting down...");
    campaign.stop();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log("=".repeat(50));
  console.log("  Vincent Plays Polymarket");
  console.log("  CT points. Vincent thinks. $10K on the line.");
  console.log("=".repeat(50));
  console.log();
  console.log(`  Config:`);
  console.log(`    Bankroll:        $${config.bankroll.toLocaleString()}`);
  console.log(`    Twitter handle:  @${config.twitterHandle}`);
  console.log(`    Poll interval:   ${config.pollIntervalSeconds}s`);
  console.log(`    Trade Manager:   ${tradeManagerUrl}`);
  console.log(`    Min edge score:  ${config.minEdgeScore}`);
  console.log(`    Min signals:     ${config.minSignalsToAct}`);
  console.log();

  await campaign.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  closeDb();
  process.exit(1);
});
