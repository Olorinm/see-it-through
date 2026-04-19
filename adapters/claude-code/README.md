# Claude Code

This repo already includes the files Claude Code needs:

- `.claude-plugin/plugin.json`
- `.claude-plugin/marketplace.json`
- `adapters/claude-code/.mcp.json`
- `hooks/hooks.json`

## How to use it

Validate the plugin locally:

```bash
claude plugin validate .
```

Add the repo as a marketplace and install the plugin:

```bash
claude plugin marketplace add .
claude plugin install see-it-through@see-it-through-marketplace
```

If the repo is on GitHub, replace `.` with `owner/repo`.

## Claude autopilot

Use these together:

- `start_claude_managed_task`
- `checkpoint_claude_managed_task`
- `resume_claude_managed_task`
- `skills/claude-autopilot/SKILL.md`

The Claude version does not depend on a timer. It keeps going by:

1. persisting the checkpoint cursor in a durable task packet
2. keeping an active task pointer under `.claude/see-it-through/`
3. using `UserPromptSubmit` and `SessionStart` to restore context
4. using `Stop` to block premature completion while lifecycle is still `running`
