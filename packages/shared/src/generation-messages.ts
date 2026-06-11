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
  RESEARCHING: {
    early: [
      { text: 'Searching for the best sources on {topic}', topicAware: true },
      { text: 'Finding peer-reviewed research and expert perspectives', topicAware: false },
      { text: 'A real lesson starts with real research', topicAware: false },
      { text: 'Digging into what the experts say about {topic}', topicAware: true },
      { text: 'No hallucinated sources — only verified ones', topicAware: false },
    ],
    late: [
      { text: 'Cross-referencing sources for accuracy', topicAware: false },
      { text: 'Building a knowledge dossier for your hosts', topicAware: false },
      { text: 'Most AI skips this. We don\u2019t.', topicAware: false },
    ],
  },
  PLANNING: {
    early: [
      { text: 'Choosing the best angle for {topic}', topicAware: true },
      { text: 'Designing the narrative arc', topicAware: false },
      { text: 'Finding the hook that pulls listeners in', topicAware: false },
      { text: 'Crafting the story structure', topicAware: false },
    ],
    late: [
      { text: 'Mapping the tension curve beat by beat', topicAware: false },
      { text: 'Assigning sources to each story beat', topicAware: false },
      { text: 'Every great lesson starts with a great plan', topicAware: false },
    ],
  },
  SCRIPTING: {
    early: [
      { text: 'Writing dialogue grounded in verified research', topicAware: false },
      { text: 'Building a natural conversation between hosts', topicAware: false },
      { text: 'Making sure {topic} is explained clearly', topicAware: true },
      { text: 'Turning research into engaging back-and-forth', topicAware: false },
      { text: 'Adding interesting examples and analogies', topicAware: false },
      { text: 'Weaving in different perspectives on {topic}', topicAware: true },
    ],
    late: [
      { text: 'Complex topics need more thought — hang tight', topicAware: false },
      { text: 'Polishing the final sections of the script', topicAware: false },
      { text: 'Adding finishing touches to the dialogue', topicAware: false },
    ],
  },
  COMPILING: {
    early: [
      { text: 'Connecting citations to verified sources', topicAware: false },
      { text: 'Final quality check on every reference', topicAware: false },
    ],
    late: [
      { text: 'Almost there — verifying every citation', topicAware: false },
    ],
  },
  GENERATING_AUDIO: {
    early: [
      { text: 'Recording the host voice', topicAware: false },
      { text: 'Generating audio for each segment', topicAware: false },
      { text: 'Bringing the conversation to life', topicAware: false },
      { text: 'Your lesson about {topic} is taking shape', topicAware: true },
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
      { text: 'Assembling your final audio lesson', topicAware: false },
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
