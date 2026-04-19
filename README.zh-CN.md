# See It Through

给 Codex 和 Claude Code 用的一套 checkpoint 驱动的长任务续跑骨架。

这个仓库的目标很单纯：让 agent 真把任务按计划做完，而不是做到一半就停。

## 它能做什么

- 持久化 `plan.json`、`plan.md`、`plan-source.md`、`checkpoints.jsonl` 和 `continue-prompt.txt`
- 用 checkpoint id、cursor 和 lifecycle 跟踪真实进度
- 给 Codex 提供 heartbeat 版 managed task
- 给 Claude Code 提供 hook 版 managed task
- 自带可安装的 skills
- 同时暴露 CLI 和 MCP server

## 核心工具

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

## 核心 skills

- `see-it-through`
- `durable-task-loop`
- `codex-heartbeat-managed-task`
- `codex-autopilot`
- `claude-autopilot`

## 安装

```bash
npm install
```

## Codex

仓库已经带了：

- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`

如果你想要 Codex 一直跑到 checkpoint 全完成，用 `codex-autopilot`。

## Claude Code

仓库也带了：

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `adapters/claude-code/.mcp.json`
- `hooks/hooks.json`

如果你想要 Claude Code 一直跑到 checkpoint 全完成，用 `claude-autopilot`。它会靠项目级任务指针和 hooks 来阻止过早停止。

## Lifecycle 模型

durable task 里真正作为状态核心的是：

- checkpoint id
- 当前 cursor
- lifecycle：`running`、`blocked`、`paused`、`cancelled`、`done`

重点不是“现在大概活跃”，而是“现在具体做到哪个 checkpoint 了”。
