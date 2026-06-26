import type { BrowserView, BrowserWindow } from "electron";
import type {
  BrowserAction,
  BrowserActionRequest,
  BrowserActionResponse,
  BrowserBounds,
  BrowserElementDescriptor,
  BrowserElementPickResult,
  BrowserElementSnapshot,
  BrowserHistoryEntry,
  BrowserInteractionResult,
  BrowserResolveCandidate,
  BrowserResolveResult,
  BrowserState,
} from "../../src/shared/types";
import { browserEmbeddingService } from "./browser-embedding";
import { saveGeneratedArtifact } from "./media";
import { serverLog } from "./logger";

type ElectronRuntime = typeof import("electron");

const BROWSER_PARTITION = "persist:agent-browser";
const DEFAULT_BOUNDS: BrowserBounds = { x: 0, y: 0, width: 1280, height: 800 };
const OFFSCREEN_OFFSET = 20_000;
const MIN_ZOOM_FACTOR = 0.5;
const MAX_ZOOM_FACTOR = 2.5;
const ZOOM_STEP = 0.1;
const DEFAULT_RESOLVE_LIMIT = 5;
const DEFAULT_MIN_CONFIDENCE = 0.72;
const DIRECT_ACTION_MIN_CONFIDENCE = 0.82;
const AMBIGUITY_MARGIN = 0.08;

const SNAPSHOT_HELPER = String.raw`
(() => {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const escapeCss = (value) => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
  };
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    if (!style || style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = el.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || Number.POSITIVE_INFINITY;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || Number.POSITIVE_INFINITY;
    return rect.width > 0
      && rect.height > 0
      && rect.bottom >= 0
      && rect.right >= 0
      && rect.top <= viewportHeight
      && rect.left <= viewportWidth;
  };
  const tagName = (el) => el.tagName.toLowerCase();
  const buildSelector = (el) => {
    if (el.id) return "#" + escapeCss(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      const tag = tagName(node);
      let part = tag;
      if (node.parentElement) {
        const sameTag = Array.from(node.parentElement.children).filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) {
          part += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
        }
      }
      parts.unshift(part);
      if (parts.length >= 4) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const describeRole = (el) => {
    const role = clean(el.getAttribute("role"));
    if (role) return role;
    const tag = tagName(el);
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return type;
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return undefined;
  };
  const describeName = (el) => {
    const fromIdRefs = (value) => clean(String(value ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "")
      .join(" "));
    const pieces = [
      el.getAttribute("aria-label"),
      fromIdRefs(el.getAttribute("aria-labelledby")),
      el.getAttribute("aria-description"),
      el.getAttribute("title"),
      el.getAttribute("data-tooltip"),
      el.getAttribute("data-title"),
      el.getAttribute("data-original-title"),
      el.getAttribute("placeholder"),
      el.getAttribute("alt"),
    ].map(clean).filter(Boolean);
    if (pieces.length) return pieces[0];
    if ("value" in el && clean(el.value)) return clean(el.value);
    const text = clean(el.innerText || el.textContent || "");
    if (text) return text;
    return tagName(el);
  };
  const textFromIdRefs = (value) => clean(String(value ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "")
    .join(" "));
  const associatedLabel = (el) => {
    const labels = "labels" in el && el.labels ? Array.from(el.labels).map((label) => clean(label.innerText || label.textContent || "")).filter(Boolean) : [];
    if (labels.length) return labels[0];
    if (el.id) {
      const label = document.querySelector('label[for="' + escapeCss(el.id) + '"]');
      if (label) return clean(label.innerText || label.textContent || "");
    }
    const wrapped = el.closest("label");
    return wrapped ? clean(wrapped.innerText || wrapped.textContent || "") : "";
  };
  const nearestHeading = (el) => {
    const container = el.closest("form,dialog,[role='dialog'],[role='main'],main,section,article,[aria-labelledby]");
    const labelled = textFromIdRefs(container?.getAttribute("aria-labelledby"));
    if (labelled) return labelled;
    const heading = container?.querySelector("h1,h2,h3,h4,h5,h6");
    if (heading) return clean(heading.innerText || heading.textContent || "");
    let node = el;
    while (node && node.previousElementSibling) {
      node = node.previousElementSibling;
      if (node.matches?.("h1,h2,h3,h4,h5,h6")) return clean(node.innerText || node.textContent || "");
      const nested = node.querySelector?.("h1,h2,h3,h4,h5,h6");
      if (nested) return clean(nested.innerText || nested.textContent || "");
    }
    return "";
  };
  const contextName = (el) => {
    const owner = el.closest("form,dialog,[role='dialog'],[role='toolbar'],[role='menu'],nav,header,footer,section,article");
    if (!owner) return "";
    const role = clean(owner.getAttribute("role")) || tagName(owner);
    const label = owner.getAttribute("aria-label")
      || textFromIdRefs(owner.getAttribute("aria-labelledby"))
      || owner.getAttribute("title")
      || owner.querySelector?.("h1,h2,h3,h4,h5,h6")?.textContent
      || "";
    return clean([role, label].filter(Boolean).join(" "));
  };
  const nearbyText = (el) => {
    const parent = el.parentElement;
    if (!parent) return "";
    const text = clean(parent.innerText || parent.textContent || "");
    return text.length > 160 ? text.slice(0, 160) : text;
  };
  const enabledState = (el) => {
    if (el.getAttribute("aria-disabled") === "true") return false;
    return !("disabled" in el && Boolean(el.disabled));
  };
  const hasUsefulBounds = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width >= 3 && rect.height >= 3;
  };
  const clickishPattern = /(btn|button|submit|send|compose|search|save|next|login|mail|写信|发送|提交|搜索|保存|下一步|登录)/i;
  const clickishIdentity = (el) => [
    el.id,
    el.className,
    el.getAttribute("name"),
    el.getAttribute("data-action"),
    el.getAttribute("data-cmd"),
    el.getAttribute("data-testid"),
    el.getAttribute("data-test"),
  ].map(clean).filter(Boolean).join(" ");
  const hasClickishIdentity = (el) => clickishPattern.test(clickishIdentity(el));
  const hasHandlerAttr = (el) => [
    "onclick",
    "onmousedown",
    "onmouseup",
    "onpointerdown",
    "onpointerup",
  ].some((name) => el.hasAttribute(name));
  const isNativeInteractive = (el) => el.matches(
    'a,button,input,textarea,select,summary,[role="button"],[role="link"],[role="menuitem"],[role="checkbox"],[role="radio"],[contenteditable="true"]'
  );
  const isCandidateElement = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.getAttribute("aria-hidden") === "true") return false;
    const role = clean(el.getAttribute("role")).toLowerCase();
    if (["status", "alert", "log", "progressbar", "presentation", "none"].includes(role)) return false;
    if (!isVisible(el) || !hasUsefulBounds(el)) return false;
    if (isNativeInteractive(el)) return true;

    const name = describeName(el);
    const text = clean(el.innerText || el.textContent || "");
    const hasReadableLabel = Boolean(name && name !== tagName(el)) || (text.length > 0 && text.length <= 80);
    if (!hasReadableLabel) return false;

    const tabindex = el.hasAttribute("tabindex") ? Number(el.getAttribute("tabindex")) : Number.NaN;
    const style = window.getComputedStyle(el);
    if (Number.isFinite(tabindex) && tabindex >= 0) return true;
    if (style.cursor === "pointer") return true;
    if (hasHandlerAttr(el)) return true;
    if (hasClickishIdentity(el)) return true;
    return false;
  };
  const descriptorText = (item) => {
    const parts = [
      item.name,
      item.text,
      item.ariaLabel,
      item.label,
      item.title,
      item.placeholder,
      item.identity,
      item.role,
      item.tag,
      item.type,
      item.heading ? "under " + item.heading : "",
      item.context,
      item.enabled ? "enabled" : "disabled",
    ].map(clean).filter(Boolean);
    return Array.from(new Set(parts)).join(" | ");
  };
  const elements = [];
  const refs = [];
  let warning = "";
  const candidates = [];
  for (const node of Array.from(document.querySelectorAll("*"))) {
    try {
      if (isCandidateElement(node)) candidates.push(node);
    } catch (error) {
      warning = warning ? warning + " Some elements could not be inspected." : "Some elements could not be inspected.";
    }
  }
  candidates.sort((a, b) => {
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    return ar.top - br.top || ar.left - br.left;
  });

  for (const el of candidates) {
    if (!(el instanceof HTMLElement)) continue;
    if (!isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    const ref = "e" + (elements.length + 1);
    const selector = buildSelector(el);
    if (!selector) continue;

    const ariaLabel = clean(el.getAttribute("aria-label"));
    const label = associatedLabel(el);
    const title = clean(el.getAttribute("title") || el.getAttribute("data-tooltip") || el.getAttribute("data-title") || el.getAttribute("data-original-title"));
    const placeholder = clean(el.getAttribute("placeholder"));
    const role = describeRole(el);
    const name = describeName(el);
    const item = {
      ref,
      tag: tagName(el),
      role,
      name,
      text: clean(el.innerText || el.textContent || "") || undefined,
      value: "value" in el ? clean(String(el.value ?? "")) || undefined : undefined,
      type: "type" in el ? clean(String(el.type ?? "")) || undefined : undefined,
      href: el instanceof HTMLAnchorElement ? el.href : undefined,
      editable: Boolean(el.isContentEditable || el.matches("input,textarea,select")),
      disabled: "disabled" in el ? Boolean(el.disabled) : undefined,
      checked: "checked" in el ? Boolean(el.checked) : undefined,
      selected: "selected" in el ? Boolean(el.selected) : undefined,
      ariaLabel: ariaLabel || undefined,
      label: label || undefined,
      title: title || undefined,
      placeholder: placeholder || undefined,
      identity: clickishIdentity(el) || undefined,
      heading: nearestHeading(el) || undefined,
      context: contextName(el) || undefined,
      nearbyText: nearbyText(el) || undefined,
      visible: true,
      enabled: enabledState(el),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
    elements.push({ ...item, descriptorText: descriptorText(item) });
    refs.push([ref, selector]);
  }

  const text = clean(document.body?.innerText || document.documentElement?.innerText || "");

  return {
    url: location.href,
    title: document.title || "",
    text,
    elements,
    refs,
    warning: warning || undefined,
  };
})()
`;

