import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Posting {
  account: string;
  amount: number;
  currency: string;
}

export interface Transaction {
  date: string;
  flag: string;
  payee: string;
  narration: string;
  postings: Posting[];
  comment?: string;
}

export interface CategoryTotal {
  category: string;
  total: number;
}

export interface LedgerSummary {
  totalExpenses: number;
  totalRevenue: number;
  netIncome: number;
  cashPosition: number;
  expensesByCategory: CategoryTotal[];
  revenueByType: CategoryTotal[];
  accountsPayable: CategoryTotal[];
  prepaidAssets: CategoryTotal[];
  transactions: Transaction[];
  availableMonths: string[];
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

function getLedgerDir(): string {
  if (process.env.LEDGER_PATH) return process.env.LEDGER_PATH;
  return join(process.cwd(), '..', '..', 'accounting', 'ledger');
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

function readBeancountFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8');
  } catch {
    return '';
  }
}

function resolveIncludes(filePath: string, visited: Set<string> = new Set()): string[] {
  const abs = join(filePath);
  if (visited.has(abs)) return [];
  visited.add(abs);

  const content = readBeancountFile(abs);
  if (!content) return [];

  const lines: string[] = [content];
  const dir = dirname(abs);

  for (const line of content.split('\n')) {
    const match = line.match(/^include\s+"([^"]+)"/);
    if (match) {
      const includedPath = join(dir, match[1]);
      lines.push(...resolveIncludes(includedPath, visited));
    }
  }

  return lines;
}

function parseTransactions(content: string): Transaction[] {
  const transactions: Transaction[] = [];
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Transaction line: YYYY-MM-DD * "Payee" "Narration"
    const txMatch = line.match(
      /^(\d{4}-\d{2}-\d{2})\s+([*!])\s+"([^"]*)"\s+"([^"]*)"/,
    );

    if (txMatch) {
      const [, date, flag, payee, narration] = txMatch;

      // Look for a comment on the line before (prepaid metadata)
      let comment: string | undefined;
      if (i > 0 && lines[i - 1].trim().startsWith(';')) {
        comment = lines[i - 1].trim().replace(/^;\s*/, '');
      }

      const postings: Posting[] = [];
      i++;

      // Parse posting lines (indented, start with spaces)
      while (i < lines.length) {
        const postingLine = lines[i];
        if (!postingLine.match(/^\s+\S/)) break;

        // Skip comment-only posting lines
        if (postingLine.trim().startsWith(';')) {
          i++;
          continue;
        }

        // Account Amount Currency
        const postingMatch = postingLine.match(
          /^\s+([\w:]+)\s+(-?[\d,]+\.?\d*)\s+(\w+)/,
        );
        if (postingMatch) {
          const [, account, amountStr, currency] = postingMatch;
          postings.push({
            account,
            amount: parseFloat(amountStr.replace(/,/g, '')),
            currency,
          });
        }
        i++;
      }

      transactions.push({ date, flag, payee, narration, postings, comment });
    } else {
      i++;
    }
  }

  return transactions;
}

function detectAvailableMonths(transactions: Transaction[]): string[] {
  const months = new Set<string>();
  for (const tx of transactions) {
    months.add(tx.date.slice(0, 7)); // YYYY-MM
  }
  return Array.from(months).sort();
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function sumByPrefix(
  transactions: Transaction[],
  prefix: string,
): CategoryTotal[] {
  const totals = new Map<string, number>();

  for (const tx of transactions) {
    for (const posting of tx.postings) {
      if (posting.account.startsWith(prefix)) {
        // Use the second-level category (e.g., "Infrastructure" from "Expenses:Infrastructure:Domain")
        const parts = posting.account.split(':');
        const category = parts.length >= 2 ? parts.slice(0, 3).join(':') : posting.account;
        totals.set(category, (totals.get(category) ?? 0) + posting.amount);
      }
    }
  }

  return Array.from(totals.entries())
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total);
}

function sumPostings(transactions: Transaction[], prefix: string): number {
  let total = 0;
  for (const tx of transactions) {
    for (const posting of tx.postings) {
      if (posting.account.startsWith(prefix)) {
        total += posting.amount;
      }
    }
  }
  return Math.round(total * 100) / 100;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function getLedgerSummary(month?: string): LedgerSummary {
  const ledgerDir = getLedgerDir();
  const mainFile = join(ledgerDir, 'main.beancount');

  if (!existsSync(mainFile)) {
    return {
      totalExpenses: 0,
      totalRevenue: 0,
      netIncome: 0,
      cashPosition: 0,
      expensesByCategory: [],
      revenueByType: [],
      accountsPayable: [],
      prepaidAssets: [],
      transactions: [],
      availableMonths: [],
    };
  }

  const allContent = resolveIncludes(mainFile).join('\n');
  const allTransactions = parseTransactions(allContent);
  const availableMonths = detectAvailableMonths(allTransactions);

  // Filter by month if specified
  const transactions = month
    ? allTransactions.filter((tx) => tx.date.startsWith(month))
    : allTransactions;

  // Expenses are positive debits on Expenses:* accounts
  const totalExpenses = sumPostings(transactions, 'Expenses:');

  // Revenue: Income accounts have negative amounts (credits), negate for display
  const totalRevenue = -sumPostings(transactions, 'Income:');

  const netIncome = totalRevenue - totalExpenses;

  // Cash = sum of Assets:Current:Cash:* postings across ALL transactions (not filtered)
  const cashPosition = sumPostings(allTransactions, 'Assets:Current:Cash:');

  const expensesByCategory = sumByPrefix(transactions, 'Expenses:');
  const revenueByType = sumByPrefix(transactions, 'Income:').map((c) => ({
    ...c,
    total: Math.abs(c.total),
  }));

  const accountsPayable = sumByPrefix(transactions, 'Liabilities:AccountsPayable:').map((c) => ({
    ...c,
    total: Math.abs(c.total),
  }));

  const prepaidAssets = sumByPrefix(transactions, 'Assets:Prepaid:');

  return {
    totalExpenses,
    totalRevenue,
    netIncome,
    cashPosition,
    expensesByCategory,
    revenueByType,
    accountsPayable,
    prepaidAssets,
    transactions: transactions.sort((a, b) => b.date.localeCompare(a.date)),
    availableMonths,
  };
}
