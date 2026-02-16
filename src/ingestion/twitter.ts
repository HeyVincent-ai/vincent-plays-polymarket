import { TwitterApi } from "twitter-api-v2";
import type { RawMention, ConversationTweet } from "../types/index.js";

const TWEET_FIELDS = ["created_at", "public_metrics", "entities", "conversation_id", "referenced_tweets"] as const;
const USER_FIELDS = ["public_metrics", "created_at"] as const;
const EXPANSIONS = ["author_id", "referenced_tweets.id", "referenced_tweets.id.author_id"] as const;

/** Max depth to walk up a reply chain */
const MAX_CONTEXT_DEPTH = 5;

export class TwitterClient {
  private client: TwitterApi;
  private handle: string;
  private lastSeenId?: string;

  constructor(config: {
    apiKey: string;
    apiSecret: string;
    accessToken: string;
    accessSecret: string;
    handle: string;
  }) {
    this.client = new TwitterApi({
      appKey: config.apiKey,
      appSecret: config.apiSecret,
      accessToken: config.accessToken,
      accessSecret: config.accessSecret,
    });
    this.handle = config.handle;
  }

  /**
   * Fetch recent @mentions since the last poll.
   * For replies and quote tweets, fetches the conversation context
   * so the enricher sees what the user is actually pointing at.
   */
  async fetchMentions(): Promise<RawMention[]> {
    const me = await this.client.v2.me();
    const userId = me.data.id;

    const params: Record<string, unknown> = {
      "tweet.fields": [...TWEET_FIELDS],
      "user.fields": [...USER_FIELDS],
      expansions: [...EXPANSIONS],
      max_results: 100,
    };
    if (this.lastSeenId) {
      params.since_id = this.lastSeenId;
    }

    const timeline = await this.client.v2.userMentionTimeline(userId, params as any);

    const users = new Map(
      (timeline.includes?.users || []).map((u) => [u.id, u])
    );

    // Build a map of referenced tweets included in the response
    const includedTweets = new Map(
      (timeline.includes?.tweets || []).map((t) => [t.id, t])
    );

    const mentions: RawMention[] = [];

    for (const tweet of timeline.data?.data || []) {
      const author = users.get(tweet.author_id!);
      const metrics = tweet.public_metrics;
      const createdAt = author?.created_at
        ? new Date(author.created_at)
        : new Date();
      const accountAgeDays = Math.floor(
        (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)
      );

      const urls = (tweet.entities?.urls || []).map(
        (u: any) => u.expanded_url || u.url
      );

      // Parse referenced tweets to find reply parent and quoted tweet
      const refs = (tweet as any).referenced_tweets as
        | Array<{ type: string; id: string }>
        | undefined;

      const repliedToRef = refs?.find((r) => r.type === "replied_to");
      const quotedRef = refs?.find((r) => r.type === "quoted");

      // Build quoted tweet context from included data
      let quotedTweet: ConversationTweet | undefined;
      if (quotedRef) {
        const qt = includedTweets.get(quotedRef.id);
        if (qt) {
          const qtAuthor = users.get(qt.author_id!);
          quotedTweet = {
            tweetId: qt.id,
            text: qt.text,
            authorHandle: qtAuthor?.username || "unknown",
            authorFollowers: qtAuthor?.public_metrics?.followers_count || 0,
            urls: (qt.entities?.urls || []).map((u: any) => u.expanded_url || u.url),
            engagement: {
              likes: qt.public_metrics?.like_count || 0,
              retweets: qt.public_metrics?.retweet_count || 0,
              replies: qt.public_metrics?.reply_count || 0,
              quoteTweets: qt.public_metrics?.quote_count || 0,
            },
            timestamp: new Date(qt.created_at!),
          };
        }
      }

      // For replies, walk up the conversation chain to get parent context
      let conversationContext: ConversationTweet[] = [];
      if (repliedToRef) {
        conversationContext = await this.fetchConversationChain(repliedToRef.id);
      }

      mentions.push({
        tweetId: tweet.id,
        text: tweet.text,
        user: {
          id: tweet.author_id!,
          handle: author?.username || "unknown",
          followers: author?.public_metrics?.followers_count || 0,
          accountAgeDays,
        },
        urls,
        engagement: {
          likes: metrics?.like_count || 0,
          retweets: metrics?.retweet_count || 0,
          replies: metrics?.reply_count || 0,
          quoteTweets: metrics?.quote_count || 0,
        },
        timestamp: new Date(tweet.created_at!),
        inReplyToId: repliedToRef?.id,
        conversationContext,
        quotedTweet,
      });
    }

    // Track last seen for pagination
    if (mentions.length > 0) {
      this.lastSeenId = mentions[0].tweetId;
    }

    return mentions;
  }

  /**
   * Walk up a reply chain to fetch parent tweets.
   * Returns tweets ordered root-first → immediate parent last.
   * This gives the enricher the full conversation that the user
   * is replying to, not just their "@VincentPlays look at this" reply.
   */
  private async fetchConversationChain(tweetId: string): Promise<ConversationTweet[]> {
    const chain: ConversationTweet[] = [];
    let currentId: string | undefined = tweetId;

    for (let depth = 0; depth < MAX_CONTEXT_DEPTH && currentId; depth++) {
      try {
        const tweet = await this.client.v2.singleTweet(currentId, {
          "tweet.fields": [...TWEET_FIELDS],
          "user.fields": [...USER_FIELDS],
          expansions: ["author_id"],
        } as any);

        const tweetData = tweet.data;
        const tweetAuthor = tweet.includes?.users?.[0];

        chain.unshift({
          tweetId: tweetData.id,
          text: tweetData.text,
          authorHandle: tweetAuthor?.username || "unknown",
          authorFollowers: tweetAuthor?.public_metrics?.followers_count || 0,
          urls: (tweetData.entities?.urls || []).map((u: any) => u.expanded_url || u.url),
          engagement: {
            likes: tweetData.public_metrics?.like_count || 0,
            retweets: tweetData.public_metrics?.retweet_count || 0,
            replies: tweetData.public_metrics?.reply_count || 0,
            quoteTweets: tweetData.public_metrics?.quote_count || 0,
          },
          timestamp: new Date(tweetData.created_at!),
        });

        // Check if this tweet is also a reply — keep walking up
        const refs = (tweetData as any).referenced_tweets as
          | Array<{ type: string; id: string }>
          | undefined;
        const parentRef = refs?.find((r: any) => r.type === "replied_to");
        currentId = parentRef?.id;
      } catch (err) {
        // Tweet may be deleted, protected, or rate limited — stop walking
        console.warn(`[Twitter] Could not fetch parent tweet ${currentId}, stopping chain walk:`, err);
        break;
      }
    }

    return chain;
  }

  /**
   * Post a tweet or thread.
   */
  async postThread(tweets: string[]): Promise<string[]> {
    const ids: string[] = [];
    let replyToId: string | undefined;

    for (const text of tweets) {
      const params: any = {};
      if (replyToId) {
        params.reply = { in_reply_to_tweet_id: replyToId };
      }
      const result = await this.client.v2.tweet(text, params);
      ids.push(result.data.id);
      replyToId = result.data.id;
    }

    return ids;
  }

  /**
   * Post a single tweet.
   */
  async postTweet(text: string): Promise<string> {
    const result = await this.client.v2.tweet(text);
    return result.data.id;
  }
}
