---
title: "The 7am morning brief: replacing 30 minutes of news scrolling with a Telegram message"
description: 'How I automated my entire morning catch-up — weather, news, markets, calendar — into one Telegram message that lands at 7am. Costs nothing, runs locally, never misses a day.'
pubDate: '2026-04-15'
---

For about a year I started every morning the same way. Coffee. Phone. Twitter. News. Weather app. Market ticker. Calendar. By the time I&rsquo;d done all of it I&rsquo;d burned 30 minutes and absorbed maybe 5 minutes of useful information.

Now I get a single Telegram message at 7am. It tells me the weather, three headlines I actually care about, what my positions did overnight, and what&rsquo;s on my calendar today. Total time to read: 60 seconds.

Here&rsquo;s how it works, and why this same pattern would work for any business with a daily catch-up ritual.

## What it does

Every morning at 7:00 Europe/London, an OpenClaw cron job called `morning-brief` fires. It runs in parallel:

- Pulls weather for my location from a free API
- Hits 3 news feeds I subscribe to (BBC, FT, a curated tech digest)
- Asks Yahoo Finance for the overnight moves on my watchlist (TSLA, NVDA, AVGO, META, GOOG, BTC, ETH)
- Reads my Google Calendar for the day
- Summarises everything into one message

The message goes to Telegram. I read it before I&rsquo;m even out of bed.

## What&rsquo;s under the hood

The whole thing is a `.json` cron entry pointing at a local model running on my Mac Mini. Total moving parts:

```
cron job → agent prompt → 5 parallel tool calls → model summarises → Telegram delivery
```

Cost per run: zero. The model is local. Telegram&rsquo;s Bot API is free. The data sources are all free or cheap APIs I already had keys for.

The agent prompt is about 200 lines. It includes the format I want (markdown headings, specific section order, never longer than 10 bullet points), the tools it&rsquo;s allowed to call, and one explicit rule: **don&rsquo;t make anything up; if a tool fails, say so.**

That last rule matters more than people think. Most automation breaks not because the model is bad, but because someone built it without thinking about what happens when one of the inputs is missing.

## What this would look like for a business

Swap &ldquo;news headlines&rdquo; for &ldquo;overnight orders&rdquo;. Swap &ldquo;market positions&rdquo; for &ldquo;outstanding invoices&rdquo;. Swap &ldquo;calendar&rdquo; for &ldquo;ticket queue depth&rdquo;.

Same pattern: one cron, parallel data pulls, summary, delivery to wherever the team already lives (Slack, Teams, email, whatever).

I&rsquo;ve seen businesses with three different people doing 20 minutes of manual report-pulling every morning before they can start work. That&rsquo;s an hour of senior time burned on a workflow a $200 agent could do in 90 seconds.

## What I&rsquo;d watch out for

**Don&rsquo;t use a chat model for structured data.** If you need exact numbers, parse them with code and have the model only do the summary text. Otherwise it will hallucinate &ldquo;TSLA up 2.3%&rdquo; when the real answer was 1.8%.

**Have a fallback channel.** My morning brief sometimes silently fails when an upstream API is down. I added a heartbeat: if the brief doesn&rsquo;t arrive by 7:05, a second cron pings me on Discord. Belt and braces.

**Make it easy to change.** Every business&rsquo;s morning report drifts. Build the agent so the user can edit one config file and the whole brief shape changes. Don&rsquo;t make people open a pull request to add a section.

---

If your team has a daily ritual that eats 20+ minutes per person and doesn&rsquo;t change much day to day, it&rsquo;s a candidate for this pattern. [Email me](/services) and we&rsquo;ll talk.
