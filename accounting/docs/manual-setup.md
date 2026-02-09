# Manual Setup Checklist

> Verified 2026-02-09. Only expense to date is the domain.

## Status: DONE

All items verified and applied to the ledger.

- [x] **Opening balance** — $70.00 (total spent to date = domain only)
- [x] **Domain** — sotto.fm $70/yr from Namecheap, amortized at $5.83/mo
- [x] **Hetzner** — Not yet provisioned, no transactions recorded
- [x] **Anthropic / ElevenLabs / Stripe / other platforms** — No accounts opened yet
- [x] **Payment tracking** — Simple model (single cash pool)
- [x] **Validation** — `bean-check` passes clean

## Current ledger state

| Transaction | Amount | File |
|------------|--------|------|
| Seed funding (= domain cost) | +$70.00 | `opening.beancount:8` |
| Domain sotto.fm (1yr prepaid) | -$70.00 | `opening.beancount:18` |
| Domain amortization (Feb, 1/12) | -$5.83 from prepaid | `opening.beancount:23` |

**Cash**: $0.00 | **Prepaid domain**: $64.17 | **Feb domain expense**: $5.83

## When new expenses start

As you provision Hetzner, Anthropic, ElevenLabs, etc — tell Claude Code the vendor, amount, and date and it will record transactions in the current month's ledger file.
