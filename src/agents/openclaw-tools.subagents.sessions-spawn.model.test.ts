import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "./defaults.js";
import "./test-helpers/fast-core-tools.js";
import {
  getCallGatewayMock,
  getSessionsSpawnTool,
  resetSessionsSpawnConfigOverride,
  setSessionsSpawnConfigOverride,
} from "./openclaw-tools.subagents.sessions-spawn.test-harness.js";
import { resetSubagentRegistryForTests } from "./subagent-registry.js";
import { SUBAGENT_SPAWN_ACCEPTED_NOTE } from "./subagent-spawn.js";

const callGatewayMock = getCallGatewayMock();
type GatewayCall = { method?: string; params?: unknown };
type SessionsSpawnConfigOverride = Parameters<typeof setSessionsSpawnConfigOverride>[0];

function mockLongRunningSpawnFlow(params: {
  calls: GatewayCall[];
  acceptedAtBase: number;
  patch?: (request: GatewayCall) => Promise<unknown>;
}) {
  let agentCallCount = 0;
  callGatewayMock.mockImplementation(async (opts: unknown) => {
    const request = opts as GatewayCall;
    params.calls.push(request);
    if (request.method === "sessions.patch") {
      if (params.patch) {
        return await params.patch(request);
      }
      return { ok: true };
    }
    if (request.method === "agent") {
      agentCallCount += 1;
      return {
        runId: `run-${agentCallCount}`,
        status: "accepted",
        acceptedAt: params.acceptedAtBase + agentCallCount,
      };
    }
    if (request.method === "agent.wait") {
      return { status: "timeout" };
    }
    if (request.method === "sessions.delete") {
      return { ok: true };
    }
    return {};
  });
}

function mockPatchAndSingleAgentRun(params: { calls: GatewayCall[]; runId: string }) {
  callGatewayMock.mockImplementation(async (opts: unknown) => {
    const request = opts as GatewayCall;
    params.calls.push(request);
    if (request.method === "sessions.patch") {
      return { ok: true };
    }
    if (request.method === "agent") {
      return { runId: params.runId, status: "accepted" };
    }
    return {};
  });
}

async function expectSpawnUsesConfiguredModel(params: {
  config?: SessionsSpawnConfigOverride;
  runId: string;
  callId: string;
  expectedModel: string;
  complexity?: "simple" | "medium" | "complex";
}) {
  if (params.config) {
    setSessionsSpawnConfigOverride(params.config);
  } else {
    resetSessionsSpawnConfigOverride();
  }
  const calls: GatewayCall[] = [];
  mockPatchAndSingleAgentRun({ calls, runId: params.runId });

  const tool = await getSessionsSpawnTool({
    agentSessionKey: "agent:research:main",
    agentChannel: "discord",
  });

  const result = await tool.execute(params.callId, {
    task: "do thing",
    ...(params.complexity ? { complexity: params.complexity } : {}),
  });
  expect(result.details).toMatchObject({
    status: "accepted",
    modelApplied: true,
  });

  const patchCall = calls.find(
    (call) => call.method === "sessions.patch" && (call.params as { model?: string })?.model,
  );
  expect(patchCall?.params).toMatchObject({
    model: params.expectedModel,
  });
}

