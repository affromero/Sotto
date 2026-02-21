// generation-messages.ts — Rotating sub-messages shown during podcast generation stages

export interface StageMessage {
  text: string;
  topicAware: boolean;
}

export interface StageMessagePool {
  early: StageMessage[];
  late: StageMessage[];
}

const TOPIC_PLACEHOLDER = '{topic}';

export const STAGE_MESSAGES: Partial<Record<string, StageMessagePool>> = {
  EXTRACTING: {
    early: [
      { text: 'Pulling content from your source', topicAware: false },
      { text: 'Reading through the material', topicAware: false },
      { text: 'Scanning for the key ideas', topicAware: false },
      { text: 'Gathering context on {topic}', topicAware: true },
      { text: 'Parsing the source material', topicAware: false },
    ],
    late: [
      { text: 'Longer sources take a bit more time', topicAware: false },
      { text: 'Almost done reading through everything', topicAware: false },
    ],
  },
  SCRIPTING: {
    early: [
      { text: 'Crafting the conversation flow', topicAware: false },
      { text: 'Researching the latest findings on {topic}', topicAware: true },
      { text: 'Building a natural dialogue between hosts', topicAware: false },
      { text: 'Structuring the key takeaways', topicAware: false },
      { text: 'Making sure {topic} is explained clearly', topicAware: true },
      { text: 'Writing engaging back-and-forth dialogue', topicAware: false },
      { text: 'Finding the best way to introduce {topic}', topicAware: true },
      { text: 'Adding interesting examples and analogies', topicAware: false },
      { text: 'Weaving in different perspectives on {topic}', topicAware: true },
      { text: 'Balancing depth with accessibility', topicAware: false },
    ],
    late: [
      { text: 'Complex topics need more thought — hang tight', topicAware: false },
      { text: 'Almost there — good things take time', topicAware: false },
      { text: 'Polishing the final sections of the script', topicAware: false },
      { text: 'Adding finishing touches to the dialogue', topicAware: false },
      { text: 'Wrapping up — just a bit longer', topicAware: false },
    ],
  },
  VERIFYING_SCRIPT: {
    early: [
      { text: 'Checking claims for accuracy', topicAware: false },
      { text: 'Cross-referencing facts about {topic}', topicAware: true },
      { text: 'Making sure everything checks out', topicAware: false },
      { text: 'Running a fact-check pass on the script', topicAware: false },
    ],
    late: [
      { text: 'Thorough verification takes a moment', topicAware: false },
      { text: 'Double-checking a few more claims', topicAware: false },
    ],
  },
  VALIDATING_REFERENCES: {
    early: [
      { text: 'Verifying source quality', topicAware: false },
      { text: 'Checking that references are solid', topicAware: false },
      { text: 'Validating citations and links', topicAware: false },
    ],
    late: [
      { text: 'A few more sources to verify', topicAware: false },
      { text: 'Almost done checking references', topicAware: false },
    ],
  },
  GENERATING_AUDIO: {
    early: [
      { text: 'Recording the host voice', topicAware: false },
      { text: 'Generating audio for each segment', topicAware: false },
      { text: 'Bringing the conversation to life', topicAware: false },
      { text: 'Your podcast about {topic} is taking shape', topicAware: true },
      { text: 'Creating natural-sounding speech', topicAware: false },
      { text: 'Recording the expert voice', topicAware: false },
    ],
    late: [
      { text: 'Longer episodes have more segments to record', topicAware: false },
      { text: 'Recording the final few segments', topicAware: false },
      { text: 'Almost ready — finishing up the last voices', topicAware: false },
    ],
  },
  STITCHING: {
    early: [
      { text: 'Mixing all the audio together', topicAware: false },
      { text: 'Normalizing volume levels', topicAware: false },
      { text: 'Assembling your final podcast', topicAware: false },
    ],
    late: [
      { text: 'Final mixing is almost done', topicAware: false },
    ],
  },
};

/**
 * Replace `{topic}` placeholder with actual topic, truncating to 60 chars.
 * If no topic is provided for a topic-aware message, strips the placeholder.
 */
export function resolveMessage(message: StageMessage, topic?: string): string {
  if (!message.topicAware) return message.text;

  if (!topic) {
    return message.text.replace(` ${TOPIC_PLACEHOLDER}`, '').replace(`${TOPIC_PLACEHOLDER} `, '').replace(TOPIC_PLACEHOLDER, '');
  }

  const truncated = topic.length > 60 ? `${topic.slice(0, 57)}...` : topic;
  return message.text.replace(TOPIC_PLACEHOLDER, truncated);
}
