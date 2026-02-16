import { TwitterApi } from "twitter-api-v2";
import type { RawMention } from "../types/index.js";

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
   * Returns parsed RawMention objects.
   */
  async fetchMentions(): Promise<RawMention[]> {
    const me = await this.client.v2.me();
    const userId = me.data.id;

    const params: Record<string, unknown> = {
      "tweet.fields": ["created_at", "public_metrics", "entities", "in_reply_to_user_id"],
      "user.fields": ["public_metrics", "created_at"],
      expansions: ["author_id"],
      max_results: 100,
    };
    if (this.lastSeenId) {
      params.since_id = this.lastSeenId;
    }

    const timeline = await this.client.v2.userMentionTimeline(userId, params as any);

    const mentions: RawMention[] = [];
    const users = new Map(
      (timeline.includes?.users || []).map((u) => [u.id, u])
    );

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
        inReplyToId: (tweet as any).in_reply_to_user_id,
      });
    }

    // Track last seen for pagination
    if (mentions.length > 0) {
      this.lastSeenId = mentions[0].tweetId;
    }

    return mentions;
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
