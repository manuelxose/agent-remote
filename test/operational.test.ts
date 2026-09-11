import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createApplication, formatWorkspaceCommand, loadApplicationConfig, loadRoutes, oneNumberCommandAction, parseOneNumberCommand } from "../dist/apps/gateway/src/application.js";
import { formatOperationalError, runDoctor } from "../dist/apps/gateway/src/doctor.js";
import { RouteNotFoundError } from "../dist/packages/routing/src/index.js";
import { acquireProcessLock } from "../dist/apps/gateway/src/lock.js";

test("loads routes and composes the existing developer-agent graph", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-operational-"));
  const routesPath = join(directory, "routes.json");
  await writeFile(routesPath, JSON.stringify({
    "whatsapp-chat": {
      id: "whatsapp-chat",
      runtime: "developer-agent",
      agent: "codex",
      workspaceRoot: process.cwd()
    }
  }));

  const routes = loadRoutes(routesPath);
  const config = loadApplicationConfig({
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  const application = createApplication({ ...config, routes });

  assert.equal(application.channel.id, "whatsapp");
  assert.equal(application.routes["whatsapp-chat"].agent, "codex");
  assert.deepEqual(await application.runtime.getAvailability("codex"), await application.runtime.getAvailability("codex"));
  await application.stop();
});

test("requires approved workspace roots before composing the gateway", () => {
  assert.throws(() => loadApplicationConfig({
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd()), /AGENT_REMOTE_WORKSPACE_ROOTS/);
});

test("doctor reports unavailable providers instead of passing them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-doctor-"));
  const routesPath = join(directory, "routes.json");
  await writeFile(routesPath, JSON.stringify({
    "whatsapp-chat": { id: "whatsapp-chat", runtime: "developer-agent", agent: "codex", workspaceRoot: process.cwd() }
  }));
  const config = loadApplicationConfig({
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());

  const report = await runDoctor(config, {
    resolveExecutable: async () => undefined,
    readVersion: async () => "unavailable"
  });

  assert.equal(report.find(check => check.name === "Claude CLI")?.status, "FAIL");
  assert.equal(report.find(check => check.name === "Codex CLI")?.status, "FAIL");
  assert.match(report.find(check => check.name === "Routes")?.message ?? "", /1 route/);
});

test("formats unknown conversations without leaking runtime diagnostics", () => {
  const error = new RouteNotFoundError("whatsapp", "120363-test@g.us");
  const message = formatOperationalError(error, "120363-test@g.us");
  assert.match(message, /120363-test@g.us/);
  assert.doesNotMatch(message, /stack|stderr|password/i);
});

test("workspace command reports the route workspace or the configured default", () => {
  const routes = {
    "whatsapp-known": {
      id: "known",
      runtime: "developer-agent" as const,
      agent: "codex",
      workspaceRoot: "/workspace/specific"
    }
  };
  assert.equal(formatWorkspaceCommand("known-chat", routes, "/workspace/default"), "/workspace/default");
  assert.equal(formatWorkspaceCommand("known", routes, "/workspace/default"), "/workspace/specific");
});

test("parses one-number initialization and agent commands", () => {
  assert.deepEqual(parseOneNumberCommand("/init"), { kind: "init" });
  assert.deepEqual(parseOneNumberCommand("/claude revisa el proyecto"), { kind: "agent", agent: "claude", prompt: "revisa el proyecto" });
  assert.deepEqual(parseOneNumberCommand("/CODEX ejecuta npm test"), { kind: "agent", agent: "codex", prompt: "ejecuta npm test" });
  assert.equal(parseOneNumberCommand("hola"), undefined);
});

test("scopes one-number commands to initialized conversations", () => {
  const initialized = new Set(["self-chat"]);
  assert.equal(oneNumberCommandAction("other-chat", "/claude hello", initialized), "ignore");
  assert.equal(oneNumberCommandAction("self-chat", "/claude hello", initialized), "agent");
  assert.equal(oneNumberCommandAction("self-chat", "/workspace", initialized), "workspace");
  assert.equal(oneNumberCommandAction("self-chat", "/claude", initialized), "usage");
  assert.equal(oneNumberCommandAction("other-chat", "/init", initialized), "initialize");
  assert.equal(oneNumberCommandAction("self-chat", "ordinary text", initialized), "ignore");
});

test("prevents a second local gateway from using the WhatsApp session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-lock-"));
  const lockPath = join(directory, "gateway.lock");
  const release = await acquireProcessLock(lockPath, process.pid);
  await assert.rejects(() => acquireProcessLock(lockPath, process.pid + 1), /already running/);
  await release();
  const releaseAgain = await acquireProcessLock(lockPath, process.pid + 1);
  await releaseAgain();
});
