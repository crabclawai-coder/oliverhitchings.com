---
title: 'What an AI agent actually is in 2026'
description: 'Cutting through the marketing: what makes something an agent, what doesn&apos;t, and why the distinction matters.'
pubDate: '2026-04-16'
---

The word &ldquo;agent&rdquo; got beaten to death in 2025. Every product launch, every framework, every demo. By the end of the year it had drifted so far from any specific meaning that vendors were calling a chatbot with a function-call tool an &ldquo;autonomous AI agent.&rdquo;

It&rsquo;s 2026. The dust has settled enough to say something useful.

## A working definition

An AI agent is a program that:

1. **Has a goal**, not just a prompt.
2. **Can take actions** in the world &mdash; not just generate text.
3. **Decides what to do next**, in a loop, until the goal is met or it gives up.
4. **Persists state** across turns, often across sessions.

If a system fails any of those, call it what it is. A chatbot. A copilot. A function-calling LLM. They&rsquo;re useful. They&rsquo;re not agents.

## The thing that actually changed

The shift in 2025-26 wasn&rsquo;t the models &mdash; though Claude 4.x and GPT-5 are obviously stronger. The shift was that the loop got cheap and reliable enough to leave running.

A year ago, leaving an agent running overnight meant waking up to a $40 API bill, a corrupted state file, and three half-finished tasks. Today my OpenClaw cron jobs run forty times a day on a local Qwen3.6 model. Cost: zero. Failures: rare enough that I notice them.

That&rsquo;s the unlock. Not intelligence. Reliability.

## Where agents still break

Three places, in my experience:

- **Long-horizon planning.** They drift. They forget the original goal three steps in. The fix is structural &mdash; explicit task decomposition, persistent memory, hard checkpoints &mdash; not bigger models.
- **Tool selection.** Give an agent twenty tools and it picks badly. Give it five and it picks well. Sub-agents with focused tool sets beat generalists every time.
- **Knowing when to stop.** This is the hardest one. Models will happily &ldquo;keep going&rdquo; forever if you don&rsquo;t tell them what done looks like. Verifiable success criteria are non-negotiable.

## What I&rsquo;m watching

The interesting frontier in 2026 isn&rsquo;t single-agent capability. It&rsquo;s **agent fleets** &mdash; systems where dozens of agents collaborate, hand off work, criticise each other&rsquo;s output, and self-organise around a goal. OpenClaw is my own small experiment in that direction. Anthropic&rsquo;s Claude Agent SDK and OpenAI&rsquo;s Swarm work hint at where this goes.

If you&rsquo;re still asking &ldquo;is this an agent?&rdquo; you&rsquo;re asking the wrong question. Ask: **what loop is it running, and what stops it?** That tells you everything.
