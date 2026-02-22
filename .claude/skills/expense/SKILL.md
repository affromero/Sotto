---
name: expense
description: |
  Double-entry accounting for Sotto. Records expenses, revenue, prepaid assets,
  and amortization to the Beancount ledger. Validates with bean-check after every write.
  Modes: /expense <amount> <desc> | revenue | prepaid | amortize | status | validate | close
---

# Expense — Sotto Accounting Skill

Records financial transactions to Sotto's Beancount double-entry ledger. Every write is validated with `bean-check`. Supports expenses, revenue (with auto Stripe fee calc), prepaid assets with amortization, monthly close, and read-only status reports.

## Modes

| Command                                              | What It Does                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------- |
| `/expense 11.00 Hetzner VPS`                         | Quick expense — infer account, preview, confirm, write, validate |
| `/expense revenue 14.00 Pro subscription user@email` | Revenue with auto Stripe fee calc (2.9% + $0.30)                 |
| `/expense prepaid 70.00 Namecheap domain 12`         | Prepaid asset + amortization schedule                            |
| `/expense amortize`                                  | Generate monthly amortization entries for active prepaids        |
| `/expense status`                                    | Read-only: month summary, totals by category, cash position      |
| `/expense validate`                                  | Run `bean-check` and report/fix errors                           |
| `/expense close`                                     | Full monthly close: amortize + validate + summary report         |
| `/expense` (no args)                                 | Ask which mode to run                                            |

---

## Step 0: Load Context (All Modes)

**Always do this first, regardless of mode.**

### 0a. Load Chart of Accounts

Read the authoritative account list:

```
Read: accounting/ledger/accounts.beancount
```

### 0b. Load Main Ledger Config

Read `main.beancount` to understand which files are included:

```
Read: accounting/ledger/main.beancount
```

### 0c. Determine Current Month

Get today's date to determine the target month file:

```bash
date +%Y-%m-%d
```

The month file path follows this pattern: `accounting/ledger/YYYY/MM-monthname.beancount`

Month names are lowercase: `01-january`, `02-february`, `03-march`, `04-april`, `05-may`, `06-june`, `07-july`, `08-august`, `09-september`, `10-october`, `11-november`, `12-december`.

### 0d. Parse Mode

Parse the argument passed to the skill:

| Argument pattern                      | Mode                                       |
| ------------------------------------- | ------------------------------------------ |
| `revenue <amount> <desc...>`          | Mode 2: Revenue                            |
| `prepaid <amount> <desc...> <months>` | Mode 3: Prepaid                            |
| `amortize`                            | Mode 4: Amortize                           |
| `status`                              | Mode 5: Status                             |
| `validate`                            | Mode 6: Validate                           |
| `close`                               | Mode 7: Close                              |
| `<amount> <desc...>`                  | Mode 1: Quick Expense (amount is a number) |
| (empty)                               | Ask user via AskUserQuestion               |

If no argument is provided, ask:

```
AskUserQuestion:
  Q1: "What would you like to record?" header="Mode"
    - "Expense" — Record a business expense
    - "Revenue" — Record subscription or other income
    - "Status" — View month summary and cash position
    - "Validate" — Run bean-check on the ledger
```

---

## Account Matching Rules

### Expense Account Mapping

Map keywords in the description to expense accounts. Match is case-insensitive. Use the **first match** found.