const PICK_ELEMENT_SCRIPT = String.raw`
(() => new Promise((resolve) => {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const escapeCss = (value) => {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
  };
  const tagName = (el) => el.tagName.toLowerCase();
  const buildSelector = (el) => {
    if (el.id) return "#" + escapeCss(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.documentElement) {
      const tag = tagName(node);
      let part = tag;
      if (node.parentElement) {
        const sameTag = Array.from(node.parentElement.children).filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) part += ":nth-of-type(" + (sameTag.indexOf(node) + 1) + ")";
      }
      parts.unshift(part);
      if (parts.length >= 5) break;
      node = node.parentElement;
    }
    return parts.join(" > ");
  };
  const describeRole = (el) => {
    const role = clean(el.getAttribute("role"));
    if (role) return role;
    const tag = tagName(el);
    if (tag === "a") return "link";
    if (tag === "button") return "button";
    if (tag === "textarea") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "input") {
      const type = (el.type || "text").toLowerCase();
      if (type === "checkbox" || type === "radio") return type;
      return "textbox";
    }
    if (el.isContentEditable) return "textbox";
    return undefined;
  };
  const describeName = (el) => {
    const fromIdRefs = (value) => clean(String(value ?? "")
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "")
      .join(" "));
    const pieces = [
      el.getAttribute("aria-label"),
      fromIdRefs(el.getAttribute("aria-labelledby")),
      el.getAttribute("title"),
      el.getAttribute("placeholder"),
      el.getAttribute("alt"),
    ].map(clean).filter(Boolean);
    if (pieces.length) return pieces[0];
    if ("value" in el && clean(el.value)) return clean(el.value);
    return clean(el.innerText || el.textContent || "") || tagName(el);
  };
  const eventTargetElement = (event) => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    const fromPath = path.find((node) => node instanceof HTMLElement && node !== overlay);
    if (fromPath) return fromPath;
    const target = event.target;
    if (target instanceof HTMLElement) return target;
    return target?.parentElement instanceof HTMLElement ? target.parentElement : null;
  };
  const describeElement = (el) => {
    const rect = el.getBoundingClientRect();
    return {
      tag: tagName(el),
      role: describeRole(el),
      name: describeName(el),
      text: clean(el.innerText || el.textContent || "") || undefined,
      value: "value" in el ? clean(String(el.value ?? "")) || undefined : undefined,
      type: "type" in el ? clean(String(el.type ?? "")) || undefined : undefined,
      href: el instanceof HTMLAnchorElement ? el.href : undefined,
      editable: Boolean(el.isContentEditable || el.matches("input,textarea,select")),
      selector: buildSelector(el),
      bounds: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  };

  let done = false;
  let previousCursor = document.documentElement.style.cursor;
  const overlay = document.createElement("div");
  overlay.setAttribute("data-nexo-element-picker", "true");
  Object.assign(overlay.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: "0px",
    height: "0px",
    pointerEvents: "none",
    zIndex: "2147483647",
    border: "2px solid #1677ff",
    background: "rgba(22, 119, 255, 0.08)",
    boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.08)",
    boxSizing: "border-box",
    transition: "left 80ms ease, top 80ms ease, width 80ms ease, height 80ms ease",
  });
  document.documentElement.style.cursor = "crosshair";
  document.body?.appendChild(overlay);

  const cleanup = () => {
    document.removeEventListener("pointermove", handleMove, true);
    document.removeEventListener("click", handleClick, true);
    document.removeEventListener("keydown", handleKeyDown, true);
    document.documentElement.style.cursor = previousCursor;
    overlay.remove();
  };
  const finish = (result) => {
    if (done) return;
    done = true;
    cleanup();
    resolve(result);
  };
  const updateOverlay = (el) => {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    Object.assign(overlay.style, {
      left: Math.round(rect.left) + "px",
      top: Math.round(rect.top) + "px",
      width: Math.round(rect.width) + "px",
      height: Math.round(rect.height) + "px",
    });
  };
  function handleMove(event) {
    updateOverlay(eventTargetElement(event));
  }
  function handleClick(event) {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const el = eventTargetElement(event);
    if (!el) {
      finish({ ok: false, url: location.href, title: document.title || "", error: "No element was selected." });
      return;
    }
    finish({ ok: true, url: location.href, title: document.title || "", element: describeElement(el) });
  }
  function handleKeyDown(event) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    finish({ ok: false, url: location.href, title: document.title || "", error: "Element selection cancelled." });
  }

  document.addEventListener("pointermove", handleMove, true);
  document.addEventListener("click", handleClick, true);
  document.addEventListener("keydown", handleKeyDown, true);
  setTimeout(() => {
    finish({ ok: false, url: location.href, title: document.title || "", error: "Element selection timed out." });
  }, 30000);
}))()
`;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) throw new Error("Missing URL.");
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`browser_action only accepts http or https URLs, got ${parsed.protocol || "unknown"}.`);
  }
  return parsed.toString();
}

