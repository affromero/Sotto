import Link from 'next/link';
import { getUsageOverview } from '@/lib/admin/usage-stats';
import { fmtCompact, fmtInt, pctChange, fmtMeasured } from '@/lib/admin/format';
import { colorForService } from '@/components/admin/serviceColors';
import { AreaChart } from '@/components/admin/charts/AreaChart';
import { ShareBar } from '@/components/admin/charts/ShareBar';
import { Glyph } from '@/components/Glyph';
import { GlassOrb } from '@/components/landing/GlassOrb';
import styles from '@/app/(admin)/adminTheme.styles';

const WINDOW_DAYS = 30;

export default async function AdminOverviewPage() {
  const { headline, byService, byDay, learners } = await getUsageOverview(WINDOW_DAYS);
  const { total: totalUsers, signupsThisWeek } = learners;

  const delta =
    headline.unknownCosts || headline.unknownCostsPrev
      ? null
      : pctChange(headline.spend, headline.spendPrev);
  const spendTotal = byDay.reduce((a, d) => a + d.usd, 0);
  const areaData = byDay.map((d, i) => ({
    v: d.usd,
    m: i % 6 === 0 ? Number(d.day.slice(8, 10)) : '',
  }));
  const services = byService.map((s, i) => ({ ...s, color: colorForService(s.service, i) }));

  return (
    <>
      <div className={styles.adminHead}>
        <div className={styles.headLeft}>
          <GlassOrb size={40} />
          <div>
            <h1>Overview</h1>
            <div className={styles.ahSub}>Self hosted · last {WINDOW_DAYS} days</div>
          </div>
        </div>
        <div className={styles.ahActions}>
          <Link href="/admin/usage" className={`${styles.btnSm} ${styles.primary}`}>
            <Glyph name="graph" size={13} /> Full cost report
          </Link>
        </div>
      </div>

      {headline.unknownCosts > 0 && (
        <p>{headline.unknownCosts} requests have unknown costs. Charts show known spend only.</p>
      )}
      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <div className={styles.stLabel}>
            <Glyph name="spark" size={13} /> Spend · {WINDOW_DAYS}d
          </div>
          <div className={styles.stVal}>
            {fmtMeasured(headline.spend, headline.requests, headline.unknownCosts)}
          </div>
          {delta !== null && (
            <div className={`${styles.stDelta} ${delta >= 0 ? styles.up : styles.down}`}>
              <Glyph name={delta >= 0 ? 'arrow' : 'check'} size={12} /> {Math.abs(delta)}% vs prior{' '}
              {WINDOW_DAYS}d
            </div>
          )}
        </div>
        <div className={styles.stat}>
          <div className={styles.stLabel}>
            <Glyph name="headset" size={13} /> Active learners
          </div>
          <div className={styles.stVal}>{fmtInt(headline.activeLearners)}</div>
          <div className={`${styles.stDelta} ${styles.flat}`}>
            <Glyph name="dot" size={10} /> generated in window
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.stLabel}>
            <Glyph name="dot" size={13} /> Requests · {WINDOW_DAYS}d
          </div>
          <div className={styles.stVal}>{fmtCompact(headline.requests)}</div>
          <div className={`${styles.stDelta} ${styles.flat}`}>
            <Glyph name="clock" size={11} />{' '}
            {fmtMeasured(
              headline.avgLatencyMs,
              headline.requests,
              headline.unknownLatency,
              (value) => `${value}ms`
            )}{' '}
            avg
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.stLabel}>
            <Glyph name="today" size={13} /> Learners
          </div>
          <div className={styles.stVal}>{fmtInt(totalUsers)}</div>
          <div className={`${styles.stDelta} ${styles.flat}`}>
            <Glyph name="plus" size={11} /> {signupsThisWeek} this week
          </div>
        </div>
      </div>

      <div className={styles.panel2col}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div className={styles.phTitle}>
              <Glyph name="graph" size={15} /> Spend, last {WINDOW_DAYS} days
            </div>
            <div className={styles.phNote}>
              {fmtMeasured(spendTotal, headline.requests, headline.unknownCosts)}
            </div>
          </div>
          <div className={styles.panelBody}>
            {spendTotal > 0 ? (
              <AreaChart id="overviewSpend" data={areaData} height={150} />
            ) : (
              <div className={styles.empty}>
                {headline.requests > 0
                  ? 'No measured spend in this window.'
                  : 'No usage logged yet in this window.'}
              </div>
            )}
          </div>
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div className={styles.phTitle}>
              <Glyph name="plug" size={15} /> Where it goes
            </div>
          </div>
          <div className={styles.panelBody}>
            {services.length > 0 ? (
              <>
                <ShareBar rows={services} />
                <div className={styles.legend}>
                  {services.slice(0, 5).map((p) => (
                    <div className={styles.legendRow} key={p.service}>
                      <span className={styles.lgDot} style={{ background: p.color }} />
                      <span className={styles.lgName}>{p.service}</span>
                      <span className={styles.lgVal}>
                        {fmtMeasured(p.usd, p.requests, p.unknownCosts)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className={styles.empty}>No provider spend yet.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
