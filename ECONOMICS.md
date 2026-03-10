# Economics (Off-Chain Payouts)

This document defines the weekly accounting, fees, and tip payouts for the vault.

## Vault Model
- Vault issues receipt tokens (shares).
- Share price = `totalAssets / totalShares`.
- Profits increase share price; losses decrease it.

## Asset
- Polygon mainnet (137): USDC.e (bridged USDC), address `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`
- Polygon Amoy testnet (80002): USDC (testnet), address `0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582`
- Base mainnet (8453): USDC (native), address `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
- Base Sepolia testnet (84532): USDC (testnet), address `0x036CbD53842c5426634e7929541eC2318f3dCF7e`

## Epoch
- Accounting is performed **weekly**.
- **Cutoff:** Wednesday **10:00 PM PT** (America/Los_Angeles).
  - This is **Thursday 06:00 UTC** during **PST (UTC-8)**.
  - This is **Thursday 05:00 UTC** during **PDT (UTC-7)**.
- Each epoch covers activity after the prior cutoff up to and including the current cutoff.

## Profit Basis
- **Realized PnL only.** Unrealized mark-to-market gains are excluded.
- Deposits and withdrawals are tracked separately and do not count as profit.

## Performance Fee (High-Water Mark)
- **Fee rate:** 10% of realized profits **above the high-water mark (HWM)**.
- **HWM:** highest historical share price observed at an epoch cutoff.
- Profit per share = `max(0, sharePrice_end - HWM)`.
- Total profit = `profitPerShare * totalShares`.
- Performance fee = `10% * totalProfit`.
- After fee assessment, update `HWM = sharePrice_end` if higher.

## Tip Pool
- **Tip pool rate:** 50% of the performance fee.
- Tip pool = `50% * performanceFee`.
- Manager keeps the remaining 50% of the performance fee.
- Tip attribution method is **TBD** and will be defined after observing agent behavior.

## Off-Chain Payout Flow (Weekly)
1. Snapshot vault totals at the cutoff.
2. Compute share price and compare to HWM.
3. Calculate realized profits and performance fee.
4. Split fee into tip pool and manager fee.
5. Distribute tip pool off-chain per the chosen attribution method.
6. Publish a weekly report summarizing NAV, PnL, fee, and tip distribution.

## Notes
- This is a trust-based accounting model managed by the vault accountant.
- Terms may be revised with notice; changes apply only to future epochs.
