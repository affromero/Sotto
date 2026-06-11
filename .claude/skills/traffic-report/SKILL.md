---
name: traffic-report
description: |
  Pull live analytics from sotto.fm production and generate a polished HTML traffic report.
  Modes: /traffic-report | /traffic-report 30d | /traffic-report weekly | /traffic-report quarterly
---

# Traffic Report — Sotto Analytics Skill

Pulls live analytics from sotto.fm's `/api/v1/admin/traffic-report` endpoint and generates a polished HTML report via `/md-to-html`.

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
curl -s -H "Authorization: Bearer $ADMIN_REPORT_KEY" "https://sotto.fm/api/v1/admin/traffic-report?period=DAYS"
```

Replace `$ADMIN_REPORT_KEY` with the value from Step 1 and `DAYS` with the period from Step 0.

If the response is not 200 or doesn't contain valid JSON, report the error and stop.

Parse the JSON response. The shape is (18 sections):

```
{
  meta: { generatedAt, periodDays, since },
  traffic: { pageViews, uniqueVisitors, avgPagesPerSession, topPages[], referrers[], devices[], dailyVisitors[] },
  waitlist: { total, recentSignups, bySource[] },
  users: { total, signupsToday, signupsThisWeek, signupsThisMonth, roleDistribution[] },
  podcasts: { total, byStatus, totalPlays },
  playback: { sessionsInPeriod, avgCompletionPercent, avgListenSeconds },
  costs: { breakdown, dailyTrend[] },
  providers: { ttsDistribution[], aiProviderDistribution[], aiModelDistribution[], byokAdoption: { tts[], ai[] } },
  topics: { topTags[], depthDistribution[], audienceLevelDistribution[], toneDistribution[], durationTarget: { avg, median }, languageDistribution[] },
  sources: { sourceDistribution[], sourcePlatformDistribution[], humanVsAi: { human, ai } },
  engagement: { totals: { likes, saves, comments, forks, follows }, dailyTrend[], mostLiked[], mostForked[], mostCommented[] },
  interactions: { totalQuestions, byStatus, answerRate, incorporationRate, helpfulRate, avgQuestionsPerPodcast, publicVsPrivate },
  playbackDetails: { totalListenHours, speedDistribution[], avgPausesPerSession, avgSeeksPerSession, avgInterruptsPerSession, completionDistribution[] },
  content: { avgDurationSeconds, avgSegmentsPerPodcast, avgFileSizeBytes, visibilityDistribution[], podcastsWithForks, durationDistribution[] },
  freeTier: { config, usersWithFreeGenerations, avgFreeGenerationsUsed, usersExhaustedFreeTier, byokUsersCount },
  pipeline: { totalAttempted, totalFailed, failureRate, failedAtStage[], avgTimeToReadySeconds, inProgressByStatus[] },
  recommendations: { totalImpressions, totalClicks, totalQueues, ctr, queueRate, bySurface[], avgListenedPercent },
  collections: { total, totalItems, totalFollows, newInPeriod, mostFollowed[] },
  voices: { totalClones, bySourceType[], requestableCount, requestsByStatus[] }
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

### Role Distribution

| Role    | Users |
| ------- | ----- |
| {for each role in roleDistribution...} |

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

---

## Providers & BYOK

### TTS Provider Distribution (period)

| Provider | Podcasts |
| -------- | -------- |
| {for each ttsDistribution entry...} |

### AI Provider Distribution (period)

| Provider | Podcasts |
| -------- | -------- |
| {for each aiProviderDistribution entry...} |

### AI Model Distribution (period)

| Model | Podcasts |
| ----- | -------- |
| {for each aiModelDistribution entry...} |

### BYOK Adoption (cumulative)

**TTS Keys:**

| Provider | Users |
| -------- | ----- |
| {for each byokAdoption.tts entry...} |

**AI Keys:**

| Provider | Users |
| -------- | ----- |
| {for each byokAdoption.ai entry...} |

---

## Topics & Discovery

### Top Tags (period)

| Tag  | Slug | Podcasts |
| ---- | ---- | -------- |
| {for each topTags entry, up to 20...} |

### Depth Distribution

| Depth | Count |
| ----- | ----- |
| {for each depthDistribution entry...} |

### Audience Level Distribution

| Level | Count |
| ----- | ----- |
| {for each audienceLevelDistribution entry...} |

### Tone Distribution

| Tone | Count |
| ---- | ----- |
| {for each toneDistribution entry...} |

### Duration Target

| Metric | Value |
| ------ | ----- |
| Average | {durationTarget.avg} min |
| Median  | {durationTarget.median} min |

### Language Distribution

| Language | Podcasts |
| -------- | -------- |
| {for each languageDistribution entry...} |

---

## Sources

### Source Distribution (period)

| Source | Count |
| ------ | ----- |
| {for each sourceDistribution entry...} |

### Platform Distribution (imports, period)

| Platform | Count |
| -------- | ----- |
| {for each sourcePlatformDistribution entry...} |

### Human vs AI Content (period)

| Type  | Count |
| ----- | ----- |
| Human | {humanVsAi.human} |
| AI    | {humanVsAi.ai} |

---

## Engagement (period)

| Metric   | Total          |
| -------- | -------------- |
| Likes    | {totals.likes} |
| Saves    | {totals.saves} |
| Comments | {totals.comments} |
| Forks    | {totals.forks} |
| Follows  | {totals.follows} |

### Daily Engagement Trend

| Date | Likes | Saves | Comments | Forks |
| ---- | ----- | ----- | -------- | ----- |
| {for each dailyTrend entry...} |

### Most Liked Podcasts

| Podcast | Creator | Likes |
| ------- | ------- | ----- |
| {for each mostLiked entry, top 10...} |

### Most Forked Podcasts

| Podcast | Creator | Forks |
| ------- | ------- | ----- |
| {for each mostForked entry, top 10...} |

### Most Commented Podcasts

| Podcast | Creator | Comments |
| ------- | ------- | -------- |
| {for each mostCommented entry, top 10...} |

---

## Q&A Interactions (period)

| Metric                   | Value                     |
| ------------------------ | ------------------------- |
| Total Questions          | {totalQuestions}           |
| Answer Rate              | {answerRate}%             |
| Incorporation Rate       | {incorporationRate}%      |
| Helpful Rate             | {helpfulRate}%            |
| Avg Questions/Podcast    | {avgQuestionsPerPodcast}  |
| Public Questions         | {publicVsPrivate.public}  |
| Private Questions        | {publicVsPrivate.private} |

### By Status

| Status | Count |
| ------ | ----- |
| {for each status in byStatus...} |

---

## Playback Details (period)

| Metric               | Value                       |
| -------------------- | --------------------------- |
| Total Listen Hours   | {totalListenHours}          |
| Avg Pauses/Session   | {avgPausesPerSession}       |
| Avg Seeks/Session    | {avgSeeksPerSession}        |
| Avg Interrupts/Session | {avgInterruptsPerSession} |

### Speed Distribution

| Speed | Sessions |
| ----- | -------- |
| {for each speedDistribution entry...} |

### Completion Distribution

| Bucket | Sessions |
| ------ | -------- |
| {for each completionDistribution entry...} |

---

## Content Characteristics

| Metric                  | Value                     |
| ----------------------- | ------------------------- |
| Avg Duration            | {avgDurationSeconds}s ({formatted as Xm Ys}) |
| Avg Segments/Podcast    | {avgSegmentsPerPodcast}   |
| Avg File Size           | {avgFileSizeBytes} ({formatted as MB}) |
| Podcasts with Forks     | {podcastsWithForks}       |

### Visibility Distribution

| Visibility | Count |
| ---------- | ----- |
| {for each visibilityDistribution entry...} |

### Duration Distribution (READY podcasts)

| Bucket | Count |
| ------ | ----- |
| {for each durationDistribution entry...} |

---

## Free Tier Health

### Configuration

| Setting          | Value                         |
| ---------------- | ----------------------------- |
| AI Provider      | {config.aiProvider}           |
| AI Model         | {config.aiModel}              |
| TTS Provider     | {config.ttsProvider}          |
| Generation Limit | {config.generationLimit}      |

### Usage

| Metric                    | Value                          |
| ------------------------- | ------------------------------ |
| Users with Free Gens      | {usersWithFreeGenerations}     |
| Avg Free Gens Used        | {avgFreeGenerationsUsed}       |
| Users Exhausted Free Tier | {usersExhaustedFreeTier}       |
| Users with Both BYOK Keys | {byokUsersCount}              |

---

## Pipeline Health (period)

| Metric               | Value                      |
| -------------------- | -------------------------- |
| Total Attempted      | {totalAttempted}           |
| Total Failed         | {totalFailed}              |
| Failure Rate         | {failureRate}%             |
| Avg Time to Ready    | {avgTimeToReadySeconds}s ({formatted as Xm Ys}) |

### Failed at Stage

| Stage | Count |
| ----- | ----- |
| {for each failedAtStage entry...} |

### Currently In Progress

| Status | Count |
| ------ | ----- |
| {for each inProgressByStatus entry...} |

---

## Recommendations (period)

| Metric              | Value                    |
| ------------------- | ------------------------ |
| Total Impressions   | {totalImpressions}       |
| Total Clicks        | {totalClicks}            |
| Total Queues        | {totalQueues}            |
| CTR                 | {ctr}%                   |
| Queue Rate          | {queueRate}%             |
| Avg Listened %      | {avgListenedPercent}%    |

### By Surface

| Surface | Impressions | Clicks | Queues | CTR |
| ------- | ----------- | ------ | ------ | --- |
| {for each bySurface entry...} |

---

## Collections

| Metric         | Value              |
| -------------- | ------------------ |
| Total          | {total}            |
| Total Items    | {totalItems}       |
| Total Follows  | {totalFollows}     |
| New ({N}d)     | {newInPeriod}      |

### Most Followed Collections

| Collection | Creator | Followers |
| ---------- | ------- | --------- |
| {for each mostFollowed entry, top 5...} |

---

## Voice Clones

| Metric           | Value             |
| ---------------- | ----------------- |
| Total Clones     | {totalClones}     |
| Requestable      | {requestableCount} |

### By Source Type

| Source | Count |
| ------ | ----- |
| {for each bySourceType entry...} |

### Voice Requests by Status

| Status | Count |
| ------ | ----- |
| {for each requestsByStatus entry...} |
```

### Formatting Rules

- **Referrer domains:** Extract just the hostname from full URLs (e.g., `https://twitter.com/foo` becomes `twitter.com`)
- **Percentages:** 1 decimal place (e.g., `42.3%`)
- **Dollar amounts:** 2 decimal places with `$` prefix (e.g., `$1.23`)
- **Duration:** Convert seconds to `Xm Ys` format (e.g., 185s becomes `3m 5s`)
- **File sizes:** Convert bytes to MB with 1 decimal (e.g., `12.5 MB`)
- **Empty sections:** If a section has no data (empty arrays, zero counts), include the header but write "No data for this period." instead of an empty table
- **Daily cost trend service columns:** Use the unique service names from the dailyTrend entries as dynamic column headers
- **Rates:** answerRate, incorporationRate, helpfulRate, failureRate, ctr, queueRate are 0-1 floats — multiply by 100 and format as percentages

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
