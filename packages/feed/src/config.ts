/** Feed configuration with sensible defaults. */
export interface FeedConfig {
  confidenceThreshold: number;
  maxPicks: number;
  maxPerCreator: number;
  maxPerPrimaryTag: number;
  continueLearningSlots: number;
  freshPerspectiveSlots: number;
  fromYourPeopleSlots: number;
  freshnessDecayDays: number;
  coldStartListenerThreshold: number;
  coldStartBonus: number;
  siblingMatchWeight: number;
}

export const DEFAULT_FEED_CONFIG: FeedConfig = {
  confidenceThreshold: 0.45,
  maxPicks: 7,
  maxPerCreator: 1,
  maxPerPrimaryTag: 2,
  continueLearningSlots: 3,
  freshPerspectiveSlots: 2,
  fromYourPeopleSlots: 2,
  freshnessDecayDays: 30,
  coldStartListenerThreshold: 10,
  coldStartBonus: 0.2,
  siblingMatchWeight: 0.4,
};
