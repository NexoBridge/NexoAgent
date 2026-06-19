import React, { useEffect } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import { AppLayout } from "./components/Layout/AppLayout";
import { I18nProvider, useI18n } from "./i18n";
import { ThemeProvider, useTheme, applyThemeCssVars } from "./theme";

function AppShell() {
  const { mode, colors } = useTheme();
  const { lang } = useI18n();

  useEffect(() => {
    applyThemeCssVars(colors);
  }, [colors]);

  return (
    <ConfigProvider
      locale={lang === "zh" ? zhCN : enUS}
      theme={{
        algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: colors.accent,
          borderRadius: 8,
          colorBgContainer: colors.bgPrimary,
          colorBgElevated: colors.bgSecondary,
          colorBorder: colors.border,
          colorText: colors.textPrimary,
          colorTextSecondary: colors.textSecondary,
        },
      }}
    >
      <AppLayout />
    </ConfigProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </ThemeProvider>
  );
}
