# Contracts

This folder contains the on-chain vault contracts for the campaign.

## Status
- The vault is **trust-based** and uses **off-chain accounting**.
- A designated accountant reports NAV via `reportAssets`.
- Withdrawals are limited by on-chain liquidity.

## Role Mapping
- **Owner**: multisig
- **Manager**: Vincent strategy runner
- **Accountant**: multisig

## Asset
- **USDC.e (bridged USDC) on Polygon**
- Address: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- Chain ID: `137`

## Contracts
- `VincentVault.sol`: ERC-4626 vault with a manager + accountant role and a reported NAV.

## Build (Foundry)
1. Install Foundry: https://book.getfoundry.sh/getting-started/installation
2. Install deps:
   - `forge install OpenZeppelin/openzeppelin-contracts`
   - `forge install foundry-rs/forge-std`
3. From this folder:
   - `forge build`
   - `forge test`

## Assumptions
- The manager may move assets off-chain for trading.
- The accountant reports total assets (including off-chain holdings).
- This is not trust-minimized. Users rely on the accountant and manager.
