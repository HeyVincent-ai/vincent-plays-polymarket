import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../data/campaign.db");

let db: Database.Database;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    initSchema(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      tweet_id TEXT UNIQUE NOT NULL,
      user_handle TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_followers INTEGER NOT NULL,
      user_account_age_days INTEGER NOT NULL,
      text TEXT NOT NULL,
      urls TEXT NOT NULL DEFAULT '[]',
      likes INTEGER NOT NULL DEFAULT 0,
      retweets INTEGER NOT NULL DEFAULT 0,
      replies INTEGER NOT NULL DEFAULT 0,
      quote_tweets INTEGER NOT NULL DEFAULT 0,
      signal_type TEXT NOT NULL,
      core_claim TEXT NOT NULL,
      urgency TEXT NOT NULL,
      topics TEXT NOT NULL DEFAULT '[]',
      corroboration TEXT NOT NULL DEFAULT '[]',
      weight REAL NOT NULL DEFAULT 1.0,
      timestamp TEXT NOT NULL,
      processed_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topic_clusters (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      signal_ids TEXT NOT NULL DEFAULT '[]',
      signal_count INTEGER NOT NULL DEFAULT 0,
      avg_engagement REAL NOT NULL DEFAULT 0,
      sentiment_direction TEXT NOT NULL,
      sentiment_confidence REAL NOT NULL DEFAULT 0,
      first_seen_at TEXT NOT NULL,
      last_updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      market_question TEXT NOT NULL,
      direction TEXT NOT NULL,
      decision TEXT NOT NULL,
      size REAL,
      entry_price REAL,
      stop_loss REAL,
      take_profit REAL,
      edge_score REAL NOT NULL,
      reasoning TEXT NOT NULL,
      contributing_signal_ids TEXT NOT NULL DEFAULT '[]',
      pass_reason TEXT,
      watch_condition TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      exit_price REAL,
      pnl REAL,
      tx_hash TEXT,
      created_at TEXT NOT NULL,
      closed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS contributors (
      user_id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      signals_sent INTEGER NOT NULL DEFAULT 0,
      signals_that_led_to_trades INTEGER NOT NULL DEFAULT 0,
      profitable_contributions INTEGER NOT NULL DEFAULT 0,
      first_to_flag_count INTEGER NOT NULL DEFAULT 0,
      total_pnl_from_signals REAL NOT NULL DEFAULT 0,
      best_signal TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS campaign_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_signals_timestamp ON signals(timestamp);
    CREATE INDEX IF NOT EXISTS idx_signals_user ON signals(user_handle);
    CREATE INDEX IF NOT EXISTS idx_signals_topics ON signals(topics);
    CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status);
    CREATE INDEX IF NOT EXISTS idx_trades_market ON trades(market_id);
  `);
}

export function closeDb() {
  if (db) {
    db.close();
  }
}

/**
 * Get a persistent campaign state value.
 */
export function getCampaignState(key: string): string | undefined {
  const db = getDb();
  const row: any = db.prepare(`SELECT value FROM campaign_state WHERE key = ?`).get(key);
  return row?.value;
}

/**
 * Set a persistent campaign state value.
 */
export function setCampaignState(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO campaign_state (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}
