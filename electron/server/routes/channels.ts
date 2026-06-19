import type { Application, Request, Response } from "express";
import { buildTextXmlReply, extractChannelMessage, runChannelMessage, verifyWechatSignature } from "../channel-runtime";
import { getChannelConfig, isChannelId, listChannelConfigs, saveChannelConfig } from "../channel-store";
import { toErrorMessage } from "../utils";
import type { ServerContext } from "./context";

function publicBaseUrl(req: Request) {
  const forwardedProto = req.get("x-forwarded-proto");
  const proto = forwardedProto || req.protocol;
  return `${proto}://${req.get("host")}`;
}

function callbackUrl(req: Request, channel: string) {
  return `${publicBaseUrl(req)}/api/channels/${channel}/webhook`;
}

function respondByChannel(channel: string, message: ReturnType<typeof extractChannelMessage>, result: { sessionId: string; reply: string }, res: Response) {
  if (channel === "dingtalk") {
    res.json({ msgtype: "text", text: { content: result.reply } });
    return;
  }

  if ((channel === "wechat" || channel === "wecom") && message?.xml) {
    res.type("application/xml").send(buildTextXmlReply(message.xml.FromUserName, message.xml.ToUserName, result.reply));
    return;
  }

  res.json({ ok: true, sessionId: result.sessionId, reply: result.reply });
}

export function registerChannelRoutes(app: Application, ctx: ServerContext) {
  app.get("/api/channels", async (req, res) => {
    const configs = await listChannelConfigs();
    res.json(configs.map((config) => ({
      ...config,
      callbackUrl: callbackUrl(req, config.id),
      runtimeStatus: "ready",
    })));
  });

  app.post("/api/channels/:channel", async (req, res) => {
    const { channel } = req.params;
    if (!isChannelId(channel)) return res.status(404).json({ error: "unknown channel" });
    try {
      const saved = await saveChannelConfig(channel, req.body as { enabled?: unknown; values?: Record<string, unknown> });
      res.json({ ...saved, callbackUrl: callbackUrl(req, channel), runtimeStatus: "ready" });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error) });
    }
  });

  app.get("/api/channels/:channel/webhook", (req, res) => {
    const { channel } = req.params;
    if (!isChannelId(channel)) return res.status(404).send("unknown channel");
    const config = getChannelConfig(channel);

    if (channel === "wechat") {
      const token = config.values.token || "";
      const ok = verifyWechatSignature(
        token,
        String(req.query.signature || ""),
        String(req.query.timestamp || ""),
        String(req.query.nonce || "")
      );
      if (!ok) return res.status(403).send("invalid signature");
      return res.send(String(req.query.echostr || ""));
    }

    return res.json({ ok: true, channel, callbackUrl: callbackUrl(req, channel) });
  });

  app.post("/api/channels/:channel/webhook", async (req, res) => {
    const { channel } = req.params;
    if (!isChannelId(channel)) return res.status(404).json({ error: "unknown channel" });

    const config = getChannelConfig(channel);
    if (!config.enabled) return res.status(403).json({ error: "channel disabled" });

    const body = req.body as unknown;
    if (channel === "feishu" && typeof body === "object" && body !== null && "challenge" in body) {
      return res.json({ challenge: (body as { challenge?: string }).challenge });
    }

    if (channel === "feishu" && config.values.verification_token) {
      const token = typeof body === "object" && body !== null ? (body as { token?: string }).token : "";
      if (token && token !== config.values.verification_token) {
        return res.status(403).json({ error: "invalid verification token" });
      }
    }

    if (channel === "wechat") {
      const token = config.values.token || "";
      const ok = verifyWechatSignature(
        token,
        String(req.query.signature || ""),
        String(req.query.timestamp || ""),
        String(req.query.nonce || "")
      );
      if (!ok) return res.status(403).send("invalid signature");
    }

    const message = extractChannelMessage(channel, body);
    if (!message) return res.status(400).json({ error: "no supported text message found" });

    try {
      const result = await runChannelMessage(message, ctx.getStoredApiKey);
      return respondByChannel(channel, message, result, res);
    } catch (error) {
      return res.status(500).json({ error: toErrorMessage(error) });
    }
  });
}
