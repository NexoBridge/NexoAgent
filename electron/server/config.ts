import path from "node:path";

export const DATA_DIR = path.join(process.cwd(), ".nexo-data");
export const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
export const KNOWLEDGE_DIR = path.join(DATA_DIR, "knowledge");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
export const LOG_FILE = path.join(DATA_DIR, "app.log");
export const TOOL_SETTINGS_FILE = path.join(DATA_DIR, "tools.json");
export const MCP_SERVERS_FILE = path.join(DATA_DIR, "mcp-servers.json");
export const MODEL_PROFILES_FILE = path.join(DATA_DIR, "model-profiles.json");
export const SKILLS_FILE = path.join(DATA_DIR, "skills.json");
export const SKILL_STATE_FILE = path.join(DATA_DIR, "skill-state.json");
export const MANAGED_SKILLS_DIR = path.join(DATA_DIR, "skills");
export const MANAGED_CUSTOM_SKILLS_DIR = path.join(MANAGED_SKILLS_DIR, "custom");
export const MANAGED_MARKETPLACE_SKILLS_DIR = path.join(MANAGED_SKILLS_DIR, "marketplace");
export const TASKS_FILE = path.join(DATA_DIR, "tasks.json");
