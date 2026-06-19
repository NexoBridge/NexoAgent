import type { Application } from "express";
import type { ServerContext } from "./context";
import { registerAuthRoutes } from "./auth";
import { registerChatRoutes } from "./chat";
import { registerChannelRoutes } from "./channels";
import { registerKnowledgeRoutes } from "./knowledge";
import { registerLogRoutes } from "./logs";
import { registerMemoryRoutes } from "./memory";
import { registerMcpServerRoutes } from "./mcp-servers";
import { registerModelProfileRoutes } from "./model-profiles";
import { registerSessionRoutes } from "./sessions";
import { registerSettingsRoutes } from "./settings";
import { registerSkillRoutes } from "./skills";
import { registerStreamRoutes } from "./stream";
import { registerTaskRoutes } from "./tasks";
import { registerToolRoutes } from "./tools";
import { registerUploadRoutes } from "./upload";

export function registerRoutes(app: Application, ctx: ServerContext) {
  registerSettingsRoutes(app);
  registerMemoryRoutes(app, ctx);
  registerKnowledgeRoutes(app);
  registerUploadRoutes(app);
  registerAuthRoutes(app);
  registerChannelRoutes(app, ctx);
  registerTaskRoutes(app, ctx);
  registerLogRoutes(app);
  registerToolRoutes(app);
  registerMcpServerRoutes(app);
  registerModelProfileRoutes(app);
  registerSkillRoutes(app);
  registerSessionRoutes(app);
  registerChatRoutes(app, ctx);
  registerStreamRoutes(app);
}
