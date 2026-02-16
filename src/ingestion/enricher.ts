import Anthropic from "@anthropic-ai/sdk";
import type { RawMention, EnrichedSignal, SignalType, Urgency, CampaignConfig } from "../types/index.js";
import { engagementWeight } from "../utils/weight.js";
import { generateId } from "../utils/id.js";

const ENRICHMENT_PROMPT = `You are an AI signal analyst for a prediction market trading campaign.
Given a tweet that tagged @VincentPlays, extract structured signal information.

The tweet may contain: breaking news, data points, rumors, sentiment/vibes, on-chain observations,
direct market references, or just noise. Your job is to classify and extract the core claim.

Respond with JSON only (no markdown fencing):
{
  "signal_type": "news" | "data" | "rumor" | "sentiment" | "onchain" | "market_pointer" | "noise",
  "core_claim": "One sentence summarizing what this person is telling us. What happened or might happen?",
  "urgency": "breaking" | "developing" | "slow",
  "topics": ["topic1", "topic2"],
  "is_noise": false
}

Rules:
- "noise" = greetings, spam, questions about how the bot works, unrelated content
- "breaking" = something that just happened or is happening now
- "developing" = a trend or narrative that's forming
- "slow" = background context, general sentiment
- Topics should be short labels like "Fed policy", "ETH price", "US elections", "BTC halving"
- core_claim should be factual and extractive, not your opinion`;

export class SignalEnricher {
  private anthropic: Anthropic;
  private config: CampaignConfig;

  constructor(anthropicApiKey: string, config: CampaignConfig) {
    this.anthropic = new Anthropic({ apiKey: anthropicApiKey });
    this.config = config;
  }

  /**
   * Filter out mentions that don't meet minimum requirements.
   */
  filterMentions(mentions: RawMention[]): RawMention[] {
    return mentions.filter((m) => {
      if (m.user.accountAgeDays < this.config.minAccountAgeDays) return false;
      if (m.user.followers < this.config.minFollowers) return false;
      return true;
    });
  }

  /**
   * Enrich a single mention into a structured signal via LLM.
   */
  async enrichMention(mention: RawMention): Promise<EnrichedSignal | null> {
    try {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `Tweet from @${mention.user.handle} (${mention.user.followers} followers):\n"${mention.text}"\n\nURLs in tweet: ${mention.urls.join(", ") || "none"}`,
          },
        ],
        system: ENRICHMENT_PROMPT,
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const parsed = JSON.parse(text);

      if (parsed.is_noise || parsed.signal_type === "noise") {
        return null;
      }

      const weight = engagementWeight({
        likes: mention.engagement.likes,
        retweets: mention.engagement.retweets,
        quoteTweets: mention.engagement.quoteTweets,
      });

      return {
        id: generateId("sig"),
        raw: mention,
        signalType: parsed.signal_type as SignalType,
        coreClaim: parsed.core_claim,
        urgency: parsed.urgency as Urgency,
        topics: parsed.topics || [],
        corroboration: [],
        weight,
        processedAt: new Date(),
      };
    } catch (err) {
      console.error(`Failed to enrich mention ${mention.tweetId}:`, err);
      return null;
    }
  }

  /**
   * Enrich a batch of mentions. Filters first, then enriches in parallel (with concurrency limit).
   */
  async enrichBatch(mentions: RawMention[]): Promise<EnrichedSignal[]> {
    const filtered = this.filterMentions(mentions);
    const results: EnrichedSignal[] = [];

    // Process in chunks of 5 to avoid rate limits
    const chunkSize = 5;
    for (let i = 0; i < filtered.length; i += chunkSize) {
      const chunk = filtered.slice(i, i + chunkSize);
      const enriched = await Promise.all(
        chunk.map((m) => this.enrichMention(m))
      );
      for (const signal of enriched) {
        if (signal) results.push(signal);
      }
    }

    return results;
  }
}
