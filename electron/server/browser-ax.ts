export interface BrowserAxValue {
  type: string;
  value?: string | number | boolean;
}

export interface BrowserAxProperty {
  name: string;
  value: BrowserAxValue;
}

export interface BrowserAxNode {
  nodeId: string;
  ignored?: boolean;
  role?: BrowserAxValue;
  name?: BrowserAxValue;
  description?: BrowserAxValue;
  value?: BrowserAxValue;
  properties?: BrowserAxProperty[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

export interface BrowserRefEntry {
  ref: string;
  backendNodeId: number;
  role: string;
  name: string;
  nth: number;
}

export interface BrowserActionableAxNode {
  backendNodeId: number;
  role: string;
  name: string;
  value?: string;
  states: string[];
}

const INTERACTIVE_AX_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "textarea",
  "checkbox",
  "radio",
  "combobox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "switch",
  "slider",
  "spinbutton",
  "option",
  "treeitem",
  "listbox",
  "DisclosureTriangle",
]);

const ROOT_AX_ROLES: ReadonlySet<string> = new Set(["RootWebArea", "WebArea"]);

const SKIP_AX_ROLES: ReadonlySet<string> = new Set([
  "none",
  "presentation",
  "LineBreak",
  "InlineTextBox",
  "StaticText",
  "text",
]);

const VALUE_AX_ROLES: ReadonlySet<string> = new Set([
  "textbox",
  "searchbox",
  "textarea",
  "combobox",
  "spinbutton",
]);

export class BrowserRefMap {
  readonly byRef = new Map<string, BrowserRefEntry>();
  private nextRefNum = 1;
  private nextFallbackRefNum = 1;
  private readonly byStableNode = new Map<string, string>();
  private readonly stableRefs = new Set<string>();
  private readonly nthCounter = new Map<string, number>();

  beginSnapshot(): void {
    this.byRef.clear();
    this.nthCounter.clear();
    this.nextFallbackRefNum = 1;
  }

  forkForSnapshot(): BrowserRefMap {
    const fork = new BrowserRefMap();
    fork.nextRefNum = this.nextRefNum;
    for (const [key, ref] of this.byStableNode) {
      fork.byStableNode.set(key, ref);
    }
    for (const ref of this.stableRefs) {
      fork.stableRefs.add(ref);
    }
    fork.beginSnapshot();
    return fork;
  }

  reset(): void {
    this.byRef.clear();
    this.byStableNode.clear();
    this.stableRefs.clear();
    this.nthCounter.clear();
    this.nextRefNum = 1;
    this.nextFallbackRefNum = 1;
  }

  mint(node: { backendNodeId: number; role: string; name: string; documentId?: string }): string {
    const key = `${node.role}\u0000${node.name}`;
    const nth = this.nthCounter.get(key) ?? 0;
    this.nthCounter.set(key, nth + 1);

    const stableKey = node.documentId
      ? `${node.documentId}\u0000${node.backendNodeId}`
      : undefined;
    const ref = stableKey ? this.refForStableNode(stableKey) : this.nextFallbackRef();
    this.byRef.set(ref, {
      ref,
      backendNodeId: node.backendNodeId,
      role: node.role,
      name: node.name,
      nth,
    });
    return ref;
  }

  get(ref: string): BrowserRefEntry | undefined {
    return this.byRef.get(ref);
  }

  get size(): number {
    return this.byRef.size;
  }

  private refForStableNode(key: string): string {
    const existing = this.byStableNode.get(key);
    if (existing !== undefined) return existing;

    const ref = this.nextRef();
    this.byStableNode.set(key, ref);
    this.stableRefs.add(ref);
    return ref;
  }

  private nextRef(): string {
    for (;;) {
      const ref = `e${this.nextRefNum++}`;
      if (!this.isReserved(ref)) return ref;
    }
  }

  private nextFallbackRef(): string {
    for (;;) {
      const ref = `e${this.nextFallbackRefNum++}`;
      if (!this.isReserved(ref)) return ref;
    }
  }

  private isReserved(ref: string): boolean {
    if (this.byRef.has(ref)) return true;
    return this.stableRefs.has(ref);
  }
}

export function iterActionableAxNodes(nodes: BrowserAxNode[]): BrowserActionableAxNode[] {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const roots = nodes
    .filter((node) => ROOT_AX_ROLES.has(axString(node.role)))
    .map((node) => node.nodeId);
  const start = roots.length ? roots : nodes[0] ? [nodes[0].nodeId] : [];
  const result: BrowserActionableAxNode[] = [];

  const visit = (nodeId: string): void => {
    const node = byId.get(nodeId);
    if (!node) return;

    const role = axString(node.role);
    const name = axString(node.name);
    if (isActionableNode(node, role, name)) {
      result.push({
        backendNodeId: node.backendDOMNodeId as number,
        role,
        name,
        value: VALUE_AX_ROLES.has(role) ? axString(node.value) || undefined : undefined,
        states: formatStates(node),
      });
    }

    for (const childId of node.childIds ?? []) {
      visit(childId);
    }
  };

  for (const rootId of start) {
    visit(rootId);
  }

  return result;
}

export function findBackendNodeIdForRef(nodes: BrowserAxNode[], entry: BrowserRefEntry): number | undefined {
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));
  const roots = nodes
    .filter((node) => ROOT_AX_ROLES.has(axString(node.role)))
    .map((node) => node.nodeId);
  const start = roots.length ? roots : nodes[0] ? [nodes[0].nodeId] : [];
  let count = 0;
  let found: number | undefined;

  const visit = (nodeId: string): void => {
    if (found !== undefined) return;
    const node = byId.get(nodeId);
    if (!node) return;

    const role = axString(node.role);
    const name = axString(node.name);
    if (
      isActionableNode(node, role, name)
      && role === entry.role
      && name === entry.name
    ) {
      if (count === entry.nth) {
        found = node.backendDOMNodeId;
        return;
      }
      count += 1;
    }

    for (const childId of node.childIds ?? []) {
      visit(childId);
    }
  };

  for (const rootId of start) {
    visit(rootId);
  }
  return found;
}

function isActionableNode(node: BrowserAxNode, role: string, name: string): boolean {
  if (node.ignored) return false;
  if (!node.backendDOMNodeId) return false;
  if (!role || SKIP_AX_ROLES.has(role) || ROOT_AX_ROLES.has(role)) return false;
  if (INTERACTIVE_AX_ROLES.has(role)) return true;
  if (hasBooleanProperty(node, "focusable")) return true;
  if ((role === "generic" || role === "group") && name) return true;
  return false;
}

function hasBooleanProperty(node: BrowserAxNode, propertyName: string): boolean {
  return node.properties?.some((property) => property.name === propertyName && property.value.value === true) ?? false;
}

function formatStates(node: BrowserAxNode): string[] {
  const states: string[] = [];
  for (const property of node.properties ?? []) {
    const value = property.value.value;
    switch (property.name) {
      case "checked":
        if (value === true) states.push("checked");
        else if (value === "mixed") states.push("indeterminate");
        break;
      case "disabled":
        if (value === true) states.push("disabled");
        break;
      case "expanded":
        if (value === true) states.push("expanded");
        else if (value === false) states.push("collapsed");
        break;
      case "required":
        if (value === true) states.push("required");
        break;
      case "selected":
        if (value === true) states.push("selected");
        break;
      case "level":
        states.push(`level=${value}`);
        break;
      default:
        break;
    }
  }
  return states;
}

function axString(value?: BrowserAxValue): string {
  return typeof value?.value === "string" ? value.value : "";
}
