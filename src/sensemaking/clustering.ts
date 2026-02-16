import Anthropic from "@anthropic-ai/sdk";
import type { EnrichedSignal, TopicCluster } from "../types/index.js";
import { recencyMultiplier } from "../utils/weight.js";
import { generateId } from "../utils/id.js";

const CLUSTERING_PROMPT = `You are a topic clustering engine. Given a list of signals (each with topics and core claims), group them into coherent topic clusters.

Each cluster should represent a distinct narrative, event, or theme that multiple signals are pointing at.

Respond with JSON only (no markdown fencing):
{
  "clusters": [
    {
      "name": "Short descriptive name for the cluster",
      "signal_indices": [0, 2, 5],
      "sentiment_direction": "bullish" | "bearish" | "hawkish" | "dovish" | "positive" | "negative" | "mixed",
      "sentiment_confidence": 0.0-1.0
    }
  ]
}

Rules:
- A signal can belong to at most one cluster
- Noise signals or signals that don't fit anywhere should be excluded
- Minimum 2 signals to form a cluster
- Cluster names should be specific: "Fed hawkish rhetoric intensifying" not "economy"
- Sentiment confidence reflects how aligned the signals are (1.0 = all agree, 0.5 = mixed)`;

export class TopicClusterer {
  private anthropic: Anthropic;

  constructor(anthropicApiKey: string) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
  }

  /**
   * Cluster a batch of enriched signals into topic groups.
   */
  async clusterSignals(signals: EnrichedSignal[]): Promise<TopicCluster[]> {
    if (signals.length < 2) return [];

    const signalSummaries = signals.map((s, i) => ({
      index: i,
      claim: s.coreClaim,
      topics: s.topics,
      type: s.signalType,
      urgency: s.urgency,
      weight: s.weight,
      handle: s.raw.user.handle,
    }));

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: `Cluster these ${signals.length} signals:\n\n${JSON.stringify(signalSummaries, null, 2)}`,
        },
      ],
      system: CLUSTERING_PROMPT,
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const parsed = JSON.parse(text);
    const now = new Date();

    return (parsed.clusters || []).map((c: any) => {
      const clusterSignals = (c.signal_indices || [])
        .filter((i: number) => i < signals.length)
        .map((i: number) => signals[i]);

      const totalEngagement = clusterSignals.reduce(
        (sum: number, s: EnrichedSignal) => {
          const e = s.raw.engagement;
          return sum + e.likes + e.retweets + e.replies + e.quoteTweets;
        },
        0
      );

      const timestamps = clusterSignals.map((s: EnrichedSignal) => s.raw.timestamp);

      return {
        id: generateId("clst"),
        name: c.name,
        signals: clusterSignals,
        signalCount: clusterSignals.length,
        avgEngagement: clusterSignals.length > 0 ? totalEngagement / clusterSignals.length : 0,
        sentiment: {
          direction: c.sentiment_direction,
          confidence: c.sentiment_confidence,
        },
        firstSeenAt: timestamps.length > 0 ? new Date(Math.min(...timestamps.map((t: Date) => t.getTime()))) : now,
        lastUpdatedAt: now,
      } satisfies TopicCluster;
    });
  }

  /**
   * Calculate the aggregate weight of a cluster, incorporating recency.
   */
  clusterWeight(cluster: TopicCluster): number {
    const now = new Date();
    return cluster.signals.reduce((sum, signal) => {
      return sum + signal.weight * recencyMultiplier(signal.raw.timestamp, now);
    }, 0);
  }
}
