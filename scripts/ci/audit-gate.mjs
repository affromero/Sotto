#!/usr/bin/env node
// CI audit gate: fails on high/critical npm advisories, except explicitly
// allowlisted ones. Each allowlist entry carries a UTC expiry so an exception
// cannot silently outlive its justification; the gate hard-fails again once
// the date passes. Remove entries as soon as the fix is installable.
import { execSync } from 'node:child_process';

const ALLOW = {
  // deepmerge-ts <8.0.0 (stack exhaustion) via prisma@7 -> @prisma/config.
  // The patched 8.x published 2026-08-16 is blocked by .npmrc min-release-age=7
  // until ~2026-08-23; only the prisma CLI's own config merging exercises it.
  'GHSA-ggr8-5vv4-36mx': '2026-08-25',
};

let raw;
try {
  raw = execSync('npm audit --json --audit-level=high', {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  if (!err.stdout) throw err;
  raw = err.stdout;
}
const report = JSON.parse(raw);

const now = new Date();
const failures = [];
for (const [name, vuln] of Object.entries(report.vulnerabilities ?? {})) {
  if (vuln.severity !== 'high' && vuln.severity !== 'critical') continue;
  const advisories = vuln.via
    .filter((via) => typeof via === 'object' && via.url)
    .map((via) => via.url.split('/').pop());
  // No advisories of its own: transitive of another listed vulnerability,
  // which is judged on its own row.
  if (advisories.length === 0) continue;
  const blocked = advisories.filter(
    (id) => !(ALLOW[id] && now < new Date(`${ALLOW[id]}T00:00:00Z`))
  );
  if (blocked.length > 0) {
    failures.push(`${name} (${vuln.severity}): ${blocked.join(', ')}`);
  }
}

if (failures.length > 0) {
  console.error('audit gate: unallowlisted high/critical advisories:');
  for (const line of failures) console.error(`  ${line}`);
  process.exit(1);
}
const allowed = Object.keys(ALLOW).join(', ');
console.log(`audit gate: ok${allowed ? ` (allowlisted: ${allowed})` : ''}`);
