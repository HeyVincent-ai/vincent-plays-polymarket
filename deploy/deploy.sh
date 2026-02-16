#!/bin/bash
# ============================================================
# Vincent Plays Polymarket — Deploy to OpenClaw VPS
# ============================================================
#
# Uploads the campaign code to an OpenClaw VPS and runs setup.
#
# Usage:
#   export VPS_HOST="vps-xxxx.vps.ovh.us"
#   export VPS_KEY="/path/to/openclaw-ssh.pem"
#   export TWITTER_API_KEY="..."
#   export TWITTER_API_SECRET="..."
#   export TWITTER_ACCESS_TOKEN="..."
#   export TWITTER_ACCESS_SECRET="..."
#   export TWITTER_BEARER_TOKEN="..."
#   export ANTHROPIC_API_KEY="..."
#   export POLYMARKET_WALLET_ADDRESS="0x..."
#   bash deploy/deploy.sh
#
# ============================================================

set -euo pipefail

VPS_HOST="${VPS_HOST:?Set VPS_HOST to your OpenClaw VPS hostname}"
VPS_KEY="${VPS_KEY:?Set VPS_KEY to your SSH private key path}"
VPS_USER="${VPS_USER:-debian}"

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "============================================"
echo "  Deploying Vincent Plays Polymarket"
echo "  Target: ${VPS_USER}@${VPS_HOST}"
echo "============================================"
echo

# Build locally first
echo "[1/4] Building project locally..."
cd "$PROJECT_DIR"
npm ci
npx tsc

# Upload to VPS
echo "[2/4] Uploading to VPS..."
ssh -i "$VPS_KEY" -o StrictHostKeyChecking=no "${VPS_USER}@${VPS_HOST}" \
  "sudo rm -rf /tmp/vincent-plays-polymarket && sudo mkdir -p /tmp/vincent-plays-polymarket"

rsync -avz --exclude node_modules --exclude .git --exclude data \
  -e "ssh -i $VPS_KEY -o StrictHostKeyChecking=no" \
  "$PROJECT_DIR/" "${VPS_USER}@${VPS_HOST}:/tmp/vincent-plays-polymarket/"

# Upload env vars and run setup
echo "[3/4] Running setup on VPS..."
ssh -i "$VPS_KEY" -o StrictHostKeyChecking=no "${VPS_USER}@${VPS_HOST}" \
  "sudo TWITTER_API_KEY='${TWITTER_API_KEY}' \
   TWITTER_API_SECRET='${TWITTER_API_SECRET}' \
   TWITTER_ACCESS_TOKEN='${TWITTER_ACCESS_TOKEN}' \
   TWITTER_ACCESS_SECRET='${TWITTER_ACCESS_SECRET}' \
   TWITTER_BEARER_TOKEN='${TWITTER_BEARER_TOKEN}' \
   ANTHROPIC_API_KEY='${ANTHROPIC_API_KEY}' \
   POLYMARKET_WALLET_ADDRESS='${POLYMARKET_WALLET_ADDRESS}' \
   bash /tmp/vincent-plays-polymarket/deploy/setup.sh"

echo "[4/4] Verifying..."
sleep 5
ssh -i "$VPS_KEY" -o StrictHostKeyChecking=no "${VPS_USER}@${VPS_HOST}" \
  "sudo systemctl status vincent-plays-polymarket --no-pager"

echo
echo "============================================"
echo "  Deployment complete!"
echo "  Logs: ssh -i $VPS_KEY ${VPS_USER}@${VPS_HOST} 'sudo journalctl -u vincent-plays-polymarket -f'"
echo "============================================"
