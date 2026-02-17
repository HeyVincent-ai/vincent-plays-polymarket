export { getDb, closeDb, getCampaignState, setCampaignState } from "./db.js";
export {
  saveSignal,
  getRecentSignals,
  getSignalCountToday,
  getUserSignalCountToday,
  updateContributor,
  attributeTradeToContributors,
  attributeProfitToContributors,
  getTopContributors,
} from "./signals.js";
export { saveTrade, getOpenTrades, closeTrade, getTradeStats } from "./trades.js";
