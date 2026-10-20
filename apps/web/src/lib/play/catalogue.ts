import type { PlayLevel, PlayMode, PlayTheme } from '@sotto/shared';

interface MissionCard {
  scene: string;
  learner: string;
  partner: string;
}
interface Deck {
  describe: readonly [string, string];
  knowMe: readonly [string, string];
  mission: readonly [MissionCard, MissionCard];
}

const decks: Record<PlayTheme, Deck> = {
  EVERYDAY: {
    describe: ['Choose an object you use every morning.', 'Choose something in your kitchen.'],
    knowMe: ['What would you do with a free afternoon?', 'What makes you feel at home?'],
    mission: [
      {
        scene: 'Plan an evening together.',
        learner: 'You want to go outside without spending money.',
        partner: 'You want somewhere quiet where you can sit down.',
      },
      {
        scene: 'You are sharing a home for a week.',
        learner: 'Arrange time to cook while keeping the morning free.',
        partner: 'You need the kitchen free before seven in the evening.',
      },
    ],
  },
  FOOD: {
    describe: [
      'Choose a food you would order again.',
      'Choose an ingredient and describe its taste or texture.',
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
      },
      {
        scene: 'Choose a place for lunch.',
        learner: 'You need somewhere with outdoor seating.',
        partner: 'You have a small budget and need to leave within an hour.',
      },
    ],
  },
  TRAVEL: {
    describe: ['Choose something you pack for a trip.', 'Choose a place you would like to visit.'],
    knowMe: [
      'What would you do first in a new city?',
      'What would you pack that the other player might forget?',
    ],
    mission: [
      {
        scene: 'Plan a day in a city you have never visited.',
        learner: 'You want to see a market and walk between stops.',
        partner: 'You want to visit a museum and need a break at midday.',
      },
      {
        scene: 'Your train has been cancelled. Agree on a new plan.',
        learner: 'You need to arrive before night and would take a bus.',
        partner: 'You have heavy bags and want to avoid changing vehicles.',
      },
    ],
  },
  SILLY: {
    describe: [
      'Choose an animal to be your imaginary flatmate.',
      'Choose an everyday object with a ridiculous new use.',
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
      },
      {
        scene: 'Open a shop that sells something nobody needs.',
        learner: 'Persuade your partner to sell invisible umbrellas.',
        partner: 'Make sure the shop offers a convincing demonstration.',
      },
    ],
  },
  GET_TO_KNOW_YOU: {
    describe: [
      'Choose an object connected to a happy memory.',
      'Choose an activity you could teach your partner.',
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
      },
      {
        scene: 'Plan a small celebration.',
        learner: 'You want to include something homemade.',
        partner: 'You want to invite one friend and keep the plan a surprise.',
      },
    ],
  },
  AFFECTIONATE: {
    describe: [
      'Choose a place that means something to the two of you.',
      'Choose a small gesture that makes you feel cared for.',
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
      },
      {
        scene: 'Plan a thoughtful gift without buying anything.',
        learner: 'You want the gift to include a shared memory.',
        partner: 'You want it to be something you can enjoy together.',
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
  if (mode === 'DESCRIBE') return { prompt: deck.describe[index], objectives: null };
  if (mode === 'KNOW_ME') return { prompt: deck.knowMe[index], objectives: null };
  const mission = deck.mission[index];
  return {
    prompt: mission.scene,
    objectives: { learner: mission.learner, partner: mission.partner },
  };
}
