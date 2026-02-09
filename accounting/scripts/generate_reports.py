"""Generate financial reports from the Sotto Beancount ledger.

Produces income statement, balance sheet, and trial balance.

Usage:
    uv run reports                        # All reports
    uv run reports --month 2026-02        # Reports for specific month
    uv run reports --report balsheet      # Just balance sheet
"""

import argparse
from datetime import date
from pathlib import Path

from beancount import loader
from beancount.reports import balance_reports, income_statement

ACCOUNTING_DIR = Path(__file__).resolve().parent.parent
LEDGER_FILE = ACCOUNTING_DIR / "ledger" / "main.beancount"
REPORTS_DIR = ACCOUNTING_DIR / "reports"


def load_ledger():
    """Load and parse the Beancount ledger."""
    entries, errors, options = loader.load_file(str(LEDGER_FILE))
    if errors:
        print(f"Warning: {len(errors)} errors in ledger:")
        for error in errors[:5]:
            print(f"  {error}")
    return entries, errors, options


def generate_trial_balance(entries, options, output_path: Path):
    """Generate trial balance report."""
    from beancount.reports import table
    from beancount.core import realization

    real_root = realization.realize(entries)
    lines = []
    lines.append("TRIAL BALANCE")
    lines.append("=" * 60)
    lines.append("")

    def walk(real_account, depth=0):
        indent = "  " * depth
        balance = real_account.balance
        if not balance.is_empty():
            for pos in balance:
                lines.append(f"{indent}{real_account.account:50s} {pos.units}")
        for child_name in sorted(real_account):
            child = real_account[child_name]
            walk(child, depth + 1)

    walk(real_root)
    output_path.write_text("\n".join(lines))
    print(f"  Written: {output_path}")


def generate_balance_sheet(entries, options, output_path: Path):
    """Generate balance sheet report."""
    from beancount.core import realization

    real_root = realization.realize(entries)
    lines = []
    lines.append("BALANCE SHEET")
    lines.append("=" * 60)
    lines.append("")

    for section in ["Assets", "Liabilities", "Equity"]:
        lines.append(f"\n{section.upper()}")
        lines.append("-" * 40)
        if section in [child for child in real_root]:
            section_account = real_root[section]
            _walk_account(section_account, lines, depth=1)

    output_path.write_text("\n".join(lines))
    print(f"  Written: {output_path}")


def generate_income_statement(entries, options, output_path: Path):
    """Generate income statement (P&L) report."""
    from beancount.core import realization

    real_root = realization.realize(entries)
    lines = []
    lines.append("INCOME STATEMENT (P&L)")
    lines.append("=" * 60)
    lines.append("")

    for section in ["Income", "Expenses"]:
        lines.append(f"\n{section.upper()}")
        lines.append("-" * 40)
        if section in [child for child in real_root]:
            section_account = real_root[section]
            _walk_account(section_account, lines, depth=1)

    output_path.write_text("\n".join(lines))
    print(f"  Written: {output_path}")


def _walk_account(real_account, lines: list, depth: int = 0):
    """Recursively walk account tree and append formatted lines."""
    indent = "  " * depth
    balance = real_account.balance
    if not balance.is_empty():
        for pos in balance:
            lines.append(f"{indent}{real_account.account:50s} {pos.units}")
    for child_name in sorted(real_account):
        child = real_account[child_name]
        _walk_account(child, lines, depth + 1)


def main():
    parser = argparse.ArgumentParser(description="Generate Sotto financial reports")
    parser.add_argument(
        "--month",
        help="Month for report context (YYYY-MM). Defaults to current month.",
    )
    parser.add_argument(
        "--report",
        choices=["balsheet", "income", "trial", "all"],
        default="all",
        help="Which report to generate (default: all)",
    )
    args = parser.parse_args()

    month = args.month or date.today().strftime("%Y-%m")
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Generating reports for: {month}")
    print(f"Ledger: {LEDGER_FILE}")
    print()

    entries, errors, options = load_ledger()

    if args.report in ("all", "balsheet"):
        generate_balance_sheet(
            entries, options,
            REPORTS_DIR / f"balance-sheet-{month}.txt",
        )

    if args.report in ("all", "income"):
        generate_income_statement(
            entries, options,
            REPORTS_DIR / f"income-statement-{month}.txt",
        )

    if args.report in ("all", "trial"):
        generate_trial_balance(
            entries, options,
            REPORTS_DIR / f"trial-balance-{month}.txt",
        )

    print(f"\nReports saved to: {REPORTS_DIR}/")


if __name__ == "__main__":
    main()
