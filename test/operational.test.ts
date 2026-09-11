import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { createApplication, formatWorkspaceCommand, loadApplicationConfig, loadRoutes, resolveWhatsAppRole } from "../dist/apps/gateway/src/application.js";
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

test("application control-plane state survives restart without reinitialization", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-restart-"));
  const routesPath = join(directory, "routes.json");
  const controlPlanePath = join(directory, "control-plane.json");
  await writeFile(routesPath, JSON.stringify({}));
  const env = {
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_CONTROL_PLANE_PATH: controlPlanePath,
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  };
  const first = createApplication(loadApplicationConfig(env, process.cwd()));
  const message = (id: string, text: string) => ({ id, channel: "whatsapp", conversationId: "chat", senderId: "owner@s.whatsapp.net", text, receivedAt: new Date() });
  await first.controlPlane.handle(message("init", "/init backend-api"), { id: "owner@s.whatsapp.net", role: "owner" });
  await first.controlPlane.handle(message("claude", "/claude"), { id: "owner@s.whatsapp.net", role: "owner" });
  await first.stop();
  const second = createApplication(loadApplicationConfig(env, process.cwd()));
  const status = await second.controlPlane.handle(message("status", "/status"), { id: "owner@s.whatsapp.net", role: "owner" });
  assert.match(status.text, /backend-api/);
  assert.match((await second.controlPlane.handle(message("agent", "/agent"), { id: "owner@s.whatsapp.net", role: "owner" })).text, /claude/);
  await second.stop();
});

test("requires approved workspace roots before composing the gateway", () => {
  assert.throws(() => loadApplicationConfig({
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd()), /AGENT_REMOTE_WORKSPACE_ROOTS/);
});

test("one-number self identities receive owner role when self-messages are enabled", () => {
  assert.equal(resolveWhatsAppRole({ WHATSAPP_ALLOW_SELF_MESSAGES: "true", WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net" }, "owner@lid"), "owner");
});

test("rejects a default workspace outside approved roots", () => {
  assert.throws(() => loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_DEFAULT_WORKSPACE: "/tmp",
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd()), /approved workspace roots/i);
});

test("loads workspace aliases only when they are approved", () => {
  const config = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_WORKSPACE_ALIASES: JSON.stringify({ repo: "." }),
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  assert.equal(config.workspaceAliases.repo, process.cwd());
});

test("loads configurable provider model aliases", () => {
  const config = loadApplicationConfig({
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_CODEX_MODELS: JSON.stringify({ fast: "codex-mini-latest", quality: "gpt-5.6-luna" }),
    WHATSAPP_AUTH_PATH: "/tmp/agent-remote-auth",
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  assert.deepEqual(config.codexModels, { fast: "codex-mini-latest", quality: "gpt-5.6-luna" });
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

test("doctor reports malformed control-plane state as a failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-doctor-state-"));
  const routesPath = join(directory, "routes.json");
  const controlPlanePath = join(directory, "control-plane.json");
  await writeFile(routesPath, JSON.stringify({}));
  await writeFile(controlPlanePath, "{broken", "utf8");
  const config = loadApplicationConfig({
    AGENT_REMOTE_ROUTES_PATH: routesPath,
    AGENT_REMOTE_WORKSPACE_ROOTS: process.cwd(),
    AGENT_REMOTE_CONTROL_PLANE_PATH: controlPlanePath,
    WHATSAPP_AUTH_PATH: join(directory, "auth"),
    WHATSAPP_ALLOWED_USERS: "owner@s.whatsapp.net"
  }, process.cwd());
  const report = await runDoctor(config, { resolveExecutable: async () => undefined, readVersion: async () => "" });
  assert.equal(report.find(check => check.name === "Persistence")?.status, "FAIL");
  assert.match(report.find(check => check.name === "Persistence")?.message ?? "", /Malformed/);
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

test("prevents a second local gateway from using the WhatsApp session", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-remote-lock-"));
  const lockPath = join(directory, "gateway.lock");
  const release = await acquireProcessLock(lockPath, process.pid);
  await assert.rejects(() => acquireProcessLock(lockPath, process.pid + 1), /already running/);
  await release();
  const releaseAgain = await acquireProcessLock(lockPath, process.pid + 1);
  await releaseAgain();
});
