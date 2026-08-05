import React, { useEffect, useState } from "react";
import { Button, Form, Input, Segmented, Spin, Typography } from "antd";
import type { Lang } from "../i18n";
import { useI18n } from "../i18n";
import { apiGet, apiPost, clearAuthToken, isElectron, setAuthToken } from "../services/api";
import "./WebAuthGate.scss";

const { Text, Title } = Typography;

interface AuthStatus {
  authenticated: boolean;
  safeModeEnabled?: boolean;
  legacyPasswordRequired?: boolean;
}

interface LoginResponse {
  token: string;
}

export const WebAuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { lang, setLang, t } = useI18n();
  const [status, setStatus] = useState<AuthStatus | null>(() =>
    isElectron() ? { authenticated: true } : null
  );
  const [checkingAuth, setCheckingAuth] = useState(!isElectron());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm<{ accountName?: string; password: string }>();
  const languageOptions = [
    { label: t("simplifiedChinese"), value: "zh" },
    { label: t("english"), value: "en" },
  ];

  const languageSwitch = (
    <div className="web-auth-gate__language">
      <span className="web-auth-gate__language-label">{t("language")}</span>
      <Segmented
        size="small"
        value={lang}
        options={languageOptions}
        onChange={(value) => setLang(value as Lang)}
      />
    </div>
  );

  useEffect(() => {
    if (isElectron()) return;
    let disposed = false;

    void apiGet<AuthStatus>("/api/auth/status")
      .then((nextStatus) => {
        if (!disposed) {
          setStatus(nextStatus);
          setCheckingAuth(false);
        }
      })
      .catch(() => {
        if (!disposed) {
          clearAuthToken();
          setStatus({ authenticated: false, legacyPasswordRequired: true });
          setCheckingAuth(false);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

  // Show loading spinner during initial auth check
  if (checkingAuth) {
    return (
      <div className="web-auth-gate">
        <div className="web-auth-gate__panel web-auth-gate__panel--checking">
          {languageSwitch}
          <div className="web-auth-gate__checking-body">
            <Spin size="large" />
            <div className="web-auth-gate__checking-text">
              {t("checkingAuth")}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // If authenticated, render children
  if (status?.authenticated) {
    return <>{children}</>;
  }

  // Show login form if authentication is required
  const safeModeEnabled = status?.safeModeEnabled === true;
  const title = safeModeEnabled ? t("webSafeMode") : t("signIn");
  const failureMessage = safeModeEnabled
    ? t("signInFailedAccountPassword")
    : t("signInFailedPassword");

  const submit = async (values: { accountName?: string; password: string }) => {
    setLoading(true);
    setError("");
    try {
      const result = await apiPost<LoginResponse>("/api/auth/login", values);
      setAuthToken(result.token);
      const nextStatus = await apiGet<AuthStatus>("/api/auth/status");
      setStatus(nextStatus);
      form.resetFields();
    } catch {
      setError(failureMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="web-auth-gate">
      <div className="web-auth-gate__panel">
        <div className="web-auth-gate__header">
          <Title level={3} className="web-auth-gate__title">
            {title}
          </Title>
          {languageSwitch}
        </div>
        <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
          {safeModeEnabled ? (
            <Form.Item name="accountName" label={t("account")} rules={[{ required: true, message: t("accountRequired") }]}>
              <Input autoComplete="username" autoFocus />
            </Form.Item>
          ) : null}
          <Form.Item name="password" label={t("password")} rules={[{ required: true, message: t("passwordRequired") }]}>
            <Input.Password autoComplete={safeModeEnabled ? "current-password" : "current-password"} autoFocus={!safeModeEnabled} />
          </Form.Item>
          {error ? <Text className="web-auth-gate__error">{error}</Text> : null}
          <Button type="primary" htmlType="submit" loading={loading} className="web-auth-gate__submit">
            {t("signIn")}
          </Button>
        </Form>
      </div>
    </div>
  );
};
