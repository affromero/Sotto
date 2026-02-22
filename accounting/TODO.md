# Accounting TODO

> Manual setup is done (see `docs/manual-setup.md`). These are the remaining build items.

## Now (before first monthly close)

- [ ] **Fix domain cost in `docs/11-unit-economics.md`** — Says "$12/year" but sotto.fm is actually $70/yr. Update the bootstrapping budget table.

- [ ] **Add accounting section to root `CLAUDE.md`** — Brief mention of the Beancount system: where ledger files live, how to record expenses, how to validate.

- [ ] **New month automation** — `scripts/new_month.py` that creates the next month's `.beancount` file with domain amortization entry pre-filled and adds the `include` to `main.beancount`. Run it on March 1st (or automate in `monthly_close.py`).

## When Hetzner is provisioned

- [ ] **Record first Hetzner charge** — Add VPS + backup transactions to the current month file. Hetzner bills in EUR; for now record the USD amount your bank charged. See multi-currency section below for proper EUR handling later.

## When Stripe / API services go live

- [ ] **Idempotent imports** — Running `import-api-usage` or `import-stripe` twice creates duplicates. Add dedup: check for `; Period: YYYY-MM` marker in the target file before appending.

- [ ] **Stripe charge classification** — `classify_charge()` in `import_stripe.py` guesses Pro vs Creator from description text. Wire it to actual Stripe product/price IDs from `src/lib/stripe.ts`.

- [ ] **Stripe balance transaction expansion** — The import needs `expand=['data.balance_transaction']` in the `Charge.list()` call to get accurate fee amounts.

## Automation (after first real monthly close)

- [ ] **Monthly cron/reminder** — Calendar event or cron on the 1st to run:
  ```bash
  cd /home/ubuntu/Code/Sotto/accounting && uv run monthly-close --month $(date -d "last month" +%Y-%m)
  ```

- [ ] **Recurring transactions** — Formalize monthly recurring entries (domain amortization, Hetzner, etc) so `new_month.py` auto-generates them instead of manual copy.

## Nice to have

- [ ] **Multi-currency EUR** — Proper Hetzner EUR tracking:
  ```beancount
  2026-03-01 * "Hetzner" "VPS CX32 — March 2026"
    Expenses:Infrastructure:Compute:Hetzner  6.80 EUR @@ 8.00 USD
    Assets:Current:Cash:Bank  -8.00 USD
  ```
  Requires `commodity EUR` directive and looking up the actual bank FX rate each month.

- [ ] **beancount-mcp server** — No mature PyPI package exists yet. When available, add to `.mcp.json`:
  ```json
  {
    "beancount": {
      "command": "uv",
      "args": ["--directory", "/home/ubuntu/Code/Sotto/accounting", "run", "beancount-mcp"],
      "env": { "BEANCOUNT_FILE": "/home/ubuntu/Code/Sotto/accounting/ledger/main.beancount" }
    }
  }
  ```
  Until then, Claude Code reads/edits `.beancount` files directly.

- [ ] **Gmail invoice extraction** — Use Gmail MCP to search for invoices from vendors and parse amounts into Beancount transactions automatically.

- [ ] **Financial dashboard (md-to-html)** — Once there's real data (Hetzner, API costs, revenue), generate a static HTML report via `/md-to-html` with P&L waterfall, burn rate over time, cost breakdown by category, runway projection. Shareable without running Fava.

- [ ] **Burn rate report** — Monthly burn rate + months of runway remaining.

- [ ] **Budget vs actual** — Define monthly budgets per expense category, compare against actuals via Fava plugin or custom beanquery.

- [ ] **Unit economics reconciliation** — Cross-reference imported `ApiUsageLog` costs against per-podcast estimates in `docs/11-unit-economics.md`.

- [ ] **Tax accounts** — When relevant:
  - `Expenses:Tax:SalesTax` + `Liabilities:Tax:SalesTaxPayable`
  - `Expenses:Tax:IncomeTax` (estimated quarterly)

- [ ] **Prepaid API credits** — If you prepay Anthropic credits, record as `Assets:Prepaid:APICredits` and amortize as usage occurs. Account already exists in chart of accounts.
