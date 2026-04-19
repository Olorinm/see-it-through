---
name: codex-autopilot
description: Use in Codex when the user wants the task to keep running until the whole plan is complete. This skill verifies the task, creates a detailed host plan, mirrors it into persisted checkpoints, attaches a heartbeat, and keeps resuming until every checkpoint is done.
---

# Codex Autopilot

Use this skill only in Codex.

This is the high-agency version of the task loop. Once the task is understood, the job is to keep the same thread moving until every checkpoint in the plan is completed, paused, blocked, cancelled, or explicitly changed by the user.

## Default behavior

When this skill is enabled, the intended experience is:

1. The user gives a task.
2. You verify the task boundaries once.
3. You create a detailed live host plan.
4. You mirror that plan into a persisted checkpoint packet.
5. You attach a thread heartbeat.
6. You keep working until the whole checkpoint plan is complete.

Do not make the user manually orchestrate the loop unless the host is missing a required capability.

## Required loop

1. Read the task and verify it.
2. If the task is ambiguous, ask one short clarification question.
3. If the task is clear enough, restate the goal and assumptions briefly, then continue.
4. Use the host `update_plan` tool first to produce a detailed plan, not a tiny placeholder plan.
5. Mirror that detailed plan into `start_codex_managed_task`.
   - Pass explicit `checkpoints` when you can.
   - Also pass `planMarkdown` or equivalent detailed plan text when available.
6. Immediately create a thread heartbeat with `automation_update` using `codexHeartbeat.createRequest`.
7. Bind the returned automation id with `bind_codex_heartbeat`.
8. Work the current checkpoint only.
9. After each meaningful chunk, call both:
   - `update_plan` to keep the live host plan honest
   - `checkpoint_codex_managed_task` to persist the checkpoint cursor
10. When a heartbeat wakes this thread up, call `resume_codex_managed_task` first.
11. Keep going until every checkpoint is complete.
12. When the task is done, checkpoint it as done and delete the heartbeat.

## Planning standard

The plan should be detailed enough that a future wake-up can continue from the checkpoint cursor without guessing.

Prefer checkpoints with:

- a concrete title
- short detail
- explicit `doneWhen`
- optional `evidenceWanted`

Good:

- "Patch session refresh race"
- done when: "stale token no longer wins" | "login stays valid for 30 minutes"

Weak:

- "Handle auth stuff"

## Reporting standard

Do not mainly report generic status words like "active".

Mainly report:

1. current checkpoint
2. completed checkpoints
3. remaining exit conditions

## Stop behavior

Honor these user intents explicitly:

- "pause" -> `pause`
- "cancel" -> `cancel`
- "stop after this part" -> `stopAfterCurrentCheckpoint`

If the user says to stop after the current checkpoint, do not advance the cursor into the next checkpoint.

## Heartbeat rule

Treat the heartbeat as a fast recovery loop after the current run ends, not as the main execution engine while the run is alive.

That means:

- keep working directly while you still have execution time
- use the heartbeat so the thread resumes soon after the current run stops
- pause or delete the heartbeat when the lifecycle says to

## Good prompts

- "Use Codex autopilot for this migration."
- "Keep running until every checkpoint is complete."
- "Plan this carefully, then keep resuming until the full task is finished."