| Keywords                                      | Expense Account                                  | Payee              | Payment Account                          |
| --------------------------------------------- | ------------------------------------------------ | ------------------ | ---------------------------------------- |
| `hetzner`, `vps`, `cpx`, `server`             | `Expenses:Infrastructure:Compute:Hetzner`        | `Hetzner`          | `Liabilities:AccountsPayable:Hetzner`    |
| `hetzner backup`, `vps backup`                | `Expenses:Infrastructure:Compute:HetznerBackups` | `Hetzner`          | `Liabilities:AccountsPayable:Hetzner`    |
| `namecheap`, `domain`, `sotto.fm`             | `Expenses:Infrastructure:Domain`                 | `Namecheap`        | `Liabilities:AccountsPayable:Namecheap`  |
| `r2`, `cloudflare storage`, `r2 storage`      | `Expenses:Infrastructure:Storage:R2`             | `Cloudflare`       | `Assets:Current:Cash:Bank`               |
| `cloudflare`, `cdn`                           | `Expenses:Infrastructure:CDN:Cloudflare`         | `Cloudflare`       | `Assets:Current:Cash:Bank`               |
| `email`, `sendgrid`, `resend`, `postmark`     | `Expenses:Infrastructure:Email`                  | (from description) | `Assets:Current:Cash:Bank`               |
| `claude discovery`, `discovery chat`          | `Expenses:AI:Claude:Discovery`                   | `Anthropic`        | `Liabilities:AccountsPayable:Anthropic`  |
| `claude script`, `script gen`                 | `Expenses:AI:Claude:ScriptGeneration`            | `Anthropic`        | `Liabilities:AccountsPayable:Anthropic`  |
| `claude interaction`, `interaction`           | `Expenses:AI:Claude:Interaction`                 | `Anthropic`        | `Liabilities:AccountsPayable:Anthropic`  |
| `claude ref`, `reference valid`               | `Expenses:AI:Claude:ReferenceValidation`         | `Anthropic`        | `Liabilities:AccountsPayable:Anthropic`  |
| `claude tweet`, `tweet pars`                  | `Expenses:AI:Claude:TweetParsing`                | `Anthropic`        | `Liabilities:AccountsPayable:Anthropic`  |
| `claude`, `anthropic`                         | `Expenses:AI:Claude:Other`                       | `Anthropic`        | `Liabilities:AccountsPayable:Anthropic`  |
| `elevenlabs standard`, `elevenlabs tts`       | `Expenses:TTS:ElevenLabs:Standard`               | `ElevenLabs`       | `Liabilities:AccountsPayable:ElevenLabs` |
| `elevenlabs premium`                          | `Expenses:TTS:ElevenLabs:Premium`                | `ElevenLabs`       | `Liabilities:AccountsPayable:ElevenLabs` |
| `elevenlabs sfx`, `sound effect`              | `Expenses:TTS:ElevenLabs:SoundEffects`           | `ElevenLabs`       | `Liabilities:AccountsPayable:ElevenLabs` |
| `elevenlabs voice clone`, `voice clone`       | `Expenses:TTS:ElevenLabs:VoiceClone`             | `ElevenLabs`       | `Liabilities:AccountsPayable:ElevenLabs` |
| `elevenlabs`                                  | `Expenses:TTS:ElevenLabs:Standard`               | `ElevenLabs`       | `Liabilities:AccountsPayable:ElevenLabs` |
| `openai tts`, `openai voice`                  | `Expenses:TTS:OpenAI:Standard`                   | `OpenAI`           | `Assets:Current:Cash:Bank`               |
| `stripe fee`, `payment processing`            | `Expenses:PaymentProcessing:StripeFees`          | `Stripe`           | `Assets:Current:Cash:Stripe`             |
| `github`, `devtool`, `dev tool`               | `Expenses:Software:DevTools`                     | (from description) | `Assets:Current:Cash:Bank`               |
| `sentry`, `monitoring`, `datadog`, `logflare` | `Expenses:Software:Monitoring`                   | (from description) | `Assets:Current:Cash:Bank`               |
| `legal`, `lawyer`, `trademark`                | `Expenses:Admin:Legal`                           | (from description) | `Assets:Current:Cash:Bank`               |
| `accounting`, `bookkeep`                      | `Expenses:Admin:Accounting`                      | (from description) | `Assets:Current:Cash:Bank`               |

**Fallback:** If no keyword matches, ask the user to pick an account:

```
AskUserQuestion:
  Q1: "Which expense category?" header="Account"
    - "Infrastructure" — Hosting, compute, storage, CDN
    - "AI Services" — Claude, OpenAI
    - "TTS" — ElevenLabs, OpenAI voice
    - "Software" — Dev tools, monitoring
```

Then narrow down to the specific sub-account based on the category chosen.

### Payee Extraction

Extract a clean payee name from the description:

| Description contains  | Payee        |
| --------------------- | ------------ |
| `hetzner`             | `Hetzner`    |
| `namecheap`           | `Namecheap`  |
| `cloudflare`, `r2`    | `Cloudflare` |
| `anthropic`, `claude` | `Anthropic`  |
| `elevenlabs`          | `ElevenLabs` |
| `openai`              | `OpenAI`     |
| `stripe`              | `Stripe`     |
| `github`              | `GitHub`     |
| `vercel`              | `Vercel`     |
| `railway`             | `Railway`    |
| `sentry`              | `Sentry`     |
| `resend`              | `Resend`     |
| `postmark`            | `Postmark`   |

