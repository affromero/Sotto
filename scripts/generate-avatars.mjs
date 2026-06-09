#!/usr/bin/env node
/*
 * Generate the Colombian-tropic animal profile avatars with Gemini 3 Pro Image
 * (nano banana pro). They go inline with the aula styling and drop into
 * apps/web/public/avatars/, replacing the emoji fallback tiles automatically.
 *
 * Run once the key is available, for example through Doppler:
 *   doppler run -- node scripts/generate-avatars.mjs
 * Needs GEMINI_API_KEY in the environment. Optional GEMINI_IMAGE_MODEL override.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error('GEMINI_API_KEY is not set. Add it to Doppler (dev and prd) or the environment.');
  process.exit(1);
}

const MODEL = process.env.GEMINI_IMAGE_MODEL ?? 'gemini-3-pro-image-preview';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'avatars');
mkdirSync(OUT, { recursive: true });

const STYLE =
  'Artistic, expressive, painterly modern editorial illustration with rich texture and confident ' +
  'brushwork. Centered portrait, square composition, gallery quality, a little dramatic. Warm ' +
  'off-white paper background color #F5F4F0. Indigo-blue #3F4FB0 with subtle teal and rose accents. ' +
  'Refined and elegant. Suitable as a profile avatar. No text, no words, no letters.';

const ANIMALS = [
  ['capybara', 'capybara'],
  ['iguana', 'green iguana'],
  ['sloth', 'three-toed sloth'],
  ['toucan', 'keel-billed toucan'],
  ['macaw', 'scarlet macaw'],
  ['frog', 'golden poison dart frog'],
  ['hummingbird', 'hummingbird mid-flight'],
  ['jaguar', 'jaguar'],
];

let ok = 0;
for (const [slug, subject] of ANIMALS) {
  const prompt = `An artistic portrait of a ${subject} from the Colombian tropics. ${STYLE}`;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseModalities: ['IMAGE'] },
        }),
      },
    );
    const data = await res.json();
    const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!part) {
      console.error(`${slug}: no image returned`, JSON.stringify(data).slice(0, 200));
      continue;
    }
    writeFileSync(join(OUT, `${slug}.png`), Buffer.from(part.inlineData.data, 'base64'));
    console.log(`${slug}.png written`);
    ok += 1;
  } catch (err) {
    console.error(`${slug}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log(`\n${ok}/${ANIMALS.length} avatars generated into ${OUT}`);
