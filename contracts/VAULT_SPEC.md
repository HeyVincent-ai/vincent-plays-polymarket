# Vault Spec

This spec documents the on-chain vault behavior and the off-chain accounting model.

## Roles
- **Owner**: can update manager and accountant addresses.
- **Manager**: can move assets out for off-chain trading.
- **Accountant**: reports NAV for share pricing.

### Role Mapping
- **Owner**: multisig
- **Manager**: Vincent strategy runner
- **Accountant**: multisig

## Asset
- Polygon mainnet (137): USDC.e (bridged USDC), address `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- Polygon Amoy testnet (80002): USDC (testnet), address `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`
- Base mainnet (8453): USDC (native), address `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Base Sepolia testnet (84532): USDC (testnet), address `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Share Price
- Share price uses `reportedTotalAssets / totalShares`.
- `reportedTotalAssets` is set by the accountant and can include off-chain holdings.

## Deposit Flow
1. User deposits assets.
2. Vault mints shares at the current share price.
3. `reportedTotalAssets` increases by the deposit amount.

## Withdraw Flow
1. User redeems shares.
2. Vault burns shares and transfers assets.
3. `reportedTotalAssets` decreases by the withdrawn amount.
4. Withdraws are capped by on-chain liquidity.

## Off-Chain Trading Flow
1. Manager pulls assets to an off-chain trading wallet.
2. `reportedTotalAssets` stays unchanged.
3. Accountant reports updated total assets after PnL realization.
4. Profits are returned on-chain when available.

## Safety Assumptions
- The system is trust-based and relies on the manager and accountant.
- `reportAssets` cannot under-report below on-chain balance.
- Withdrawals can be rate-limited by liquidity.
