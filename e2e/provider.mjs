import { createServer } from 'node:http';
import {
  vocabularyInventoryFixture,
  vocabularyCoverageFixture,
  vocabularyMetadataFixture,
} from './vocabulary-provider.mjs';

export function fixtureAudio() {
  const samples = 16000 * 8;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write('RIFF');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin((i * 440 * 2 * Math.PI) / 16000) * 3000), 44 + i * 2);
  return wav;
}

export async function startProvider() {
  const unexpected = [];
  const audio = fixtureAudio();
  let expectedConnection = { token: 'local', model: 'browser-fixture' };
  let transcription = 'Guten Morgen.';
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const send = (body, status = 200) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (request.method === 'GET' && request.url === '/health') return send({ status: 'ok' });
      if (request.method === 'POST' && request.url === '/fixture/connection') {
        const proposed = JSON.parse(Buffer.concat(chunks).toString());
        if (
          typeof proposed.token !== 'string' ||
          !proposed.token ||
          typeof proposed.model !== 'string' ||
          !proposed.model
        )
          throw new Error('Invalid fixture connection expectation');
        expectedConnection = { token: proposed.token, model: proposed.model };
        return send({ configured: true });
      }
      if (request.method === 'POST' && request.url === '/fixture/transcription') {
        const input = JSON.parse(Buffer.concat(chunks).toString());
        if (typeof input.text !== 'string' || !/^Guten Tag, [A-Za-z]+!$/.test(input.text))
          throw new Error('Invalid fixture transcription');
        transcription = input.text;
        return send({ configured: true });
      }
      if (request.method === 'GET' && request.url === '/v1/models') {
        if (request.headers.authorization !== `Bearer ${expectedConnection.token}`)
          throw new Error('Model discovery did not match the fixture expectation');
        return send({ object: 'list', data: [{ id: expectedConnection.model }] });
      }
      if (request.method === 'GET' && request.url === '/voices')
        return send({ voices: [{ id: 'fixture-voice', name: 'Fixture voice' }] });
      if (request.method === 'POST' && request.url === '/tts') {
        response.writeHead(200, { 'Content-Type': 'audio/wav' });
        return response.end(audio);
      }
      if (request.method === 'POST' && request.url === '/v1/audio/transcriptions')
        return send({ text: transcription });
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (
          request.headers.authorization !== `Bearer ${expectedConnection.token}` ||
          body.model !== expectedConnection.model
        )
          throw new Error('Generation did not match the fixture connection expectation');
        const messages = body.messages.map((message) => message.content).join('\n');
        const system = body.messages.find((message) => message.role === 'system')?.content || '';
        let content;
        if (system.startsWith('Write an independent ')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          const names = ['Noah', 'Mila', 'Omar', 'Nora', 'Leo', 'Eva', 'Lena', 'Max'];
          if (
            input.source?.course?.targetLang !== 'de' ||
            !input.prerequisite ||
            !Number.isInteger(input.count) ||
            input.count < 1 ||
            input.count > names.length
          )
            throw new Error('Unexpected assessment authoring source');
          const namesForItems = names.slice(0, input.count);
          if (['GRAMMAR', 'READING', 'LISTENING'].includes(input.skill)) {
            const items = namesForItems.map((name) => ({
              question: `Choose the greeting for ${name} in ${input.skill.toLowerCase()}.`,
              options: [
                `Guten Tag, ${name}!`,
                `Danke, ${name}!`,
                `Tschüss, ${name}!`,
                `Bitte, ${name}!`,
              ],
              correctIndex: 0,
              explanation: 'Guten Tag is a greeting.',
            }));
            content = JSON.stringify({
              skill: input.skill,
              items,
              ...(input.skill === 'READING'
                ? { passage: 'Mara meets friends during the day.' }
                : {}),
              ...(input.skill === 'LISTENING'
                ? { turns: [{ speaker: 'HOST', text: 'Guten Tag, Noah!' }] }
                : {}),
            });
          } else if (input.skill === 'SPEAKING') {
            content = JSON.stringify({
              skill: input.skill,
              items: namesForItems.map((name) => ({
                task: `Guten Tag, ${name}!`,
                mode: 'READ_ALOUD',
                translation: `Good day, ${name}!`,
                rubric:
                  'Score recognized word accuracy and completeness. Use word timing for fluency only when available.',
                guidance: 'Read the greeting aloud.',
              })),
            });
          } else if (input.skill === 'WRITING') {
            content = JSON.stringify({
              skill: input.skill,
              items: namesForItems.map((name) => ({
                task: `Greet ${name} in German.`,
                rubric: 'A clear greeting addressed to the named person.',
                guidance: 'Write a greeting and the person’s name.',
              })),
            });
          } else throw new Error('Unexpected assessment skill');
        } else if (system.startsWith('Independently review this complete ')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (!input || !JSON.stringify(input).includes('Guten Tag'))
            throw new Error('Unexpected assessment review source');
          content = JSON.stringify({
            taught: true,
            independent: true,
            correct: true,
            unambiguous: true,
            appropriate: true,
            rubricsSound: true,
            answersConcealed: true,
            issues: [],
          });
        } else if (system.startsWith('Write a short prerequisite lesson')) {
          const { source } = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (
            source?.course?.nativeLang !== 'en' ||
            source.course.targetLang !== 'de' ||
            source.teaching?.title !== 'Greet a friend in German' ||
            Object.keys(source.teaching.guidedPractice).sort().join(',') !== 'hint,prompt' ||
            JSON.stringify(source).includes('correctIndex')
          )
            throw new Error('Unexpected or private prerequisite source');
          content = JSON.stringify({
            title: 'A German greeting',
            explanation: 'Hallo is a greeting. Place the greeting before the person’s name.',
            examples: [
              {
                target: 'Guten Tag, Lena!',
                meaning: 'Good day, Lena!',
                explanation: 'This greeting also comes before the name.',
              },
            ],
          });
        } else if (system.startsWith('Independently review the proposed prerequisite lesson')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (
            input.source?.course?.targetLang !== 'de' ||
            input.addendum?.title !== 'A German greeting' ||
            JSON.stringify(input.source).includes('correctIndex')
          )
            throw new Error('Unexpected prerequisite review source');
          content = JSON.stringify({
            prerequisitesCovered: true,
            accurate: true,
            understandable: true,
            answersConcealed: true,
            issues: [],
          });
        } else if (system.startsWith('Explain the action required for each supplied exercise')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (
            input.course?.targetLang !== 'de' ||
            !Array.isArray(input.tasks) ||
            !input.tasks.length ||
            JSON.stringify(input).includes('correctIndex')
          )
            throw new Error('Unexpected prerequisite directions source');
          content = JSON.stringify({
            guided: input.guided ? 'Greet the person named in the prompt.' : null,
            tasks: input.tasks.map(({ sectionId, taskId, kind }) => ({
              sectionId,
              taskId,
              kind,
              instruction:
                kind === 'speaking'
                  ? 'Read the displayed phrase aloud.'
                  : kind === 'writing'
                    ? 'Write the requested greeting.'
                    : 'Choose the requested response.',
            })),
          });
        } else if (system.startsWith('Independently review each proposed direction')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (input.course?.targetLang !== 'de' || !input.candidate || !Array.isArray(input.tasks))
            throw new Error('Unexpected prerequisite directions review');
          content = JSON.stringify({
            faithful: true,
            understandable: true,
            challengePreserved: true,
            answersConcealed: true,
            issues: [],
          });
        } else if (system.startsWith('Provide optional native-language support')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (
            input.source?.title !== 'Greet a friend in German' ||
            Object.keys(input.source.guidedPractice).sort().join(',') !== 'hint,prompt'
          )
            throw new Error('Lesson help received an unexpected or concealed source');
          content = JSON.stringify({
            title: 'Greet a friend in German',
            explanation: 'Use Hallo before your friend’s name. The German greeting stays the same.',
            workedExamples: input.source.workedExamples.map((example, index) => ({
              prompt: example.prompt,
              meaning: index === 0 ? 'Hello, Anna!' : 'Hello, Ben!',
              explanation: example.explanation,
            })),
            correctionExplanation: 'Put the greeting first when you address your friend.',
            guidedPrompt: 'Greet Mia.',
            guidedHint: 'Start with Hallo.',
          });
        } else if (system.startsWith('Independently verify native-language support')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (
            input.source?.workedExamples[0].answer !== 'Hallo, Anna!' ||
            input.support?.workedExamples[0].meaning !== 'Hello, Anna!' ||
            Object.keys(input.source.guidedPractice).sort().join(',') !== 'hint,prompt'
          )
            throw new Error('Lesson help review received unexpected source or meanings');
          content = JSON.stringify({
            accurate: true,
            nativeLanguageCorrect: true,
            targetExamplesPreserved: true,
            issues: [],
          });
        } else if (system.startsWith('Inventory every ')) {
          content = JSON.stringify(
            vocabularyInventoryFixture(
              JSON.parse(body.messages.find((message) => message.role === 'user').content)
            )
          );
        } else if (system.startsWith('Independently verify complete vocabulary coverage')) {
          content = JSON.stringify(
            vocabularyCoverageFixture(
              JSON.parse(body.messages.find((message) => message.role === 'user').content)
            )
          );
        } else if (
          system.startsWith('Extract useful ') &&
          system.includes('from the supplied reading passage')
        ) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          const sourceWords = input.passageWords?.filter((word) => word.surface === 'Hallo');
          if (
            input.passageText !== 'Anna sagt Hallo zu ihrem Freund.' ||
            !Array.isArray(sourceWords) ||
            sourceWords.length !== 1 ||
            !Number.isSafeInteger(sourceWords[0].index) ||
            sourceWords[0].index < 0 ||
            !Array.isArray(input.questions) ||
            !input.questions.length ||
            input.questions.some(
              (question) =>
                typeof question.question !== 'string' ||
                !Array.isArray(question.options) ||
                !question.options.includes('Hallo')
            )
          ) {
            throw new Error('Unexpected reading extraction fixture');
          }
          content = JSON.stringify({
            words: [
              {
                lemma: 'Hallo',
                gloss: 'hello',
                pos: 'interjection',
                sourceSpan: {
                  startWordIndex: sourceWords[0].index,
                  endWordIndex: sourceWords[0].index,
                },
                questionIndices: input.questions.map((_, index) => index),
              },
            ],
          });
        } else if (system.startsWith('Independently review reading vocabulary')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (input.items?.[0]?.content.lemma !== 'Hallo') {
            content = JSON.stringify(vocabularyMetadataFixture(input));
          } else {
            if (
              !Array.isArray(input.items) ||
              input.items.length !== 1 ||
              input.items[0].index !== 0 ||
              input.items[0].content.lemma !== 'Hallo' ||
              input.items[0].content.gloss !== 'hello' ||
              input.items[0].content.sourceQuote !== 'Hallo' ||
              input.items[0].content.passageText !== 'Anna sagt Hallo zu ihrem Freund.'
            ) {
              throw new Error('Unexpected vocabulary review fixture');
            }
            content = JSON.stringify({
              items: [
                {
                  index: 0,
                  metadata: { acceptable: true, issues: [], feedback: [] },
                  associations: input.items[0].content.questionIndices.map((questionIndex) => ({
                    questionIndex,
                    canAnswerWithoutWord: false,
                    reasoning: 'The greeting meaning distinguishes the required answer.',
                  })),
                },
              ],
            });
          }
        } else if (
          system.startsWith(
            'Determine whether each supplied reading question can be correctly answered'
          )
        ) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          const item = input.items?.[0];
          const questions = item?.content?.questions;
          if (
            Object.keys(input).join(',') !== 'items' ||
            !Array.isArray(input.items) ||
            input.items.length !== 1 ||
            Object.keys(item).sort().join(',') !== 'content,index' ||
            item.index !== 0 ||
            Object.keys(item.content).sort().join(',') !== 'passageText,questions' ||
            item.content.passageText !== 'Anna sagt [WORD] zu ihrem Freund.' ||
            !Array.isArray(questions) ||
            questions.length < 1 ||
            questions.length > 5 ||
            new Set(questions.map((question) => question.questionIndex)).size !==
              questions.length ||
            questions.some(
              (question) =>
                Object.keys(question).sort().join(',') !== 'options,question,questionIndex' ||
                !Number.isSafeInteger(question.questionIndex) ||
                question.questionIndex < 0 ||
                question.questionIndex >= 5 ||
                question.question !== 'Choose the greeting (reading).' ||
                JSON.stringify(question.options) !==
                  JSON.stringify(['[WORD]', 'Danke', 'Bitte', 'Tschüss'])
            )
          ) {
            throw new Error('Unexpected masked vocabulary review fixture');
          }
          content = JSON.stringify({
            decisions: questions.map(({ questionIndex }) => ({
              questionIndex,
              decision: 'WORD_MEANING_REQUIRED',
              answerIndex: null,
              reasoning: "Selecting the greeting requires the hidden word's meaning.",
            })),
          });
        } else if (system.startsWith('You are a supportive') && system.includes('writing tutor')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          const formative =
            input.task === 'Greet a friend.' && input.response === 'Guten Morgen, mein Freund!';
          const assessment =
            /^Greet [A-Za-z]+ in German\.$/.test(input.task) &&
            input.response === `Guten Tag, ${input.task.split(' ')[1]}!`;
          if (!formative && !assessment) throw new Error('Unexpected writing response fixture');
          content = JSON.stringify({
            overallScore: 1,
            corrections: [],
            feedback: 'Your greeting is clear.',
          });
        } else if (messages.includes('Grade the response.'))
          content = JSON.stringify({
            overallScore: 1,
            corrections: [],
            feedback: 'Your greeting is clear.',
          });
        else if (messages.includes('Score this pronunciation attempt.'))
          content = JSON.stringify({
            accuracy: 1,
            fluency: 1,
            completeness: 1,
            feedback: 'Clear pronunciation.',
          });
        else if (/hello|connection|respond.*ok|say.*ok/i.test(messages)) content = 'Hello!';
        if (content)
          return send({
            id: 'browser-response',
            object: 'chat.completion',
            created: 1,
            model: 'browser-fixture',
            choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
          });
        unexpected.push({ path: request.url, messages });
        return send({ error: { message: 'Unexpected fixture prompt' } }, 400);
      }
      unexpected.push({ method: request.method, path: request.url });
      send({ error: { message: 'Unexpected fixture request' } }, 400);
    } catch (error) {
      unexpected.push({ method: request.method, path: request.url, error: String(error) });
      if (!response.headersSent) response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: 'Invalid fixture request' } }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    unexpected,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
