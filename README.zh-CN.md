# See It Through

[English](./README.md)

让你的 coding agent 真的把活干完。

这是一套给 Codex 和 Claude Code 用的任务续跑工具。它会把计划写到磁盘上，记录当前做到哪个 checkpoint，并且在 agent 中断以后把任务接起来继续做。

## 安装

### Codex

这个仓库已经带上了 Codex 需要的文件：

- `.agents/plugins/marketplace.json`
- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`

如果你是本地 checkout，直接走 Codex 正常的插件入口：

```bash
npm install
```

然后：

1. 在 Codex 里打开这个仓库，让 Codex 发现 `.agents/plugins/marketplace.json`
2. 如果 marketplace 没马上出现，就重启一次 Codex
3. 打开 `/plugins` 或 Codex App 里的插件界面
4. 选择 `See It Through` marketplace 并启用插件

如果你想用 Codex 自带的 marketplace 命令手动注册本地源，可以这样：

```bash
codex plugin marketplace add Olorinm/see-it-through
```

如果你已经把仓库 clone 到本地了，也可以直接加本地路径：

```bash
codex plugin marketplace add /你的/see-it-through/绝对路径
```

然后在 `/plugins` 或 Codex App 的插件界面里启用 `See It Through`。

我们刻意不再提供那种直接改 Codex 用户配置或插件缓存的自定义安装脚本。这里遵循的就是 Codex 自己的本地插件 / marketplace 入口。

### Claude Code

在 Claude Code 里执行：

```text
/plugin marketplace add Olorinm/see-it-through
/plugin install see-it-through@see-it-through-marketplace
/reload-plugins
```

如果你是从本地仓库安装，把 `Olorinm/see-it-through` 换成 `.` 就行。

## 第一次怎么用

在 Codex 或 Claude Code 里直接这样说：

```text
Use see-it-through for this task.
Make a detailed plan first.
Keep going until every checkpoint is done.
```

## 适合什么任务

- 要跑几轮的重构
- 迁移类任务
- 分几步排查 bug
- 先研究再实现再验证的任务
- agent 老是做到一半就停的任务

## 它会写什么

- `plan.md`，给人看的计划
- `plan.json`，当前任务状态
- `plan-source.md`，完整计划原文
- `checkpoints.jsonl`，checkpoint 历史
- `continue-prompt.txt`，下一次续跑时要用的 prompt

如果你用的是 Codex，它还会多写 heartbeat 相关文件。  
如果你用的是 Claude Code，它还会多写 hook 上下文文件和项目级任务指针。

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

## CLI

```bash
node ./src/cli.js tools
node ./src/cli.js skills
node ./src/cli.js start-durable-task --goal "Ship this refactor"
node ./src/cli.js start-codex-managed-task --goal "Finish the migration"
node ./src/cli.js start-claude-managed-task --goal "Finish the migration" --project-dir .
```

## 它怎么续跑

- durable task packet 负责保存计划和当前 checkpoint
- Codex 模式会加 heartbeat，让同一个线程醒来继续做
- Claude 模式会加 hooks，让任务还在跑的时候别提前结束
- 任务状态一直都是明确的：`running`、`blocked`、`paused`、`cancelled`、`done`

最重要的其实就一件事：你能清楚看到 agent 现在做到哪里了，哪些已经做完，下一步该干什么。
