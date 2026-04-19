# See It Through

Make your coding agent actually finish the job.

See It Through is a task loop for Codex and Claude Code. It writes the plan to disk, keeps track of the current checkpoint, and gives the agent a clean way to resume after a stop, timeout, or context loss.

## When it helps

- refactors that take more than one run
- migrations
- bug hunts with a few clear steps
- research -> implementation -> verification work
- any task where the agent keeps stopping halfway through

## Quick start

### Codex

This repo includes:

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`

Use `see-it-through` or `codex-autopilot`, then ask for the task in plain language:

```text
Use autopilot for this task.
Make a detailed plan first.
Keep going until every checkpoint is done.
```

### Claude Code

This repo also includes:

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `adapters/claude-code/.mcp.json`
- `hooks/hooks.json`

Use `see-it-through` or `claude-autopilot`, then ask for the task the same way.

## What it saves

- `plan.md` for a readable plan
- `plan.json` for the live task state
- `plan-source.md` for the full mirrored plan text
- `checkpoints.jsonl` for the checkpoint history
- `continue-prompt.txt` for the next resume prompt

In Codex mode it also writes heartbeat files. In Claude mode it also writes hook context files and a project-level task pointer.

## Main tools

- `start_durable_task`
- `checkpoint_durable_task`
- `resume_durable_task`
- `start_codex_managed_task`
- `checkpoint_codex_managed_task`
- `resume_codex_managed_task`
- `bind_codex_heartbeat`
- `start_claude_managed_task`
- `checkpoint_claude_managed_task`
- `resume_claude_managed_task`

## Main skills

- `see-it-through`
- `durable-task-loop`
- `codex-heartbeat-managed-task`
- `codex-autopilot`
- `claude-autopilot`

## CLI

```bash
node ./src/cli.js tools
node ./src/cli.js skills
node ./src/cli.js start-durable-task --goal "Ship this refactor"
node ./src/cli.js start-codex-managed-task --goal "Finish the migration"
node ./src/cli.js start-claude-managed-task --goal "Finish the migration" --project-dir .
```

## How it keeps going

- The durable task packet holds the plan and current checkpoint.
- Codex mode adds heartbeat scaffolding so the same thread can wake up and continue.
- Claude mode adds hook scaffolding so the run does not stop early while the task is still active.
- The task state stays explicit: `running`, `blocked`, `paused`, `cancelled`, or `done`.

The main thing you get is simple: you can see which checkpoint the agent is on, what is already done, and what it should do next.