If no known vendor is found in the description, use the first word of the description capitalized as the payee.

### Narration Generation

The narration is the descriptive part after the payee. Build it from the remaining description after extracting the payee, with context:

- Include the service/product name
- Include the month/period if it's a recurring charge
- Use an em-dash to separate details: `"VPS CX32 — February 2026"`

Examples:

- `/expense 8.00 Hetzner VPS feb` → Payee: `"Hetzner"`, Narration: `"VPS CX32 — February 2026"`
- `/expense 0.50 R2 storage` → Payee: `"Cloudflare"`, Narration: `"R2 storage — February 2026"`
- `/expense 5.00 Claude API usage` → Payee: `"Anthropic"`, Narration: `"Claude API usage — February 2026"`

### Revenue Account Mapping

| Keywords                                              | Revenue Account                |
| ----------------------------------------------------- | ------------------------------ |
| `pro sub`, `pro subscription`, `pro tier`             | `Income:Subscriptions:Pro`     |
| `creator sub`, `creator subscription`, `creator tier` | `Income:Subscriptions:Creator` |
| `api key`, `api access`, `developer`                  | `Income:APIKeys`               |
| `tip`, `sponsor`, `donation`                          | `Income:Other`                 |

**Fallback:** If no keyword matches, ask:

```
AskUserQuestion:
  Q1: "Which revenue type?" header="Revenue"
    - "Pro subscription ($14/mo)"
    - "Creator subscription ($29/mo)"
    - "API key access"
    - "Other revenue"
```

### Prepaid Account Mapping

| Keywords                              | Prepaid Account             | Expense Account (for amortization) |
| ------------------------------------- | --------------------------- | ---------------------------------- |
| `domain`, `namecheap`, `sotto.fm`     | `Assets:Prepaid:Domain`     | `Expenses:Infrastructure:Domain`   |
| `api credit`, `credit`, `prepaid api` | `Assets:Prepaid:APICredits` | (depends on provider — ask)        |

---

## Mode 1: Quick Expense

**Trigger:** `/expense <amount> <description>`

Example: `/expense 11.00 Hetzner VPS`

### Step 1: Parse Input

Extract:

- **Amount**: The numeric value (first argument after `/expense`)
- **Description**: Everything after the amount

Validate the amount is a valid positive number with up to 2 decimal places.

### Step 2: Match Account

Use the **Account Matching Rules** above to determine:

- Expense account
- Payee
- Payment account
- Narration

### Step 3: Check for Duplicates

Read the current month file:

```
Read: accounting/ledger/YYYY/MM-monthname.beancount
```

Search for existing transactions with the **same payee AND same expense account AND same amount** within ±3 days of today.

**Exact duplicate** (same date + payee + account + amount): Show a strong warning:

```
WARNING: Exact duplicate found!
Existing entry on YYYY-MM-DD: "Payee" "Narration" → Account AMOUNT USD
This looks like a duplicate. Are you sure you want to add another?
```

**Near duplicate** (same payee + account + amount, different date within ±3 days): Show a soft warning:

```
Note: Similar transaction found on YYYY-MM-DD for the same amount.
This may be a duplicate — please verify.
```

### Step 4: Preview

Show the formatted transaction to the user:

```
Preview:

  YYYY-MM-DD * "Payee" "Narration"
    ExpenseAccount                    AMOUNT USD
    PaymentAccount                   -AMOUNT USD

File: accounting/ledger/YYYY/MM-monthname.beancount
```

Ask for confirmation:

```
AskUserQuestion:
  Q1: "Record this transaction?" header="Confirm"
    - "Yes, write it" — Append to month file
    - "Edit something" — Let me adjust before writing
```

If the user says "Edit something", ask what to change (payee, narration, account, amount, date) and re-preview.

### Step 5: Ensure Month File Exists

Check if the month file exists:

```
Glob: accounting/ledger/YYYY/MM-monthname.beancount
```

**If the file does NOT exist:**

1. Create the month file with a header:

```
Write: accounting/ledger/YYYY/MM-monthname.beancount
```

Content:

```beancount
; Sotto — MONTHNAME YYYY Transactions
; Monthly operational expenses and revenue
```

2. Add the include to `main.beancount`:

Read `accounting/ledger/main.beancount`, then append the include line:

```
Edit: accounting/ledger/main.beancount
```

