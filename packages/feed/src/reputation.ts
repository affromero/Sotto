/** Input for creator reputation scoring (TweepCred analog). */
export interface CreatorReputationInput {
  followerCount: number;
  totalPodcasts: number;
  avgCompletionRate: number;
  avgQualityScore: number;
  verifiedReferenceRate: number;
  accountAgeDays: number;
  totalListeners: number;
}

/**
 * Compute a creator reputation score (0-100).
 * Inspired by Twitter's TweepCred — weighted composite of engagement quality,
 * output consistency, and audience trust signals.
 */
export function computeCreatorReputation(input: CreatorReputationInput): number {
  const {
    followerCount,
    totalPodcasts,
    avgCompletionRate,
    avgQualityScore,
    verifiedReferenceRate,
    accountAgeDays,
    totalListeners,
  } = input;

  // Audience reach (0-20): log-scaled followers, capped at 10k
  const audienceScore = Math.min(20, (Math.log10(Math.max(1, followerCount)) / 4) * 20);

  // Consistency (0-20): regular publishing, capped at 50 podcasts
  const consistencyScore = Math.min(20, (Math.min(totalPodcasts, 50) / 50) * 20);

  // Engagement quality (0-25): avg completion rate
  const engagementScore = (Math.min(avgCompletionRate, 100) / 100) * 25;

  // Content quality (0-20): quality score from ML signals
  const contentScore = Math.min(avgQualityScore, 1) * 20;

  // Trust (0-10): verified reference rate
  const trustScore = Math.min(verifiedReferenceRate, 1) * 10;

  // Tenure bonus (0-5): accounts older than 30 days get bonus, max at 365 days
  const tenureScore = Math.min(5, (Math.min(accountAgeDays, 365) / 365) * 5);

  // Listener-to-follower ratio acts as a penalty for inflated followers
  const listenerRatio = followerCount > 0 ? totalListeners / followerCount : 1;
  const inflationPenalty = listenerRatio < 0.01 ? 0.5 : 1;

  const raw =
    (audienceScore + consistencyScore + engagementScore + contentScore + trustScore + tenureScore) *
    inflationPenalty;

  return Math.max(0, Math.min(100, Math.round(raw)));
}
