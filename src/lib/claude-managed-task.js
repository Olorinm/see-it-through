import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  checkpointDurableTask,
  resumeDurableTask,
  startDurableTask,
} from "./durable-task.js";
import {
  coerceObject,
  ensureDir,
  pathExists,
  readJson,
  slugify,
  writeJson,
  writeText,
} from "./common.js";

const CLAUDE_AUTOPILOT_JSON_NAME = "claude-autopilot.json";
const CLAUDE_USER_PROMPT_CONTEXT_NAME = "claude-user-prompt-context.txt";
const CLAUDE_SESSION_CONTEXT_NAME = "claude-session-context.txt";
const CLAUDE_STOP_REASON_NAME = "claude-stop-reason.txt";
const CLAUDE_STOP_STATE_NAME = "claude-stop-state.json";
const CLAUDE_STATE_DIR_SEGMENTS = [".claude", "see-it-through"];
const CLAUDE_TASKS_DIR_NAME = "managed-tasks";
const ACTIVE_TASK_POINTER_NAME = "active-managed-task.json";
const LAST_TASK_POINTER_NAME = "last-managed-task.json";
const DEFAULT_MAX_CONSECUTIVE_STOP_BLOCKS = 12;

export async function startClaudeManagedTask(input, outputDir) {
  const payload = coerceObject(input);
  const durable = await startDurableTask(payload, resolveClaudeTaskRoot(payload, outputDir));
  return attachClaudeAutopilot(durable, payload);
}

export async function checkpointClaudeManagedTask(input) {
  const durable = await checkpointDurableTask(input);
  return attachClaudeAutopilot(durable, input);
}

export async function resumeClaudeManagedTask(input) {
  const durable = await resumeManagedDurableTask(input);
  return attachClaudeAutopilot(durable, input);
}

export async function readClaudeHookContext(input = {}) {
  const payload = coerceObject(input);
  const projectDir = resolveClaudeProjectDir(payload);
  const prompt = String(payload.prompt || "").trim();
  let pointer = await readTaskPointer(projectDir, ACTIVE_TASK_POINTER_NAME);
  let source = "active";

  if (!pointer && prompt && looksLikeResumeIntent(prompt)) {
    pointer = await readTaskPointer(projectDir, LAST_TASK_POINTER_NAME);
    source = "last";
  }

  if (!pointer) {
    return null;
  }

  const autopilot = await readAutopilotState(pointer.autopilotPath || pointer.jsonPath);
  if (!autopilot) {
    return null;
  }

  const lifecycle = String(autopilot.lifecycle || pointer.lifecycle || "").trim() || "running";
  if (source === "active" && !["running", "blocked"].includes(lifecycle)) {
    return null;
  }
  if (source === "last" && ["done", "cancelled"].includes(lifecycle)) {
    return null;
  }

  return {
    source,
    projectDir,
    lifecycle,
    taskDir: autopilot.taskDir,
    autopilot,
    context:
      source === "active"
        ? autopilot.userPromptContext
        : buildResumeIntentContext(autopilot),
  };
}

export async function readClaudeSessionStartContext(input = {}) {
  const payload = coerceObject(input);
  const projectDir = resolveClaudeProjectDir(payload);
  const pointer = await readTaskPointer(projectDir, ACTIVE_TASK_POINTER_NAME);
  if (!pointer) {
    return null;
  }

  const autopilot = await readAutopilotState(pointer.autopilotPath || pointer.jsonPath);
  if (!autopilot) {
    return null;
  }

  const lifecycle = String(autopilot.lifecycle || pointer.lifecycle || "").trim() || "running";
  if (!["running", "blocked"].includes(lifecycle)) {
    return null;
  }

  return {
    projectDir,
    lifecycle,
    taskDir: autopilot.taskDir,
    autopilot,
    context: autopilot.sessionContext,
  };
}