Add `include "YYYY/MM-monthname.beancount"` at the end of the file, maintaining the existing style (one include per line). Make sure the directory `accounting/ledger/YYYY/` exists first:

```bash
mkdir -p accounting/ledger/YYYY
```

### Step 6: Write Transaction

Append the transaction to the month file using Edit. Add a blank line before the new transaction for readability.

The transaction format is:

```beancount

YYYY-MM-DD * "Payee" "Narration"
  ExpenseAccount                    AMOUNT USD
  PaymentAccount
```

Note: Beancount can auto-balance the second posting, so you can omit the amount on the payment account. However, for clarity, include explicit amounts on both postings:

```beancount

YYYY-MM-DD * "Payee" "Narration"
  ExpenseAccount                    AMOUNT USD
  PaymentAccount                   -AMOUNT USD
```

**Formatting rules:**

- Two spaces before account names
- Use enough spaces to right-align amounts at column 50 (approximately)
- Amounts have exactly 2 decimal places
- Blank line before each transaction

### Step 7: Validate

Run `bean-check` from the `accounting/` directory:

```bash
cd /home/ubuntu/Code/Sotto/accounting && uv run bean-check ledger/main.beancount
```

**If bean-check passes:** Report success:

```
Transaction recorded and validated.

  YYYY-MM-DD * "Payee" "Narration"
    ExpenseAccount    AMOUNT USD
    PaymentAccount   -AMOUNT USD
```

**If bean-check fails:**

1. Read the error output carefully
2. Common fixes:
   - **Account doesn't exist**: Check `accounts.beancount` for the correct account name
   - **Transaction doesn't balance**: Verify amounts sum to zero
   - **Duplicate entry**: The exact same transaction already exists
   - **Date out of range**: Date is before account open date
3. Fix the error by editing the transaction just written
4. Re-run `bean-check`
5. If the fix doesn't work after 2 attempts, revert the change (remove the appended transaction) and report the error to the user

---

## Mode 2: Revenue

**Trigger:** `/expense revenue <amount> <description>`

Example: `/expense revenue 14.00 Pro subscription user@example.com`

### Step 1: Parse Input

Extract:

- **Gross amount**: The numeric value
- **Description**: Everything after the amount

### Step 2: Match Revenue Account

Use the **Revenue Account Mapping** above.

### Step 3: Calculate Stripe Fees

Stripe fee formula: **2.9% + $0.30**

```
fee = round(gross_amount * 0.029 + 0.30, 2)
net_amount = round(gross_amount - fee, 2)
```

Examples:

- $14.00 Pro → fee: $0.71, net: $13.29
- $29.00 Creator → fee: $1.14, net: $27.86

### Step 4: Check for Duplicates

Same logic as Mode 1 but check against the revenue account and `Stripe` payee.

### Step 5: Preview

```
Preview:

  YYYY-MM-DD * "Stripe" "Pro subscription — user@example.com"
    Assets:Current:Cash:Stripe                   NET_AMOUNT USD
    Expenses:PaymentProcessing:StripeFees        FEE_AMOUNT USD
    Income:Subscriptions:Pro                    -GROSS_AMOUNT USD

File: accounting/ledger/YYYY/MM-monthname.beancount
```

Ask for confirmation (same as Mode 1).

### Step 6: Ensure Month File + Write

Same as Mode 1 Steps 5-6, but with the 3-posting format:

```beancount

YYYY-MM-DD * "Stripe" "DESCRIPTION"
  Assets:Current:Cash:Stripe                   NET_AMOUNT USD
  Expenses:PaymentProcessing:StripeFees        FEE_AMOUNT USD
  Income:Subscriptions:Pro                    -GROSS_AMOUNT USD
```

### Step 7: Validate

Same as Mode 1 Step 7.

---

## Mode 3: Prepaid

**Trigger:** `/expense prepaid <amount> <description> <months>`

Example: `/expense prepaid 70.00 Namecheap domain 12`

### Step 1: Parse Input

Extract:

- **Amount**: The total prepaid amount
- **Description**: What was prepaid
- **Months**: Number of months to amortize over (last numeric argument)

### Step 2: Match Accounts

Use the **Prepaid Account Mapping** to determine:

- Prepaid asset account (debit)
- Payment account (credit)
- Expense account (for future amortization)

### Step 3: Calculate Amortization

```
monthly_amount = round(amount / months, 2)
remainder = round(amount - (monthly_amount * months), 2)
```

