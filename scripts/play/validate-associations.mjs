import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateAppleAssociation(document, appID) {
  requireValue(
    /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(appID),
    'Use the actual Apple application identifier.'
  );
  const details = document?.applinks?.details;
  requireValue(Array.isArray(details), 'AASA applinks.details must be an array.');
  const matching = details.filter(
    (entry) =>
      entry?.appID === appID || (Array.isArray(entry?.appIDs) && entry.appIDs.includes(appID))
  );
  requireValue(matching.length > 0, 'AASA does not contain the supplied application identifier.');
  for (const entry of matching) {
    requireValue(
      (typeof entry.appID === 'string' &&
        entry.appIDs === undefined &&
        entry.paths !== undefined) ||
        (entry.appID === undefined &&
          Array.isArray(entry.appIDs) &&
          entry.components !== undefined),
      'Pair legacy appID with paths, or modern appIDs with components.'
    );
    requireValue(
      entry.appIDs === undefined ||
        (Array.isArray(entry.appIDs) &&
          entry.appIDs.length > 0 &&
          entry.appIDs.every(
            (value) => typeof value === 'string' && /^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/.test(value)
          )),
      'AASA appIDs must be an array of application identifiers.'
    );
    requireValue(
      entry.paths === undefined || entry.components === undefined,
      'Use either Play AASA paths or components, not both.'
    );
    if (entry.paths !== undefined) {
      requireValue(
        Array.isArray(entry.paths) &&
          entry.paths.length > 0 &&
          entry.paths.every((path) => path === '/play/join'),
        'The Play AASA paths must be limited to /play/join.'
      );
    } else {
      requireValue(
        Array.isArray(entry.components) &&
          entry.components.length > 0 &&
          entry.components.every(
            (component) =>
              component?.['/'] === '/play/join' &&
              Object.keys(component).every((key) => key === '/' || key === 'comment')
          ),
        'The Play AASA components must positively match only /play/join.'
      );
    }
  }
}

export function validateAndroidAssociation(document, packageName, fingerprints) {
  requireValue(
    /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(packageName),
    'Use the actual Android application ID.'
  );
  const fingerprint = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/;
  requireValue(
    fingerprints.length > 0 && fingerprints.every((value) => fingerprint.test(value)),
    'Supply colon-separated uppercase SHA-256 installed signing certificate fingerprints.'
  );
  requireValue(Array.isArray(document), 'Android assetlinks must be an array.');
  const matching = document.filter(
    (entry) =>
      entry?.target?.namespace === 'android_app' &&
      entry.target.package_name === packageName &&
      Array.isArray(entry.relation) &&
      entry.relation.every((value) => typeof value === 'string') &&
      entry.relation.includes('delegate_permission/common.handle_all_urls')
  );
  requireValue(
    matching.length > 0,
    'Assetlinks does not delegate app links to the supplied package.'
  );
  const published = matching.flatMap((entry) => {
    const values = entry.target.sha256_cert_fingerprints;
    requireValue(
      Array.isArray(values) &&
        values.length > 0 &&
        values.every((value) => fingerprint.test(value)),
      'Assetlinks contains invalid signing certificate fingerprints.'
    );
    return values;
  });
  requireValue(
    fingerprints.every((value) => published.includes(value)),
    'Assetlinks is missing an installed signing certificate fingerprint.'
  );
}

async function readDocument(path) {
  requireValue((await stat(path)).size <= 131_072, 'Association files must be at most 128 KiB.');
  return JSON.parse(await readFile(path, 'utf8'));
}

async function main() {
  const { values } = parseArgs({
    options: {
      aasa: { type: 'string' },
      'apple-app-id': { type: 'string' },
      assetlinks: { type: 'string' },
      'android-package': { type: 'string' },
      'android-sha256': { type: 'string', multiple: true },
    },
  });
  requireValue(values.aasa || values.assetlinks, 'Supply --aasa and/or --assetlinks.');
  if (values.aasa)
    validateAppleAssociation(await readDocument(values.aasa), values['apple-app-id'] || '');
  if (values.assetlinks)
    validateAndroidAssociation(
      await readDocument(values.assetlinks),
      values['android-package'] || '',
      values['android-sha256'] || []
    );
  process.stdout.write(
    'Association content matches the supplied identities. Signed-app and HTTPS device verification are still required.\n'
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
