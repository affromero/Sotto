import { blockedProviderExecution } from '../../../../helpers/runtime/provider-execution';

export const params = {
  userId: 'fixture',
  execution: blockedProviderExecution('fixture'),
  level: 'A2',
  nativeLang: 'en',
  targetLang: 'de',
  title: 'Travel',
  objective: 'Describe a short trip',
  grammarPoints: ['past events'],
  targetVocab: [],
};
export const intro = {
  purpose: 'Describe a trip',
  about: 'Use past events',
  focus: ['Describe transport'],
  examples: [
    {
      target: 'Ich bin mit dem Bus gefahren.',
      meaning: 'I went by bus.',
      note: 'Use fahren for travel by bus.',
    },
  ],
  tips: ['Name the transport.'],
};
