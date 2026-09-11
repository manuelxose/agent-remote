import { access, constants, stat } from "node:fs/promises";
import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { parseWhatsAppConfig } from "../../../channels/whatsapp/src/config.js";
import { resolveDeveloperExecutable } from "../../../runtime/developer-agent/src/process.js";
import { WorkspacePolicy } from "../../../packages/security/src/index.js";
import { ControlPlaneStateError, JsonControlPlaneStore } from "../../../packages/control-plane/src/index.js";
import type { ApplicationConfig } from "./application.js";

const execFile = promisify(nodeExecFile);

export type DoctorStatus = "PASS" | "WARN" | "FAIL";
export interface DoctorCheck { name: string; status: DoctorStatus; message: string; }
export interface DoctorDependencies {
  resolveExecutable(name: string, configuredExecutable?: string): Promise<string | undefined>;
  readVersion(executable: string): Promise<string>;
}

export async function runDoctor(config: ApplicationConfig, dependencies: DoctorDependencies = defaults()): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  checks.push({ name: "Gateway", status: "PASS", message: "composition is available" });
  try { parseWhatsAppConfig(config.env); checks.push({ name: "Configuration", status: "PASS", message: "environment is valid" }); }
  catch (error) { checks.push({ name: "Configuration", status: "FAIL", message: messageOf(error) }); }
  checks.push({ name: "WhatsApp", status: config.env.WHATSAPP_AUTH_PATH ? "PASS" : "FAIL", message: config.env.WHATSAPP_AUTH_PATH ? "configuration is present" : "WHATSAPP_AUTH_PATH is required" });
  const routeCount = Object.keys(config.routes).length;
  checks.push({ name: "Routes", status: routeCount > 0 ? "PASS" : "FAIL", message: `${routeCount} route${routeCount === 1 ? "" : "s"} loaded from ${config.routesPath}` });
  checks.push(await pathCheck("WhatsApp auth", config.env.WHATSAPP_AUTH_PATH, true));
  try {
    const policy = new WorkspacePolicy(config.workspaceRoots);
    config.workspaceRoots.forEach(root => policy.assertPath(root));
    checks.push({ name: "Workspace roots", status: "PASS", message: `${config.workspaceRoots.length} approved root${config.workspaceRoots.length === 1 ? "" : "s"}` });
  } catch (error) { checks.push({ name: "Workspace roots", status: "FAIL", message: messageOf(error) }); }
  checks.push(await controlPlaneStateCheck(config.controlPlanePath));
  checks.push(await pathCheck("Conversation store", config.controlPlanePath, true));
  checks.push(await pathCheck("Session store", config.sessionPath, true));
  checks.push({ name: "Graphify", status: await exists(join(config.cwd, "graphify-out", "graph.json")) ? "PASS" : "WARN", message: "graphify-out/graph.json" });
  for (const [label, executable] of [["Claude CLI", "claude"], ["Codex CLI", "codex"], ["Copilot CLI", "copilot"]] as const) {
    const path = await dependencies.resolveExecutable(executable, config.env[`AGENT_REMOTE_${executable.toUpperCase()}_EXECUTABLE`]);
    if (!path) checks.push({ name: label, status: "FAIL", message: `Executable '${executable}' not found in PATH` });
    else {
      try {
        checks.push({ name: label, status: "PASS", message: `${path} (${(await dependencies.readVersion(path)).trim() || "version unavailable"})` });
      } catch (error) {
        checks.push({ name: label, status: "WARN", message: `${path} found, but --version failed: ${messageOf(error)}` });
      }
    }
    if (executable === "claude" || executable === "codex") {
      const model = config.env[`AGENT_REMOTE_${executable.toUpperCase()}_MODEL`]?.trim();
      checks.push({ name: `${label.replace(" CLI", "")} configured model`, status: model ? "PASS" : "FAIL", message: model ? `${executable} model is configured` : `AGENT_REMOTE_${executable.toUpperCase()}_MODEL is required` });
    }
  }
  return checks;
}

export function formatOperationalError(error: unknown, conversationId: string): string {
  if (error instanceof Error && error.name === "RouteNotFoundError") {
    return `Unknown authorized conversation.\nConversation ID: ${conversationId}\nAdd whatsapp-${conversationId} to the route configuration.`;
  }
  return "🔴 Agent request failed\nReason: the request could not be completed. Check the application logs.";
}

function defaults(): DoctorDependencies {
  return {
    resolveExecutable: resolveDeveloperExecutable,
    readVersion: async executable => (await execFile(executable, ["--version"])).stdout
  };
}

async function pathCheck(name: string, path: string | undefined, createOnStart: boolean): Promise<DoctorCheck> {
  if (!path) return { name, status: "FAIL", message: "path is not configured" };
  try { await access(path, constants.R_OK | constants.W_OK); return { name, status: "PASS", message: path }; }
  catch (error) {
    if (createOnStart && (error as NodeJS.ErrnoException).code === "ENOENT") return { name, status: "WARN", message: `${path} will be created on first start` };
    return { name, status: "FAIL", message: `${path}: ${messageOf(error)}` };
  }
}

async function controlPlaneStateCheck(path: string): Promise<DoctorCheck> {
  try {
    await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { name: "Persistence", status: "WARN", message: `${path} will be created on first start` };
    return { name: "Persistence", status: "FAIL", message: `${path}: ${messageOf(error)}` };
  }
  try {
    await new JsonControlPlaneStore(path).load();
    return { name: "Persistence", status: "PASS", message: path };
  } catch (error) {
    if (error instanceof ControlPlaneStateError) return { name: "Persistence", status: "FAIL", message: error.message };
    return { name: "Persistence", status: "FAIL", message: `${path}: ${messageOf(error)}` };
  }
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch { return false; }
}

function messageOf(error: unknown): string { return error instanceof Error ? error.message : String(error); }
