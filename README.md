# See It Through

[简体中文](./README.zh-CN.md)

Make your coding agent actually finish the job.

See It Through gives Codex and Claude Code a durable task loop. It writes the plan to disk, tracks the current checkpoint, and makes it easy to resume after a stop, timeout, or context loss.

## Install

### Codex

This repo already includes the files Codex needs:

- `.agents/plugins/marketplace.json`
- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`

For a local checkout, use the normal Codex plugin flow:

```bash
npm install
```

Then:

1. open the repo in Codex so Codex can discover `.agents/plugins/marketplace.json`
2. if the marketplace does not appear right away, restart Codex
3. open `/plugins` or the Codex App plugin UI
4. choose the `See It Through` marketplace and enable the plugin

If you want to register the repo as a local marketplace from the CLI, use Codex's built-in marketplace command:

```bash
codex plugin marketplace add Olorinm/see-it-through
```

If you already cloned it locally:

```bash
codex plugin marketplace add /absolute/path/to/see-it-through
```

Then enable `See It Through` from `/plugins` or the Codex App plugin UI.

We intentionally do not ship a custom installer that edits Codex user config or plugin caches directly. The supported path is to use Codex's own local-plugin or marketplace entrypoints.

### Claude Code

Inside Claude Code:

```text
/plugin marketplace add Olorinm/see-it-through
/plugin install see-it-through@see-it-through-marketplace
/reload-plugins
```

If you are installing from a local checkout, replace `Olorinm/see-it-through` with `.`.

## First run

In Codex or Claude Code, say:

```text
Use see-it-through for this task.
Make a detailed plan first.
Keep going until every checkpoint is done.
```

## When it helps

- refactors that take more than one run
- migrations
- bug hunts with a few clear steps
- research -> implementation -> verification work
- any task where the agent keeps stopping halfway through

## What it writes

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
