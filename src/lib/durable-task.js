import { appendFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  coerceObject,
  ensureDir,
  normalizeArray,
  pathExists,
  readJson,
  slugify,
  uniqueStrings,
  writeJson,
  writeText,
} from "./common.js";

const PLAN_JSON_NAME = "plan.json";
const PLAN_MARKDOWN_NAME = "plan.md";
const PLAN_SOURCE_MARKDOWN_NAME = "plan-source.md";
const CHECKPOINT_LOG_NAME = "checkpoints.jsonl";
const CONTINUE_PROMPT_NAME = "continue-prompt.txt";

const CHECKPOINT_STATES = new Set(["pending", "current", "completed", "blocked"]);
const TASK_LIFECYCLES = new Set(["running", "blocked", "paused", "cancelled", "done"]);

export async function startDurableTask(input, outputDir) {
  const payload = coerceObject(input);
  const now = new Date().toISOString();
  const root = resolveTaskRoot(payload, outputDir);
  const state = buildInitialTaskState(payload, now);
  const checkpoint = buildCheckpointEntry(
    {
      summary: String(payload.initialSummary || "Plan initialized."),
    },
    state,
    now,
    "init",
  );

  await persistTaskState(root, state, checkpoint);
  return summarizeTask(root, state);
}

export async function checkpointDurableTask(input) {
  const payload = coerceObject(input);
  const { root, planPath } = resolveExistingTaskPaths(payload);
  const state = sanitizeTaskState(await readJson(planPath));
  const updated = applyCheckpointUpdate(state, payload, new Date().toISOString());
  const checkpointType = updated.lifecycle !== "running" ? "control" : "checkpoint";
  const checkpoint = buildCheckpointEntry(payload, updated, updated.updatedAt, checkpointType);

  await persistTaskState(root, updated, checkpoint);
  return summarizeTask(root, updated);
}

export async function resumeDurableTask(input) {
  const payload = coerceObject(input);
  const { root, planPath } = resolveExistingTaskPaths(payload);
  const state = reconcileTaskState(sanitizeTaskState(await readJson(planPath)), {
    preferredCurrentCheckpointId: resolvePreferredCheckpointId(payload),
  });

  await persistTaskState(root, state, null);
  return summarizeTask(root, state);
}

function buildInitialTaskState(payload, now) {
  const goal = String(payload.goal || "").trim();
  if (!goal) {
    throw new Error("startDurableTask requires a non-empty goal.");
  }

  const checkpoints = buildInitialCheckpoints(payload, now);
  const base = {
    schemaVersion: 2,
    id: slugify(payload.id || payload.name || goal || "task"),
    name: String(payload.name || goal).trim(),
    goal,
    lifecycle: "running",
    status: "active",
    stopRequested: Boolean(payload.stopRequested || payload.stopAfterCurrentCheckpoint),
    stopReason: String(payload.stopReason || "").trim(),
    blockedReason: "",
    completionSummary: "",
    cancellationSummary: "",
    createdAt: now,
    updatedAt: now,
    acceptanceCriteria: uniqueStrings(payload.acceptanceCriteria),
    constraints: uniqueStrings(payload.constraints),
    contextNotes: uniqueStrings(payload.contextNotes),
    planMarkdown: String(payload.planMarkdown || "").trim(),
    planOrigin: String(payload.planOrigin || "tool").trim() || "tool",
    checkpoints,
    cursor: "",
    upcomingCheckpointId: "",
    lastCheckpoint: null,
  };

  return reconcileTaskState(base, {
    preferredCurrentCheckpointId: resolvePreferredCheckpointId(payload),
  });
}

function buildInitialCheckpoints(payload, now) {
  const rawCheckpoints = normalizeArray(payload.checkpoints);
  const rawSteps = normalizeArray(payload.steps);
  const source = rawCheckpoints.length ? rawCheckpoints : rawSteps;
  if (!source.length) {
    const parsed = parseCheckpointsFromPlanMarkdown(String(payload.planMarkdown || ""), now);
    return parsed.length ? parsed : buildDefaultCheckpoints(now);
  }

  const seenIds = new Set();
  const checkpoints = source.map((rawCheckpoint, index) => normalizeCheckpoint(rawCheckpoint, index, seenIds, now));
  if (!checkpoints.some((checkpoint) => checkpoint.state === "current")) {
    const firstPending = checkpoints.find((checkpoint) => checkpoint.state === "pending");
    if (firstPending) {
      firstPending.state = "current";
      firstPending.startedAt = firstPending.startedAt || now;
      firstPending.updatedAt = now;
    }
  }
  return checkpoints;
}

function parseCheckpointsFromPlanMarkdown(markdown, now) {
  const text = String(markdown || "").trim();
  if (!text) {
    return [];
  }

  const lines = text.split(/\r?\n/);
  const numberedOrCheckboxItems = collectMarkdownPlanItems(lines, {
    matchers: [
      (line) => line.match(/^\s*\d+\.\s+(.*)$/),
      (line) => line.match(/^\s*[-*]\s+\[(?: |x|X)\]\s+(.*)$/),
    ],
  });

  const items = numberedOrCheckboxItems.length
    ? numberedOrCheckboxItems
    : collectMarkdownPlanItems(lines, {
        matchers: [(line) => line.match(/^\s*[-*]\s+(.*)$/)],
      });

  if (!items.length) {
    return [];
  }

  const seenIds = new Set();
  return items.map((item, index) => normalizeCheckpoint(parsePlanItem(item), index, seenIds, now));
}

