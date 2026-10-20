import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourseNotesPanel } from '@/components/learn/CourseNotesPanel';
import { UploadServer } from '../helpers/materials/uploads';

const props = { nativeLang: 'en', targetLang: 'de' };
const materialId = '00000000-0000-4000-8000-000000000001';
const material = (id = materialId, name = 'Vocab Deutsch.pdf', legacy = false) => ({
  id,
  name,
  mimeType: 'application/pdf',
  byteSize: 42,
  createdAt: '2026-10-01T00:00:00.000Z',
  fileUrl: `/api/v1/materials/${id}/file`,
  extractedText: '',
  textRetained: legacy,
  processingUrl: `/api/v1/materials/${id}/processing`,
  legacyTextUrl: legacy ? `/api/v1/materials/${id}/legacy-text` : null,
});
const page = (
  body: string,
  materials: ReturnType<typeof material>[] = [],
  nextCursor: string | null = null
) => ({ body, materials, nextCursor });
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
function install(
  notes: (url: string, init?: RequestInit) => Response | Promise<Response>,
  upload?: UploadServer
) {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === '/api/v1/users/me') return Response.json({ id: 'owner' });
    if (url.includes('/materials/uploads') && upload) return upload.fetch(input, init);
    if (url.split('?')[0].endsWith('/notes')) return notes(url, init);
    if (url.includes('/legacy-text'))
      return Response.json({
        materialId,
        origin: 'LEGACY_EMBEDDED_TEXT',
        offset: 0,
        totalCodePoints: 22,
        text: 'Bahnhof means station.',
        nextOffset: null,
      });
    return Response.json({ error: 'Source processing is unavailable.' }, { status: 503 });
  });
}
async function open() {
  await userEvent.click(screen.getByRole('button', { name: /course notes/i }));
  const editor = screen.getByRole('textbox', { name: /paste notes/i });
  await waitFor(() => expect(editor).toBeEnabled());
  return editor;
}

