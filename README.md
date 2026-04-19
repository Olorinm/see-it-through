# See It Through

Checkpoint-driven durable task loops for Codex and Claude Code.

This repo exists for one thing: make the agent actually keep going until the task plan is done.

## What it does

- persists a durable task packet with `plan.json`, `plan.md`, `plan-source.md`, `checkpoints.jsonl`, and `continue-prompt.txt`
- tracks progress with checkpoint ids, a cursor, and lifecycle states
- adds Codex-managed task scaffolding for thread heartbeats
- adds Claude-managed task scaffolding for plugin hooks
- ships installable skills for Codex and Claude Code
- exposes the whole thing as an MCP server and CLI

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

## Install

```bash
npm install
```

## CLI

```bash
node ./src/cli.js tools
node ./src/cli.js skills
node ./src/cli.js start-durable-task --goal "Ship this refactor"
node ./src/cli.js start-codex-managed-task --goal "Finish the migration"
node ./src/cli.js start-claude-managed-task --goal "Finish the migration" --project-dir .
```

## Codex

This repo includes:

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`

For Codex autopilot, use `codex-autopilot`. It mirrors a detailed plan into checkpoints, writes heartbeat scaffolding, and keeps the same thread moving until every checkpoint is done.

## Claude Code

This repo also includes:

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `adapters/claude-code/.mcp.json`
- `hooks/hooks.json`

For Claude autopilot, use `claude-autopilot`. It writes a managed task packet, keeps a project-level active task pointer, and uses Claude Code hooks to block premature stopping while the task is still running.

## Lifecycle model

Durable tasks use:

- checkpoint ids
- a single active cursor
- lifecycle values: `running`, `blocked`, `paused`, `cancelled`, `done`

The point is to know exactly which checkpoint the agent is on, not just vague status text.
