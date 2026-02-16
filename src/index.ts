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
  };
}

async function main() {
  const config = loadConfig();

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
  for (const key of required) {
    if (!process.env[key]) {
      console.error(`Missing required env var: ${key}`);
      console.error(`Copy .env.example to .env and fill in the values.`);
      process.exit(1);
    }
  }

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

  await campaign.start();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  closeDb();
  process.exit(1);
});
