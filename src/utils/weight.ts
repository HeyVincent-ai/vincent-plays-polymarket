/**
 * Calculate engagement weight for a signal.
 * weight = 1 + log2(1 + likes + 2*retweets + 3*quoteTweets)
 */
export function engagementWeight(engagement: {
  likes: number;
  retweets: number;
  quoteTweets: number;
}): number {
  const raw =
    engagement.likes +
    2 * engagement.retweets +
    3 * engagement.quoteTweets;
  return 1 + Math.log2(1 + raw);
}

/**
 * Apply recency decay. Signals in the last 2 hours get 2x,
 * linearly decaying to 1x at 24 hours, and 0.5x beyond.
 */
export function recencyMultiplier(signalTime: Date, now: Date = new Date()): number {
  const hoursAgo = (now.getTime() - signalTime.getTime()) / (1000 * 60 * 60);
  if (hoursAgo <= 2) return 2.0;
  if (hoursAgo <= 24) return 2.0 - (hoursAgo - 2) / 22; // linear 2.0 → 1.0
  return 0.5;
}
