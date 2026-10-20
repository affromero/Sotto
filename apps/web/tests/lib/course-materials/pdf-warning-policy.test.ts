// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MaterialPdfWarnings } from '@/lib/course-materials/extraction/runtime/warnings';

const warning = 'Warning: AnnotationBorderStyle.setWidth - ignoring width: 1000';
const appearance = [{ hasAppearance: true, borderStyle: { width: 1, rawWidth: 1000 } }];
function observed(message = warning, version = '6.4.299') {
  const state = new MaterialPdfWarnings();
  state.setLibraryVersion(version);
  state.enterPage(7);
  state.observe('warn', [message]);
  return state;
}

describe('reviewed PDF annotation warning classification', () => {
  it('retains a static warning receipt while allowing complete appearance and raw-width comparison', () => {
    const state = observed();
    expect(state.hasBlockingWarnings).toBe(true);
    state.finalizePage(7, appearance, true);
    expect(state.hasBlockingWarnings).toBe(false);
    expect(state.snapshot()).toEqual([
      {
        pageNumber: 7,
        code: 'ANNOTATION_BORDER_WIDTH_NORMALIZED',
        count: 1,
        disposition: 'APPEARANCE_AND_RAW_WIDTH_PRESERVED',
      },
    ]);
  });
  it.each([
    { annotations: [] },
    { annotations: [{ hasAppearance: false, borderStyle: { width: 1, rawWidth: 1000 } }] },
    { annotations: [{ hasAppearance: true, borderStyle: { width: 1 } }] },
    { annotations: [{ hasAppearance: true, borderStyle: { width: NaN, rawWidth: 1000 } }] },
    {
      annotations: [
        ...appearance,
        { hasAppearance: false, borderStyle: { width: 1, rawWidth: 1 } },
      ],
    },
  ])(
    'blocks warning recovery without complete finite-width appearance inventory: %j',
    ({ annotations }) => {
      const state = observed();
      state.finalizePage(7, annotations, true);
      expect(state.hasBlockingWarnings).toBe(true);
    }
  );
  it('requires successful complete page evidence even when appearances exist', () => {
    const state = observed();
    state.finalizePage(7, appearance, false);
    expect(state.hasBlockingWarnings).toBe(true);
  });
  it.each([
    'Warning: AnnotationBorderStyle.setWidth - ignoring width: Infinity',
    'Warning: AnnotationBorderStyle.setWidth - ignoring width: 1e999',
    'Warning: AnnotationBorderStyle.setWidth - ignoring width: -1',
    warning + ' source text',
    warning.toLowerCase(),
    'Warning: Unknown parser recovery',
  ])('keeps every unreviewed message blocked and stores no message text: %s', (message) => {
    const state = observed(message);
    state.finalizePage(7, appearance, true);
    expect(state.snapshot()).toEqual([
      { pageNumber: 7, code: 'UNKNOWN', count: 1, disposition: 'BLOCKING' },
    ]);
  });
  it('blocks startup warnings and warnings from unreviewed library versions', () => {
    const state = new MaterialPdfWarnings();
    state.setLibraryVersion('6.4.299');
    state.observe('warn', [warning]);
    state.enterPage(7);
    state.finalizePage(7, appearance, true);
    expect(state.hasBlockingWarnings).toBe(true);
    const changed = observed(warning, '6.4.300');
    changed.finalizePage(7, appearance, true);
    expect(changed.hasBlockingWarnings).toBe(true);
  });
  it('does not let one page inventory approve another page warnings', () => {
    const state = observed();
    state.enterPage(8);
    state.observe('warn', [warning]);
    state.finalizePage(8, appearance, true);
    state.leavePage();
    expect(state.pageBlocks(7)).toBe(true);
    expect(state.pageBlocks(8)).toBe(false);
    expect(state.hasBlockingWarnings).toBe(true);
  });
});
