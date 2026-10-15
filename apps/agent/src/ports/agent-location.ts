/** Where this agent lives and what it is, written into the hook wrapper at install time. */
export interface AgentLocation {
  readonly nodePath: string;
  readonly mainPath: string;
  readonly version: string;
}
