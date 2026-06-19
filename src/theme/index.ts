import { createContext, useContext, useState } from "react";
import React from "react";

export type ThemeMode = "dark" | "light";

export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  hoverBg: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  bubbleAssistant: string;
  bubbleUser: string;
  codeBg: string;
  toolBg: string;
  assistantAvatar: string;
}

const dark: ThemeColors = {
  bgPrimary: "#0e1726",
  bgSecondary: "#080f1a",
  bgTertiary: "#1e293b",
  hoverBg: "#131e2e",
  accent: "#4f46e5",
  textPrimary: "#f1f5f9",
  textSecondary: "#475569",
  textMuted: "#94a3b8",
  border: "#1e293b",
  borderStrong: "#334155",
  bubbleAssistant: "#1e293b",
  bubbleUser: "#4f46e5",
  codeBg: "#0f172a",
  toolBg: "#0b1220",
  assistantAvatar: "#0e7490",
};

const light: ThemeColors = {
  bgPrimary: "#f8fafc",
  bgSecondary: "#ffffff",
  bgTertiary: "#f1f5f9",
  hoverBg: "#e2e8f0",
  accent: "#4f46e5",
  textPrimary: "#0f172a",
  textSecondary: "#64748b",
  textMuted: "#64748b",
  border: "#e2e8f0",
  borderStrong: "#cbd5e1",
  bubbleAssistant: "#ffffff",
  bubbleUser: "#4f46e5",
  codeBg: "#f1f5f9",
  toolBg: "#f8fafc",
  assistantAvatar: "#0891b2",
};

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "dark",
  colors: dark,
  toggleTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>(
    () => (localStorage.getItem("nexo-theme") as ThemeMode) || "dark"
  );
  const toggleTheme = () => {
    setMode((m) => {
      const next = m === "dark" ? "light" : "dark";
      localStorage.setItem("nexo-theme", next);
      return next;
    });
  };
  return React.createElement(
    ThemeContext.Provider,
    { value: { mode, colors: mode === "dark" ? dark : light, toggleTheme } },
    children
  );
};

export const useTheme = () => useContext(ThemeContext);

export function applyThemeCssVars(colors: ThemeColors) {
  const root = document.documentElement;
  root.style.setProperty("--nexo-bg-primary", colors.bgPrimary);
  root.style.setProperty("--nexo-bg-secondary", colors.bgSecondary);
  root.style.setProperty("--nexo-bg-tertiary", colors.bgTertiary);
  root.style.setProperty("--nexo-hover-bg", colors.hoverBg);
  root.style.setProperty("--nexo-text-primary", colors.textPrimary);
  root.style.setProperty("--nexo-text-muted", colors.textMuted);
  root.style.setProperty("--nexo-border", colors.border);
  root.style.setProperty("--nexo-border-strong", colors.borderStrong);
  document.body.style.background = colors.bgPrimary;
  document.body.style.color = colors.textPrimary;
}
