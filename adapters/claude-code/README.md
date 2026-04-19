# Claude Code

Install from GitHub:

```text
/plugin marketplace add Olorinm/see-it-through
/plugin install see-it-through@see-it-through-marketplace
/reload-plugins
```

Install from a local checkout:

```bash
claude plugin validate .
claude plugin marketplace add .
claude plugin install see-it-through@see-it-through-marketplace
```

Then say:

```text
Use see-it-through for this task.
Make a detailed plan first.
Keep going until every checkpoint is done.
```

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
