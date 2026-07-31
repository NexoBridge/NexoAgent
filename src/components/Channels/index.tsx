import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Switch, Tag, message } from "antd";
import { CopyOutlined, GlobalOutlined } from "@ant-design/icons";
import { apiGet, apiPost } from "../../services/api";
import { useI18n } from "../../i18n";
import "./index.scss";

type ChannelId = "web" | "feishu" | "dingtalk" | "wecom" | "wechat";

interface ChannelField {
  key: string;
  label: string;
  secret?: boolean;
}

interface ChannelDef {
  id: ChannelId;
  name: string;
  desc: string;
  icon: React.ReactNode;
  fields: ChannelField[];
  alwaysEnabled?: boolean;
  note?: string;
}

interface ChannelConfig {
  id: Exclude<ChannelId, "web">;
  enabled: boolean;
  values: Record<string, string>;
  callbackUrl: string;
  runtimeStatus: "ready";
}

function buildChannels(lang: "zh" | "en"): ChannelDef[] {
  const zh = lang === "zh";
  return [
    {
      id: "web",
      name: zh ? "Web \u63a7\u5236\u53f0" : "Web Console",
      desc: zh ? "\u5f53\u524d\u9875\u9762\u8bbf\u95ee\u5730\u5740" : "Current page address",
      icon: <GlobalOutlined className="channels-panel__icon--web" />,
      fields: [],
      alwaysEnabled: true,
    },
    {
      id: "feishu",
      name: zh ? "\u98de\u4e66" : "Feishu",
      desc: zh ? "\u63a5\u5165\u98de\u4e66\u673a\u5668\u4eba\u4e8b\u4ef6\u56de\u8c03" : "Receive Feishu bot callbacks",
      icon: <span className="channels-panel__icon-char">\u98de</span>,
      fields: [
        { key: "app_id", label: "App ID" },
        { key: "app_secret", label: "App Secret", secret: true },
        { key: "verification_token", label: "Verification Token", secret: true },
      ],
      note: zh
        ? "\u652f\u6301 challenge \u6821\u9a8c\u548c\u6587\u672c\u6d88\u606f\u4e8b\u4ef6\u63a5\u5165\u3002"
        : "Supports challenge verification and text message event ingress.",
    },
    {
      id: "dingtalk",
      name: zh ? "\u9489\u9489" : "DingTalk",
      desc: zh ? "\u63a5\u5165\u9489\u9489 Outgoing \u56de\u8c03" : "Receive DingTalk outgoing callbacks",
      icon: <span className="channels-panel__icon-char">\u9489</span>,
      fields: [
        { key: "agent_id", label: "Agent ID" },
        { key: "app_key", label: "App Key" },
        { key: "app_secret", label: "App Secret", secret: true },
      ],
      note: zh
        ? "\u652f\u6301 JSON \u6587\u672c\u5165\u7ad9\uff0c\u5e76\u6309 text \u54cd\u5e94\u683c\u5f0f\u8fd4\u56de\u3002"
        : "Accepts JSON text payloads and replies in text response format.",
    },
    {
      id: "wecom",
      name: zh ? "\u4f01\u4e1a\u5fae\u4fe1" : "WeCom",
      desc: zh ? "\u63a5\u5165\u4f01\u4e1a\u5fae\u4fe1\u56de\u8c03" : "Receive WeCom callbacks",
      icon: <span className="channels-panel__icon-char">\u4f01</span>,
      fields: [
        { key: "corp_id", label: "Corp ID" },
        { key: "agent_secret", label: "Agent Secret", secret: true },
        { key: "agent_id", label: "Agent ID" },
        { key: "token", label: "Token", secret: true },
        { key: "encoding_aes_key", label: "EncodingAESKey", secret: true },
      ],
      note: zh
        ? "\u57fa\u7840\u56de\u8c03\u94fe\u8def\u5df2\u63a5\u5165\uff0c\u540e\u7eed\u53ef\u6269\u5c55 AES \u89e3\u5bc6\u3002"
        : "Base callback flow is wired. AES decryption can be added later.",
    },
    {
      id: "wechat",
      name: zh ? "\u5fae\u4fe1\u516c\u4f17\u53f7" : "WeChat Official Account",
      desc: zh ? "\u63a5\u5165\u5fae\u4fe1\u516c\u4f17\u53f7\u6d88\u606f\u56de\u8c03" : "Receive WeChat official account callbacks",
      icon: <span className="channels-panel__icon-char">\u5fae</span>,
      fields: [
        { key: "app_id", label: "App ID" },
        { key: "app_secret", label: "App Secret", secret: true },
        { key: "token", label: "Token", secret: true },
      ],
      note: zh
        ? "\u652f\u6301 URL \u6821\u9a8c\uff0cXML \u6587\u672c\u6d88\u606f\u63a5\u6536\u548c\u88ab\u52a8\u56de\u590d\u3002"
        : "Supports URL verification, XML text messages, and passive replies.",
    },
  ];
}

