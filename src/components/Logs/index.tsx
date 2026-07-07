import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Select, Space, Tag } from "antd";
import { PauseCircleOutlined, PlayCircleOutlined, DeleteOutlined } from "@ant-design/icons";
import { apiGet, getApiBase } from "../../services/api";
import { useI18n } from "../../i18n";
import { useTheme } from "../../theme";

type LogDateItem = {
  date: string;
  size: number;
  updatedAt: string;
};

function getColor(line: string) {
  if (line.includes("ERROR")) return "#ef4444";
  if (line.includes("WARN")) return "#f59e0b";
  if (line.includes("INFO")) return "#10b981";
  return "#94a3b8";
}

function parseLogEventData(data: string) {
  try {
    const parsed = JSON.parse(data);
    return typeof parsed === "string" ? parsed : data;
  } catch {
    return data;
  }
}

export default function Logs() {
  const { colors } = useTheme();
  const { lang, t } = useI18n();
  const [lines, setLines] = useState<string[]>([]);
  const [logDates, setLogDates] = useState<LogDateItem[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [paused, setPaused] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const ui = useMemo(
    () => ({
      title: lang === "zh" ? "\u8fd0\u884c\u65e5\u5fd7" : "Runtime Logs",
      live: lang === "zh" ? "\u5b9e\u65f6\u4e2d" : "Live",
      history: lang === "zh" ? "\u5386\u53f2" : "History",
      paused: lang === "zh" ? "\u5df2\u6682\u505c" : "Paused",
      date: lang === "zh" ? "\u65e5\u671f" : "Date",
      today: lang === "zh" ? "\u4eca\u5929" : "Today",
    }),
    [lang],
  );

  function loadLogDates() {
    void apiGet<LogDateItem[]>("/api/logs/dates")
      .then(setLogDates)
      .catch(() => setLogDates([]));
  }

  function connect(date = selectedDate) {
    esRef.current?.close();
    const query = date ? `?date=${encodeURIComponent(date)}` : "";
    const es = new EventSource(`${getApiBase()}/api/logs${query}`);
    es.onmessage = (event) => setLines((prev) => [...prev, parseLogEventData(event.data)]);
    esRef.current = es;
  }

  useEffect(() => {
    loadLogDates();
  }, []);

  useEffect(() => {
    connect(selectedDate);
    return () => esRef.current?.close();
  }, [selectedDate]);

  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lines, paused]);

  function handleClear() {
    setLines([]);
  }

  function handlePauseResume() {
    if (paused) {
      connect(selectedDate);
      setPaused(false);
      return;
    }
    esRef.current?.close();
    setPaused(true);
  }

  function handleDateChange(date: string) {
    setLines([]);
    setPaused(false);
    setSelectedDate(date);
  }

  const selectedIsHistory = Boolean(selectedDate);
  const dateOptions = [
    { value: "", label: ui.today },
    ...logDates.map((item) => ({ value: item.date, label: item.date })),
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", color: colors.textPrimary }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "20px 24px 12px",
          borderBottom: `1px solid ${colors.border}`,
          background: colors.bgPrimary,
        }}
      >
        <Space align="center" size={12}>
          <span style={{ fontWeight: 600, fontSize: 18, color: colors.textPrimary }}>{ui.title}</span>
          <Tag color={paused ? "gold" : selectedIsHistory ? "blue" : "green"}>
            {paused ? ui.paused : selectedIsHistory ? ui.history : ui.live}
          </Tag>
        </Space>
        <Space size={8}>
          <Select
            aria-label={ui.date}
            value={selectedDate}
            options={dateOptions}
            style={{ width: 160 }}
            onDropdownVisibleChange={(open) => {
              if (open) loadLogDates();
            }}
            onChange={handleDateChange}
          />
          <Button icon={<DeleteOutlined />} onClick={handleClear}>
            {t("clear")}
          </Button>
          <Button
            icon={paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
            onClick={handlePauseResume}
          >
            {paused ? t("resumeStream") : t("pauseStream")}
          </Button>
        </Space>
      </div>
      <div
        style={{
          flex: 1,
          background: colors.bgSecondary,
          fontFamily: "Consolas, Monaco, monospace",
          fontSize: 12,
          overflowY: "auto",
          padding: 16,
        }}
      >
        {lines.map((line, index) => (
          <div key={`${index}-${line.slice(0, 12)}`} style={{ color: getColor(line), whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