If there's a remainder due to rounding, add it to the final month's amortization.

### Step 4: Preview

```
Preview — Prepaid Asset:

  YYYY-MM-DD * "Payee" "Description (MONTHS months)"
    Assets:Prepaid:Account                     AMOUNT USD
    PaymentAccount                            -AMOUNT USD

Amortization schedule (MONTHLY_AMOUNT USD/mo for MONTHS months):
  Month 1:  YYYY-MM-DD → MONTHLY_AMOUNT USD
  Month 2:  YYYY-MM-DD → MONTHLY_AMOUNT USD
  ...
  Month N:  YYYY-MM-DD → MONTHLY_AMOUNT USD (+ REMAINDER adjustment)

Note: Run `/expense amortize` at month-end to generate amortization entries.

File: accounting/ledger/YYYY/MM-monthname.beancount
```

Ask for confirmation.

### Step 5: Write Prepaid Transaction

Write the initial prepaid asset purchase to the month file. Also add a comment noting the amortization schedule:

```beancount

; Prepaid: DESCRIPTION — AMOUNT USD over MONTHS months (MONTHLY_AMOUNT/mo)
; Amortize with: /expense amortize
YYYY-MM-DD * "Payee" "Description (MONTHS months prepaid)"
  Assets:Prepaid:Account                     AMOUNT USD
  PaymentAccount                            -AMOUNT USD
```

### Step 6: Validate

Same as Mode 1 Step 7.

---

## Mode 4: Amortize

**Trigger:** `/expense amortize`

Generates monthly amortization entries for all active prepaid assets.

### Step 1: Find Active Prepaids

Read all transaction files to find prepaid entries:

```
Grep: pattern="Assets:Prepaid:" path="accounting/ledger/"
```

For each prepaid asset, find:

- The original purchase transaction (amount, months, start date)
- Any existing amortization entries already written
- The remaining balance

### Step 2: Calculate Entries Needed

For each prepaid asset:

- Determine the current month
- Check if an amortization entry already exists for this month
- If not, calculate the monthly amount from the original purchase comment

### Step 3: Preview All Amortization Entries

```
Amortization entries for MONTHNAME YYYY:

  1. Domain — sotto.fm
     YYYY-MM-DD * "Domain amortization" "sotto.fm — MONTHNAME YYYY (N/TOTAL)"
       Expenses:Infrastructure:Domain              5.83 USD
       Assets:Prepaid:Domain                      -5.83 USD

  Total amortization: XX.XX USD

No entry needed:
  - (none, or list skipped items)
```

Ask for confirmation.

### Step 4: Write Entries

Append all amortization entries to the current month file. Format:

```beancount

YYYY-MM-DD * "DESCRIPTION amortization" "ASSET — MONTHNAME YYYY (N/TOTAL)"
  ExpenseAccount                              MONTHLY_AMOUNT USD
  Assets:Prepaid:Account                     -MONTHLY_AMOUNT USD
```

Use the last day of the current month as the date for amortization entries:

- Jan → 31, Feb → 28/29, Mar → 31, Apr → 30, etc.

```bash
date -d "$(date +%Y-%m-01) +1 month -1 day" +%Y-%m-%d
```

### Step 5: Validate

Same as Mode 1 Step 7.

---

## Mode 5: Status

**Trigger:** `/expense status`

**Read-only mode.** Shows a financial summary for the current month.

### Step 1: Read All Ledger Files

```
Read: accounting/ledger/main.beancount
Read: accounting/ledger/accounts.beancount
Read: accounting/ledger/opening.beancount
```

Read all month files:

```
Glob: accounting/ledger/YYYY/*.beancount
```

Read each file found.

### Step 2: Run Bean-Report (if available)

Try running a balance report:

```bash
cd /home/ubuntu/Code/Sotto/accounting && uv run bean-report ledger/main.beancount balances 2>/dev/null || echo "bean-report not available"
```

If bean-report is not available, manually parse transactions from the files.

### Step 3: Compile Summary

Parse all transactions in the current month file to compute:

- **Total expenses by category** (group by top-level expense account)
- **Total revenue by type**
- **Cash position** (opening balance + revenue - expenses)
- **Outstanding payables** (AP accounts)
- **Prepaid assets remaining**

### Step 4: Display Report

