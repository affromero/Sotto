// Pure function — no imports beyond the ClassDocument type.
// Returns a standalone, print-optimized HTML document for a class worksheet.
import type { ClassDocument } from '@sotto/shared';

export function renderWorksheetHtml(doc: ClassDocument): string {
  const optionLetters = ['A', 'B', 'C', 'D', 'E', 'F'];

  const sectionsHtml = doc.sections
    .map((section) => {
      const questionsHtml = section.questions
        .map((q, qi) => {
          const optionsHtml = q.options
            .map((opt, oi) => {
              const letter = optionLetters[oi] ?? String(oi + 1);
              const isCorrect = doc.isAnswerKey && q.correctIndex === oi;
              return `<li class="option${isCorrect ? ' correct-option' : ''}"><span class="checkbox">${isCorrect ? '&#9745;' : '&#9744;'}</span><span class="option-letter">${letter}.</span> <span class="option-text">${escapeHtml(opt)}</span></li>`;
            })
            .join('\n');
          const passageNote = q.passageRef
            ? `<span class="passage-ref">[${escapeHtml(q.passageRef)}]</span> `
            : '';
          const explanationHtml =
            doc.isAnswerKey && q.explanation
              ? `<p class="explanation"><strong>Explanation:</strong> ${escapeHtml(q.explanation)}</p>`
              : '';
          return `<div class="question">
  <p class="question-text"><span class="question-number">${qi + 1}.</span> ${passageNote}${escapeHtml(q.question)}</p>
  <ul class="options">${optionsHtml}</ul>
  ${explanationHtml}
</div>`;
        })
        .join('\n');

      const promptsHtml = section.prompts
        .map((p) => {
          const ipaHtml = p.ipa ? `<span class="ipa">${escapeHtml(p.ipa)}</span>` : '';
          return `<div class="prompt">
  <p class="target-phrase">${escapeHtml(p.targetPhrase)}</p>
  <p class="translation">${escapeHtml(p.translation)}</p>
  ${ipaHtml}
</div>`;
        })
        .join('\n');

      const qrHtml =
        section.qrDataUrl
          ? `<div class="qr-block"><img class="qr-code" src="${section.qrDataUrl}" alt="QR code to open in app" /></div>`
          : '';

      const hasContent = section.questions.length > 0 || section.prompts.length > 0;

      return `<section class="worksheet-section">
  <div class="section-header">
    <h2 class="section-title">${escapeHtml(section.title)}</h2>
    ${qrHtml}
  </div>
  ${section.instructions ? `<p class="section-instructions">${escapeHtml(section.instructions)}</p>` : ''}
  ${hasContent ? `<div class="section-content">${questionsHtml}${promptsHtml}</div>` : ''}
</section>`;
    })
    .join('\n');

  const answerKeyBadge = doc.isAnswerKey
    ? '<span class="answer-key-badge">Answer Key</span>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(doc.title)} — Worksheet</title>
  <style>
    /* ---------- Reset & Base ---------- */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html { font-size: 11pt; }
    body {
      font-family: Inter, 'Helvetica Neue', Arial, sans-serif;
      background: #FEFCF8;
      color: #1A1A1A;
      padding: 0;
    }

    /* ---------- Page layout ---------- */
    .page {
      max-width: 210mm;
      margin: 0 auto;
      padding: 18mm 20mm 24mm;
    }
    @page { size: A4; margin: 18mm 20mm 24mm; }
    @media print {
      body { background: #fff; }
      .page { max-width: none; padding: 0; }
    }

    /* ---------- Header ---------- */
    .doc-header {
      border-bottom: 3px solid #D97706;
      padding-bottom: 10pt;
      margin-bottom: 18pt;
    }
    .doc-header-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12pt;
    }
    .doc-title {
      font-family: 'DM Serif Display', 'Georgia', serif;
      font-size: 22pt;
      font-weight: 700;
      color: #1E3A5F;
      line-height: 1.15;
    }
    .doc-meta {
      margin-top: 6pt;
      font-size: 9pt;
      color: #6B7280;
      display: flex;
      flex-wrap: wrap;
      gap: 10pt;
    }
    .doc-meta span { white-space: nowrap; }
    .doc-level {
      display: inline-block;
      background: #D97706;
      color: #fff;
      font-size: 8pt;
      font-weight: 700;
      padding: 2pt 7pt;
      border-radius: 4pt;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .doc-objective {
      margin-top: 8pt;
      font-size: 9.5pt;
      color: #374151;
      font-style: italic;
    }
    .answer-key-badge {
      display: inline-block;
      background: #1E3A5F;
      color: #fff;
      font-size: 8pt;
      font-weight: 700;
      padding: 3pt 10pt;
      border-radius: 4pt;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ---------- Sections ---------- */
    .worksheet-section {
      margin-bottom: 22pt;
      break-inside: avoid-column;
    }
    .section-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12pt;
      margin-bottom: 6pt;
    }
    .section-title {
      font-family: 'DM Serif Display', 'Georgia', serif;
      font-size: 14pt;
      color: #1E3A5F;
      font-weight: 700;
    }
    .section-instructions {
      font-size: 9.5pt;
      color: #6B7280;
      margin-bottom: 10pt;
      font-style: italic;
    }
    .section-content { }

    /* ---------- QR Code ---------- */
    .qr-block { flex-shrink: 0; }
    .qr-code { width: 54pt; height: 54pt; display: block; }

    /* ---------- Questions ---------- */
    .question { margin-bottom: 12pt; break-inside: avoid; }
    .question-number { font-weight: 700; color: #D97706; margin-right: 3pt; }
    .question-text { font-size: 10.5pt; margin-bottom: 5pt; line-height: 1.45; }
    .passage-ref { font-size: 8.5pt; color: #6B7280; font-style: italic; }
    .options { list-style: none; padding-left: 12pt; }
    .options li { margin-bottom: 3pt; font-size: 10pt; line-height: 1.4; display: flex; align-items: baseline; gap: 5pt; }
    .checkbox { font-size: 11pt; line-height: 1; }
    .option-letter { font-weight: 600; min-width: 14pt; }
    .option-text { }
    .correct-option .option-text { font-weight: 700; color: #1E3A5F; }
    .correct-option .option-letter { color: #D97706; }
    .explanation { margin-top: 5pt; font-size: 9pt; color: #374151; padding-left: 12pt; }

    /* ---------- Speaking Prompts ---------- */
    .prompt { margin-bottom: 11pt; break-inside: avoid; padding: 7pt 10pt; border-left: 3pt solid #D97706; background: #FEFCF8; }
    .target-phrase { font-size: 11.5pt; font-weight: 700; color: #1E3A5F; margin-bottom: 3pt; }
    .translation { font-size: 9.5pt; color: #6B7280; margin-bottom: 2pt; }
    .ipa { font-size: 9pt; color: #374151; font-style: italic; letter-spacing: 0.03em; }

    /* ---------- Print overrides ---------- */
    @media print {
      .worksheet-section { break-inside: avoid; }
      a { text-decoration: none; color: inherit; }
    }
  </style>
</head>
<body>
<div class="page">
  <header class="doc-header">
    <div class="doc-header-top">
      <div>
        <h1 class="doc-title">${escapeHtml(doc.title)}</h1>
        <div class="doc-meta">
          <span class="doc-level">${escapeHtml(doc.level)}</span>
          <span>${escapeHtml(doc.targetLang.toUpperCase())} from ${escapeHtml(doc.nativeLang.toUpperCase())}</span>
        </div>
        ${doc.objective ? `<p class="doc-objective">${escapeHtml(doc.objective)}</p>` : ''}
      </div>
      ${answerKeyBadge}
    </div>
  </header>
  <main>
    ${sectionsHtml}
  </main>
</div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}
