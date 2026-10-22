import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { DictionaryWord } from '@sotto/shared';
import { VocabularyStudio } from '@/components/learn/vocabulary/VocabularyStudio';
import type { VocabularyImport } from '@/components/learn/vocabulary/VocabularyImports';

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn() }) }));

const fetchMock = vi.fn<typeof fetch>();
const endpoint = '/api/v1/courses/german/vocabulary?search=&state=all&page=1';
const importedWord: DictionaryWord = {
  id: 'word-1',
  lemma: 'Bahnhof',
  translation: 'station',
  acceptedMeanings: ['train station'],
  partOfSpeech: 'noun',
  pronunciation: null,
  mastery: 0,
  state: 'unseen',
  dueAt: null,
  lastReviewed: null,
  reviews: 0,
  sourceCount: 1,
  sources: [
    {
      materialId: 'material-1',
      name: 'Deutsch.txt',
      startOffset: 0,
      endOffset: 7,
      quote: 'Bahnhof = station',
      coordinateSystem: 'MATERIAL_CODEPOINTS',
      meaning: 'station',
    },
  ],
};

function dictionary(material: Partial<VocabularyImport> = {}, words: DictionaryWord[] = []) {
  return {
    words,
    total: words.length,
    page: 1,
    pages: 1,
    counts: { unseen: words.length, due: 0, strong: 0 },
    vocabularySupport: null,
    materials: [
      {
        id: 'material-1',
        name: 'Deutsch.txt',
        status: 'PENDING',
        error: null,
        processedChunks: 0,
        totalChunks: 0,
        entries: 0,
        ...material,
      },
    ],
  };
}

async function advance(milliseconds: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('vocabulary import progress', () => {
  it('follows extraction and indexing until imported words appear, then stops polling', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(dictionary()))
      .mockResolvedValueOnce(Response.json(dictionary({ totalChunks: 2 })))
      .mockResolvedValueOnce(
        Response.json(dictionary({ status: 'ACTIVE', totalChunks: 2, processedChunks: 1 }))
      )
      .mockImplementation(async () =>
        Response.json(
          dictionary({ status: 'COMPLETE', totalChunks: 2, processedChunks: 2, entries: 1 }, [
            importedWord,
          ])
        )
      );
    render(<VocabularyStudio courseId="german" courseName="German" support={null} />);

    await advance(0);
    const imports = within(screen.getByRole('region', { name: 'Material vocabulary imports' }));
    expect(imports.getByText('Queued')).toBeVisible();
    expect(imports.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(imports.queryByRole('button', { name: 'Index all vocabulary' })).not.toBeInTheDocument();

    await advance(4000);
    expect(imports.getByText('Queued')).toBeVisible();
    expect(imports.getByRole('progressbar')).toHaveAttribute('value', '0');
    expect(imports.getByRole('progressbar')).toHaveAttribute('max', '2');

    await advance(4000);
    expect(imports.getByText('Indexing vocabulary')).toBeVisible();
    expect(imports.getByRole('progressbar')).toHaveAttribute('value', '1');
    expect(screen.queryByText('Bahnhof')).not.toBeInTheDocument();

    await advance(4000);
    expect(imports.getByText('Coverage verified')).toBeVisible();
    expect(imports.getByRole('progressbar')).toHaveAttribute('value', '2');
    expect(screen.getByText('Bahnhof')).toBeVisible();
    expect(screen.getByText('station')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Select Bahnhof' })).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe(endpoint);
      expect(options?.method ?? 'GET').toBe('GET');
    }

    const completedRequests = fetchMock.mock.calls.length;
    await advance(60000);
    expect(fetchMock).toHaveBeenCalledTimes(completedRequests);
    expect(imports.getByText('Coverage verified')).toBeVisible();
    expect(screen.getByText('Bahnhof')).toBeVisible();
  });

  it('leaves genuinely unindexed material available for manual indexing without polling', async () => {
    fetchMock.mockImplementation(async () => Response.json(dictionary({ status: 'NOT_INDEXED' })));
    render(<VocabularyStudio courseId="german" courseName="German" support={null} />);

    await advance(0);
    expect(screen.getByText('Ready to index')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Index all vocabulary' })).toBeEnabled();

    await advance(60000);
    expect(screen.getByText('Ready to index')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Index all vocabulary' })).toBeEnabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
    expect(fetchMock.mock.calls[0]![1]?.method ?? 'GET').toBe('GET');
  });
});
