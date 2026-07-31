import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Empty,
  List,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { ReloadOutlined, ThunderboltOutlined } from "@ant-design/icons";
import type { SkillDefinition } from "../../shared/types";
import { apiDelete, apiGet, apiPost } from "../../services/api";
import { useI18n } from "../../i18n";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";
import "./index.scss";

const { Title, Text, Paragraph } = Typography;

interface SkillItem extends SkillDefinition {
  instruction: string;
}

function sourceLabel(skill: SkillItem) {
  if (skill.source === "built-in") return "builtIn";
  if (skill.source === "marketplace") return skill.marketplaceName || "Marketplace";
  return skill.managed ? "managed" : "discovered";
}

export default function Skills() {
  const { t } = useI18n();
  const [skills, setSkills] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    try {
      setSkills(await apiGet<SkillItem[]>("/api/skills"));
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const toggleSkill = async (skill: SkillItem, enabled: boolean) => {
    try {
      await apiPost("/api/skills/toggle", { key: skill.key, enabled });
      setSkills((current) => current.map((item) => (item.key === skill.key ? { ...item, enabled } : item)));
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const removeSkill = async (skill: SkillItem) => {
    if (skill.source === "built-in") {
      void message.warning(t("builtInCannotDelete"));
      return;
    }
    try {
      await apiDelete(`/api/skills/${skill.key}`);
      setSkills((current) => current.filter((item) => item.key !== skill.key));
    } catch (error) {
      void message.error(error instanceof Error ? error.message : String(error));
    }
  };

  const summary = useMemo(() => ({
    total: skills.length,
    enabled: skills.filter((skill) => skill.enabled).length,
    managed: skills.filter((skill) => skill.managed).length,
  }), [skills]);

  const renderSkillList = (items: SkillItem[], emptyText: string) => (
    items.length === 0 ? (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
    ) : (
      <List
        dataSource={items}
        renderItem={(skill) => (
          <List.Item
            className="skills-panel__list-item"
            actions={[
              <OverflowMenuButton
                key="more"
                color="var(--nexo-text-secondary)"
                items={[
                  { key: "toggle", label: skill.enabled ? t("disabled") : t("enabled") },
                  ...(skill.source !== "built-in"
                    ? [{ key: "delete", label: t("removeSkill"), danger: skill.managed }]
                    : []),
                ]}
                onItemClick={(key) => {
                  if (key === "toggle") {
                    void toggleSkill(skill, !skill.enabled);
                    return;
                  }
                  if (key === "delete") {
                    void removeSkill(skill);
                  }
                }}
              />,
            ]}
          >
            <List.Item.Meta
              avatar={<ThunderboltOutlined className="skills-panel__skill-icon" />}
              title={(
                <Space size={8} wrap>
                  <span className="skills-panel__skill-name">{skill.name}</span>
                  <Tag color={skill.enabled ? "green" : "default"}>{skill.enabled ? t("enabled") : t("disabled")}</Tag>
                  <Tag color="blue">{skill.category}</Tag>
                  <Tag color={skill.source === "built-in" ? "gold" : skill.source === "marketplace" ? "purple" : "cyan"}>
                    {sourceLabel(skill) === "builtIn" || sourceLabel(skill) === "managed" || sourceLabel(skill) === "discovered"
                      ? t(sourceLabel(skill) as "builtIn" | "managed" | "discovered")
                      : sourceLabel(skill)}
                  </Tag>
                </Space>
              )}
              description={(
                <Space direction="vertical" size={4} className="skills-panel__skill-meta">
                  <Text className="skills-panel__skill-desc">{skill.description}</Text>
                  {skill.path && (
                    <Paragraph className="skills-panel__skill-path" ellipsis={{ rows: 1 }}>
                      {skill.path}
                    </Paragraph>
                  )}
                  <Paragraph
                    className="skills-panel__skill-instruction"
                    ellipsis={{ rows: 2, expandable: true, symbol: "More" }}
                  >
                    {skill.instruction}
                  </Paragraph>
                </Space>
              )}
            />
          </List.Item>
        )}
      />
    )
  );

  const managedSkills = useMemo(
    () => skills.filter((skill) => skill.managed).sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)),
    [skills],
  );
  const discoveredSkills = useMemo(
    () => skills.filter((skill) => !skill.managed && skill.source !== "built-in").sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)),
    [skills],
  );
  const builtInSkills = useMemo(
    () => skills.filter((skill) => skill.source === "built-in").sort((left, right) => Number(right.enabled) - Number(left.enabled) || left.name.localeCompare(right.name)),
    [skills],
  );

  return (
    <div className="skills-panel">
      <div className="skills-panel__header">
      <div className="skills-panel__title-row">
        <div>
          <Title level={4} className="skills-panel__title">
            {t("skills")}
          </Title>
          <Text className="skills-panel__subtitle">
            {t("skillsSubtitle")}
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadAll()} loading={loading}>
          {t("refresh")}
        </Button>
      </div>

      <Space wrap size={12} className="skills-panel__summary">
        <div className="skills-panel__stat">
          <Text className="skills-panel__stat-label">{t("loaded")}</Text>
          <div className="skills-panel__stat-value">{summary.total}</div>
        </div>
        <div className="skills-panel__stat">
          <Text className="skills-panel__stat-label">{t("enabled")}</Text>
          <div className="skills-panel__stat-value">{summary.enabled}</div>
        </div>
        <div className="skills-panel__stat">
          <Text className="skills-panel__stat-label">{t("managed")}</Text>
          <div className="skills-panel__stat-value">{summary.managed}</div>
        </div>
      </Space>

      <Space direction="vertical" size={16} className="skills-panel__alert-wrap">
        <Alert
          type="info"
          showIcon
          message={t("skillsInjected")}
        />
      </Space>
      </div>
      <div className="skills-panel__body">

        <div className="skills-panel__section">
          <Title level={5} className="skills-panel__section-title">
            {t("managedSkills")}
          </Title>
          {renderSkillList(managedSkills, t("noManagedSkills"))}
        </div>

        <div className="skills-panel__section">
          <Title level={5} className="skills-panel__section-title">
            {t("workspaceDiscoveries")}
          </Title>
          {renderSkillList(discoveredSkills, t("noDiscoveredSkills"))}
        </div>

        <div className="skills-panel__section">
          <Title level={5} className="skills-panel__section-title">
            {t("builtInPresets")}
          </Title>
          {renderSkillList(builtInSkills, t("noBuiltInSkills"))}
        </div>
      </div>
    </div>
  );
}
