const MAX_STDIN_BYTES = 16 * 1024 * 1024;

/** Read all of stdin as UTF-8, refusing absurd sizes (a push list is a few lines). Resolves "" for a TTY or closed stdin. */
export async function readAllStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > MAX_STDIN_BYTES) throw new Error("stdin too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}