function ChannelCard({ channel, config, onSaved, lang }: { channel: ChannelDef; config?: ChannelConfig; onSaved: (config: ChannelConfig) => void; lang: "zh" | "en" }) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(Boolean(channel.alwaysEnabled || config?.enabled));
  const [values, setValues] = useState<Record<string, string>>(config?.values ?? {});
  const [saving, setSaving] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();

  useEffect(() => {
    setEnabled(Boolean(channel.alwaysEnabled || config?.enabled));
    setValues(config?.values ?? {});
  }, [channel.alwaysEnabled, config]);

  const callback = channel.id === "web" ? window.location.href : config?.callbackUrl || "";

  const runtimeStatus = channel.id === "web"
    ? (lang === "zh" ? "\u5df2\u63a5\u5165" : "Connected")
    : (lang === "zh" ? "Webhook \u5df2\u63a5\u5165" : "Webhook ready");

  const callbackLabel = channel.id === "web"
    ? (lang === "zh" ? "\u5f53\u524d\u5730\u5740" : "Current address")
    : (lang === "zh" ? "\u56de\u8c03\u5730\u5740" : "Callback URL");

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    void msgApi.success(lang === "zh" ? "\u5df2\u590d\u5236" : "Copied.");
  };

  const handleSave = async () => {
    if (channel.id === "web") return;
    setSaving(true);
    try {
      const saved = await apiPost<ChannelConfig>(`/api/channels/${channel.id}`, { enabled, values });
      onSaved(saved);
      void msgApi.success(lang === "zh" ? "\u4fdd\u5b58\u6210\u529f" : "Saved successfully.");
    } catch (error) {
      void msgApi.error(error instanceof Error ? error.message : (lang === "zh" ? "\u4fdd\u5b58\u5931\u8d25" : "Save failed."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="channels-panel__card">
      {contextHolder}
      <div className="channels-panel__card-header">
        <div className="channels-panel__card-info">
          {channel.icon}
          <div>
            <div className="channels-panel__card-name">{channel.name}</div>
            <div className="channels-panel__card-desc">{channel.desc}</div>
          </div>
          <Tag color="green">{runtimeStatus}</Tag>
        </div>
        <Switch
          checked={enabled}
          onChange={channel.alwaysEnabled ? undefined : setEnabled}
          disabled={channel.alwaysEnabled}
        />
      </div>

      <div className="channels-panel__callback">
        <div className="channels-panel__label">{callbackLabel}</div>
        <Input
          readOnly
          value={callback}
          className="channels-panel__input"
          suffix={
            <CopyOutlined
              className="channels-panel__copy-icon"
              onClick={() => void copy(callback)}
            />
          }
        />
      </div>

      {channel.note && (
        <Alert type="info" showIcon message={channel.note} className="channels-panel__note" />
      )}

      {enabled && channel.fields.length > 0 && (
        <div className="channels-panel__fields">
          {channel.fields.map((field) => {
            const InputControl = field.secret ? Input.Password : Input;
            return (
              <div key={field.key}>
                <div className="channels-panel__label">{field.label}</div>
                <InputControl
                  className="channels-panel__input"
                  placeholder={field.label}
                  value={values[field.key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </div>
            );
          })}
          <Button type="primary" loading={saving} onClick={() => void handleSave()} className="channels-panel__save-btn">
            {t("save")}
          </Button>
        </div>
      )}
    </div>
  );
}

export const Channels: React.FC = () => {
  const { lang } = useI18n();
  const [configs, setConfigs] = useState<Record<string, ChannelConfig>>({});

  useEffect(() => {
    void apiGet<ChannelConfig[]>("/api/channels").then((items) => {
      setConfigs(Object.fromEntries(items.map((item) => [item.id, item])));
    });
  }, []);

  const updateConfig = (config: ChannelConfig) => {
    setConfigs((current) => ({ ...current, [config.id]: config }));
  };

  const cards = useMemo(() => buildChannels(lang), [lang]);

  return (
    <div className="channels-panel">
      <div className="channels-panel__title">
        {lang === "zh" ? "\u6e20\u9053\u7ba1\u7406" : "Channel Management"}
      </div>
      <div className="channels-panel__grid">
        {cards.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} config={configs[channel.id]} onSaved={updateConfig} lang={lang} />
        ))}
      </div>
    </div>
  );
};