describe("openclaw-tools: subagents (sessions_spawn model + thinking)", () => {
  beforeEach(() => {
    resetSessionsSpawnConfigOverride();
    resetSubagentRegistryForTests();
    callGatewayMock.mockClear();
  });

  it("sessions_spawn applies a model to the child session", async () => {
    const calls: GatewayCall[] = [];
    mockLongRunningSpawnFlow({ calls, acceptedAtBase: 3000 });

    const tool = await getSessionsSpawnTool({
      agentSessionKey: "discord:group:req",
      agentChannel: "discord",
    });

    const result = await tool.execute("call3", {
      task: "do thing",
      runTimeoutSeconds: 1,
      model: "claude-haiku-4-5",
      cleanup: "keep",
    });
    expect(result.details).toMatchObject({
      status: "accepted",
      note: SUBAGENT_SPAWN_ACCEPTED_NOTE,
      modelApplied: true,
    });

    const patchIndex = calls.findIndex((call) => call.method === "sessions.patch");
    const agentIndex = calls.findIndex((call) => call.method === "agent");
    expect(patchIndex).toBeGreaterThan(-1);
    expect(agentIndex).toBeGreaterThan(-1);
    expect(patchIndex).toBeLessThan(agentIndex);
    const patchCalls = calls.filter((call) => call.method === "sessions.patch");
    expect(patchCalls[0]?.params).toMatchObject({
      key: expect.stringContaining("subagent:"),
      model: "claude-haiku-4-5",
      spawnDepth: 1,
    });
  });

  it("sessions_spawn forwards thinking overrides to the agent run", async () => {
    const calls: Array<{ method?: string; params?: unknown }> = [];

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      calls.push(request);
      if (request.method === "agent") {
        return { runId: "run-thinking", status: "accepted" };
      }
      return {};
    });

    const tool = await getSessionsSpawnTool({
      agentSessionKey: "discord:group:req",
      agentChannel: "discord",
    });

    const result = await tool.execute("call-thinking", {
      task: "do thing",
      thinking: "high",
    });
    expect(result.details).toMatchObject({
      status: "accepted",
    });

    const agentCall = calls.find((call) => call.method === "agent");
    expect(agentCall?.params).toMatchObject({
      thinking: "high",
    });
  });

  it("sessions_spawn rejects invalid thinking levels", async () => {
    const calls: Array<{ method?: string }> = [];

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      calls.push(request);
      return {};
    });

    const tool = await getSessionsSpawnTool({
      agentSessionKey: "discord:group:req",
      agentChannel: "discord",
    });

    const result = await tool.execute("call-thinking-invalid", {
      task: "do thing",
      thinking: "banana",
    });
    expect(result.details).toMatchObject({
      status: "error",
    });
    const errorDetails = result.details as { error?: unknown };
    expect(String(errorDetails.error)).toMatch(/Invalid thinking level/i);
    expect(calls).toHaveLength(0);
  });

  it("sessions_spawn applies default subagent model from defaults config", async () => {
    await expectSpawnUsesConfiguredModel({
      config: {
        session: { mainKey: "main", scope: "per-sender" },
        agents: { defaults: { subagents: { model: "minimax/MiniMax-M2.7" } } },
      },
      runId: "run-default-model",
      callId: "call-default-model",
      expectedModel: "minimax/MiniMax-M2.7",
    });
  });

  it("sessions_spawn falls back to runtime default model when no model config is set", async () => {
    await expectSpawnUsesConfiguredModel({
      runId: "run-runtime-default-model",
      callId: "call-runtime-default-model",
      expectedModel: `${DEFAULT_PROVIDER}/${DEFAULT_MODEL}`,
    });
  });

  it("sessions_spawn prefers per-agent subagent model over defaults", async () => {
    await expectSpawnUsesConfiguredModel({
      config: {
        session: { mainKey: "main", scope: "per-sender" },
        agents: {
          defaults: { subagents: { model: "minimax/MiniMax-M2.7" } },
          list: [{ id: "research", subagents: { model: "opencode/claude" } }],
        },
      },
      runId: "run-agent-model",
      callId: "call-agent-model",
      expectedModel: "opencode/claude",
    });
  });

  it("sessions_spawn prefers target agent primary model over global default", async () => {
    await expectSpawnUsesConfiguredModel({
      config: {
        session: { mainKey: "main", scope: "per-sender" },
        agents: {
          defaults: { model: { primary: "minimax/MiniMax-M2.7" } },
          list: [{ id: "research", model: { primary: "opencode/claude" } }],
        },
      },
      runId: "run-agent-primary-model",
      callId: "call-agent-primary-model",
      expectedModel: "opencode/claude",
    });
  });

  it("sessions_spawn fails when model patch is rejected", async () => {
    const calls: GatewayCall[] = [];
    mockLongRunningSpawnFlow({
      calls,
      acceptedAtBase: 4000,
      patch: async (request) => {
        const model = (request.params as { model?: unknown } | undefined)?.model;
        if (model === "bad-model") {
          throw new Error("invalid model: bad-model");
        }
        return { ok: true };
      },
    });

    const tool = await getSessionsSpawnTool({
      agentSessionKey: "main",
      agentChannel: "whatsapp",
    });

    const result = await tool.execute("call4", {
      task: "do thing",
      runTimeoutSeconds: 1,
      model: "bad-model",
    });
    expect(result.details).toMatchObject({
      status: "error",
    });
    expect(String((result.details as { error?: string }).error ?? "")).toContain("invalid model");
    expect(calls.some((call) => call.method === "agent")).toBe(false);
  });

  it("sessions_spawn supports legacy timeoutSeconds alias", async () => {
    let spawnedTimeout: number | undefined;

    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string; params?: unknown };
      if (request.method === "agent") {
        const params = request.params as { timeout?: number } | undefined;
        spawnedTimeout = params?.timeout;
        return { runId: "run-1", status: "accepted", acceptedAt: 1000 };
      }
      return {};
    });

    const tool = await getSessionsSpawnTool({
      agentSessionKey: "main",
      agentChannel: "whatsapp",
    });

    const result = await tool.execute("call5", {
      task: "do thing",
      timeoutSeconds: 2,
    });
    expect(result.details).toMatchObject({
      status: "accepted",
      runId: "run-1",
    });
    expect(spawnedTimeout).toBe(2);
  });

  it("sessions_spawn uses simple-tier model when complexity=simple is set", async () => {
    await expectSpawnUsesConfiguredModel({
      config: {
        session: { mainKey: "main", scope: "per-sender" },
        agents: {
          defaults: {
            subagents: {
              models: {
                simple: "anthropic/claude-haiku-3-5",
                medium: "anthropic/claude-sonnet-4-5",
                complex: "anthropic/claude-opus-4-6",
              },
            },
          },
        },
      },
      runId: "run-complexity-simple",
      callId: "call-complexity-simple",
      expectedModel: "anthropic/claude-haiku-3-5",
      complexity: "simple",
    });
  });

  it("sessions_spawn uses medium-tier model when complexity=medium is set", async () => {
    await expectSpawnUsesConfiguredModel({
      config: {
        session: { mainKey: "main", scope: "per-sender" },
        agents: {
          defaults: {
            subagents: {
              models: {
                simple: "anthropic/claude-haiku-3-5",
                medium: "anthropic/claude-sonnet-4-5",
                complex: "anthropic/claude-opus-4-6",
              },
            },
          },
        },
      },
      runId: "run-complexity-medium",
      callId: "call-complexity-medium",
      expectedModel: "anthropic/claude-sonnet-4-5",
      complexity: "medium",
    });
  });

  it("sessions_spawn uses complex-tier model when complexity=complex is set", async () => {
    await expectSpawnUsesConfiguredModel({
      config: {
        session: { mainKey: "main", scope: "per-sender" },
        agents: {
          defaults: {
            subagents: {
              models: {
                simple: "anthropic/claude-haiku-3-5",
                medium: "anthropic/claude-sonnet-4-5",
                complex: "anthropic/claude-opus-4-6",
              },
            },
          },
        },
      },
      runId: "run-complexity-complex",
      callId: "call-complexity-complex",
      expectedModel: "anthropic/claude-opus-4-6",
      complexity: "complex",
    });
  });

  it("sessions_spawn explicit model overrides complexity hint", async () => {
    const calls: GatewayCall[] = [];
    mockPatchAndSingleAgentRun({ calls, runId: "run-explicit-override" });
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            models: {
              simple: "anthropic/claude-haiku-3-5",
              complex: "anthropic/claude-opus-4-6",
            },
          },
        },
      },
    });

    const tool = await getSessionsSpawnTool({
      agentSessionKey: "agent:research:main",
      agentChannel: "discord",
    });

    const result = await tool.execute("call-explicit-override", {
      task: "do thing",
      model: "openai/gpt-5.4",
      complexity: "simple",
    });
    expect(result.details).toMatchObject({
      status: "accepted",
      modelApplied: true,
    });

    const patchCall = calls.find(
      (call) => call.method === "sessions.patch" && (call.params as { model?: string })?.model,
    );
    // explicit model wins over the simple-tier model
    expect(patchCall?.params).toMatchObject({ model: "openai/gpt-5.4" });
  });

  it("sessions_spawn per-agent complexity model overrides defaults complexity model", async () => {
    const calls: GatewayCall[] = [];
    mockPatchAndSingleAgentRun({ calls, runId: "run-per-agent-complexity" });
    setSessionsSpawnConfigOverride({
      session: { mainKey: "main", scope: "per-sender" },
      agents: {
        defaults: {
          subagents: {
            models: { medium: "anthropic/claude-sonnet-4-5" },
          },
        },
        list: [
          {
            id: "research",
            subagents: {
              models: { medium: "opencode/claude" },
            },
          },
        ],
      },
    });

    const tool = await getSessionsSpawnTool({
      agentSessionKey: "agent:research:main",
      agentChannel: "discord",
    });

    await tool.execute("call-per-agent-complexity", { task: "do thing", complexity: "medium" });

    const patchCall = calls.find(
      (call) => call.method === "sessions.patch" && (call.params as { model?: string })?.model,
    );
    expect(patchCall?.params).toMatchObject({ model: "opencode/claude" });
  });

  it("sessions_spawn falls back to subagents.model when complexity tier is not configured", async () => {
    await expectSpawnUsesConfiguredModel({
      config: {
        session: { mainKey: "main", scope: "per-sender" },
        agents: {
          defaults: {
            subagents: {
              model: "minimax/MiniMax-M2.5",
              // no models.simple tier configured
            },
          },
        },
      },
      runId: "run-complexity-fallback",
      callId: "call-complexity-fallback",
      expectedModel: "minimax/MiniMax-M2.5",
      complexity: "simple",
    });
  });
});
