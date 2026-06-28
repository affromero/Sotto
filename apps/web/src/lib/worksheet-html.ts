// Pure function - no imports beyond the ClassDocument type.
// Returns a standalone, page-based HTML workbook for iPad PDF annotation.
import type { ClassDocument, ClassDocumentIntro, ClassDocumentSection } from '@sotto/shared';

const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export function renderWorksheetHtml(doc: ClassDocument): string {
  const sectionsHtml = doc.sections.map(renderSection).join('\n');
  const introHtml = doc.intro ? renderIntro(doc.intro) : '';
  const tocHtml = doc.sections
    .map(
      (section, index) => `
        <li>
          <span class="toc-index">${String(index + 1).padStart(2, '0')}</span>
          <span class="toc-title">${escapeHtml(section.title)}</span>
          <span class="toc-skill">${escapeHtml(section.skill.toLowerCase())}</span>
        </li>`
    )
    .join('\n');

  const answerKeyHtml = doc.isAnswerKey ? renderAnswerKey(doc.sections) : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(doc.title)} - iPad Workbook</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html { font-size: 11pt; }
    body {
      margin: 0;
      background: #e9edf1;
      color: #172033;
      font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif;
    }
    .workbook {
      width: min(100%, 210mm);
      margin: 0 auto;
    }
    .page {
      min-height: 297mm;
      padding: 18mm 18mm 20mm;
      background:
        linear-gradient(90deg, rgba(47, 111, 119, 0.08) 0 1px, transparent 1px),
        linear-gradient(180deg, rgba(47, 111, 119, 0.06) 0 1px, transparent 1px),
        #ffffff;
      background-size: 8mm 8mm;
      border: 1px solid rgba(23, 32, 51, 0.08);
      box-shadow: 0 18px 48px rgba(23, 32, 51, 0.14);
      position: relative;
      break-after: page;
      page-break-after: always;
    }
    .page:last-child { break-after: auto; page-break-after: auto; }
    .cover {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      background:
        linear-gradient(135deg, rgba(230, 88, 67, 0.12), transparent 38%),
        linear-gradient(225deg, rgba(47, 111, 119, 0.14), transparent 42%),
        #ffffff;
    }
    .brand {
      font-size: 11pt;
      font-weight: 800;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #2f6f77;
    }
    .cover-kicker {
      margin: 34mm 0 0;
      font-size: 10pt;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: #e65843;
      font-weight: 800;
    }
    .cover-title {
      margin: 6mm 0 0;
      max-width: 15ch;
      font-family: "Newsreader", Georgia, serif;
      font-size: 34pt;
      line-height: 0.98;
      font-weight: 650;
      color: #172033;
    }
    .cover-objective {
      margin-top: 8mm;
      max-width: 58ch;
      font-size: 13pt;
      line-height: 1.45;
      color: #3c4658;
    }
    .cover-meta {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5mm;
      margin-top: 16mm;
    }
    .meta-card {
      border: 1px solid rgba(23, 32, 51, 0.16);
      border-radius: 6px;
      padding: 5mm;
      background: rgba(255, 255, 255, 0.78);
    }
    .meta-label {
      display: block;
      font-size: 8pt;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #667085;
      margin-bottom: 2mm;
    }
    .meta-value {
      display: block;
      font-size: 12pt;
      font-weight: 800;
      color: #172033;
    }
    .name-row {
      display: grid;
      grid-template-columns: 1fr 42mm;
      gap: 10mm;
      margin-top: 18mm;
    }
    .field-line {
      border-bottom: 1.5px solid #172033;
      min-height: 10mm;
      position: relative;
    }
    .field-line span {
      position: absolute;
      left: 0;
      bottom: -5mm;
      font-size: 8pt;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #667085;
    }
    .toc {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .toc li {
      display: grid;
      grid-template-columns: 16mm 1fr 28mm;
      align-items: baseline;
      gap: 5mm;
      padding: 5mm 0;
      border-bottom: 1px solid rgba(23, 32, 51, 0.14);
    }
    .toc-index {
      color: #e65843;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 10pt;
      font-weight: 800;
    }
    .toc-title {
      font-family: "Newsreader", Georgia, serif;
      font-size: 18pt;
      color: #172033;
    }
    .toc-skill {
      color: #667085;
      font-size: 8pt;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      text-align: right;
    }
    .page-head {
      display: flex;
      justify-content: space-between;
      gap: 8mm;
      padding-bottom: 6mm;
      border-bottom: 2px solid #172033;
    }
    .section-title {
      margin: 0;
      font-family: "Newsreader", Georgia, serif;
      font-size: 25pt;
      line-height: 1.05;
      color: #172033;
    }
    .section-label {
      display: inline-block;
      margin-bottom: 3mm;
      color: #2f6f77;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 8pt;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      font-weight: 800;
    }
    .instructions {
      margin: 4mm 0 0;
      max-width: 60ch;
      color: #3c4658;
      font-size: 10.5pt;
      line-height: 1.45;
    }
    .qr-card {
      width: 32mm;
      flex: none;
      text-align: center;
      border: 1px solid rgba(23, 32, 51, 0.18);
      border-radius: 6px;
      padding: 3mm;
      background: #fff;
    }
    .qr-card img {
      display: block;
      width: 24mm;
      height: 24mm;
      margin: 0 auto 2mm;
      image-rendering: pixelated;
    }
    .qr-card span {
      display: block;
      font-size: 7.5pt;
      color: #667085;
      line-height: 1.2;
    }
    .link-text {
      margin-top: 2mm;
      overflow-wrap: anywhere;
      font-size: 6.5pt;
      color: #2f6f77;
    }
    .content {
      margin-top: 8mm;
      display: grid;
      gap: 7mm;
    }
    .intro-lead {
      display: grid;
      gap: 4mm;
      margin-top: 8mm;
      margin-bottom: 8mm;
    }
    .intro-purpose {
      margin: 0;
      font-family: "Newsreader", Georgia, serif;
      font-size: 19pt;
      line-height: 1.18;
      color: #172033;
    }
    .intro-about {
      margin: 0;
      color: #3c4658;
      font-size: 11pt;
      line-height: 1.55;
    }
    .intro-visuals,
    .intro-columns,
    .callouts {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5mm;
      margin-top: 6mm;
    }
    .timeline,
    .contrast,
    .callout {
      border: 1px solid rgba(23, 32, 51, 0.16);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.84);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .timeline figcaption,
    .contrast figcaption,
    .intro-columns h3,
    .callout b {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 8pt;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #172033;
      font-weight: 800;
    }
    .timeline,
    .contrast {
      margin: 0;
      overflow: hidden;
    }
    .timeline figcaption,
    .contrast figcaption {
      display: block;
      padding: 4mm;
      border-bottom: 1px solid rgba(23, 32, 51, 0.12);
    }
    .timeline ol {
      list-style: none;
      margin: 0;
      padding: 4mm;
      display: grid;
      gap: 3mm;
    }
    .timeline li {
      display: grid;
      grid-template-columns: 9mm 1fr;
      gap: 3mm;
      align-items: center;
    }
    .timeline-index {
      width: 8mm;
      height: 8mm;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: #2a8c78;
      color: #fff;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 7pt;
      font-weight: 800;
    }
    .timeline p,
    .contrast li,
    .intro-columns li,
    .example-note,
    .callout {
      font-size: 9.5pt;
      line-height: 1.42;
      color: #3c4658;
    }
    .timeline p {
      margin: 0;
      color: #172033;
    }
    .contrast-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
    }
    .contrast-side {
      padding: 4mm;
    }
    .contrast-side:first-child {
      border-right: 1px solid rgba(23, 32, 51, 0.12);
      background: rgba(63, 79, 176, 0.07);
    }
    .contrast-side:last-child {
      background: rgba(185, 128, 36, 0.08);
    }
    .contrast-side b,
    .example-target {
      display: block;
      color: #172033;
      font-weight: 800;
      margin-bottom: 2mm;
    }
    .contrast ul,
    .intro-columns ul {
      margin: 0;
      padding-left: 5mm;
    }
    .intro-columns h3 {
      margin: 0 0 3mm;
    }
    .example {
      padding-bottom: 3mm;
      border-bottom: 1px solid rgba(23, 32, 51, 0.12);
    }
    .example + .example {
      margin-top: 3mm;
    }
    .example p {
      margin: 0;
      color: #3c4658;
      font-size: 9.5pt;
      line-height: 1.42;
    }
    .example-note {
      display: block;
      margin-top: 1mm;
    }
    .callouts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .callout {
      margin: 0;
      padding: 4mm;
    }
    .callout b {
      display: block;
      margin-bottom: 1mm;
    }
    .question {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .passage-card {
      border-left: 4px solid #2f6f77;
      padding: 4mm 5mm;
      margin-bottom: 5mm;
      background: rgba(47, 111, 119, 0.08);
      color: #263247;
      font-size: 10pt;
      line-height: 1.55;
    }
    .passage-ref {
      display: block;
      margin-bottom: 2mm;
      color: #667085;
      font-size: 8pt;
      font-style: italic;
    }
    .question-text {
      margin: 0 0 4mm;
      font-size: 12pt;
      line-height: 1.4;
      color: #172033;
    }
    .question-number {
      color: #e65843;
      font-weight: 800;
      margin-right: 2mm;
    }
    .options {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 2.5mm;
    }
    .option {
      display: grid;
      grid-template-columns: 8mm 9mm 1fr;
      gap: 2mm;
      align-items: start;
      min-height: 8mm;
      font-size: 10.5pt;
      line-height: 1.35;
    }
    .checkbox {
      font-size: 13pt;
      line-height: 1;
      color: #172033;
    }
    .option-letter {
      color: #667085;
      font-weight: 800;
    }
    .correct-option .option-text,
    .correct-option .option-letter {
      color: #2f6f77;
      font-weight: 800;
    }
    .explanation {
      margin: 3mm 0 0 17mm;
      color: #3c4658;
      font-size: 9.5pt;
      line-height: 1.4;
    }
    .pencil-lines {
      display: grid;
      gap: 6mm;
      margin-top: 5mm;
    }
    .pencil-lines span {
      display: block;
      height: 1px;
      border-bottom: 1px solid rgba(23, 32, 51, 0.28);
    }
    .prompt {
      display: grid;
      grid-template-columns: 10mm 1fr;
      gap: 4mm;
      padding: 4mm;
      border: 1px solid rgba(23, 32, 51, 0.14);
      border-radius: 6px;
      background: rgba(255, 255, 255, 0.82);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .prompt-index {
      width: 9mm;
      height: 9mm;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: #172033;
      color: #fff;
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      font-size: 8pt;
      font-weight: 800;
    }
    .target-phrase {
      margin: 0;
      font-size: 13pt;
      font-weight: 800;
      color: #172033;
    }
    .translation,
    .ipa,
    .guidance {
      margin: 2mm 0 0;
      color: #667085;
      font-size: 9.5pt;
      line-height: 1.4;
    }
    .ipa {
      font-family: "IBM Plex Mono", ui-monospace, monospace;
      color: #3c4658;
    }
    .writing-task {
      border: 1px solid rgba(23, 32, 51, 0.14);
      border-radius: 6px;
      padding: 5mm;
      background: rgba(255, 255, 255, 0.86);
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .writing-title {
      margin: 0 0 2mm;
      font-size: 12.5pt;
      line-height: 1.35;
      font-weight: 800;
      color: #172033;
    }
    .writing-space {
      display: grid;
      gap: 8mm;
      margin-top: 7mm;
    }
    .writing-space span {
      display: block;
      height: 1px;
      border-bottom: 1px solid rgba(23, 32, 51, 0.32);
    }
    .empty-note {
      color: #667085;
      font-size: 10pt;
      font-style: italic;
    }
    .answer-key-badge {
      display: inline-block;
      margin-left: 3mm;
      padding: 1.5mm 3mm;
      border-radius: 4px;
      background: #172033;
      color: #fff;
      font-size: 8pt;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    @page { size: A4; margin: 0; }
    @media print {
      body { background: #fff; }
      .workbook { width: 210mm; margin: 0; }
      .page {
        min-height: 297mm;
        width: 210mm;
        border: 0;
        box-shadow: none;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
    }
  </style>
</head>
<body>
  <main class="workbook">
    <section class="page cover">
      <div>
        <div class="brand">Sotto</div>
        <div class="cover-kicker">iPad workbook</div>
        <h1 class="cover-title">${escapeHtml(doc.title)}</h1>
        ${doc.isAnswerKey ? '<span class="answer-key-badge">Answer Key</span>' : ''}
        ${doc.objective ? `<p class="cover-objective">${escapeHtml(doc.objective)}</p>` : ''}
        <div class="cover-meta">
          <div class="meta-card"><span class="meta-label">Level</span><span class="meta-value">${escapeHtml(doc.level)}</span></div>
          <div class="meta-card"><span class="meta-label">From</span><span class="meta-value">${escapeHtml(doc.nativeLang.toUpperCase())}</span></div>
          <div class="meta-card"><span class="meta-label">To</span><span class="meta-value">${escapeHtml(doc.targetLang.toUpperCase())}</span></div>
        </div>
      </div>
      <div>
        <div class="name-row">
          <div class="field-line"><span>Name</span></div>
          <div class="field-line"><span>Date</span></div>
        </div>
      </div>
    </section>

    ${introHtml}

    <section class="page">
      <header class="page-head">
        <div>
          <span class="section-label">Workbook map</span>
          <h2 class="section-title">Class pages</h2>
          <p class="instructions">Complete written work on the page. Use the QR codes only for web-only actions such as listening audio, speaking recording, and writing feedback.</p>
        </div>
      </header>
      <ol class="toc">${tocHtml}</ol>
    </section>

    ${sectionsHtml}
    ${answerKeyHtml}
  </main>
</body>
</html>`;
}

function renderIntro(intro: ClassDocumentIntro): string {
  const visuals = intro.visuals;
  const timelineHtml =
    visuals?.timeline && visuals.timeline.steps.length >= 2
      ? `<figure class="timeline">
          <figcaption>${escapeHtml(visuals.timeline.title)}</figcaption>
          <ol>${visuals.timeline.steps
            .map(
              (step, index) =>
                `<li><span class="timeline-index">${index + 1}</span><p>${escapeHtml(step)}</p></li>`
            )
            .join('')}</ol>
        </figure>`
      : '';
  const contrastHtml = visuals?.contrast
    ? `<figure class="contrast">
        <figcaption>${escapeHtml(visuals.contrast.title)}</figcaption>
        <div class="contrast-grid">
          <div class="contrast-side">
            <b>${escapeHtml(visuals.contrast.leftLabel)}</b>
            <ul>${visuals.contrast.leftItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          </div>
          <div class="contrast-side">
            <b>${escapeHtml(visuals.contrast.rightLabel)}</b>
            <ul>${visuals.contrast.rightItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
          </div>
        </div>
      </figure>`
    : '';
  const focusHtml = intro.focus.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const examplesHtml = intro.examples
    .map(
      (example) => `<article class="example">
        <span class="example-target">${escapeHtml(example.target)}</span>
        <p>${escapeHtml(example.meaning)}</p>
        <small class="example-note">${escapeHtml(example.note)}</small>
      </article>`
    )
    .join('');
  const callouts = visuals?.callouts?.length
    ? visuals.callouts
    : intro.tips.map((tip, index) => ({ label: `Tip ${index + 1}`, text: tip }));
  const calloutsHtml = callouts
    .map(
      (callout) =>
        `<p class="callout"><b>${escapeHtml(callout.label)}</b>${escapeHtml(callout.text)}</p>`
    )
    .join('');

  return `<section class="page">
    <header class="page-head">
      <div>
        <span class="section-label">Brief</span>
        <h2 class="section-title">Remember this</h2>
      </div>
    </header>
    <div class="intro-lead">
      <p class="intro-purpose">${escapeHtml(intro.purpose)}</p>
      <p class="intro-about">${escapeHtml(intro.about)}</p>
    </div>
    ${timelineHtml || contrastHtml ? `<div class="intro-visuals">${timelineHtml}${contrastHtml}</div>` : ''}
    <div class="intro-columns">
      <section>
        <h3>Focus</h3>
        <ul>${focusHtml}</ul>
      </section>
      <section>
        <h3>Examples</h3>
        ${examplesHtml}
      </section>
    </div>
    ${calloutsHtml ? `<div class="callouts">${calloutsHtml}</div>` : ''}
  </section>`;
}

function renderSection(section: ClassDocumentSection): string {
  const questionsHtml = section.questions.map(renderQuestion).join('\n');
  const promptsHtml = section.prompts.map(renderPrompt).join('\n');
  const writingHtml = section.writingPrompts.map(renderWritingPrompt).join('\n');
  const contentHtml = [questionsHtml, promptsHtml, writingHtml].filter(Boolean).join('\n');

  return `<section class="page" id="${escapeHtml(section.id)}">
    <header class="page-head">
      <div>
        <span class="section-label">${escapeHtml(section.skill.toLowerCase())}</span>
        <h2 class="section-title">${escapeHtml(section.title)}</h2>
        ${section.instructions ? `<p class="instructions">${escapeHtml(section.instructions)}</p>` : ''}
      </div>
      ${renderQr(section)}
    </header>
    <div class="content">
      ${contentHtml || '<p class="empty-note">This section has no printable workbook content yet.</p>'}
    </div>
  </section>`;
}

function renderQuestion(q: ClassDocumentSection['questions'][number], index: number): string {
  const optionsHtml = q.options
    .map((opt, oi) => {
      const letter = OPTION_LETTERS[oi] ?? String(oi + 1);
      const isCorrect = q.correctIndex === oi;
      return `<li class="option${isCorrect ? ' correct-option' : ''}">
        <span class="checkbox">${isCorrect ? '&#9745;' : '&#9744;'}</span>
        <span class="option-letter">${letter}.</span>
        <span class="option-text">${escapeHtml(opt)}</span>
      </li>`;
    })
    .join('\n');

  const passageHtml = q.passageText
    ? `<div class="passage-card">${q.passageRef ? `<span class="passage-ref">${escapeHtml(q.passageRef)}</span>` : ''}${escapeBlock(q.passageText)}</div>`
    : q.passageRef
      ? `<span class="passage-ref">${escapeHtml(q.passageRef)}</span>`
      : '';
  const explanationHtml = q.explanation
    ? `<p class="explanation"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</p>`
    : '';

  return `<article class="question">
    ${passageHtml}
    <p class="question-text"><span class="question-number">${index + 1}.</span>${escapeHtml(q.question)}</p>
    ${optionsHtml ? `<ol class="options">${optionsHtml}</ol>` : ''}
    ${explanationHtml}
    <div class="pencil-lines" aria-hidden="true">${lineRows(3)}</div>
  </article>`;
}

function renderPrompt(p: ClassDocumentSection['prompts'][number], index: number): string {
  const ipaHtml = p.ipa ? `<p class="ipa">${escapeHtml(p.ipa)}</p>` : '';
  return `<article class="prompt">
    <div class="prompt-index">${index + 1}</div>
    <div>
      <p class="target-phrase">${escapeHtml(p.targetPhrase)}</p>
      <p class="translation">${escapeHtml(p.translation)}</p>
      ${ipaHtml}
      <div class="pencil-lines" aria-hidden="true">${lineRows(2)}</div>
    </div>
  </article>`;
}

function renderWritingPrompt(
  p: ClassDocumentSection['writingPrompts'][number],
  index: number
): string {
  const guidanceHtml = p.guidance ? `<p class="guidance">${escapeHtml(p.guidance)}</p>` : '';
  return `<article class="writing-task">
    <p class="writing-title">${index + 1}. ${escapeHtml(p.task)}</p>
    ${guidanceHtml}
    <div class="writing-space" aria-hidden="true">${lineRows(10)}</div>
  </article>`;
}

function renderQr(section: ClassDocumentSection): string {
  if (!section.qrDataUrl) return '';
  const linkHtml = section.appLink ? `<p class="link-text">${escapeHtml(section.appLink)}</p>` : '';
  return `<div class="qr-card">
    <img src="${section.qrDataUrl}" alt="QR code to open ${escapeHtml(section.title)} in Sotto" />
    <span>Open web class</span>
    ${linkHtml}
  </div>`;
}

function renderAnswerKey(sections: ClassDocumentSection[]): string {
  const rows = sections
    .flatMap((section) =>
      section.questions
        .filter((q) => typeof q.correctIndex === 'number')
        .map((q, index) => {
          const answer =
            q.correctIndex == null
              ? ''
              : (OPTION_LETTERS[q.correctIndex] ?? String(q.correctIndex + 1));
          return `<li>
            <span class="toc-index">${escapeHtml(section.title)} ${index + 1}</span>
            <span class="toc-title">${escapeHtml(answer)}</span>
            <span class="toc-skill">${q.explanation ? escapeHtml(q.explanation) : ''}</span>
          </li>`;
        })
    )
    .join('\n');

  return `<section class="page">
    <header class="page-head">
      <div>
        <span class="section-label">Review</span>
        <h2 class="section-title">Answer key</h2>
      </div>
    </header>
    <ol class="toc">${rows || '<li><span class="toc-title">No answer key items.</span></li>'}</ol>
  </section>`;
}

function lineRows(count: number): string {
  return Array.from({ length: count }, () => '<span></span>').join('');
}

function escapeBlock(str: string): string {
  return escapeHtml(str).replace(/\n/g, '<br />');
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
