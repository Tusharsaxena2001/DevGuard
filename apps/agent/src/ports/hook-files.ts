/** Hook script files on disk. Implemented over the file system; faked in unit tests. */
export interface HookFiles {
  /** Contents of a regular file, or undefined if it does not exist. */
  read(path: string): Promise<string | undefined>;
  /** Atomically write an executable script (mode 0755), creating the directory (0700) if needed. */
  writeExecutable(path: string, content: string): Promise<void>;
  /** Rename, refusing to overwrite an existing destination. */
  move(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Remove a directory only if it is empty. */
  removeDirIfEmpty(path: string): Promise<void>;
}
