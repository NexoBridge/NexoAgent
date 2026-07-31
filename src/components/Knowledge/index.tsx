import React, { useEffect, useMemo, useState } from "react";
import { Tree, Button, Input, Modal, message } from "antd";
import { BookOutlined, FileOutlined, InboxOutlined } from "@ant-design/icons";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import { apiGet, apiPost, apiDelete } from "../../services/api";
import { useI18n } from "../../i18n";
import { OverflowMenuButton } from "../Common/OverflowMenuButton";
import "./index.scss";

interface TreeNode {
  key: string;
  title: string;
  children?: TreeNode[];
  isLeaf?: boolean;
}

interface KnowledgeApiNode {
  name: string;
  path: string;
  type: "file" | "dir";
  children?: KnowledgeApiNode[];
}

interface KnowledgeProps {
  openPath?: string | null;
}

function mapApiNodeToTreeNode(node: KnowledgeApiNode): TreeNode {
  return {
    key: node.path,
    title: node.name,
    isLeaf: node.type === "file",
    children: node.children?.map(mapApiNodeToTreeNode),
  };
}

function parentPathKeys(filePath: string) {
  const parts = filePath.split("/").filter(Boolean);
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export default function Knowledge({ openPath = null }: KnowledgeProps) {
  const { lang, t } = useI18n();
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [newFileName, setNewFileName] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);

  const ui = useMemo(
    () => ({
      createFile: lang === "zh" ? "\u65b0\u5efa\u6587\u4ef6" : "New File",
      importFiles: lang === "zh" ? "\u62d6\u62fd\u6587\u4ef6\u5bfc\u5165" : "Drop files to import",
      importHint: lang === "zh" ? "\u652f\u6301 Markdown \u548c\u6587\u672c\u6587\u4ef6\uff0c\u5bfc\u5165\u540e\u81ea\u52a8\u5efa\u7acb\u5411\u91cf\u7d22\u5f15" : "Markdown and text files are indexed automatically after import.",
      importSuccess: (count: number) =>
        lang === "zh" ? `\u5df2\u5bfc\u5165 ${count} \u4e2a\u6587\u4ef6` : `Imported ${count} file${count === 1 ? "" : "s"}.`,
      importFailed: lang === "zh" ? "\u5bfc\u5165\u6587\u4ef6\u5931\u8d25" : "Failed to import files.",
      unsupportedFile: (name: string) =>
        lang === "zh" ? `\u5df2\u8df3\u8fc7\u4e0d\u652f\u6301\u7684\u6587\u4ef6\uff1a${name}` : `Skipped unsupported file: ${name}`,
      emptyState: lang === "zh" ? "\u9009\u62e9\u6216\u521b\u5efa\u77e5\u8bc6\u6587\u4ef6" : "Select or create a knowledge file",
      filePathPlaceholder: lang === "zh" ? "\u6587\u4ef6\u8def\u5f84\uff0c\u4f8b\u5982 docs/readme.md" : "File path, for example docs/readme.md",
      fileNameRequired: lang === "zh" ? "\u8bf7\u8f93\u5165\u6587\u4ef6\u540d" : "Please enter a file path.",
      loadTreeFailed: lang === "zh" ? "\u52a0\u8f7d\u76ee\u5f55\u5931\u8d25" : "Failed to load the knowledge tree.",
      loadFileFailed: lang === "zh" ? "\u52a0\u8f7d\u6587\u4ef6\u5931\u8d25" : "Failed to load the file.",
      deleteSuccess: lang === "zh" ? "\u5220\u9664\u6210\u529f" : "Deleted successfully.",
      deleteFailed: lang === "zh" ? "\u5220\u9664\u5931\u8d25" : "Failed to delete the file.",
      saveSuccess: lang === "zh" ? "\u4fdd\u5b58\u6210\u529f" : "Saved successfully.",
      saveFailed: lang === "zh" ? "\u4fdd\u5b58\u5931\u8d25" : "Failed to save the file.",
      deleteConfirm: (path: string) =>
        lang === "zh" ? `\u786e\u8ba4\u5220\u9664\u6587\u4ef6\u201c${path}\u201d\uff1f` : `Delete "${path}"?`,
    }),
    [lang],
  );

  function normalizeImportedPath(fileName: string) {
    const clean = fileName
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .pop() || "imported.md";
    const withoutUnsafeChars = clean.replace(/[<>:"|?*\u0000-\u001f]/g, "-").replace(/^\.+/, "").trim();
    const fallback = `import-${new Date().toISOString().replace(/[:.]/g, "-")}.md`;
    const safeName = withoutUnsafeChars || fallback;
    return safeName.toLowerCase().endsWith(".md") ? safeName : `${safeName}.md`;
  }

  function isSupportedImport(file: File) {
    const name = file.name.toLowerCase();
    return (
      name.endsWith(".md")
      || name.endsWith(".markdown")
      || name.endsWith(".txt")
      || name.endsWith(".text")
      || file.type.startsWith("text/")
    );
  }

  async function importFiles(files: FileList | File[]) {
    const list = Array.from(files);
    if (!list.length) return;
    let imported = 0;

    try {
      for (const file of list) {
        if (!isSupportedImport(file)) {
          void message.warning(ui.unsupportedFile(file.name));
          continue;
        }
        const content = await file.text();
        await apiPost("/api/knowledge/file", {
          path: normalizeImportedPath(file.name),
          content,
        });
        imported += 1;
      }

      if (imported > 0) {
        void message.success(ui.importSuccess(imported));
        await loadTree();
      }
    } catch {
      void message.error(ui.importFailed);
    }
  }

  const loadTree = async () => {
    try {
      const data = await apiGet<KnowledgeApiNode[]>("/api/knowledge/tree");
      setTreeData(data.map(mapApiNodeToTreeNode));
    } catch {
      void message.error(ui.loadTreeFailed);
    }
  };

  useEffect(() => {
    void loadTree();
  }, []);

  const loadFile = async (path: string) => {
    try {
      const data = await apiGet<{ content?: string } | string>(`/api/knowledge/file?path=${encodeURIComponent(path)}`);
      setContent(typeof data === "string" ? data : (data.content ?? ""));
      setSelectedPath(path);
      setExpandedKeys((current) => [...new Set([...current, ...parentPathKeys(path)])]);
      setEditing(false);
      setCreating(false);
    } catch {
      void message.error(ui.loadFileFailed);
    }
  };

  useEffect(() => {
    if (!openPath) return;
    void loadFile(openPath);
  }, [openPath]);

  const deleteFile = async (path: string) => {
    try {
      await apiDelete(`/api/knowledge/file?path=${encodeURIComponent(path)}`);
      void message.success(ui.deleteSuccess);
      if (selectedPath === path) {
        setSelectedPath(null);
        setContent("");
      }
      void loadTree();
    } catch {
      void message.error(ui.deleteFailed);
    }
  };

  const confirmDeleteFile = (path: string) => {
    Modal.confirm({
      title: ui.deleteConfirm(path),
      okText: t("delete"),
      cancelText: t("cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        await deleteFile(path);
      },
    });
  };

  const saveFile = async () => {
    const path = creating ? newFileName : selectedPath;
    if (!path) {
      void message.error(ui.fileNameRequired);
      return;
    }

    try {
      await apiPost("/api/knowledge/file", { path, content: editContent });
      void message.success(ui.saveSuccess);
      setSelectedPath(path);
      setContent(editContent);
      setEditing(false);
      setCreating(false);
      void loadTree();
    } catch {
      void message.error(ui.saveFailed);
    }
  };

  const titleRender = (node: TreeNode) => (
    <span className="knowledge-panel__tree-node">
      <span>{node.title}</span>
      {node.isLeaf && (
        <OverflowMenuButton
          color="var(--nexo-text-secondary)"
          items={[{ key: "delete", label: t("delete"), danger: true }]}
          onItemClick={(key) => {
            if (key === "delete") {
              confirmDeleteFile(node.key);
            }
          }}
        />
      )}
    </span>
  );

  const handleKnowledgeDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragActive(false);
    if (event.dataTransfer.files?.length) {
      void importFiles(event.dataTransfer.files);
    }
  };

  return (
    <div
      className="knowledge-panel"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDragActive(true);
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragActive(false);
        }
      }}
      onDrop={handleKnowledgeDrop}
    >
      {dragActive && (
        <div className="knowledge-panel__drop-overlay">
          <InboxOutlined className="knowledge-panel__drop-icon" />
          <div className="knowledge-panel__drop-title">{ui.importFiles}</div>
          <div className="knowledge-panel__drop-hint">{ui.importHint}</div>
        </div>
      )}
      <div className="knowledge-panel__sidebar">
        <div className="knowledge-panel__sidebar-header">
          <Button
            block
            icon={<FileOutlined />}
            onClick={() => {
              setCreating(true);
              setEditing(false);
              setSelectedPath(null);
              setEditContent("");
              setNewFileName("");
            }}
            className="knowledge-panel__create-btn"
          >
            {ui.createFile}
          </Button>
          <div className="knowledge-panel__import-hint">
            <InboxOutlined className="knowledge-panel__import-icon" />
            {ui.importFiles}
          </div>
        </div>
        <div className="knowledge-panel__tree-wrap">
          <Tree
            treeData={treeData}
            titleRender={titleRender as never}
            selectedKeys={selectedPath ? [selectedPath] : []}
            expandedKeys={expandedKeys}
            onExpand={(keys) => setExpandedKeys(keys.map(String))}
            onSelect={(keys, { node }) => {
              if ((node as TreeNode).isLeaf && keys[0]) {
                void loadFile(String(keys[0]));
              }
            }}
            className="knowledge-panel__tree"
          />
        </div>
      </div>

      <div className="knowledge-panel__main">
        {!selectedPath && !creating ? (
          <div className="knowledge-panel__empty">
            <BookOutlined className="knowledge-panel__empty-icon" />
            <span>{ui.emptyState}</span>
          </div>
        ) : creating ? (
          <div className="knowledge-panel__editor-wrap">
            <Input
              placeholder={ui.filePathPlaceholder}
              value={newFileName}
              onChange={(event) => setNewFileName(event.target.value)}
              className="knowledge-panel__path-input"
            />
            <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} className="knowledge-panel__editor" />
            <div className="knowledge-panel__actions">
              <Button type="primary" onClick={() => void saveFile()}>
                {t("save")}
              </Button>
              <Button onClick={() => setCreating(false)}>{t("cancel")}</Button>
            </div>
          </div>
        ) : editing ? (
          <div className="knowledge-panel__editor-wrap">
            <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} className="knowledge-panel__editor" />
            <div className="knowledge-panel__actions">
              <Button type="primary" onClick={() => void saveFile()}>
                {t("save")}
              </Button>
              <Button onClick={() => setEditing(false)}>{t("cancel")}</Button>
            </div>
          </div>
        ) : (
          <div className="knowledge-panel__viewer">
            <div className="knowledge-panel__viewer-header">
              <span className="knowledge-panel__viewer-title">{selectedPath}</span>
              <OverflowMenuButton
                color="var(--nexo-text-secondary)"
                items={[
                  { key: "edit", label: t("edit") },
                  { key: "delete", label: t("delete"), danger: true },
                ]}
                onItemClick={(key) => {
                  if (key === "edit") {
                    setEditContent(content);
                    setEditing(true);
                    return;
                  }
                  if (key === "delete" && selectedPath) {
                    confirmDeleteFile(selectedPath);
                  }
                }}
              />
            </div>
            <div className="knowledge-panel__markdown">
              <ReactMarkdown rehypePlugins={[rehypeHighlight]}>{content}</ReactMarkdown>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
