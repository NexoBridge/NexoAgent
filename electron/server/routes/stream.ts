import type { Application } from "express";
import {
  deleteSseWaiters,
  getSseQueue,
  getSseWaiters,
  hasSseQueue,
  scheduleSseCleanup,
  setSseWaiters,
} from "../sse";

export function registerStreamRoutes(app: Application) {
  app.get("/api/stream/:requestId", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const { requestId } = req.params;
    let cursor = 0;
    let closed = false;

    if (!hasSseQueue(requestId)) {
      res.write(`data: ${JSON.stringify({ type: "error", message: "响应流不存在或已过期。" })}\n\n`);
      res.end();
      return;
    }

    const flush = () => {
      if (closed) return;
      const queue = getSseQueue(requestId);
      while (cursor < queue.length) {
        const event = queue[cursor++];
        res.write(`data: ${JSON.stringify(event)}\n\n`);
        (res as unknown as { flush?: () => void }).flush?.();
        if (event.type === "done" || event.type === "error") {
          deleteSseWaiters(requestId);
          scheduleSseCleanup(requestId);
          res.end();
          return;
        }
      }
      const waiters = getSseWaiters(requestId);
      waiters.push(flush);
      setSseWaiters(requestId, waiters);
    };

    req.on("close", () => { closed = true; });
    flush();
  });
}
