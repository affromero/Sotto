/**
 * CourseNotesPanel lets enrolled learners paste or upload official-course notes,
 * saving them to the course context and importing target-language vocab.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CourseNotesPanel } from '@/components/learn/CourseNotesPanel';

describe('CourseNotesPanel', () => {
  it('keeps original document links and imported text outside the note editor', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            body: 'Travel goals',
            materials: [
              {
                id: 'document-1',
                name: 'Vocab Deutsch.pdf',
                extractedText: 'Bahnhof means station.',
              },
            ],
          })
        )
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ body: '', addedVocabulary: 0 })));
    const user = userEvent.setup();
    render(<CourseNotesPanel courseId="c1" />);
    await user.click(screen.getByRole('button', { name: /course notes/i }));
    const editor = await screen.findByLabelText(/paste notes/i);
    await waitFor(() => expect(editor).toHaveValue('Travel goals'));
    const link = screen.getByRole('link', { name: 'Vocab Deutsch.pdf' });
    expect(link).toHaveAttribute('href', '/api/v1/materials/document-1/file');
    await user.click(screen.getByText('View imported text'));
    expect(screen.getByText('Bahnhof means station.')).toBeVisible();
    await user.clear(editor);
    await user.click(screen.getByRole('button', { name: /save notes/i }));
    await screen.findByText('Saved');
    expect(screen.getByRole('link', { name: 'Vocab Deutsch.pdf' })).toBeInTheDocument();
    expect(editor).toHaveValue('');
  });
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads existing notes and saves edits', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ body: 'capitolo uno' }), { status: 200 })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ body: 'capitolo due', addedVocabulary: 2 }), {
          status: 200,
        })
      );
    const user = userEvent.setup();

    render(<CourseNotesPanel courseId="c1" />);

    await user.click(screen.getByRole('button', { name: /course notes/i }));
    const textarea = await screen.findByLabelText(/paste notes from an official course/i);
    expect(textarea).toHaveValue('capitolo uno');
    expect(
      screen.getByText(/clearing and saving the notes does not remove vocabulary/i)
    ).toBeInTheDocument();

    await user.clear(textarea);
    await user.type(textarea, 'capitolo due');
    await user.click(screen.getByRole('button', { name: /save notes/i }));

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/v1/courses/c1/notes',
      expect.objectContaining({
        method: 'PUT',
        credentials: 'include',
        body: JSON.stringify({ body: 'capitolo due' }),
      })
    );
    expect(await screen.findByText(/Saved .* 2 vocab added/i)).toBeInTheDocument();
  });

  it('uploads all selected note files to the import endpoint', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ body: '' }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            body: 'Uploaded course note: official-2.md',
            imported: 2,
            failed: 0,
            addedVocabulary: 4,
          }),
          { status: 200 }
        )
      );
    const user = userEvent.setup();

    render(<CourseNotesPanel courseId="c1" />);

    await user.click(screen.getByRole('button', { name: /course notes/i }));
    await screen.findByLabelText(/paste notes from an official course/i);
    await user.type(
      screen.getByLabelText(/paste notes from an official course/i),
      'Unsaved learner draft'
    );
    await user.upload(screen.getByLabelText(/upload course note files/i), [
      new File(['ciao'], 'official-1.md', { type: 'text/markdown' }),
      new File(['arrivederci'], 'official-2.md', { type: 'text/markdown' }),
    ]);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/courses/c1/notes');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', credentials: 'include' });
    expect(fetchMock.mock.calls[1][1]?.body).toBeInstanceOf(FormData);
    expect(await screen.findByText(/Imported 2 files .* 4 vocab added/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/paste notes from an official course/i)).toHaveValue(
      'Unsaved learner draft'
    );
  });
});
