import { dirname, join, resolve } from "node:path";
import {
  checkpointDurableTask,
  resumeDurableTask,
  startDurableTask,
} from "./durable-task.js";
import {
  coerceObject,
  pathExists,
  readJson,
  writeJson,
  writeText,
} from "./common.js";

const CODEX_HEARTBEAT_JSON_NAME = "codex-heartbeat.json";
const CODEX_HEARTBEAT_PROMPT_NAME = "codex-heartbeat-prompt.txt";
const DEFAULT_ACTIVE_HEARTBEAT_MINUTES = 1;

export async function startCodexManagedTask(input, outputDir) {
  const durable = await startDurableTask(input, outputDir);
  return attachCodexHeartbeat(durable, input);
}

export async function checkpointCodexManagedTask(input) {
  const durable = await checkpointDurableTask(input);
  return attachCodexHeartbeat(durable, input);
}

export async function resumeCodexManagedTask(input) {
  const durable = await resumeManagedDurableTask(input);
  return attachCodexHeartbeat(durable, input);
}

export async function bindCodexHeartbeat(input) {
  const payload = coerceObject(input);
  const durable = await resumeDurableTask(payload);
  return attachCodexHeartbeat(durable, payload, {
    requireAutomationId: true,
  });
}

async function attachCodexHeartbeat(durable, input, options = {}) {
  const payload = coerceObject(input);
  const taskDir = resolve(durable.taskDir);
  const existing = await readExistingHeartbeat(taskDir);
  const heartbeat = buildCodexHeartbeatState(durable, existing, payload, options);
  await persistCodexHeartbeat(taskDir, heartbeat);
  return {
    ...durable,
    codexHeartbeat: summarizeCodexHeartbeat(heartbeat),
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

async function readExistingHeartbeat(taskDir) {
  const path = join(taskDir, CODEX_HEARTBEAT_JSON_NAME);
  if (!(await pathExists(path))) {
    return {};
  }
  return coerceObject(await readJson(path));
}

function buildCodexHeartbeatState(durable, existingInput, input, options = {}) {
  const existing = coerceObject(existingInput);
  const payload = coerceObject(input);
  const taskDir = resolve(durable.taskDir);
  const automationId = String(payload.automationId || existing.automationId || "").trim();
  if (options.requireAutomationId && !automationId) {
    throw new Error("bindCodexHeartbeat requires automationId.");
  }

  const lifecycle = String(durable.task.lifecycle || "running");
  const cadenceMinutes = normalizeHeartbeatMinutes(
    payload.heartbeatMinutes ?? existing.cadenceMinutes,
    lifecycle,
  );
  const rrule = String(existing.rrule || buildHeartbeatRRule(cadenceMinutes));
  const name =
    String(payload.heartbeatName || existing.name || `Managed Task: ${durable.task.name}`).trim() ||
    `Managed Task: ${durable.task.name}`;
  const automationStatus = lifecycle === "running" ? "ACTIVE" : "PAUSED";
  const recommendedAutomationAction = inferRecommendedAutomationAction(lifecycle, automationId);
  const promptPath = join(taskDir, CODEX_HEARTBEAT_PROMPT_NAME);
  const jsonPath = join(taskDir, CODEX_HEARTBEAT_JSON_NAME);
  const prompt = buildCodexHeartbeatPrompt(durable, {
    automationId,
    taskDir,
  });
  const reason = buildAutomationReason(durable, automationId);

  const createRequest =
    recommendedAutomationAction === "create"
      ? {
          mode: "create",
          kind: "heartbeat",
          destination: "thread",
          name,
          prompt,
          rrule,
          status: "ACTIVE",
        }
      : null;

  const updateRequest =
    recommendedAutomationAction === "update" || recommendedAutomationAction === "pause"
      ? {
          mode: "update",
          id: automationId,
          kind: "heartbeat",
          destination: "thread",
          name,
          prompt,
          rrule,
          status: automationStatus,
        }
      : null;

  const deleteRequest =
    recommendedAutomationAction === "delete"
      ? {
          mode: "delete",
          id: automationId,
        }
      : null;

  return {
    schemaVersion: 2,
    host: "codex",
    taskDir,
    planPath: durable.planPath,
    continuePromptPath: durable.continuePromptPath,
    generatedAt: new Date().toISOString(),
    automationId,
    name,
    cadenceMinutes,
    rrule,
    automationStatus,
    recommendedAutomationAction,
    reason,
    jsonPath,
    promptPath,
    bindArguments: {
      taskDir,
      automationId: automationId || "<automation-id-from-automation_update>",
    },
    createRequest,
    updateRequest,
    deleteRequest,
    prompt,
  };
}

async function persistCodexHeartbeat(taskDir, heartbeat) {
  await writeJson(join(taskDir, CODEX_HEARTBEAT_JSON_NAME), heartbeat);
  await writeText(join(taskDir, CODEX_HEARTBEAT_PROMPT_NAME), heartbeat.prompt);
}

function summarizeCodexHeartbeat(heartbeat) {
  return {
    automationId: heartbeat.automationId,
    name: heartbeat.name,
    cadenceMinutes: heartbeat.cadenceMinutes,
    rrule: heartbeat.rrule,
    automationStatus: heartbeat.automationStatus,
    recommendedAutomationAction: heartbeat.recommendedAutomationAction,
    reason: heartbeat.reason,
    jsonPath: heartbeat.jsonPath,
    promptPath: heartbeat.promptPath,
    bindArguments: heartbeat.bindArguments,
    createRequest: heartbeat.createRequest,
    updateRequest: heartbeat.updateRequest,
    deleteRequest: heartbeat.deleteRequest,
    prompt: heartbeat.prompt,
  };
}

function buildCodexHeartbeatPrompt(durable, options = {}) {
  const automationId = String(options.automationId || "").trim();
  const taskDir = resolve(options.taskDir || durable.taskDir);
  const currentCheckpoint = durable.currentCheckpoint;
  const nextCheckpoint = durable.nextCheckpoint;

  return [
    `This heartbeat keeps the managed task alive in this Codex thread.`,
    `Task directory: ${taskDir}`,
    `Start each wake-up by calling resume_codex_managed_task with taskDir ${taskDir}.`,
    `Use the returned currentCheckpoint, doneWhen exit conditions, evidenceWanted, and continuePrompt as the source of truth instead of memory.`,
    `If the returned lifecycle is running, do the next meaningful chunk of work and checkpoint it immediately.`,
    currentCheckpoint
      ? `Current checkpoint on the latest run: ${currentCheckpoint.title} (${currentCheckpoint.id}).`
      : `No current checkpoint is active on the latest run.`,
    currentCheckpoint?.doneWhen?.length
      ? `Current checkpoint exit conditions: ${currentCheckpoint.doneWhen.join(" | ")}`
      : "",
    nextCheckpoint ? `Next checkpoint after that: ${nextCheckpoint.title} (${nextCheckpoint.id}).` : "",
    `If host planning tools are available and the checkpoint plan needs revision, update the live host plan first, then mirror the revised checkpoints back into checkpoint_codex_managed_task.`,
    `If the returned codexHeartbeat.recommendedAutomationAction is update or pause and codexHeartbeat.updateRequest exists, call automation_update with that request.`,
    `If the returned codexHeartbeat.recommendedAutomationAction is delete and codexHeartbeat.deleteRequest exists, call automation_update with that request after reporting the result.`,
    automationId
      ? `This heartbeat is bound to automation id ${automationId}.`
      : `If this heartbeat was just created, bind its automation id with bind_codex_heartbeat before relying on self-cleanup.`,
  ]
    .filter(Boolean)
    .join("\n");
}

function inferRecommendedAutomationAction(lifecycle, automationId) {
  if (lifecycle === "done" || lifecycle === "cancelled") {
    return automationId ? "delete" : "none";
  }
  if (lifecycle === "blocked" || lifecycle === "paused") {
    return automationId ? "pause" : "none";
  }
  return automationId ? "update" : "create";
}

function buildAutomationReason(durable, automationId) {
  const lifecycle = String(durable.task.lifecycle || "running");
  if (lifecycle === "done") {
    return automationId
      ? "The task is complete, so the heartbeat should delete itself."
      : "The task is complete and no heartbeat is currently bound.";
  }
  if (lifecycle === "cancelled") {
    return automationId
      ? "The task was cancelled, so the heartbeat should delete itself."
      : "The task was cancelled and no heartbeat is currently bound.";
  }
  if (lifecycle === "blocked") {
    return automationId
      ? "The task is blocked, so the heartbeat should be paused instead of waking repeatedly."
      : "The task is blocked, so there is no reason to create a new heartbeat yet.";
  }
  if (lifecycle === "paused") {
    return automationId
      ? "The task is paused, so keep the heartbeat paused until the user resumes it."
      : "The task is paused, so there is no reason to create a new heartbeat yet.";
  }
  if (durable.task.stopRequested) {
    return automationId
      ? "The task is still running, but it should pause cleanly after the current checkpoint."
      : "The task is still running and should pause after the current checkpoint, so create a short heartbeat now.";
  }
  return automationId
    ? "The task is still running, so keep the heartbeat fresh and attached to this thread."
    : "The task is still running and needs a fast thread heartbeat so Codex can resume soon after the current run ends.";
}

function buildHeartbeatRRule(cadenceMinutes) {
  return `FREQ=MINUTELY;INTERVAL=${cadenceMinutes}`;
}

function normalizeHeartbeatMinutes(value, lifecycle) {
  const candidate = Number(value || (lifecycle === "running" ? DEFAULT_ACTIVE_HEARTBEAT_MINUTES : 0));
  if (!Number.isFinite(candidate) || candidate <= 0) {
    return DEFAULT_ACTIVE_HEARTBEAT_MINUTES;
  }
  return Math.max(1, Math.floor(candidate));
}

export function resolveTaskLocator(input) {
  const payload = coerceObject(input);
  if (payload.planPath) {
    return {
      taskDir: dirname(resolve(String(payload.planPath))),
      planPath: resolve(String(payload.planPath)),
    };
  }
  if (payload.taskDir) {
    return {
      taskDir: resolve(String(payload.taskDir)),
      planPath: "",
    };
  }
  throw new Error("Codex managed task requires taskDir or planPath.");
}
