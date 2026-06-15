#!/usr/bin/env npx tsx
/**
 * Export local episodes as a SQL migration file that can be run on production.
 *
 * Usage:
 *   npx tsx scripts/export-episodes.ts > migration.sql
 *   ssh sotto@<server> "docker exec -i sotto-prod-postgres psql -U sotto sotto" < migration.sql
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const LOCAL_USER_EMAIL = 'andres2912@gmail.com';

function esc(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
  if (typeof val === 'number') return String(val);
  if (val instanceof Date) return `'${val.toISOString()}'`;
  if (Array.isArray(val)) {
    // Check if it's a simple string array (Prisma String[]) vs a JSON array (Prisma Json)
    if (val.length === 0) return "'{}'";
    if (val.every(v => typeof v === 'string' || typeof v === 'number')) {
      // PostgreSQL text[] literal
      const items = val.map(v => `"${String(v).replace(/"/g, '\\"').replace(/'/g, "''")}"`);
      return `'{${items.join(',')}}'`;
    }
    // JSON array → jsonb
    return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  }
  if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'::jsonb`;
  return `'${String(val).replace(/'/g, "''")}'`;
}

function insertRow(table: string, row: Record<string, unknown>, userIdRemap = false): string {
  const cols = Object.keys(row);
  const vals = cols.map(col => {
    if (userIdRemap && col === 'userId') return '(SELECT id FROM _user_map)';
    return esc(row[col]);
  });
  return `INSERT INTO "${table}" (${cols.map(c => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')}) ON CONFLICT DO NOTHING;`;
}

async function main() {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: LOCAL_USER_EMAIL } });

  const episodes = await prisma.episode.findMany({
    where: { userId: user.id, status: 'READY' },
    orderBy: { createdAt: 'asc' },
  });

  const episodeIds = episodes.map(p => p.id);

  const [scripts, segments, references, versions, discoveries, interactions] = await Promise.all([
    prisma.script.findMany({ where: { episodeId: { in: episodeIds } } }),
    prisma.segment.findMany({ where: { episodeId: { in: episodeIds } }, orderBy: { order: 'asc' } }),
    prisma.reference.findMany({ where: { episodeId: { in: episodeIds } } }),
    prisma.episodeVersion.findMany({ where: { episodeId: { in: episodeIds } }, include: { segments: true } }),
    prisma.discovery.findMany({ where: { episodeId: { in: episodeIds } }, include: { messages: true } }),
    prisma.interaction.findMany({ where: { episodeId: { in: episodeIds } } }),
  ]);

  // Also fetch tags for these episodes
  const episodeTags = await prisma.episodeTag.findMany({ where: { episodeId: { in: episodeIds } } });
  const tagIds = [...new Set(episodeTags.map(pt => pt.tagId))];
  const tags = tagIds.length > 0
    ? await prisma.tag.findMany({ where: { id: { in: tagIds } } })
    : [];

  // Build SQL
  const lines: string[] = [];
  lines.push('-- Auto-generated episode migration');
  lines.push(`-- Source: local DB, ${episodes.length} episodes`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push('');
  lines.push('BEGIN;');
  lines.push('');

  // Insert user if not exists (upsert by email)
  lines.push('-- Upsert user');
  const userRow: Record<string, unknown> = {
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    bio: user.bio,
    role: user.role,
    emailVerified: user.emailVerified,
    hasCompletedOnboarding: user.hasCompletedOnboarding,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
  const userCols = Object.keys(userRow);
  const userVals = userCols.map(c => esc(userRow[c]));
  lines.push(`INSERT INTO "User" (${userCols.map(c => `"${c}"`).join(', ')}) VALUES (${userVals.join(', ')}) ON CONFLICT ("email") DO NOTHING;`);
  lines.push('');

  lines.push(`-- Resolve target user by email`);
  lines.push(`CREATE TEMP TABLE _user_map AS SELECT id FROM "User" WHERE email = '${LOCAL_USER_EMAIL}';`);
  lines.push('');

  // Tags (ON CONFLICT DO NOTHING since tags may already exist)
  if (tags.length > 0) {
    lines.push('-- Tags');
    for (const tag of tags) {
      const { id, name, slug, category, createdAt } = tag;
      lines.push(insertRow('Tag', { id, name, slug, category, createdAt }));
    }
    lines.push('');
  }

  // Episodes
  lines.push('-- Episodes');
  for (const p of episodes) {
    const row: Record<string, unknown> = { ...p };
    // Remove Prisma-internal fields and relations
    delete (row as Record<string, unknown>)['user'];
    lines.push(insertRow('Episode', row, true));
  }
  lines.push('');

  // Scripts
  lines.push('-- Scripts');
  for (const s of scripts) {
    const row: Record<string, unknown> = { ...s };
    lines.push(insertRow('Script', row));
  }
  lines.push('');

  // Segments
  lines.push(`-- Segments (${segments.length} total)`);
  for (const s of segments) {
    const row: Record<string, unknown> = { ...s };
    lines.push(insertRow('Segment', row));
  }
  lines.push('');

  // References
  if (references.length > 0) {
    lines.push('-- References');
    for (const r of references) {
      const row: Record<string, unknown> = { ...r };
      lines.push(insertRow('Reference', row));
    }
    lines.push('');
  }

  // Episode Versions
  if (versions.length > 0) {
    lines.push('-- Episode Versions');
    for (const v of versions) {
      const { segments: vSegs, ...vRow } = v;
      lines.push(insertRow('EpisodeVersion', vRow));
    }
    lines.push('');

    const allVersionSegments = versions.flatMap(v => v.segments);
    if (allVersionSegments.length > 0) {
      lines.push('-- Episode Version Segments');
      for (const vs of allVersionSegments) {
        const row: Record<string, unknown> = { ...vs };
        lines.push(insertRow('EpisodeVersionSegment', row));
      }
      lines.push('');
    }
  }

  // Discoveries
  if (discoveries.length > 0) {
    lines.push('-- Discoveries');
    for (const d of discoveries) {
      const { messages, ...dRow } = d;
      lines.push(insertRow('Discovery', dRow, true));
    }
    lines.push('');

    const allMessages = discoveries.flatMap(d => d.messages);
    if (allMessages.length > 0) {
      lines.push('-- Discovery Messages');
      for (const m of allMessages) {
        const row: Record<string, unknown> = { ...m };
        lines.push(insertRow('DiscoveryMessage', row));
      }
      lines.push('');
    }
  }

  // Interactions
  if (interactions.length > 0) {
    lines.push('-- Interactions');
    for (const i of interactions) {
      const row: Record<string, unknown> = { ...i };
      lines.push(insertRow('Interaction', row, true));
    }
    lines.push('');
  }

  // Episode Tags
  if (episodeTags.length > 0) {
    lines.push('-- Episode Tags');
    for (const pt of episodeTags) {
      const row: Record<string, unknown> = { ...pt };
      lines.push(insertRow('EpisodeTag', row));
    }
    lines.push('');
  }

  lines.push('DROP TABLE _user_map;');
  lines.push('');
  lines.push('COMMIT;');

  console.log(lines.join('\n'));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
