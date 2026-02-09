"""Monthly close orchestrator for Sotto accounting.

Runs all import scripts, validates the ledger, and generates reports.

Usage:
    uv run monthly-close                    # Close current month
    uv run monthly-close --month 2026-02    # Close specific month
"""

import argparse
import subprocess
import sys
from datetime import date
from pathlib import Path

ACCOUNTING_DIR = Path(__file__).resolve().parent.parent
LEDGER_FILE = ACCOUNTING_DIR / "ledger" / "main.beancount"


def run_step(name: str, cmd: list[str]) -> bool:
    """Run a step and return success/failure."""
    print(f"\n{'='*60}")
    print(f"  {name}")
    print(f"{'='*60}\n")

    result = subprocess.run(cmd, cwd=str(ACCOUNTING_DIR))
    if result.returncode != 0:
        print(f"\nFAILED: {name}")
        return False
    print(f"\nOK: {name}")
    return True


def main():
    parser = argparse.ArgumentParser(description="Monthly close for Sotto accounting")
    parser.add_argument(
        "--month",
        help="Month to close (YYYY-MM). Defaults to current month.",
    )
    parser.add_argument(
        "--skip-imports",
        action="store_true",
        help="Skip API usage and Stripe imports (just validate + report)",
    )
    args = parser.parse_args()

    month = args.month or date.today().strftime("%Y-%m")
    print(f"Monthly close for: {month}")

    steps_passed = 0
    steps_total = 0

    # Step 1: Import API usage
    if not args.skip_imports:
        steps_total += 1
        if run_step(
            "Import API Usage Costs",
            [sys.executable, "-m", "scripts.import_api_usage", "--month", month],
        ):
            steps_passed += 1
        else:
            print("Warning: API usage import failed — continuing anyway")

        # Step 2: Import Stripe revenue
        steps_total += 1
        if run_step(
            "Import Stripe Revenue",
            [sys.executable, "-m", "scripts.import_stripe", "--month", month],
        ):
            steps_passed += 1
        else:
            print("Warning: Stripe import failed — continuing anyway")

    # Step 3: Validate ledger
    steps_total += 1
    if run_step(
        "Validate Ledger (bean-check)",
        [sys.executable, "-m", "beancount.parser.parser", str(LEDGER_FILE)],
    ):
        steps_passed += 1
    else:
        print("\nERROR: Ledger validation failed. Fix errors before proceeding.")
        sys.exit(1)

    # Step 4: Generate reports
    steps_total += 1
    if run_step(
        "Generate Reports",
        [sys.executable, "-m", "scripts.generate_reports", "--month", month],
    ):
        steps_passed += 1

    # Summary
    print(f"\n{'='*60}")
    print(f"  Monthly Close Complete: {steps_passed}/{steps_total} steps passed")
    print(f"{'='*60}")
    print(f"\nNext steps:")
    print(f"  1. Review generated reports in accounting/reports/")
    print(f"  2. git add accounting/ && git commit -m 'accounting: close {month}'")
    print(f"  3. Verify with: uv run fava ledger/main.beancount")


if __name__ == "__main__":
    main()
