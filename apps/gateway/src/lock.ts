import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export async function acquireProcessLock(lockPath: string, pid = process.pid): Promise<() => Promise<void>> {
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${pid}\n`);
      await handle.close();
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        const contents = await readFile(lockPath, "utf8").catch(() => "");
        if (contents.trim() === String(pid)) await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt === 1) throw error;
      const existingPid = Number((await readFile(lockPath, "utf8").catch(() => "")).trim());
      if (Number.isInteger(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
        throw new Error(`Another agent-remote instance is already running (PID ${existingPid})`);
      }
      await unlink(lockPath).catch(() => undefined);
    }
  }
  throw new Error(`Unable to acquire agent-remote lock: ${lockPath}`);
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
