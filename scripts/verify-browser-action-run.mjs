import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const browserManagerModule = await import(pathToFileURL(path.join(repoRoot, "dist-electron", "electron", "server", "browser-manager.js")));

const { BrowserManager } = browserManagerModule;

function okState(action = "snapshot") {
  return {
    ok: true,
    url: "https://mail.test",
    title: "Mail",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    presentation: "hidden",
    zoomFactor: 1,
    history: [],
    elements: [],
    text: "",
    lastAction: action,
  };
}

function seedManager() {
  const manager = new BrowserManager();
  manager.setTestSnapshotData([
    { ref: "e1", backendNodeId: 101, role: "button", name: "Compose", nth: 0 },
    { ref: "e2", backendNodeId: 102, role: "textbox", name: "To", nth: 0 },
    { ref: "e3", backendNodeId: 103, role: "button", name: "Send", nth: 0 },
  ], [
    {
      ref: "e1",
      tag: "button",
      role: "button",
      name: "Compose",
      text: "Compose",
      editable: false,
      visible: true,
      enabled: true,
      descriptorText: "Compose | button | toolbar | enabled",
      context: "toolbar",
      bounds: { x: 20, y: 20, width: 120, height: 32 },
    },
    {
      ref: "e2",
      tag: "input",
      role: "textbox",
      name: "To",
      placeholder: "Recipient",
      text: "",
      editable: true,
      visible: true,
      enabled: true,
      descriptorText: "Recipient | To | textbox | enabled",
      context: "compose dialog",
      bounds: { x: 20, y: 80, width: 240, height: 32 },
    },
    {
      ref: "e3",
      tag: "button",
      role: "button",
      name: "Send",
      text: "Send",
      editable: false,
      visible: true,
      enabled: true,
      descriptorText: "Send | button | compose dialog | enabled",
      context: "compose dialog",
      bounds: { x: 20, y: 140, width: 100, height: 32 },
    },
  ], "e1");
  return manager;
}

function seedStaleRefManager() {
  const manager = new BrowserManager();
  manager.setTestSnapshotData([
    { ref: "e1", backendNodeId: 10, role: "button", name: "OK", nth: 0 },
    { ref: "e2", backendNodeId: 11, role: "button", name: "OK", nth: 1 },
  ], [
    {
      ref: "e1",
      tag: "button",
      role: "button",
      name: "OK",
      text: "OK",
      visible: true,
      enabled: true,
      descriptorText: "OK | button | enabled",
      bounds: { x: 10, y: 10, width: 60, height: 24 },
    },
    {
      ref: "e2",
      tag: "button",
      role: "button",
      name: "OK",
      text: "OK",
      visible: true,
      enabled: true,
      descriptorText: "OK | button | enabled",
      bounds: { x: 90, y: 10, width: 60, height: 24 },
    },
  ]);
  manager.isBackendNodeLive = async () => false;
  manager.readRootDocumentState = async () => ({ url: "https://mail.test", documentId: "doc-1" });
  manager.fetchAxTree = async () => [
    { nodeId: "1", role: { type: "role", value: "RootWebArea" }, childIds: ["2", "3"] },
    { nodeId: "2", role: { type: "role", value: "button" }, name: { type: "string", value: "OK" }, backendDOMNodeId: 20 },
    { nodeId: "3", role: { type: "role", value: "button" }, name: { type: "string", value: "OK" }, backendDOMNodeId: 21 },
  ];
  manager.refreshDescriptorFromBackendNode = async (ref, backendNodeId) => {
    const current = manager.elementDescriptors.get(ref);
    if (!current) return undefined;
    const next = { ...current, bounds: backendNodeId === 21 ? { x: 200, y: 10, width: 60, height: 24 } : current.bounds };
    manager.elementDescriptors.set(ref, next);
    return next;
  };
  return manager;
}

function seedGenericDivManager() {
  const manager = new BrowserManager();
  manager.setTestSnapshotData([
    { ref: "e1", backendNodeId: 201, role: "generic", name: "Search Create Inbox", nth: 0 },
    { ref: "e2", backendNodeId: 202, role: "generic", name: "Create", nth: 0 },
  ], [
    {
      ref: "e1",
      tag: "div",
      role: "generic",
      name: "Search Create Inbox",
      text: "Search Create Inbox",
      editable: false,
      visible: true,
      enabled: true,
      descriptorText: "Search Create Inbox | generic | div | enabled",
      context: "main",
      bounds: { x: 0, y: 0, width: 900, height: 700 },
    },
    {
      ref: "e2",
      tag: "div",
      role: "generic",
      name: "Create",
      text: "Create",
      editable: false,
      visible: true,
      enabled: true,
      identity: "nav-item",
      descriptorText: "Create | nav-item | generic | div | nav | enabled",
      context: "nav",
      bounds: { x: 16, y: 48, width: 72, height: 32 },
    },
  ]);
  return manager;
}

