import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StepPlacement } from '@/app/welcome/steps/StepPlacement';
import { partialMaterialCoverage } from '../../helpers/materials/analysis';

afterEach(() => vi.unstubAllGlobals());
describe('onboarding source placement', () => {
  it.each(['manual', 'edited source'])(
    'ignores a late source estimate after choosing %s',
    async (choice) => {
      let release: (response: Response) => void = () => {};
      const pending = new Promise<Response>((resolve) => {
        release = resolve;
      });
      const fetch = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: 'owner' }))
        .mockResolvedValueOnce(Response.json({ id: 'owner' }))
        .mockResolvedValueOnce(
          Response.json({
            analysisId: '6855420c-d68a-49c1-bd3c-f29dd8cb7f84',
            analysisRevision: 1,
            status: 'RUNNING',
            resultDigest: null,
          })
        )
        .mockImplementationOnce(() => pending);
      vi.stubGlobal('fetch', fetch);
      const choose = vi.fn(),
        onAnalysis = vi.fn();
      render(
        <StepPlacement
          baseLang="en"
          language="de"
          understood={new Set()}
          toggleUnderstood={choose}
          onAnalysis={onAnalysis}
          level={null}
          onNext={() => {}}
          onBack={() => {}}
        />
      );
      fireEvent.click(screen.getByRole('button', { name: /upload notes or material/i }));
      fireEvent.change(screen.getByLabelText(/notes, lesson material, or writing sample/i), {
        target: { value: 'Original source' },
      });
      fireEvent.click(screen.getByRole('button', { name: /estimate from material/i }));
      await screen.findByRole('button', { name: /reading the saved analysis status/i });
      if (choice === 'manual') {
        fireEvent.click(screen.getByRole('button', { name: /back/i }));
        fireEvent.click(screen.getByRole('button', { name: /choose my CEFR level/i }));
        fireEvent.click(screen.getByRole('button', { name: /C1/i }));
      } else {
        fireEvent.change(screen.getByLabelText(/notes, lesson material, or writing sample/i), {
          target: { value: 'Different source' },
        });
      }
      await act(async () =>
        release(
          Response.json({
            analysisId: '6855420c-d68a-49c1-bd3c-f29dd8cb7f84',
            analysisRevision: 1,
            status: 'COMPLETE',
            resultDigest: 'a'.repeat(64),
            summary: {
              focusCount: 1,
              inference: { level: 'A2', confidence: 0.8, rationale: 'Old source estimate' },
            },
          })
        )
      );
      expect(screen.queryByText('Old source estimate')).not.toBeInTheDocument();
      expect(onAnalysis).toHaveBeenLastCalledWith(null);
      expect(choose.mock.calls.map(([level]) => level)).toEqual(choice === 'manual' ? ['C1'] : []);
    }
  );
  it('keeps an unsupported source estimate unassigned instead of silently choosing A1', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: 'owner' }))
        .mockResolvedValueOnce(Response.json({ id: 'owner' }))
        .mockResolvedValueOnce(
          Response.json({
            analysisId: '6855420c-d68a-49c1-bd3c-f29dd8cb7f84',
            analysisRevision: 1,
            status: 'INSUFFICIENT_SOURCE',
            resultDigest: 'a'.repeat(64),
          })
        )
        .mockResolvedValueOnce(
          Response.json({
            analysisId: '6855420c-d68a-49c1-bd3c-f29dd8cb7f84',
            analysisRevision: 1,
            status: 'INSUFFICIENT_SOURCE',
            resultDigest: 'a'.repeat(64),
            summary: { focusCount: 0, inference: null },
          })
        )
    );
    const choose = vi.fn();
    render(
      <StepPlacement
        baseLang="en"
        language="de"
        understood={new Set()}
        toggleUnderstood={choose}
        level={null}
        onNext={() => {}}
        onBack={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /upload notes or material/i }));
    fireEvent.change(screen.getByLabelText(/notes, lesson material, or writing sample/i), {
      target: { value: 'Unresolved source' },
    });
    fireEvent.click(screen.getByRole('button', { name: /estimate from material/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('do not support a level estimate');
    expect(choose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /compose my course/i })).toBeDisabled();
  });
  it('records the exact partial analysis only after the learner accepts unresolved coverage', async () => {
    const analysis = {
      analysisId: '6855420c-d68a-49c1-bd3c-f29dd8cb7f84',
      analysisRevision: 1,
      status: 'PARTIAL',
      coverage: partialMaterialCoverage,
      resultDigest: 'a'.repeat(64),
      summary: {
        focusCount: 3,
        inference: { level: 'A2', confidence: 0.4, rationale: 'Some pages remain unresolved.' },
      },
    };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id: 'owner' }))
        .mockResolvedValueOnce(Response.json({ id: 'owner' }))
        .mockResolvedValueOnce(Response.json(analysis))
        .mockResolvedValueOnce(Response.json(analysis))
    );
    const choose = vi.fn(),
      onAnalysis = vi.fn();
    render(
      <StepPlacement
        baseLang="en"
        language="de"
        understood={new Set()}
        toggleUnderstood={choose}
        onAnalysis={onAnalysis}
        level={null}
        onNext={() => {}}
        onBack={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /upload notes or material/i }));
    fireEvent.change(screen.getByLabelText(/notes, lesson material, or writing sample/i), {
      target: { value: 'Source class' },
    });
    fireEvent.click(screen.getByRole('button', { name: /estimate from material/i }));
    fireEvent.click(
      await screen.findByRole('checkbox', { name: /reviewed the unresolved source coverage/i })
    );
    expect(choose).toHaveBeenCalledWith('A2');
    expect(onAnalysis).toHaveBeenLastCalledWith({
      level: 'A2',
      reference: {
        analysisId: analysis.analysisId,
        analysisRevision: 1,
        resultDigest: analysis.resultDigest,
        acceptPartial: true,
      },
    });
    fireEvent.change(screen.getByLabelText(/notes, lesson material, or writing sample/i), {
      target: { value: 'Different unanalyzed source' },
    });
    expect(onAnalysis).toHaveBeenLastCalledWith(null);
    expect(screen.queryByText('Some pages remain unresolved.')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /compose my course/i })).toBeDisabled();
  });
});