```
Sotto Financial Status — MONTHNAME YYYY
══════════════════════════════════════════

Cash Position:
  Bank:                    $XX.XX
  Stripe:                  $XX.XX
  Total cash:              $XX.XX

Revenue (this month):
  Pro subscriptions:       $XX.XX (N transactions)
  Creator subscriptions:   $XX.XX (N transactions)
  API keys:                $XX.XX
  Total revenue:           $XX.XX

Expenses (this month):
  Infrastructure:          $XX.XX
    Compute (Hetzner):     $XX.XX
    Storage (R2):          $XX.XX
    Domain:                $XX.XX
  AI Services:             $XX.XX
    Claude:                $XX.XX
  TTS:                     $XX.XX
    ElevenLabs:            $XX.XX
  Payment Processing:      $XX.XX
  Software:                $XX.XX
  Total expenses:          $XX.XX

Net Income:                $XX.XX

Accounts Payable:
  Hetzner:                 $XX.XX
  Anthropic:               $XX.XX
  ElevenLabs:              $XX.XX

Prepaid Assets:
  Domain (sotto.fm):       $XX.XX (N months remaining)

Bean-check status: PASS / FAIL (N errors)
```

**Do not write any files.** This mode is strictly read-only.

---

## Mode 6: Validate

**Trigger:** `/expense validate`

**Runs `bean-check` and reports results.**

### Step 1: Run Bean-Check

```bash
cd /home/ubuntu/Code/Sotto/accounting && uv run bean-check ledger/main.beancount 2>&1
```

### Step 2: Report Results

**If no errors:**

```
Ledger validates cleanly. No errors found.
```

**If errors found:**

Parse each error and display:

```
bean-check found N error(s):

  1. FILE:LINE — ERROR_MESSAGE
     Context: [show the problematic line]

  2. FILE:LINE — ERROR_MESSAGE
     Context: [show the problematic line]
```

Then ask:

```
AskUserQuestion:
  Q1: "Should I attempt to fix these errors?" header="Fix"
    - "Yes, fix them" — Attempt automated fixes
    - "No, just report" — Leave as-is
```

### Step 3: Auto-Fix (if requested)

Common auto-fixes:

| Error                              | Fix                                                   |
| ---------------------------------- | ----------------------------------------------------- |
| Transaction does not balance       | Recalculate amounts to balance                        |
| Invalid account name               | Find closest matching account from accounts.beancount |
| Duplicate transaction              | Remove the duplicate (keep the first one)             |
| Amount has too many decimal places | Round to 2 decimal places                             |

After each fix, re-run `bean-check` to verify. Report what was fixed.

---

## Mode 7: Close

**Trigger:** `/expense close`

Full monthly close procedure.

### Step 1: Determine Month

Use the current month by default. If it's the first few days of a new month (1st-5th), ask:

```
AskUserQuestion:
  Q1: "Which month to close?" header="Month"
    - "PREVIOUS_MONTHNAME YYYY" — Close the previous month (Recommended)
    - "CURRENT_MONTHNAME YYYY" — Close the current month
```

### Step 2: Run Amortization

Execute Mode 4 (Amortize) for the target month. This ensures all prepaid assets have their monthly entries.

### Step 3: Validate

Execute Mode 6 (Validate). All errors must be resolved before proceeding.

### Step 4: Generate Month Summary

Execute Mode 5 (Status) for the target month.

### Step 5: Add Closing Comment

Append a closing comment to the month file:

```beancount

; ============================================================
; Month closed: YYYY-MM-DD
; Validated: bean-check PASS
; ============================================================
```

### Step 6: Report

```
Monthly Close — MONTHNAME YYYY
════════════════════════════════

Amortization:     N entries written
Validation:       PASS
Total revenue:    $XX.XX
Total expenses:   $XX.XX
Net income:       $XX.XX

Month file closed: accounting/ledger/YYYY/MM-monthname.beancount
```

---

## Transaction Formatting Reference

### Standard Expense

```beancount
YYYY-MM-DD * "Payee" "Narration"
  Expenses:Category:Subcategory              AMOUNT USD
  Assets:Current:Cash:Bank                  -AMOUNT USD
```

### Vendor-Billed Expense (AP)

```beancount
YYYY-MM-DD * "Payee" "Narration"
  Expenses:Category:Subcategory              AMOUNT USD
  Liabilities:AccountsPayable:Vendor        -AMOUNT USD
```

### Revenue with Stripe Fees

