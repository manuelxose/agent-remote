import { strict as assert } from "node:assert";
import { test } from "node:test";
import { AllowlistedToolRegistry, DeveloperCapabilityError } from "../dist/packages/tools/src/index.js";
import { createRestrictedDeveloperCapabilities, WorkspacePolicy } from "../dist/packages/security/src/index.js";
import { ChatbotRuntime } from "../dist/runtime/chatbot/src/index.js";
import { DeveloperAgentRuntime } from "../dist/runtime/developer-agent/src/index.js";

const context = {
  message: { id: "m", conversationId: "c", channel: "web", senderId: "u", text: "hello", receivedAt: new Date(0) },
  conversation: { id: "c", channel: "web", participantIds: ["u"], metadata: {} },
  route: { id: "chat", runtime: "chatbot" as const, agent: "talkaris" },
  execution: { correlationId: "x", conversationId: "c" }
};

test("chatbot runtime invokes only an allowlisted tool", async () => {
  const tools = new AllowlistedToolRegistry({ echo: async input => input });
  const runtime = new ChatbotRuntime(tools);
  const agent = { id: "talkaris", type: "chatbot" as const, async handleMessage() { return { text: "safe" }; } };

  assert.deepEqual(await runtime.invokeTool("echo", "input"), "input");
  assert.deepEqual(await runtime.execute(context, agent), { text: "safe" });
});

test("chatbot runtime rejects developer capability tools", () => {
  assert.throws(
    () => new ChatbotRuntime(new AllowlistedToolRegistry({ shell: async () => "unsafe" })),
    DeveloperCapabilityError
  );
});

test("developer capabilities are restricted to approved workspace roots", () => {
  const policy = new WorkspacePolicy(["/approved/workspace"]);
  assert.equal(policy.assertPath("/approved/workspace/src/file.ts"), "/approved/workspace/src/file.ts");
  assert.throws(() => policy.assertPath("/other/file.ts"), /outside approved workspace roots/);
});

test("restricted developer capability wrappers validate every workspace operation", async () => {
  const calls: string[] = [];
  const capabilities = createRestrictedDeveloperCapabilities(["/approved/workspace"], {
    shell: async (_command, cwd) => { calls.push(`shell:${cwd}`); return "ok"; },
    readFile: async path => { calls.push(`read:${path}`); return "content"; },
    writeFile: async path => { calls.push(`write:${path}`); },
    git: async (_args, cwd) => { calls.push(`git:${cwd}`); return "clean"; }
  });

  await capabilities.shell("pwd", "/approved/workspace");
  await capabilities.readFile("/approved/workspace/file");
  await capabilities.writeFile("/approved/workspace/file", "content");
  await capabilities.git([], "/approved/workspace");
  assert.throws(() => capabilities.shell("pwd", "/outside"), /outside approved workspace roots/);
  assert.throws(() => capabilities.readFile("/outside/file"), /outside approved workspace roots/);
  assert.equal(calls.length, 4);
});

test("developer runtime accepts explicit local capabilities", async () => {
  const capabilities = {
    policy: new WorkspacePolicy(["/approved/workspace"]),
    shell: async () => "ok",
    readFile: async () => "content",
    writeFile: async () => undefined,
    git: async () => "clean"
  };
  const runtime = new DeveloperAgentRuntime(capabilities);
  const agent = { id: "claude", type: "developer-agent" as const, async handleMessage() { return { text: "ran" }; } };

  assert.equal((await runtime.execute({ ...context, route: { ...context.route, runtime: "developer-agent", agent: "claude" } }, agent)).text, "ran");
  assert.equal(await capabilities.shell("pwd"), "ok");
});
