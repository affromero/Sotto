import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { updateScriptSchema } from '@/lib/validations';
import {
  cleanAndRenumberCitations,
  cleanAndRenumberMarkdown,
  buildRenumberMap,
} from '@/lib/script-updater';
import type { ScriptTurn } from '@/lib/script-generator';

type RouteParams = { params: Promise<{ podcastId: string }> };

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }
  if (podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const script = await prisma.script.findUnique({
    where: { podcastId },
  });

  if (!script) {
    return NextResponse.json({ error: 'Script not found' }, { status: 404 });
  }

  const references = await prisma.reference.findMany({
    where: { podcastId, verificationStatus: { not: 'REMOVED' } },
    orderBy: { number: 'asc' },
  });

  return NextResponse.json({
    turns: script.turns as ScriptTurn[],
    references,
    version: script.version,
  });
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const { podcastId } = await params;
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const podcast = await prisma.podcast.findUnique({
    where: { id: podcastId },
    select: { userId: true, status: true },
  });

  if (!podcast) {
    return NextResponse.json({ error: 'Podcast not found' }, { status: 404 });
  }
  if (podcast.userId !== session.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (podcast.status !== 'SCRIPT_READY') {
    return NextResponse.json(
      { error: 'Script can only be edited when status is SCRIPT_READY' },
      { status: 400 }
    );
  }

  const body = await request.json();
  const parsed = updateScriptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const script = await prisma.script.findUnique({
    where: { podcastId },
  });
  if (!script) {
    return NextResponse.json({ error: 'Script not found' }, { status: 404 });
  }

  const oldTurns = script.turns as ScriptTurn[];
  const newTurns = parsed.data.turns;

  // If turns were removed, clean up citation references
  let finalTurns: ScriptTurn[] = newTurns;
  let finalMarkdown = generateMarkdown(newTurns);

  if (newTurns.length < oldTurns.length) {
    const references = await prisma.reference.findMany({
      where: { podcastId, verificationStatus: { not: 'REMOVED' } },
      orderBy: { number: 'asc' },
    });

    if (references.length > 0) {
      // Find citation numbers that are still referenced in the new turns
      const citationRegex = /\[(\d+(?:\s*,\s*\d+)*)\]/g;
      const referencedNumbers = new Set<number>();
      for (const turn of newTurns) {
        let match: RegExpExecArray | null;
        citationRegex.lastIndex = 0;
        while ((match = citationRegex.exec(turn.text)) !== null) {
          const nums = match[1].split(',').map((s) => parseInt(s.trim(), 10));
          nums.forEach((n) => referencedNumbers.add(n));
        }
      }

      // Remove unreferenced citations
      const allNumbers = references.map((r) => r.number);
      const removedNumbers = new Set(allNumbers.filter((n) => !referencedNumbers.has(n)));

      if (removedNumbers.size > 0) {
        const renumberMap = buildRenumberMap(allNumbers, removedNumbers);
        finalTurns = cleanAndRenumberCitations(newTurns, removedNumbers, renumberMap);
        finalMarkdown = cleanAndRenumberMarkdown(
          generateMarkdown(finalTurns),
          removedNumbers,
          renumberMap
        );
      }
    }
  }

  const updated = await prisma.script.update({
    where: { podcastId },
    data: {
      turns: finalTurns,
      markdown: finalMarkdown,
      version: { increment: 1 },
    },
  });

  return NextResponse.json({
    turns: updated.turns as ScriptTurn[],
    version: updated.version,
  });
}

function generateMarkdown(turns: ScriptTurn[]): string {
  return turns
    .map((turn) => {
      const direction = turn.direction ? ` _(${turn.direction})_` : '';
      return `**${turn.speaker}:**${direction} ${turn.text}`;
    })
    .join('\n\n');
}
