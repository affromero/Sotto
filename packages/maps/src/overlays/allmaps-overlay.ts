const DAVID_RUMSEY_API = 'https://www.davidrumsey.com/luna/servlet/as/search';

export interface AntiqueMapResult {
  title: string;
  date: string;
  thumbnailUrl: string;
  viewUrl: string;
}

/**
 * Search the David Rumsey Historical Map Collection for maps matching a place.
 * Returns thumbnails and links — images are NOT redistributed, only referenced
 * with attribution per David Rumsey terms.
 */
export async function findHistoricalMaps(
  placeName: string,
  limit = 5,
): Promise<AntiqueMapResult[]> {
  const q = encodeURIComponent(`${placeName} map`);
  const url = `${DAVID_RUMSEY_API}?q=${q}&bs=${limit}&lc=RUMSEY~8~1`;
  const res = await fetch(url);
  if (!res.ok) return [];

  const data = await res.json();
  const results: AntiqueMapResult[] = [];

  for (const r of data.results ?? []) {
    const thumb = r.urlSize2 ?? r.thumbnailUrl ?? '';
    if (!thumb) continue;

    let date = '';
    for (const fv of r.fieldValues ?? []) {
      if (fv.Date) { date = fv.Date[0] ?? ''; break; }
    }

    // Build a link to the David Rumsey viewer page
    const viewUrl = r.iiifManifest
      ? r.iiifManifest.replace('/iiif/m/', '/detail/').replace('/manifest', '')
      : 'https://www.davidrumsey.com';

    results.push({
      title: r.displayName ?? 'Unknown map',
      date,
      thumbnailUrl: thumb,
      viewUrl,
    });
  }

  return results;
}