function defaultBounds(bounds?: Partial<BrowserBounds>) {
  return {
    x: Math.floor(Number(bounds?.x ?? DEFAULT_BOUNDS.x)),
    y: Math.floor(Number(bounds?.y ?? DEFAULT_BOUNDS.y)),
    width: Math.max(1, Math.floor(Number(bounds?.width ?? DEFAULT_BOUNDS.width))),
    height: Math.max(1, Math.floor(Number(bounds?.height ?? DEFAULT_BOUNDS.height))),
  };
}

function offscreen(bounds: BrowserBounds): BrowserBounds {
  return {
    x: -OFFSCREEN_OFFSET,
    y: -OFFSCREEN_OFFSET,
    width: Math.max(1, bounds.width),
    height: Math.max(1, bounds.height),
  };
}

function refError(ref: string) {
  return `Invalid browser element ref: ${ref}. Take a new snapshot before clicking or typing.`;
}

function normalizeForResolve(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textTerms(value: string) {
  const normalized = normalizeForResolve(value);
  const withoutGeneric = normalized.replace(
    /\b(button|link|input|field|control|please|click|press|type|enter|choose|select|the|a|an)\b/g,
    " ",
  );
  const cjkChars = withoutGeneric.match(/[\p{Script=Han}]/gu) ?? [];
  const latinTerms = withoutGeneric.match(/[a-z0-9]+/g) ?? [];
  const cjkPhrases = withoutGeneric
    .split(/\s+/)
    .filter((part) => /[\p{Script=Han}]/u.test(part) && part.length > 1);
  return [...new Set([...latinTerms, ...cjkPhrases, ...cjkChars].filter((term) => term.length > 0))];
}

const ACTION_SYNONYMS: Array<{ key: string; terms: string[]; role?: string; editable?: boolean }> = [
  { key: "send", terms: ["send", "submit", "发送", "发出", "寄出", "提交"], role: "button" },
  { key: "search", terms: ["search", "find", "搜索", "查询", "查找"], role: "button" },
  { key: "login", terms: ["login", "sign in", "log in", "登录", "登入"], role: "button" },
  { key: "next", terms: ["next", "continue", "下一步", "继续"], role: "button" },
  { key: "save", terms: ["save", "保存"], role: "button" },
  { key: "cancel", terms: ["cancel", "取消"], role: "button" },
  { key: "close", terms: ["close", "关闭"], role: "button" },
  { key: "delete", terms: ["delete", "remove", "删除", "移除"], role: "button" },
  { key: "recipient", terms: ["recipient", "to", "收件人", "联系人"], editable: true },
  { key: "subject", terms: ["subject", "主题", "标题"], editable: true },
  { key: "body", terms: ["body", "正文", "内容"], editable: true },
];

const STRICT_CLICK_ACTIONS = new Set(["send", "delete", "save", "login", "cancel"]);

function strictClickActionForQuery(query: string) {
  return ACTION_SYNONYMS.find((group) =>
    group.role === "button"
    && STRICT_CLICK_ACTIONS.has(group.key)
    && hasAny(query, group.terms)
  );
}

function inferRole(query: string, explicitRole?: string, action?: BrowserAction) {
  const normalized = normalizeForResolve(query);
  if (explicitRole?.trim()) return explicitRole.trim().toLowerCase();
  if (action === "type") return "textbox";
  if (action === "click") return "button";
  if (/(输入框|文本框|正文|内容|收件人|主题|input|field|textbox|type|enter)/i.test(normalized)) return "textbox";
  if (/(链接|link)/i.test(normalized)) return "link";
  if (/(按钮|点击|点|按|提交|发送|button|click|press|submit|send)/i.test(normalized)) return "button";
  return "";
}

function descriptorSearchText(item: BrowserElementDescriptor) {
  return [
    item.descriptorText,
    item.name,
    item.text,
    item.value,
    item.ariaLabel,
    item.label,
    item.title,
    item.placeholder,
    item.identity,
    item.heading,
    item.context,
    item.nearbyText,
    item.role,
    item.tag,
    item.type,
  ].filter(Boolean).join(" | ");
}

function hasAny(value: string, terms: string[]) {
  const normalized = normalizeForResolve(value);
  return terms.some((term) => normalized.includes(normalizeForResolve(term)));
}

function editDistance(a: string, b: string) {
  const left = [...a];
  const right = [...b];
  const dp = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[left.length][right.length];
}

function computeLexicalScore(query: string, item: BrowserElementDescriptor) {
  const target = normalizeForResolve(descriptorSearchText(item));
  const name = normalizeForResolve([item.name, item.ariaLabel, item.label, item.title, item.placeholder].filter(Boolean).join(" "));
  const queryNorm = normalizeForResolve(query);
  const terms = textTerms(query);
  let score = 0;
  const reasons: string[] = [];

  if (queryNorm && name && name === queryNorm) {
    score = Math.max(score, 1);
    reasons.push("exact-name");
  }
  if (queryNorm && name && (name.includes(queryNorm) || queryNorm.includes(name))) {
    score = Math.max(score, 0.88);
    reasons.push("name-contains");
  }

  if (terms.length) {
    const hits = terms.filter((term) => target.includes(term));
    if (hits.length) {
      score = Math.max(score, Math.min(0.82, hits.length / terms.length));
      reasons.push(`term-match:${hits.slice(0, 4).join(",")}`);
    }
    const targetTerms = textTerms(target).filter((term) => term.length >= 2);
    const fuzzyHits = terms.filter((term) =>
      term.length >= 2 && targetTerms.some((targetTerm) => {
        const maxLength = Math.max(term.length, targetTerm.length);
        return maxLength <= 12 && editDistance(term, targetTerm) / maxLength <= 0.28;
      })
    );
    if (fuzzyHits.length) {
      score = Math.max(score, Math.min(0.68, fuzzyHits.length / terms.length));
      reasons.push(`fuzzy-match:${fuzzyHits.slice(0, 3).join(",")}`);
    }
  }

  for (const group of ACTION_SYNONYMS) {
    if (hasAny(query, group.terms) && hasAny(target, group.terms)) {
      score = Math.max(score, 0.76);
      reasons.push(`synonym:${group.key}`);
    }
  }

  return { score, reasons };
}

function computeRoleScore(query: string, item: BrowserElementDescriptor, roleHint: string, action?: BrowserAction) {
  const role = String(item.role ?? "").toLowerCase();
  const tag = String(item.tag ?? "").toLowerCase();
  const type = String(item.type ?? "").toLowerCase();
  const inferred = inferRole(query, roleHint, action);
  const isButtonLike = role === "button" || tag === "button" || type === "submit" || type === "button";
  const isLinkLike = role === "link" || tag === "a";
  const isTextboxLike = Boolean(item.editable) || role === "textbox" || tag === "input" || tag === "textarea";

  if (!inferred) return { score: 0.45, reasons: [] as string[] };
  if (inferred === "button" && isButtonLike) return { score: 1, reasons: ["role-button"] };
  if (inferred === "link" && isLinkLike) return { score: 1, reasons: ["role-link"] };
  if ((inferred === "textbox" || inferred === "input") && isTextboxLike) return { score: 1, reasons: ["role-editable"] };
  return { score: 0.1, reasons: ["role-mismatch"] };
}

function computeContextScore(query: string, item: BrowserElementDescriptor, recent?: BrowserElementDescriptor | null) {
  const contextText = [item.heading, item.context, item.nearbyText].filter(Boolean).join(" | ");
  const queryTerms = textTerms(query);
  const contextNorm = normalizeForResolve(contextText);
  const hits = queryTerms.filter((term) => contextNorm.includes(term)).length;
  let score = queryTerms.length ? Math.min(0.75, hits / queryTerms.length) : 0.35;
  const reasons: string[] = hits ? ["context-match"] : [];
  if (recent?.context && item.context && recent.context === item.context) {
    score = Math.max(score, 0.72);
    reasons.push("recent-context");
  }
  return { score, reasons };
}

function computeStateScore(item: BrowserElementDescriptor) {
  if (item.enabled === false || item.disabled) return { score: 0, reasons: ["disabled"] };
  if (item.visible === false) return { score: 0.05, reasons: ["hidden"] };
  return { score: 1, reasons: ["enabled-visible"] };
}

function cosineSimilarity(a?: number[], b?: number[]) {
  if (!a?.length || !b?.length || a.length !== b.length) return undefined;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += a[index] * b[index];
    magA += a[index] * a[index];
    magB += b[index] * b[index];
  }
  if (!magA || !magB) return undefined;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function browserScript(kind: "click" | "type" | "scroll", payload: Record<string, unknown>) {
  return `(() => {
    const payload = ${JSON.stringify(payload)};
    const el = payload.selector
      ? document.querySelector(payload.selector)
      : (${JSON.stringify(kind)} === "type" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
    try {
      if (${JSON.stringify(kind)} === "scroll") {
        window.scrollBy({
          ${payload.direction === "left" || payload.direction === "right" ? `left: ${payload.direction === "left" ? "-" : ""}${payload.amount ?? 720},` : `top: ${payload.direction === "up" ? "-" : ""}${payload.amount ?? 720},`}
          behavior: "auto",
        });
        return { ok: true };
      }

      if (!el) {
        return { ok: false, error: ${JSON.stringify(refError(String(payload.ref ?? "")))} };
      }

      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", inline: "center" });
      }

      if (${JSON.stringify(kind)} === "click") {
        el.focus?.();
        const rect = el.getBoundingClientRect();
        return {
          ok: true,
          bounds: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          },
        };
      }

      const value = String(payload.text ?? "");
      const shouldSubmit = Boolean(payload.submit);

      if (el.isContentEditable) {
        el.focus();
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(el);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
        }
        if (!document.execCommand("insertText", false, value)) {
          el.textContent = value;
        }
        el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: value }));
        if (shouldSubmit) {
          const form = el.closest("form");
          if (form && typeof form.requestSubmit === "function") form.requestSubmit();
        }
        return { ok: true };
      }

      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) {
        return { ok: false, error: "browser_action.type requires an editable input, textarea, select, or contenteditable element." };
      }

      el.focus();
      if (el instanceof HTMLSelectElement) {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        if (shouldSubmit) {
          const form = el.closest("form");
          if (form && typeof form.requestSubmit === "function") form.requestSubmit();
        }
        return { ok: true };
      }

      const currentValue = "value" in el ? String(el.value ?? "") : "";
      const start = typeof el.selectionStart === "number" ? el.selectionStart : currentValue.length;
      const end = typeof el.selectionEnd === "number" ? el.selectionEnd : currentValue.length;
      const nextValue = currentValue.slice(0, start) + value + currentValue.slice(end);
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(el, nextValue);
      if (typeof el.setSelectionRange === "function") {
        const cursor = start + value.length;
        el.setSelectionRange(cursor, cursor);
      }
      el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
      if (shouldSubmit) {
        const form = el.closest("form");
        if (form && typeof form.requestSubmit === "function") form.requestSubmit();
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })()`;
}

type BrowserSnapshot = {
  url: string;
  title: string;
  text: string;
  elements: BrowserElementDescriptor[];
  refs: Array<[string, string]>;
  warning?: string;
};

type BrowserClickScriptResult = {
  ok?: boolean;
  error?: string;
  bounds?: BrowserBounds;
};

export class BrowserManager {
  private mainWindow: BrowserWindow | null = null;
  private browserView: BrowserView | null = null;
  private mode: "hidden" | "workbench" = "hidden";
  private bounds: BrowserBounds = DEFAULT_BOUNDS;
  private actionQueue: Promise<unknown> = Promise.resolve();
  private state: BrowserState = {
    url: "about:blank",
    title: "Blank page",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    presentation: "hidden",
    zoomFactor: 1,
    history: [],
    elements: [],
    text: "",
  };
  private elementSelectors = new Map<string, string>();
  private elementDescriptors = new Map<string, BrowserElementDescriptor>();
  private history: BrowserHistoryEntry[] = [];
  private recentInteractionRef = "";
  private elementPickActive = false;

  setMainWindow(window: BrowserWindow | null) {
    if (!window) {
      this.detach();
      this.mainWindow = null;
      return;
    }

    this.mainWindow = window;
    if (window && this.browserView) {
      this.attachTo(window);
      this.layout();
      this.emit();
      return;
    }
  }

  destroy() {
    this.detach();
    this.browserView = null;
    this.elementSelectors.clear();
    this.elementDescriptors.clear();
  }

  async openWorkbench() {
    this.mode = "workbench";
    await this.ensure();
    browserEmbeddingService.warmup();
    this.layout();
    this.emit();
  }

  async closeWorkbench() {
    this.mode = "hidden";
    await this.ensure();
    this.layout();
    this.emit();
  }

  async updateBounds(bounds: Partial<BrowserBounds>) {
    this.bounds = defaultBounds({ ...this.bounds, ...bounds });
    this.layout();
    this.emit();
  }

  syncWindowBounds(bounds: Partial<BrowserBounds>) {
    this.bounds = defaultBounds({ ...this.bounds, ...bounds });
    this.layout();
    this.emit();
  }

  getState(): BrowserState {
    return {
      ...this.state,
      loading: this.browserView?.webContents.isLoading() ?? this.state.loading,
      canGoBack: this.browserView?.webContents.navigationHistory.canGoBack() ?? this.state.canGoBack,
      canGoForward: this.browserView?.webContents.navigationHistory.canGoForward() ?? this.state.canGoForward,
      presentation: this.mode,
      zoomFactor: this.browserView?.webContents.getZoomFactor() ?? this.state.zoomFactor ?? 1,
      history: this.history,
    };
  }

  async setZoom(mode: "in" | "out" | "reset"): Promise<BrowserState> {
    await this.ensure();
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const current = this.browserView.webContents.getZoomFactor();
    const next = mode === "reset"
      ? 1
      : mode === "in"
        ? Math.min(MAX_ZOOM_FACTOR, current + ZOOM_STEP)
        : Math.max(MIN_ZOOM_FACTOR, current - ZOOM_STEP);
    this.browserView.webContents.setZoomFactor(Number(next.toFixed(2)));
    this.state = { ...this.state, zoomFactor: this.browserView.webContents.getZoomFactor() };
    this.emit();
    return this.getState();
  }

  async executeAction(request: BrowserActionRequest): Promise<BrowserActionResponse> {
    const run = async () => {
      await this.ensure();
      if (request.action === "resolve" || request.query?.trim()) {
        browserEmbeddingService.warmup();
      }
      switch (request.action) {
        case "snapshot":
          return this.snapshot("snapshot");
        case "resolve":
          return this.resolve(request);
        case "navigate":
          return this.navigate(request.url);
        case "click":
          return this.click(request.ref, request.query, request.minConfidence);
        case "type":
          return this.type(request.ref, request.query, request.text ?? "", Boolean(request.submit), request.minConfidence);
        case "scroll":
          return this.scroll(request.direction ?? "down", request.amount);
        case "screenshot":
          return this.screenshot();
        case "refresh":
          return this.refresh();
        case "back":
          return this.back();
        case "forward":
          return this.forward();
        default:
          throw new Error(`Unsupported browser_action.action: ${String(request.action)}. Supported actions: snapshot, resolve, navigate, click, type, scroll, screenshot, refresh, back, forward.`);
      }
    };

    const queued = this.actionQueue.then(run, run);
    this.actionQueue = queued.catch(() => undefined);
    return queued;
  }

  async pickElement(): Promise<BrowserElementPickResult> {
    await this.ensure();
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    if (this.elementPickActive) {
      return {
        ok: false,
        url: this.browserView.webContents.getURL() || this.state.url,
        title: this.browserView.webContents.getTitle() || this.state.title,
        error: "Element picker is already active.",
      };
    }

    this.elementPickActive = true;
    try {
      await this.waitForIdle();
      const result = await this.browserView.webContents.executeJavaScript(PICK_ELEMENT_SCRIPT, true) as BrowserElementPickResult;
      return {
        ...result,
        url: result.url || this.browserView.webContents.getURL() || this.state.url,
        title: result.title || this.browserView.webContents.getTitle() || this.state.title,
      };
    } catch (error) {
      return {
        ok: false,
        url: this.browserView.webContents.getURL() || this.state.url,
        title: this.browserView.webContents.getTitle() || this.state.title,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      this.elementPickActive = false;
    }
  }

  private async ensure() {
    if (this.browserView) {
      if (this.mainWindow) {
        this.attachTo(this.mainWindow);
      }
      return;
    }

    const electron = await import("electron").catch(() => {
      throw new Error("Browser runtime is only available in the Electron desktop app.");
    });
    if (typeof electron.BrowserView !== "function") {
      throw new Error("Browser runtime is only available in the Electron desktop app.");
    }

    this.browserView = new electron.BrowserView({
      webPreferences: {
        partition: BROWSER_PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        devTools: false,
      },
    });

    this.installEvents();
    this.browserView.webContents.setBackgroundThrottling(false);
    await this.browserView.webContents.loadURL("about:blank").catch((error) => {
      serverLog(`[browser] failed to load initial blank page: ${error instanceof Error ? error.message : String(error)}`);
    });
    if (this.mainWindow) {
      this.attachTo(this.mainWindow);
    }
    this.layout();
  }

  private installEvents() {
    if (!this.browserView) return;
    const { shell } = require("electron") as ElectronRuntime;
    const { webContents } = this.browserView;
    webContents.setWindowOpenHandler(({ url }) => {
      const protocol = (() => {
        try {
          return new URL(url).protocol;
        } catch {
          return "";
        }
      })();
      if (protocol === "http:" || protocol === "https:") {
        void webContents.loadURL(url).catch((error) => {
          serverLog(`[browser] failed to load popup URL ${url}: ${error instanceof Error ? error.message : String(error)}`);
        });
      } else if (url) {
        void shell.openExternal(url).catch((error) => {
          serverLog(`[browser] failed to open external URL ${url}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
      return { action: "deny" };
    });

    const sync = (clearSnapshot = false, historyAction?: BrowserAction) => {
      if (!this.browserView) return;
      if (clearSnapshot) {
        this.elementSelectors.clear();
        this.elementDescriptors.clear();
      }
      this.state = {
        ...this.state,
        url: webContents.getURL() || this.state.url,
        title: webContents.getTitle() || this.state.title,
        loading: webContents.isLoading(),
        canGoBack: webContents.navigationHistory.canGoBack(),
        canGoForward: webContents.navigationHistory.canGoForward(),
        zoomFactor: webContents.getZoomFactor(),
        elements: clearSnapshot ? [] : this.state.elements,
        resolve: clearSnapshot ? undefined : this.state.resolve,
        text: clearSnapshot ? "" : this.state.text,
        warning: clearSnapshot ? undefined : this.state.warning,
        history: this.history,
        presentation: this.mode,
      };
      if (historyAction && !webContents.isLoading()) {
        this.recordHistory(historyAction);
      }
      this.emit();
    };

    webContents.on("did-start-loading", () => sync(true));
    webContents.on("did-stop-loading", () => sync(false, "navigate"));
    webContents.on("did-navigate", () => sync(true));
    webContents.on("did-navigate-in-page", () => sync(true, "navigate"));
    webContents.on("page-title-updated", (_event, title) => {
      this.state = { ...this.state, title };
      this.recordHistory(this.state.lastAction ?? "snapshot");
      this.emit();
    });
    webContents.on("did-fail-load", (_event, code, description, validatedURL) => {
      this.state = { ...this.state, error: `Failed to load ${validatedURL}: ${description} (${code})`, loading: false };
      this.emit();
    });
    webContents.on("render-process-gone", (_event, details) => {
      this.state = { ...this.state, error: `Browser renderer stopped: ${details.reason}`, loading: false };
      this.emit();
    });
    webContents.on("will-navigate", (event, url) => {
      const protocol = (() => {
        try {
          return new URL(url).protocol;
        } catch {
          return "";
        }
      })();
      if (protocol && !["http:", "https:", "about:", "data:"].includes(protocol)) {
        event.preventDefault();
        void shell.openExternal(url).catch((error) => {
          serverLog(`[browser] failed to open external navigation ${url}: ${error instanceof Error ? error.message : String(error)}`);
        });
      }
    });
  }

  private attachTo(window: BrowserWindow) {
    if (!this.browserView) return;
    if (window.getBrowserViews().includes(this.browserView)) return;
    try {
      window.addBrowserView(this.browserView);
    } catch {
      window.setBrowserView(this.browserView);
    }
  }

  private detach() {
    if (!this.browserView) return;
    const owner = this.mainWindow;
    if (!owner) return;
    try {
      owner.removeBrowserView(this.browserView);
    } catch {
      try {
        owner.setBrowserView(null);
      } catch {
        // no-op
      }
    }
  }

  private layout() {
    if (!this.browserView) return;
    const bounds = this.mode === "workbench" ? this.bounds : offscreen(this.bounds);
    try {
      this.browserView.setBounds(bounds);
    } catch (error) {
      serverLog(`[browser] failed to set bounds: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async waitForIdle() {
    if (!this.browserView) return;
    const { webContents } = this.browserView;
    if (!webContents.isLoading()) {
      await delay(80);
      return;
    }
    await Promise.race([
      new Promise<void>((resolve) => {
        const done = () => resolve();
        webContents.once("did-stop-loading", done);
        webContents.once("did-finish-load", done);
      }),
      delay(2000),
    ]);
  }

  private async waitForPossibleNavigation(previousUrl: string) {
    if (!this.browserView) return;
    const { webContents } = this.browserView;
    if (webContents.isLoading() || webContents.getURL() !== previousUrl) return;

    await Promise.race([
      new Promise<void>((resolve) => {
        const done = () => {
          webContents.removeListener("did-start-loading", done);
          webContents.removeListener("did-navigate", done);
          webContents.removeListener("did-navigate-in-page", done);
          resolve();
        };
        webContents.once("did-start-loading", done);
        webContents.once("did-navigate", done);
        webContents.once("did-navigate-in-page", done);
      }),
      delay(350),
    ]);
  }

  private async waitForDomSettled(maxMs = 1400, stableMs = 220) {
    if (!this.browserView) return;
    const { webContents } = this.browserView;
    const deadline = Date.now() + maxMs;
    let lastSignature = "";
    let stableSince = Date.now();

    while (Date.now() < deadline) {
      if (webContents.isLoading()) {
        await delay(80);
        continue;
      }

      const signature = await webContents.executeJavaScript(
        String.raw`(() => {
          const text = String(document.body?.innerText || document.documentElement?.innerText || "")
            .replace(/\s+/g, " ")
            .trim();
          return [location.href, document.title, document.readyState, text.length, text.slice(0, 300)].join("\n");
        })()`,
        true,
      ).catch(() => "");

      if (signature && signature === lastSignature) {
        if (Date.now() - stableSince >= stableMs) return;
      } else {
        lastSignature = signature;
        stableSince = Date.now();
      }
      await delay(100);
    }
  }

  private async waitForActionSettled(previousUrl?: string) {
    if (!this.browserView) return;
    if (previousUrl) {
      await this.waitForPossibleNavigation(previousUrl);
    }
    await this.waitForIdle();
    await this.waitForDomSettled();
  }

  private async snapshot(action: BrowserAction): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    await this.waitForIdle();
    await this.waitForDomSettled(700, 160);
    const payload = await this.browserView.webContents.executeJavaScript(SNAPSHOT_HELPER, true) as BrowserSnapshot;
    this.elementSelectors = new Map(payload.refs);
    this.elementDescriptors = new Map(payload.elements.map((element) => [element.ref, element]));
    this.state = {
      ...this.state,
      url: payload.url,
      title: payload.title || this.state.title,
      loading: this.browserView.webContents.isLoading(),
      canGoBack: this.browserView.webContents.navigationHistory.canGoBack(),
      canGoForward: this.browserView.webContents.navigationHistory.canGoForward(),
      zoomFactor: this.browserView.webContents.getZoomFactor(),
      elements: payload.elements,
      resolve: action === "resolve" ? this.state.resolve : undefined,
      text: payload.text,
      warning: payload.warning,
      error: undefined,
      lastAction: action,
      history: this.history,
      presentation: this.mode,
    };
    this.recordHistory(action);
    this.emit();
    return { ok: true, ...this.getState() };
  }

  private recordHistory(action: BrowserAction) {
    const url = this.state.url;
    if (!url || url === "about:blank") return;
    if (!/^https?:\/\//i.test(url)) return;
    const title = this.state.title || url;
    const previousIndex = this.history.findIndex((entry) => entry.url === url);
    const nextEntry: BrowserHistoryEntry = {
      url,
      title,
      timestamp: new Date().toISOString(),
      action,
    };
    this.history = [
      nextEntry,
      ...this.history.filter((_, index) => index !== previousIndex),
    ];
    this.state = { ...this.state, history: this.history };
  }

  private getRecentDescriptor() {
    return this.recentInteractionRef ? this.elementDescriptors.get(this.recentInteractionRef) ?? null : null;
  }

  private async buildResolveResult(
    query: string,
    options: { role?: string; limit?: number; minConfidence?: number; action?: BrowserAction; requireEditable?: boolean } = {},
  ): Promise<BrowserResolveResult> {
    const cleanQuery = query.trim();
    const limit = Math.max(1, Math.min(20, Math.floor(Number(options.limit ?? DEFAULT_RESOLVE_LIMIT) || DEFAULT_RESOLVE_LIMIT)));
    const minConfidence = Math.max(0, Math.min(1, Number(options.minConfidence ?? DEFAULT_MIN_CONFIDENCE)));
    const descriptors = Array.from(this.elementDescriptors.values());
    const descriptorTexts = descriptors.map((item) => item.descriptorText || descriptorSearchText(item));
    const embedding = await browserEmbeddingService.embed([cleanQuery, ...descriptorTexts]);
    const queryVector = embedding.vectors.get(cleanQuery);
    const recent = this.getRecentDescriptor();

    const candidates: BrowserResolveCandidate[] = descriptors.map((item) => {
      const descriptorText = item.descriptorText || descriptorSearchText(item);
      const semanticRaw = cosineSimilarity(queryVector, embedding.vectors.get(descriptorText));
      const semanticScore = typeof semanticRaw === "number" ? Math.max(0, Math.min(1, (semanticRaw + 1) / 2)) : undefined;
      const lexical = computeLexicalScore(cleanQuery, item);
      const role = computeRoleScore(cleanQuery, item, options.role ?? "", options.action);
      const context = computeContextScore(cleanQuery, item, recent);
      const state = computeStateScore(item);
      const semanticReady = typeof semanticScore === "number";
      const confidence = semanticReady
        ? semanticScore * 0.4 + lexical.score * 0.25 + role.score * 0.15 + context.score * 0.15 + state.score * 0.05
        : lexical.score * 0.45 + role.score * 0.25 + context.score * 0.2 + state.score * 0.1;
      const reasons = [
        ...lexical.reasons,
        ...role.reasons,
        ...context.reasons,
        ...state.reasons,
        ...(semanticReady ? ["semantic-minilm"] : []),
      ];
      return {
        ...item,
        confidence: Number(confidence.toFixed(4)),
        lexicalScore: Number(lexical.score.toFixed(4)),
        semanticScore: typeof semanticScore === "number" ? Number(semanticScore.toFixed(4)) : undefined,
        roleScore: Number(role.score.toFixed(4)),
        contextScore: Number(context.score.toFixed(4)),
        stateScore: Number(state.score.toFixed(4)),
        reasons: reasons.length ? [...new Set(reasons)] : ["weak-match"],
      };
    }).sort((a, b) => b.confidence - a.confidence);

    const filtered = options.requireEditable
      ? candidates.filter((candidate) => candidate.editable)
      : candidates;
    const top = filtered.slice(0, limit);
    const best = top[0];
    const second = top[1];
    const strictAction = options.action === "click" ? strictClickActionForQuery(cleanQuery) : undefined;
    const strictActionMismatch = Boolean(
      strictAction
      && best
      && !hasAny(descriptorSearchText(best), strictAction.terms)
    );
    const ambiguous = Boolean(
      !best
      || best.confidence < minConfidence
      || (second && best.confidence - second.confidence < AMBIGUITY_MARGIN)
      || best.enabled === false
      || best.disabled
      || (options.requireEditable && !best.editable)
      || strictActionMismatch
    );

    return {
      query: cleanQuery,
      candidates: top,
      semanticModel: browserEmbeddingService.model,
      semanticReady: embedding.ready,
      semanticPending: embedding.pending || undefined,
      semanticError: embedding.error,
      needsDisambiguation: ambiguous || undefined,
      needsVisionFallback: (!best || best.confidence < Math.min(0.55, minConfidence)) || undefined,
      strictActionMismatch: strictActionMismatch || undefined,
      selectedRef: ambiguous ? undefined : best.ref,
      minConfidence,
    };
  }

  private async resolve(request: BrowserActionRequest): Promise<BrowserActionResponse> {
    const query = request.query?.trim() || request.text?.trim() || "";
    if (!query) throw new Error("browser_action.resolve requires query.");
    await this.snapshot("resolve");
    const result = await this.buildResolveResult(query, {
      role: request.role,
      limit: request.limit,
      minConfidence: request.minConfidence,
      action: "resolve",
    });
    this.state = { ...this.state, resolve: result, lastAction: "resolve", error: undefined };
    this.emit();
    return { ok: true, ...this.getState(), resolve: result };
  }

  private async resolveRefForAction(
    query: string,
    action: "click" | "type",
    minConfidence?: number,
  ): Promise<{ ref?: string; resolve: BrowserResolveResult }> {
    await this.snapshot("resolve");
    const result = await this.buildResolveResult(query, {
      action,
      role: action === "type" ? "textbox" : "button",
      minConfidence: minConfidence ?? DIRECT_ACTION_MIN_CONFIDENCE,
      requireEditable: action === "type",
    });
    return { ref: result.selectedRef, resolve: result };
  }

  private blockedResolveResponse(resolve: BrowserResolveResult, message: string): BrowserActionResponse {
    this.state = {
      ...this.state,
      resolve,
      error: message,
      lastAction: "resolve",
    };
    this.emit();
    return { ok: false, ...this.getState(), resolve };
  }

  private async navigate(url?: string): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const target = normalizeUrl(String(url ?? ""));
    await this.browserView.webContents.loadURL(target);
    await this.waitForActionSettled();
    return this.snapshot("navigate");
  }

  private async click(ref?: string, query?: string, minConfidence?: number): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    let resolveResult: BrowserResolveResult | undefined;
    if (!ref?.trim() && query?.trim()) {
      const resolved = await this.resolveRefForAction(query, "click", minConfidence);
      resolveResult = resolved.resolve;
      if (!resolved.ref) {
        return this.blockedResolveResponse(
          resolveResult,
          resolveResult.strictActionMismatch
            ? "DOM resolver refused to click because the best candidate is only semantically related and does not contain the requested action text."
            : "DOM resolver could not choose a unique high-confidence element to click.",
        );
      }
      ref = resolved.ref;
    }
    const previousUrl = this.browserView.webContents.getURL();
    const key = String(ref ?? "").trim();
    const selector = this.elementSelectors.get(key);
    if (!selector) throw new Error(refError(key));
    const script = browserScript("click", { ref: key, selector });
    const result = await this.browserView.webContents.executeJavaScript(script, true) as BrowserClickScriptResult;
    if (!result?.ok) throw new Error(result?.error || refError(key));
    const interaction = await this.sendMouseClickAt(result.bounds);
    this.recentInteractionRef = key;
    await this.waitForActionSettled(previousUrl);
    const response = await this.snapshot("click");
    const clickInteraction = {
      ...interaction,
      action: "click" as const,
      ref: key,
      query,
      bounds: result.bounds,
    };
    return resolveResult
      ? { ...response, resolve: resolveResult, interaction: clickInteraction }
      : { ...response, interaction: clickInteraction };
  }

  private async sendMouseClickAt(bounds?: BrowserBounds): Promise<Omit<BrowserInteractionResult, "action">> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      throw new Error("DOM resolver found the element, but it has no clickable bounds.");
    }
    const x = Math.round(bounds.x + bounds.width / 2);
    const y = Math.round(bounds.y + bounds.height / 2);
    const { webContents } = this.browserView;

    webContents.focus();
    if (await this.sendCdpMouseClick(x, y)) {
      return { strategy: "cdp", x, y };
    }

    const viewBounds = this.browserView.getBounds();
    const zoomFactor = webContents.getZoomFactor() || 1;
    const fallbackX = clamp(Math.round(x * zoomFactor), 1, Math.max(1, viewBounds.width - 1));
    const fallbackY = clamp(Math.round(y * zoomFactor), 1, Math.max(1, viewBounds.height - 1));
    webContents.sendInputEvent({ type: "mouseMove", x: fallbackX, y: fallbackY, movementX: 0, movementY: 0 });
    webContents.sendInputEvent({ type: "mouseDown", x: fallbackX, y: fallbackY, button: "left", clickCount: 1 });
    await delay(35);
    webContents.sendInputEvent({ type: "mouseUp", x: fallbackX, y: fallbackY, button: "left", clickCount: 1 });
    return { strategy: "electron-input", x, y, fallbackX, fallbackY };
  }

  private async sendCdpMouseClick(x: number, y: number) {
    if (!this.browserView) return false;
    const { debugger: cdp } = this.browserView.webContents;
    const wasAttached = cdp.isAttached();
    try {
      if (!wasAttached) cdp.attach("1.3");
      const timestamp = () => Date.now() / 1000;
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none",
        buttons: 0,
        modifiers: 0,
        timestamp: timestamp(),
      });
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1,
        modifiers: 0,
        timestamp: timestamp(),
      });
      await delay(50);
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1,
        modifiers: 0,
        timestamp: timestamp(),
      });
      return true;
    } catch (error) {
      serverLog(`[browser] CDP click failed; falling back to Electron input: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    } finally {
      if (!wasAttached && cdp.isAttached()) {
        try {
          cdp.detach();
        } catch {
          // no-op
        }
      }
    }
  }

  private async type(ref?: string, query?: string, text = "", submit = false, minConfidence?: number): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    let resolveResult: BrowserResolveResult | undefined;
    if (!ref?.trim() && query?.trim()) {
      const resolved = await this.resolveRefForAction(query, "type", minConfidence);
      resolveResult = resolved.resolve;
      if (!resolved.ref) {
        return this.blockedResolveResponse(
          resolveResult,
          "DOM resolver could not choose a unique high-confidence editable element to type into.",
        );
      }
      ref = resolved.ref;
    }
    const previousUrl = this.browserView.webContents.getURL();
    const key = String(ref ?? "").trim();
    const selector = this.elementSelectors.get(key);
    const script = browserScript("type", { ref: key, selector, text, submit });
    const result = await this.browserView.webContents.executeJavaScript(script, true) as { ok?: boolean; error?: string };
    if (!result?.ok) throw new Error(result?.error || refError(key));
    this.recentInteractionRef = selector ? key : "";
    await this.waitForActionSettled(previousUrl);
    const response = await this.snapshot("type");
    return resolveResult ? { ...response, resolve: resolveResult } : response;
  }

  private async scroll(direction: "up" | "down" | "left" | "right", amount?: number): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const script = browserScript("scroll", { direction, amount: Math.max(1, Math.floor(Number(amount ?? 0) || 0)) || 720 });
    await this.browserView.webContents.executeJavaScript(script, true);
    await this.waitForActionSettled();
    return this.snapshot("scroll");
  }

  private async refresh(): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    this.browserView.webContents.reload();
    await this.waitForActionSettled();
    return this.snapshot("refresh");
  }

  private async back(): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    if (!this.browserView.webContents.navigationHistory.canGoBack()) {
      throw new Error("Browser history cannot go back.");
    }
    this.browserView.webContents.navigationHistory.goBack();
    await this.waitForActionSettled();
    return this.snapshot("back");
  }

  private async forward(): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    if (!this.browserView.webContents.navigationHistory.canGoForward()) {
      throw new Error("Browser history cannot go forward.");
    }
    this.browserView.webContents.navigationHistory.goForward();
    await this.waitForActionSettled();
    return this.snapshot("forward");
  }

  private async screenshot(): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const image = await this.browserView.webContents.capturePage(undefined, { stayHidden: true });
    const artifact = await saveGeneratedArtifact(image.toPNG(), "image/png", "browser");
    this.state = { ...this.state, lastAction: "screenshot", error: undefined, warning: undefined };
    this.emit();
    return { ok: true, ...this.getState(), artifact };
  }

  private emit() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
    this.mainWindow.webContents.send("browser:state-changed", this.getState());
  }
}

export const browserManager = new BrowserManager();
