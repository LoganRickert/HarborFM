import { spawn } from "child_process";

/**
 * Check if a command is present and runnable by spawning it with the given args.
 * Returns true only if the process exits with code 0. ENOENT or non-zero exit = false.
 */
export function checkCommand(
  path: string,
  args: string[],
  timeoutMs = 5000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(path, args, { stdio: "ignore" });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve((err as NodeJS.ErrnoException).code === "ENOENT" ? false : false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
}
