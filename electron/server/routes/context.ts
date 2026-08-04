import type { TaskExecutionOrigin, TaskExecutionResult } from "../tasks";
import type { AgentSettings } from "../../../src/shared/types";

export interface ServerContext {
  getStoredApiKey: () => string;
  distPath: string;
  desktopAuthorityToken?: string;
  persistAgentSettings?: (patch: Partial<AgentSettings>) => Promise<void>;
  onTaskFinished?: (result: TaskExecutionResult, meta: { origin: TaskExecutionOrigin }) => void;
}
