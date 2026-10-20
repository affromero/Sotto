'use client';

import { defaultMapView, skills, statuses, type MapViewState } from './state';
import styles from './MapFilters.module.css';

interface Props {
  value: MapViewState;
  onChange: (value: MapViewState) => void;
  disabled: boolean;
  count: number;
  total: number;
}
const label = (text: string) => (text === 'ALL' ? 'All' : text.toLowerCase().replaceAll('_', ' '));
export function MapFilters({ value, onChange, disabled, count, total }: Props) {
  const update = (patch: Partial<MapViewState>) => onChange({ ...value, ...patch, objective: '' });
  return (
    <section className={styles.root} aria-label="Find objectives">
      <label className={styles.search}>
        Search objectives
        <input
          type="search"
          value={value.search}
          maxLength={500}
          disabled={disabled}
          placeholder="Title, example, or grammar alias"
          onChange={(event) => update({ search: event.target.value })}
        />
      </label>
      <div className={styles.filters}>
        <label>
          Branch
          <select
            value={value.branch}
            disabled={disabled}
            onChange={(event) => update({ branch: event.target.value as MapViewState['branch'] })}
          >
            <option value="ALL">All branches</option>
            <option value="GRAMMAR">Grammar</option>
            <option value="SITUATIONS">Situations</option>
          </select>
        </label>
        <label>
          Requirement
          <select
            value={value.requirement}
            disabled={disabled}
            onChange={(event) =>
              update({
                requirement: event.target.value as MapViewState['requirement'],
              })
            }
          >
            <option value="ALL">Required and optional</option>
            <option value="REQUIRED">Required</option>
            <option value="OPTIONAL">Optional</option>
          </select>
        </label>
        <label>
          Evidence status
          <select
            value={value.status}
            disabled={disabled}
            onChange={(event) => update({ status: event.target.value as MapViewState['status'] })}
          >
            {statuses.map((status) => (
              <option key={status} value={status}>
                {label(status)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Skill
          <select
            value={value.skill}
            disabled={disabled}
            onChange={(event) => update({ skill: event.target.value as MapViewState['skill'] })}
          >
            {skills.map((skill) => (
              <option key={skill} value={skill}>
                {label(skill)}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.due}>
          <input
            type="checkbox"
            checked={value.due}
            disabled={disabled}
            onChange={(event) => update({ due: event.target.checked })}
          />
          Review due only
        </label>
        <button type="button" disabled={disabled} onClick={() => onChange({ ...defaultMapView })}>
          Clear filters
        </button>
      </div>
      <p aria-live="polite">
        Showing {count} of {total} objectives in this level. Requirements and confidence counts
        describe the whole level.
      </p>
    </section>
  );
}
