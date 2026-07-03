import type { BrowserView, BrowserWindow } from "electron";
import { inspect } from "node:util";
import type {
  BrowserAction,
  BrowserActionRequest,
  BrowserActionResponse,
  BrowserActionStrategy,
  BrowserArtifact,
  BrowserBounds,
  BrowserElementDescriptor,
  BrowserElementPickResult,
  BrowserElementSnapshot,
  BrowserHistoryEntry,
  BrowserInteractionResult,
  BrowserRelativePosition,
  BrowserScriptError,
  BrowserScriptExecutionResult,
  BrowserTargetDescriptor,
  BrowserResolveCandidate,
  BrowserResolveResult,
  BrowserScriptCacheEntry,
  BrowserScriptCacheReport,
  BrowserScriptCacheSource,
  BrowserScriptCacheSummary,
  BrowserState,
  BrowserScriptStateReport,
} from "../../src/shared/types";
import {
  type BrowserAxNode,
  type BrowserRefEntry,
  BrowserRefMap,
  findBackendNodeIdForRef,
  iterActionableAxNodes,
} from "./browser-ax";
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
const DEFAULT_WHEEL_DELTA = 720;
const DEFAULT_SCRIPT_TIMEOUT_MS = 15_000;
const MAX_SCRIPT_RESULT_CHARS = 12_000;
const DEFAULT_SCRIPT_CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_SCRIPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SCRIPT_CACHE_ENTRIES = 100;
const MAX_SCRIPT_CACHE_VALUE_CHARS = 120_000;

type ScriptCacheInternalEntry = BrowserScriptCacheEntry & {
  expiresAtMs: number;
};

type ScriptCacheSetOptions = {
  ttlMs?: unknown;
  source?: BrowserScriptCacheSource;
  metadata?: unknown;
  url?: string;
  title?: string;
};

type ScriptCacheActivity = {
  writes: BrowserScriptCacheSummary[];
  deletedKeys: string[];
  cleared: number;
};

type ScriptCacheListOptions = {
  prefix?: unknown;
  includeExpired?: unknown;
};

type ScriptCacheReplayOptions = {
  index?: unknown;
  method?: unknown;
  url?: unknown;
  headers?: unknown;
  body?: unknown;
  json?: unknown;
  cacheKey?: unknown;
  ttlMs?: unknown;
  metadata?: unknown;
  responseBodyLimit?: unknown;
  deleteAfter?: unknown;
  deleteOnSuccess?: unknown;
  removeAfterReplay?: unknown;
  removeOnSuccess?: unknown;
};

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
  const clickishPattern = /(^|[\s_-])(btn|button|action|cmd|click|clickable)([\s_-]|$)/i;
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
      selector,
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

const CLICKISH_IDENTITY_PATTERN = /(^|[\s_-])(btn|button|action|cmd|click|clickable)([\s_-]|$)/i;

function descriptorLabelValues(item: BrowserElementDescriptor) {
  return [
    item.name,
    item.text,
    item.ariaLabel,
    item.label,
    item.title,
    item.placeholder,
    item.value,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
}

function hasExactLabelMatch(query: string, item: BrowserElementDescriptor) {
  const queryNorm = normalizeForResolve(query);
  if (!queryNorm) return false;
  return descriptorLabelValues(item).some((value) => normalizeForResolve(value) === queryNorm);
}

function hasConciseLabelMatch(query: string, item: BrowserElementDescriptor) {
  const queryNorm = normalizeForResolve(query);
  if (!queryNorm) return false;
  return descriptorLabelValues(item).some((value) => {
    const normalized = normalizeForResolve(value);
    return value.length <= 80 && normalized && (normalized === queryNorm || normalized.includes(queryNorm));
  });
}

function hasClickishIdentity(item: BrowserElementDescriptor) {
  return CLICKISH_IDENTITY_PATTERN.test(String(item.identity ?? ""));
}

function elementArea(item: BrowserElementDescriptor) {
  const bounds = item.bounds;
  if (!bounds) return Number.POSITIVE_INFINITY;
  return Math.max(1, bounds.width) * Math.max(1, bounds.height);
}

function targetSpecificityScore(query: string, item: BrowserElementDescriptor) {
  if (hasExactLabelMatch(query, item)) return 3;
  if (hasConciseLabelMatch(query, item)) return 2;
  if (hasClickishIdentity(item)) return 1;
  return 0;
}

function isClearlyMoreSpecificTarget(query: string, best: BrowserElementDescriptor, second: BrowserElementDescriptor) {
  const bestSpecificity = targetSpecificityScore(query, best);
  const secondSpecificity = targetSpecificityScore(query, second);
  if (bestSpecificity >= 2 && bestSpecificity > secondSpecificity) return true;
  if (bestSpecificity < 2 || bestSpecificity !== secondSpecificity) return false;
  if (!hasExactLabelMatch(query, best) || hasExactLabelMatch(query, second)) return false;
  const bestArea = elementArea(best);
  const secondArea = elementArea(second);
  return Number.isFinite(bestArea) && Number.isFinite(secondArea) && bestArea * 4 <= secondArea;
}

function boundsNearlyEqual(left?: BrowserBounds, right?: BrowserBounds) {
  if (!left || !right) return false;
  return Math.abs(left.x - right.x) <= 2
    && Math.abs(left.y - right.y) <= 2
    && Math.abs(left.width - right.width) <= 2
    && Math.abs(left.height - right.height) <= 2;
}

function descriptorsLookDuplicated(left: BrowserElementDescriptor, right: BrowserElementDescriptor) {
  if (left.selector && right.selector && left.selector === right.selector) return true;
  if (!boundsNearlyEqual(left.bounds, right.bounds)) return false;
  const leftLabel = normalizeForResolve(descriptorLabelValues(left).join(" "));
  const rightLabel = normalizeForResolve(descriptorLabelValues(right).join(" "));
  return Boolean(leftLabel && rightLabel && leftLabel === rightLabel);
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
  const name = normalizeForResolve([item.name, item.text, item.ariaLabel, item.label, item.title, item.placeholder].filter(Boolean).join(" "));
  const queryNorm = normalizeForResolve(query);
  const terms = textTerms(query);
  let score = 0;
  const reasons: string[] = [];

  if (hasExactLabelMatch(query, item)) {
    score = Math.max(score, 1);
    reasons.push("exact-label");
  }
  if (queryNorm && name && (name.includes(queryNorm) || queryNorm.includes(name))) {
    score = Math.max(score, 0.88);
    reasons.push("label-contains");
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
  const isButtonLike = role === "button" || role === "menuitem" || role === "tab" || tag === "button" || type === "submit" || type === "button";
  const isLinkLike = role === "link" || tag === "a";
  const isTextboxLike = Boolean(item.editable) || role === "textbox" || tag === "input" || tag === "textarea";
  const isGenericLike = !role || role === "generic" || role === "group" || ["div", "span", "li"].includes(tag);
  const genericClickLike = !isTextboxLike
    && isGenericLike
    && (hasExactLabelMatch(query, item) || hasClickishIdentity(item) || (action === "click" && hasConciseLabelMatch(query, item)));

  if (!inferred) return { score: 0.45, reasons: [] as string[] };
  if (inferred === "button" && isButtonLike) return { score: 1, reasons: ["role-button"] };
  if (inferred === "button" && genericClickLike) return { score: 1, reasons: ["role-generic-click"] };
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

function browserScript(kind: "click" | "scroll", payload: Record<string, unknown>) {
  return `(() => {
    const payload = ${JSON.stringify(payload)};
    const lookupElement = () => {
      if (payload.selector) return document.querySelector(payload.selector);
      if (payload.xpath) {
        return document.evaluate(payload.xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      }
      return null;
    };
    const el = lookupElement();
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
      return { ok: false, error: "Unsupported browser script operation." };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  })()`;
}

function browserLocateScript(mode: "selector" | "xpath", value: string) {
  return `(() => {
    const mode = ${JSON.stringify(mode)};
    const value = ${JSON.stringify(value)};
    const toBounds = (rect) => ({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
    try {
      let el = null;
      if (mode === "selector") {
        el = document.querySelector(value);
      } else {
        el = document.evaluate(value, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
      }
      if (!(el instanceof Element)) {
        return { ok: false, error: "No element matched " + mode + ": " + value };
      }
      if (typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ block: "center", inline: "center" });
      }
      const rect = el.getBoundingClientRect();
      return {
        ok: true,
        selector: mode === "selector" ? value : undefined,
        bounds: toBounds(rect),
      };
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
  refs: BrowserRefMap;
  documentId?: string;
  frameId?: string;
  warning?: string;
};

type BrowserDomSnapshot = Omit<BrowserSnapshot, "refs"> & {
  refs?: Array<[string, string]>;
};

type BrowserClickScriptResult = {
  ok?: boolean;
  error?: string;
  bounds?: BrowserBounds;
};

type BrowserLocateScriptResult = {
  ok?: boolean;
  error?: string;
  selector?: string;
  bounds?: BrowserBounds;
};

type BrowserDomNodeMetadata = {
  tag?: string;
  text?: string;
  value?: string;
  type?: string;
  href?: string;
  editable?: boolean;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  bounds?: BrowserBounds;
  ariaLabel?: string;
  label?: string;
  title?: string;
  placeholder?: string;
  identity?: string;
  heading?: string;
  context?: string;
  nearbyText?: string;
  visible?: boolean;
  enabled?: boolean;
};

type BrowserFrameTreeNode = {
  frame: {
    id: string;
    loaderId?: string;
    url?: string;
    urlFragment?: string;
  };
  childFrames?: BrowserFrameTreeNode[];
};

type BrowserDocumentState = {
  frameId?: string;
  documentId?: string;
  url: string;
};

type BrowserPoint = {
  x: number;
  y: number;
};

type BrowserStepOperation = "resolve" | "click" | "type" | "wheel" | "hover" | "drag";

type BrowserSingleStep = {
  op: BrowserStepOperation;
  target?: BrowserTargetDescriptor;
  text?: string;
  submit?: boolean;
  minConfidence?: number;
};

type BrowserSingleStepResult = {
  index: number;
  op: BrowserStepOperation;
  ok: boolean;
  strategy: string;
  target?: BrowserTargetDescriptor;
  selectedRef?: string;
  selectedBounds?: BrowserBounds;
  confidence?: number;
  resolve?: BrowserResolveResult;
  interaction?: BrowserInteractionResult;
  warning?: string;
  error?: string;
};

type ResolvedBrowserTarget = {
  target?: BrowserTargetDescriptor;
  requestedStrategy: BrowserActionStrategy;
  actualStrategy: string;
  ref?: string;
  backendNodeId?: number;
  selector?: string;
  xpath?: string;
  bounds?: BrowserBounds;
  point?: BrowserPoint;
  query?: string;
  role?: string;
  confidence?: number;
  resolve?: BrowserResolveResult;
  warning?: string;
};

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clampRatio(value: unknown, fallback = 0.5) {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(1, numeric));
}

function normalizeTargetBounds(bounds?: BrowserBounds) {
  if (!bounds) return undefined;
  const width = Math.max(1, Math.floor(Number(bounds.width) || 0));
  const height = Math.max(1, Math.floor(Number(bounds.height) || 0));
  return {
    x: Math.floor(Number(bounds.x) || 0),
    y: Math.floor(Number(bounds.y) || 0),
    width,
    height,
  };
}

function normalizeTargetPoint(target?: BrowserTargetDescriptor): BrowserPoint | undefined {
  const x = Number(target?.x);
  const y = Number(target?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  return { x: Math.round(x), y: Math.round(y) };
}

function buildTargetQuery(target?: BrowserTargetDescriptor, fallback = "") {
  const parts = [
    target?.query,
    target?.text,
    target?.ariaLabel,
    target?.placeholder,
    target?.nearText,
    fallback,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
  return parts.join(" ").trim();
}

function hasNaturalLanguageTarget(target?: BrowserTargetDescriptor) {
  return Boolean(buildTargetQuery(target));
}

function hasDirectLocatorTarget(target?: BrowserTargetDescriptor) {
  return Boolean(
    target?.ref?.trim()
    || target?.selector?.trim()
    || target?.xpath?.trim()
    || normalizeTargetPoint(target)
    || target?.bounds
    || target?.relativePosition,
  );
}

function mergeTargetDescriptors(...targets: Array<BrowserTargetDescriptor | undefined>) {
  const merged: BrowserTargetDescriptor = {};
  for (const target of targets) {
    if (!target) continue;
    if (target.ref?.trim()) merged.ref = target.ref.trim();
    if (target.query?.trim()) merged.query = target.query.trim();
    if (target.role?.trim()) merged.role = target.role.trim();
    if (target.text?.trim()) merged.text = target.text.trim();
    if (target.selector?.trim()) merged.selector = target.selector.trim();
    if (target.xpath?.trim()) merged.xpath = target.xpath.trim();
    if (target.placeholder?.trim()) merged.placeholder = target.placeholder.trim();
    if (target.ariaLabel?.trim()) merged.ariaLabel = target.ariaLabel.trim();
    if (target.nearText?.trim()) merged.nearText = target.nearText.trim();
    const point = normalizeTargetPoint(target);
    if (point) {
      merged.x = point.x;
      merged.y = point.y;
    }
    if (target.bounds) merged.bounds = normalizeTargetBounds(target.bounds);
    if (target.relativePosition) {
      merged.relativePosition = {
        xRatio: clampRatio(target.relativePosition.xRatio),
        yRatio: clampRatio(target.relativePosition.yRatio),
      };
    }
  }
  return Object.keys(merged).length ? merged : undefined;
}

function targetFromString(value: unknown): BrowserTargetDescriptor | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (/^(e|d)\d+$/i.test(text)) return { ref: text };
  if (/^(\/|\.\/|\()?\//.test(text)) return { xpath: text };
  if (/^(#|\.|\[)|[>~+]|:nth-|:has\(|:contains\(|\[[^\]]+\]/.test(text)) return { selector: text };
  return { query: text };
}

function targetFromObject(value: unknown): BrowserTargetDescriptor | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return mergeTargetDescriptors(value as BrowserTargetDescriptor);
}

function legacyTargetFromRecord(record: Record<string, unknown>): BrowserTargetDescriptor | undefined {
  const relativePosition = record.relativePosition && typeof record.relativePosition === "object" && !Array.isArray(record.relativePosition)
    ? record.relativePosition as Partial<BrowserRelativePosition>
    : undefined;
  const legacy = mergeTargetDescriptors({
    ref: typeof record.ref === "string" ? record.ref : undefined,
    query: typeof record.query === "string" ? record.query : undefined,
    role: typeof record.role === "string" ? record.role : undefined,
    text: typeof record.text === "string" ? record.text : undefined,
    selector: typeof record.selector === "string" ? record.selector : undefined,
    xpath: typeof record.xpath === "string" ? record.xpath : undefined,
    placeholder: typeof record.placeholder === "string" ? record.placeholder : undefined,
    ariaLabel: typeof record.ariaLabel === "string" ? record.ariaLabel : undefined,
    nearText: typeof record.nearText === "string" ? record.nearText : undefined,
    x: typeof record.x === "number" ? record.x : undefined,
    y: typeof record.y === "number" ? record.y : undefined,
    bounds: record.bounds && typeof record.bounds === "object" && !Array.isArray(record.bounds)
      ? normalizeTargetBounds(record.bounds as BrowserBounds)
      : undefined,
    relativePosition: relativePosition
      ? { xRatio: Number(relativePosition.xRatio), yRatio: Number(relativePosition.yRatio) }
      : undefined,
  });
  return legacy;
}

type NormalizedBrowserActionRequest = Omit<BrowserActionRequest, "target"> & {
  target?: BrowserTargetDescriptor;
};

function normalizeBrowserActionRequest(request: BrowserActionRequest): NormalizedBrowserActionRequest {
  const record = request as unknown as Record<string, unknown>;
  const target = mergeTargetDescriptors(
    targetFromString(record.target),
    targetFromObject(record.target),
    legacyTargetFromRecord(record),
  );
  return { ...request, target };
}

function stepUsesEditableTarget(op: BrowserStepOperation) {
  return op === "type";
}

function actionHintForStepOperation(op: BrowserStepOperation): BrowserAction | undefined {
  if (op === "type") return "type";
  if (op === "click" || op === "hover" || op === "drag" || op === "wheel") return "click";
  if (op === "resolve") return "resolve";
  return undefined;
}

function buildPointFromBounds(bounds: BrowserBounds, relativePosition?: { xRatio: number; yRatio: number }): BrowserPoint {
  const xRatio = clampRatio(relativePosition?.xRatio);
  const yRatio = clampRatio(relativePosition?.yRatio);
  return {
    x: Math.round(bounds.x + bounds.width * xRatio),
    y: Math.round(bounds.y + bounds.height * yRatio),
  };
}

function pointInsideBounds(point: BrowserPoint, bounds: BrowserBounds) {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function normalizeCoordinateTarget(target?: BrowserTargetDescriptor) {
  const point = normalizeTargetPoint(target);
  const bounds = normalizeTargetBounds(target?.bounds);
  if (point && bounds && !pointInsideBounds(point, bounds)) {
    return {
      point: buildPointFromBounds(bounds, target?.relativePosition),
      bounds,
      warning: "Requested coordinate was outside the provided bounds; clicked the bounds center instead.",
    };
  }
  if (point) return { point, bounds };
  if (bounds) return { point: buildPointFromBounds(bounds, target?.relativePosition), bounds };
  return {};
}

function shouldCaptureVisionFallback(strategy: BrowserActionStrategy, resolve?: BrowserResolveResult) {
  return strategy === "visionFallback" || Boolean(resolve?.needsVisionFallback);
}

function requestUsesNaturalLanguageTargets(request: BrowserActionRequest) {
  return hasNaturalLanguageTarget(request.target);
}

function frameDocumentId(frame: BrowserFrameTreeNode["frame"]): string | undefined {
  if (frame.loaderId === undefined) return undefined;
  return `${frame.id}:${frame.loaderId}`;
}

function frameUrl(frame: BrowserFrameTreeNode["frame"]): string {
  return frame.url ? `${frame.url}${frame.urlFragment ?? ""}` : "unknown";
}

function truncateReadableText(value: string, maxChars = MAX_SCRIPT_RESULT_CHARS) {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, maxChars)}\n... [truncated by Nexo]`,
    truncated: true,
  };
}

function browserScriptError(error: unknown): BrowserScriptError {
  if (error instanceof Error) {
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      stack: error.stack,
    };
  }
  return {
    name: "Error",
    message: String(error),
  };
}

function browserScriptResultValue(value: unknown): BrowserScriptExecutionResult["result"] {
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  try {
    return {
      format: "json",
      type,
      value: JSON.parse(JSON.stringify(value)) as unknown,
    };
  } catch {
    const rendered = inspect(value, {
      depth: 4,
      breakLength: 100,
      maxArrayLength: 50,
      maxStringLength: 4_000,
    });
    const { text, truncated } = truncateReadableText(rendered);
    return {
      format: "inspect",
      type,
      text,
      truncated: truncated || undefined,
    };
  }
}

function normalizeScriptCacheTtlMs(value: unknown, fallback = DEFAULT_SCRIPT_CACHE_TTL_MS) {
  const raw = Number(value ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(MAX_SCRIPT_CACHE_TTL_MS, Math.max(1, Math.floor(raw)));
}

function normalizePositiveInteger(value: unknown, fallback: number, max: number) {
  const raw = Number(value ?? fallback);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(raw)));
}

