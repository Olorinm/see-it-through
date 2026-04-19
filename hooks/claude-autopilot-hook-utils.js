import {
  evaluateClaudeStopHook,
  readClaudeHookContext,
  readClaudeSessionStartContext,
} from "../src/index.js";

export async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) {
    return {};
  }
  return JSON.parse(raw);
}

export async function buildUserPromptPayload(input) {
  const context = await readClaudeHookContext({
    cwd: input.cwd,
    prompt: input.prompt,
  });
  if (!context?.context) {
    return null;
  }
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: context.context,
    },
  };
}

export async function buildSessionStartPayload(input) {
  const context = await readClaudeSessionStartContext({
    cwd: input.cwd,
  });
  if (!context?.context) {
    return null;
  }
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: context.context,
    },
  };
}

export async function buildStopPayload(input) {
  const decision = await evaluateClaudeStopHook({
    cwd: input.cwd,
    stopHookActive: input.stop_hook_active,
    lastAssistantMessage: input.last_assistant_message,
  });
  if (!decision || decision.decision === "allow") {
    return decision?.systemMessage
      ? {
          continue: true,
          systemMessage: decision.systemMessage,
        }
      : null;
  }

  return {
    continue: true,
    decision: "block",
    reason: decision.reason,
  };
}

export function printHookPayload(payload) {
  if (!payload) {
    return;
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}
