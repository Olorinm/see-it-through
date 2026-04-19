---
name: claude-autopilot
description: Use in Claude Code when the user wants the task to keep running until the whole checkpoint plan is complete. This skill verifies the task, creates a detailed plan, mirrors it into a persisted managed task packet, and keeps checkpointing until every checkpoint is done, paused, blocked, or cancelled.
---

# Claude Autopilot

Use this skill only in Claude Code.

The target workflow is: enable the skill, confirm the task once, persist a detailed checkpoint plan, then keep working until the managed task says the plan is complete.

## Default behavior

1. Read the task and verify the boundary once.
2. If the task is ambiguous, ask one short clarification question.
3. If it is clear enough, restate the goal and assumptions briefly.
4. Produce a detailed host plan.
5. Mirror that plan into `start_claude_managed_task`.
6. Work one checkpoint at a time.
7. After each meaningful chunk, call `checkpoint_claude_managed_task`.
8. Keep going until every checkpoint is complete, or the lifecycle becomes paused, blocked, cancelled, or done.

## Planning standard

Prefer host planning tools when they exist.

- If Claude exposes todo or task-planning tools such as `TodoWrite`, `TaskCreate`, or `TaskUpdate`, use them first.
- Mirror that detailed plan into `start_claude_managed_task` with explicit `checkpoints`.
- Also pass `planMarkdown` whenever you have a detailed textual plan.

The persisted checkpoint packet is the durable source of truth. Host todos are helpful, but the managed task packet decides what checkpoint is current.

## Claude-specific loop

Claude Code uses hooks instead of a thread heartbeat here.

- `UserPromptSubmit` and `SessionStart` hooks remind Claude which managed task is active.
- The `Stop` hook blocks Claude from ending the run while the managed task lifecycle is still `running`.
- To stop cleanly, checkpoint the lifecycle first:
  - user says pause -> `pause`
  - user says cancel -> `cancel`
  - user says stop after this part -> `stopAfterCurrentCheckpoint`

If Claude tries to stop early, treat the Stop hook reason as the next instruction.

## Checkpoint quality

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

Mainly report:

1. current checkpoint
2. completed checkpoints
3. remaining exit conditions

Do not mainly report vague state words alone.

## Resume rule

When Claude regains context after a stop, compaction, or restart:

1. Call `resume_claude_managed_task` first.
2. Trust the returned checkpoint cursor and continuation prompt over memory.
3. Continue the current checkpoint until its exit conditions are satisfied.
