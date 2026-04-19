import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  bindCodexHeartbeat,
  checkpointClaudeManagedTask,
  checkpointCodexManagedTask,
  checkpointDurableTask,
  getToolCatalog,
  resumeClaudeManagedTask,
  resumeCodexManagedTask,
  resumeDurableTask,
  startClaudeManagedTask,
  startCodexManagedTask,
  startDurableTask,
} from "../index.js";

const SERVER_INFO = {
  name: "see-it-through",
  version: "0.1.0",
};

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export async function startMcpServer() {
  const transport = new JsonRpcStdioTransport();
  transport.onMessage(async (message) => {
    if (!message || typeof message !== "object") {
      return;
    }

    try {
      await handleMessage(transport, message);
    } catch (error) {
      if (message.id !== undefined) {
        transport.sendError(message.id, -32000, error instanceof Error ? error.message : String(error));
      }
    }
  });
  transport.start();
}

async function handleMessage(transport, message) {
  switch (message.method) {
    case "initialize":
      transport.sendResult(message.id, {
        protocolVersion: message.params?.protocolVersion || "2024-11-05",
        capabilities: {
          tools: {},
        },
        serverInfo: SERVER_INFO,
      });
      return;
    case "notifications/initialized":
      return;
    case "ping":
      transport.sendResult(message.id, {});
      return;
    case "tools/list":
      transport.sendResult(message.id, {
        tools: getToolCatalog().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
      return;
    case "tools/call": {
      const result = await runTool(message.params?.name, message.params?.arguments || {});
      transport.sendResult(message.id, {
        content: [
          {
            type: "text",
            text: result.summary,
          },
        ],
        structuredContent: result.data,
      });
      return;
    }
    default:
      if (message.id !== undefined) {
        transport.sendError(message.id, -32601, `Method not found: ${message.method}`);
      }
  }
}

async function runTool(name, args) {
  switch (name) {
    case "start_durable_task": {
      const result = await startDurableTask(args, args.outDir ? resolveOutput(args.outDir) : undefined);
      return {
        summary: `Started durable task at ${result.taskDir}`,
        data: result,
      };
    }
    case "checkpoint_durable_task": {
      const result = await checkpointDurableTask(withResolvedTaskPaths(args));
      return {
        summary: `Durable task is ${result.task.lifecycle}${result.currentCheckpoint ? ` on ${result.currentCheckpoint.id}` : ""}`,
        data: result,
      };
    }
    case "resume_durable_task": {
      const result = await resumeDurableTask(withResolvedTaskPaths(args));
      return {
        summary: `Resumed durable task at ${result.taskDir}`,
        data: result,
      };
    }
    case "start_codex_managed_task": {
      const result = await startCodexManagedTask(args, args.outDir ? resolveOutput(args.outDir) : undefined);
      return {
        summary: `Started Codex managed task at ${result.taskDir}`,
        data: result,
      };
    }
    case "checkpoint_codex_managed_task": {
      const result = await checkpointCodexManagedTask(withResolvedTaskPaths(args));
      return {
        summary: `Codex managed task is ${result.task.lifecycle}${result.currentCheckpoint ? ` on ${result.currentCheckpoint.id}` : ""}`,
        data: result,
      };
    }
    case "resume_codex_managed_task": {
      const result = await resumeCodexManagedTask(withResolvedTaskPaths(args));
      return {
        summary: `Resumed Codex managed task at ${result.taskDir}`,
        data: result,
      };
    }
    case "bind_codex_heartbeat": {
      const result = await bindCodexHeartbeat(withResolvedTaskPaths(args));
      return {
        summary: `Bound Codex heartbeat ${args.automationId} to ${result.taskDir}`,
        data: result,
      };
    }
    case "start_claude_managed_task": {
      const result = await startClaudeManagedTask(
        {
          ...args,
          projectDir: args.projectDir ? resolvePath(args.projectDir) : undefined,
        },
        args.outDir ? resolveOutput(args.outDir) : undefined,
      );
      return {
        summary: `Started Claude managed task at ${result.taskDir}`,
        data: result,
      };
    }
    case "checkpoint_claude_managed_task": {
      const result = await checkpointClaudeManagedTask(withResolvedTaskPaths(args));
      return {
        summary: `Claude managed task is ${result.task.lifecycle}${result.currentCheckpoint ? ` on ${result.currentCheckpoint.id}` : ""}`,
        data: result,
      };
    }
    case "resume_claude_managed_task": {
      const result = await resumeClaudeManagedTask(withResolvedTaskPaths(args));
      return {
        summary: `Resumed Claude managed task at ${result.taskDir}`,
        data: result,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function withResolvedTaskPaths(args) {
  return {
    ...args,
    taskDir: args.taskDir ? resolvePath(args.taskDir) : undefined,
    planPath: args.planPath ? resolvePath(args.planPath) : undefined,
    projectDir: args.projectDir ? resolvePath(args.projectDir) : undefined,
  };
}

function resolveOutput(path) {
  return resolve(path || PROJECT_ROOT, ".");
}

function resolvePath(path) {
  if (!path) {
    throw new Error("Missing required path argument");
  }
  return resolve(path);
}

class JsonRpcStdioTransport {
  constructor() {
    this.buffer = Buffer.alloc(0);
    this.listener = null;
  }

  onMessage(listener) {
    this.listener = listener;
  }

  start() {
    process.stdin.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.flush();
    });
    process.stdin.resume();
  }

  flush() {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        return;
      }

      const header = this.buffer.slice(0, headerEnd).toString("utf8");
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        throw new Error("Missing Content-Length header");
      }

      const contentLength = Number(match[1]);
      const messageStart = headerEnd + 4;
      if (this.buffer.length < messageStart + contentLength) {
        return;
      }

      const payload = this.buffer.slice(messageStart, messageStart + contentLength).toString("utf8");
      this.buffer = this.buffer.slice(messageStart + contentLength);
      const message = JSON.parse(payload);
      if (this.listener) {
        void this.listener(message);
      }
    }
  }

  send(message) {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    process.stdout.write(`Content-Length: ${payload.length}\r\n\r\n`);
    process.stdout.write(payload);
  }

  sendResult(id, result) {
    this.send({
      jsonrpc: "2.0",
      id,
      result,
    });
  }

  sendError(id, code, message) {
    this.send({
      jsonrpc: "2.0",
      id,
      error: {
        code,
        message,
      },
    });
  }
}
