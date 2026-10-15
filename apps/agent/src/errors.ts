export type AgentErrorCode = "usage_error" | "config_invalid" | "store_write_failed" | "git_failed" | "hook_files_failed";

/** Typed error with a stable code. Messages are shown to users: never put secrets or file contents in them. */
export class AgentError extends Error {
  readonly code: AgentErrorCode;

  constructor(code: AgentErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AgentError";
    this.code = code;
  }
}
