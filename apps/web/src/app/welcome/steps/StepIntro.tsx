'use client';

import { Glyph } from '../Glyph';
import t from '../theme.module.css';

interface Props {
  demoMode: boolean;
  onNext: () => void;
}

export function StepIntro({ demoMode, onNext }: Props) {
  return (
    <div className={t.stepEnter}>
      <div className={t.eyebrow}>
        <span className={t.eyebrowIdx}>00 ·</span> Welcome
      </div>
      <h1 className={t.title}>
        Welcome to <em>Sotto</em>.
      </h1>
      <p className={t.lede}>
        {demoMode
          ? 'Walk through the same setup flow a self-hosted household sees. This preview does not save a profile, course, key, or source connection.'
          : 'This self-hosted instance starts from a clean slate. First set up the admin learner, then Sotto will build the first private course around that profile.'}
      </p>

      <div className={t.actions}>
        <button className={`${t.btn} ${t.btnPrimary}`} onClick={onNext} type="button">
          Continue{' '}
          <span className={t.btnArrow}>
            <Glyph name="arrow" size={17} />
          </span>
        </button>
        <span className={t.spacer} />
        <span className={t.mlabel}>
          {demoMode ? 'public demo · no signup' : 'factory reset · initial setup'}
        </span>
      </div>
    </div>
  );
}
