---
name: skill-creator
description: Create a new SKILL.md through conversation when the user wants to turn a workflow, role, or instruction set into a reusable skill.
---

# Skill Creator

## Gather Requirements

Ask (or infer from context) these four things:

1. **Name** — short kebab-case slug (e.g. `code-reviewer`, `api-designer`)
2. **Trigger** — when should this skill activate? (user keywords, task types, explicit invocation)
3. **Purpose** — one sentence: what does the skill help the agent do better?
4. **Instructions** — the actual behavior: steps, rules, output format, tools to use

If the user has already described the skill in detail, extract these directly — don't re-ask what they've already told you.

## SKILL.md Format

```markdown
---
name: <kebab-case-slug>
description: <one sentence — used to match the skill to incoming tasks>
---

# <Title>

<Instructions as concrete steps or rules. Use headers for phases if multi-step.>
```

Rules for good skill content:
- Instructions must be **actionable** — verbs, not vague roles ("Run X before Y", not "be careful about Y").
- Include **when to use each tool** if the skill relies on specific tools.
- Include **output format** if the skill produces structured results.
- Keep it short — a skill read by an AI agent, not a human manual.

## Save the Skill

Write the file to `.kiro/skills/<name>/SKILL.md` in the user's workspace root.

Confirm the path and content with the user before writing if there's any ambiguity. After writing, show the final file content and confirm it's ready to use.