export async function evaluateClaudeStopHook(input = {}) {
  const payload = coerceObject(input);
  const projectDir = resolveClaudeProjectDir(payload);
  const pointer = await readTaskPointer(projectDir, ACTIVE_TASK_POINTER_NAME);
  if (!pointer) {
    return {
      decision: "allow",
      reason: "",
    };
  }

  const autopilot = await readAutopilotState(pointer.autopilotPath || pointer.jsonPath);
  if (!autopilot) {
    return {
      decision: "allow",
      reason: "",
    };
  }

  const lifecycle = String(autopilot.lifecycle || pointer.lifecycle || "").trim() || "running";
  if (lifecycle !== "running") {
    return {
      decision: "allow",
      reason: "",
      lifecycle,
      taskDir: autopilot.taskDir,
    };
  }

  const stopHookActive = Boolean(payload.stopHookActive);
  const progressToken = String(autopilot.progressToken || "");
  const existingStopState = await readStopState(autopilot.stopStatePath);
  const consecutiveBlocks =
    stopHookActive && existingStopState?.progressToken === progressToken
      ? Number(existingStopState.consecutiveBlocks || 0) + 1
      : 1;
  const exhausted =
    Number(autopilot.maxConsecutiveStopBlocks || 0) > 0 &&
    consecutiveBlocks > Number(autopilot.maxConsecutiveStopBlocks || 0);

  await writeJson(autopilot.stopStatePath, {
    schemaVersion: 1,
    updatedAt: new Date().toISOString(),
    progressToken,
    consecutiveBlocks,
    lastAssistantDigest: hashText(String(payload.lastAssistantMessage || "")),
  });

  if (exhausted) {
    return {
      decision: "allow",
      reason: "",
      lifecycle,
      taskDir: autopilot.taskDir,
      systemMessage: `Managed task ${autopilot.taskName} is still incomplete, but the Stop hook released after ${autopilot.maxConsecutiveStopBlocks} no-progress stop attempts. Resume later with resume_claude_managed_task if needed.`,
    };
  }

  return {
    decision: "block",
    lifecycle,
    taskDir: autopilot.taskDir,
    reason: buildDynamicStopReason(autopilot, {
      stopHookActive,
      consecutiveBlocks,
    }),
  };
}

async function attachClaudeAutopilot(durable, input) {
  const taskDir = resolve(durable.taskDir);
  const existing = await readAutopilotState(join(taskDir, CLAUDE_AUTOPILOT_JSON_NAME));
  const state = buildClaudeAutopilotState(durable, existing, input);
  await persistClaudeAutopilot(state);
  await persistTaskPointers(state);
  return {
    ...durable,
    claudeAutopilot: summarizeClaudeAutopilot(state),
  };
}

async function resumeManagedDurableTask(input) {
  const payload = coerceObject(input);
  const durable = await resumeDurableTask(payload);
  if (durable.task.lifecycle !== "paused") {
    return durable;
  }

  return checkpointDurableTask({
    taskDir: durable.taskDir,
    planPath: durable.planPath,
    summary: "Task resumed.",
    lifecycle: "running",
    clearStopRequested: true,
  });
}

