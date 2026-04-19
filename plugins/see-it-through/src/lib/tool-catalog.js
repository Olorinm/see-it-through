export const TOOL_CATALOG = [
  {
    name: "start_durable_task",
    description:
      "Create a persisted task packet with a checkpoint-based plan, a cursor, a checkpoint log, and a continuation prompt before a long-running task begins.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        name: { type: "string" },
        outDir: { type: "string" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        constraints: { type: "array", items: { type: "string" } },
        contextNotes: { type: "array", items: { type: "string" } },
        planMarkdown: { type: "string" },
        planOrigin: { type: "string" },
        checkpoints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              detail: { type: "string" },
              resumeHint: { type: "string" },
              doneWhen: { type: "array", items: { type: "string" } },
              evidenceWanted: { type: "array", items: { type: "string" } },
              state: { type: "string" }
            },
            additionalProperties: false
          }
        },
        stopRequested: { type: "boolean" },
        stopAfterCurrentCheckpoint: { type: "boolean" },
        stopReason: { type: "string" }
      },
      required: ["goal"],
      additionalProperties: false
    }
  },
  {
    name: "checkpoint_durable_task",
    description:
      "Update a durable task packet after a chunk of work, move the checkpoint cursor, record artifacts, and receive the next continuation prompt.",
    inputSchema: {
      type: "object",
      properties: {
        taskDir: { type: "string" },
        planPath: { type: "string" },
        summary: { type: "string" },
        currentCheckpointId: { type: "string" },
        currentStepId: { type: "string" },
        completedCheckpointIds: { type: "array", items: { type: "string" } },
        completedStepIds: { type: "array", items: { type: "string" } },
        reopenCheckpointIds: { type: "array", items: { type: "string" } },
        reopenStepIds: { type: "array", items: { type: "string" } },
        blockedCheckpointId: { type: "string" },
        blockedStepId: { type: "string" },
        blockedReason: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
        planMarkdown: { type: "string" },
        planOrigin: { type: "string" },
        checkpoints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              detail: { type: "string" },
              resumeHint: { type: "string" },
              doneWhen: { type: "array", items: { type: "string" } },
              evidenceWanted: { type: "array", items: { type: "string" } },
              state: { type: "string" }
            },
            additionalProperties: false
          }
        },
        newCheckpoints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              detail: { type: "string" },
              resumeHint: { type: "string" },
              doneWhen: { type: "array", items: { type: "string" } },
              evidenceWanted: { type: "array", items: { type: "string" } },
              state: { type: "string" }
            },
            additionalProperties: false
          }
        },
        insertAfterCheckpointId: { type: "string" },
        lifecycle: { type: "string" },
        status: { type: "string" },
        done: { type: "boolean" },
        pause: { type: "boolean" },
        cancel: { type: "boolean" },
        stopRequested: { type: "boolean" },
        stopAfterCurrentCheckpoint: { type: "boolean" },
        stopReason: { type: "string" },
        clearStopRequested: { type: "boolean" },
        clearBlockedReason: { type: "boolean" },
        completionSummary: { type: "string" },
        cancellationSummary: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "resume_durable_task",
    description:
      "Read a durable task packet, infer the current checkpoint cursor, and return a fresh continuation prompt after an interrupted run.",
    inputSchema: {
      type: "object",
      properties: {
        taskDir: { type: "string" },
        planPath: { type: "string" },
        currentCheckpointId: { type: "string" },
        currentStepId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "start_codex_managed_task",
    description:
      "Start a durable task plus Codex heartbeat scaffolding so the current thread can wake up and continue the task later.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        name: { type: "string" },
        outDir: { type: "string" },
        heartbeatMinutes: { type: "integer" },
        heartbeatName: { type: "string" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        constraints: { type: "array", items: { type: "string" } },
        contextNotes: { type: "array", items: { type: "string" } },
        planMarkdown: { type: "string" },
        planOrigin: { type: "string" },
        checkpoints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              detail: { type: "string" },
              resumeHint: { type: "string" },
              doneWhen: { type: "array", items: { type: "string" } },
              evidenceWanted: { type: "array", items: { type: "string" } },
              state: { type: "string" }
            },
            additionalProperties: false
          }
        },
        stopRequested: { type: "boolean" },
        stopAfterCurrentCheckpoint: { type: "boolean" },
        stopReason: { type: "string" }
      },
      required: ["goal"],
      additionalProperties: false
    }
  },
  {
    name: "checkpoint_codex_managed_task",
    description:
      "Checkpoint a Codex-managed task, refresh the heartbeat instructions, and return the automation action Codex should take next.",
    inputSchema: {
      type: "object",
      properties: {
        taskDir: { type: "string" },
        planPath: { type: "string" },
        summary: { type: "string" },
        currentCheckpointId: { type: "string" },
        currentStepId: { type: "string" },
        completedCheckpointIds: { type: "array", items: { type: "string" } },
        completedStepIds: { type: "array", items: { type: "string" } },
        reopenCheckpointIds: { type: "array", items: { type: "string" } },
        reopenStepIds: { type: "array", items: { type: "string" } },
        blockedCheckpointId: { type: "string" },
        blockedStepId: { type: "string" },
        blockedReason: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
        planMarkdown: { type: "string" },
        planOrigin: { type: "string" },
        checkpoints: { type: "array" },
        newCheckpoints: { type: "array" },
        newSteps: { type: "array" },
        insertAfterCheckpointId: { type: "string" },
        insertAfterStepId: { type: "string" },
        lifecycle: { type: "string" },
        status: { type: "string" },
        done: { type: "boolean" },
        pause: { type: "boolean" },
        cancel: { type: "boolean" },
        stopRequested: { type: "boolean" },
        stopAfterCurrentCheckpoint: { type: "boolean" },
        stopReason: { type: "string" },
        clearStopRequested: { type: "boolean" },
        clearBlockedReason: { type: "boolean" },
        completionSummary: { type: "string" },
        cancellationSummary: { type: "string" },
        heartbeatMinutes: { type: "integer" },
        heartbeatName: { type: "string" },
        automationId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "resume_codex_managed_task",
    description:
      "Resume a Codex-managed task and return the next continuation prompt plus heartbeat update or delete instructions.",
    inputSchema: {
      type: "object",
      properties: {
        taskDir: { type: "string" },
        planPath: { type: "string" },
        currentCheckpointId: { type: "string" },
        currentStepId: { type: "string" },
        heartbeatMinutes: { type: "integer" },
        heartbeatName: { type: "string" },
        automationId: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "bind_codex_heartbeat",
    description:
      "Store the Codex heartbeat automation id inside a managed task packet so future wake-ups can pause, update, or delete the heartbeat automatically.",
    inputSchema: {
      type: "object",
      properties: {
        taskDir: { type: "string" },
        planPath: { type: "string" },
        automationId: { type: "string" },
        heartbeatMinutes: { type: "integer" },
        heartbeatName: { type: "string" }
      },
      required: ["automationId"],
      additionalProperties: false
    }
  },
  {
    name: "start_claude_managed_task",
    description:
      "Start a durable task plus Claude Code autopilot scaffolding so Stop and prompt hooks can keep the task alive until its checkpoints are finished.",
    inputSchema: {
      type: "object",
      properties: {
        goal: { type: "string" },
        name: { type: "string" },
        outDir: { type: "string" },
        projectDir: { type: "string" },
        maxConsecutiveStopBlocks: { type: "integer" },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        constraints: { type: "array", items: { type: "string" } },
        contextNotes: { type: "array", items: { type: "string" } },
        planMarkdown: { type: "string" },
        planOrigin: { type: "string" },
        checkpoints: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              detail: { type: "string" },
              resumeHint: { type: "string" },
              doneWhen: { type: "array", items: { type: "string" } },
              evidenceWanted: { type: "array", items: { type: "string" } },
              state: { type: "string" }
            },
            additionalProperties: false
          }
        },
        stopRequested: { type: "boolean" },
        stopAfterCurrentCheckpoint: { type: "boolean" },
        stopReason: { type: "string" }
      },
      required: ["goal"],
      additionalProperties: false
    }
  },
  {
    name: "checkpoint_claude_managed_task",
    description:
      "Checkpoint a Claude-managed task, refresh its hook context, and return the stop decision Claude Code should enforce next.",
    inputSchema: {
      type: "object",
      properties: {
        taskDir: { type: "string" },
        planPath: { type: "string" },
        projectDir: { type: "string" },
        summary: { type: "string" },
        currentCheckpointId: { type: "string" },
        currentStepId: { type: "string" },
        completedCheckpointIds: { type: "array", items: { type: "string" } },
        completedStepIds: { type: "array", items: { type: "string" } },
        reopenCheckpointIds: { type: "array", items: { type: "string" } },
        reopenStepIds: { type: "array", items: { type: "string" } },
        blockedCheckpointId: { type: "string" },
        blockedStepId: { type: "string" },
        blockedReason: { type: "string" },
        artifacts: { type: "array", items: { type: "string" } },
        planMarkdown: { type: "string" },
        planOrigin: { type: "string" },
        checkpoints: { type: "array" },
        newCheckpoints: { type: "array" },
        newSteps: { type: "array" },
        insertAfterCheckpointId: { type: "string" },
        insertAfterStepId: { type: "string" },
        lifecycle: { type: "string" },
        status: { type: "string" },
        done: { type: "boolean" },
        pause: { type: "boolean" },
        cancel: { type: "boolean" },
        maxConsecutiveStopBlocks: { type: "integer" },
        stopRequested: { type: "boolean" },
        stopAfterCurrentCheckpoint: { type: "boolean" },
        stopReason: { type: "string" },
        clearStopRequested: { type: "boolean" },
        clearBlockedReason: { type: "boolean" },
        completionSummary: { type: "string" },
        cancellationSummary: { type: "string" }
      },
      additionalProperties: false
    }
  },
  {
    name: "resume_claude_managed_task",
    description:
      "Resume a Claude-managed task and return the next continuation prompt plus hook context for the current checkpoint.",
    inputSchema: {
      type: "object",
      properties: {
        taskDir: { type: "string" },
        planPath: { type: "string" },
        projectDir: { type: "string" },
        currentCheckpointId: { type: "string" },
        currentStepId: { type: "string" },
        maxConsecutiveStopBlocks: { type: "integer" }
      },
      additionalProperties: false
    }
  }
];

export function getToolCatalog() {
  return TOOL_CATALOG.map((tool) => ({ ...tool }));
}
