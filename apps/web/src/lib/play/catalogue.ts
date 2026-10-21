import type { PlayLevel, PlayMode, PlayTheme } from '@sotto/shared';

interface MissionCard {
  scene: string;
  learner: string;
  partner: string;
  twist: string;
}
interface Deck {
  describe: readonly [string, string];
  knowMe: readonly [string, string];
  mission: readonly [MissionCard, MissionCard];
}

const decks: Record<PlayTheme, Deck> = {
  EVERYDAY: {
    describe: ['Pick a secret everyday word.', 'Choose an everyday word or phrase to describe.'],
    knowMe: ['What would you do with a free afternoon?', 'What makes you feel at home?'],
    mission: [
      {
        scene: 'Plan an evening together.',
        learner: 'You want to go outside without spending money.',
        partner: 'You want somewhere quiet where you can sit down.',
        twist: 'A friend wants to join. Include them in the plan.',
      },
      {
        scene: 'You are sharing a home for a week.',
        learner: 'Arrange time to cook while keeping the morning free.',
        partner: 'You need the kitchen free before seven in the evening.',
        twist: 'There is only one pan. Adjust the plan.',
      },
    ],
  },
  FOOD: {
    describe: [
      'Pick a secret food or drink.',
      'Choose a food word and describe its taste or texture.',
    ],
    knowMe: [
      'What meal would you choose after a long day?',
      'What food would you like the other player to try?',
    ],
    mission: [
      {
        scene: 'Agree on dinner for tonight.',
        learner: 'You want a warm meal and have only twenty minutes.',
        partner: 'You want vegetables and want to avoid using the oven.',
        twist: 'There is enough for one extra person. Invite someone to dinner.',
      },
      {
        scene: 'Choose a place for lunch.',
        learner: 'You need somewhere with outdoor seating.',
        partner: 'You have a small budget and need to leave within an hour.',
        twist: 'One of you forgot your wallet. Find a solution together.',
      },
    ],
  },
  TRAVEL: {
    describe: ['Pick a secret travel word.', 'Choose something connected to a journey.'],
    knowMe: [
      'What would you do first in a new city?',
      'What would you pack that the other player might forget?',
    ],
    mission: [
      {
        scene: 'Plan a day in a city you have never visited.',
        learner: 'You want to see a market and walk between stops.',
        partner: 'You want to visit a museum and need a break at midday.',
        twist: 'It starts raining. Keep both objectives in your new plan.',
      },
      {
        scene: 'Your train has been cancelled. Agree on a new plan.',
        learner: 'You need to arrive before night and would take a bus.',
        partner: 'You have heavy bags and want to avoid changing vehicles.',
        twist: 'Your phone battery is almost empty. Agree on one next step.',
      },
    ],
  },
  SILLY: {
    describe: [
      'Pick a secret creature or character.',
      'Describe a strange character without naming it.',
    ],
    knowMe: [
      'What unlikely superpower would you choose?',
      'What excuse would you give for being late to a meeting on the moon?',
    ],
    mission: [
      {
        scene: 'You are planning a party for a very demanding pigeon.',
        learner: 'Persuade your partner to hold the party on a balcony.',
        partner: 'Make sure there is music and absolutely no bread.',
        twist: 'The pigeon brings a penguin. Make it feel welcome.',
      },
      {
        scene: 'Open a shop that sells something nobody needs.',
        learner: 'Persuade your partner to sell invisible umbrellas.',
        partner: 'Make sure the shop offers a convincing demonstration.',
        twist: 'Your first customer is a dragon. Make a convincing sales pitch.',
      },
    ],
  },
  GET_TO_KNOW_YOU: {
    describe: [
      'Pick a secret word connected to a hobby.',
      'Choose something creative to describe.',
    ],
    knowMe: [
      'What small achievement would you like to celebrate?',
      'What would you like to learn besides a language?',
    ],
    mission: [
      {
        scene: 'Choose a new hobby to try together.',
        learner: 'You want to make something with your hands.',
        partner: 'You want to spend time outside and avoid buying equipment.',
        twist: 'You have just half an hour. Decide how to begin.',
      },
      {
        scene: 'Plan a small celebration.',
        learner: 'You want to include something homemade.',
        partner: 'You want to invite one friend and keep the plan a surprise.',
        twist: 'The friend can only join by phone. Include them anyway.',
      },
    ],
  },
  AFFECTIONATE: {
    describe: [
      'Pick a secret word connected to affection.',
      'Choose something thoughtful to describe.',
    ],
    knowMe: [
      'What would you choose for a surprise date?',
      'What little thing would make you smile today?',
    ],
    mission: [
      {
        scene: 'Plan a date for a rainy day.',
        learner: 'You want to make something together at home.',
        partner: 'You want a moment that feels like a surprise.',
        twist: 'The electricity goes out. Keep the date going.',
      },
      {
        scene: 'Plan a thoughtful gift without buying anything.',
        learner: 'You want the gift to include a shared memory.',
        partner: 'You want it to be something you can enjoy together.',
        twist: 'You can only use things already in the room.',
      },
    ],
  },
};

export function playGuidance(level: PlayLevel): string {
  if (level === 'A1' || level === 'A2')
    return 'Use a short sentence. Ask your partner for a word or a hint when you need one.';
  if (level === 'B1' || level === 'B2')
    return 'Add a reason or a follow-up question. Your partner can suggest a natural expression.';
  return 'Try a precise expression, an unusual detail, or a playful constraint. Explain your choices.';
}

export function playCard(theme: PlayTheme, mode: PlayMode, variation: number) {
  const deck = decks[theme];
  const index = variation % 2 === 0 ? 0 : 1;
  if (mode === 'DESCRIBE') return { prompt: deck.describe[index], objectives: null, twist: null };
  if (mode === 'KNOW_ME') return { prompt: deck.knowMe[index], objectives: null, twist: null };
  const mission = deck.mission[index];
  return {
    prompt: mission.scene,
    twist: mission.twist,
    objectives: { learner: mission.learner, partner: mission.partner },
  };
}
