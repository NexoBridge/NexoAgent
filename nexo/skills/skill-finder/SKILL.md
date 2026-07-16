---
name: skill-finder
description: Search 10 major skill marketplaces and install the selected skill when the user asks to find or install a skill.
---

# Skill Finder

## Step 1 — Search

### 1a. Anthropic Official (mandatory, always first)

**Always** do a direct WebFetch of the official index — do NOT rely on WebSearch for this source:

1. Fetch `https://github.com/anthropics/skills/tree/main/skills` to get the full official skill list.
2. Check if any listed skill name matches the keyword (exact or semantic).
3. If a match exists, fetch its `SKILL.md` at `https://github.com/anthropics/skills/blob/main/skills/<name>/SKILL.md` to get capabilities.
4. Include every match in the results, labeled **[Anthropic Official]**.

### 1b. Community Marketplaces (parallel WebSearch)

Run WebSearch queries in parallel across all these marketplaces. Use the user's keyword plus the marketplace name/domain.

| Marketplace | Search method | Notes |
|---|---|---|
| **kills.sh** | `site:github.com "kills.sh" <keyword>` or `npx skills search <keyword>` | App-Store style, top 10 installs |
| **SkillsMP** | `site:github.com skillsmp <keyword>` | 100k+ open-source skills |
| **Agent Skills Hub** | `site:github.com "agent-skills-hub" <keyword>` | 790+ skills, project-level install |
| **OSM** | `osm search <keyword>` via Bash, or `site:github.com osm-registry <keyword>` | 52k+ skills, npm-like CLI |
| **Agensi** | `site:github.com agensi <keyword>` | Covers frontend/testing/DevOps/API |
| **SkillForge** | `site:github.com skillforge mcp <keyword>` | Decentralized, HTTP 402 micropay |
| **Heurist Mesh** | `site:github.com heurist-network skills <keyword>` | Finance/crypto focused, reviewed |
| **mekaskill** | `site:github.com mekaskill <keyword>` | CLI download to current directory |
| **SkillsHub** | `site:github.com nodeskai skillshub <keyword>` | Versioned install, favorites |
| **itismyskillmarket** | `site:github.com itismyskillmarket <keyword>` | CLI + GUI, npm + GitHub sources |

Search all 10 community marketplaces. For CLI-searchable ones (OSM, kills.sh) also run the CLI command if available.

## Step 2 — Present Results

Show a numbered list:

```
Found N skills matching "<keyword>":

1. [skill-name] — <marketplace>
   Description: ...
   Install: <install command>

2. ...
```

Show **all results found** across all marketplaces — do not cap or filter. Ask the user which one to install.

## Step 3 — Install

When the user picks a skill (by number or name), install it through Nexo's marketplace workflow. Do not install skills into the current project source tree.

Final install target:

```text
%USERPROFILE%\.NexoAgent\skills\marketplace\skillshub\<skill-key>\
```

On this machine, that resolves to:

```text
C:\Users\106681\.NexoAgent\skills\marketplace\skillshub\<skill-key>\
```

Registration requirements:

- Place `SKILL.md` under the final install target.
- Write `.nexo-skill.json` with key, name, description, source `marketplace`, marketplace id/name, install spec, and managed metadata.
- Write `.skillshub-meta.json` with slug, version, registry, and installedAt.
- Update `%USERPROFILE%\.NexoAgent\skill-state.json` so the skill key is present with `enabled: true`.

Use upstream marketplace CLIs only to stage or download the selected skill, then copy the resolved skill directory into the final Nexo target and register it. Temporary staging directories may be under the system temp directory or another disposable location, not inside the user's project repository.

Suggested staging commands by marketplace:

| Marketplace | Staging command |
|---|---|
| kills.sh | `npx skills add <owner/repo> --skill <slug> --agent claude-code --copy -y` in a temp directory |
| SkillsMP | `gh repo clone <owner/repo> <temp-dir>` |
| Agent Skills Hub | `npx agent-skills-hub install <slug> --path <temp-dir>` |
| OSM | `osm install <skill-slug>` into a temp/staging directory if supported |
| Agensi | `gh repo clone <owner/repo> <temp-dir>` |
| SkillForge | `gh repo clone <owner/repo> <temp-dir>` |
| Heurist Mesh | `npx @heurist-network/skills add <slug> --agent claude-code --copy -y` in a temp directory |
| mekaskill | `mekaskill-cli install <skill-name>` into a temp/staging directory if supported |
| SkillsHub | `npx @nodeskai/skillshub install <skill-name> --dir <temp-dir>` |
| itismyskillmarket | `skm install <skill-name>` into a temp/staging directory if supported |

After staging, locate the directory containing `SKILL.md`, copy that directory to the final Nexo target, write both metadata files, enable it in `skill-state.json`, and report success/failure with the final installed path.

## Notes

- If a CLI tool is not installed, tell the user the prerequisite and offer to install it first.
- For GitHub-based marketplaces without a dedicated CLI, clone into a temp directory first, then install/register into the final Nexo target.
- Never install without the user explicitly choosing a skill.
