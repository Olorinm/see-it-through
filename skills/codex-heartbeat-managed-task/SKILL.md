---
name: codex-heartbeat-managed-task
description: Use in Codex when a task should keep waking this thread up, resume from a persisted plan, and clean up its own heartbeat when the goal is done.
---

# Codex Heartbeat Managed Task

Use this skill only in Codex.

For Claude Code or host-neutral workflows, use `durable-task-loop` instead.

## Required loop

1. If the host `update_plan` tool is available, use it first to build a detailed checkpoint plan.
2. Mirror that detailed plan into `start_codex_managed_task` as `checkpoints` and optional `planMarkdown`.
3. Immediately create a thread heartbeat with the returned `codexHeartbeat.createRequest`.
4. Capture the returned automation id and bind it with `bind_codex_heartbeat`.
5. Do one meaningful chunk of work against the current checkpoint only.
6. After each chunk, call `checkpoint_codex_managed_task`.
7. On each heartbeat wake-up, call `resume_codex_managed_task` first.
8. Follow `codexHeartbeat.recommendedAutomationAction`:
   - `create`: create the heartbeat now
   - `update`: refresh it with `automation_update`
   - `pause`: pause it while blocked, paused, or stopped after the current checkpoint
   - `delete`: delete it after reporting completion
9. Only stop when the managed task is `done`, `paused`, `blocked`, or `cancelled`.

## Defaults

- Prefer task directories like `.codex/tasks/<slug>`.
- Default active heartbeat cadence is 1 minute so Codex can resume soon after a run ends.
- Keep the heartbeat on the current thread with `destination="thread"`.

## Important rule

Do not rely on memory alone. The source of truth is the persisted task packet plus `codex-heartbeat.json`.

Also do not mainly report generic status words. Report the current checkpoint, completed checkpoints, and remaining exit conditions.

## Good prompts

- "Use the Codex heartbeat managed task loop for this refactor."
- "Keep waking this thread up every 30 minutes until the migration is done."
- "Persist the plan, attach a heartbeat, and keep going until verification passes."
