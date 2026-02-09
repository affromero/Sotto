"""Import API usage costs from Sotto's ApiUsageLog table into Beancount.

Connects to PostgreSQL, queries ApiUsageLog grouped by service + category
for a given month, and appends Beancount transactions to the monthly file.

Usage:
    uv run import-api-usage --month 2026-02
"""

import argparse
import os
import sys
from datetime import date
from decimal import Decimal
from pathlib import Path

import psycopg

# Mapping from ApiUsageLog (service, category) → Beancount expense account
ACCOUNT_MAP: dict[tuple[str, str], str] = {
    ("claude", "discovery"): "Expenses:AI:Claude:Discovery",
    ("claude", "script_generation"): "Expenses:AI:Claude:ScriptGeneration",
    ("claude", "script_gen"): "Expenses:AI:Claude:ScriptGeneration",
    ("claude", "interaction"): "Expenses:AI:Claude:Interaction",
    ("claude", "reference_validation"): "Expenses:AI:Claude:ReferenceValidation",
    ("claude", "ref_validation"): "Expenses:AI:Claude:ReferenceValidation",
    ("claude", "tweet_parsing"): "Expenses:AI:Claude:TweetParsing",
    ("claude", "other"): "Expenses:AI:Claude:Other",
    ("elevenlabs", "standard"): "Expenses:TTS:ElevenLabs:Standard",
    ("elevenlabs", "premium"): "Expenses:TTS:ElevenLabs:Premium",
    ("elevenlabs", "audio_generation"): "Expenses:TTS:ElevenLabs:Standard",
    ("elevenlabs", "sfx"): "Expenses:TTS:ElevenLabs:SoundEffects",
    ("elevenlabs", "sound_effects"): "Expenses:TTS:ElevenLabs:SoundEffects",
    ("elevenlabs", "voice_clone"): "Expenses:TTS:ElevenLabs:VoiceClone",
    ("openai", "tts"): "Expenses:TTS:OpenAI:Standard",
    ("openai", "audio_generation"): "Expenses:TTS:OpenAI:Standard",
}

FALLBACK_ACCOUNTS: dict[str, str] = {
    "claude": "Expenses:AI:Claude:Other",
    "elevenlabs": "Expenses:TTS:ElevenLabs:Standard",
    "openai": "Expenses:TTS:OpenAI:Standard",
}


def get_database_url() -> str:
    """Read DATABASE_URL from environment or .env file."""
    url = os.environ.get("DATABASE_URL")
    if url:
        return url

    env_file = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                return line.split("=", 1)[1].strip().strip("\"'")

    print("Error: DATABASE_URL not found in environment or .env file", file=sys.stderr)
    sys.exit(1)


def parse_month(month_str: str) -> tuple[date, date]:
    """Parse 'YYYY-MM' into (first_day, last_day) of the month."""
    parts = month_str.split("-")
    year, month = int(parts[0]), int(parts[1])
    first_day = date(year, month, 1)
    if month == 12:
        last_day = date(year + 1, 1, 1)
    else:
        last_day = date(year, month + 1, 1)
    return first_day, last_day


def fetch_usage(db_url: str, start: date, end: date) -> list[dict]:
    """Query ApiUsageLog grouped by service + category for the month."""
    query = """
        SELECT
            service,
            category,
            COUNT(*) as request_count,
            SUM("totalCost") as total_cost,
            SUM("inputTokens") as total_input_tokens,
            SUM("outputTokens") as total_output_tokens
        FROM "ApiUsageLog"
        WHERE "createdAt" >= %s AND "createdAt" < %s
        GROUP BY service, category
        ORDER BY total_cost DESC
    """
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(query, (start, end))
            columns = [desc.name for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]


def format_transaction(
    tx_date: date,
    service: str,
    category: str,
    total_cost: Decimal,
    request_count: int,
    account: str,
) -> str:
    """Format a single Beancount transaction."""
    narration = f"{service}/{category} — {request_count} requests"
    lines = [
        f'{tx_date.isoformat()} * "{service.title()}" "{narration}"',
        f"  {account}  {total_cost:.2f} USD",
        f"  Liabilities:Accrued:APIUsage  -{total_cost:.2f} USD",
    ]
    return "\n".join(lines)


def resolve_account(service: str, category: str) -> str:
    """Map (service, category) to a Beancount expense account."""
    key = (service.lower(), category.lower())
    if key in ACCOUNT_MAP:
        return ACCOUNT_MAP[key]
    service_lower = service.lower()
    if service_lower in FALLBACK_ACCOUNTS:
        return FALLBACK_ACCOUNTS[service_lower]
    return "Expenses:AI:Claude:Other"


def main():
    parser = argparse.ArgumentParser(description="Import API usage costs into Beancount")
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

    start, end = parse_month(args.month)
    db_url = get_database_url()

    print(f"Fetching API usage for {args.month}...")
    rows = fetch_usage(db_url, start, end)

    if not rows:
        print("No API usage found for this period.")
        return

    transactions = []
    total = Decimal("0")
    for row in rows:
        cost = Decimal(str(row["total_cost"]))
        if cost <= 0:
            continue
        account = resolve_account(row["service"], row["category"])
        tx = format_transaction(
            tx_date=start,
            service=row["service"],
            category=row["category"],
            total_cost=cost,
            request_count=row["request_count"],
            account=account,
        )
        transactions.append(tx)
        total += cost
        print(f"  {row['service']}/{row['category']}: ${cost:.2f} ({row['request_count']} requests)")

    print(f"\nTotal API costs: ${total:.2f}")

    output = "\n; --- API Usage Import (auto-generated) ---\n"
    output += f"; Imported: {date.today().isoformat()}\n"
    output += f"; Period: {args.month}\n\n"
    output += "\n\n".join(transactions)
    output += "\n"

    if args.dry_run:
        print("\n--- DRY RUN ---")
        print(output)
        return

    # Write to the monthly file
    year = start.year
    month_name = start.strftime("%m-%B").lower()
    ledger_dir = Path(__file__).resolve().parent.parent / "ledger" / str(year)
    ledger_dir.mkdir(parents=True, exist_ok=True)
    target = ledger_dir / f"{month_name}.beancount"

    if target.exists():
        with open(target, "a") as f:
            f.write("\n" + output)
    else:
        with open(target, "w") as f:
            f.write(f"; Sotto — {start.strftime('%B %Y')} Transactions\n\n")
            f.write(output)

    print(f"\nWritten to {target}")


if __name__ == "__main__":
    main()
