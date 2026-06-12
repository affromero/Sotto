import Link from 'next/link';
import { prisma } from '@/lib/prisma';
import { DURATION_TOLERANCE_SECONDS } from '@/lib/duration';
import { Glyph, type GlyphName } from '@/components/Glyph';
import { fmtInt } from '@/lib/admin/format';
import styles from '../../adminTheme.module.css';

export const metadata = { title: 'System · Sotto admin' };

interface Tool {
  href: string;
  glyph: GlyphName;
  name: string;
  desc: string;
}

const TOOLS: Tool[] = [
  {
    href: '/admin/health',
    glyph: 'spark',
    name: 'Services & health',
    desc: 'Live database, Redis, storage, and provider reachability, plus env and OAuth config.',
  },
  {
    href: '/admin/queues',
    glyph: 'retry',
    name: 'Queues',
    desc: 'BullMQ job queues across the generation pipeline. Retry or clean failed jobs.',
  },
  {
    href: '/admin/episodes',
    glyph: 'book',
    name: 'Lessons',
    desc: 'All generated lessons with status and failed-pipeline triage.',
  },
  {
    href: '/admin/site-config',
    glyph: 'gear',
    name: 'Site config',
    desc: 'Infrastructure selection (AI / TTS / STT / storage) and sign-in access.',
  },
  {
    href: '/admin/providers',
    glyph: 'plug',
    name: 'Providers & models',
    desc: 'Default models, enabled sets, and per-provider smoke tests.',
  },
];

async function getDurationAccuracy() {
  const [tracked, withinTarget, dev] = await Promise.all([
    prisma.episode.count({ where: { durationDeviation: { not: null }, status: 'READY' } }),
    prisma.episode.count({
      where: {
        durationDeviation: { gte: -DURATION_TOLERANCE_SECONDS, lte: DURATION_TOLERANCE_SECONDS },
        status: 'READY',
      },
    }),
    prisma.$queryRaw<[{ mean_abs: number | null }]>`
      SELECT AVG(ABS("durationDeviation"))::float AS mean_abs
      FROM "Episode"
      WHERE "durationDeviation" IS NOT NULL AND "status" = 'READY' AND "deletedAt" IS NULL
    `,
  ]);
  return {
    tracked,
    withinTargetPct: tracked > 0 ? Math.round((withinTarget / tracked) * 100) : 0,
    meanAbsDeviation: Math.round(dev[0]?.mean_abs ?? 0),
  };
}

export default async function AdminSystemPage() {
  const accuracy = await getDurationAccuracy();

  return (
    <>
      <div className={styles.adminHead}>
        <div>
          <h1>System</h1>
          <div className={styles.ahSub}>Services, queues, content, and configuration</div>
        </div>
      </div>

      <div className={styles.toolGrid}>
        {TOOLS.map((t) => (
          <Link key={t.href} href={t.href} className={styles.toolCard}>
            <div className={styles.tcTop}>
              <span className={styles.tcIco}>
                <Glyph name={t.glyph} size={18} />
              </span>
              <span className={styles.tcName}>{t.name}</span>
              <span className={styles.tcArrow}>
                <Glyph name="arrow" size={16} />
              </span>
            </div>
            <div className={styles.tcDesc}>{t.desc}</div>
          </Link>
        ))}
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div className={styles.phTitle}>
            <Glyph name="wave" size={15} /> Audio generation accuracy
          </div>
          <div className={styles.phNote}>READY lessons</div>
        </div>
        <div className={styles.panelBody}>
          <div className={styles.sysGrid}>
            <div className={styles.stat}>
              <div className={styles.stLabel}>
                <Glyph name="dot" size={13} /> Tracked
              </div>
              <div className={styles.stVal}>{fmtInt(accuracy.tracked)}</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.stLabel}>
                <Glyph name="check" size={13} /> Within ±{DURATION_TOLERANCE_SECONDS}s
              </div>
              <div className={styles.stVal}>
                {accuracy.withinTargetPct}
                <small>%</small>
              </div>
              <div className={styles.meterLine}>
                <i style={{ width: `${accuracy.withinTargetPct}%` }} />
              </div>
            </div>
            <div className={styles.stat}>
              <div className={styles.stLabel}>
                <Glyph name="clock" size={13} /> Mean abs deviation
              </div>
              <div className={styles.stVal}>
                {accuracy.meanAbsDeviation}
                <small>s</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
