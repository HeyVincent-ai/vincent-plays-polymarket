#!/bin/bash
# ============================================================
# Vincent Plays Polymarket — OpenClaw Deployment Script
# ============================================================
#
# Run this on an existing OpenClaw VPS to set up the campaign.
# Prerequisites: OpenClaw already installed and running with
# Vincent skills (agentwallet, vincentpolymarket, vincent-twitter,
# vincent-brave-search).
#
# Usage:
#   export TWITTER_API_KEY="..."
#   export TWITTER_API_SECRET="..."
#   export TWITTER_ACCESS_TOKEN="..."
#   export TWITTER_ACCESS_SECRET="..."
#   export TWITTER_BEARER_TOKEN="..."
#   export ANTHROPIC_API_KEY="..."
#   export POLYMARKET_WALLET_ADDRESS="0x..."
#   bash setup.sh
#
# ============================================================

set -euo pipefail
export HOME=/root
cd /root

echo "============================================"
echo "  Vincent Plays Polymarket — Setup"
echo "  CT points. Vincent thinks. \$10K on the line."
echo "============================================"
echo

# ── Validate required environment variables ──
REQUIRED_VARS=(
  "TWITTER_API_KEY"
  "TWITTER_API_SECRET"
  "TWITTER_ACCESS_TOKEN"
  "TWITTER_ACCESS_SECRET"
  "TWITTER_BEARER_TOKEN"
  "ANTHROPIC_API_KEY"
  "POLYMARKET_WALLET_ADDRESS"
)

for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: Missing required env var: $var"
    exit 1
  fi
done

echo "[1/6] Installing Node.js dependencies..."
# Ensure Node.js 20+ is available
if ! command -v node &> /dev/null || [ "$(node -e 'console.log(parseInt(process.version.slice(1)))')" -lt 20 ]; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "[2/6] Setting up campaign directory..."
CAMPAIGN_DIR="/root/.openclaw/campaigns/vincent-plays-polymarket"
mkdir -p "$CAMPAIGN_DIR"
cd "$CAMPAIGN_DIR"

# Copy or download the campaign code
if [ -d "/tmp/vincent-plays-polymarket" ]; then
  cp -r /tmp/vincent-plays-polymarket/* .
else
  echo "ERROR: Campaign code not found at /tmp/vincent-plays-polymarket"
  echo "Upload the project directory to /tmp/vincent-plays-polymarket first."
  exit 1
fi

echo "[3/6] Installing npm dependencies..."
npm ci --production 2>/dev/null || npm install --production

echo "[4/6] Building TypeScript..."
npx tsc

echo "[5/6] Writing campaign .env..."
cat > "$CAMPAIGN_DIR/.env" << ENVEOF
# Twitter API
TWITTER_API_KEY=${TWITTER_API_KEY}
TWITTER_API_SECRET=${TWITTER_API_SECRET}
TWITTER_ACCESS_TOKEN=${TWITTER_ACCESS_TOKEN}
TWITTER_ACCESS_SECRET=${TWITTER_ACCESS_SECRET}
TWITTER_BEARER_TOKEN=${TWITTER_BEARER_TOKEN}

# Anthropic (sensemaking LLM)
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

# Vincent API (reads from existing OpenClaw credentials)
VINCENT_API_URL=https://heyvincent.ai
VINCENT_API_KEY=$(cat /root/.openclaw/credentials/vincentpolymarket/default.json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('apiKey',''))" 2>/dev/null || echo "")

# Polymarket
POLYMARKET_WALLET_ADDRESS=${POLYMARKET_WALLET_ADDRESS}

# Campaign config
CAMPAIGN_BANKROLL=10000
CAMPAIGN_TWITTER_HANDLE=VincentPlays
POLL_INTERVAL_SECONDS=60
DB_PATH=${CAMPAIGN_DIR}/data/campaign.db
ENVEOF
chmod 600 "$CAMPAIGN_DIR/.env"

echo "[6/6] Creating systemd service..."
cat > /etc/systemd/system/vincent-plays-polymarket.service << UNIT
[Unit]
Description=Vincent Plays Polymarket Campaign
After=network.target openclaw-gateway.service
Wants=openclaw-gateway.service

[Service]
Type=simple
ExecStart=/usr/bin/node ${CAMPAIGN_DIR}/dist/index.js
Restart=always
RestartSec=30
WorkingDirectory=${CAMPAIGN_DIR}
Environment=NODE_ENV=production
EnvironmentFile=${CAMPAIGN_DIR}/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable vincent-plays-polymarket
systemctl start vincent-plays-polymarket

echo
echo "============================================"
echo "  Campaign is running!"
echo "============================================"
echo
echo "  Service:  vincent-plays-polymarket"
echo "  Logs:     journalctl -u vincent-plays-polymarket -f"
echo "  Status:   systemctl status vincent-plays-polymarket"
echo "  Data:     ${CAMPAIGN_DIR}/data/campaign.db"
echo
echo "  Twitter:  @VincentPlays"
echo "  Wallet:   ${POLYMARKET_WALLET_ADDRESS}"
echo