function buildClaudeAutopilotState(durable, existingInput, input) {
  const existing = coerceObject(existingInput);
  const payload = coerceObject(input);
  const taskDir = resolve(durable.taskDir);
  const projectDir = resolveClaudeProjectDir(payload, existing);
  const pointerDir = join(projectDir, ...CLAUDE_STATE_DIR_SEGMENTS);
  const currentCheckpoint = durable.currentCheckpoint;
  const nextCheckpoint = durable.nextCheckpoint;
  const lifecycle = String(durable.task.lifecycle || "running");
  const maxConsecutiveStopBlocks = normalizeMaxStopBlocks(
    payload.maxConsecutiveStopBlocks ?? existing.maxConsecutiveStopBlocks,
  );

  return {
    schemaVersion: 1,
    host: "claude-code",
    generatedAt: new Date().toISOString(),
    taskDir,
    planPath: durable.planPath,
    continuePromptPath: durable.continuePromptPath,
    projectDir,
    taskName: durable.task.name,
    goal: durable.task.goal,
    lifecycle,
    stopRequested: Boolean(durable.task.stopRequested),
    stopReason: String(durable.task.stopReason || ""),
    blockedReason: String(durable.task.blockedReason || ""),
    completionSummary: String(durable.task.completionSummary || ""),
    cancellationSummary: String(durable.task.cancellationSummary || ""),
    currentCheckpointId: currentCheckpoint?.id || "",
    currentCheckpointTitle: currentCheckpoint?.title || "",
    currentCheckpointDetail: currentCheckpoint?.detail || "",
    currentCheckpointDoneWhen: currentCheckpoint?.doneWhen || [],
    currentCheckpointEvidenceWanted: currentCheckpoint?.evidenceWanted || [],
    nextCheckpointId: nextCheckpoint?.id || "",
    nextCheckpointTitle: nextCheckpoint?.title || "",
    maxConsecutiveStopBlocks,
    progressToken: buildProgressToken(durable),
    activeTaskPath: join(pointerDir, ACTIVE_TASK_POINTER_NAME),
    lastTaskPath: join(pointerDir, LAST_TASK_POINTER_NAME),
    jsonPath: join(taskDir, CLAUDE_AUTOPILOT_JSON_NAME),
    userPromptContextPath: join(taskDir, CLAUDE_USER_PROMPT_CONTEXT_NAME),
    sessionContextPath: join(taskDir, CLAUDE_SESSION_CONTEXT_NAME),
    stopReasonPath: join(taskDir, CLAUDE_STOP_REASON_NAME),
    stopStatePath: join(taskDir, CLAUDE_STOP_STATE_NAME),
    lifecycleKeepsActivePointer: lifecycle === "running" || lifecycle === "blocked",
    recommendedStopDecision: lifecycle === "running" ? "block" : "allow",
    resumeInstructions: buildResumeInstructions(durable),
    userPromptContext: buildUserPromptContext(durable),
    sessionContext: buildSessionContext(durable),
    stopHookReason: buildBaseStopReason(durable),
  };
}

async function persistClaudeAutopilot(state) {
  await ensureDir(state.taskDir);
  await writeJson(state.jsonPath, state);
  await writeText(state.userPromptContextPath, state.userPromptContext);
  await writeText(state.sessionContextPath, state.sessionContext);
  await writeText(state.stopReasonPath, state.stopHookReason);
  await removeIfExists(state.stopStatePath);
}

async function persistTaskPointers(state) {
  const pointer = {
    schemaVersion: 1,
    host: "claude-code",
    updatedAt: state.generatedAt,
    projectDir: state.projectDir,
    taskDir: state.taskDir,
    planPath: state.planPath,
    autopilotPath: state.jsonPath,
    lifecycle: state.lifecycle,
    taskName: state.taskName,
    goal: state.goal,
    currentCheckpointId: state.currentCheckpointId,
    currentCheckpointTitle: state.currentCheckpointTitle,
  };

  await writeJson(state.lastTaskPath, pointer);

  if (state.lifecycleKeepsActivePointer) {
    await writeJson(state.activeTaskPath, pointer);
    return;
  }

  await removeIfExists(state.activeTaskPath);
}

function summarizeClaudeAutopilot(state) {
  return {
    projectDir: state.projectDir,
    taskDir: state.taskDir,
    lifecycle: state.lifecycle,
    currentCheckpointId: state.currentCheckpointId,
    currentCheckpointTitle: state.currentCheckpointTitle,
    nextCheckpointId: state.nextCheckpointId,
    nextCheckpointTitle: state.nextCheckpointTitle,
    maxConsecutiveStopBlocks: state.maxConsecutiveStopBlocks,
    recommendedStopDecision: state.recommendedStopDecision,
    jsonPath: state.jsonPath,
    userPromptContextPath: state.userPromptContextPath,
    sessionContextPath: state.sessionContextPath,
    stopReasonPath: state.stopReasonPath,
    activeTaskPath: state.activeTaskPath,
    lastTaskPath: state.lastTaskPath,
    resumeInstructions: state.resumeInstructions,
    userPromptContext: state.userPromptContext,
    sessionContext: state.sessionContext,
    stopHookReason: state.stopHookReason,
  };
}

async function readTaskPointer(projectDir, fileName) {
  const path = join(resolve(projectDir), ...CLAUDE_STATE_DIR_SEGMENTS, fileName);
  if (!(await pathExists(path))) {
    return null;
  }
  return coerceObject(await readJson(path));
}