```beancount
YYYY-MM-DD * "Stripe" "Narration"
  Assets:Current:Cash:Stripe                 NET USD
  Expenses:PaymentProcessing:StripeFees      FEE USD
  Income:Subscriptions:Tier                 -GROSS USD
```

### Prepaid Asset Purchase

```beancount
; Prepaid: DESCRIPTION — AMOUNT USD over N months (MONTHLY/mo)
YYYY-MM-DD * "Payee" "Narration (N months prepaid)"
  Assets:Prepaid:Type                        AMOUNT USD
  Assets:Current:Cash:Bank                  -AMOUNT USD
```

### Amortization Entry

```beancount
YYYY-MM-DD * "TYPE amortization" "ASSET — MONTHNAME YYYY (N/TOTAL)"
  Expenses:Category:Subcategory              MONTHLY USD
  Assets:Prepaid:Type                       -MONTHLY USD
```

---

## Formatting Rules

1. **Two-space indent** before account names in postings
2. **Right-align amounts** — use enough whitespace so amounts approximately align around column 50
3. **Exactly 2 decimal places** on all amounts (e.g., `5.00`, not `5`)
4. **Blank line** between transactions
5. **Payee in double quotes**, narration in double quotes: `"Payee" "Narration"`
6. **Asterisk `*`** for cleared transactions (all transactions we record are cleared)
7. **Semicolons** for comments: `; This is a comment`
8. **ISO dates**: `YYYY-MM-DD`
9. **Currency**: Always `USD`

---

## Duplicate Detection

Before writing any transaction, check the current month file for potential duplicates.

### Exact Duplicate

Same date + same payee + same expense/revenue account + same amount.

**Action:** Show strong warning, require explicit confirmation to proceed.

### Near Duplicate

Same payee + same account + same amount, but date differs by 1-3 days.

**Action:** Show informational warning, proceed with normal confirmation.

### How to Check

Read the month file and parse existing transactions. For each existing transaction, compare:

```
existing.date within ±3 days of new.date
existing.payee == new.payee (case-insensitive)
existing.account == new.account
existing.amount == new.amount
```

---

## Error Recovery

### Bean-Check Fails After Write

1. Read the error message from `bean-check`
2. Identify the problematic line in the month file
3. Attempt to fix (see common fixes in Mode 6)
4. Re-run `bean-check`
5. If the fix fails after 2 attempts:
   - Revert the change by removing the appended transaction from the month file using Edit
   - Report the error to the user with the full bean-check output
   - Suggest what might need to be corrected

### Month File Doesn't Exist

1. Create the directory: `mkdir -p accounting/ledger/YYYY`
2. Create the month file with a header comment
3. Add the include to `main.beancount`
4. Verify with `bean-check` before writing the transaction

### Account Not Found

If `bean-check` reports an unknown account:

1. Read `accounts.beancount` to find the closest matching account
2. Show the user the suggested correction
3. Apply the fix with confirmation

---

## Quality Checklist

Before writing any transaction, verify:

- [ ] Amount is a valid positive number with 2 decimal places
- [ ] Payee is a clean vendor name (not raw description)
- [ ] Narration is descriptive and includes period if recurring
- [ ] Expense/revenue account exists in `accounts.beancount`
- [ ] Payment account is correct (AP for vendor-billed, Bank/Stripe for direct)
- [ ] Transaction balances to zero (debits = credits)
- [ ] No duplicate exists (or duplicate warning was acknowledged)
- [ ] Month file exists and is included in `main.beancount`
- [ ] `bean-check` passes after writing

---

## Usage

```
/expense 11.00 Hetzner VPS                          # Quick expense
/expense 0.50 R2 storage                            # Cloudflare R2 storage
/expense 3.20 Claude API usage                      # Claude misc usage
/expense 25.00 ElevenLabs standard TTS              # ElevenLabs TTS
/expense 15.00 GitHub dev tools                     # Software expense

/expense revenue 14.00 Pro subscription user@e.com  # Pro sub with Stripe fees
/expense revenue 29.00 Creator sub creator@e.com    # Creator sub with Stripe fees
/expense revenue 5.00 API key access dev@company    # API key revenue

/expense prepaid 70.00 Namecheap domain 12          # Prepaid over 12 months
/expense prepaid 100.00 Claude API credits 6        # Prepaid API credits

/expense amortize                                   # Write this month's amortization
/expense status                                     # View financial summary
/expense validate                                   # Run bean-check
/expense close                                      # Full monthly close
```
