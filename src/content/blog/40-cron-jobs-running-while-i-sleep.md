---
title: "40 cron jobs running while I sleep: a tour"
description: "A walk through the 40 automated jobs my AI platform runs every day, week, and weekend — what each one does, what it cost to build, and what kind of business workflow it would replace."
pubDate: '2026-04-10'
---

People ask what an autonomous AI platform actually *does* day to day. The honest answer is: a lot of small, dull things, very reliably. Here&rsquo;s a walk through every cron job currently running on OpenClaw &mdash; the autonomous AI platform on my Mac Mini.

40 jobs. All running on a local model. Total monthly cost: roughly the electricity to keep the Mac Mini on.

## Daily

| Time | Job | What it does |
|---|---|---|
| 03:00 | Memory Dreaming | Promotes important things from short-term to long-term agent memory |
| 04:30 | HF model releases | Watches Hugging Face for new model drops from 6 creators I follow |
| 06:30 | Morning brief | Weather, news, markets, calendar &mdash; one Telegram message |
| 07:30 | Cal sync | Reconciles my work calendar with my personal one |
| 08:30 | GitHub trending | Pulls top repos from the last 24h, 3 parallel sub-agents categorise them |
| 11:00 | X trending (AI/tech) | Scrapes nitter for what&rsquo;s breaking in AI |
| 12:00 | Home network scan | nmap of 192.168.0.0/24, alerts on new devices |
| 17:30 | Innermost Loop digest | Daily synthesis of a specific Substack I follow |
| 18:00 | Evening brief | Day summary, what I shipped, what&rsquo;s for tomorrow |
| 18:00 | YouTube watcher | Checks 7 tracked channels, summarises new videos from last 12h |
| 19:00 | X trending (re-poll) | Same as 11:00, evening cycle |
| 21:00 | Market watchlist | Stocks, crypto, deep research on >4% movers |

That&rsquo;s 12 jobs a day, every day.

## Weekly

| When | Job | What it does |
|---|---|---|
| Sat 02:00 | Security review | Audits exposed services, ports, system health |
| Sat 03:00 | Self-audit | Agent drift detection across 4 parallel sub-agents |
| Sun 02:00 | Vault gardener | Hygiene pass over my Obsidian knowledge base (4 sub-agents) |
| Sun 10:00 | Intel sweep | Deep research on 4 topics I&rsquo;m tracking |

Plus another dozen weekly jobs handling smaller routines: backups, log rotations, agent metric digests, prompt-cache analysis, model cost summaries.

## What each one cost to write

The first cron took me a weekend. Once the framework was in place, each subsequent job took 1-3 hours to wire up: write the agent prompt, define the tool list, test, schedule. The market watchlist was the most complex (parallel sub-agents, dynamic research) and took about a day. Most are 90 minutes.

If I were billing for them, the average job cost would be **maybe 2-4 hours of engineering time** to design, build, test, and deploy &mdash; with a sharp drop after the first 5 because so much infrastructure gets reused.

## The pattern, distilled

Every job is the same shape:

1. **Trigger** &mdash; cron schedule
2. **Inputs** &mdash; data pulls (parallel where possible)
3. **Decision** &mdash; what&rsquo;s interesting, what&rsquo;s not
4. **Output** &mdash; message to a channel I already read

Once you have one of these, you have the template for all of them. The hard work is in the third step: deciding what counts as interesting. That&rsquo;s where most automation projects die &mdash; either everything looks interesting (noise) or nothing does (silence).

## What this would replace in a business

Look at your team&rsquo;s recurring meetings. Daily standups. Weekly status syncs. Monthly board reports. Quarterly reviews.

A surprising fraction of these meetings exist because someone needs to *manually compile* what happened recently. Replace the compile step with a cron job and you can either:

- Cancel the meeting (now the report exists already)
- Or shorten it dramatically (now everyone has the data, they can just discuss the implications)

Most businesses I look at have 5-15 of these recurring information-gathering rituals. Each one is a candidate.

## The unfair part

The unfair part is that, once you have a system like this running, the marginal cost of adding the 41st cron job is basically zero. New monitoring requirement? Another 90-minute job. New report format the boss wants? 30-minute tweak.

This is the leverage that AI agents actually provide. Not magic intelligence. Just very cheap, very reliable, very small pieces of work, run in massive parallel, every day, forever.

---

If you&rsquo;re looking at a list of recurring work your team does and wondering how much of it could be a cron job: [the answer is &ldquo;more than you think&rdquo;](/services).
