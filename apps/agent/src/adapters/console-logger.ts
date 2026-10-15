import type { Logger } from "../ports/logger.js";

/** A closed pipe (`devguard status | head`) must not crash the process: Node would exit 1, which the hook contract reads as "blocked". */
function ignoreBrokenPipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code !== "EPIPE") throw error;
  });
}

/** `Logger` over the process streams. */
export function createConsoleLogger(): Logger {
  ignoreBrokenPipe(process.stdout);
  ignoreBrokenPipe(process.stderr);
  return {
    info: (message) => void process.stdout.write(`${message}\n`),
    error: (message) => void process.stderr.write(`${message}\n`),
  };
}
