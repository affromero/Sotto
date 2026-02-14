import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

type RouteParams = { params: Promise<{ podcastId: string; commentId: string }> };

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const { podcastId, commentId } = await params;
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const comment = await prisma.comment.findUnique({
    where: { id: commentId },
    select: {
      id: true,
      userId: true,
      podcastId: true,
      parentId: true,
      podcast: { select: { userId: true } },
    },
  });

  if (!comment || comment.podcastId !== podcastId) {
    return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
  }

  // Only the comment author or podcast owner can delete
  const isCommentAuthor = comment.userId === userId;
  const isPodcastOwner = comment.podcast.userId === userId;

  if (!isCommentAuthor && !isPodcastOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await prisma.$transaction(async (tx) => {
    // Count replies that will be cascade-deleted (so we decrement commentCount properly)
    const replyCount = await tx.comment.count({
      where: { parentId: commentId },
    });

    await tx.comment.delete({
      where: { id: commentId },
    });

    // Decrement parent's replyCount if this was a reply
    if (comment.parentId) {
      await tx.comment.update({
        where: { id: comment.parentId },
        data: { replyCount: { decrement: 1 } },
      });
    }

    // Decrement podcast's commentCount (this comment + its replies)
    await tx.podcast.update({
      where: { id: podcastId },
      data: { commentCount: { decrement: 1 + replyCount } },
    });
  });

  return NextResponse.json({ success: true });
}
