# Vault Integration Plan

This document describes how the agent and accountant interact with the vault.

## Weekly Accounting (Epoch)
- Cutoff: Wednesday 10:00 PM PT (America/Los_Angeles).
- Use realized PnL only.
- See `/Users/davidsneider/Desktop/claud/vincent-plays-polymarket/ECONOMICS.md` for fee splits.

## Role Mapping
- **Owner**: multisig
- **Manager**: Vincent strategy runner
- **Accountant**: multisig

## Asset
- Polygon mainnet (137): USDC.e (bridged USDC), address `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- Polygon Amoy testnet (80002): USDC (testnet), address `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`
- Base mainnet (8453): USDC (native), address `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Base Sepolia testnet (84532): USDC (testnet), address `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Operational Steps (Weekly)
1. Snapshot on-chain vault balances and total share supply at cutoff.
2. Aggregate realized PnL from the trading wallet(s).
3. Compute NAV = on-chain assets + off-chain holdings.
4. Call `reportAssets(NAV)` from the accountant address.
5. Compute performance fee using the high-water mark.
6. Split fee 50% to tip pool and 50% to manager.
7. Distribute tip pool off-chain.
8. Publish a weekly report with NAV, PnL, fee, and tip payouts.

## Manager Funding Flow
1. Manager pulls assets from the vault using `pullToManager`.
2. Trades are executed off-chain.
3. Profits are returned to the vault when available.
4. Accountant updates NAV via `reportAssets`.

## Data Needed by the Agent
- Weekly NAV and HWM value.
- List of trades and realized PnL.
- Tip attribution scores (TBD).