function createScriptManager() {
  const manager = new BrowserManager();
  const cdpCalls = [];
  const executedPageScripts = [];
  const cdp = {
    attached: false,
    isAttached() {
      return this.attached;
    },
    attach() {
      this.attached = true;
    },
    detach() {
      this.attached = false;
    },
    async sendCommand(method, params) {
      cdpCalls.push({ method, params });
      return { ok: true, method, params };
    },
  };
  const webContents = {
    debugger: cdp,
    isLoading: () => false,
    getURL: () => "https://example.test/path",
    getTitle: () => "Example",
    getZoomFactor: () => 1,
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
    },
    executeJavaScript: async (script) => {
      executedPageScripts.push(script);
      if (script === "(() => 6 * 7)()") return 42;
      return { echoed: script };
    },
    sendInputEvent: () => {},
    focus: () => {},
  };
  const browserView = {
    webContents,
    getBounds: () => ({ x: 10, y: 20, width: 640, height: 480 }),
    setBounds: () => {},
  };
  browserView.self = browserView;
  manager.ensure = async () => {};
  manager.waitForActionSettled = async () => {};
  manager.snapshot = async (action) => okState(action);
  manager.browserView = browserView;
  return { manager, cdpCalls, executedPageScripts };
}

{
  const manager = seedGenericDivManager();
  const resolved = await manager.resolveTarget({ query: "Create", role: "button" }, "click", "auto", 0.72);
  assert.equal(resolved.ref, "e2");
  assert.equal(resolved.actualStrategy, "ax");
  assert.equal(resolved.resolve?.candidates[0]?.reasons.includes("role-generic-click"), true);
}

{
  const manager = new BrowserManager();
  const elements = [
    {
      ref: "e1",
      tag: "div",
      role: "generic",
      name: "Search Create Inbox",
      text: "Search Create Inbox",
      editable: false,
      visible: true,
      enabled: true,
      descriptorText: "Search Create Inbox | generic | div | enabled",
      context: "main",
      bounds: { x: 0, y: 0, width: 900, height: 700 },
    },
  ];
  manager.mergeDomSnapshotCandidates(elements, {
    url: "https://mail.test",
    title: "Mail",
    text: "Search Create Inbox",
    elements: [
      {
        ref: "e1",
        tag: "div",
        role: "generic",
        name: "Create",
        text: "Create",
        selector: "div.sidebar > div:nth-of-type(1)",
        editable: false,
        visible: true,
        enabled: true,
        bounds: { x: 16, y: 48, width: 72, height: 32 },
      },
    ],
    refs: [["e1", "div.sidebar > div:nth-of-type(1)"]],
  });
  manager.setTestSnapshotData([], elements);
  const resolved = await manager.resolveTarget({ query: "Create", role: "button" }, "click", "auto", 0.72);
  assert.equal(resolved.ref, "d1");
  assert.equal(resolved.selector, "div.sidebar > div:nth-of-type(1)");
}

{
  const manager = seedManager();
  const resolved = await manager.resolveTarget({ query: "send", role: "button" }, "click", "auto", 0.72);
  assert.equal(resolved.ref, "e3");
  assert.equal(resolved.actualStrategy, "ax");
}

{
  const manager = seedManager();
  const resolved = await manager.resolveTarget({ query: "recipient", role: "textbox" }, "type", "auto", 0.72);
  assert.equal(resolved.ref, "e2");
  assert.equal(resolved.actualStrategy, "ax");
}

