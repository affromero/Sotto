---
name: traffic-report
description: |
  Pull live analytics from sotto.fm production and generate a polished HTML traffic report.
  Modes: /traffic-report | /traffic-report 30d | /traffic-report weekly | /traffic-report quarterly
---

# Traffic Report — Sotto Analytics Skill

Pulls live analytics from sotto.fm's `/api/admin/traffic-report` endpoint and generates a polished HTML report via `/md-to-html`.

## Trigger

`/traffic-report`, `/traffic-report 30d`, `/traffic-report weekly`, `/traffic-report quarterly`

---

## Step 0: Parse Period Argument

Parse the argument to determine the period in days:

| Argument                        | Period |
| ------------------------------- | ------ |
| (empty), `7d`, `weekly`, `week` | 7      |
| `30d`, `monthly`, `month`       | 30     |
| `90d`, `quarterly`, `quarter`   | 90     |
| `1d`, `today`                   | 1      |
| Any integer N                   | N      |

Default: **7** days.

---

## Step 1: Read API Key

Read the `ADMIN_REPORT_KEY` from the project `.env` file:

```
Read: .env
```

Extract the value of `ADMIN_REPORT_KEY`. If not found, stop and tell the user to set it.

---

## Step 2: Fetch Data from Production

```bash
curl -s -H "Authorization: Bearer $ADMIN_REPORT_KEY" "https://sotto.fm/api/admin/traffic-report?period=DAYS"
```

Replace `$ADMIN_REPORT_KEY` with the value from Step 1 and `DAYS` with the period from Step 0.

If the response is not 200 or doesn't contain valid JSON, report the error and stop.

Parse the JSON response. The shape is:

```
{
  meta: { generatedAt, periodDays, since },
  traffic: { pageViews, uniqueVisitors, avgPagesPerSession, topPages[], referrers[], devices[], dailyVisitors[] },
  waitlist: { total, recentSignups, bySource[] },
  users: { total, signupsToday, signupsThisWeek, signupsThisMonth, tierDistribution },
  podcasts: { total, byStatus, totalPlays },
  playback: { sessionsInPeriod, avgCompletionPercent, avgListenSeconds },
  costs: { breakdown, dailyTrend[] }
}
```

---

## Step 3: Generate Markdown Report

Create the report file at `reports/traffic/traffic-report-YYYY-MM-DD.md` (use today's date).

Ensure the `reports/` directory exists:

```bash
mkdir -p reports/traffic
```

Write the markdown with these sections. Use the data from Step 2. Format all numbers with locale separators. Round percentages to 1 decimal place. Round dollar amounts to 2 decimal places.

### Report Template

```markdown
# Sotto Traffic Report

**Period:** {periodDays} days (since {since formatted as "Month Day, Year"})
**Generated:** {generatedAt formatted as "Month Day, Year at HH:MM UTC"}

---

## Site Traffic

| Metric             | Value                    |
| ------------------ | ------------------------ |
| Page Views         | {pageViews}              |
| Unique Visitors    | {uniqueVisitors}         |
| Avg Pages/Session  | {avgPagesPerSession}     |

### Visitors Over Time

| Date       | Visitors |
| ---------- | -------- |
| {for each dailyVisitors entry...} |

### Top Pages

| Page | Views |
| ---- | ----- |
| {for each topPages entry, up to 20...} |

### Referrers

| Source | Visits |
| ------ | ------ |
| {for each referrers entry, extract domain from URL...} |

### Device Breakdown

| Device  | Count | Share  |
| ------- | ----- | ------ |
| {for each devices entry, calculate % of total...} |

---

## Waitlist

| Metric          | Value             |
| --------------- | ----------------- |
| Total Signups   | {total}           |
| Recent ({N}d)   | {recentSignups}   |

### By Source

| Source  | Count |
| ------- | ----- |
| {for each bySource entry...} |

---

## Users

| Metric              | Value              |
| ------------------- | ------------------ |
| Total Users         | {total}            |
| Signups Today       | {signupsToday}     |
| Signups This Week   | {signupsThisWeek}  |
| Signups This Month  | {signupsThisMonth} |

### Tier Distribution

| Tier    | Users |
| ------- | ----- |
| {for each tier in tierDistribution...} |

---

## Podcasts

| Metric       | Value        |
| ------------ | ------------ |
| Total        | {total}      |
| Total Plays  | {totalPlays} |

### By Status

| Status | Count |
| ------ | ----- |
| {for each status in byStatus...} |

---

## Playback Engagement

| Metric              | Value                        |
| ------------------- | ---------------------------- |
| Sessions ({N}d)     | {sessionsInPeriod}           |
| Avg Completion      | {avgCompletionPercent}%      |
| Avg Listen Duration | {avgListenSeconds}s ({formatted as Xm Ys}) |

---

## Provider Costs

**Total ({period label}):** ${breakdown.totalCost}

### By Provider

| Provider | Total Cost | Calls | Avg/Call |
| -------- | ---------- | ----- | -------- |
| {for each provider in breakdown.providers...} |

### Daily Cost Trend

| Date       | Total   | {service columns...} |
| ---------- | ------- | -------------------- |
| {for each day in dailyTrend...} |
```

### Formatting Rules

- **Referrer domains:** Extract just the hostname from full URLs (e.g., `https://twitter.com/foo` becomes `twitter.com`)
- **Percentages:** 1 decimal place (e.g., `42.3%`)
- **Dollar amounts:** 2 decimal places with `$` prefix (e.g., `$1.23`)
- **Duration:** Convert seconds to `Xm Ys` format (e.g., 185s becomes `3m 5s`)
- **Empty sections:** If a section has no data (empty arrays, zero counts), include the header but write "No data for this period." instead of an empty table
- **Daily cost trend service columns:** Use the unique service names from the dailyTrend entries as dynamic column headers

---

## Step 4: Convert to HTML

Invoke the md-to-html skill to convert the report:

```
Skill: md-to-html, args: "reports/traffic/traffic-report-YYYY-MM-DD.md"
```

---

## Step 5: Report Output

Tell the user the output paths:

```
Traffic report generated:
  Markdown: reports/traffic/traffic-report-YYYY-MM-DD.md
  HTML:     reports/traffic/traffic-report-YYYY-MM-DD.html
```

---

## Step 6: Send via Telegram (Optional)

Ask the user if they want to send the HTML report to Telegram:

```
AskUserQuestion:
  Q1: "Send report to Telegram?" header="Telegram"
    - "Yes, send it" — Send the HTML file via /telegram
    - "No, skip" — Done
```

If yes, invoke the telegram skill with the HTML file:

```
Skill: telegram, args: "reports/traffic/traffic-report-YYYY-MM-DD.html"
```
