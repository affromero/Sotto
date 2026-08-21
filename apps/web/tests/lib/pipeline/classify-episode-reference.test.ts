import { describe, it, expect } from 'vitest';
import { classifyEpisodeReference } from '@/lib/reference-verification/classify-episode-reference';

describe('classifyEpisodeReference', () => {
  it('keeps a web page out of ACADEMIC when it carries an unearned DOI', () => {
    // Real failure: a grammis page cited with the invented DOI
    // "10.14618/terminologie" classified ACADEMIC, faced the 0.82 threshold,
    // failed, and aborted the whole class generation.
    expect(
      classifyEpisodeReference({
        doi: '10.14618/terminologie',
        url: 'https://grammis.ids-mannheim.de/terminologie/396',
        type: 'WEB',
      })
    ).toBe('EDUCATIONAL');
  });

  it('classifies the same page identically whether or not the DOI is there', () => {
    const withDoi = classifyEpisodeReference({
      doi: '10.14618/terminologie',
      url: 'https://grammis.ids-mannheim.de/terminologie/396',
      type: 'WEB',
    });
    const withoutDoi = classifyEpisodeReference({
      doi: null,
      url: 'https://grammis.ids-mannheim.de/terminologie/396',
      type: 'WEB',
    });
    expect(withDoi).toBe(withoutDoi);
  });

  it('still routes a DOI-bearing paper to ACADEMIC', () => {
    expect(
      classifyEpisodeReference({
        doi: '10.2478/lf-2021-0015',
        url: 'https://example.org/paper',
        type: 'PAPER',
      })
    ).toBe('ACADEMIC');
  });

  it('still routes a DOI-bearing book to ACADEMIC', () => {
    expect(
      classifyEpisodeReference({
        doi: '10.1017/CBO9780511840777',
        url: null,
        type: 'BOOK',
      })
    ).toBe('ACADEMIC');
  });

  it('keeps a journal article on an academic host in ACADEMIC via its URL', () => {
    expect(
      classifyEpisodeReference({
        doi: '10.1038/s41586-023-06185-3',
        url: 'https://www.nature.com/articles/s41586-023-06185-3',
        type: 'ARTICLE',
      })
    ).toBe('ACADEMIC');
  });
});
