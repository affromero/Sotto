import { getLedgerSummary } from '@/lib/beancount';
import styles from './page.module.css';

interface PageProps {
  searchParams: Promise<{ month?: string }>;
}

function formatCategory(account: string): string {
  // "Expenses:Infrastructure:Domain" → "Infrastructure: Domain"
  // "Expenses:AI:Claude:Discovery" → "AI: Claude"
  const parts = account.replace(/^(Expenses|Income|Liabilities:AccountsPayable|Assets:Prepaid):/, '').split(':');
  if (parts.length >= 2) return `${parts[0]}: ${parts[1]}`;
  return parts[0];
}

function formatMonth(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default async function AdminExpensesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const summary = getLedgerSummary(params.month);
  const selectedMonth = params.month ?? (summary.availableMonths.at(-1) || '');

  const maxExpense = Math.max(...summary.expensesByCategory.map((c) => c.total), 0.01);

  return (
    <div className={styles.container}>
      <div className={styles.headerRow}>
        <div className={styles.header}>
          <h1 className={styles.title}>Expenses</h1>
          <p className={styles.subtitle}>Beancount ledger — operational expenses, revenue, and cash position</p>
        </div>
        {summary.availableMonths.length > 0 && (
          <nav className={styles.rangeNav} aria-label="Month filter">
            <a
              href="/admin/expenses"
              className={`${styles.rangeLink} ${!params.month ? styles.rangeLinkActive : ''}`}
              aria-current={!params.month ? 'page' : undefined}
            >
              All
            </a>
            {summary.availableMonths.map((m) => (
              <a
                key={m}
                href={`/admin/expenses?month=${m}`}
                className={`${styles.rangeLink} ${selectedMonth === m && params.month ? styles.rangeLinkActive : ''}`}
                aria-current={selectedMonth === m && params.month ? 'page' : undefined}
              >
                {formatMonth(m)}
              </a>
            ))}
          </nav>
        )}
      </div>

      {/* Summary cards */}
      <div className={styles.grid}>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Total Expenses</span>
          <span className={styles.cardValue}>${summary.totalExpenses.toFixed(2)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Total Revenue</span>
          <span className={styles.cardValue}>${summary.totalRevenue.toFixed(2)}</span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Net Income</span>
          <span className={`${styles.cardValue} ${summary.netIncome >= 0 ? styles.positive : styles.negative}`}>
            {summary.netIncome >= 0 ? '' : '-'}${Math.abs(summary.netIncome).toFixed(2)}
          </span>
        </div>
        <div className={styles.card}>
          <span className={styles.cardLabel}>Cash Position</span>
          <span className={styles.cardValue}>${summary.cashPosition.toFixed(2)}</span>
        </div>
      </div>

      <div className={styles.columns}>
        {/* Expense breakdown */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Expenses by Category</h2>
          {summary.expensesByCategory.length === 0 ? (
            <p className={styles.empty}>No expenses recorded.</p>
          ) : (
            <div className={styles.hBarContainer}>
              {summary.expensesByCategory.map((cat) => (
                <div key={cat.category} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{formatCategory(cat.category)}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFill}
                      style={{ width: `${(cat.total / maxExpense) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>${cat.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Accounts payable + prepaid */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Balance Sheet Items</h2>
          {summary.accountsPayable.length === 0 && summary.prepaidAssets.length === 0 ? (
            <p className={styles.empty}>No payables or prepaids.</p>
          ) : (
            <div className={styles.hBarContainer}>
              {summary.accountsPayable.map((ap) => (
                <div key={ap.category} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{formatCategory(ap.category)}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFill}
                      style={{ width: `${(ap.total / Math.max(...summary.accountsPayable.map((a) => a.total), 0.01)) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>-${ap.total.toFixed(2)}</span>
                </div>
              ))}
              {summary.prepaidAssets.map((pa) => (
                <div key={pa.category} className={styles.hBarRow}>
                  <span className={styles.hBarLabel}>{formatCategory(pa.category)}</span>
                  <div className={styles.hBarTrack}>
                    <div
                      className={styles.hBarFill}
                      style={{ width: `${(pa.total / Math.max(...summary.prepaidAssets.map((p) => p.total), 0.01)) * 100}%` }}
                    />
                  </div>
                  <span className={styles.hBarValue}>${pa.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Transaction table */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Transactions ({summary.transactions.length})</h2>
        {summary.transactions.length === 0 ? (
          <p className={styles.empty}>No transactions found.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th>Description</th>
                <th>Account</th>
                <th className={styles.amountCell}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {summary.transactions.map((tx, i) => {
                // Show the primary posting (first expense or income account)
                const primary = tx.postings.find(
                  (p) => p.account.startsWith('Expenses:') || p.account.startsWith('Income:'),
                ) ?? tx.postings[0];

                return (
                  <tr key={`${tx.date}-${tx.payee}-${i}`}>
                    <td>{tx.date}</td>
                    <td>{tx.payee}</td>
                    <td>{tx.narration}</td>
                    <td className={styles.accountCell}>{primary?.account ?? '—'}</td>
                    <td className={styles.amountCell}>
                      {primary ? `$${Math.abs(primary.amount).toFixed(2)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
