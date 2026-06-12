import {
  getUsageHeadline,
  getSpendByService,
  getSpendByDay,
  getSpendByCategory,
  getCostByUser,
} from '@/lib/admin/usage-stats';
import { fmtUSD, fmtCompact, pctChange } from '@/lib/admin/format';
import { colorForService } from '@/components/admin/serviceColors';
import { AreaChart } from '@/components/admin/charts/AreaChart';
import { ShareBar } from '@/components/admin/charts/ShareBar';
import { Bars } from '@/components/admin/charts/Bars';
import { Glyph } from '@/components/Glyph';
import styles from '../../adminTheme.module.css';

export const metadata = { title: 'Usage & cost · Sotto admin' };

const WINDOW_DAYS = 30;

function prettyCategory(c: string): string {
  return c.replace(/[-_]/g, ' ');
}

export default async function AdminUsagePage() {
  const [headline, byService, byDay, byCategory, byUser] = await Promise.all([
    getUsageHeadline(WINDOW_DAYS),
    getSpendByService(WINDOW_DAYS),
    getSpendByDay(WINDOW_DAYS),
    getSpendByCategory(WINDOW_DAYS),
    getCostByUser(WINDOW_DAYS, 8),
  ]);

  const delta = pctChange(headline.spend, headline.spendPrev);
  const services = byService.map((s, i) => ({ ...s, color: colorForService(s.service, i) }));
  const areaData = byDay.map((d, i) => ({
    v: d.usd,
    m: i % 6 === 0 ? Number(d.day.slice(8, 10)) : '',
  }));
  const categoryRows = byCategory
    .filter((c) => c.usd > 0)
    .slice(0, 8)
    .map((c, i) => ({ label: prettyCategory(c.category), v: c.usd, color: colorForService(c.category, i) }));
  const learnerRows = byUser.map((u, i) => ({
    label: u.name,
    v: u.usd,
    color: colorForService(u.userId, i),
  }));

  return (
    <>
      <div className={styles.adminHead}>
        <div>
          <h1>Usage &amp; cost</h1>
          <div className={styles.ahSub}>Last {WINDOW_DAYS} days · all providers · observability only</div>
        </div>
      </div>

      <div className={styles.statGrid}>
        <div className={styles.stat}>
          <div className={styles.stLabel}>
            <Glyph name="spark" size={13} /> Spend · {WINDOW_DAYS}d
          </div>
          <div className={styles.stVal}>{fmtUSD(headline.spend)}</div>
          {delta !== null && (
            <div className={`${styles.stDelta} ${delta >= 0 ? styles.up : styles.down}`}>
              <Glyph name={delta >= 0 ? 'arrow' : 'check'} size={12} /> {Math.abs(delta)}% vs prior{' '}
              {WINDOW_DAYS}d
            </div>
          )}
        </div>
        <div className={styles.stat}>
          <div className={styles.stLabel}>
            <Glyph name="dot" size={13} /> Tokens
          </div>
          <div className={styles.stVal}>
            {fmtCompact(headline.tokensIn)}
            <small> in</small>
          </div>
          <div className={`${styles.stDelta} ${styles.flat}`}>
            <Glyph name="dot" size={10} /> {fmtCompact(headline.tokensOut)} out
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.stLabel}>
            <Glyph name="graph" size={13} /> Requests
          </div>
          <div className={styles.stVal}>{fmtCompact(headline.requests)}</div>
          <div className={`${styles.stDelta} ${styles.flat}`}>
            <Glyph name="headset" size={10} /> {headline.activeLearners} active learners
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.stLabel}>
            <Glyph name="clock" size={13} /> Avg latency
          </div>
          <div className={styles.stVal}>
            {headline.avgLatencyMs}
            <small> ms</small>
          </div>
          <div className={`${styles.stDelta} ${styles.flat}`}>
            <Glyph name="dot" size={10} /> per request
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div className={styles.phTitle}>
            <Glyph name="graph" size={15} /> Spend trend
          </div>
          <div className={styles.phNote}>{WINDOW_DAYS} days</div>
        </div>
        <div className={styles.panelBody}>
          {headline.spend > 0 ? (
            <AreaChart id="usageTrend" data={areaData} height={170} />
          ) : (
            <div className={styles.empty}>No usage logged yet in this window.</div>
          )}
        </div>
      </div>

      <div className={styles.panel2col}>
        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div className={styles.phTitle}>
              <Glyph name="plug" size={15} /> By provider
            </div>
          </div>
          <div className={styles.panelBody}>
            {services.length > 0 ? (
              <>
                <ShareBar rows={services} />
                <div className={styles.legend}>
                  {services.map((p) => (
                    <div className={styles.legendRow} key={p.service}>
                      <span className={styles.lgDot} style={{ background: p.color }} />
                      <span className={styles.lgName}>
                        {p.service}
                        <small>{fmtCompact(p.requests)} requests</small>
                      </span>
                      <span className={styles.lgVal}>
                        {p.usd === 0 ? 'free' : fmtUSD(p.usd)}
                        <small>{Math.round(p.share * 100)}%</small>
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

        <div className={styles.panel}>
          <div className={styles.panelHead}>
            <div className={styles.phTitle}>
              <Glyph name="map" size={15} /> By task
            </div>
          </div>
          <div className={styles.panelBody}>
            {categoryRows.length > 0 ? (
              <Bars rows={categoryRows} fmt={fmtUSD} />
            ) : (
              <div className={styles.empty}>No categorized spend yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className={styles.panel}>
        <div className={styles.panelHead}>
          <div className={styles.phTitle}>
            <Glyph name="today" size={15} /> Cost by learner
          </div>
          <div className={styles.phNote}>observability — no caps</div>
        </div>
        <div className={styles.panelBody}>
          {learnerRows.length > 0 ? (
            <Bars rows={learnerRows} fmt={fmtUSD} />
          ) : (
            <div className={styles.empty}>No per-learner spend attributed yet.</div>
          )}
        </div>
      </div>
    </>
  );
}