function collectMarkdownPlanItems(lines, options) {
  const matchers = normalizeArray(options.matchers);
  const items = [];
  let current = null;

  for (const rawLine of lines) {
    const line = String(rawLine || "");
    let matched = null;
    for (const matcher of matchers) {
      matched = matcher(line);
      if (matched) {
        break;
      }
    }

    if (matched) {
      if (current) {
        items.push(current);
      }
      current = {
        title: String(matched[1] || "").trim(),
        extraLines: [],
      };
      continue;
    }

    if (!current) {
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    if (/^\s{2,}\S/.test(line) || /^\s*[-*]\s+/.test(line)) {
      current.extraLines.push(line.trim());
    }
  }

  if (current) {
    items.push(current);
  }

  return items.filter((item) => item.title);
}

function parsePlanItem(item) {
  const extraLines = normalizeArray(item.extraLines).map((line) => String(line || "").trim());
  const doneWhen = [];
  const evidenceWanted = [];
  const detailLines = [];

  for (const line of extraLines) {
    const doneMatch = line.match(/^(done when|exit conditions?)\s*:\s*(.*)$/i);
    if (doneMatch) {
      doneWhen.push(...splitPlanField(doneMatch[2]));
      continue;
    }
    const evidenceMatch = line.match(/^(evidence|artifacts?)\s*:\s*(.*)$/i);
    if (evidenceMatch) {
      evidenceWanted.push(...splitPlanField(evidenceMatch[2]));
      continue;
    }
    detailLines.push(line.replace(/^[-*]\s+/, "").trim());
  }

  return {
    title: item.title,
    detail: detailLines.join(" "),
    doneWhen,
    evidenceWanted,
  };
}

function splitPlanField(value) {
  return String(value || "")
    .split(/\s*\|\s*|\s*;\s*/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function buildDefaultCheckpoints(now) {
  const seenIds = new Set();
  return [
    normalizeCheckpoint(
      {
        title: "Inspect context and restate the target",
        detail: "Read the relevant files, environment, and recent notes so the real target is explicit.",
        doneWhen: ["Relevant context reviewed", "The real target is explicit in the task record"],
        evidenceWanted: ["Files or evidence reviewed", "Restated target"],
        state: "current",
      },
      0,
      seenIds,
      now,
    ),
    normalizeCheckpoint(
      {
        title: "Do the main work",
        detail: "Make the implementation, research, or operational changes that actually move the task forward.",
        doneWhen: ["Main work completed", "New subproblems captured as checkpoints instead of skipped"],
        evidenceWanted: ["Changed files, commands, or concrete outputs"],
      },
      1,
      seenIds,
      now,
    ),
    normalizeCheckpoint(
      {
        title: "Verify the result",
        detail: "Run checks, compare against the goal, and record any remaining gaps.",
        doneWhen: ["Checks completed or verification rationale recorded", "Remaining gaps explicitly noted"],
        evidenceWanted: ["Test output, manual verification notes, or reasons a check could not run"],
      },
      2,
      seenIds,
      now,
    ),
    normalizeCheckpoint(
      {
        title: "Close out and report",
        detail: "Summarize what changed, what was verified, and what still matters before stopping.",
        doneWhen: ["Final summary written", "Residual risk or follow-up captured if needed"],
        evidenceWanted: ["Completion summary"],
      },
      3,
      seenIds,
      now,
    ),
  ];
}

function normalizeCheckpoint(rawCheckpoint, index, seenIds, now) {
  const payload = coerceObject(rawCheckpoint);
  const title = String(payload.title || payload.name || `Checkpoint ${index + 1}`).trim() || `Checkpoint ${index + 1}`;
  const id = dedupeId(String(payload.id || slugify(title || `checkpoint-${index + 1}`)), seenIds);
  const state = normalizeCheckpointState(payload.state || payload.status) || "pending";
  const updatedAt = String(payload.updatedAt || now);
  const startedAt =
    String(payload.startedAt || "") || (state === "current" || state === "completed" ? updatedAt : "");
  const completedAt = String(payload.completedAt || "") || (state === "completed" ? updatedAt : "");
  const detail = String(payload.detail || payload.description || "").trim();
  const resumeHint = String(payload.resumeHint || payload.nextAction || "").trim();

  return {
    id,
    title,
    detail,
    resumeHint,
    doneWhen: uniqueStrings(payload.doneWhen || payload.exitCriteria),
    evidenceWanted: uniqueStrings(payload.evidenceWanted || payload.evidence || payload.artifactsWanted),
    state,
    notes: uniqueStrings(payload.notes),
    artifacts: uniqueStrings(payload.artifacts),
    startedAt,
    completedAt,
    updatedAt,
  };
}

function sanitizeTaskState(rawState) {
  const payload = coerceObject(rawState);
  const now = new Date().toISOString();
  const seenIds = new Set();
  const rawCheckpoints = normalizeArray(payload.checkpoints);
  const rawSteps = normalizeArray(payload.steps);
  const checkpointsSource = rawCheckpoints.length ? rawCheckpoints : rawSteps;
  const checkpoints = checkpointsSource.length
    ? checkpointsSource.map((rawCheckpoint, index) => normalizeCheckpoint(rawCheckpoint, index, seenIds, now))
    : buildDefaultCheckpoints(now);

  const lifecycle =
    normalizeLifecycle(payload.lifecycle) || legacyStatusToLifecycle(payload.status) || "running";
  const state = {
    schemaVersion: Number(payload.schemaVersion || 2),
    id: String(payload.id || slugify(payload.name || payload.goal || "task")),
    name: String(payload.name || payload.goal || "task").trim(),
    goal: String(payload.goal || payload.name || "").trim(),
    lifecycle,
    status: lifecycleToStatusAlias(lifecycle),
    stopRequested: Boolean(payload.stopRequested),
    stopReason: String(payload.stopReason || "").trim(),
    blockedReason: String(payload.blockedReason || "").trim(),
    completionSummary: String(payload.completionSummary || "").trim(),
    cancellationSummary: String(payload.cancellationSummary || "").trim(),
    createdAt: String(payload.createdAt || now),
    updatedAt: String(payload.updatedAt || now),
    acceptanceCriteria: uniqueStrings(payload.acceptanceCriteria),
    constraints: uniqueStrings(payload.constraints),
    contextNotes: uniqueStrings(payload.contextNotes),
    planMarkdown: String(payload.planMarkdown || "").trim(),
    planOrigin: String(payload.planOrigin || "tool").trim() || "tool",
    checkpoints,
    cursor: String(payload.cursor || payload.currentCheckpointId || payload.currentStepId || "").trim(),
    upcomingCheckpointId: String(payload.upcomingCheckpointId || payload.upcomingStepId || "").trim(),
    lastCheckpoint: normalizeCheckpointEntry(payload.lastCheckpoint),
  };

  return reconcileTaskState(state, {
    preferredCurrentCheckpointId: resolvePreferredCheckpointId(payload),
  });
}

function normalizeCheckpointEntry(rawCheckpoint) {
  const payload = coerceObject(rawCheckpoint);
  if (!Object.keys(payload).length) {
    return null;
  }
  const lifecycle =
    normalizeLifecycle(payload.lifecycle) || legacyStatusToLifecycle(payload.status) || "running";
  return {
    type: String(payload.type || "checkpoint"),
    timestamp: String(payload.timestamp || new Date().toISOString()),
    summary: String(payload.summary || "").trim(),
    lifecycle,
    status: lifecycleToStatusAlias(lifecycle),
    cursor: String(payload.cursor || payload.currentCheckpointId || payload.currentStepId || "").trim(),
    upcomingCheckpointId: String(payload.upcomingCheckpointId || payload.upcomingStepId || "").trim(),
    completedCheckpointIds: uniqueStrings(payload.completedCheckpointIds || payload.completedStepIds),
    blockedCheckpointId: String(payload.blockedCheckpointId || payload.blockedStepId || "").trim(),
    blockedReason: String(payload.blockedReason || "").trim(),
    artifacts: uniqueStrings(payload.artifacts),
    completionSummary: String(payload.completionSummary || "").trim(),
    stopRequested: Boolean(payload.stopRequested),
    stopReason: String(payload.stopReason || "").trim(),
    cancellationSummary: String(payload.cancellationSummary || "").trim(),
  };
}

function applyCheckpointUpdate(state, payload, now) {
  const next = cloneState(state);
  const currentCheckpointId = resolvePreferredCheckpointId(payload);
  const completedCheckpointIds = uniqueStrings(payload.completedCheckpointIds || payload.completedStepIds);
  const reopenedCheckpointIds = uniqueStrings(payload.reopenCheckpointIds || payload.reopenStepIds);
  const blockedCheckpointId = String(payload.blockedCheckpointId || payload.blockedStepId || "").trim();
  const insertAfterCheckpointId = String(
    payload.insertAfterCheckpointId || payload.insertAfterStepId || currentCheckpointId || "",
  ).trim();
  const newArtifacts = uniqueStrings(payload.artifacts);
  const explicitLifecycle =
    normalizeLifecycle(payload.lifecycle) || legacyStatusToLifecycle(payload.status) || "";
  const blockedReason = String(payload.blockedReason || "").trim();
  const summary = String(payload.summary || "").trim();

  if (Array.isArray(payload.checkpoints) && payload.checkpoints.length) {
    next.checkpoints = buildInitialCheckpoints(
      {
        checkpoints: payload.checkpoints,
      },
      now,
    );
    next.cursor = "";
    next.upcomingCheckpointId = "";
  }

  if (Array.isArray(payload.newCheckpoints) && payload.newCheckpoints.length) {
    insertNewCheckpoints(next.checkpoints, payload.newCheckpoints, insertAfterCheckpointId, now);
  } else if (Array.isArray(payload.newSteps) && payload.newSteps.length) {
    insertNewCheckpoints(next.checkpoints, payload.newSteps, insertAfterCheckpointId, now);
  }

  if (typeof payload.planMarkdown === "string") {
    next.planMarkdown = payload.planMarkdown.trim();
  }
  if (typeof payload.planOrigin === "string" && payload.planOrigin.trim()) {
    next.planOrigin = payload.planOrigin.trim();
  }

  const checkpointById = new Map(next.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));

  for (const checkpointId of reopenedCheckpointIds) {
    const checkpoint = checkpointById.get(checkpointId);
    if (!checkpoint) {
      continue;
    }
    checkpoint.state = checkpointId === currentCheckpointId ? "current" : "pending";
    checkpoint.completedAt = "";
    checkpoint.updatedAt = now;
  }

  for (const checkpointId of completedCheckpointIds) {
    const checkpoint = checkpointById.get(checkpointId);
    if (!checkpoint) {
      continue;
    }
    checkpoint.state = "completed";
    checkpoint.startedAt = checkpoint.startedAt || now;
    checkpoint.completedAt = now;
    checkpoint.updatedAt = now;
  }

  if (blockedCheckpointId) {
    const checkpoint = checkpointById.get(blockedCheckpointId);
    if (checkpoint) {
      checkpoint.state = "blocked";
      checkpoint.startedAt = checkpoint.startedAt || now;
      checkpoint.updatedAt = now;
    }
  }

  if (currentCheckpointId) {
    const checkpoint = checkpointById.get(currentCheckpointId);
    if (checkpoint && checkpoint.state !== "completed" && checkpoint.state !== "blocked") {
      checkpoint.state = "current";
      checkpoint.startedAt = checkpoint.startedAt || now;
      checkpoint.updatedAt = now;
    }
  }

  const noteTarget =
    checkpointById.get(completedCheckpointIds.at(-1) || "") ||
    checkpointById.get(blockedCheckpointId) ||
    checkpointById.get(currentCheckpointId) ||
    checkpointById.get(next.cursor || "");

  if (noteTarget && summary) {
    pushUnique(noteTarget.notes, summary);
    noteTarget.updatedAt = now;
  } else if (summary) {
    pushUnique(next.contextNotes, summary);
  }

  if (noteTarget && newArtifacts.length) {
    for (const artifact of newArtifacts) {
      pushUnique(noteTarget.artifacts, artifact);
    }
    noteTarget.updatedAt = now;
  }

  if (typeof payload.stopRequested === "boolean") {
    next.stopRequested = payload.stopRequested;
  }
  if (payload.stopAfterCurrentCheckpoint === true) {
    next.stopRequested = true;
  }
  if (typeof payload.stopReason === "string") {
    next.stopReason = payload.stopReason.trim();
  }
  if (payload.clearStopRequested === true) {
    next.stopRequested = false;
    next.stopReason = "";
  }

  if (explicitLifecycle === "running" || reopenedCheckpointIds.length || payload.clearBlockedReason === true) {
    next.blockedReason = "";
  }
  if (blockedReason) {
    next.blockedReason = blockedReason;
  }

  if (typeof payload.completionSummary === "string" && payload.completionSummary.trim()) {
    next.completionSummary = payload.completionSummary.trim();
  }
  if (typeof payload.cancellationSummary === "string" && payload.cancellationSummary.trim()) {
    next.cancellationSummary = payload.cancellationSummary.trim();
  }

  const doneSignal = payload.done === true || explicitLifecycle === "done";
  const cancelSignal = payload.cancel === true || explicitLifecycle === "cancelled";
  const pauseSignal = payload.pause === true || explicitLifecycle === "paused";
  const blockedSignal =
    explicitLifecycle === "blocked" || Boolean(blockedCheckpointId) || Boolean(blockedReason);

  if (doneSignal) {
    for (const checkpoint of next.checkpoints) {
      checkpoint.state = "completed";
      checkpoint.startedAt = checkpoint.startedAt || now;
      checkpoint.completedAt = checkpoint.completedAt || now;
      checkpoint.updatedAt = now;
    }
    next.lifecycle = "done";
    next.stopRequested = false;
    next.stopReason = "";
    next.blockedReason = "";
    next.completionSummary = next.completionSummary || summary || "Task completed.";
  } else if (cancelSignal) {
    next.lifecycle = "cancelled";
    next.stopRequested = false;
    next.stopReason = "";
    next.blockedReason = "";
    next.cancellationSummary = next.cancellationSummary || summary || "Task cancelled.";
  } else if (pauseSignal) {
    next.lifecycle = "paused";
    next.blockedReason = "";
  } else if (blockedSignal) {
    next.lifecycle = "blocked";
  } else {
    next.lifecycle = "running";
    next.blockedReason = "";
  }

  if (areAllCheckpointsCompleted(next.checkpoints) && next.lifecycle === "running") {
    next.lifecycle = "done";
    next.stopRequested = false;
    next.stopReason = "";
    next.completionSummary = next.completionSummary || summary || "Task completed.";
  }

  next.updatedAt = now;
  return reconcileTaskState(next, {
    preferredCurrentCheckpointId: currentCheckpointId,
  });
}

function insertNewCheckpoints(checkpoints, rawCheckpoints, insertAfterCheckpointId, now) {
  const seenIds = new Set(checkpoints.map((checkpoint) => checkpoint.id));
  const normalized = normalizeArray(rawCheckpoints).map((rawCheckpoint, index) =>
    normalizeCheckpoint(rawCheckpoint, index, seenIds, now),
  );
  if (!normalized.length) {
    return;
  }

  const preferredAnchor = String(insertAfterCheckpointId || "").trim();
  let insertIndex = checkpoints.length;
  if (preferredAnchor) {
    const anchorIndex = checkpoints.findIndex((checkpoint) => checkpoint.id === preferredAnchor);
    if (anchorIndex !== -1) {
      insertIndex = anchorIndex + 1;
    }
  } else {
    const currentIndex = checkpoints.findIndex((checkpoint) => checkpoint.state === "current");
    if (currentIndex !== -1) {
      insertIndex = currentIndex + 1;
    }
  }

  checkpoints.splice(insertIndex, 0, ...normalized);
}

function reconcileTaskState(state, options = {}) {
  const next = cloneState(state);
  next.checkpoints = normalizeArray(next.checkpoints);
  next.status = lifecycleToStatusAlias(next.lifecycle);

  if (!next.checkpoints.length) {
    next.checkpoints = buildDefaultCheckpoints(next.updatedAt || new Date().toISOString());
  }

  if (next.lifecycle === "cancelled") {
    next.cursor = "";
    next.upcomingCheckpointId = findFirstPendingCheckpointId(next.checkpoints);
    next.status = lifecycleToStatusAlias(next.lifecycle);
    return next;
  }

  if (areAllCheckpointsCompleted(next.checkpoints) || next.lifecycle === "done") {
    next.lifecycle = "done";
    next.status = lifecycleToStatusAlias(next.lifecycle);
    next.cursor = "";
    next.upcomingCheckpointId = "";
    next.stopRequested = false;
    next.stopReason = "";
    return next;
  }

  const preferredCurrentCheckpointId = String(options.preferredCurrentCheckpointId || "").trim();
  let currentCandidate =
    next.checkpoints.find(
      (checkpoint) =>
        checkpoint.id === preferredCurrentCheckpointId &&
        checkpoint.state !== "completed" &&
        checkpoint.state !== "blocked",
    ) ||
    next.checkpoints.find((checkpoint) => checkpoint.state === "current");

  if (next.lifecycle === "blocked") {
    const blockedCheckpoint =
      next.checkpoints.find((checkpoint) => checkpoint.id === next.cursor && checkpoint.state === "blocked") ||
      next.checkpoints.find((checkpoint) => checkpoint.id === preferredCurrentCheckpointId && checkpoint.state === "blocked") ||
      next.checkpoints.find((checkpoint) => checkpoint.state === "blocked");
    next.cursor = blockedCheckpoint?.id || currentCandidate?.id || "";
    next.upcomingCheckpointId = findUpcomingCheckpointId(
      next.checkpoints,
      next.checkpoints.findIndex((checkpoint) => checkpoint.id === next.cursor),
    );
    next.status = lifecycleToStatusAlias(next.lifecycle);
    return next;
  }

  if (next.lifecycle === "paused") {
    if (!currentCandidate) {
      currentCandidate =
        next.checkpoints.find(
          (checkpoint) => checkpoint.id === next.cursor && checkpoint.state !== "completed" && checkpoint.state !== "blocked",
        ) || null;
    }
    next.cursor = currentCandidate?.id || "";
    next.upcomingCheckpointId = currentCandidate
      ? findUpcomingCheckpointId(
          next.checkpoints,
          next.checkpoints.findIndex((checkpoint) => checkpoint.id === currentCandidate.id),
        )
      : findFirstPendingCheckpointId(next.checkpoints);
    next.status = lifecycleToStatusAlias(next.lifecycle);
    return next;
  }

  if (next.stopRequested) {
    const existingCurrent =
      currentCandidate ||
      next.checkpoints.find(
        (checkpoint) => checkpoint.id === next.cursor && checkpoint.state !== "completed" && checkpoint.state !== "blocked",
      );
    if (existingCurrent) {
      setCurrentCheckpoint(next.checkpoints, existingCurrent.id, next.updatedAt);
      next.cursor = existingCurrent.id;
      next.upcomingCheckpointId = findUpcomingCheckpointId(
        next.checkpoints,
        next.checkpoints.findIndex((checkpoint) => checkpoint.id === existingCurrent.id),
      );
      next.status = lifecycleToStatusAlias(next.lifecycle);
      return next;
    }

    next.lifecycle = "paused";
    next.status = lifecycleToStatusAlias(next.lifecycle);
    next.cursor = "";
    next.upcomingCheckpointId = findFirstPendingCheckpointId(next.checkpoints);
    return next;
  }

  if (!currentCandidate) {
    currentCandidate = next.checkpoints.find((checkpoint) => checkpoint.state === "pending") || null;
  }

  if (currentCandidate) {
    setCurrentCheckpoint(next.checkpoints, currentCandidate.id, next.updatedAt);
    next.cursor = currentCandidate.id;
    next.upcomingCheckpointId = findUpcomingCheckpointId(
      next.checkpoints,
      next.checkpoints.findIndex((checkpoint) => checkpoint.id === currentCandidate.id),
    );
  } else {
    next.cursor = "";
    next.upcomingCheckpointId = findFirstPendingCheckpointId(next.checkpoints);
  }

  next.lifecycle = areAllCheckpointsCompleted(next.checkpoints) ? "done" : "running";
  next.status = lifecycleToStatusAlias(next.lifecycle);
  if (next.lifecycle === "done") {
    next.cursor = "";
    next.upcomingCheckpointId = "";
    next.stopRequested = false;
    next.stopReason = "";
  }
  return next;
}

function setCurrentCheckpoint(checkpoints, checkpointId, updatedAt) {
  for (const checkpoint of checkpoints) {
    if (checkpoint.id === checkpointId) {
      checkpoint.state = "current";
      checkpoint.startedAt = checkpoint.startedAt || updatedAt;
      checkpoint.updatedAt = updatedAt;
    } else if (checkpoint.state === "current") {
      checkpoint.state = "pending";
      checkpoint.updatedAt = updatedAt;
    }
  }
}

function findFirstPendingCheckpointId(checkpoints) {
  return checkpoints.find((checkpoint) => checkpoint.state === "pending")?.id || "";
}

function findUpcomingCheckpointId(checkpoints, currentIndex) {
  if (!checkpoints.length) {
    return "";
  }

  if (currentIndex !== -1) {
    for (let index = currentIndex + 1; index < checkpoints.length; index += 1) {
      if (checkpoints[index].state === "pending") {
        return checkpoints[index].id;
      }
    }
  }

  return findFirstPendingCheckpointId(checkpoints);
}

function buildCheckpointEntry(payload, state, timestamp, type) {
  const lifecycle = state.lifecycle;
  return {
    type,
    timestamp,
    summary: String(payload.summary || "").trim(),
    lifecycle,
    status: lifecycleToStatusAlias(lifecycle),
    cursor: state.cursor,
    upcomingCheckpointId: state.upcomingCheckpointId,
    completedCheckpointIds: state.checkpoints
      .filter((checkpoint) => checkpoint.state === "completed")
      .map((checkpoint) => checkpoint.id),
    blockedCheckpointId: state.checkpoints.find((checkpoint) => checkpoint.state === "blocked")?.id || "",
    blockedReason: state.blockedReason,
    artifacts: uniqueStrings(payload.artifacts),
    completionSummary: state.completionSummary,
    stopRequested: state.stopRequested,
    stopReason: state.stopReason,
    cancellationSummary: state.cancellationSummary,
  };
}

async function persistTaskState(root, state, checkpoint) {
  const paths = buildTaskPaths(root);
  if (checkpoint) {
    state.lastCheckpoint = checkpoint;
  }
  const continuePrompt = buildContinuePrompt(state, paths);
  const persisted = cloneState(state);

  await ensureDir(root);
  await writeJson(paths.planPath, persisted);
  await writeText(paths.markdownPath, renderTaskMarkdown(persisted, paths, continuePrompt));
  await writeText(paths.continuePromptPath, continuePrompt);
  if (persisted.planMarkdown) {
    await writeText(paths.planSourcePath, persisted.planMarkdown);
  } else if (!(await pathExists(paths.planSourcePath))) {
    await writeText(paths.planSourcePath, "");
  }
  if (checkpoint) {
    await appendFile(paths.checkpointLogPath, `${JSON.stringify(checkpoint)}\n`, "utf8");
  } else if (!(await pathExists(paths.checkpointLogPath))) {
    await writeText(paths.checkpointLogPath, "");
  }
}

function renderTaskMarkdown(state, paths, continuePrompt) {
  const currentCheckpoint = state.checkpoints.find((checkpoint) => checkpoint.id === state.cursor) || null;
  const upcomingCheckpoint = state.checkpoints.find((checkpoint) => checkpoint.id === state.upcomingCheckpointId) || null;
  const lastCheckpoint = state.lastCheckpoint;

  return [
    `# Durable Task Plan: ${state.name}`,
    "",
    `Goal: ${state.goal}`,
    `Lifecycle: ${state.lifecycle}`,
    `Created: ${state.createdAt}`,
    `Updated: ${state.updatedAt}`,
    `Plan JSON: ${paths.planPath}`,
    `Plan Markdown: ${paths.markdownPath}`,
    `Detailed Plan Source: ${paths.planSourcePath}`,
    currentCheckpoint ? `Current Checkpoint: ${currentCheckpoint.title} (${currentCheckpoint.id})` : "Current Checkpoint: none",
    upcomingCheckpoint ? `Next Checkpoint: ${upcomingCheckpoint.title} (${upcomingCheckpoint.id})` : "Next Checkpoint: none",
    state.stopRequested ? `Stop Requested: yes${state.stopReason ? ` (${state.stopReason})` : ""}` : "Stop Requested: no",
    state.blockedReason ? `Blocked Reason: ${state.blockedReason}` : "",
    state.completionSummary ? `Completion Summary: ${state.completionSummary}` : "",
    state.cancellationSummary ? `Cancellation Summary: ${state.cancellationSummary}` : "",
    "",
    "## Acceptance Criteria",
    renderBulletSection(state.acceptanceCriteria, "No explicit acceptance criteria recorded."),
    "",
    "## Constraints",
    renderBulletSection(state.constraints, "No explicit constraints recorded."),
    "",
    "## Context Notes",
    renderBulletSection(state.contextNotes, "No additional context notes recorded."),
    "",
    "## Checkpoints",
    state.checkpoints.map((checkpoint, index) => renderCheckpointLine(checkpoint, index + 1)).join("\n"),
    "",
    "## Latest Checkpoint Update",
    lastCheckpoint
      ? [
          `- Type: ${lastCheckpoint.type}`,
          `- Timestamp: ${lastCheckpoint.timestamp}`,
          `- Summary: ${lastCheckpoint.summary || "No summary recorded."}`,
          `- Lifecycle: ${lastCheckpoint.lifecycle}`,
          lastCheckpoint.cursor ? `- Cursor: ${lastCheckpoint.cursor}` : "",
          lastCheckpoint.blockedReason ? `- Blocked: ${lastCheckpoint.blockedReason}` : "",
          lastCheckpoint.stopRequested
            ? `- Stop Requested: yes${lastCheckpoint.stopReason ? ` (${lastCheckpoint.stopReason})` : ""}`
            : "- Stop Requested: no",
          lastCheckpoint.artifacts.length ? `- Artifacts: ${lastCheckpoint.artifacts.join(", ")}` : "",
          lastCheckpoint.completionSummary ? `- Completion: ${lastCheckpoint.completionSummary}` : "",
          lastCheckpoint.cancellationSummary ? `- Cancellation: ${lastCheckpoint.cancellationSummary}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "- No checkpoint update recorded yet.",
    "",
    "## Continue Prompt",
    "```text",
    continuePrompt,
    "```",
    "",
  ]
    .filter(Boolean)
    .join("\n");
}

function renderCheckpointLine(checkpoint, index) {
  const lines = [`${index}. ${checkpointStateToken(checkpoint.state)} ${checkpoint.title} (${checkpoint.id})`];
  if (checkpoint.detail) {
    lines.push(`   detail: ${checkpoint.detail}`);
  }
  if (checkpoint.doneWhen.length) {
    lines.push(`   done when: ${checkpoint.doneWhen.join(" | ")}`);
  }
  if (checkpoint.evidenceWanted.length) {
    lines.push(`   evidence: ${checkpoint.evidenceWanted.join(" | ")}`);
  }
  if (checkpoint.resumeHint) {
    lines.push(`   resume hint: ${checkpoint.resumeHint}`);
  }
  if (checkpoint.notes.length) {
    lines.push(`   notes: ${checkpoint.notes.join(" | ")}`);
  }
  if (checkpoint.artifacts.length) {
    lines.push(`   artifacts: ${checkpoint.artifacts.join(", ")}`);
  }
  if (checkpoint.startedAt) {
    lines.push(`   started: ${checkpoint.startedAt}`);
  }
  if (checkpoint.completedAt) {
    lines.push(`   completed: ${checkpoint.completedAt}`);
  }
  return lines.join("\n");
}

function renderBulletSection(items, fallback) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- ${fallback}`;
}

function buildContinuePrompt(state, paths) {
  const currentCheckpoint = state.checkpoints.find((checkpoint) => checkpoint.id === state.cursor) || null;
  const nextCheckpoint = state.checkpoints.find((checkpoint) => checkpoint.id === state.upcomingCheckpointId) || null;
  const latestSummary = state.lastCheckpoint?.summary || "";
  const closingLine =
    state.lifecycle === "done"
      ? "The task is complete. Report the result, keep the persisted plan as the record, and reopen the loop only if new work appears."
      : state.lifecycle === "cancelled"
        ? "The task is cancelled. Do not resume work unless the user explicitly reopens it."
        : state.lifecycle === "paused"
          ? "The task is paused. Wait for the user to resume it, or clear stopRequested if the pause was only meant to happen after the previous checkpoint."
          : state.lifecycle === "blocked"
            ? "The task is blocked. Ask for the missing input or approval, or wait for the external condition before resuming."
            : state.stopRequested
              ? "Finish the current checkpoint cleanly, then pause instead of advancing to a new checkpoint."
              : "Do the next smallest useful chunk of work, then call checkpoint_durable_task with what changed, which checkpoints completed, any blockers, and whether the current checkpoint exit conditions are satisfied.";

  return [
    `Resume the durable task "${state.name}".`,
    `Goal: ${state.goal}`,
    `Plan file: ${paths.markdownPath}`,
    `Task lifecycle: ${state.lifecycle}.`,
    currentCheckpoint
      ? `Current checkpoint: ${currentCheckpoint.title} (${currentCheckpoint.id}).`
      : "No current checkpoint is active.",
    currentCheckpoint?.detail ? `Current checkpoint detail: ${currentCheckpoint.detail}` : "",
    currentCheckpoint?.doneWhen.length
      ? `Exit conditions: ${currentCheckpoint.doneWhen.join(" | ")}`
      : "",
    currentCheckpoint?.evidenceWanted.length
      ? `Evidence to record: ${currentCheckpoint.evidenceWanted.join(" | ")}`
      : "",
    currentCheckpoint?.resumeHint ? `Resume hint: ${currentCheckpoint.resumeHint}` : "",
    nextCheckpoint && nextCheckpoint.id !== currentCheckpoint?.id
      ? `After that, the next queued checkpoint is ${nextCheckpoint.title} (${nextCheckpoint.id}).`
      : "",
    latestSummary ? `Latest checkpoint update: ${latestSummary}` : "",
    state.stopRequested ? `Stop requested: yes${state.stopReason ? ` (${state.stopReason})` : ""}` : "",
    state.blockedReason ? `Blocked on: ${state.blockedReason}` : "",
    state.completionSummary && state.lifecycle === "done" ? `Completion summary: ${state.completionSummary}` : "",
    state.cancellationSummary && state.lifecycle === "cancelled"
      ? `Cancellation summary: ${state.cancellationSummary}`
      : "",
    state.acceptanceCriteria.length
      ? `Acceptance criteria: ${state.acceptanceCriteria.join(" | ")}`
      : "Acceptance criteria: not explicitly recorded.",
    closingLine,
  ]
    .filter(Boolean)
    .join("\n");
}

function summarizeTask(root, state) {
  const paths = buildTaskPaths(root);
  const continuePrompt = buildContinuePrompt(state, paths);
  const currentCheckpoint = state.checkpoints.find((checkpoint) => checkpoint.id === state.cursor) || null;
  const nextCheckpoint = state.checkpoints.find((checkpoint) => checkpoint.id === state.upcomingCheckpointId) || null;
  const lifecycle = state.lifecycle;
  const status = lifecycleToStatusAlias(lifecycle);

  return {
    taskDir: root,
    planPath: paths.planPath,
    markdownPath: paths.markdownPath,
    checkpointLogPath: paths.checkpointLogPath,
    continuePromptPath: paths.continuePromptPath,
    planSourcePath: paths.planSourcePath,
    task: {
      id: state.id,
      name: state.name,
      goal: state.goal,
      lifecycle,
      status,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
      stopRequested: state.stopRequested,
      stopReason: state.stopReason,
      blockedReason: state.blockedReason,
      completionSummary: state.completionSummary,
      cancellationSummary: state.cancellationSummary,
      acceptanceCriteria: state.acceptanceCriteria,
      constraints: state.constraints,
      planOrigin: state.planOrigin,
    },
    cursor: state.cursor,
    currentCheckpointId: state.cursor,
    upcomingCheckpointId: state.upcomingCheckpointId,
    currentCheckpoint,
    nextCheckpoint,
    checkpoints: state.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      title: checkpoint.title,
      detail: checkpoint.detail,
      resumeHint: checkpoint.resumeHint,
      doneWhen: checkpoint.doneWhen,
      evidenceWanted: checkpoint.evidenceWanted,
      state: checkpoint.state,
      startedAt: checkpoint.startedAt,
      completedAt: checkpoint.completedAt,
    })),
    shouldContinue: lifecycle === "running",
    shouldPauseAfterCurrentCheckpoint: state.stopRequested,
    done: lifecycle === "done",
    latestCheckpoint: state.lastCheckpoint,
    continuePrompt,
    currentStep: currentCheckpoint,
    upcomingStep: nextCheckpoint,
    steps: state.checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      title: checkpoint.title,
      detail: checkpoint.detail,
      status: checkpoint.state,
      startedAt: checkpoint.startedAt,
      completedAt: checkpoint.completedAt,
    })),
  };
}

function resolveTaskRoot(payload, outputDir) {
  if (outputDir) {
    return resolve(outputDir);
  }
  if (payload.taskDir) {
    return resolve(String(payload.taskDir));
  }
  const id = slugify(payload.id || payload.name || payload.goal || "task");
  return resolve(process.cwd(), "output", "durable-tasks", id);
}

function resolveExistingTaskPaths(payload) {
  if (payload.planPath) {
    const planPath = resolve(String(payload.planPath));
    return {
      root: dirname(planPath),
      planPath,
    };
  }

  if (payload.taskDir) {
    const root = resolve(String(payload.taskDir));
    const planPath = join(root, PLAN_JSON_NAME);
    return {
      root,
      planPath,
    };
  }

  throw new Error("A durable task requires taskDir or planPath.");
}

function buildTaskPaths(root) {
  return {
    planPath: join(root, PLAN_JSON_NAME),
    markdownPath: join(root, PLAN_MARKDOWN_NAME),
    planSourcePath: join(root, PLAN_SOURCE_MARKDOWN_NAME),
    checkpointLogPath: join(root, CHECKPOINT_LOG_NAME),
    continuePromptPath: join(root, CONTINUE_PROMPT_NAME),
  };
}

function normalizeCheckpointState(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "in_progress" || normalized === "active") {
    return "current";
  }
  if (normalized === "done") {
    return "completed";
  }
  return CHECKPOINT_STATES.has(normalized) ? normalized : "";
}

function normalizeLifecycle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return TASK_LIFECYCLES.has(normalized) ? normalized : "";
}

function legacyStatusToLifecycle(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }
  switch (normalized) {
    case "active":
      return "running";
    case "blocked":
      return "blocked";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "done":
      return "done";
    default:
      return "";
  }
}

function lifecycleToStatusAlias(lifecycle) {
  switch (String(lifecycle || "").trim().toLowerCase()) {
    case "running":
      return "active";
    case "blocked":
      return "blocked";
    case "paused":
      return "paused";
    case "cancelled":
      return "cancelled";
    case "done":
      return "done";
    default:
      return "active";
  }
}

function resolvePreferredCheckpointId(payload) {
  return String(payload.currentCheckpointId || payload.currentStepId || "").trim();
}

function dedupeId(candidate, seenIds) {
  const base = slugify(candidate || "checkpoint");
  let nextId = base;
  let suffix = 2;
  while (seenIds.has(nextId)) {
    nextId = `${base}-${suffix}`;
    suffix += 1;
  }
  seenIds.add(nextId);
  return nextId;
}

function areAllCheckpointsCompleted(checkpoints) {
  return checkpoints.length > 0 && checkpoints.every((checkpoint) => checkpoint.state === "completed");
}

function checkpointStateToken(state) {
  switch (state) {
    case "completed":
      return "[x]";
    case "current":
      return "[>]";
    case "blocked":
      return "[!]";
    default:
      return "[ ]";
  }
}

function pushUnique(list, value) {
  const text = String(value || "").trim();
  if (!text) {
    return;
  }
  if (!list.includes(text)) {
    list.push(text);
  }
}

function cloneState(value) {
  return JSON.parse(JSON.stringify(value));
}
