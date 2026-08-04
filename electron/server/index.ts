import type { Application, ErrorRequestHandler } from "express";
import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { migrateLegacyLogFile, serverLog } from "./logger";
import { registerRoutes } from "./routes";
import { startTaskScheduler, type TaskExecutionOrigin, type TaskExecutionResult } from "./tasks";
import type { AgentSettings } from "../../src/shared/types";

export { serverLog } from "./logger";
export type { StreamEvent } from "./types";

interface ExpressAppOptions {
  desktopAuthorityToken?: string;
  persistAgentSettings?: (patch: Partial<AgentSettings>) => Promise<void>;
  onTaskFinished?: (result: TaskExecutionResult, meta: { origin: TaskExecutionOrigin }) => void;
}

const REQUEST_BODY_LIMIT = process.env.NEXO_REQUEST_BODY_LIMIT || "20mb";

const requestBodyErrorHandler: ErrorRequestHandler = (error, _req, res, next) => {
  const status = typeof error?.status === "number" ? error.status : undefined;
  if (status === 413 || error?.type === "entity.too.large") {
    res.status(413).json({
      error: `Request body is too large. Current limit is ${REQUEST_BODY_LIMIT}.`,
    });
    return;
  }
  next(error);
};

export function createExpressApp(getStoredApiKey: () => string, options: ExpressAppOptions = {}): Application {
  void migrateLegacyLogFile();
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
  app.use(express.text({ type: ["text/*", "application/xml", "*/xml"], limit: REQUEST_BODY_LIMIT }));
  app.use(requestBodyErrorHandler);
  startTaskScheduler(getStoredApiKey, options.onTaskFinished);

  const distCandidates = [
    path.join(process.cwd(), "dist"),
    path.join(__dirname, "..", "..", "..", "dist"),
    path.join(__dirname, "..", "..", "dist")
  ];
  const distPath = distCandidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html"))) ?? distCandidates[0];
  app.use(express.static(distPath));

  const ctx = {
    getStoredApiKey,
    distPath,
    desktopAuthorityToken: options.desktopAuthorityToken,
    persistAgentSettings: options.persistAgentSettings,
    onTaskFinished: options.onTaskFinished,
  };
  registerRoutes(app, ctx);

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: `Unknown API route: ${req.path}` });
      return;
    }
    res.sendFile(path.join(distPath, "index.html"));
  });

  return app;
}