describe('CourseNotesPanel', () => {
  it('waits for the initial note inventory before enabling original uploads', async () => {
    const pending = Promise.withResolvers<Response>();
    install(() => pending.promise);
    render(<CourseNotesPanel courseId="c1" {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /course notes/i }));
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(screen.queryByLabelText('Choose original files')).toBeNull();
    pending.resolve(Response.json(page('Initial note')));
    await screen.findByLabelText('Choose original files');
    expect(screen.getByRole('textbox')).toHaveValue('Initial note');
  });
  it('discards a previous course’s delayed notes when the course changes', async () => {
    const old = Promise.withResolvers<Response>();
    install((url) =>
      url.includes('/old/') ? old.promise : Response.json(page('New course notes'))
    );
    const view = render(<CourseNotesPanel courseId="old" {...props} />);
    await userEvent.click(screen.getByRole('button', { name: /course notes/i }));
    expect(screen.getByRole('textbox')).toBeDisabled();
    view.rerender(<CourseNotesPanel courseId="new" {...props} />);
    old.resolve(Response.json(page('Private old notes')));
    const editor = await open();
    await waitFor(() => expect(editor).toHaveValue('New course notes'));
    expect(screen.queryByText('Private old notes')).not.toBeInTheDocument();
  });
  it('keeps original links and imported text after editable notes are cleared', async () => {
    install((_url, init) =>
      Response.json(
        init?.method === 'PUT'
          ? { body: '' }
          : page('Travel goals', [material(materialId, 'Vocab Deutsch.pdf', true)])
      )
    );
    render(<CourseNotesPanel courseId="c1" {...props} />);
    const editor = await open();
    await waitFor(() => expect(editor).toHaveValue('Travel goals'));
    expect(screen.getByRole('link', { name: 'Vocab Deutsch.pdf' })).toHaveAttribute(
      'href',
      `/api/v1/materials/${materialId}/file`
    );
    await userEvent.click(screen.getByRole('button', { name: 'Read imported text from start' }));
    expect(await screen.findByText('Bahnhof means station.')).toBeVisible();
    await userEvent.clear(editor);
    await userEvent.click(screen.getByRole('button', { name: /save notes/i }));
    await screen.findByText('Saved');
    expect(editor).toHaveValue('');
    expect(screen.getByRole('link', { name: 'Vocab Deutsch.pdf' })).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'View vocabulary and import progress' })
    ).toHaveAttribute('href', '/learn/vocabulary?course=c1');
  });
  it('saves the exact edited note through its owned course endpoint', async () => {
    let saved: unknown;
    install((_url, init) => {
      if (init?.method !== 'PUT') return Response.json(page('Earlier note'));
      saved = JSON.parse(String(init.body));
      return Response.json({ body: 'Current note', addedVocabulary: 2 });
    });
    render(<CourseNotesPanel courseId="c1" {...props} />);
    const editor = await open();
    await waitFor(() => expect(editor).toHaveValue('Earlier note'));
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Current note');
    await userEvent.click(screen.getByRole('button', { name: /save notes/i }));
    await screen.findByText(/Saved .* 2 vocab added/);
    expect(saved).toEqual({ body: 'Current note' });
  });
  it('retains a complete original through bounded transfer and preserves unsaved notes on refresh', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const upload = new UploadServer();
    upload.finishDirectly = true;
    install(
      () =>
        Response.json(
          page(
            'Server note',
            upload.batch ? [material(upload.batch.uploads[0]!.materialId, 'Original.pdf')] : []
          )
        ),
      upload
    );
    render(<CourseNotesPanel courseId="c1" {...props} />);
    const editor = await open();
    await waitFor(() => expect(editor).toHaveValue('Server note'));
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Unsaved learner draft');
    const file = new NodeFile(['complete original'], 'Original.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Choose original files'), { target: { files: [file] } });
    const submit = screen.getByRole('button', { name: 'Upload originals' });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await screen.findByRole('link', { name: 'Original.pdf' });
    expect(editor).toHaveValue('Unsaved learner draft');
    expect(upload.batch?.uploads[0]?.status).toBe('COMPLETE');
    expect(upload.courseId).toBe('c1');
  });
  it('appends one bounded material page using its exact cursor without replacing an edited note', async () => {
    const pending = Promise.withResolvers<Response>();
    const cursor = 'saved+cursor/with?characters';
    let requested = '';
    install((url) => {
      if (!url.includes('?')) return Response.json(page('Saved note', [material()], cursor));
      requested = url;
      return pending.promise;
    });
    render(<CourseNotesPanel courseId="c1" {...props} />);
    const editor = await open();
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Unsaved learner changes');
    await userEvent.click(screen.getByRole('button', { name: 'Load more materials' }));
    expect(screen.getByRole('button', { name: 'Reading more materials...' })).toBeDisabled();
    expect(new URL(requested, 'http://localhost').searchParams.get('after')).toBe(cursor);
    pending.resolve(
      Response.json(
        page('Stale saved note', [
          material('00000000-0000-4000-8000-000000000002', 'Second source.pdf'),
        ])
      )
    );
    await screen.findByRole('link', { name: 'Second source.pdf' });
    expect(screen.getByRole('link', { name: 'Vocab Deutsch.pdf' })).toBeInTheDocument();
    expect(editor).toHaveValue('Unsaved learner changes');
    expect(screen.queryByRole('button', { name: 'Load more materials' })).toBeNull();
  });
  it('rejects a repeated cursor before applying material rows from an invalid page', async () => {
    install((url) =>
      Response.json(
        url.includes('?')
          ? page(
              'Ignored note',
              [material('00000000-0000-4000-8000-000000000002', 'Invalid page.pdf')],
              'same-cursor'
            )
          : page('Owned note', [material()], 'same-cursor')
      )
    );
    render(<CourseNotesPanel courseId="c1" {...props} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Load more materials' }));
    expect(
      await screen.findByText(
        'The material cursor did not advance. Refresh the course before continuing.'
      )
    ).toHaveAttribute('role', 'alert');
    expect(screen.queryByRole('link', { name: 'Invalid page.pdf' })).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue('Owned note');
  });
  it('discards a previous course pagination response even when the transport ignores cancellation', async () => {
    const pending = Promise.withResolvers<Response>();
    install((url) => {
      if (url.includes('?')) return pending.promise;
      return Response.json(
        url.includes('/old/')
          ? page('Old note', [material()], 'old-cursor')
          : page('New note', [
              material('00000000-0000-4000-8000-000000000002', 'New course source.pdf'),
            ])
      );
    });
    const view = render(<CourseNotesPanel courseId="old" {...props} />);
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Load more materials' }));
    await screen.findByRole('button', { name: 'Reading more materials...' });
    view.rerender(<CourseNotesPanel courseId="new" {...props} />);
    const editor = await open();
    await screen.findByRole('link', { name: 'New course source.pdf' });
    await act(async () =>
      pending.resolve(
        Response.json(
          page('Private old note', [
            material('00000000-0000-4000-8000-000000000003', 'Private old source.pdf'),
          ])
        )
      )
    );
    await waitFor(() => expect(editor).toHaveValue('New note'));
    expect(screen.queryByRole('link', { name: 'Private old source.pdf' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Vocab Deutsch.pdf' })).toBeNull();
  });
  it('keeps an upload refresh authoritative over an older pending material page', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const pending = Promise.withResolvers<Response>();
    const upload = new UploadServer();
    upload.finishDirectly = true;
    install((url) => {
      if (url.includes('?')) return pending.promise;
      return Response.json(
        upload.batch
          ? page('Saved server note', [
              material(),
              material(upload.batch.uploads[0]!.materialId, 'New original.pdf'),
            ])
          : page('Saved server note', [material()], 'older-page')
      );
    }, upload);
    render(<CourseNotesPanel courseId="c1" {...props} />);
    const editor = await open();
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Private unsaved changes');
    await userEvent.click(screen.getByRole('button', { name: 'Load more materials' }));
    await screen.findByRole('button', { name: 'Reading more materials...' });
    fireEvent.change(screen.getByLabelText('Choose original files'), {
      target: {
        files: [
          new NodeFile(['complete original'], 'New original.pdf', { type: 'application/pdf' }),
        ],
      },
    });
    const submit = screen.getByRole('button', { name: 'Upload originals' });
    await waitFor(() => expect(submit).toBeEnabled());
    await userEvent.click(submit);
    await screen.findByRole('link', { name: 'New original.pdf' });
    await act(async () =>
      pending.resolve(
        Response.json(
          page(
            'Stale server note',
            [material('00000000-0000-4000-8000-000000000003', 'Stale page source.pdf')],
            'stale-next'
          )
        )
      )
    );
    expect(screen.queryByRole('link', { name: 'Stale page source.pdf' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Load more materials' })).toBeNull();
    expect(editor).toHaveValue('Private unsaved changes');
  });
});
