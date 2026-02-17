import Anthropic from "@anthropic-ai/sdk";
import type { RawMention, EnrichedSignal, SignalType, Urgency, CampaignConfig } from "../types/index.js";
import { engagementWeight } from "../utils/weight.js";
import { generateId } from "../utils/id.js";
import { safeParseLLMJson } from "../utils/parse.js";

const ENRICHMENT_PROMPT = `You are an AI signal analyst for a prediction market trading campaign.

You receive tweets that tag @VincentPlays. Users tag Vincent to point it at information —
news, data, rumors, vibes, on-chain moves. Sometimes the user replies to another tweet
and tags Vincent, meaning "look at THIS conversation." Sometimes they quote-tweet something
and tag Vincent, meaning "pay attention to what this person said."

CRITICAL: When conversation context or a quoted tweet is provided, the REAL signal is
usually in the parent/quoted tweet, not the reply that tagged you. The reply is just
the user saying "hey Vincent, look at this." Extract the signal from the FULL context,
not just the tagging tweet.

Respond with JSON only (no markdown fencing):
{
  "signal_type": "news" | "data" | "rumor" | "sentiment" | "onchain" | "market_pointer" | "noise",
  "core_claim": "One sentence summarizing the actual signal. What happened or might happen? Synthesize from the full conversation context.",
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
- core_claim should synthesize the signal from ALL available context (parent tweets, quoted tweet, reply, URLs)
- If someone replies "@VincentPlays check this out" to a tweet about ETH crashing, the core_claim is about ETH crashing, not about someone saying "check this out"`;

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
   * Build the full context string for the LLM, including conversation
   * chain and quoted tweets so the model sees what the user is pointing at.
   */
  private buildContextString(mention: RawMention): string {
    const parts: string[] = [];

    // Conversation context (parent tweets in the reply chain)
    if (mention.conversationContext.length > 0) {
      parts.push("=== CONVERSATION CONTEXT (parent tweets, oldest first) ===");
      for (const parent of mention.conversationContext) {
        const engagement = `${parent.engagement.likes} likes, ${parent.engagement.retweets} RTs`;
        parts.push(
          `@${parent.authorHandle} (${parent.authorFollowers} followers, ${engagement}):\n"${parent.text}"`
        );
        if (parent.urls.length > 0) {
          parts.push(`URLs: ${parent.urls.join(", ")}`);
        }
        parts.push("");
      }
    }

    // Quoted tweet
    if (mention.quotedTweet) {
      const qt = mention.quotedTweet;
      const engagement = `${qt.engagement.likes} likes, ${qt.engagement.retweets} RTs`;
      parts.push("=== QUOTED TWEET ===");
      parts.push(
        `@${qt.authorHandle} (${qt.authorFollowers} followers, ${engagement}):\n"${qt.text}"`
      );
      if (qt.urls.length > 0) {
        parts.push(`URLs: ${qt.urls.join(", ")}`);
      }
      parts.push("");
    }

    // The tagging tweet itself
    parts.push("=== TAGGING TWEET (the mention that tagged @VincentPlays) ===");
    parts.push(
      `@${mention.user.handle} (${mention.user.followers} followers):\n"${mention.text}"`
    );
    if (mention.urls.length > 0) {
      parts.push(`URLs: ${mention.urls.join(", ")}`);
    }

    // Indicate if this is a reply or quote tweet
    if (mention.conversationContext.length > 0 && mention.quotedTweet) {
      parts.push(
        "\nNote: This user replied in a conversation AND quoted a tweet while tagging Vincent. Synthesize signal from all context."
      );
    } else if (mention.conversationContext.length > 0) {
      parts.push(
        "\nNote: This user replied to a conversation and tagged Vincent. The signal is likely in the parent tweet(s), not just the reply."
      );
    } else if (mention.quotedTweet) {
      parts.push(
        "\nNote: This user quote-tweeted someone and tagged Vincent. The signal is likely in the quoted tweet."
      );
    }

    return parts.join("\n");
  }

  /**
   * Enrich a single mention into a structured signal via LLM.
   * Passes the full conversation context so the model understands
   * what the user is actually pointing at.
   */
  async enrichMention(mention: RawMention): Promise<EnrichedSignal | null> {
    try {
      const contextString = this.buildContextString(mention);

      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: contextString,
          },
        ],
        system: ENRICHMENT_PROMPT,
      });

      const text = response.content[0].type === "text" ? response.content[0].text : "";
      const parsed: any = safeParseLLMJson(text, { is_noise: true, signal_type: "noise" }, "Enricher");

      if (parsed.is_noise || parsed.signal_type === "noise") {
        return null;
      }

      // Weight includes engagement from the tagging tweet AND the parent context
      // If someone replies to a viral tweet, the parent's engagement matters
      const parentEngagement = mention.conversationContext.length > 0
        ? mention.conversationContext[mention.conversationContext.length - 1].engagement
        : undefined;
      const quotedEngagement = mention.quotedTweet?.engagement;

      // Use the highest engagement source as the weight basis
      const engagementSources = [
        mention.engagement,
        parentEngagement,
        quotedEngagement,
      ].filter(Boolean) as Array<{ likes: number; retweets: number; quoteTweets: number }>;

      const bestEngagement = engagementSources.reduce((best, e) => {
        const score = e.likes + 2 * e.retweets + 3 * (e.quoteTweets || 0);
        const bestScore = best.likes + 2 * best.retweets + 3 * (best.quoteTweets || 0);
        return score > bestScore ? e : best;
      });

      const weight = engagementWeight(bestEngagement);

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
