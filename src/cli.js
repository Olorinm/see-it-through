#!/usr/bin/env node

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindCodexHeartbeat,
  checkpointClaudeManagedTask,
  checkpointCodexManagedTask,
  checkpointDurableTask,
  getToolCatalog,
  loadSkills,
  resumeClaudeManagedTask,
  resumeCodexManagedTask,
  resumeDurableTask,
  startClaudeManagedTask,
  startCodexManagedTask,
  startDurableTask,
} from "./index.js";
import { readText } from "./lib/common.js";
import { startMcpServer } from "./mcp/server.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SKILLS_ROOT = resolve(PROJECT_ROOT, "skills");

async function main(argv) {
  const args = argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h" || command === "help") {
    printHelp();
    return;
  }

  switch (command) {
    case "tools":
      await runTools(args.slice(1));
      return;
    case "skills":
      await runSkills(args.slice(1));
      return;
    case "start-durable-task":
      await runStartDurableTask(args.slice(1));
      return;
    case "checkpoint-durable-task":
      await runCheckpointDurableTask(args.slice(1));
      return;
    case "resume-durable-task":
      await runResumeDurableTask(args.slice(1));
      return;
    case "start-codex-managed-task":
      await runStartCodexManagedTask(args.slice(1));
      return;
    case "checkpoint-codex-managed-task":
      await runCheckpointCodexManagedTask(args.slice(1));
      return;
    case "resume-codex-managed-task":
      await runResumeCodexManagedTask(args.slice(1));
      return;
    case "bind-codex-heartbeat":
      await runBindCodexHeartbeat(args.slice(1));
      return;
    case "start-claude-managed-task":
      await runStartClaudeManagedTask(args.slice(1));
      return;
    case "checkpoint-claude-managed-task":
      await runCheckpointClaudeManagedTask(args.slice(1));
      return;
    case "resume-claude-managed-task":
      await runResumeClaudeManagedTask(args.slice(1));
      return;
    case "serve-mcp":
      await startMcpServer();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function runTools(args) {
  const asJson = args.includes("--json");
  const catalog = getToolCatalog();
  if (asJson) {
    console.log(JSON.stringify(catalog, null, 2));
    return;
  }

  for (const tool of catalog) {
    console.log(`- ${tool.name}: ${tool.description}`);
  }
}

async function runSkills(args) {
  const asJson = args.includes("--json");
  const root = resolveOptionalValue(args, "--root") ?? DEFAULT_SKILLS_ROOT;
  const skills = await loadSkills(root);
  if (asJson) {
    console.log(JSON.stringify(skills, null, 2));
    return;
  }

  for (const skill of skills) {
    console.log(`- ${skill.name}: ${skill.description}`);
  }
}

async function runStartDurableTask(args) {
  const goal = resolveOptionalValue(args, "--goal");
  if (!goal) {
    throw new Error("start-durable-task requires --goal <text>");
  }
  const outDir = resolveOptionalValue(args, "--out");
  const planMarkdown = await resolveOptionalTextFile(args, "--plan-file");
  const result = await startDurableTask(
    {
      goal,
      name: resolveOptionalValue(args, "--name"),
      acceptanceCriteria: resolveRepeatedValues(args, "--acceptance"),
      constraints: resolveRepeatedValues(args, "--constraint"),
      contextNotes: resolveRepeatedValues(args, "--note"),
      planMarkdown,
      planOrigin: resolveOptionalValue(args, "--plan-origin"),
      checkpoints: buildCliCheckpointList(args),
      stopRequested: hasFlag(args, "--stop-requested"),
      stopAfterCurrentCheckpoint: hasFlag(args, "--stop-after-checkpoint"),
      stopReason: resolveOptionalValue(args, "--stop-reason"),
    },
    outDir ? resolve(outDir) : undefined,
  );
  printDurableTaskResult("Started durable task", result);
}

async function runCheckpointDurableTask(args) {
  const target = args[0];
  if (!target) {
    throw new Error("checkpoint-durable-task requires <task-dir|plan.json>");
  }
  const summary = resolveOptionalValue(args, "--summary");
  if (!summary) {
    throw new Error("checkpoint-durable-task requires --summary <text>");
  }
  const planMarkdown = await resolveOptionalTextFile(args, "--plan-file");
  const result = await checkpointDurableTask({
    ...resolveTaskLocator(target),
    summary,
    currentCheckpointId:
      resolveOptionalValue(args, "--current-checkpoint") || resolveOptionalValue(args, "--current-step"),
    completedCheckpointIds: [
      ...resolveRepeatedValues(args, "--complete-checkpoint"),
      ...resolveRepeatedValues(args, "--complete-step"),
    ],
    reopenCheckpointIds: [
      ...resolveRepeatedValues(args, "--reopen-checkpoint"),
      ...resolveRepeatedValues(args, "--reopen-step"),
    ],
    blockedCheckpointId:
      resolveOptionalValue(args, "--block-checkpoint") || resolveOptionalValue(args, "--block-step"),
    blockedReason: resolveOptionalValue(args, "--blocker"),
    artifacts: resolveRepeatedValues(args, "--artifact"),
    planMarkdown,
    planOrigin: resolveOptionalValue(args, "--plan-origin"),
    newCheckpoints: buildCliCheckpointInsertList(args),
    insertAfterCheckpointId:
      resolveOptionalValue(args, "--insert-after-checkpoint") || resolveOptionalValue(args, "--insert-after"),
    lifecycle: resolveOptionalValue(args, "--lifecycle"),
    status: resolveOptionalValue(args, "--status"),
    done: hasFlag(args, "--done"),
    pause: hasFlag(args, "--pause"),
    cancel: hasFlag(args, "--cancel"),
    stopRequested: hasFlag(args, "--stop-requested") ? true : undefined,
    stopAfterCurrentCheckpoint: hasFlag(args, "--stop-after-checkpoint"),
    stopReason: resolveOptionalValue(args, "--stop-reason"),
    clearStopRequested: hasFlag(args, "--clear-stop-requested"),
    clearBlockedReason: hasFlag(args, "--clear-blocker"),
    completionSummary: resolveOptionalValue(args, "--completion-summary"),
    cancellationSummary: resolveOptionalValue(args, "--cancellation-summary"),
  });
  printDurableTaskResult("Updated durable task", result);
}

async function runResumeDurableTask(args) {
  const target = args[0];
  if (!target) {
    throw new Error("resume-durable-task requires <task-dir|plan.json>");
  }
  const result = await resumeDurableTask({
    ...resolveTaskLocator(target),
    currentCheckpointId:
      resolveOptionalValue(args, "--current-checkpoint") || resolveOptionalValue(args, "--current-step"),
  });
  printDurableTaskResult("Resumed durable task", result);
}

async function runStartCodexManagedTask(args) {
  const goal = resolveOptionalValue(args, "--goal");
  if (!goal) {
    throw new Error("start-codex-managed-task requires --goal <text>");
  }
  const outDir = resolveOptionalValue(args, "--out");
  const planMarkdown = await resolveOptionalTextFile(args, "--plan-file");
  const result = await startCodexManagedTask(
    {
      goal,
      name: resolveOptionalValue(args, "--name"),
      acceptanceCriteria: resolveRepeatedValues(args, "--acceptance"),
      constraints: resolveRepeatedValues(args, "--constraint"),
      contextNotes: resolveRepeatedValues(args, "--note"),
      planMarkdown,
      planOrigin: resolveOptionalValue(args, "--plan-origin"),
      checkpoints: buildCliCheckpointList(args),
      heartbeatMinutes: resolveOptionalValue(args, "--heartbeat-minutes"),
      heartbeatName: resolveOptionalValue(args, "--heartbeat-name"),
      stopRequested: hasFlag(args, "--stop-requested"),
      stopAfterCurrentCheckpoint: hasFlag(args, "--stop-after-checkpoint"),
      stopReason: resolveOptionalValue(args, "--stop-reason"),
    },
    outDir ? resolve(outDir) : undefined,
  );
  printCodexManagedTaskResult("Started Codex managed task", result);
}

async function runCheckpointCodexManagedTask(args) {
  const target = args[0];
  if (!target) {
    throw new Error("checkpoint-codex-managed-task requires <task-dir|plan.json>");
  }
  const summary = resolveOptionalValue(args, "--summary");
  if (!summary) {
    throw new Error("checkpoint-codex-managed-task requires --summary <text>");
  }
  const planMarkdown = await resolveOptionalTextFile(args, "--plan-file");
  const result = await checkpointCodexManagedTask({
    ...resolveTaskLocator(target),
    summary,
    currentCheckpointId:
      resolveOptionalValue(args, "--current-checkpoint") || resolveOptionalValue(args, "--current-step"),
    completedCheckpointIds: [
      ...resolveRepeatedValues(args, "--complete-checkpoint"),
      ...resolveRepeatedValues(args, "--complete-step"),
    ],
    reopenCheckpointIds: [
      ...resolveRepeatedValues(args, "--reopen-checkpoint"),
      ...resolveRepeatedValues(args, "--reopen-step"),
    ],
    blockedCheckpointId:
      resolveOptionalValue(args, "--block-checkpoint") || resolveOptionalValue(args, "--block-step"),
    blockedReason: resolveOptionalValue(args, "--blocker"),
    artifacts: resolveRepeatedValues(args, "--artifact"),
    planMarkdown,
    planOrigin: resolveOptionalValue(args, "--plan-origin"),
    newCheckpoints: buildCliCheckpointInsertList(args),
    insertAfterCheckpointId:
      resolveOptionalValue(args, "--insert-after-checkpoint") || resolveOptionalValue(args, "--insert-after"),
    lifecycle: resolveOptionalValue(args, "--lifecycle"),
    status: resolveOptionalValue(args, "--status"),
    done: hasFlag(args, "--done"),
    pause: hasFlag(args, "--pause"),
    cancel: hasFlag(args, "--cancel"),
    stopRequested: hasFlag(args, "--stop-requested") ? true : undefined,
    stopAfterCurrentCheckpoint: hasFlag(args, "--stop-after-checkpoint"),
    stopReason: resolveOptionalValue(args, "--stop-reason"),
    clearStopRequested: hasFlag(args, "--clear-stop-requested"),
    clearBlockedReason: hasFlag(args, "--clear-blocker"),
    completionSummary: resolveOptionalValue(args, "--completion-summary"),
    cancellationSummary: resolveOptionalValue(args, "--cancellation-summary"),
    heartbeatMinutes: resolveOptionalValue(args, "--heartbeat-minutes"),
    heartbeatName: resolveOptionalValue(args, "--heartbeat-name"),
    automationId: resolveOptionalValue(args, "--automation-id"),
  });
  printCodexManagedTaskResult("Updated Codex managed task", result);
}

async function runResumeCodexManagedTask(args) {
  const target = args[0];
  if (!target) {
    throw new Error("resume-codex-managed-task requires <task-dir|plan.json>");
  }
  const result = await resumeCodexManagedTask({
    ...resolveTaskLocator(target),
    currentCheckpointId:
      resolveOptionalValue(args, "--current-checkpoint") || resolveOptionalValue(args, "--current-step"),
    heartbeatMinutes: resolveOptionalValue(args, "--heartbeat-minutes"),
    heartbeatName: resolveOptionalValue(args, "--heartbeat-name"),
    automationId: resolveOptionalValue(args, "--automation-id"),
  });
  printCodexManagedTaskResult("Resumed Codex managed task", result);
}

async function runBindCodexHeartbeat(args) {
  const target = args[0];
  if (!target) {
    throw new Error("bind-codex-heartbeat requires <task-dir|plan.json>");
  }
  const automationId = resolveOptionalValue(args, "--automation-id");
  if (!automationId) {
    throw new Error("bind-codex-heartbeat requires --automation-id <id>");
  }
  const result = await bindCodexHeartbeat({
    ...resolveTaskLocator(target),
    automationId,
    heartbeatMinutes: resolveOptionalValue(args, "--heartbeat-minutes"),
    heartbeatName: resolveOptionalValue(args, "--heartbeat-name"),
  });
  printCodexManagedTaskResult("Bound Codex heartbeat", result);
}

async function runStartClaudeManagedTask(args) {
  const goal = resolveOptionalValue(args, "--goal");
  if (!goal) {
    throw new Error("start-claude-managed-task requires --goal <text>");
  }
  const outDir = resolveOptionalValue(args, "--out");
  const planMarkdown = await resolveOptionalTextFile(args, "--plan-file");
  const result = await startClaudeManagedTask(
    {
      goal,
      name: resolveOptionalValue(args, "--name"),
      projectDir: resolveOptionalValue(args, "--project-dir"),
      acceptanceCriteria: resolveRepeatedValues(args, "--acceptance"),
      constraints: resolveRepeatedValues(args, "--constraint"),
      contextNotes: resolveRepeatedValues(args, "--note"),
      planMarkdown,
      planOrigin: resolveOptionalValue(args, "--plan-origin"),
      checkpoints: buildCliCheckpointList(args),
      maxConsecutiveStopBlocks: resolveOptionalValue(args, "--max-stop-blocks"),
      stopRequested: hasFlag(args, "--stop-requested"),
      stopAfterCurrentCheckpoint: hasFlag(args, "--stop-after-checkpoint"),
      stopReason: resolveOptionalValue(args, "--stop-reason"),
    },
    outDir ? resolve(outDir) : undefined,
  );
  printClaudeManagedTaskResult("Started Claude managed task", result);
}

async function runCheckpointClaudeManagedTask(args) {
  const target = args[0];
  if (!target) {
    throw new Error("checkpoint-claude-managed-task requires <task-dir|plan.json>");
  }
  const summary = resolveOptionalValue(args, "--summary");
  if (!summary) {
    throw new Error("checkpoint-claude-managed-task requires --summary <text>");
  }
  const planMarkdown = await resolveOptionalTextFile(args, "--plan-file");
  const result = await checkpointClaudeManagedTask({
    ...resolveTaskLocator(target),
    projectDir: resolveOptionalValue(args, "--project-dir"),
    summary,
    currentCheckpointId:
      resolveOptionalValue(args, "--current-checkpoint") || resolveOptionalValue(args, "--current-step"),
    completedCheckpointIds: [
      ...resolveRepeatedValues(args, "--complete-checkpoint"),
      ...resolveRepeatedValues(args, "--complete-step"),
    ],
    reopenCheckpointIds: [
      ...resolveRepeatedValues(args, "--reopen-checkpoint"),
      ...resolveRepeatedValues(args, "--reopen-step"),
    ],
    blockedCheckpointId:
      resolveOptionalValue(args, "--block-checkpoint") || resolveOptionalValue(args, "--block-step"),
    blockedReason: resolveOptionalValue(args, "--blocker"),
    artifacts: resolveRepeatedValues(args, "--artifact"),
    planMarkdown,
    planOrigin: resolveOptionalValue(args, "--plan-origin"),
    newCheckpoints: buildCliCheckpointInsertList(args),
    insertAfterCheckpointId:
      resolveOptionalValue(args, "--insert-after-checkpoint") || resolveOptionalValue(args, "--insert-after"),
    lifecycle: resolveOptionalValue(args, "--lifecycle"),
    status: resolveOptionalValue(args, "--status"),
    done: hasFlag(args, "--done"),
    pause: hasFlag(args, "--pause"),
    cancel: hasFlag(args, "--cancel"),
    maxConsecutiveStopBlocks: resolveOptionalValue(args, "--max-stop-blocks"),
    stopRequested: hasFlag(args, "--stop-requested") ? true : undefined,
    stopAfterCurrentCheckpoint: hasFlag(args, "--stop-after-checkpoint"),
    stopReason: resolveOptionalValue(args, "--stop-reason"),
    clearStopRequested: hasFlag(args, "--clear-stop-requested"),
    clearBlockedReason: hasFlag(args, "--clear-blocker"),
    completionSummary: resolveOptionalValue(args, "--completion-summary"),
    cancellationSummary: resolveOptionalValue(args, "--cancellation-summary"),
  });
  printClaudeManagedTaskResult("Updated Claude managed task", result);
}

async function runResumeClaudeManagedTask(args) {
  const target = args[0];
  if (!target) {
    throw new Error("resume-claude-managed-task requires <task-dir|plan.json>");
  }
  const result = await resumeClaudeManagedTask({
    ...resolveTaskLocator(target),
    projectDir: resolveOptionalValue(args, "--project-dir"),
    currentCheckpointId:
      resolveOptionalValue(args, "--current-checkpoint") || resolveOptionalValue(args, "--current-step"),
    maxConsecutiveStopBlocks: resolveOptionalValue(args, "--max-stop-blocks"),
  });
  printClaudeManagedTaskResult("Resumed Claude managed task", result);
}

function resolveOptionalValue(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function resolveRepeatedValues(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

async function resolveOptionalTextFile(args, flag) {
  const value = resolveOptionalValue(args, flag);
  if (!value) {
    return undefined;
  }
  return readText(resolve(value));
}

function buildCliCheckpointList(args) {
  const titles = [...resolveRepeatedValues(args, "--checkpoint"), ...resolveRepeatedValues(args, "--step")];
  return titles.map((title) => ({ title }));
}

function buildCliCheckpointInsertList(args) {
  const titles = [...resolveRepeatedValues(args, "--add-checkpoint"), ...resolveRepeatedValues(args, "--add-step")];
  return titles.map((title) => ({ title }));
}

function resolveTaskLocator(target) {
  const absolute = resolve(target);
  if (absolute.toLowerCase().endsWith(".json")) {
    return { planPath: absolute };
  }
  return { taskDir: absolute };
}

function printDurableTaskResult(prefix, result) {
  console.log(`${prefix}: ${result.taskDir}`);
  console.log(`Plan markdown: ${result.markdownPath}`);
  console.log(`Plan JSON: ${result.planPath}`);
  console.log(`Detailed plan source: ${result.planSourcePath}`);
  console.log(`Checkpoint log: ${result.checkpointLogPath}`);
  console.log(`Continue prompt: ${result.continuePromptPath}`);
  console.log(`Lifecycle: ${result.task.lifecycle}`);
  console.log(`Should continue: ${result.shouldContinue ? "yes" : "no"}`);
  console.log(`Stop requested: ${result.task.stopRequested ? "yes" : "no"}`);
  if (result.currentCheckpoint) {
    console.log(`Current checkpoint: ${result.currentCheckpoint.id} - ${result.currentCheckpoint.title}`);
  }
  if (result.nextCheckpoint) {
    console.log(`Next checkpoint: ${result.nextCheckpoint.id} - ${result.nextCheckpoint.title}`);
  }
}

function printCodexManagedTaskResult(prefix, result) {
  printDurableTaskResult(prefix, result);
  if (!result.codexHeartbeat) {
    return;
  }
  console.log(`Codex heartbeat file: ${result.codexHeartbeat.jsonPath}`);
  console.log(`Codex heartbeat prompt: ${result.codexHeartbeat.promptPath}`);
  console.log(`Heartbeat action: ${result.codexHeartbeat.recommendedAutomationAction}`);
  console.log(`Heartbeat reason: ${result.codexHeartbeat.reason}`);
  if (result.codexHeartbeat.automationId) {
    console.log(`Heartbeat automation id: ${result.codexHeartbeat.automationId}`);
  }
}

function printClaudeManagedTaskResult(prefix, result) {
  printDurableTaskResult(prefix, result);
  if (!result.claudeAutopilot) {
    return;
  }
  console.log(`Claude autopilot file: ${result.claudeAutopilot.jsonPath}`);
  console.log(`User prompt context: ${result.claudeAutopilot.userPromptContextPath}`);
  console.log(`Session context: ${result.claudeAutopilot.sessionContextPath}`);
  console.log(`Stop hook reason: ${result.claudeAutopilot.stopReasonPath}`);
  console.log(`Recommended stop decision: ${result.claudeAutopilot.recommendedStopDecision}`);
  console.log(`Active task pointer: ${result.claudeAutopilot.activeTaskPath}`);
  console.log(`Last task pointer: ${result.claudeAutopilot.lastTaskPath}`);
}

function printHelp() {
  console.log(`see-it-through

Usage:
  see-it-through tools [--json]
  see-it-through skills [--json] [--root <skills-dir>]
  see-it-through start-durable-task --goal <text> [--name <name>] [--checkpoint <title>]... [--plan-file <markdown>] [--plan-origin <label>] [--acceptance <text>]... [--constraint <text>]... [--note <text>]... [--stop-after-checkpoint] [--stop-reason <text>] [--out <task-dir>]
  see-it-through checkpoint-durable-task <task-dir|plan.json> --summary <text> [--current-checkpoint <id>] [--complete-checkpoint <id>]... [--reopen-checkpoint <id>]... [--block-checkpoint <id>] [--blocker <text>] [--artifact <text>]... [--add-checkpoint <title>]... [--insert-after-checkpoint <id>] [--plan-file <markdown>] [--plan-origin <label>] [--lifecycle <running|blocked|paused|cancelled|done>] [--done] [--pause] [--cancel] [--stop-after-checkpoint] [--stop-reason <text>] [--clear-stop-requested] [--clear-blocker] [--completion-summary <text>] [--cancellation-summary <text>]
  see-it-through resume-durable-task <task-dir|plan.json> [--current-checkpoint <id>]
  see-it-through start-codex-managed-task --goal <text> [--name <name>] [--checkpoint <title>]... [--plan-file <markdown>] [--plan-origin <label>] [--acceptance <text>]... [--constraint <text>]... [--note <text>]... [--heartbeat-minutes <minutes>] [--heartbeat-name <name>] [--stop-after-checkpoint] [--stop-reason <text>] [--out <task-dir>]
  see-it-through checkpoint-codex-managed-task <task-dir|plan.json> --summary <text> [--current-checkpoint <id>] [--complete-checkpoint <id>]... [--reopen-checkpoint <id>]... [--block-checkpoint <id>] [--blocker <text>] [--artifact <text>]... [--add-checkpoint <title>]... [--insert-after-checkpoint <id>] [--plan-file <markdown>] [--plan-origin <label>] [--lifecycle <running|blocked|paused|cancelled|done>] [--done] [--pause] [--cancel] [--stop-after-checkpoint] [--stop-reason <text>] [--clear-stop-requested] [--clear-blocker] [--completion-summary <text>] [--cancellation-summary <text>] [--heartbeat-minutes <minutes>] [--heartbeat-name <name>] [--automation-id <id>]
  see-it-through resume-codex-managed-task <task-dir|plan.json> [--current-checkpoint <id>] [--heartbeat-minutes <minutes>] [--heartbeat-name <name>] [--automation-id <id>]
  see-it-through bind-codex-heartbeat <task-dir|plan.json> --automation-id <id> [--heartbeat-minutes <minutes>] [--heartbeat-name <name>]
  see-it-through start-claude-managed-task --goal <text> [--name <name>] [--project-dir <dir>] [--checkpoint <title>]... [--plan-file <markdown>] [--plan-origin <label>] [--acceptance <text>]... [--constraint <text>]... [--note <text>]... [--max-stop-blocks <count>] [--stop-after-checkpoint] [--stop-reason <text>] [--out <task-dir>]
  see-it-through checkpoint-claude-managed-task <task-dir|plan.json> --summary <text> [--project-dir <dir>] [--current-checkpoint <id>] [--complete-checkpoint <id>]... [--reopen-checkpoint <id>]... [--block-checkpoint <id>] [--blocker <text>] [--artifact <text>]... [--add-checkpoint <title>]... [--insert-after-checkpoint <id>] [--plan-file <markdown>] [--plan-origin <label>] [--lifecycle <running|blocked|paused|cancelled|done>] [--done] [--pause] [--cancel] [--max-stop-blocks <count>] [--stop-after-checkpoint] [--stop-reason <text>] [--clear-stop-requested] [--clear-blocker] [--completion-summary <text>] [--cancellation-summary <text>]
  see-it-through resume-claude-managed-task <task-dir|plan.json> [--project-dir <dir>] [--current-checkpoint <id>] [--max-stop-blocks <count>]
  see-it-through serve-mcp
`);
}

main(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