async function readAutopilotState(path) {
  const absolute = String(path || "").trim();
  if (!absolute) {
    return null;
  }
  if (!(await pathExists(absolute))) {
    return null;
  }
  return coerceObject(await readJson(absolute));
}

async function readStopState(path) {
  const absolute = String(path || "").trim();
  if (!absolute || !(await pathExists(absolute))) {
    return null;
  }
  return coerceObject(await readJson(absolute));
}

function buildResumeInstructions(durable) {
  return `Call resume_claude_managed_task with taskDir ${resolve(durable.taskDir)} before trusting memory.`;
}

function buildUserPromptContext(durable) {
  const currentCheckpoint = durable.currentCheckpoint;
  const nextCheckpoint = durable.nextCheckpoint;
  const lifecycle = String(durable.task.lifecycle || "running");
  return [
    `A Claude-managed task is active for this project.`,
    buildResumeInstructions(durable),
    `Use the persisted checkpoint packet as the source of truth instead of memory.`,
    `Task lifecycle: ${lifecycle}.`,
    currentCheckpoint
      ? `Current checkpoint: ${currentCheckpoint.title} (${currentCheckpoint.id}).`
      : `No current checkpoint is selected.`,
    currentCheckpoint?.detail ? `Current checkpoint detail: ${currentCheckpoint.detail}` : "",
    currentCheckpoint?.doneWhen?.length
      ? `Current checkpoint exit conditions: ${currentCheckpoint.doneWhen.join(" | ")}`
      : "",
    currentCheckpoint?.evidenceWanted?.length
      ? `Evidence to capture: ${currentCheckpoint.evidenceWanted.join(" | ")}`
      : "",
    nextCheckpoint ? `Next checkpoint: ${nextCheckpoint.title} (${nextCheckpoint.id}).` : "",
    lifecycle === "blocked" && durable.task.blockedReason
      ? `Current blocker: ${durable.task.blockedReason}`
      : "",
    `Checkpoint each meaningful chunk with checkpoint_claude_managed_task.`,
    `If the user wants to pause or cancel, checkpoint that lifecycle before stopping.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildSessionContext(durable) {
  const currentCheckpoint = durable.currentCheckpoint;
  const lifecycle = String(durable.task.lifecycle || "running");
  return [
    `A Claude-managed task was already in progress when this session started.`,
    buildResumeInstructions(durable),
    `Lifecycle: ${lifecycle}.`,
    currentCheckpoint
      ? `Current checkpoint: ${currentCheckpoint.title} (${currentCheckpoint.id}).`
      : `No current checkpoint is selected.`,
    durable.task.blockedReason ? `Blocker: ${durable.task.blockedReason}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildResumeIntentContext(autopilot) {
  return [
    `There is a saved Claude-managed task for this project.`,
    `Task directory: ${autopilot.taskDir}`,
    `Last known lifecycle: ${autopilot.lifecycle}.`,
    autopilot.currentCheckpointTitle
      ? `Last checkpoint: ${autopilot.currentCheckpointTitle} (${autopilot.currentCheckpointId}).`
      : "",
    `If the user wants to continue it, call resume_claude_managed_task with taskDir ${autopilot.taskDir}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildBaseStopReason(durable) {
  const currentCheckpoint = durable.currentCheckpoint;
  const nextCheckpoint = durable.nextCheckpoint;
  return [
    `The managed task is not complete yet, so do not stop now.`,
    currentCheckpoint
      ? `Finish or checkpoint the current checkpoint: ${currentCheckpoint.title} (${currentCheckpoint.id}).`
      : `Refresh the task packet with resume_claude_managed_task and continue from the current cursor.`,
    currentCheckpoint?.doneWhen?.length
      ? `Exit conditions: ${currentCheckpoint.doneWhen.join(" | ")}`
      : "",
    currentCheckpoint?.evidenceWanted?.length
      ? `Evidence to record: ${currentCheckpoint.evidenceWanted.join(" | ")}`
      : "",
    nextCheckpoint ? `After that, move to ${nextCheckpoint.title} (${nextCheckpoint.id}).` : "",
    durable.task.stopRequested
      ? `A stop was requested after the current checkpoint, so pause only after that checkpoint is cleanly checkpointed.`
      : `Do the next useful chunk of work, then call checkpoint_claude_managed_task before trying to stop again.`,
    `If you are blocked, checkpoint_claude_managed_task with blockedReason or pause/cancel explicitly instead of silently stopping.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function buildDynamicStopReason(autopilot, options = {}) {
  const stopHookActive = Boolean(options.stopHookActive);
  const consecutiveBlocks = Number(options.consecutiveBlocks || 1);
  return [
    `The managed task "${autopilot.taskName}" is still running.`,
    autopilot.currentCheckpointTitle
      ? `Current checkpoint: ${autopilot.currentCheckpointTitle} (${autopilot.currentCheckpointId}).`
      : `Current checkpoint: refresh it with resume_claude_managed_task.`,
    autopilot.currentCheckpointDetail ? `Detail: ${autopilot.currentCheckpointDetail}` : "",
    autopilot.currentCheckpointDoneWhen?.length
      ? `Exit conditions: ${autopilot.currentCheckpointDoneWhen.join(" | ")}`
      : "",
    autopilot.currentCheckpointEvidenceWanted?.length
      ? `Evidence to record: ${autopilot.currentCheckpointEvidenceWanted.join(" | ")}`
      : "",
    autopilot.nextCheckpointTitle
      ? `Next checkpoint after this one: ${autopilot.nextCheckpointTitle} (${autopilot.nextCheckpointId}).`
      : "",
    autopilot.stopRequested
      ? `A stop was already requested, so finish and checkpoint the current checkpoint, then pause instead of advancing.`
      : `Do the next meaningful chunk now, then call checkpoint_claude_managed_task before you stop.`,
    stopHookActive
      ? `This Stop hook already kept the task alive once, so either make progress and checkpoint it, or explicitly pause, cancel, or mark it blocked.`
      : `If you need fresh state, ${buildResumeInstructionFromAutopilot(autopilot)}`,
    consecutiveBlocks > 1
      ? `You have tried to stop ${consecutiveBlocks} times without a new checkpoint update.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildResumeInstructionFromAutopilot(autopilot) {
  return `call resume_claude_managed_task with taskDir ${autopilot.taskDir}.`;
}

function resolveClaudeTaskRoot(payload, outputDir) {
  if (outputDir) {
    return resolve(outputDir);
  }
  if (payload.taskDir) {
    return resolve(String(payload.taskDir));
  }
  const projectDir = resolveClaudeProjectDir(payload);
  const id = slugify(payload.id || payload.name || payload.goal || "task");
  return resolve(projectDir, ...CLAUDE_STATE_DIR_SEGMENTS, CLAUDE_TASKS_DIR_NAME, id);
}

function resolveClaudeProjectDir(payload, existing = {}) {
  return resolve(String(payload.projectDir || payload.cwd || existing.projectDir || process.cwd()));
}

function normalizeMaxStopBlocks(value) {
  const candidate = Number(value || DEFAULT_MAX_CONSECUTIVE_STOP_BLOCKS);
  if (!Number.isFinite(candidate) || candidate < 0) {
    return DEFAULT_MAX_CONSECUTIVE_STOP_BLOCKS;
  }
  return Math.floor(candidate);
}

function buildProgressToken(durable) {
  return hashText(
    JSON.stringify({
      lifecycle: durable.task.lifecycle,
      updatedAt: durable.task.updatedAt,
      currentCheckpointId: durable.currentCheckpoint?.id || "",
      nextCheckpointId: durable.nextCheckpoint?.id || "",
      latestCheckpointTimestamp: durable.latestCheckpoint?.timestamp || "",
    }),
  );
}

function hashText(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function looksLikeResumeIntent(prompt) {
  return /(?:^|\b)(resume|continue|continue it|pick up|carry on|继续|接着|恢复|继续跑|继续做|接着做)(?:\b|$)/i.test(
    String(prompt || ""),
  );
}

async function removeIfExists(path) {
  if (!path) {
    return;
  }
  if (!(await pathExists(path))) {
    return;
  }
  await rm(path, { force: true });
}
