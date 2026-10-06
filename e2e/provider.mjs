import { createServer } from 'node:http';

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
  let selectedAiKey;
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const send = (body, status = 200) => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (request.method === 'GET' && request.url === '/health') return send({ status: 'ok' });
      if (request.method === 'GET' && request.url === '/v1/models') {
        selectedAiKey = request.headers.authorization;
        if (!['Bearer browser-local-key', 'Bearer browser-custom-key'].includes(selectedAiKey))
          throw new Error('Expected the configured compatible API key');
        return send({ object: 'list', data: [{ id: 'browser-fixture' }] });
      }
      if (request.method === 'GET' && request.url === '/voices')
        return send({ voices: [{ id: 'fixture-voice', name: 'Fixture voice' }] });
      if (request.method === 'POST' && request.url === '/tts') {
        response.writeHead(200, { 'Content-Type': 'audio/wav' });
        return response.end(audio);
      }
      if (request.method === 'POST' && request.url === '/v1/audio/transcriptions')
        return send({ text: 'Guten Morgen.' });
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        if (selectedAiKey && request.headers.authorization !== selectedAiKey)
          throw new Error('Generation did not use the configured compatible API key');
        const body = JSON.parse(Buffer.concat(chunks).toString());
        if (body.model !== 'browser-fixture')
          throw new Error('Generation did not use the configured model');
        const messages = body.messages.map((message) => message.content).join('\n');
        const system = body.messages.find((message) => message.role === 'system')?.content || '';
        let content;
        if (
          system.startsWith('Extract useful ') &&
          system.includes('from the supplied reading passage')
        ) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (
            input.passageText !== 'Anna sagt Hallo zu ihrem Freund.' ||
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
                sourceForm: 'Hallo',
                questionIndices: input.questions.map((_, index) => index),
              },
            ],
          });
        } else if (system.startsWith('Independently review reading vocabulary')) {
          const input = JSON.parse(
            body.messages.find((message) => message.role === 'user').content
          );
          if (
            !Array.isArray(input.items) ||
            input.items.length !== 1 ||
            input.items[0].index !== 0 ||
            input.items[0].content.lemma !== 'Hallo' ||
            input.items[0].content.gloss !== 'hello' ||
            input.items[0].content.sourceForm !== 'Hallo' ||
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
