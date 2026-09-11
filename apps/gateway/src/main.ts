import { createApplication, loadApplicationConfig, loadEnvironment } from "./application.js";
import { runDoctor } from "./doctor.js";
import { acquireProcessLock } from "./lock.js";
import { resolve } from "node:path";

const env = loadEnvironment();

if (process.argv[2] === "doctor") {
  try {
    const config = loadApplicationConfig(env);
    const checks = await runDoctor(config);
    for (const check of checks) console.log(`${check.status.padEnd(4)} ${check.name.padEnd(18)} ${check.message}`);
    if (checks.some(check => check.status === "FAIL")) process.exitCode = 1;
  } catch (error) {
    console.error(`FAIL Configuration ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
} else {
  let application;
  let releaseLock: (() => Promise<void>) | undefined;
  try {
    const config = loadApplicationConfig(env);
    releaseLock = await acquireProcessLock(resolve(config.cwd, env.AGENT_REMOTE_LOCK_PATH ?? "data/agent-remote.lock"));
    application = createApplication(config);
    await application.start();
    console.log("agent-remote started; waiting for WhatsApp connection");
  } catch (error) {
    await releaseLock?.();
    console.error(`agent-remote failed to start: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  if (application) {
    const shutdown = async () => {
      try {
        await application.stop();
        process.exitCode = 0;
      } finally {
        await releaseLock?.();
      }
    };
    process.once("SIGINT", () => { void shutdown(); });
    process.once("SIGTERM", () => { void shutdown(); });
  }
}
