import { expect, it, type Mock } from 'vitest';
import { generateSectionQuestions, type SectionGenParams } from '@/lib/class-generation';
import type { SourceDocuments } from '@/lib/providers/ai';
import { VOCABULARY_TASK_CONTEXT } from '../../helpers/runtime/section-generation';

export function registerSourceMaterialTests(
  base: SectionGenParams,
  selection: Mock,
  author: Mock,
  reviewer: Mock
) {
  it('uses original PDFs to author vocabulary questions without exposing them to blind review', async () => {
    const sourceDocuments: SourceDocuments = {
      parts: [
        {
          type: 'document',
          mediaType: 'application/pdf',
          name: 'Workbook.pdf',
          data: Buffer.from('%PDF-1.7'),
        },
      ],
      validate: async () => {},
    };
    selection.mockResolvedValue({
      provider: 'anthropic',
      model: 'm',
      execution: { ...base.execution, sourceDocuments },
    });
    author.mockResolvedValue({
      content: JSON.stringify({
        passage: '',
        questions: [
          {
            question: 'Mia hat gestern einen Film _____.',
            options: ['gesehen', 'gelesen', 'geschrieben', 'gehört'],
            correctIndex: 0,
            explanation: 'Man sieht einen Film.',
          },
        ],
      }),
      inputTokens: 1,
      outputTokens: 1,
      model: 'm',
    });
    const result = await generateSectionQuestions({
      ...base,
      skill: 'GRAMMAR',
      vocabularyReview: true,
      targetLang: 'de',
      targetVocab: [{ lemma: 'gesehen', gloss: 'seen' }],
    });
    expect(result[0]).toMatchObject({
      question: `${VOCABULARY_TASK_CONTEXT}\nMia hat gestern einen Film _____.`,
      correctIndex: 0,
    });
    expect(author.mock.calls[0][1][0].content).toContain('1 vocabulary');
    expect(author.mock.calls[0][2].sourceDocuments).toBe(sourceDocuments);
    for (const request of reviewer.mock.calls) expect(request[2]?.sourceDocuments).toBeUndefined();
  });
}
