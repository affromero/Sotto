// @vitest-environment jsdom
import { File as NodeFile } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StepContext } from '@/app/welcome/steps/StepContext';
import type { ContextItem } from '@/app/welcome/WelcomeFlow';
import { UploadServer } from '../../helpers/materials/uploads';
import { readBrowserUploadCheckpoint } from '@/lib/course-materials/client/browser-checkpoint';

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
describe('welcome original material transport', () => {
  it('resumes a retained original larger than ten MiB after lost acknowledgement and reload using bounded parts', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('File', NodeFile);
    const server = new UploadServer();
    server.loseAdmission = true;
    server.finishDirectly = true;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/users/me') return Response.json({ id: 'owner' });
      expect(new Headers(init?.headers).get('x-sotto-expected-profile-id')).toBe('owner');
      return server.fetch(input, init);
    });
    const file = new NodeFile([new Uint8Array(11 * 1_048_576 + 7)], 'full-source.pdf', {
      type: 'application/pdf',
    }) as File;
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => {
        throw new Error('The original file must never be read as one buffer.');
      },
    });
    let retained: ContextItem[] = [];
    const props = {
      contextItems: retained,
      setContextItems: (update: React.SetStateAction<ContextItem[]>) => {
        retained = typeof update === 'function' ? update(retained) : update;
      },
      demoMode: false,
      uploadScope: 'welcome:en:de:saved-request',
      onNext: () => {},
      onBack: () => {},
    };
    const first = render(<StepContext {...props} />);
    fireEvent.change(screen.getByLabelText('Choose context files'), {
      target: { files: [file] },
    });
    expect(await screen.findByText(/connection interrupted/i)).toBeTruthy();
    const checkpoint = readBrowserUploadCheckpoint('owner', props.uploadScope);
    expect(checkpoint).not.toBeNull();
    expect(checkpoint!.expectedProfileId).toBe('owner');
    const requestId = checkpoint!.request.requestId;
    first.unmount();
    render(<StepContext {...props} />);
    fireEvent.change(screen.getByLabelText('Choose context files'), {
      target: { files: [file] },
    });
    await waitFor(
      () =>
        expect(
          retained,
          `${document.body.textContent?.slice(-1400)} Requests: ${JSON.stringify(server.calls)}`
        ).toHaveLength(1),
      { timeout: 10_000 }
    );
    expect(retained[0]).toMatchObject({
      kind: 'file',
      label: 'full-source.pdf',
      value: '',
      materialId: server.batch!.uploads[0]!.materialId,
    });
    expect(server.batch!.requestId).toBe(requestId);
    expect(server.partReads).toEqual([4_194_304, 4_194_304, 3_145_735]);
    expect(server.calls).not.toContain('POST /api/v1/materials');
    expect(readBrowserUploadCheckpoint('owner', props.uploadScope)).toBeNull();
  });
});
