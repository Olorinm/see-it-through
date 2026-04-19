---
name: see-it-through
description: Use when the user wants Codex or Claude Code to persist a detailed checkpoint plan first, keep updating it honestly, and continue until every checkpoint is finished, paused, blocked, or cancelled.
---

# See It Through

This skill is the umbrella workflow for long-running agent tasks.

## Core rule

Do not rely on memory and do not stop on vague status.

Instead:

1. verify the task
2. create a detailed plan
3. persist that plan as checkpoints
4. keep checkpointing real progress
5. continue until every checkpoint is actually resolved

## Host choice

- In Codex, prefer `start_codex_managed_task`
- In Claude Code, prefer `start_claude_managed_task`
- If host-specific automation is unavailable, fall back to the plain durable-task tools

## Reporting rule

Always mainly report:

1. current checkpoint
2. completed checkpoints
3. remaining exit conditions

The important question is not "is it active?" but "which checkpoint is the cursor on now?"