function normalizeScriptCacheKey(value: unknown) {
  const key = String(value ?? "").trim();
  if (!key) {
    throw new Error("scriptCache key is required.");
  }
  if (key.length > 180) {
    throw new Error("scriptCache key must be 180 characters or fewer.");
  }
  return key;
}

function normalizeScriptCachePrefix(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionEnabled(value: unknown) {
  return value === true || value === "true" || value === 1 || value === "1";
}

function cloneJsonValue<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function normalizeScriptCacheMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  try {
    const cloned = JSON.parse(JSON.stringify(value)) as unknown;
    return cloned && typeof cloned === "object" && !Array.isArray(cloned)
      ? cloned as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function serializeScriptCacheValue(value: unknown) {
  try {
    const json = JSON.stringify(value);
    const size = Buffer.byteLength(json ?? "", "utf8");
    if (json.length <= MAX_SCRIPT_CACHE_VALUE_CHARS) {
      return {
        value: JSON.parse(json) as unknown,
        size,
        truncated: false,
      };
    }
    const { text, truncated } = truncateReadableText(json, MAX_SCRIPT_CACHE_VALUE_CHARS);
    return {
      value: {
        format: "json-text",
        text,
        truncated,
      },
      size,
      truncated,
    };
  } catch {
    const rendered = inspect(value, {
      depth: 5,
      breakLength: 100,
      maxArrayLength: 80,
      maxStringLength: 8_000,
    });
    const { text, truncated } = truncateReadableText(rendered, MAX_SCRIPT_CACHE_VALUE_CHARS);
    return {
      value: {
        format: "inspect",
        text,
        truncated,
      },
      size: Buffer.byteLength(text, "utf8"),
      truncated,
    };
  }
}

function scriptCacheSummary(entry: ScriptCacheInternalEntry, replaced?: boolean): BrowserScriptCacheSummary {
  return {
    key: entry.key,
    source: entry.source,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    expiresAt: entry.expiresAt,
    ttlMs: entry.ttlMs,
    size: entry.size,
    truncated: entry.truncated || undefined,
    replaced: replaced || undefined,
    url: entry.url,
    title: entry.title,
    metadata: entry.metadata,
  };
}

function scriptCacheEntryView(entry: ScriptCacheInternalEntry): BrowserScriptCacheEntry {
  return {
    ...scriptCacheSummary(entry),
    value: cloneJsonValue(entry.value),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasStringField(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" && String(record[key]).trim().length > 0;
}

function looksLikeNetworkCapture(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(looksLikeNetworkCapture);
  }
  if (!isRecord(value)) return false;
  if (hasStringField(value, "url") && (hasStringField(value, "method") || "headers" in value || "body" in value || "postData" in value || "status" in value)) {
    return true;
  }
  if (isRecord(value.request) && looksLikeNetworkCapture(value.request)) {
    return true;
  }
  if (Array.isArray(value.requests) || Array.isArray(value.captures) || Array.isArray(value.captureLogs) || Array.isArray(value.networkLog) || Array.isArray(value.entries)) {
    return true;
  }
  return false;
}

function extractScriptCapturePayload(value: unknown): unknown | undefined {
  if (looksLikeNetworkCapture(value)) return value;
  if (!isRecord(value)) return undefined;
  for (const key of ["capture", "captures", "captureLog", "captureLogs", "networkLog", "requestLog", "requests", "entries", "events", "logs"]) {
    const candidate = value[key];
    if (looksLikeNetworkCapture(candidate) || (Array.isArray(candidate) && candidate.length > 0)) {
      return candidate;
    }
  }
  return undefined;
}

function normalizeReplayHeaders(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const blocked = new Set(["host", "content-length", "transfer-encoding", "connection"]);
  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = key.trim();
    if (!normalizedKey || blocked.has(normalizedKey.toLowerCase())) continue;
    if (Array.isArray(raw)) {
      headers[normalizedKey] = raw.map((item) => String(item)).join(", ");
    } else if (raw !== undefined && raw !== null) {
      headers[normalizedKey] = String(raw);
    }
  }
  return headers;
}

function firstReplayCandidate(value: unknown, index = 0): Record<string, unknown> | undefined {
  if (Array.isArray(value)) {
    const candidate = value[Math.max(0, Math.floor(index))];
    return isRecord(candidate) ? candidate : undefined;
  }
  if (!isRecord(value)) return undefined;
  if (isRecord(value.request)) return value.request;
  for (const key of ["requests", "captures", "captureLogs", "networkLog", "entries", "logs"]) {
    const child = value[key];
    if (Array.isArray(child)) {
      const candidate = child[Math.max(0, Math.floor(index))];
      if (isRecord(candidate)) {
        return isRecord(candidate.request) ? candidate.request : candidate;
      }
    }
  }
  return value;
}

function readReplayBody(record: Record<string, unknown>, options: ScriptCacheReplayOptions) {
  if (options.json !== undefined) return JSON.stringify(options.json);
  const body = options.body ?? record.body ?? record.postData ?? record.payload ?? record.data;
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array) return body;
  return JSON.stringify(body);
}

function buildScriptCacheReport(activity: ScriptCacheActivity, automatic?: BrowserScriptCacheSummary): BrowserScriptCacheReport | undefined {
  const report: BrowserScriptCacheReport = {};
  if (automatic) report.automatic = automatic;
  if (activity.writes.length) report.writes = activity.writes;
  if (activity.deletedKeys.length) report.deletedKeys = activity.deletedKeys;
  if (activity.cleared > 0) report.cleared = activity.cleared;
  return Object.keys(report).length ? report : undefined;
}

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
  private elementRefs = new BrowserRefMap();
  private elementDescriptors = new Map<string, BrowserElementDescriptor>();
  private snapshotDocument?: BrowserDocumentState;
  private history: BrowserHistoryEntry[] = [];
  private recentInteractionRef = "";
  private elementPickActive = false;
  private scriptCache = new Map<string, ScriptCacheInternalEntry>();
  private scriptCacheSweepTimer: NodeJS.Timeout | undefined;
  private scriptCacheSequence = 0;

  // Exposed for local verification scripts that exercise resolver logic without a live BrowserView.
  setTestSnapshotData(
    refs: BrowserRefEntry[],
    descriptors: BrowserElementDescriptor[],
    recentRef = "",
  ) {
    const refMap = new BrowserRefMap();
    refMap.beginSnapshot();
    for (const entry of refs) {
      refMap.byRef.set(entry.ref, { ...entry });
    }
    this.elementRefs = refMap;
    this.elementDescriptors = new Map(descriptors.map((descriptor) => [descriptor.ref, descriptor]));
    this.recentInteractionRef = recentRef;
  }

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
    this.elementRefs.reset();
    this.elementDescriptors.clear();
    this.snapshotDocument = undefined;
    this.scriptCache.clear();
    if (this.scriptCacheSweepTimer) {
      clearTimeout(this.scriptCacheSweepTimer);
      this.scriptCacheSweepTimer = undefined;
    }
  }

  async openWorkbench() {
    this.mode = "workbench";
    await this.ensure();
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

  private compactScriptSnapshot(
    snapshot: BrowserActionResponse,
    request: BrowserActionRequest,
  ): { state: BrowserState; report: BrowserScriptStateReport } {
    const includeFullState = request.includeState === true;
    const includeElements = includeFullState || request.includeElements === true;
    const includeText = includeFullState || request.includeText === true;
    const includeHistory = includeFullState || request.includeHistory === true;
    const elements = includeElements ? snapshot.elements : [];
    const text = includeText ? snapshot.text : "";
    const history = includeHistory ? snapshot.history ?? [] : undefined;
    const fullElementCount = snapshot.elements.length;
    const fullTextLength = snapshot.text.length;
    const fullHistoryCount = snapshot.history?.length ?? 0;
    const includedHistoryCount = history?.length ?? 0;
    const omittedElements = Math.max(0, fullElementCount - elements.length);
    const omittedTextChars = Math.max(0, fullTextLength - text.length);
    const omittedHistory = Math.max(0, fullHistoryCount - includedHistoryCount);
    const compact = !includeFullState || omittedElements > 0 || omittedTextChars > 0 || omittedHistory > 0;

    return {
      state: {
        url: snapshot.url,
        title: snapshot.title,
        loading: snapshot.loading,
        canGoBack: snapshot.canGoBack,
        canGoForward: snapshot.canGoForward,
        presentation: snapshot.presentation,
        zoomFactor: snapshot.zoomFactor,
        history,
        elements,
        resolve: includeFullState ? snapshot.resolve : undefined,
        text,
        lastAction: snapshot.lastAction,
        warning: snapshot.warning,
        error: snapshot.error,
      },
      report: {
        compact,
        elementsIncluded: elements.length,
        textIncludedChars: text.length,
        historyIncluded: includedHistoryCount,
        elementsOmitted: omittedElements,
        textOmittedChars: omittedTextChars,
        historyOmitted: omittedHistory,
        hint: compact
          ? "Call browser_action snapshot, or set includeState=true on action=script, when full page elements/text/history are required."
          : undefined,
      },
    };
  }

  private nextScriptCacheKey(prefix = "capture") {
    this.scriptCacheSequence += 1;
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    let host = "page";
    try {
      const url = this.browserView?.webContents.getURL() || this.state.url;
      host = new URL(url).hostname.replace(/[^a-z0-9.-]+/gi, "-").slice(0, 60) || "page";
    } catch {
      // keep fallback
    }
    return `${prefix}:${host}:${stamp}:${this.scriptCacheSequence}`;
  }

  private pruneScriptCache(now = Date.now()) {
    let pruned = 0;
    for (const [key, entry] of this.scriptCache.entries()) {
      if (entry.expiresAtMs <= now) {
        this.scriptCache.delete(key);
        pruned += 1;
      }
    }
    return pruned;
  }

  private scheduleScriptCacheSweep() {
    if (this.scriptCacheSweepTimer) {
      clearTimeout(this.scriptCacheSweepTimer);
      this.scriptCacheSweepTimer = undefined;
    }
    let nextExpiry = Number.POSITIVE_INFINITY;
    for (const entry of this.scriptCache.values()) {
      nextExpiry = Math.min(nextExpiry, entry.expiresAtMs);
    }
    if (!Number.isFinite(nextExpiry)) return;
    const delayMs = Math.max(1, Math.min(nextExpiry - Date.now(), 2_147_483_647));
    this.scriptCacheSweepTimer = setTimeout(() => {
      this.scriptCacheSweepTimer = undefined;
      this.pruneScriptCache();
      this.scheduleScriptCacheSweep();
    }, delayMs);
    this.scriptCacheSweepTimer.unref?.();
  }

  private evictScriptCacheIfNeeded(protectedKey?: string) {
    this.pruneScriptCache();
    while (this.scriptCache.size >= MAX_SCRIPT_CACHE_ENTRIES) {
      const oldest = [...this.scriptCache.values()]
        .filter((entry) => entry.key !== protectedKey)
        .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))[0];
      if (!oldest) break;
      this.scriptCache.delete(oldest.key);
    }
  }

  private setScriptCacheEntry(keyValue: unknown, value: unknown, options: ScriptCacheSetOptions = {}) {
    const key = normalizeScriptCacheKey(keyValue);
    const ttlMs = normalizeScriptCacheTtlMs(options.ttlMs);
    const now = Date.now();
    const existing = this.scriptCache.get(key);
    this.evictScriptCacheIfNeeded(key);
    const serialized = serializeScriptCacheValue(value);
    const entry: ScriptCacheInternalEntry = {
      key,
      value: serialized.value,
      source: options.source ?? "script",
      createdAt: existing?.createdAt ?? new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
      expiresAtMs: now + ttlMs,
      ttlMs,
      size: serialized.size,
      truncated: serialized.truncated || undefined,
      url: options.url ?? this.browserView?.webContents.getURL() ?? this.state.url,
      title: options.title ?? this.browserView?.webContents.getTitle() ?? this.state.title,
      metadata: normalizeScriptCacheMetadata(options.metadata),
    };
    this.scriptCache.set(key, entry);
    this.scheduleScriptCacheSweep();
    return scriptCacheSummary(entry, Boolean(existing));
  }

  private getScriptCacheEntry(keyValue: unknown): BrowserScriptCacheEntry | undefined {
    const key = normalizeScriptCacheKey(keyValue);
    this.pruneScriptCache();
    const entry = this.scriptCache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs <= Date.now()) {
      this.scriptCache.delete(key);
      this.scheduleScriptCacheSweep();
      return undefined;
    }
    return scriptCacheEntryView(entry);
  }

  private listScriptCacheEntries(options: ScriptCacheListOptions = {}) {
    if (!options.includeExpired) {
      this.pruneScriptCache();
    }
    const prefix = normalizeScriptCachePrefix(options.prefix);
    return [...this.scriptCache.values()]
      .filter((entry) => !prefix || entry.key.startsWith(prefix))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((entry) => scriptCacheSummary(entry));
  }

  private deleteScriptCacheEntry(keyValue: unknown) {
    const key = normalizeScriptCacheKey(keyValue);
    const deleted = this.scriptCache.delete(key);
    if (deleted) this.scheduleScriptCacheSweep();
    return deleted;
  }

  private consumeScriptCacheEntry(keyValue: unknown): BrowserScriptCacheEntry | undefined {
    const key = normalizeScriptCacheKey(keyValue);
    const entry = this.getScriptCacheEntry(key);
    if (!entry) return undefined;
    this.deleteScriptCacheEntry(key);
    return entry;
  }

  private clearScriptCacheEntries(options: ScriptCacheListOptions = {}) {
    this.pruneScriptCache();
    const prefix = normalizeScriptCachePrefix(options.prefix);
    const deletedKeys: string[] = [];
    for (const key of this.scriptCache.keys()) {
      if (prefix && !key.startsWith(prefix)) continue;
      this.scriptCache.delete(key);
      deletedKeys.push(key);
    }
    if (deletedKeys.length) this.scheduleScriptCacheSweep();
    return deletedKeys;
  }

  private async replayCachedRequest(keyOrValue: unknown, options: ScriptCacheReplayOptions = {}) {
    const sourceKey = typeof keyOrValue === "string" ? normalizeScriptCacheKey(keyOrValue) : undefined;
    const cached = sourceKey
      ? this.getScriptCacheEntry(sourceKey)?.value
      : keyOrValue;
    const index = Number.isFinite(Number(options.index)) ? Number(options.index) : 0;
    const request = firstReplayCandidate(cached, index);
    if (!request) {
      throw new Error("No replayable cached request was found.");
    }

    const url = String(options.url ?? request.url ?? "").trim();
    if (!url) throw new Error("Cached request does not include a URL.");
    const method = String(options.method ?? request.method ?? "GET").toUpperCase();
    const headers = {
      ...normalizeReplayHeaders(request.headers),
      ...normalizeReplayHeaders(options.headers),
    };
    if (options.json !== undefined && !Object.keys(headers).some((key) => key.toLowerCase() === "content-type")) {
      headers["content-type"] = "application/json";
    }

    const body = readReplayBody(request, options);
    const init: RequestInit = {
      method,
      headers,
      redirect: "manual",
    };
    if (body !== undefined && method !== "GET" && method !== "HEAD") {
      init.body = body as BodyInit;
    }

    const response = await fetch(url, init);
    const responseText = await response.text();
    const bodyLimit = normalizePositiveInteger(options.responseBodyLimit, MAX_SCRIPT_RESULT_CHARS, MAX_SCRIPT_CACHE_VALUE_CHARS);
    const { text, truncated } = truncateReadableText(responseText, bodyLimit);
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    const result = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      url: response.url,
      headers: responseHeaders,
      body: text,
      bodyTruncated: truncated || undefined,
      replayedRequest: {
        method,
        url,
        headers,
        hasBody: body !== undefined,
      },
    };

    const shouldDeleteAfter = optionEnabled(options.deleteAfter) || optionEnabled(options.removeAfterReplay);
    const shouldDeleteOnSuccess = optionEnabled(options.deleteOnSuccess) || optionEnabled(options.removeOnSuccess);
    let deletedSourceKey: string | undefined;
    if (sourceKey && (shouldDeleteAfter || (shouldDeleteOnSuccess && response.ok))) {
      if (this.deleteScriptCacheEntry(sourceKey)) {
        deletedSourceKey = sourceKey;
      }
    }

    if (options.cacheKey) {
      this.setScriptCacheEntry(options.cacheKey, result, {
        ttlMs: options.ttlMs,
        source: "replay",
        metadata: options.metadata,
        url,
      });
    }
    return {
      ...result,
      deletedSourceKey,
    };
  }

  private createScriptCacheApi(activity: ScriptCacheActivity, defaultTtlMs: number) {
    return {
      set: (key: unknown, value: unknown, options: ScriptCacheSetOptions = {}) => {
        const summary = this.setScriptCacheEntry(key, value, { ...options, ttlMs: options.ttlMs ?? defaultTtlMs, source: options.source ?? "script" });
        activity.writes.push(summary);
        return summary;
      },
      capture: (value: unknown, options: ScriptCacheSetOptions & { key?: unknown } = {}) => {
        const summary = this.setScriptCacheEntry(options.key ?? this.nextScriptCacheKey("capture"), value, {
          ...options,
          ttlMs: options.ttlMs ?? defaultTtlMs,
          source: options.source ?? "script",
        });
        activity.writes.push(summary);
        return summary;
      },
      get: (key: unknown) => this.getScriptCacheEntry(key)?.value,
      getEntry: (key: unknown) => this.getScriptCacheEntry(key),
      list: (options: ScriptCacheListOptions = {}) => this.listScriptCacheEntries(options),
      delete: (key: unknown) => {
        const normalizedKey = normalizeScriptCacheKey(key);
        const deleted = this.deleteScriptCacheEntry(normalizedKey);
        if (deleted) activity.deletedKeys.push(normalizedKey);
        return deleted;
      },
      clear: (options: ScriptCacheListOptions = {}) => {
        const deletedKeys = this.clearScriptCacheEntries(options);
        activity.deletedKeys.push(...deletedKeys);
        activity.cleared += deletedKeys.length;
        return deletedKeys.length;
      },
      consume: (key: unknown) => {
        const normalizedKey = normalizeScriptCacheKey(key);
        const entry = this.consumeScriptCacheEntry(normalizedKey);
        if (entry) activity.deletedKeys.push(normalizedKey);
        return entry?.value;
      },
      consumeEntry: (key: unknown) => {
        const normalizedKey = normalizeScriptCacheKey(key);
        const entry = this.consumeScriptCacheEntry(normalizedKey);
        if (entry) activity.deletedKeys.push(normalizedKey);
        return entry;
      },
      replay: async (keyOrValue: unknown, options: ScriptCacheReplayOptions = {}) => {
        const result = await this.replayCachedRequest(keyOrValue, options);
        if (result.deletedSourceKey) activity.deletedKeys.push(result.deletedSourceKey);
        return result;
      },
    };
  }

  private autoCacheScriptResult(value: unknown, request: BrowserActionRequest, activity: ScriptCacheActivity) {
    const explicitKey = typeof request.scriptCacheKey === "string" && request.scriptCacheKey.trim()
      ? request.scriptCacheKey.trim()
      : undefined;
    if (!explicitKey && activity.writes.length) return undefined;
    const payload = explicitKey ? value : extractScriptCapturePayload(value);
    if (payload === undefined) return undefined;
    return this.setScriptCacheEntry(explicitKey ?? this.nextScriptCacheKey("capture"), payload, {
      ttlMs: request.scriptCacheTtlMs,
      source: "auto-capture",
      metadata: {
        action: "browser_action.script",
        automatic: true,
      },
    });
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
      const normalizedRequest = normalizeBrowserActionRequest(request);
      this.assertModernBrowserActionRequest(normalizedRequest);
      await this.ensure();
      switch (normalizedRequest.action) {
        case "snapshot":
          return this.snapshot("snapshot");
        case "resolve":
          return this.resolve(normalizedRequest);
        case "navigate":
          return this.navigate(normalizedRequest.url);
        case "click":
          return this.click(normalizedRequest.target, normalizedRequest.strategy ?? "auto", normalizedRequest.minConfidence);
        case "type":
          return this.type(normalizedRequest.target, normalizedRequest.strategy ?? "auto", normalizedRequest.text ?? "", Boolean(normalizedRequest.submit), normalizedRequest.minConfidence);
        case "scroll":
          return this.scroll(normalizedRequest.direction ?? "down", normalizedRequest.amount);
        case "wheel":
          return this.wheel(normalizedRequest.target, normalizedRequest.strategy ?? "auto", normalizedRequest.direction, normalizedRequest.amount, normalizedRequest.deltaX, normalizedRequest.deltaY, normalizedRequest.minConfidence);
        case "hover":
          return this.hover(normalizedRequest.target, normalizedRequest.strategy ?? "auto", normalizedRequest.minConfidence);
        case "drag":
          return this.drag(normalizedRequest.target, normalizedRequest.strategy ?? "auto", normalizedRequest.deltaX, normalizedRequest.deltaY, normalizedRequest.minConfidence);
        case "key":
          return this.key(normalizedRequest.key);
        case "script":
          return this.executeScript(normalizedRequest);
        case "screenshot":
          return this.screenshot();
        case "refresh":
          return this.refresh();
        case "back":
          return this.back();
        case "forward":
          return this.forward();
        default:
          throw new Error(`Unsupported browser_action.action: ${String(request.action)}. Supported actions: snapshot, resolve, navigate, click, type, scroll, wheel, hover, drag, key, script, screenshot, refresh, back, forward.`);
      }
    };

    const queued = this.actionQueue.then(run, run);
    this.actionQueue = queued.catch(() => undefined);
    return queued;
  }

  private assertModernBrowserActionRequest(request: BrowserActionRequest) {
    const removedRunRecord = request as unknown as Record<string, unknown>;
    const removedRunFields = ["steps", "goal", "onFailure", "waitMs", "durationMs"].filter((key) => {
      const value = removedRunRecord[key];
      return value !== undefined && value !== null && String(value).trim() !== "";
    });
    if (removedRunFields.length) {
      throw new Error(
        `browser_action no longer accepts ${removedRunFields.join(", ")}. Call one browser_action per browser operation instead.`,
      );
    }
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
        this.elementRefs.reset();
        this.elementDescriptors.clear();
        this.snapshotDocument = undefined;
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

  private async withCdp<T>(run: (cdp: Electron.Debugger) => Promise<T>): Promise<T> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const cdp = this.browserView.webContents.debugger;
    const wasAttached = cdp.isAttached();
    try {
      if (!wasAttached) cdp.attach("1.3");
      return await run(cdp);
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

  private async withResolvedBackendNode<T>(
    backendNodeId: number,
    run: (cdp: Electron.Debugger, objectId: string) => Promise<T>,
  ): Promise<T> {
    return this.withCdp(async (cdp) => {
      const resolved = await cdp.sendCommand("DOM.resolveNode", { backendNodeId }) as { object?: { objectId?: string } };
      const objectId = resolved.object?.objectId;
      if (!objectId) {
        throw new Error(`Backend DOM node ${backendNodeId} is not resolvable.`);
      }
      try {
        return await run(cdp, objectId);
      } finally {
        await cdp.sendCommand("Runtime.releaseObject", { objectId }).catch(() => undefined);
      }
    });
  }

  private async readRootDocumentState(): Promise<BrowserDocumentState> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    return this.withCdp(async (cdp) => {
      try {
        const result = await cdp.sendCommand("Page.getFrameTree") as { frameTree?: BrowserFrameTreeNode };
        const frame = result.frameTree?.frame;
        if (!frame) {
          return {
            url: this.browserView?.webContents.getURL() || this.state.url,
          };
        }
        return {
          frameId: frame.id,
          documentId: frameDocumentId(frame),
          url: frameUrl(frame),
        };
      } catch {
        return {
          url: this.browserView?.webContents.getURL() || this.state.url,
        };
      }
    });
  }

  private async fetchAxTree(frameId?: string): Promise<BrowserAxNode[]> {
    return this.withCdp(async (cdp) => {
      const result = await cdp.sendCommand("Accessibility.getFullAXTree", frameId ? { frameId } : {}) as { nodes?: BrowserAxNode[] };
      return result.nodes ?? [];
    });
  }

  private async isBackendNodeLive(backendNodeId: number): Promise<boolean> {
    try {
      await this.withResolvedBackendNode(backendNodeId, async () => undefined);
      return true;
    } catch {
      return false;
    }
  }

  private async captureReadablePageText(): Promise<string> {
    if (!this.browserView) return "";
    return await this.browserView.webContents.executeJavaScript(
      String.raw`(() => String(document.body?.innerText || document.documentElement?.innerText || "").replace(/\s+/g, " ").trim())()`,
      true,
    ).catch(() => "") as string;
  }

  private async captureDomSnapshotCandidates(): Promise<BrowserDomSnapshot | undefined> {
    if (!this.browserView) return undefined;
    return await this.browserView.webContents.executeJavaScript(SNAPSHOT_HELPER, true)
      .catch(() => undefined) as BrowserDomSnapshot | undefined;
  }

  private mergeDomSnapshotCandidates(elements: BrowserElementDescriptor[], domSnapshot?: BrowserDomSnapshot) {
    const domElements = domSnapshot?.elements ?? [];
    if (!domElements.length) return;
    const selectorByRef = new Map(domSnapshot?.refs ?? []);
    const usedRefs = new Set(elements.map((element) => element.ref));
    let nextDomRef = 1;
    const allocateDomRef = () => {
      for (;;) {
        const ref = `d${nextDomRef++}`;
        if (!usedRefs.has(ref)) {
          usedRefs.add(ref);
          return ref;
        }
      }
    };

    for (const item of domElements) {
      const selector = item.selector || selectorByRef.get(item.ref);
      const bounds = normalizeTargetBounds(item.bounds);
      if (!selector || !bounds) continue;
      const candidate: BrowserElementDescriptor = {
        ...item,
        ref: allocateDomRef(),
        selector,
        bounds,
        visible: item.visible ?? true,
        enabled: item.enabled ?? !item.disabled,
      };
      candidate.descriptorText = descriptorSearchText(candidate);
      if (elements.some((element) => descriptorsLookDuplicated(element, candidate))) continue;
      elements.push(candidate);
    }
  }

  private async readDomNodeMetadata(backendNodeId: number): Promise<BrowserDomNodeMetadata | undefined> {
    return this.withResolvedBackendNode(backendNodeId, async (cdp, objectId) => {
      const result = await cdp.sendCommand("Runtime.callFunctionOn", {
        objectId,
        returnByValue: true,
        awaitPromise: true,
        functionDeclaration: String.raw`function() {
          const el = this;
          if (!(el instanceof Element)) return { visible: false, enabled: false };
          const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
          const escapeCss = (value) => {
            if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
            return String(value).replace(/[^a-zA-Z0-9_-]/g, (ch) => "\\" + ch);
          };
          const textFromIdRefs = (value) => clean(String(value ?? "")
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "")
            .join(" "));
          const associatedLabel = () => {
            const labels = "labels" in el && el.labels ? Array.from(el.labels).map((label) => clean(label.innerText || label.textContent || "")).filter(Boolean) : [];
            if (labels.length) return labels[0];
            if ("id" in el && el.id) {
              const label = document.querySelector('label[for="' + escapeCss(el.id) + '"]');
              if (label) return clean(label.innerText || label.textContent || "");
            }
            const wrapped = el.closest("label");
            return wrapped ? clean(wrapped.innerText || wrapped.textContent || "") : "";
          };
          const nearestHeading = () => {
            const container = el.closest("form,dialog,[role='dialog'],[role='main'],main,section,article,[aria-labelledby]");
            const labelled = textFromIdRefs(container?.getAttribute("aria-labelledby"));
            if (labelled) return labelled;
            const heading = container?.querySelector?.("h1,h2,h3,h4,h5,h6");
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
          const contextName = () => {
            const owner = el.closest("form,dialog,[role='dialog'],[role='toolbar'],[role='menu'],nav,header,footer,section,article");
            if (!owner) return "";
            const role = clean(owner.getAttribute("role")) || owner.tagName.toLowerCase();
            const label = owner.getAttribute("aria-label")
              || textFromIdRefs(owner.getAttribute("aria-labelledby"))
              || owner.getAttribute("title")
              || owner.querySelector?.("h1,h2,h3,h4,h5,h6")?.textContent
              || "";
            return clean([role, label].filter(Boolean).join(" "));
          };
          const nearbyText = () => {
            const parent = el.parentElement;
            if (!parent) return "";
            const text = clean(parent.innerText || parent.textContent || "");
            return text.length > 160 ? text.slice(0, 160) : text;
          };
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          const visible = style.display !== "none"
            && style.visibility !== "hidden"
            && style.opacity !== "0"
            && rect.width > 0
            && rect.height > 0
            && rect.bottom >= 0
            && rect.right >= 0;
          const enabled = el.getAttribute("aria-disabled") !== "true" && !("disabled" in el && Boolean(el.disabled));
          return {
            tag: el.tagName.toLowerCase(),
            text: clean(el.innerText || el.textContent || "") || undefined,
            value: "value" in el ? clean(String(el.value ?? "")) || undefined : undefined,
            type: "type" in el ? clean(String(el.type ?? "")) || undefined : undefined,
            href: el instanceof HTMLAnchorElement ? el.href : undefined,
            editable: Boolean(el.isContentEditable || el.matches("input,textarea,select")),
            disabled: "disabled" in el ? Boolean(el.disabled) : undefined,
            checked: "checked" in el ? Boolean(el.checked) : undefined,
            selected: "selected" in el ? Boolean(el.selected) : undefined,
            bounds: {
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            },
            ariaLabel: clean(el.getAttribute("aria-label")) || undefined,
            label: associatedLabel() || undefined,
            title: clean(el.getAttribute("title") || el.getAttribute("data-tooltip") || el.getAttribute("data-title") || el.getAttribute("data-original-title")) || undefined,
            placeholder: clean(el.getAttribute("placeholder")) || undefined,
            identity: [
              clean("id" in el ? el.id : ""),
              clean("className" in el ? String(el.className ?? "") : ""),
              clean(el.getAttribute("name")),
              clean(el.getAttribute("data-action")),
              clean(el.getAttribute("data-cmd")),
              clean(el.getAttribute("data-testid")),
              clean(el.getAttribute("data-test")),
            ].filter(Boolean).join(" ") || undefined,
            heading: nearestHeading() || undefined,
            context: contextName() || undefined,
            nearbyText: nearbyText() || undefined,
            visible,
            enabled,
          };
        }`,
      }) as { result?: { value?: BrowserDomNodeMetadata } };
      return result.result?.value;
    }).catch(() => undefined);
  }

  private async snapshot(action: BrowserAction): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    await this.waitForIdle();
    await this.waitForDomSettled(700, 160);
    const documentState = await this.readRootDocumentState();
    const sameDocument = Boolean(
      this.snapshotDocument?.documentId
      && documentState.documentId
      && this.snapshotDocument.documentId === documentState.documentId
      && this.snapshotDocument.url === documentState.url,
    );
    const refs = sameDocument ? this.elementRefs.forkForSnapshot() : new BrowserRefMap();
    refs.beginSnapshot();
    const nodes = await this.fetchAxTree(documentState.frameId);
    const actionable = iterActionableAxNodes(nodes);
    const elements: BrowserElementDescriptor[] = [];
    for (const node of actionable) {
      const ref = refs.mint({
        backendNodeId: node.backendNodeId,
        role: node.role,
        name: node.name,
        documentId: documentState.documentId,
      });
      const metadata = await this.readDomNodeMetadata(node.backendNodeId);
      const bounds = normalizeTargetBounds(metadata?.bounds);
      if (metadata?.visible === false) continue;
      if (bounds && (bounds.width <= 0 || bounds.height <= 0)) continue;
      const descriptor: BrowserElementDescriptor = {
        ref,
        tag: metadata?.tag || "unknown",
        role: node.role || undefined,
        name: metadata?.ariaLabel || node.name || metadata?.label || metadata?.title || metadata?.placeholder || metadata?.tag || node.role,
        text: metadata?.text || undefined,
        value: metadata?.value || node.value || undefined,
        type: metadata?.type || undefined,
        href: metadata?.href || undefined,
        editable: metadata?.editable,
        disabled: metadata?.disabled,
        checked: metadata?.checked ?? (node.states.includes("checked") ? true : undefined),
        selected: metadata?.selected ?? (node.states.includes("selected") ? true : undefined),
        bounds,
        ariaLabel: metadata?.ariaLabel,
        label: metadata?.label,
        title: metadata?.title,
        placeholder: metadata?.placeholder,
        identity: metadata?.identity,
        heading: metadata?.heading,
        context: metadata?.context,
        nearbyText: metadata?.nearbyText,
        visible: metadata?.visible ?? true,
        enabled: metadata?.enabled ?? !node.states.includes("disabled"),
      };
      descriptor.descriptorText = descriptorSearchText(descriptor);
      elements.push(descriptor);
    }
    this.mergeDomSnapshotCandidates(elements, await this.captureDomSnapshotCandidates());
    const payload: BrowserSnapshot = {
      url: this.browserView.webContents.getURL() || documentState.url || this.state.url,
      title: this.browserView.webContents.getTitle() || this.state.title,
      text: await this.captureReadablePageText(),
      elements,
      refs,
      documentId: documentState.documentId,
      frameId: documentState.frameId,
    };
    this.elementRefs = payload.refs;
    this.elementDescriptors = new Map(payload.elements.map((element) => [element.ref, element]));
    this.snapshotDocument = {
      documentId: payload.documentId,
      frameId: payload.frameId,
      url: payload.url,
    };
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
    const recent = this.getRecentDescriptor();

    const candidates: BrowserResolveCandidate[] = descriptors.map((item) => {
      const lexical = computeLexicalScore(cleanQuery, item);
      const role = computeRoleScore(cleanQuery, item, options.role ?? "", options.action);
      const context = computeContextScore(cleanQuery, item, recent);
      const state = computeStateScore(item);
      const confidence = lexical.score * 0.48 + role.score * 0.22 + context.score * 0.18 + state.score * 0.12;
      const reasons = [
        ...lexical.reasons,
        ...role.reasons,
        ...context.reasons,
        ...state.reasons,
      ];
      return {
        ...item,
        confidence: Number(confidence.toFixed(4)),
        lexicalScore: Number(lexical.score.toFixed(4)),
        roleScore: Number(role.score.toFixed(4)),
        contextScore: Number(context.score.toFixed(4)),
        stateScore: Number(state.score.toFixed(4)),
        reasons: reasons.length ? [...new Set(reasons)] : ["weak-match"],
      };
    }).sort((a, b) =>
      b.confidence - a.confidence
      || targetSpecificityScore(cleanQuery, b) - targetSpecificityScore(cleanQuery, a)
      || elementArea(a) - elementArea(b)
    );

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
    const closeSecond = Boolean(best && second && best.confidence - second.confidence < AMBIGUITY_MARGIN);
    const closeSecondResolved = Boolean(best && second && isClearlyMoreSpecificTarget(cleanQuery, best, second));
    const ambiguous = Boolean(
      !best
      || best.confidence < minConfidence
      || (closeSecond && !closeSecondResolved)
      || best.enabled === false
      || best.disabled
      || (options.requireEditable && !best.editable)
      || strictActionMismatch
    );

    return {
      query: cleanQuery,
      candidates: top,
      resolver: "ax-tree",
      needsDisambiguation: ambiguous || undefined,
      needsVisionFallback: (!best || best.confidence < Math.min(0.55, minConfidence)) || undefined,
      strictActionMismatch: strictActionMismatch || undefined,
      selectedRef: ambiguous ? undefined : best.ref,
      minConfidence,
    };
  }

  private async locateTargetBySelector(selector: string) {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    return await this.browserView.webContents.executeJavaScript(
      browserLocateScript("selector", selector),
      true,
    ) as BrowserLocateScriptResult;
  }

  private async locateTargetByXPath(xpath: string) {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    return await this.browserView.webContents.executeJavaScript(
      browserLocateScript("xpath", xpath),
      true,
    ) as BrowserLocateScriptResult;
  }

  private async callBackendNodeFunction<T>(
    backendNodeId: number,
    functionDeclaration: string,
    args: unknown[] = [],
  ): Promise<T> {
    return this.withResolvedBackendNode(backendNodeId, async (cdp, objectId) => {
      const result = await cdp.sendCommand("Runtime.callFunctionOn", {
        objectId,
        awaitPromise: true,
        returnByValue: true,
        functionDeclaration,
        arguments: args.map((value) => ({ value })),
      }) as { result?: { value?: T }; exceptionDetails?: { text?: string } };
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text || "Backend node function failed.");
      }
      return result.result?.value as T;
    });
  }

  private async resolveRefEntry(ref: string): Promise<BrowserRefEntry> {
    if (!this.elementRefs.get(ref) && this.browserView) {
      await this.snapshot("resolve");
    }
    const entry = this.elementRefs.get(ref);
    if (!entry) {
      throw new Error(refError(ref));
    }
    if (await this.isBackendNodeLive(entry.backendNodeId)) {
      return entry;
    }
    const documentState = await this.readRootDocumentState().catch(() => this.snapshotDocument ?? { url: this.state.url });
    const nodes = await this.fetchAxTree(documentState.frameId);
    const refreshedBackendNodeId = findBackendNodeIdForRef(nodes, entry);
    if (refreshedBackendNodeId === undefined) {
      throw new Error(`Stale browser element ref: ${entry.ref} (${entry.role} "${entry.name}"). Take a new snapshot.`);
    }
    entry.backendNodeId = refreshedBackendNodeId;
    return entry;
  }

  private async refreshDescriptorFromBackendNode(ref: string, backendNodeId: number) {
    const descriptor = this.elementDescriptors.get(ref);
    if (!descriptor) return undefined;
    const metadata = await this.readDomNodeMetadata(backendNodeId);
    if (!metadata) return descriptor;
    const next: BrowserElementDescriptor = {
      ...descriptor,
      tag: metadata.tag || descriptor.tag,
      text: metadata.text ?? descriptor.text,
      value: metadata.value ?? descriptor.value,
      type: metadata.type ?? descriptor.type,
      href: metadata.href ?? descriptor.href,
      editable: metadata.editable ?? descriptor.editable,
      disabled: metadata.disabled ?? descriptor.disabled,
      checked: metadata.checked ?? descriptor.checked,
      selected: metadata.selected ?? descriptor.selected,
      bounds: normalizeTargetBounds(metadata.bounds) ?? descriptor.bounds,
      ariaLabel: metadata.ariaLabel ?? descriptor.ariaLabel,
      label: metadata.label ?? descriptor.label,
      title: metadata.title ?? descriptor.title,
      placeholder: metadata.placeholder ?? descriptor.placeholder,
      identity: metadata.identity ?? descriptor.identity,
      heading: metadata.heading ?? descriptor.heading,
      context: metadata.context ?? descriptor.context,
      nearbyText: metadata.nearbyText ?? descriptor.nearbyText,
      visible: metadata.visible ?? descriptor.visible,
      enabled: metadata.enabled ?? descriptor.enabled,
    };
    next.descriptorText = descriptorSearchText(next);
    this.elementDescriptors.set(ref, next);
    return next;
  }

  private async scrollBackendNodeIntoView(backendNodeId: number) {
    await this.callBackendNodeFunction(
      backendNodeId,
      String.raw`function() {
        if (this && typeof this.scrollIntoView === "function") {
          this.scrollIntoView({ block: "center", inline: "center" });
        }
        if (this && typeof this.focus === "function") {
          this.focus();
        }
        return true;
      }`,
    ).catch(() => undefined);
  }

  private getViewportPoint(relativePosition?: { xRatio: number; yRatio: number }): BrowserPoint {
    return {
      x: Math.round((this.browserView?.getBounds().width ?? this.bounds.width) * clampRatio(relativePosition?.xRatio)),
      y: Math.round((this.browserView?.getBounds().height ?? this.bounds.height) * clampRatio(relativePosition?.yRatio)),
    };
  }

  private async resolveTarget(
    target: BrowserTargetDescriptor | undefined,
    op: BrowserStepOperation,
    strategy: BrowserActionStrategy,
    minConfidence?: number,
  ): Promise<ResolvedBrowserTarget> {
    const requestedStrategy = strategy ?? "auto";
    const normalizedTarget = mergeTargetDescriptors(target);
    const naturalQuery = buildTargetQuery(normalizedTarget);
    const role = normalizedTarget?.role?.trim();
    const actionHint = actionHintForStepOperation(op);
    const requireEditable = stepUsesEditableTarget(op);

    if (normalizedTarget?.ref?.trim()) {
      const ref = normalizedTarget.ref.trim();
      try {
        const entry = await this.resolveRefEntry(ref);
        const descriptor = await this.refreshDescriptorFromBackendNode(ref, entry.backendNodeId)
          ?? this.elementDescriptors.get(ref);
        return {
          target: normalizedTarget,
          requestedStrategy,
          actualStrategy: "ref",
          ref,
          backendNodeId: entry.backendNodeId,
          bounds: normalizeTargetBounds(descriptor?.bounds),
          query: naturalQuery,
          role,
          confidence: 1,
        };
      } catch (error) {
        const descriptor = this.elementDescriptors.get(ref);
        if (descriptor?.selector && this.browserView) {
          const located = await this.locateTargetBySelector(descriptor.selector);
          if (located.ok) {
            const bounds = normalizeTargetBounds(located.bounds) ?? normalizeTargetBounds(descriptor.bounds);
            return {
              target: normalizedTarget,
              requestedStrategy,
              actualStrategy: "ref-selector",
              ref,
              selector: descriptor.selector,
              bounds,
              point: bounds ? buildPointFromBounds(bounds, normalizedTarget.relativePosition) : undefined,
              query: naturalQuery,
              role,
              confidence: 1,
            };
          }
        }
        if (!naturalQuery) {
          return {
            target: normalizedTarget,
            requestedStrategy,
            actualStrategy: "ref",
            ref,
            query: naturalQuery,
            role,
            warning: error instanceof Error ? error.message : String(error),
          };
        }
      }
    }

    if (normalizedTarget?.selector?.trim() && (requestedStrategy === "auto" || requestedStrategy === "dom" || requestedStrategy === "css")) {
      const selector = normalizedTarget.selector.trim();
      const located = await this.locateTargetBySelector(selector);
      if (located.ok) {
        return {
          target: normalizedTarget,
          requestedStrategy,
          actualStrategy: requestedStrategy === "css" ? "css" : "selector",
          selector,
          bounds: normalizeTargetBounds(located.bounds),
          point: located.bounds ? buildPointFromBounds(located.bounds, normalizedTarget.relativePosition) : undefined,
          query: naturalQuery,
          role,
          confidence: 1,
        };
      }
    }

    if (normalizedTarget?.xpath?.trim() && (requestedStrategy === "auto" || requestedStrategy === "xpath")) {
      const xpath = normalizedTarget.xpath.trim();
      const located = await this.locateTargetByXPath(xpath);
      if (located.ok) {
        return {
          target: normalizedTarget,
          requestedStrategy,
          actualStrategy: "xpath",
          xpath,
          bounds: normalizeTargetBounds(located.bounds),
          point: located.bounds ? buildPointFromBounds(located.bounds, normalizedTarget.relativePosition) : undefined,
          query: naturalQuery,
          role,
          confidence: 1,
        };
      }
    }

    const coordinateTarget = normalizeCoordinateTarget(normalizedTarget);
    if (coordinateTarget.point && (requestedStrategy === "auto" || requestedStrategy === "coordinate" || requestedStrategy === "cdp")) {
      return {
        target: normalizedTarget,
        requestedStrategy,
        actualStrategy: "coordinate",
        bounds: coordinateTarget.bounds,
        point: coordinateTarget.point,
        role,
        confidence: 1,
        warning: coordinateTarget.warning,
      };
    }

    if (coordinateTarget.bounds && (requestedStrategy === "auto" || requestedStrategy === "coordinate" || requestedStrategy === "cdp")) {
      const bounds = coordinateTarget.bounds;
      return {
        target: normalizedTarget,
        requestedStrategy,
        actualStrategy: "coordinate",
        bounds,
        point: coordinateTarget.point,
        role,
        confidence: 1,
      };
    }

    if (normalizedTarget?.relativePosition && requestedStrategy === "coordinate") {
      return {
        target: normalizedTarget,
        requestedStrategy,
        actualStrategy: "coordinate-viewport",
        point: this.getViewportPoint(normalizedTarget.relativePosition),
        role,
        confidence: 1,
      };
    }

    if (naturalQuery) {
      if (this.browserView) {
        await this.snapshot("resolve");
      } else if (!this.elementDescriptors.size) {
        throw new Error("Browser runtime is not available.");
      }
      const resolve = await this.buildResolveResult(naturalQuery, {
        action: actionHint,
        role,
        minConfidence: minConfidence ?? (op === "click" || op === "type" || op === "hover" || op === "drag" || op === "wheel" ? DIRECT_ACTION_MIN_CONFIDENCE : DEFAULT_MIN_CONFIDENCE),
        requireEditable,
      });
      const candidate = resolve.candidates[0];
      if (resolve.selectedRef) {
        const ref = resolve.selectedRef;
        const entry = await this.resolveRefEntry(ref).catch(() => undefined);
        const descriptor = entry
          ? await this.refreshDescriptorFromBackendNode(ref, entry.backendNodeId).catch(() => this.elementDescriptors.get(ref))
          : this.elementDescriptors.get(ref);
        return {
          target: normalizedTarget,
          requestedStrategy,
          actualStrategy: "ax",
          ref,
          backendNodeId: entry?.backendNodeId,
          selector: descriptor?.selector,
          bounds: normalizeTargetBounds(descriptor?.bounds),
          query: naturalQuery,
          role,
          confidence: candidate?.confidence,
          resolve,
          warning: shouldCaptureVisionFallback(requestedStrategy, resolve)
            ? "AX/DOM evidence is weak; vision fallback may be required."
            : undefined,
        };
      }
      return {
        target: normalizedTarget,
        requestedStrategy,
        actualStrategy: "ax",
        query: naturalQuery,
        role,
        confidence: candidate?.confidence,
        resolve,
        warning: shouldCaptureVisionFallback(requestedStrategy, resolve)
          ? "AX/ref resolver could not produce enough evidence; vision fallback may be required."
          : undefined,
      };
    }

    return {
      target: normalizedTarget,
      requestedStrategy,
      actualStrategy: requestedStrategy,
      query: naturalQuery,
      role,
      warning: "No browser target could be resolved from the provided descriptor.",
    };
  }

  /**
   * 高权限浏览器运行时脚本（action="script"）。
   *
   * 调用链：Agent 工具 browser_action → executors.ts → executeAction("script") → 本方法。
   *
   * 与 click/scroll 等内部使用的 webContents.executeJavaScript（页面上下文 IIFE）不同，
   * 此处通过 AsyncFunction 在 Electron 主进程 / Node 侧动态编译并执行 request.script，
   * 脚本可访问 BrowserView、CDP、require 等宿主能力，而非网页 DOM。
   *
   * 外部脚本注入点：
   * 1. 编译：new AsyncFunction(...contextKeys, "args", source) — source 即 request.script
   * 2. 执行：runner(...contextValues, runtimeArgs) — 真正运行注入代码
   */
  private async executeScript(request: BrowserActionRequest): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");

    // request.script 来自 Agent 工具参数，即外部注入的脚本源码
    const source = String(request.script ?? "");
    if (!source.trim()) {
      throw new Error("browser_action.script requires script.");
    }

    const timeoutMs = Math.max(1, Math.floor(Number(request.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS) || DEFAULT_SCRIPT_TIMEOUT_MS));
    const previousUrl = this.browserView.webContents.getURL();
    const electron = await import("electron").catch(() => {
      throw new Error("Browser runtime is only available in the Electron desktop app.");
    });
    const runtimeArgs = request.args ?? [];
    const defaultCacheTtlMs = normalizeScriptCacheTtlMs(request.scriptCacheTtlMs);
    const cacheActivity: ScriptCacheActivity = { writes: [], deletedKeys: [], cleared: 0 };
    const scriptCache = this.createScriptCacheApi(cacheActivity, defaultCacheTtlMs);

    // CDP 命令封装，供注入脚本通过 sendCommand / cdpSend 调用
    const sendCommand = async (method: string, params?: Record<string, unknown>) => (
      this.withCdp((cdp) => cdp.sendCommand(method, params ?? {}))
    );

    // 注入到脚本作用域的宿主对象；AsyncFunction 形参名与 Object.keys 顺序一致
    const context = {
      browserView: this.browserView,
      webContents: this.browserView.webContents,
      cdp: this.browserView.webContents.debugger,
      rawDebugger: this.browserView.webContents.debugger,
      sendCommand,
      cdpSend: sendCommand,
      scriptCache,
      browserManager: this,
      electron,
      require,
      Buffer,
      process,
      console,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
    } satisfies Record<string, unknown>;

    // 绕过普通 function 的 "use strict" 限制，构造可接受任意源码体的 AsyncFunction
    const AsyncFunction = Object.getPrototypeOf(async function noop() {
      return undefined;
    }).constructor as new (...args: string[]) => (...values: unknown[]) => Promise<unknown>;

    let runner: (...values: unknown[]) => Promise<unknown>;
    try {
      // 【注入点 1 / 编译】将 source 编译为 async (browserView, webContents, ..., args) => { source }
      runner = new AsyncFunction(...Object.keys(context), "args", source);
    } catch (error) {
      const snapshot = await this.snapshot("script");
      const compact = this.compactScriptSnapshot(snapshot, request);
      return {
        ...compact.state,
        ok: false,
        script: {
          durationMs: 0,
          error: browserScriptError(error),
          state: compact.report,
        },
      };
    }

    const startedAt = Date.now();
    // 【注入点 2 / 执行】在 Node 主进程运行编译后的函数；返回值经 JSON 序列化后回传 Agent
    const executionPromise = Promise.resolve().then(() => runner(...Object.values(context), runtimeArgs));
    const settledExecution = executionPromise
      .then((value) => ({ kind: "result" as const, value }))
      .catch((error) => ({ kind: "error" as const, error }));

    // 超时与执行竞态；超时后脚本可能仍在后台运行，此处仅不再等待
    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      settledExecution,
      new Promise<{ kind: "timeout" }>((resolve) => {
        timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
      }),
    ]) as { kind: "result"; value: unknown } | { kind: "error"; error: unknown } | { kind: "timeout" };
    if (timer) clearTimeout(timer);

    if (outcome.kind === "timeout") {
      executionPromise.catch(() => undefined);
      const snapshot = await this.snapshot("script");
      const compact = this.compactScriptSnapshot(snapshot, request);
      return {
        ...compact.state,
        ok: false,
        script: {
          durationMs: timeoutMs,
          timedOut: true,
          error: {
            name: "TimeoutError",
            message: `Browser runtime script timed out after ${timeoutMs}ms.`,
          },
          cache: buildScriptCacheReport(cacheActivity),
          state: compact.report,
        },
      };
    }

    // 等待导航/加载稳定后再 snapshot，保证返回的页面状态与脚本副作用一致
    await this.waitForActionSettled(previousUrl);
    const snapshot = await this.snapshot("script");
    const compact = this.compactScriptSnapshot(snapshot, request);
    if (outcome.kind === "error") {
      return {
        ...compact.state,
        ok: false,
        script: {
          durationMs: Date.now() - startedAt,
          error: browserScriptError(outcome.error),
          cache: buildScriptCacheReport(cacheActivity),
          state: compact.report,
        },
      };
    }

    const automaticCache = this.autoCacheScriptResult(outcome.value, request, cacheActivity);
    return {
      ...compact.state,
      ok: true,
      script: {
        durationMs: Date.now() - startedAt,
        result: browserScriptResultValue(outcome.value),
        cache: buildScriptCacheReport(cacheActivity, automaticCache),
        state: compact.report,
      },
    };
  }

  private buildStepResolutionTarget(target: BrowserTargetDescriptor | undefined) {
    const query = buildTargetQuery(target);
    return mergeTargetDescriptors(
      target,
      query ? { query } : undefined,
    );
  }

  private resultFromResolvedTarget(base: BrowserSingleStepResult, resolved: ResolvedBrowserTarget, error?: string): BrowserSingleStepResult {
    const topCandidate = resolved.resolve?.candidates[0];
    return {
      ...base,
      strategy: resolved.actualStrategy,
      target: resolved.target,
      selectedRef: resolved.ref,
      selectedBounds: resolved.bounds,
      confidence: resolved.confidence ?? topCandidate?.confidence,
      resolve: resolved.resolve,
      warning: resolved.warning,
      error,
    };
  }

  private interactionFailure(action: BrowserAction, result: BrowserSingleStepResult): BrowserActionResponse {
    this.state = { ...this.state, resolve: result.resolve, error: result.error, lastAction: action };
    this.emit();
    return { ok: false, ...this.getState(), resolve: result.resolve };
  }

  private async resolveInteractionBounds(resolved: ResolvedBrowserTarget) {
    let bounds = resolved.bounds;
    if (resolved.backendNodeId) {
      await this.scrollBackendNodeIntoView(resolved.backendNodeId);
      if (resolved.ref) {
        const descriptor = await this.refreshDescriptorFromBackendNode(resolved.ref, resolved.backendNodeId);
        bounds = normalizeTargetBounds(descriptor?.bounds) ?? bounds;
      } else {
        bounds = normalizeTargetBounds((await this.readDomNodeMetadata(resolved.backendNodeId))?.bounds) ?? bounds;
      }
    } else if (resolved.selector) {
      const located = await this.locateTargetBySelector(resolved.selector);
      bounds = normalizeTargetBounds(located.bounds) ?? bounds;
    } else if (resolved.xpath) {
      const located = await this.locateTargetByXPath(resolved.xpath);
      bounds = normalizeTargetBounds(located.bounds) ?? bounds;
    }
    return bounds;
  }

  private async performClickStep(
    base: BrowserSingleStepResult,
    step: BrowserSingleStep,
    target: BrowserTargetDescriptor | undefined,
    strategy: BrowserActionStrategy,
  ): Promise<BrowserSingleStepResult> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const resolved = await this.resolveTarget(this.buildStepResolutionTarget(target), "click", strategy, step.minConfidence);
    if (!resolved.ref && !resolved.selector && !resolved.xpath && !resolved.point && !resolved.bounds) {
      return this.resultFromResolvedTarget(
        base,
        resolved,
        resolved.resolve?.strictActionMismatch
          ? "AX/ref resolver refused to click because the best candidate does not contain the requested action text."
          : resolved.warning || "No browser element could be resolved for click.",
      );
    }

    const previousUrl = this.browserView.webContents.getURL();
    let bounds = resolved.bounds;
    if (resolved.backendNodeId) {
      await this.scrollBackendNodeIntoView(resolved.backendNodeId);
      if (resolved.ref) {
        const descriptor = await this.refreshDescriptorFromBackendNode(resolved.ref, resolved.backendNodeId);
        bounds = normalizeTargetBounds(descriptor?.bounds) ?? bounds;
      } else {
        bounds = normalizeTargetBounds((await this.readDomNodeMetadata(resolved.backendNodeId))?.bounds) ?? bounds;
      }
    } else if (resolved.selector || resolved.xpath) {
      const result = await this.browserView.webContents.executeJavaScript(
        browserScript("click", { ref: resolved.ref ?? "", selector: resolved.selector, xpath: resolved.xpath }),
        true,
      ) as BrowserClickScriptResult;
      if (!result?.ok) {
        return this.resultFromResolvedTarget(base, resolved, result?.error || "Failed to locate clickable bounds.");
      }
      bounds = normalizeTargetBounds(result.bounds) ?? bounds;
    }

    let interaction: BrowserInteractionResult;
    if (resolved.point && (strategy === "coordinate" || resolved.actualStrategy.startsWith("coordinate"))) {
      const pointer = await this.sendMouseClickPoint(resolved.point.x, resolved.point.y, bounds);
      interaction = {
        ...pointer,
        action: "click",
        ref: resolved.ref,
        query: resolved.query,
        bounds,
      };
    } else {
      const pointer = await this.sendMouseClickAt(bounds);
      interaction = {
        ...pointer,
        action: "click",
        ref: resolved.ref,
        query: resolved.query,
        bounds,
      };
    }

    this.recentInteractionRef = resolved.ref ?? this.recentInteractionRef;
    await this.waitForActionSettled(previousUrl);
    return {
      ...this.resultFromResolvedTarget(base, resolved),
      ok: true,
      strategy: `${resolved.actualStrategy}+${interaction.strategy ?? "input"}`,
      selectedBounds: bounds,
      interaction,
    };
  }

  private async performTypeStep(
    base: BrowserSingleStepResult,
    step: BrowserSingleStep,
    target: BrowserTargetDescriptor | undefined,
    strategy: BrowserActionStrategy,
  ): Promise<BrowserSingleStepResult> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const text = String(step.text ?? "");
    const resolutionTarget = this.buildStepResolutionTarget(target);
    const resolved = resolutionTarget
      ? await this.resolveTarget(resolutionTarget, "type", strategy, step.minConfidence)
      : {
        requestedStrategy: strategy,
        actualStrategy: "active-element",
      } as ResolvedBrowserTarget;
    if (resolutionTarget && !resolved.ref && !resolved.selector && !resolved.xpath && !resolved.point && !resolved.bounds) {
      return this.resultFromResolvedTarget(base, resolved, resolved.warning || "No editable browser element could be resolved for typing.");
    }

    const previousUrl = this.browserView.webContents.getURL();
    let bounds = await this.resolveInteractionBounds(resolved);
    const point = resolved.point
      || (bounds ? buildPointFromBounds(bounds, resolved.target?.relativePosition) : undefined);
    if (point) {
      const pointer = await this.sendMouseClickPoint(point.x, point.y, bounds);
      bounds = normalizeTargetBounds(pointer.bounds) ?? bounds;
      await delay(60);
    }

    const typeStrategy = "cdp-type";
    const inserted = text ? await this.sendCdpInsertText(text) : true;
    if (!inserted) {
      return this.resultFromResolvedTarget(base, resolved, "CDP text input failed.");
    }
    if (step.submit && !(await this.sendCdpKeyPress("Enter"))) {
      return this.resultFromResolvedTarget(base, resolved, "CDP Enter key press failed.");
    }
    this.recentInteractionRef = resolved.ref ?? "";
    await this.waitForActionSettled(previousUrl);
    return {
      ...this.resultFromResolvedTarget(base, resolved),
      ok: true,
      strategy: `${resolved.actualStrategy}+${typeStrategy}`,
      interaction: {
        action: "type",
        ref: resolved.ref,
        query: resolved.query,
        strategy: typeStrategy,
        bounds,
        x: point?.x,
        y: point?.y,
      },
    };
  }

  private async resolve(request: BrowserActionRequest): Promise<BrowserActionResponse> {
    const query = buildTargetQuery(request.target);
    if (!query) throw new Error("browser_action.resolve requires query.");
    await this.snapshot("resolve");
    const result = await this.buildResolveResult(query, {
      role: request.target?.role,
      limit: request.limit,
      minConfidence: request.minConfidence,
      action: "resolve",
    });
    this.state = { ...this.state, resolve: result, lastAction: "resolve", error: undefined };
    this.emit();
    return { ok: true, ...this.getState(), resolve: result };
  }

  private async navigate(url?: string): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const target = normalizeUrl(String(url ?? ""));
    await this.browserView.webContents.loadURL(target);
    await this.waitForActionSettled();
    return this.snapshot("navigate");
  }

  private async click(
    target: BrowserTargetDescriptor | undefined,
    strategy: BrowserActionStrategy,
    minConfidence?: number,
  ): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    if (!target) {
      throw new Error("browser_action.click requires target.");
    }
    const result = await this.performClickStep(
      { index: 0, op: "click", ok: false, strategy: "" },
      { op: "click", target, minConfidence },
      target,
      strategy,
    );
    if (!result.ok) {
      if (!result.resolve) throw new Error(result.error || "Click failed.");
      this.state = { ...this.state, resolve: result.resolve, error: result.error, lastAction: "click" };
      this.emit();
      return { ok: false, ...this.getState(), resolve: result.resolve };
    }
    const response = await this.snapshot("click");
    return { ...response, resolve: result.resolve, interaction: result.interaction };
  }

  private async sendMouseClickAt(bounds?: BrowserBounds): Promise<Omit<BrowserInteractionResult, "action">> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      throw new Error("AX/ref resolver found the element, but it has no clickable bounds.");
    }
    const x = Math.round(bounds.x + bounds.width / 2);
    const y = Math.round(bounds.y + bounds.height / 2);
    return this.sendMouseClickPoint(x, y, bounds);
  }

  private async sendMouseClickPoint(x: number, y: number, bounds?: BrowserBounds): Promise<Omit<BrowserInteractionResult, "action">> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const { webContents } = this.browserView;

    webContents.focus();
    if (await this.sendCdpMouseClick(x, y)) {
      return { strategy: "cdp", x, y, bounds };
    }
    throw new Error(`CDP click failed at viewport point (${x}, ${y}).`);
  }

  private async sendCdpInsertText(text: string) {
    if (!this.browserView) return false;
    try {
      await this.withCdp((cdp) => cdp.sendCommand("Input.insertText", { text }));
      return true;
    } catch (error) {
      serverLog(`[browser] CDP text input failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async sendCdpKeyPress(key: string) {
    if (!this.browserView) return false;
    try {
      await this.withCdp(async (cdp) => {
        const event = key === "Enter"
          ? { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
          : { key, code: key };
        await cdp.sendCommand("Input.dispatchKeyEvent", {
          type: "keyDown",
          ...event,
        });
        await cdp.sendCommand("Input.dispatchKeyEvent", {
          type: "keyUp",
          ...event,
        });
      });
      return true;
    } catch (error) {
      serverLog(`[browser] CDP key press failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
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
      serverLog(`[browser] CDP click failed: ${error instanceof Error ? error.message : String(error)}`);
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

  private async sendCdpMouseMove(x: number, y: number, buttons = 0) {
    if (!this.browserView) return false;
    const { debugger: cdp } = this.browserView.webContents;
    const wasAttached = cdp.isAttached();
    try {
      if (!wasAttached) cdp.attach("1.3");
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none",
        buttons,
        modifiers: 0,
        timestamp: Date.now() / 1000,
      });
      return true;
    } catch (error) {
      serverLog(`[browser] CDP mouse move failed; falling back to Electron input: ${error instanceof Error ? error.message : String(error)}`);
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

  private async sendCdpMouseWheel(x: number, y: number, deltaX: number, deltaY: number) {
    if (!this.browserView) return false;
    const { debugger: cdp } = this.browserView.webContents;
    const wasAttached = cdp.isAttached();
    try {
      if (!wasAttached) cdp.attach("1.3");
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x,
        y,
        button: "none",
        buttons: 0,
        modifiers: 0,
        deltaX,
        deltaY,
        timestamp: Date.now() / 1000,
      });
      return true;
    } catch (error) {
      serverLog(`[browser] CDP mouse wheel failed; falling back to Electron input: ${error instanceof Error ? error.message : String(error)}`);
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

  private async sendCdpMouseDrag(start: BrowserPoint, end: BrowserPoint) {
    if (!this.browserView) return false;
    const { debugger: cdp } = this.browserView.webContents;
    const wasAttached = cdp.isAttached();
    try {
      if (!wasAttached) cdp.attach("1.3");
      const timestamp = () => Date.now() / 1000;
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: start.x,
        y: start.y,
        button: "none",
        buttons: 0,
        modifiers: 0,
        timestamp: timestamp(),
      });
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x: start.x,
        y: start.y,
        button: "left",
        buttons: 1,
        clickCount: 1,
        modifiers: 0,
        timestamp: timestamp(),
      });
      await delay(35);
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x: end.x,
        y: end.y,
        button: "left",
        buttons: 1,
        modifiers: 0,
        timestamp: timestamp(),
      });
      await delay(35);
      await cdp.sendCommand("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x: end.x,
        y: end.y,
        button: "left",
        buttons: 0,
        clickCount: 1,
        modifiers: 0,
        timestamp: timestamp(),
      });
      return true;
    } catch (error) {
      serverLog(`[browser] CDP drag failed; falling back to Electron input: ${error instanceof Error ? error.message : String(error)}`);
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

  private async wheel(
    target: BrowserTargetDescriptor | undefined,
    strategy: BrowserActionStrategy,
    direction: "up" | "down" | "left" | "right" | undefined,
    amount?: number,
    deltaX?: number,
    deltaY?: number,
    minConfidence?: number,
  ): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const base: BrowserSingleStepResult = { index: 0, op: "wheel", ok: false, strategy, target };
    const resolutionTarget = this.buildStepResolutionTarget(target);
    const resolved = resolutionTarget
      ? await this.resolveTarget(resolutionTarget, "wheel", strategy, minConfidence)
      : {
        target,
        requestedStrategy: strategy,
        actualStrategy: "viewport",
        point: this.getViewportPoint(target?.relativePosition),
      } as ResolvedBrowserTarget;

    if (resolutionTarget && !resolved.ref && !resolved.selector && !resolved.xpath && !resolved.point && !resolved.bounds) {
      return this.interactionFailure("wheel", this.resultFromResolvedTarget(base, resolved, resolved.warning || "No browser point could be resolved for wheel."));
    }

    const point = resolved.point
      || (resolved.bounds ? buildPointFromBounds(resolved.bounds, resolved.target?.relativePosition) : undefined)
      || this.getViewportPoint(target?.relativePosition);
    const finalDeltaX = Number.isFinite(deltaX) ? Number(deltaX) : direction === "left"
      ? -Math.abs(amount ?? DEFAULT_WHEEL_DELTA)
      : direction === "right"
        ? Math.abs(amount ?? DEFAULT_WHEEL_DELTA)
        : 0;
    const finalDeltaY = Number.isFinite(deltaY) ? Number(deltaY) : direction === "up"
      ? -Math.abs(amount ?? DEFAULT_WHEEL_DELTA)
      : direction === "left" || direction === "right"
        ? 0
        : Math.abs(amount ?? DEFAULT_WHEEL_DELTA);

    const { webContents } = this.browserView;
    webContents.focus();
    const usedCdp = await this.sendCdpMouseWheel(point.x, point.y, finalDeltaX, finalDeltaY);
    if (!usedCdp) {
      webContents.sendInputEvent({ type: "mouseWheel", x: point.x, y: point.y, deltaX: finalDeltaX, deltaY: finalDeltaY, canScroll: true });
    }
    await this.waitForActionSettled();
    const response = await this.snapshot("wheel");
    return {
      ...response,
      resolve: resolved.resolve,
      interaction: {
        action: "wheel",
        ref: resolved.ref,
        query: resolved.query,
        strategy: usedCdp ? "cdp-wheel" : "electron-wheel",
        bounds: resolved.bounds,
        x: point.x,
        y: point.y,
      },
    };
  }

  private async hover(
    target: BrowserTargetDescriptor | undefined,
    strategy: BrowserActionStrategy,
    minConfidence?: number,
  ): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    if (!target) {
      throw new Error("browser_action.hover requires target.");
    }
    const base: BrowserSingleStepResult = { index: 0, op: "hover", ok: false, strategy, target };
    const resolved = await this.resolveTarget(this.buildStepResolutionTarget(target), "hover", strategy, minConfidence);
    const point = resolved.point
      || (resolved.bounds ? buildPointFromBounds(resolved.bounds, resolved.target?.relativePosition) : undefined);
    if (!point) {
      return this.interactionFailure("hover", this.resultFromResolvedTarget(base, resolved, resolved.warning || "No browser point could be resolved for hover."));
    }

    const { webContents } = this.browserView;
    webContents.focus();
    const usedCdp = await this.sendCdpMouseMove(point.x, point.y);
    if (!usedCdp) {
      webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y, movementX: 0, movementY: 0 });
    }
    await delay(50);
    await this.waitForDomSettled(400, 120);
    const response = await this.snapshot("hover");
    return {
      ...response,
      resolve: resolved.resolve,
      interaction: {
        action: "hover",
        ref: resolved.ref,
        query: resolved.query,
        strategy: usedCdp ? "cdp-hover" : "electron-hover",
        bounds: resolved.bounds,
        x: point.x,
        y: point.y,
      },
    };
  }

  private async drag(
    target: BrowserTargetDescriptor | undefined,
    strategy: BrowserActionStrategy,
    deltaX?: number,
    deltaY?: number,
    minConfidence?: number,
  ): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    if (!target) {
      throw new Error("browser_action.drag requires target.");
    }
    if (!Number.isFinite(deltaX) && !Number.isFinite(deltaY)) {
      throw new Error("browser_action.drag requires deltaX or deltaY.");
    }

    const base: BrowserSingleStepResult = { index: 0, op: "drag", ok: false, strategy, target };
    const resolved = await this.resolveTarget(this.buildStepResolutionTarget(target), "drag", strategy, minConfidence);
    const start = resolved.point
      || (resolved.bounds ? buildPointFromBounds(resolved.bounds, resolved.target?.relativePosition) : undefined);
    if (!start) {
      return this.interactionFailure("drag", this.resultFromResolvedTarget(base, resolved, resolved.warning || "No browser point could be resolved for drag."));
    }

    const end = {
      x: Math.round(start.x + Number(deltaX ?? 0)),
      y: Math.round(start.y + Number(deltaY ?? 0)),
    };
    const { webContents } = this.browserView;
    webContents.focus();
    const usedCdp = await this.sendCdpMouseDrag(start, end);
    if (!usedCdp) {
      webContents.sendInputEvent({ type: "mouseMove", x: start.x, y: start.y, movementX: 0, movementY: 0 });
      webContents.sendInputEvent({ type: "mouseDown", x: start.x, y: start.y, button: "left", clickCount: 1 });
      await delay(35);
      webContents.sendInputEvent({ type: "mouseMove", x: end.x, y: end.y, movementX: end.x - start.x, movementY: end.y - start.y });
      await delay(35);
      webContents.sendInputEvent({ type: "mouseUp", x: end.x, y: end.y, button: "left", clickCount: 1 });
    }
    await this.waitForActionSettled();
    const response = await this.snapshot("drag");
    return {
      ...response,
      resolve: resolved.resolve,
      interaction: {
        action: "drag",
        ref: resolved.ref,
        query: resolved.query,
        strategy: usedCdp ? "cdp-drag" : "electron-drag",
        bounds: resolved.bounds,
        x: end.x,
        y: end.y,
      },
    };
  }

  private async key(key?: string): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const keyCode = String(key ?? "").trim();
    if (!keyCode) {
      throw new Error("browser_action.key requires key.");
    }
    const { webContents } = this.browserView;
    webContents.focus();
    webContents.sendInputEvent({ type: "keyDown", keyCode });
    if (keyCode.length === 1) {
      webContents.sendInputEvent({ type: "char", keyCode });
    }
    webContents.sendInputEvent({ type: "keyUp", keyCode });
    await this.waitForActionSettled();
    const response = await this.snapshot("key");
    return {
      ...response,
      interaction: {
        action: "key",
        strategy: "keyboard",
      },
    };
  }

  private async type(
    target: BrowserTargetDescriptor | undefined,
    strategy: BrowserActionStrategy,
    text = "",
    submit = false,
    minConfidence?: number,
  ): Promise<BrowserActionResponse> {
    if (!this.browserView) throw new Error("Browser runtime is not available.");
    const result = await this.performTypeStep(
      { index: 0, op: "type", ok: false, strategy: "" },
      { op: "type", target, text, submit, minConfidence },
      target,
      strategy,
    );
    if (!result.ok) {
      this.state = { ...this.state, resolve: result.resolve, error: result.error, lastAction: "type" };
      this.emit();
      return { ok: false, ...this.getState(), resolve: result.resolve };
    }
    const response = await this.snapshot("type");
    return { ...response, resolve: result.resolve, interaction: result.interaction };
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
