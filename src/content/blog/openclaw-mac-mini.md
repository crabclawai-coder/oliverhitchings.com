---
title: 'OpenClaw: an autonomous AI on a Mac Mini, for $0/month'
description: 'How my Mac Mini ended up running 40 cron jobs, two agents, and a local 35B model — and why I&apos;d never put it in the cloud.'
pubDate: '2026-04-15'
---

The Mac Mini sits on a shelf next to my router. M-series chip, 64GB of RAM, one ethernet cable. From the outside it looks like a tidy little box doing nothing. From the inside, it&rsquo;s a forty-job autonomous AI platform.

I call it **OpenClaw**.

## The setup

Three native LaunchAgents do the heavy lifting:

- `ai.openclaw.gateway` &mdash; the brain. WebSocket API on port 18789. Manages every agent session.
- `ai.openclaw.node` &mdash; the runtime that hosts the agents themselves.
- `ai.openclaw.mlx-server` &mdash; a llama-server process serving Qwen3.6-35B-A3B (Q4_K_XL) on `127.0.0.1:8080`. This is the local brain.

Two agents run on top: **Roger**, my primary assistant, who talks to me through Telegram and Discord. And **Hermes**, a coding-focused agent I pair with for development.

Forty cron jobs run on a schedule. The morning brief at 7am. Markets at 9pm. GitHub trending at 8:30am. A weekly security audit Saturday morning. An obsidian vault gardener Sunday at 2am. All of it routed through Qwen3.6 locally &mdash; no API calls, no cloud bills.

## Why local-first

People ask why I don&rsquo;t just use OpenAI&rsquo;s Assistants API or Anthropic&rsquo;s managed agents. Three reasons:

**Cost.** Forty cron jobs a day across forty agents would run me hundreds of dollars a month on cloud APIs. On the Mac Mini, the marginal cost is electricity. Maybe a pound a day.

**Control.** When something breaks at 3am during the memory-dreaming job, I want to read the logs locally, not page through a cloud dashboard. When I want to add a new cron job, it&rsquo;s a `openclaw cron add` away.

**Privacy.** A lot of what Roger sees is personal. My emails. My calendar. My positions. My conversations with Riri. None of that should ever leave the box.

## The escape valve

That said, I&rsquo;m not a purist. When a job needs the big guns &mdash; deep research, complex reasoning, code review &mdash; OpenClaw routes to **Codex via free ChatGPT OAuth** as the primary, and **Claude Opus 4.6** as a fallback. Both authenticated through OAuth, both effectively free for my volume.

Local-first doesn&rsquo;t mean local-only. It means local-by-default, with sharp tools when you need them.

## What it&rsquo;s like to live with

Honestly, it&rsquo;s changed how I work. The morning brief at 7am means I never start a day cold. The 9pm market watchlist catches mover stories I&rsquo;d miss. The weekly retro every Sunday tells me what I actually shipped, not what I think I shipped. The home network scan at noon catches new devices.

Some of it is automation that would be possible without AI. Most of it isn&rsquo;t. The agents read articles, summarise them, decide what&rsquo;s worth pinging me about, and write the message in my voice. That requires judgement, and judgement is what these models bring.

## What&rsquo;s next

I&rsquo;ll write up specific pieces over the next few months &mdash; the cron architecture, the memory store, the Discord channels, the way Hermes pairs with Claude Code. If you&rsquo;re building something similar, [find me on GitHub](https://github.com/CanYouLikeNot) and tell me what you&rsquo;re working on.
