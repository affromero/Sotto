import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const directory = await mkdtemp(join(tmpdir(), 'sotto-complete-practice-browser-'));
const artifacts = join(process.cwd(), 'test-results', 'complete-practice');
await mkdir(artifacts, { recursive: true });
const wave = Buffer.alloc(44 + 16000);
wave.write('RIFF', 0);
wave.writeUInt32LE(wave.length - 8, 4);
wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16);
wave.writeUInt16LE(1, 20);
wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(8000, 24);
wave.writeUInt32LE(16000, 28);
wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34);
wave.write('data', 36);
wave.writeUInt32LE(16000, 40);
const audioFixture = 'data:audio/wav;base64,' + wave.toString('base64');
let browser;
try {
  await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: 'tsx',
      contents: [
        "import React from 'react';",
        "import {createRoot} from 'react-dom/client';",
        "import layout from './apps/web/src/app/(dashboard)/learn/practice/page.module.css';",
        "import {PracticeRunner} from './apps/web/src/components/learn/PracticeRunner';",
        "import {createSkillRequirements} from './packages/shared/src/learning-requirements';",
        "import './apps/web/src/styles/globals.css';",
        "const root=createRoot(document.getElementById('root'));",
        'window.requests=[]; let revision=0;',
        'window.fetch=async(url,init)=>{window.requests.push({url,method:init?.method,body:init?.body?JSON.parse(init.body):null});',
        "if(init?.method==='PATCH') return Response.json({saved:true,progressRevision:++revision});",
        "if(url.endsWith('/submit')) return Response.json({score:0.9,correct:14,total:21,answered:14,graded:7,itemFeedback:[{itemId:'g0',prompt:'Greet Ana.',selectedIndex:0,correctIndex:0,selectedAnswer:'Hola',correctAnswer:'Hola',correct:true,explanation:'Hola greets someone.'}],writingFeedback:[{promptId:'w0',task:'Greet Ana.',grade:{text:'Hola Ana.',overallScore:0.9,feedback:'A clear greeting.',corrections:[{old:'Ola',new:'Hola',why:'Use the Spanish greeting.'}]}}],speakingFeedback:[{promptId:'s0',targetPhrase:'Hola Ana.',evidence:{recordingId:'saved-recording',status:'SCORED',transcript:'Hola Ana',overallScore:0.9,feedback:'Both words are present.'}}]});",
        "return Response.json({status:'READY',audioUrl:'" + audioFixture + "'});};",
        'window.renderScenario=(tts,stt)=>{revision=0;window.requests=[];',
        "const items=['g','r',...(tts?['l']:[])].flatMap(prefix=>Array.from({length:prefix==='l'?4:5},(_,i)=>({id:prefix+i,prompt:'Choose the greeting for Ana '+i+'.',options:['Hola Ana, ¿cómo estás hoy?','Hasta luego, Ana.','Ayer fui al mercado.','Mañana veremos a los amigos.'],...(prefix==='r'?{passageText:'Ana saluda a su amigo. Hola, amigo. Hoy conversan sobre su viaje y sus planes para mañana.'}:{})})));",
        "const writingPrompts=Array.from({length:3},(_,i)=>({id:'w'+i,task:'Greet Ana and ask about her day '+i+'.',savedDraft:'Hola Ana.',response:{text:'Hola Ana.',overallScore:0.9,feedback:'A clear greeting.',corrections:[]}}));",
        "const speakingPrompts=stt?Array.from({length:4},(_,i)=>({id:'s'+i,targetPhrase:'Hola Ana '+i+'.',translation:'Hello Ana '+i+'.',referenceTtsUrl:tts?'" +
          audioFixture +
          "':null,latestRecording:{recordingId:'recording-'+i,status:'SCORED',overallScore:0.9,transcript:'Hola Ana '+i,feedback:'Every word is present.'}})):[];",
        "const start={status:'ready_full',kind:'FULL',sessionId:'browser-'+tts+'-'+stt,progressRevision:0,items,writingPrompts,speakingPrompts,learnerAnswers:Object.fromEntries(items.map(item=>[item.id,0])),...(tts?{episodeId:'audio'}:{}),skillRequirements:createSkillRequirements({scope:'FULL',nativeLang:'en',targetLang:'es',level:'A1',ttsProvider:tts?'cartesia':null,sttProvider:stt?'openai':null})};",
        "root.render(<main className={layout.root}><PracticeRunner key={start.sessionId} courseId='browser-course' start={start} onDone={()=>{}}/></main>);};",
      ].join('\n'),
    },
    bundle: true,
    define: {
      'process.env.NODE_ENV': '"test"',
      'process.env.__NEXT_IMAGE_OPTS': 'undefined',
      'process.env.NEXT_RUNTIME': '"edge"',
      'process.env': '{}',
    },
    external: ['/brand/*'],
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    outfile: join(directory, 'bundle.js'),
    tsconfig: 'apps/web/tsconfig.json',
    plugins: [
      {
        name: 'navigation-boundary',
        setup(builder) {
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: 'navigation',
            namespace: 'fixture',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const useRouter=()=>({push(){},refresh(){}});',
          }));
        },
      },
    ],
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 375, height: 812 },
    reducedMotion: 'reduce',
  });
  const errors = [];
  page.on('pageerror', (error) => {
    errors.push(error.message);
    process.stderr.write(error.stack + '\n');
  });
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ path: join(directory, 'bundle.css') });
  await page.addScriptTag({ path: join(directory, 'bundle.js') });
  assert.deepEqual(errors, []);
  assert.equal(await page.evaluate(() => typeof window.renderScenario), 'function');
  for (const [tts, stt] of [
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ]) {
    await page.evaluate(([tts, stt]) => window.renderScenario(tts, stt), [tts, stt]);
    await page
      .locator('summary')
      .filter({ hasText: /^Writing/ })
      .waitFor();
    if (tts) await page.getByText(/Audio ready/).waitFor();
    await page.screenshot({
      path: join(artifacts, 'overview-' + tts + '-' + stt + '-375.png'),
      fullPage: true,
    });
    for (const title of ['Grammar', 'Reading', 'Listening', 'Speaking', 'Writing']) {
      await page
        .locator('summary')
        .filter({ hasText: new RegExp('^' + title) })
        .click();
    }
    const writing = page
      .locator('details')
      .filter({ has: page.locator('summary').filter({ hasText: /^Writing/ }) });
    assert.equal(await writing.locator('textarea').count(), 3);
    assert.equal(await writing.locator('textarea').first().inputValue(), 'Hola Ana.');
    if (!tts)
      await page.getByText('Listening is exempt because no TTS provider is connected.').waitFor();
    if (!stt)
      await page.getByText('Speaking is exempt because no STT provider is connected.').waitFor();
    if (stt)
      assert.equal(await page.getByText('Every word is present.', { exact: false }).count(), 4);
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
      false
    );
    const boxes = await page.locator('button, summary, textarea').evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length)
        .map((element) => ({
          text: element.textContent,
          ...element.getBoundingClientRect().toJSON(),
        }))
    );
    for (const box of boxes) {
      assert.ok(box.left >= 0 && box.right <= 375, 'Offscreen control: ' + JSON.stringify(box));
      assert.ok(box.height >= 44 && box.width >= 44, 'Small touch target: ' + JSON.stringify(box));
    }
    await page.screenshot({
      path: join(artifacts, 'full-' + tts + '-' + stt + '-375.png'),
      fullPage: true,
    });
    if (tts && stt) {
      await page.getByRole('button', { name: 'Submit and finish' }).click();
      await page.getByRole('region', { name: 'Practice result' }).waitFor();
      await page.getByText('Hola greets someone.').waitFor();
      await page.getByText('Ola → Hola. Use the Spanish greeting.').waitFor();
      await page.getByText('Both words are present.').waitFor();
      const submit = await page.evaluate(() =>
        window.requests.find((request) => request.url.endsWith('/submit'))
      );
      assert.equal(submit.body.answers.length, 14);
      assert.equal(await page.locator('textarea').count(), 0);
      await page.screenshot({ path: join(artifacts, 'receipt-375.png'), fullPage: true });
    }
  }
  assert.deepEqual(errors, []);
  process.stdout.write(
    'Full practice restores all five skills across four speech configurations, fits 375px, and submits every choice with persistent feedback.\n'
  );
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
