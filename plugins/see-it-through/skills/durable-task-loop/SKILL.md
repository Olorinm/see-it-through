---
name: durable-task-loop
description: Keep long Codex or Claude Code tasks on rails by saving a plan first, checkpointing progress after each meaningful chunk, and resuming from a generated continuation prompt when the host run stops early.
---

# Durable Task Loop

Use this skill for open-ended tasks that may take multiple turns, long implementations, repeated verification, or cleanup that agents often abandon too early.

## Required loop

1. Before non-trivial work, produce a detailed plan.
2. If the host exposes a live plan tool such as Codex `update_plan`, use it first for the detailed plan.
3. Mirror that plan into `start_durable_task` as checkpoint data and optional `planMarkdown`.
4. Save the task packet inside the workspace. Prefer a stable path such as `.codex/tasks/<slug>` or `./output/tasks/<slug>`.
5. Do one meaningful chunk of work against the current checkpoint only.
6. Call `checkpoint_durable_task` after that chunk with:
   - what changed
   - which checkpoint ids finished
   - which checkpoint is current now
   - any new blockers
   - whether the user asked to pause, cancel, or stop after the current checkpoint
   - artifacts or files worth preserving
7. Keep going while the tool returns `shouldContinue: true`.
8. If the run is interrupted or resumed later, call `resume_durable_task` first and continue from the returned `currentCheckpoint`, `doneWhen`, and `continuePrompt`.
9. Only stop when the task is `done`, `paused`, `blocked`, or `cancelled`.

## Planning rules

- Prefer checkpoint plans over vague status updates.
- A checkpoint should describe an observable milestone, not a fuzzy intention.
- Every important checkpoint should have exit conditions (`doneWhen`).
- Record acceptance criteria when the user gives them or the task clearly implies them.
- Keep verification as an explicit checkpoint.
- When new subproblems appear, add checkpoints through `checkpoint_durable_task` instead of silently changing course.

## Lifecycle rules

Checkpoint states:

- `pending`: not started
- `current`: the checkpoint being worked right now
- `completed`: finished and good enough for this loop
- `blocked`: cannot move until a dependency, approval, or missing context is resolved

Task lifecycles:

- `running`: continue immediately
- `blocked`: wait for user input, approval, or an external condition
- `paused`: preserve the cursor and stop automatic continuation
- `cancelled`: stop the loop entirely unless the user explicitly reopens it
- `done`: goal met and ready to report

## Reporting rule

Do not mainly report "the task is active."

Mainly report:

1. which checkpoint the cursor is on,
2. which checkpoints are complete,
3. which exit conditions are still unmet.

## Important limitation

These tools persist state and generate a continuation prompt, but they cannot directly push a new chat message into Codex or Claude Code by themselves.

So the pattern is:

1. persist the plan and progress,
2. keep executing while the current host run is alive,
3. on the next wake-up, call `resume_durable_task` and keep going from the checkpoint cursor.

## Good prompts

- "Use the durable task loop for this multi-file bug fix."
- "Plan this migration, checkpoint each chunk, and keep resuming until the acceptance criteria are met."
- "Take over this messy refactor and do not stop until the verification step is really done."
