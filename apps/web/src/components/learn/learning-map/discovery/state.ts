import type { LearningMapResponse } from '@sotto/shared';

export const branches = ['ALL', 'GRAMMAR', 'SITUATIONS'] as const;
export const requirements = ['ALL', 'REQUIRED', 'OPTIONAL'] as const;
export const statuses = ['ALL', 'NOT_ASSESSED', 'PRACTISING', 'CONFIDENT', 'NEEDS_WORK'] as const;
export const skills = ['ALL', 'GRAMMAR', 'READING', 'LISTENING', 'SPEAKING', 'WRITING'] as const;
export interface MapViewState {
  search: string;
  branch: (typeof branches)[number];
  requirement: (typeof requirements)[number];
  status: (typeof statuses)[number];
  due: boolean;
  skill: (typeof skills)[number];
  objective: string;
}
export const defaultMapView: MapViewState = {
  search: '',
  branch: 'ALL',
  requirement: 'ALL',
  status: 'ALL',
  due: false,
  skill: 'ALL',
  objective: '',
};
const normalize = (text: string) => text.normalize('NFKC').toLowerCase();
function member<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.find((item) => item === value) ?? fallback;
}
export function readMapView(params: URLSearchParams): MapViewState {
  return {
    search: (params.get('q') ?? '').slice(0, 500),
    branch: member(params.get('branch'), branches, 'ALL'),
    requirement: member(params.get('required'), requirements, 'ALL'),
    status: member(params.get('status'), statuses, 'ALL'),
    due: params.get('due') === '1',
    skill: member(params.get('skill'), skills, 'ALL'),
    objective: (params.get('objective') ?? '').slice(0, 200),
  };
}
/** Preserve unrelated navigation state while serializing only meaningful map filters. */
export function writeMapView(url: URL, view: MapViewState, courseId: string, level: string): URL {
  const result = new URL(url);
  result.searchParams.set('course', courseId);
  result.searchParams.set('level', level);
  const values = {
    q: view.search,
    branch: view.branch === 'ALL' ? '' : view.branch,
    required: view.requirement === 'ALL' ? '' : view.requirement,
    status: view.status === 'ALL' ? '' : view.status,
    due: view.due ? '1' : '',
    skill: view.skill === 'ALL' ? '' : view.skill,
    objective: view.objective,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value) result.searchParams.set(key, value);
    else result.searchParams.delete(key);
  }
  return result;
}
export function filterMap(map: LearningMapResponse, view: MapViewState) {
  const byId = new Map(map.nodes.map((item) => [item.node.id, item]));
  const words = normalize(view.search).trim().split(/\s+/u).filter(Boolean);
  const matches = map.nodes.filter(({ node, progress }) => {
    if (node.kind !== 'OBJECTIVE') return false;
    if (view.branch !== 'ALL' && node.branch !== view.branch) return false;
    if (view.requirement !== 'ALL' && node.required !== (view.requirement === 'REQUIRED'))
      return false;
    if (view.status !== 'ALL' && progress?.status !== view.status) return false;
    if (view.due && !progress?.reviewDue) return false;
    if (view.skill !== 'ALL' && !node.skills.includes(view.skill)) return false;
    const text = normalize(
      [node.title, node.description, ...node.examples, ...node.grammarKeys].join(' ')
    );
    return words.every((word) => text.includes(word));
  });
  const visible = new Set<string>();
  const counts = new Map<string, number>();
  for (const item of matches) {
    let id: string | null = item.node.id;
    const seen = new Set<string>();
    while (id && !seen.has(id)) {
      seen.add(id);
      visible.add(id);
      counts.set(id, (counts.get(id) ?? 0) + 1);
      id = byId.get(id)?.node.parentId ?? null;
    }
  }
  const objectivePath = new Set<string>();
  let linked = byId.get(view.objective);
  if (linked?.node.kind !== 'OBJECTIVE') linked = undefined;
  let id = linked?.node.id ?? null;
  while (id && !objectivePath.has(id)) {
    objectivePath.add(id);
    id = byId.get(id)?.node.parentId ?? null;
  }
  const active =
    view.search.trim() !== '' ||
    view.branch !== 'ALL' ||
    view.requirement !== 'ALL' ||
    view.status !== 'ALL' ||
    view.due ||
    view.skill !== 'ALL';
  return { visible, counts, matches, objectivePath, active, linked };
}
