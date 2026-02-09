# Monthly Close Procedure

> Step-by-step guide for closing a month in Sotto's Beancount ledger.

## Quick Close (Automated)

```bash
cd accounting
uv run monthly-close --month YYYY-MM
```

This runs all steps below automatically. Use the manual procedure if any step fails.

## Manual Procedure

### 1. Import API Usage Costs

Pull costs from the `ApiUsageLog` database table:

```bash
# Preview first
uv run import-api-usage --month 2026-02 --dry-run

# Import
uv run import-api-usage --month 2026-02
```

This queries PostgreSQL and appends transactions to `ledger/2026/02-february.beancount`.

### 2. Import Stripe Revenue

Pull subscription payments, fees, and payouts:

```bash
# Preview first
uv run import-stripe --month 2026-02 --dry-run

# Import
uv run import-stripe --month 2026-02
```

### 3. Record Manual Expenses

Check Gmail for invoices from:
- **Hetzner** — VPS compute (monthly)
- **Namecheap** — Domain renewal (annual, amortized monthly)
- **ElevenLabs** — Subscription overage (if applicable)
- **Anthropic** — API invoices (if on invoiced plan)

Use templates in `accounting/templates/` or ask Claude Code to record them.

### 4. Record Domain Amortization

If not already recorded, add the monthly domain amortization entry:

```beancount
YYYY-MM-28 * "Domain amortization" "sotto.fm — Month YYYY (N/12)"
  Expenses:Infrastructure:Domain  5.42 USD
  Assets:Prepaid:Domain  -5.42 USD
```

### 5. Validate the Ledger

```bash
uv run bean-check ledger/main.beancount
```

Fix any errors before proceeding. Common issues:
- Unbalanced transactions (amounts don't sum to zero)
- Duplicate entries from re-running imports
- Account names with typos

### 6. Generate Reports

```bash
uv run reports --month 2026-02
```

Reports are saved to `accounting/reports/`:
- `balance-sheet-YYYY-MM.txt` — Assets, liabilities, equity
- `income-statement-YYYY-MM.txt` — Revenue minus expenses (P&L)
- `trial-balance-YYYY-MM.txt` — All account balances

### 7. Review in Fava

```bash
uv run fava ledger/main.beancount
```

Open http://localhost:5000 and verify:
- Balance sheet looks correct
- Income statement matches expectations
- No unexpected accounts or balances

### 8. Commit

```bash
git add accounting/
git commit -m "accounting: close YYYY-MM"
```

## Creating a New Month

When starting a new month:

1. Create the monthly file:
   ```bash
   touch accounting/ledger/2026/03-march.beancount
   ```

2. Add a header:
   ```beancount
   ; Sotto — March 2026 Transactions
   ```

3. Add the include to `main.beancount`:
   ```beancount
   include "2026/03-march.beancount"
   ```

4. Copy recurring entries (Hetzner, domain amortization) from the previous month and update dates.

## MCP Integration

Claude Code can manage the ledger directly via the beancount-mcp server:

- **Query balances**: "What's the current balance of Assets:Current:Cash:Bank?"
- **Add transactions**: "Record a $11.00 Hetzner payment for March"
- **Run reports**: "Show me the P&L for February"

The MCP server reads from `ledger/main.beancount` — all changes are reflected immediately.
