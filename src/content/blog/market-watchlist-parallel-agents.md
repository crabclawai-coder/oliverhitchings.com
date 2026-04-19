---
title: "Watching the markets at 9pm so I don't have to: 7 parallel sub-agents and a 4% threshold"
description: 'How I built a stock and crypto watchlist that pings me at 9pm every weekday with prices, then automatically deep-researches anything that moved more than 4%. The same pattern works for any monitoring workflow.'
pubDate: '2026-04-12'
---

I check my positions too often. I always have. The cure isn&rsquo;t willpower &mdash; it&rsquo;s automation.

Every weekday at 21:00 Europe/London (after the US market closes), an OpenClaw cron called `market-watchlist` fires. It pulls prices for 7 tickers I care about, formats them as a clean message, and only does the expensive thing &mdash; deep research &mdash; for tickers that moved more than 4% that day.

That last constraint is what makes this work. Without it I&rsquo;d be paying for 35 deep-research runs a week to learn that nothing happened.

## The structure

The job runs 7 sub-agents in parallel, one per ticker:

- TSLA, NVDA, AVGO, META, GOOG (equities I hold or watch)
- BTC, ETH (crypto)

Each sub-agent does the same simple thing: hit Yahoo Finance, get today&rsquo;s open, current, change %. They report back to a coordinator agent.

The coordinator does two things:
1. Builds the daily summary message (always sent)
2. For any ticker with `|change%| > 4`, spawns a **research sub-agent** that pulls news headlines from the last 24h and summarises why the price moved

A normal day: just the summary. A noisy day: summary + 1-3 research blurbs explaining the moves.

## Why 4%

Because below that, &ldquo;news&rdquo; is just noise. A 1% move on TSLA on any given day means nothing. A 6% move means there&rsquo;s a story I should know.

I picked the threshold by eyeballing about a month of data. Below 4%, the &ldquo;research&rdquo; was always &ldquo;general market sentiment&rdquo; or some analyst saying nothing. Above 4%, there was usually a real reason: earnings, regulatory news, a tweet from someone who shouldn&rsquo;t tweet.

## What this looks like as code

The whole thing is one cron entry. Conceptually:

```
spawn 7 sub-agents [pull price] in parallel
  └── coordinator collects results
        ├── format daily summary
        └── for each ticker where |change%| > threshold:
              spawn research sub-agent
              └── append research to message
send message to Telegram + Discord #finance
```

It runs on the local model. Each ticker pull is one HTTP request. The research sub-agents do a web search and a summarisation. End-to-end: about 90 seconds on a noisy day, 15 seconds on a quiet one.

## The pattern for businesses

Swap &ldquo;tickers&rdquo; for anything you watch.

- Customer support: ping me when ticket queue grows by more than 20% in an hour
- Sales: deep-research any deal that&rsquo;s moved between stages today
- Operations: alert me on any SKU whose stock has dropped below the 7-day average minus 2 standard deviations
- Site reliability: investigate any endpoint with p99 latency above the rolling baseline

The shape is identical: cheap polling at high frequency, expensive analysis only when something interesting happens. The threshold is the magic. Without it you either drown in noise or miss the signal.

## What I&rsquo;d warn you about

**Don&rsquo;t set the threshold from gut feel.** Run the polling for two weeks first, log everything, then look at the distribution and pick a threshold that catches the genuinely interesting cases without flooding you. The threshold should change every six months as your baseline shifts.

**Build the kill switch first.** My market watchlist nearly DM&rsquo;d me 47 times in a single hour during the March crypto wobble. I now have a hard cap: max 3 research blurbs per run. Anything beyond that gets summarised into one paragraph.

**Decide who reads it.** A morning brief I read in bed is one thing. A real-time alert that wakes someone up at 3am is a totally different design problem.

---

This is the same architecture that would watch your business&rsquo;s noisy systems and tell you only what matters. [Tell me what your team is monitoring manually](/services) and we&rsquo;ll see if there&rsquo;s a 4%-threshold version of it.
