import React, { useEffect, useState } from "react";
import { Button, Form, Input, Spin, Typography } from "antd";
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
  const [status, setStatus] = useState<AuthStatus | null>(() =>
    isElectron() ? { authenticated: true } : null
  );
  const [checkingAuth, setCheckingAuth] = useState(!isElectron());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [form] = Form.useForm<{ accountName?: string; password: string }>();

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
        <div className="web-auth-gate__panel" style={{ textAlign: "center", padding: "48px 28px" }}>
          <Spin size="large" />
          <div style={{ marginTop: "16px", color: "var(--nexo-text-secondary)" }}>
            Checking authentication...
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
  const title = safeModeEnabled ? "Web Safe Mode" : "Sign In";
  const failureMessage = safeModeEnabled
    ? "Sign-in failed. Check the account and password, then try again."
    : "Sign-in failed. Check the password and try again.";

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
        <Title level={3} className="web-auth-gate__title">
          {title}
        </Title>
        <Form form={form} layout="vertical" onFinish={(values) => void submit(values)}>
          {safeModeEnabled ? (
            <Form.Item name="accountName" label="Account" rules={[{ required: true, message: "Enter the account." }]}>
              <Input autoComplete="username" autoFocus />
            </Form.Item>
          ) : null}
          <Form.Item name="password" label="Password" rules={[{ required: true, message: "Enter the password." }]}>
            <Input.Password autoComplete={safeModeEnabled ? "current-password" : "current-password"} autoFocus={!safeModeEnabled} />
          </Form.Item>
          {error ? <Text className="web-auth-gate__error">{error}</Text> : null}
          <Button type="primary" htmlType="submit" loading={loading} className="web-auth-gate__submit">
            Sign In
          </Button>
        </Form>
      </div>
    </div>
  );
};
