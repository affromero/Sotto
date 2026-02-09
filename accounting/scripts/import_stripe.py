"""Import Stripe revenue and fees into Beancount.

Pulls subscription payments, Stripe fees, and payouts for a given month.

Usage:
    uv run import-stripe --month 2026-02
"""

import argparse
import os
import sys
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

import stripe


def get_stripe_key() -> str:
    """Read STRIPE_SECRET_KEY from environment or .env file."""
    key = os.environ.get("STRIPE_SECRET_KEY")
    if key:
        return key

    env_file = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("STRIPE_SECRET_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")

    print("Error: STRIPE_SECRET_KEY not found in environment or .env file", file=sys.stderr)
    sys.exit(1)


def parse_month(month_str: str) -> tuple[int, int]:
    """Parse 'YYYY-MM' into unix timestamps for start/end of month."""
    parts = month_str.split("-")
    year, month = int(parts[0]), int(parts[1])
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    return int(start.timestamp()), int(end.timestamp())


# Map Stripe price metadata or product name to revenue account
TIER_MAP = {
    "pro": "Income:Subscriptions:Pro",
    "creator": "Income:Subscriptions:Creator",
}


def classify_charge(charge) -> str:
    """Determine the revenue account for a charge based on its description or metadata."""
    desc = (charge.get("description") or "").lower()
    for tier, account in TIER_MAP.items():
        if tier in desc:
            return account
    return "Income:Subscriptions:Pro"


def fetch_charges(start_ts: int, end_ts: int) -> list[dict]:
    """Fetch successful charges in the period."""
    charges = []
    has_more = True
    starting_after = None

    while has_more:
        params = {
            "created": {"gte": start_ts, "lt": end_ts},
            "limit": 100,
        }
        if starting_after:
            params["starting_after"] = starting_after

        response = stripe.Charge.list(**params)
        for charge in response.data:
            if charge.status == "succeeded":
                charges.append({
                    "id": charge.id,
                    "amount": Decimal(str(charge.amount)) / 100,
                    "fee": Decimal(str(charge.balance_transaction.fee if hasattr(charge, 'balance_transaction') and charge.balance_transaction else 0)) / 100,
                    "description": charge.description or "",
                    "created": datetime.fromtimestamp(charge.created, tz=timezone.utc),
                })

        has_more = response.has_more
        if response.data:
            starting_after = response.data[-1].id

    return charges


def fetch_payouts(start_ts: int, end_ts: int) -> list[dict]:
    """Fetch payouts in the period."""
    payouts = []
    has_more = True
    starting_after = None

    while has_more:
        params = {
            "created": {"gte": start_ts, "lt": end_ts},
            "limit": 100,
        }
        if starting_after:
            params["starting_after"] = starting_after

        response = stripe.Payout.list(**params)
        for payout in response.data:
            if payout.status == "paid":
                payouts.append({
                    "id": payout.id,
                    "amount": Decimal(str(payout.amount)) / 100,
                    "created": datetime.fromtimestamp(payout.arrival_date, tz=timezone.utc),
                })

        has_more = response.has_more
        if response.data:
            starting_after = response.data[-1].id

    return payouts


def format_charge_transaction(charge: dict, account: str) -> str:
    """Format a charge as a Beancount transaction."""
    tx_date = charge["created"].strftime("%Y-%m-%d")
    amount = charge["amount"]
    fee = charge["fee"]
    net = amount - fee

    lines = [f'{tx_date} * "Stripe" "Subscription payment: {charge["description"]}"']
    lines.append(f"  Assets:Current:Cash:Stripe  {net:.2f} USD")
    if fee > 0:
        lines.append(f"  Expenses:PaymentProcessing:StripeFees  {fee:.2f} USD")
    lines.append(f"  {account}  -{amount:.2f} USD")
    return "\n".join(lines)


def format_payout_transaction(payout: dict) -> str:
    """Format a payout as a Beancount transaction."""
    tx_date = payout["created"].strftime("%Y-%m-%d")
    amount = payout["amount"]
    lines = [
        f'{tx_date} * "Stripe" "Payout to bank — {payout["id"]}"',
        f"  Assets:Current:Cash:Bank  {amount:.2f} USD",
        f"  Assets:Current:Cash:Stripe  -{amount:.2f} USD",
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Import Stripe revenue into Beancount")
    parser.add_argument(
        "--month",
        required=True,
        help="Month to import (YYYY-MM format, e.g. 2026-02)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print transactions without writing to file",
    )
    args = parser.parse_args()

    stripe.api_key = get_stripe_key()
    start_ts, end_ts = parse_month(args.month)

    print(f"Fetching Stripe data for {args.month}...")

    charges = fetch_charges(start_ts, end_ts)
    payouts = fetch_payouts(start_ts, end_ts)

    transactions = []
    total_revenue = Decimal("0")
    total_fees = Decimal("0")

    for charge in charges:
        account = classify_charge(charge)
        tx = format_charge_transaction(charge, account)
        transactions.append(tx)
        total_revenue += charge["amount"]
        total_fees += charge["fee"]
        print(f"  Charge: ${charge['amount']:.2f} (fee: ${charge['fee']:.2f}) — {charge['description']}")

    for payout in payouts:
        tx = format_payout_transaction(payout)
        transactions.append(tx)
        print(f"  Payout: ${payout['amount']:.2f}")

    print(f"\nTotal revenue: ${total_revenue:.2f}")
    print(f"Total Stripe fees: ${total_fees:.2f}")
    print(f"Net: ${total_revenue - total_fees:.2f}")

    if not transactions:
        print("No Stripe transactions found for this period.")
        return

    output = "\n; --- Stripe Import (auto-generated) ---\n"
    output += f"; Imported: {date.today().isoformat()}\n"
    output += f"; Period: {args.month}\n\n"
    output += "\n\n".join(transactions)
    output += "\n"

    if args.dry_run:
        print("\n--- DRY RUN ---")
        print(output)
        return

    # Write to the monthly file
    parts = args.month.split("-")
    year = int(parts[0])
    month_num = int(parts[1])
    month_date = date(year, month_num, 1)
    month_name = month_date.strftime("%m-%B").lower()
    ledger_dir = Path(__file__).resolve().parent.parent / "ledger" / str(year)
    ledger_dir.mkdir(parents=True, exist_ok=True)
    target = ledger_dir / f"{month_name}.beancount"

    if target.exists():
        with open(target, "a") as f:
            f.write("\n" + output)
    else:
        with open(target, "w") as f:
            f.write(f"; Sotto — {month_date.strftime('%B %Y')} Transactions\n\n")
            f.write(output)

    print(f"\nWritten to {target}")


if __name__ == "__main__":
    main()
