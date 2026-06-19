import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Input, Switch, Tag, message } from "antd";
import { CopyOutlined, GlobalOutlined } from "@ant-design/icons";
import { apiGet, apiPost } from "../../services/api";
import { useTheme } from "../../theme";

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

const CHANNELS: ChannelDef[] = [
  {
    id: "web",
    name: "Web 控制台",
    desc: "当前页面访问地址",
    icon: <GlobalOutlined style={{ fontSize: 22, color: "#38bdf8" }} />,
    fields: [],
    alwaysEnabled: true,
  },
  {
    id: "feishu",
    name: "飞书",
    desc: "接入飞书机器人事件回调",
    icon: <span style={{ fontSize: 22 }}>飞</span>,
    fields: [
      { key: "app_id", label: "App ID" },
      { key: "app_secret", label: "App Secret", secret: true },
      { key: "verification_token", label: "Verification Token", secret: true },
    ],
    note: "支持飞书事件订阅的 challenge 校验和文本消息事件入站。加密事件和主动消息 API 可在此基础上继续扩展。",
  },
  {
    id: "dingtalk",
    name: "钉钉",
    desc: "接入钉钉机器人 Outgoing 回调",
    icon: <span style={{ fontSize: 22 }}>钉</span>,
    fields: [
      { key: "agent_id", label: "Agent ID" },
      { key: "app_key", label: "App Key" },
      { key: "app_secret", label: "App Secret", secret: true },
    ],
    note: "支持钉钉机器人 JSON 文本入站，并按钉钉 text 响应格式返回回复。",
  },
  {
    id: "wecom",
    name: "企业微信",
    desc: "接入企业微信回调",
    icon: <span style={{ fontSize: 22 }}>企</span>,
    fields: [
      { key: "corp_id", label: "Corp ID" },
      { key: "agent_secret", label: "Agent Secret", secret: true },
      { key: "agent_id", label: "Agent ID" },
      { key: "token", label: "Token", secret: true },
      { key: "encoding_aes_key", label: "EncodingAESKey", secret: true },
    ],
    note: "基础链路已接入明文 XML/JSON 文本消息。企业微信生产环境通常需要加解密，后续可接入 EncodingAESKey 解密。",
  },
  {
    id: "wechat",
    name: "微信公众号",
    desc: "接入微信公众号消息回调",
    icon: <span style={{ fontSize: 22 }}>微</span>,
    fields: [
      { key: "app_id", label: "App ID" },
      { key: "app_secret", label: "App Secret", secret: true },
      { key: "token", label: "Token", secret: true },
    ],
    note: "支持 URL 验证、明文 XML 文本消息接收和被动文本回复。加密模式可继续扩展。",
  },
];

function ChannelCard({ channel, config, onSaved }: { channel: ChannelDef; config?: ChannelConfig; onSaved: (config: ChannelConfig) => void }) {
  const { colors } = useTheme();
  const [enabled, setEnabled] = useState(Boolean(channel.alwaysEnabled || config?.enabled));
  const [values, setValues] = useState<Record<string, string>>(config?.values ?? {});
  const [saving, setSaving] = useState(false);
  const [msgApi, contextHolder] = message.useMessage();

  useEffect(() => {
    setEnabled(Boolean(channel.alwaysEnabled || config?.enabled));
    setValues(config?.values ?? {});
  }, [channel.alwaysEnabled, config]);

  const callback = channel.id === "web" ? window.location.href : config?.callbackUrl || "";

  const cardStyle: React.CSSProperties = {
    background: colors.bgSecondary,
    border: `1px solid ${colors.border}`,
    borderRadius: 10,
    padding: "20px 24px",
  };

  const inputStyle: React.CSSProperties = {
    background: colors.bgPrimary,
    borderColor: colors.borderStrong,
    color: colors.textPrimary,
  };

  const labelStyle: React.CSSProperties = {
    color: colors.textSecondary,
    fontSize: 12,
    marginBottom: 4,
  };

  const runtimeStatus = channel.id === "web" ? "已接入" : "Webhook 已接入";

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    void msgApi.success("已复制");
  };

  const handleSave = async () => {
    if (channel.id === "web") return;
    setSaving(true);
    try {
      const saved = await apiPost<ChannelConfig>(`/api/channels/${channel.id}`, { enabled, values });
      onSaved(saved);
      void msgApi.success("保存成功");
    } catch (error) {
      void msgApi.error(error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={cardStyle}>
      {contextHolder}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {channel.icon}
          <div>
            <div style={{ color: colors.textPrimary, fontWeight: 600 }}>{channel.name}</div>
            <div style={{ color: colors.textSecondary, fontSize: 12 }}>{channel.desc}</div>
          </div>
          <Tag color="green">{runtimeStatus}</Tag>
        </div>
        <Switch
          checked={enabled}
          onChange={channel.alwaysEnabled ? undefined : setEnabled}
          disabled={channel.alwaysEnabled}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={labelStyle}>{channel.id === "web" ? "当前地址" : "回调地址"}</div>
        <Input
          readOnly
          value={callback}
          style={inputStyle}
          suffix={
            <CopyOutlined
              style={{ color: colors.textMuted, cursor: "pointer" }}
              onClick={() => void copy(callback)}
            />
          }
        />
      </div>

      {channel.note && (
        <Alert type="info" showIcon message={channel.note} style={{ marginTop: 12 }} />
      )}

      {enabled && channel.fields.length > 0 && (
        <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          {channel.fields.map((field) => {
            const InputControl = field.secret ? Input.Password : Input;
            return (
              <div key={field.key}>
                <div style={labelStyle}>{field.label}</div>
                <InputControl
                  style={inputStyle}
                  placeholder={field.label}
                  value={values[field.key] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
                />
              </div>
            );
          })}
          <Button type="primary" loading={saving} onClick={() => void handleSave()} style={{ alignSelf: "flex-end", marginTop: 4 }}>
            保存
          </Button>
        </div>
      )}
    </div>
  );
}

export const Channels: React.FC = () => {
  const { colors } = useTheme();
  const [configs, setConfigs] = useState<Record<string, ChannelConfig>>({});

  useEffect(() => {
    void apiGet<ChannelConfig[]>("/api/channels").then((items) => {
      setConfigs(Object.fromEntries(items.map((item) => [item.id, item])));
    });
  }, []);

  const updateConfig = (config: ChannelConfig) => {
    setConfigs((current) => ({ ...current, [config.id]: config }));
  };

  const cards = useMemo(() => CHANNELS, []);

  return (
    <div style={{ padding: "28px 32px", color: colors.textPrimary, background: colors.bgPrimary, minHeight: "100%" }}>
      <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>渠道管理</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 20 }}>
        {cards.map((channel) => (
          <ChannelCard key={channel.id} channel={channel} config={configs[channel.id]} onSaved={updateConfig} />
        ))}
      </div>
    </div>
  );
};
