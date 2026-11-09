import type { Prisma } from '@/generated/prisma/client';

/** Hold the attachment tables against trigger changes while verifying the fence. */
export async function requireListeningAttachmentFence(database: Prisma.TransactionClient) {
  await database.$executeRaw`LOCK TABLE "ClassSection", "PracticeSession", "ExamSection" IN ROW EXCLUSIVE MODE`;
  const [result] = await database.$queryRaw<Array<{ valid: number }>>`
    SELECT count(*)::int AS valid
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    JOIN pg_language l ON l.oid = p.prolang
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'episodeId' AND NOT a.attisdropped
    WHERE n.nspname = current_schema()
      AND c.relname IN ('ClassSection', 'PracticeSession', 'ExamSection')
      AND t.tgname = c.relname || '_listening_attachment_fence'
      AND t.tgenabled = 'A' AND t.tgtype = 23 AND t.tgnargs = 0
      AND t.tgconstraint = 0 AND NOT t.tgisinternal AND t.tgqual IS NULL
      AND t.tgattr::text = a.attnum::text
      AND p.pronamespace = n.oid AND p.proname = 'fenceListeningAttachment'
      AND p.pronargs = 0 AND NOT p.prosecdef AND p.proconfig IS NULL
      AND l.lanname = 'plpgsql' AND md5(p.prosrc) = 'fb86dc26dc3f831f92468363dffd5920'
  `;
  if (result?.valid !== 3) throw new Error('Listening attachment fence is unavailable.');
}
