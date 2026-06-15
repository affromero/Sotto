import { describe, it, expect } from 'vitest';
import { renderWorksheetHtml } from '@/lib/worksheet-html';
import type { ClassDocument } from '@sotto/shared';

function makeDoc(overrides: Partial<ClassDocument> = {}): ClassDocument {
  return {
    classId: 'class-1',
    title: 'German Basics',
    level: 'A1',
    objective: 'Learn greetings',
    nativeLang: 'en',
    targetLang: 'de',
    isAnswerKey: false,
    sections: [
      {
        id: 'section-1',
        skill: 'GRAMMAR',
        title: 'Grammar',
        instructions: 'Choose the correct option.',
        questions: [
          {
            id: 'q-1',
            order: 1,
            question: 'Which is correct?',
            options: ['Ich bin', 'Ich bist', 'Ich ist'],
            passageRef: null,
            passageText: null,
          },
        ],
        prompts: [],
        writingPrompts: [],
        appLink: null,
        qrDataUrl: null,
      },
    ],
    ...overrides,
  };
}

describe('renderWorksheetHtml', () => {
  it('contains the document title', () => {
    const html = renderWorksheetHtml(makeDoc());
    expect(html).toContain('German Basics');
  });

  it('contains the level badge', () => {
    const html = renderWorksheetHtml(makeDoc());
    expect(html).toContain('A1');
  });

  it('contains the objective', () => {
    const html = renderWorksheetHtml(makeDoc());
    expect(html).toContain('Learn greetings');
  });

  it('renders MC question text', () => {
    const html = renderWorksheetHtml(makeDoc());
    expect(html).toContain('Which is correct?');
  });

  it('renders options with □ glyph (unchecked checkbox) for learner worksheet', () => {
    const html = renderWorksheetHtml(makeDoc({ isAnswerKey: false }));
    // &#9744; is the hollow checkbox □
    expect(html).toContain('&#9744;');
  });

  it('marks correct option with ✅ glyph (checked) when isAnswerKey is true', () => {
    const doc = makeDoc({
      isAnswerKey: true,
      sections: [
        {
          id: 'section-1',
          skill: 'GRAMMAR',
          title: 'Grammar',
          instructions: 'Choose the correct option.',
          questions: [
            {
              id: 'q-1',
              order: 1,
              question: 'Which is correct?',
              options: ['Ich bin', 'Ich bist', 'Ich ist'],
              passageRef: null,
              passageText: null,
              correctIndex: 0,
              explanation: 'Ich bin is first person singular.',
            },
          ],
          prompts: [],
          writingPrompts: [],
          appLink: null,
          qrDataUrl: null,
        },
      ],
    });
    const html = renderWorksheetHtml(doc);
    // &#9745; is the checked checkbox ☑
    expect(html).toContain('&#9745;');
    expect(html).toContain('Ich bin is first person singular.');
  });

  it('does NOT mark answers when isAnswerKey is false', () => {
    const doc = makeDoc({ isAnswerKey: false });
    const html = renderWorksheetHtml(doc);
    // &#9745; is only present when answer key marks a correct option
    expect(html).not.toContain('&#9745;');
  });

  it('includes <img> with data URL when qrDataUrl is set', () => {
    const qrDataUrl = 'data:image/png;base64,abc123';
    const doc = makeDoc({
      sections: [
        {
          id: 'section-1',
          skill: 'LISTENING',
          title: 'Listening',
          instructions: 'Listen and answer.',
          questions: [],
          prompts: [],
          writingPrompts: [],
          appLink: 'https://example.com/classes/class-1?section=section-1',
          qrDataUrl,
        },
      ],
    });
    const html = renderWorksheetHtml(doc);
    expect(html).toContain(`src="${qrDataUrl}"`);
    expect(html).toContain('<img');
  });

  it('does NOT include <img> when qrDataUrl is null', () => {
    const html = renderWorksheetHtml(makeDoc());
    expect(html).not.toContain('class="qr-card"');
  });

  it('renders speaking prompts with targetPhrase and translation', () => {
    const doc = makeDoc({
      sections: [
        {
          id: 'section-s',
          skill: 'SPEAKING',
          title: 'Speaking',
          instructions: 'Say each phrase.',
          questions: [],
          prompts: [
            {
              id: 'p-1',
              order: 1,
              targetPhrase: 'Guten Morgen',
              translation: 'Good morning',
              ipa: 'ˈɡuːtən ˈmɔʁɡən',
            },
          ],
          writingPrompts: [],
          appLink: null,
          qrDataUrl: null,
        },
      ],
    });
    const html = renderWorksheetHtml(doc);
    expect(html).toContain('Guten Morgen');
    expect(html).toContain('Good morning');
    expect(html).toContain('ˈɡuːtən ˈmɔʁɡən');
  });

  it('renders reading passage text for Pencil annotation', () => {
    const doc = makeDoc({
      sections: [
        {
          id: 'section-reading',
          skill: 'READING',
          title: 'Reading',
          instructions: 'Read and answer.',
          questions: [
            {
              id: 'q-reading',
              order: 1,
              question: 'What does the speaker want?',
              options: ['Coffee', 'Tea'],
              passageRef: 'Passage 1',
              passageText: 'Ich mochte einen Kaffee.\nDanke schon.',
            },
          ],
          prompts: [],
          writingPrompts: [],
          appLink: null,
          qrDataUrl: null,
        },
      ],
    });
    const html = renderWorksheetHtml(doc);
    expect(html).toContain('Passage 1');
    expect(html).toContain('Ich mochte einen Kaffee.<br />Danke schon.');
  });

  it('renders writing prompts with ruled writing space', () => {
    const doc = makeDoc({
      sections: [
        {
          id: 'section-writing',
          skill: 'WRITING',
          title: 'Writing',
          instructions: 'Write a response.',
          questions: [],
          prompts: [],
          writingPrompts: [
            { id: 'w-1', order: 1, task: 'Write a greeting.', guidance: 'Use two sentences.' },
          ],
          appLink: null,
          qrDataUrl: null,
        },
      ],
    });
    const html = renderWorksheetHtml(doc);
    expect(html).toContain('Write a greeting.');
    expect(html).toContain('Use two sentences.');
    expect(html).toContain('class="writing-space"');
  });

  it('returns a valid HTML document with DOCTYPE', () => {
    const html = renderWorksheetHtml(makeDoc());
    expect(html.trimStart()).toMatch(/^<!DOCTYPE html>/i);
    expect(html).toContain('</html>');
    expect(html).toContain('iPad Workbook');
  });

  it('escapes HTML special characters in title', () => {
    const doc = makeDoc({ title: '<script>alert("xss")</script>' });
    const html = renderWorksheetHtml(doc);
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });

  it('shows Answer Key badge when isAnswerKey is true', () => {
    const doc = makeDoc({ isAnswerKey: true });
    const html = renderWorksheetHtml(doc);
    expect(html).toContain('Answer Key');
  });

  it('does NOT show Answer Key badge when isAnswerKey is false', () => {
    const doc = makeDoc({ isAnswerKey: false });
    const html = renderWorksheetHtml(doc);
    // The badge span is only emitted when isAnswerKey is true; CSS class is always in <style>
    expect(html).not.toContain('<span class="answer-key-badge">');
  });
});