{
  const manager = seedStaleRefManager();
  const resolved = await manager.resolveTarget({ ref: "e2" }, "click", "auto", 0.72);
  assert.equal(resolved.backendNodeId, 21);
  assert.deepEqual(resolved.bounds, { x: 200, y: 10, width: 60, height: 24 });
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.snapshot = async () => okState("snapshot");
  manager.resolve = async () => ({ ...okState("resolve"), resolve: { query: "x", candidates: [], resolver: "ax-tree", minConfidence: 0.72 } });
  manager.click = async () => okState("click");
  manager.type = async () => okState("type");
  manager.scroll = async () => okState("scroll");
  manager.wheel = async () => okState("wheel");
  manager.hover = async () => okState("hover");
  manager.drag = async () => okState("drag");
  manager.key = async () => okState("key");

  assert.equal((await manager.executeAction({ action: "snapshot" })).lastAction, "snapshot");
  assert.equal((await manager.executeAction({ action: "resolve", target: { query: "send" } })).lastAction, "resolve");
  assert.equal((await manager.executeAction({ action: "click", target: { query: "send" } })).lastAction, "click");
  assert.equal((await manager.executeAction({ action: "type", target: { query: "recipient" }, text: "hello" })).lastAction, "type");
  assert.equal((await manager.executeAction({ action: "scroll", direction: "down", amount: 200 })).lastAction, "scroll");
  assert.equal((await manager.executeAction({ action: "wheel", direction: "down", amount: 200 })).lastAction, "wheel");
  assert.equal((await manager.executeAction({ action: "hover", target: { query: "send" } })).lastAction, "hover");
  assert.equal((await manager.executeAction({ action: "drag", target: { bounds: { x: 10, y: 10, width: 20, height: 20 } }, deltaX: 10 })).lastAction, "drag");
  assert.equal((await manager.executeAction({ action: "key", key: "Enter" })).lastAction, "key");
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.waitForActionSettled = async () => {};
  manager.snapshot = async (action) => okState(action);
  manager.browserView = {
    webContents: {
      isLoading: () => false,
      getURL: () => "https://mail.test",
      getTitle: () => "Mail",
      getZoomFactor: () => 1,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
      },
    },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
  };
  let clickPoint;
  manager.sendMouseClickPoint = async (x, y, bounds) => {
    clickPoint = { x, y, bounds };
    return { strategy: "stub", x, y, bounds };
  };

  const response = await manager.executeAction({
    action: "click",
    target: { bounds: { x: 595, y: 228, width: 37, height: 37 } },
    strategy: "coordinate",
  });

  assert.equal(response.ok, true);
  assert.deepEqual(clickPoint, {
    x: 614,
    y: 247,
    bounds: { x: 595, y: 228, width: 37, height: 37 },
  });
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.waitForActionSettled = async () => {};
  manager.snapshot = async (action) => okState(action);
  manager.browserView = {
    webContents: {
      isLoading: () => false,
      getURL: () => "https://mail.test",
      getTitle: () => "Mail",
      getZoomFactor: () => 1,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
      },
    },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
  };
  let clickPoint;
  manager.sendMouseClickPoint = async (x, y, bounds) => {
    clickPoint = { x, y, bounds };
    return { strategy: "stub", x, y, bounds };
  };

  const response = await manager.executeAction({
    action: "click",
    target: { x: 80, y: 56 },
    strategy: "coordinate",
  });

  assert.equal(response.ok, true);
  assert.deepEqual(clickPoint, { x: 80, y: 56, bounds: undefined });
  assert.equal(response.interaction?.strategy, "stub");
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.waitForActionSettled = async () => {};
  manager.snapshot = async (action) => okState(action);
  manager.browserView = {
    webContents: {
      isLoading: () => false,
      getURL: () => "https://mail.test",
      getTitle: () => "Mail",
      getZoomFactor: () => 0.8,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
      },
    },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
  };
  let clickPoint;
  manager.sendMouseClickPoint = async (x, y, bounds) => {
    clickPoint = { x, y, bounds };
    return { strategy: "stub", x, y, bounds };
  };

  const response = await manager.executeAction({
    action: "click",
    target: {
      x: 180,
      y: 50,
      bounds: { x: 12, y: 60, width: 196, height: 36 },
    },
    strategy: "coordinate",
  });

  assert.equal(response.ok, true);
  assert.deepEqual(clickPoint, {
    x: 110,
    y: 78,
    bounds: { x: 12, y: 60, width: 196, height: 36 },
  });
}

{
  const { manager } = createScriptManager();
  const response = await manager.executeAction({
    action: "script",
    script: "return { url: webContents.getURL(), title: webContents.getTitle(), loading: webContents.isLoading() };",
  });
  assert.equal(response.ok, true);
  assert.deepEqual(response.script?.result?.value, {
    url: "https://example.test/path",
    title: "Example",
    loading: false,
  });
}

