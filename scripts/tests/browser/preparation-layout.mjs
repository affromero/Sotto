import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

// Render the actual component and containing course layout. Only navigation and
// HTTP are replaced; no database or external model is involved.
const directory = await mkdtemp(join(tmpdir(), 'sotto-preparation-layout-'));
const artifacts = join(process.cwd(), 'test-results', 'preparation-layout');
await mkdir(artifacts, { recursive: true });
let browser;
try {
  await build({
    stdin: {
      contents: `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {StartNextClass} from './apps/web/src/components/learn/StartNextClass';
        import styles from './apps/web/src/app/(dashboard)/learn/page.module.css';
        import './apps/web/src/styles/globals.css';
        window.fetch=async(url,init)=>({
          ok:true,status:init?.method==='POST'?202:200,
          json:async()=>init?.method==='POST'?{operationId:'layout-test'}:
            url.includes('/generation')?{
              status:'GENERATING',operationId:'layout-test',lessonTitle:null,
              detail:'Scheduled for tomorrow',progress:0,currentStep:1,totalSteps:5,elapsedSeconds:null
            }:{
              operationId:'layout-test',aiProvider:'claude-code',aiModel:'claude-code:claude-sonnet-4-6#effort=high',
              availableAt:'2026-09-28T15:00:00.000Z',timeZone:'America/Bogota',
              maxProviderRequests:128,providerRequestsAdmitted:7,
              events:[{sequence:1,at:1790593200000,type:'provider_request_admitted'}]
            }
        });
        createRoot(document.getElementById('root')).render(
          <main className={styles.root}>
            <div className={styles.courseCard}>
              <div className={styles.courseInfo}>Spanish A2</div>
              <div className={styles.courseActions}>
                <StartNextClass courseId='layout-test' activeClassId={null}/>
                <a className={styles.practiceLink} href='/learn/practice'>Practice</a>
              </div>
            </div>
          </main>
        );
      `,
      loader: 'tsx',
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    external: ['/brand/*'],
    outfile: join(directory, 'bundle.js'),
    tsconfig: 'apps/web/tsconfig.json',
    plugins: [
      {
        name: 'navigation-fixture',
        setup(builder) {
          builder.onResolve({ filter: /^next\/navigation$/ }, () => ({
            path: 'router',
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
    timezoneId: 'Pacific/Auckland',
  });
  await page.route('**/*', (route) => route.abort());
  await page.setContent('<html><head></head><body><div id="root"></div></body></html>');
  await page.addStyleTag({ path: join(directory, 'bundle.css') });
  await page.addScriptTag({ path: join(directory, 'bundle.js') });
  const assertVisibleBounds = async (selector, touchTarget = false) => {
    const boxes = await page.locator(selector).evaluateAll((elements) =>
      elements
        .filter((element) => element.getClientRects().length)
        .map((element) => ({
          text: element.textContent,
          ...element.getBoundingClientRect().toJSON(),
        }))
    );
    assert.ok(boxes.length > 0, `Missing controls: ${selector}`);
    for (const box of boxes) {
      assert.ok(box.left >= 0 && box.right <= 375, `Offscreen ${selector}: ${JSON.stringify(box)}`);
      if (touchTarget)
        assert.ok(
          box.height >= 44 && box.width >= 44,
          `Small touch target: ${JSON.stringify(box)}`
        );
    }
  };
  await page.getByText('Prepare a class later', { exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'schedule-375.png'), fullPage: true });
  await assertVisibleBounds('input, button, summary', true);
  const tomorrow = await page.evaluate(() => {
    const date = new Date(Date.now() + 86_400_000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  });
  await page.getByLabel('Preparation time (your local time)').fill(tomorrow);
  await page.getByRole('button', { name: 'Schedule preparation' }).click();
  await page.getByText('Preparation activity', { exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'activity-375.png'), fullPage: true });
  await assertVisibleBounds('button, summary, a', true);
  await assertVisibleBounds('details p, details li');
  process.stdout.write(
    'Preparation scheduling and activity fit 375px with accessible touch targets.\n'
  );
} finally {
  await browser?.close();
  await rm(directory, { recursive: true, force: true });
}
