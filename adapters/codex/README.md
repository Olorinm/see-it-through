# Codex

This repo already has the files Codex needs:

- `.agents/plugins/marketplace.json`
- `.codex-plugin/plugin.json`
- `.mcp.json`
- `skills/`

## How to use it

1. clone or download the repo
2. run `npm install`
3. open the repo in Codex so it can discover `.agents/plugins/marketplace.json`
4. if the marketplace does not appear right away, restart Codex
5. open `/plugins` or the Codex App plugin UI
6. choose the `See It Through` marketplace and enable the plugin

If you prefer the CLI marketplace path, you can also register the repo explicitly:

```bash
codex plugin marketplace add /absolute/path/to/see-it-through
```

After that, Codex can use the bundled skills and call the MCP tools from this repo.

## Quick check

```bash
node ./src/cli.js tools
node ./src/cli.js skills
```