{
  const { manager, executedPageScripts } = createScriptManager();
  const response = await manager.executeAction({
    action: "script",
    script: 'return await webContents.executeJavaScript("(() => 6 * 7)()", true);',
  });
  assert.equal(response.ok, true);
  assert.equal(response.script?.result?.value, 42);
  assert.deepEqual(executedPageScripts, ["(() => 6 * 7)()"]);
}

{
  const { manager } = createScriptManager();
  const response = await manager.executeAction({
    action: "script",
    script: "return { bounds: browserView.getBounds(), visible: browserView.getBounds().width > 0 };",
  });
  assert.equal(response.ok, true);
  assert.deepEqual(response.script?.result?.value, {
    bounds: { x: 10, y: 20, width: 640, height: 480 },
    visible: true,
  });
}

{
  const { manager, cdpCalls } = createScriptManager();
  const response = await manager.executeAction({
    action: "script",
    script: 'return await sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: 12, y: 34 });',
  });
  assert.equal(response.ok, true);
  assert.equal(cdpCalls[0]?.method, "Input.dispatchMouseEvent");
  assert.deepEqual(response.script?.result?.value, {
    ok: true,
    method: "Input.dispatchMouseEvent",
    params: { type: "mouseMoved", x: 12, y: 34 },
  });
}

{
  const { manager } = createScriptManager();
  const response = await manager.executeAction({
    action: "script",
    script: "return browserView;",
  });
  assert.equal(response.ok, true);
  assert.equal(response.script?.result?.format, "inspect");
  assert.match(response.script?.result?.text ?? "", /Circular|getBounds/);
}

{
  const { manager } = createScriptManager();
  const response = await manager.executeAction({
    action: "script",
    script: 'throw new Error("boom");',
  });
  assert.equal(response.ok, false);
  assert.equal(response.script?.error?.message, "boom");
}

{
  const { manager } = createScriptManager();
  const response = await manager.executeAction({
    action: "script",
    timeoutMs: 10,
    script: "await new Promise((resolve) => setTimeout(resolve, 50)); return 1;",
  });
  assert.equal(response.ok, false);
  assert.equal(response.script?.timedOut, true);
  assert.match(response.script?.error?.message ?? "", /timed out/i);
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.snapshot = async (action) => okState(action);
  const response = await manager.executeAction({ action: "resolve", query: "send" });
  assert.equal(response.ok, true);
  assert.equal(response.resolve?.selectedRef, "e3");
}

{
  const manager = seedManager();
  manager.ensure = async () => {};
  manager.waitForActionSettled = async () => {};
  manager.snapshot = async (action) => okState(action);
  manager.browserView = {
    webContents: {
      isLoading: () => false,
      getURL: () => "https://mail.test",
      getTitle: () => "Mail",
      getZoomFactor: () => 1,
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
      },
    },
    getBounds: () => ({ x: 0, y: 0, width: 1280, height: 800 }),
  };
  manager.resolveRefEntry = async (ref) => ({ ref, backendNodeId: 101, role: "button", name: "Compose", nth: 0 });
  manager.scrollBackendNodeIntoView = async () => {};
  manager.refreshDescriptorFromBackendNode = async () => ({
    ref: "e1",
    tag: "button",
    role: "button",
    name: "Compose",
    text: "Compose",
    bounds: { x: 20, y: 20, width: 120, height: 32 },
  });
  let clickPoint;
  manager.sendMouseClickPoint = async (x, y, bounds) => {
    clickPoint = { x, y, bounds };
    return { strategy: "stub", x, y, bounds };
  };
  const response = await manager.executeAction({ action: "click", target: "e1" });
  assert.equal(response.ok, true);
  assert.deepEqual(clickPoint, {
    x: 80,
    y: 36,
    bounds: { x: 20, y: 20, width: 120, height: 32 },
  });
  assert.equal(response.interaction?.strategy, "stub");
}

{
  const manager = seedManager();
  await assert.rejects(
    manager.executeAction({ action: "click", steps: [{ op: "click", target: { query: "send" } }] }),
    /no longer accepts steps/i,
  );
  manager.ensure = async () => {};
  await assert.rejects(
    manager.executeAction({ action: "run" }),
    /Unsupported browser_action\.action/i,
  );
}

console.log("browser_action verification passed");
process.exit(0);
