import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Activity,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Check,
  ChevronRight,
  Code2,
  Database,
  Download,
  Eye,
  FilePlus2,
  Folder,
  Grid2X2,
  ImagePlus,
  Info,
  Monitor,
  NotebookText,
  Palette,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Star,
  Upload,
  TerminalSquare,
  Trash2,
  Type,
  X,
} from "lucide-react";
import "./styles.css";

type Snippet = {
  id: string;
  title: string;
  body: string;
  description: string;
  category: string;
  tags: string[];
  shortcut: string;
  shell: string;
  enabled: boolean;
  favorite: boolean;
  pinned: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

type FormState = {
  id?: string;
  title: string;
  body: string;
  description: string;
  category: string;
  tagsText: string;
  shortcut: string;
  shell: string;
  enabled: boolean;
  favorite: boolean;
  pinned: boolean;
};

const blankForm: FormState = {
  title: "",
  body: "",
  description: "",
  category: "",
  tagsText: "",
  shortcut: "",
  shell: "any",
  enabled: true,
  favorite: false,
  pinned: false,
};

const tagColors = ["#C2693F", "#2F7DB5", "#C0497F", "#2F8DB0", "#7A5BB5", "#1F6B57"];
type SettingsTab = "appearance" | "font" | "window" | "terminal" | "sync" | "images" | "about";
type Locale = "zh" | "en" | "ja";
type Theme = "graphite" | "notion" | "paper" | "mint" | "dusk" | "midnight";
type LibraryView = "all" | "favorites" | "trash";

type CategoryNode = {
  name: string;
  path: string;
  count: number;
  children: CategoryNode[];
};

type TerminalIntegrationStatus = {
  shell: "zsh" | "bash" | "fish";
  config_path: string;
  registered: boolean;
  cli_path: string;
  cli_built: boolean;
};

type TerminalDependencyStatus = {
  fzf_installed: boolean;
  fzf_path: string | null;
  homebrew_installed: boolean;
  install_command: string;
};

type GiteeSyncStatus = {
  configured: boolean;
  gist_id: string | null;
  description: string;
  public: boolean;
  config_path: string;
};

type GiteePullResult = {
  gist_id: string;
  imported: {
    inserted: number;
    updated: number;
    skipped: number;
  };
};

type QiniuStatus = {
  configured: boolean;
  access_key: string;
  bucket: string;
  domain: string;
  up_host: string;
  config_path: string;
};

type UploadResult = {
  url: string;
  key: string;
};

type Workspace = "snippets" | "journal";
type JournalMode = "weeklog" | "track";

type WeekLog = {
  id: string;
  week_key: string;
  week_start: string;
  week_end: string;
  title: string;
  body: string;
  tags: string[];
  favorite: boolean;
  created_at: string;
  updated_at: string;
};

type CurrentWeek = {
  week_key: string;
  week_start: string;
  week_end: string;
};

type WeekForm = {
  id?: string;
  title: string;
  body: string;
};

type Track = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  entry_count: number;
  last_entry_at: string | null;
};

type TrackEntry = {
  id: string;
  track_id: string;
  body: string;
  created_at: string;
};

const localeTags: Record<Locale, string> = { zh: "zh-CN", en: "en-US", ja: "ja-JP" };

const DEFAULT_WORKSPACE_KEY = "abratab.defaultWorkspace";

function readDefaultWorkspace(): Workspace {
  try {
    return localStorage.getItem(DEFAULT_WORKSPACE_KEY) === "journal" ? "journal" : "snippets";
  } catch {
    return "snippets";
  }
}

function writeDefaultWorkspace(value: Workspace) {
  try {
    localStorage.setItem(DEFAULT_WORKSPACE_KEY, value);
  } catch {
    /* localStorage unavailable; ignore */
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Only allow URLs we can safely drop into an href/src attribute.
function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  if (/^(https?:\/\/|data:image\/|\/)/i.test(trimmed)) return trimmed;
  return null;
}

// Minimal, dependency-free Markdown → safe HTML for the weeklog preview.
// Input is HTML-escaped first, so every replacement below operates on inert text.
function renderMarkdown(source: string): string {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html = blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";

    // Standalone image: render large, not inside a paragraph.
    const loneImage = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
    if (loneImage) {
      const src = safeUrl(loneImage[2]);
      if (src) {
        return `<p class="md-image"><img src="${escapeHtml(src)}" alt="${escapeHtml(loneImage[1])}" /></p>`;
      }
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      return `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;
    }

    const lines = trimmed.split("\n");
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
      const items = lines
        .map((line) => `<li>${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ""))}</li>`)
        .join("");
      return `<ul>${items}</ul>`;
    }

    return `<p>${lines.map(inlineMarkdown).join("<br />")}</p>`;
  });
  return html.filter(Boolean).join("");
}

function inlineMarkdown(text: string): string {
  let out = escapeHtml(text);
  // Images: ![alt](url)
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, url) => {
    const src = safeUrl(url);
    return src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />` : match;
  });
  // Links: [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label, url) => {
    const href = safeUrl(url);
    return href
      ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`
      : match;
  });
  // Inline code, bold, italic.
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return out;
}

// Pull the first image off a clipboard paste, if any.
function clipboardImage(event: React.ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) return null;
  for (const item of items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("could not read image"));
    reader.readAsDataURL(file);
  });
}

function imageFilename(file: File): string {
  if (file.name && file.name.includes(".")) return file.name;
  const ext = file.type.split("/")[1] || "png";
  return `pasted.${ext}`;
}

const settingsTabs: Array<{ id: SettingsTab; icon: React.ElementType }> = [
  { id: "appearance", icon: Palette },
  { id: "font", icon: Type },
  { id: "window", icon: Monitor },
  { id: "terminal", icon: TerminalSquare },
  { id: "sync", icon: Upload },
  { id: "images", icon: ImagePlus },
  { id: "about", icon: Info },
];

const themeOptions: Theme[] = ["graphite", "notion", "paper", "mint", "dusk", "midnight"];

function normalizeCategoryPath(category: string | null | undefined) {
  return (category ?? "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");
}

function buildCategoryTree(snippets: Snippet[]) {
  const roots = new Map<string, CategoryNode>();

  for (const snippet of snippets) {
    const category = normalizeCategoryPath(snippet.category);
    if (!category) continue;

    let level = roots;
    let path = "";
    for (const name of category.split("/")) {
      path = path ? `${path}/${name}` : name;
      let node = level.get(name);
      if (!node) {
        node = { name, path, count: 0, children: [] };
        level.set(name, node);
      }
      node.count += 1;
      const nextLevel = new Map(node.children.map((child) => [child.name, child]));
      level = nextLevel;
      node.children = Array.from(nextLevel.values()).sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  return Array.from(roots.values()).sort((a, b) => a.name.localeCompare(b.name));
}

const translations = {
  zh: {
    snippets: "片段",
    library: "资源库",
    allSnippets: "所有片段",
    favorites: "收藏",
    uncategorized: "未分类",
    trash: "废纸篓",
    categories: "分类",
    tags: "标签",
    addCategory: "添加分类",
    addTag: "添加标签",
    newSnippet: "新建片段",
    settings: "设置",
    searchSnippets: "搜索片段...",
    untitledSnippet: "未命名片段",
    favorite: "收藏",
    preview: "预览",
    copy: "复制",
    delete: "删除",
    restore: "恢复",
    permanentDelete: "彻底删除",
    pin: "置顶",
    unpin: "取消置顶",
    moveCategory: "移动分类",
    confirm: "确定",
    cancel: "取消",
    save: "保存",
    trigger: "触发词",
    press: "按",
    toExpand: "展开",
    enabled: "已启用",
    category: "分类",
    shell: "Shell",
    any: "任意",
    description: "描述",
    descriptionPlaceholder: "这个片段适合什么时候使用",
    lines: "行",
    titleRequired: "标题和正文不能为空。",
    saved: "已保存",
    deleted: "已删除片段。",
    restored: "已恢复片段。",
    permanentlyDeleted: "已彻底删除片段。",
    copied: "已复制正文到剪贴板。",
    noSnippets: "没有找到片段",
    settingsSubtitle: "AbraTab 偏好设置",
    close: "关闭",
    settingsTabs: {
      appearance: "外观",
      font: "字体",
      window: "窗口",
      terminal: "终端",
      sync: "同步",
      images: "图床",
      about: "关于",
    },
    subtitles: {
      appearance: "主题、语言、强调色和密度。",
      font: "字体和编辑器阅读体验。",
      window: "窗口行为和标题栏。",
      terminal: "注册 shell 集成和快捷词展开。",
      sync: "用 Gitee 代码片段同步片段、分类和标签。",
      images: "配置七牛云，周记里可直接粘贴图片。",
      about: "版本和本地存储信息。",
    },
    giteeToken: "Gitee Token",
    giteeTokenDetail: "需要可读写代码片段的私人令牌，保存在本机配置文件。",
    giteeGistId: "代码片段 ID",
    giteeGistIdDetail: "留空会在首次推送时创建一个新的 Gitee 代码片段。",
    giteeDescription: "描述",
    giteeDescriptionDetail: "显示在 Gitee 代码片段列表中的名称。",
    giteePublic: "公开代码片段",
    giteePublicDetail: "建议保持关闭。片段内容可能包含命令、地址或密钥。",
    giteeSave: "保存配置",
    giteePush: "推送到 Gitee",
    giteePull: "从 Gitee 拉取",
    giteeConfigured: "已配置",
    giteeNotConfigured: "未配置",
    giteeConfigPath: "配置文件",
    giteeTokenPlaceholder: "输入 Gitee 私人令牌",
    giteeGistPlaceholder: "留空自动创建",
    giteeDescriptionPlaceholder: "AbraTab sync data",
    giteeSaved: "已保存 Gitee 同步配置。",
    giteePushed: "已推送到 Gitee",
    giteePulled: "已从 Gitee 拉取",
    terminalCli: "命令行工具",
    terminalCliDetail: "Tab 展开依赖本地 abratab-cli。",
    terminalBuildCli: "构建/更新 CLI",
    terminalRegistered: "已注册",
    terminalNotRegistered: "未注册",
    terminalRegister: "注册",
    terminalReregister: "重新注册",
    terminalUnregister: "取消注册",
    terminalConfig: "配置文件",
    terminalSourceHint: "已打开的终端需要重新 source 配置或新开窗口。",
    terminalInstallGuide: "安装说明",
    terminalFzf: "搜索依赖",
    terminalFzfDetail: "终端内搜索依赖 fzf，Tab 展开不依赖它。",
    terminalFzfInstalled: "已安装",
    terminalFzfMissing: "未安装",
    terminalInstallFzf: "安装 fzf",
    terminalCopyInstall: "复制安装命令",
    terminalShortcut: "搜索快捷键",
    terminalShortcutDetail: "在 shell 中按 Ctrl+G 搜索片段并填入命令行。",
    terminalItermHint: "iTerm2 的 Command+G 需要在 Profiles > Keys 中映射为发送 Ctrl+G。",
    terminalCopiedInstall: "已复制安装命令。",
    language: "语言",
    languageDetail: "切换界面显示语言。",
    theme: "主题",
    themeDetail: "选择应用的视觉风格。",
    graphite: "石墨",
    notion: "Notion",
    paper: "纸张",
    mint: "薄荷",
    dusk: "暮色",
    midnight: "午夜",
    accentColor: "强调色",
    accentDetail: "用于选中状态、快捷词和主要操作。",
    compactList: "紧凑列表",
    compactDetail: "降低片段列表的行高。",
    defaultWorkspace: "默认工作区",
    defaultWorkspaceDetail: "启动时默认显示片段还是札记。",
    interfaceFont: "界面字体",
    interfaceFontDetail: "用于导航、表单和标签。",
    editorFont: "编辑器字体",
    editorFontDetail: "用于片段正文和触发词。",
    editorSize: "编辑器字号",
    editorSizeDetail: "调整代码编辑区字号。",
    launchAtLogin: "开机启动",
    launchAtLoginDetail: "macOS 启动时打开 AbraTab。",
    alwaysOnTop: "窗口置顶",
    alwaysOnTopDetail: "让片段窗口保持在其他窗口上方。",
    windowChrome: "窗口样式",
    windowChromeDetail: "使用紧凑的 overlay 标题栏布局。",
    overlay: "Overlay",
    native: "原生",
    aboutText: "用于命令、提示词和常用文本的终端片段工具。",
    version: "版本",
    database: "数据库",
    loading: "加载中...",
    wsSnippets: "片段",
    wsJournal: "札记",
    wsWeeklog: "周记",
    wsWeeklogUnit: "篇周记",
    timeline: "时间线",
    allWeeklogs: "全部周记",
    thisWeek: "本周",
    newWeeklog: "新建周记",
    searchWeeklogs: "搜索周记...",
    noWeeklogs: "还没有周记",
    weeklogTitlePlaceholder: "标题（可选）",
    weeklogBodyPlaceholder: "记录这一周做了什么、遇到了什么、下周打算做什么…",
    weeklogPickHint: "从左侧选择一篇，或点「新增」开始记录。",
    weeklogSaved: "已保存周记",
    weeklogDeleted: "已删除周记",
    weeklogEmpty: "请先填写标题或内容。",
    weeklogEdit: "编辑",
    weeklogPreviewEmpty: "还没有内容可预览。",
    weeklogImageHint: "可直接粘贴图片",
    weeklogImageUploading: "图片上传中…",
    weeklogImageUploaded: "图片已上传",
    weeklogImageNotConfigured: "未配置图床，请先到「设置 → 图床」填写七牛云。",
    weeklogStar: "加星标",
    weeklogUnstar: "取消星标",
    weeklogStarred: "已加星标",
    weeklogUnstarred: "已取消星标",
    weeklogStarredFilter: "只看星标",
    weeklogNoStarred: "还没有星标周记",
    qiniuTitle: "图床（七牛云）",
    qiniuDetail: "粘贴到周记里的图片会上传到七牛云，笔记里只保存图片链接。",
    qiniuAccessKey: "AccessKey",
    qiniuSecretKey: "SecretKey",
    qiniuSecretKeyDetail: "保存在本机配置文件，不会写入同步数据。",
    qiniuBucket: "空间名称 Bucket",
    qiniuDomain: "绑定域名",
    qiniuDomainDetail: "用于拼接图片地址，例如 https://cdn.example.com。",
    qiniuUpHost: "上传域名",
    qiniuUpHostDetail: "按存储区域填写，留空默认 https://up.qiniup.com。",
    qiniuSave: "保存图床配置",
    qiniuSaved: "已保存七牛云图床配置。",
    qiniuConfigured: "已配置",
    qiniuNotConfigured: "未配置",
    qiniuAccessKeyPlaceholder: "输入七牛云 AccessKey",
    qiniuSecretKeyPlaceholder: "输入七牛云 SecretKey",
    qiniuBucketPlaceholder: "例如 my-images",
    qiniuDomainPlaceholder: "https://cdn.example.com",
    wsTrack: "奇思妙想",
    trackUnit: "个主题",
    untitledTrack: "未命名主题",
    newTrack: "新建主题",
    searchTracks: "搜索奇思妙想…",
    noTracks: "还没有奇思妙想，新建一个开始记录。",
    trackTitlePlaceholder: "主题名称",
    trackPickHint: "从左侧选择一个主题，或新建一个开始记录。",
    entryUnit: "条记录",
    newEntryPlaceholder: "记下新的奇思妙想…",
    addEntry: "记录",
    noEntries: "还没有记录，在上面写下第一条。",
    trackSaved: "已保存主题",
    trackDeleted: "已删除主题",
    entryAdded: "已记录",
    entryDeleted: "已删除记录",
    entrySaved: "已更新记录",
    editEntry: "编辑记录",
  },
  en: {
    snippets: "snippets",
    library: "Library",
    allSnippets: "All snippets",
    favorites: "Favorites",
    uncategorized: "Uncategorized",
    trash: "Trash",
    categories: "Categories",
    tags: "Tags",
    addCategory: "Add category",
    addTag: "Add tag",
    newSnippet: "New snippet",
    settings: "Settings",
    searchSnippets: "Search snippets...",
    untitledSnippet: "Untitled snippet",
    favorite: "Favorite",
    preview: "Preview",
    copy: "Copy",
    delete: "Delete",
    restore: "Restore",
    permanentDelete: "Delete permanently",
    pin: "Pin",
    unpin: "Unpin",
    moveCategory: "Move category",
    confirm: "OK",
    cancel: "Cancel",
    save: "Save",
    trigger: "trigger",
    press: "press",
    toExpand: "to expand",
    enabled: "Enabled",
    category: "Category",
    shell: "Shell",
    any: "Any",
    description: "Description",
    descriptionPlaceholder: "When to use this snippet",
    lines: "lines",
    titleRequired: "Title and body are required.",
    saved: "Saved",
    deleted: "Deleted snippet.",
    restored: "Restored snippet.",
    permanentlyDeleted: "Deleted snippet permanently.",
    copied: "Copied body to clipboard.",
    noSnippets: "No snippets found",
    settingsSubtitle: "AbraTab preferences",
    close: "Close",
    settingsTabs: {
      appearance: "Appearance",
      font: "Font",
      window: "Window",
      terminal: "Terminal",
      sync: "Sync",
      images: "Image host",
      about: "About",
    },
    subtitles: {
      appearance: "Theme, language, accent, and density.",
      font: "Typeface and editor reading comfort.",
      window: "Window behavior and chrome.",
      terminal: "Register shell integrations and shortcut expansion.",
      sync: "Sync snippets, categories, and tags through a Gitee gist.",
      images: "Configure Qiniu so you can paste images into weekly logs.",
      about: "Version and local storage details.",
    },
    giteeToken: "Gitee token",
    giteeTokenDetail: "A personal token with gist read/write access, stored in a local config file.",
    giteeGistId: "Gist ID",
    giteeGistIdDetail: "Leave empty to create a new Gitee gist on the first push.",
    giteeDescription: "Description",
    giteeDescriptionDetail: "Name shown in the Gitee gist list.",
    giteePublic: "Public gist",
    giteePublicDetail: "Keep this off. Snippets may contain commands, hosts, or secrets.",
    giteeSave: "Save config",
    giteePush: "Push to Gitee",
    giteePull: "Pull from Gitee",
    giteeConfigured: "Configured",
    giteeNotConfigured: "Not configured",
    giteeConfigPath: "Config file",
    giteeTokenPlaceholder: "Enter Gitee personal token",
    giteeGistPlaceholder: "Empty creates one",
    giteeDescriptionPlaceholder: "AbraTab sync data",
    giteeSaved: "Saved Gitee sync config.",
    giteePushed: "Pushed to Gitee",
    giteePulled: "Pulled from Gitee",
    terminalCli: "CLI",
    terminalCliDetail: "Tab expansion depends on the local abratab-cli binary.",
    terminalBuildCli: "Build / update CLI",
    terminalRegistered: "Registered",
    terminalNotRegistered: "Not registered",
    terminalRegister: "Register",
    terminalReregister: "Re-register",
    terminalUnregister: "Unregister",
    terminalConfig: "Config",
    terminalSourceHint: "Open terminal sessions need source config or a new window.",
    terminalInstallGuide: "Install guide",
    terminalFzf: "Search dependency",
    terminalFzfDetail: "Terminal search uses fzf. Tab expansion does not require it.",
    terminalFzfInstalled: "Installed",
    terminalFzfMissing: "Missing",
    terminalInstallFzf: "Install fzf",
    terminalCopyInstall: "Copy install command",
    terminalShortcut: "Search shortcut",
    terminalShortcutDetail: "Press Ctrl+G in the shell to search snippets and fill the command line.",
    terminalItermHint: "In iTerm2, map Command+G in Profiles > Keys to send Ctrl+G.",
    terminalCopiedInstall: "Copied install command.",
    language: "Language",
    languageDetail: "Switch the interface language.",
    theme: "Theme",
    themeDetail: "Choose the visual tone for the app.",
    graphite: "Graphite",
    notion: "Notion",
    paper: "Paper",
    mint: "Mint",
    dusk: "Dusk",
    midnight: "Midnight",
    accentColor: "Accent color",
    accentDetail: "Used for selected states, shortcuts, and primary actions.",
    compactList: "Compact list",
    compactDetail: "Reduce row height in the snippet list.",
    defaultWorkspace: "Default workspace",
    defaultWorkspaceDetail: "Show snippets or notes on startup.",
    interfaceFont: "Interface font",
    interfaceFontDetail: "Used by navigation, forms, and labels.",
    editorFont: "Editor font",
    editorFontDetail: "Used for snippet body and triggers.",
    editorSize: "Editor size",
    editorSizeDetail: "Adjust code editor text size.",
    launchAtLogin: "Launch at login",
    launchAtLoginDetail: "Open AbraTab when macOS starts.",
    alwaysOnTop: "Always on top",
    alwaysOnTopDetail: "Keep the snippet window above other windows.",
    windowChrome: "Window chrome",
    windowChromeDetail: "Use compact overlay titlebar layout.",
    overlay: "Overlay",
    native: "Native",
    aboutText: "Terminal snippets for commands, prompts, and repeatable text.",
    version: "Version",
    database: "Database",
    loading: "Loading...",
    wsSnippets: "Snippets",
    wsJournal: "Notes",
    wsWeeklog: "Weekly log",
    wsWeeklogUnit: "logs",
    timeline: "Timeline",
    allWeeklogs: "All logs",
    thisWeek: "This week",
    newWeeklog: "New note",
    searchWeeklogs: "Search logs...",
    noWeeklogs: "No weekly logs yet",
    weeklogTitlePlaceholder: "Title (optional)",
    weeklogBodyPlaceholder: "What you did this week, what came up, what's next…",
    weeklogPickHint: "Pick a note on the left, or hit New to start.",
    weeklogSaved: "Saved weekly log",
    weeklogDeleted: "Deleted weekly log",
    weeklogEmpty: "Add a title or some content first.",
    weeklogEdit: "Edit",
    weeklogPreviewEmpty: "Nothing to preview yet.",
    weeklogImageHint: "Paste an image to upload",
    weeklogImageUploading: "Uploading image…",
    weeklogImageUploaded: "Image uploaded",
    weeklogImageNotConfigured: "No image host set up. Configure Qiniu in Settings → Image host first.",
    weeklogStar: "Star",
    weeklogUnstar: "Unstar",
    weeklogStarred: "Starred",
    weeklogUnstarred: "Unstarred",
    weeklogStarredFilter: "Starred only",
    weeklogNoStarred: "No starred logs yet",
    qiniuTitle: "Image host (Qiniu)",
    qiniuDetail: "Images pasted into a log upload to Qiniu; the note only stores the link.",
    qiniuAccessKey: "AccessKey",
    qiniuSecretKey: "SecretKey",
    qiniuSecretKeyDetail: "Stored in a local config file, never written to sync data.",
    qiniuBucket: "Bucket",
    qiniuDomain: "Bound domain",
    qiniuDomainDetail: "Used to build the image URL, e.g. https://cdn.example.com.",
    qiniuUpHost: "Upload host",
    qiniuUpHostDetail: "Match your storage region; leave blank for https://up.qiniup.com.",
    qiniuSave: "Save image host",
    qiniuSaved: "Saved Qiniu image host config.",
    qiniuConfigured: "Configured",
    qiniuNotConfigured: "Not configured",
    qiniuAccessKeyPlaceholder: "Enter Qiniu AccessKey",
    qiniuSecretKeyPlaceholder: "Enter Qiniu SecretKey",
    qiniuBucketPlaceholder: "e.g. my-images",
    qiniuDomainPlaceholder: "https://cdn.example.com",
    wsTrack: "Ideas",
    trackUnit: "topics",
    untitledTrack: "Untitled topic",
    newTrack: "New topic",
    searchTracks: "Search ideas...",
    noTracks: "No ideas yet — create one to start.",
    trackTitlePlaceholder: "Topic name",
    trackPickHint: "Pick a topic on the left, or create one to start.",
    entryUnit: "entries",
    newEntryPlaceholder: "Log a new entry…",
    addEntry: "Log",
    noEntries: "No entries yet — add the first one above.",
    trackSaved: "Saved topic",
    trackDeleted: "Deleted topic",
    entryAdded: "Logged",
    entryDeleted: "Deleted entry",
    entrySaved: "Updated entry",
    editEntry: "Edit entry",
  },
  ja: {
    snippets: "スニペット",
    library: "ライブラリ",
    allSnippets: "すべてのスニペット",
    favorites: "お気に入り",
    uncategorized: "未分類",
    trash: "ゴミ箱",
    categories: "カテゴリ",
    tags: "タグ",
    addCategory: "カテゴリを追加",
    addTag: "タグを追加",
    newSnippet: "新規スニペット",
    settings: "設定",
    searchSnippets: "スニペットを検索...",
    untitledSnippet: "無題のスニペット",
    favorite: "お気に入り",
    preview: "プレビュー",
    copy: "コピー",
    delete: "削除",
    restore: "復元",
    permanentDelete: "完全に削除",
    pin: "固定",
    unpin: "固定解除",
    moveCategory: "カテゴリ移動",
    confirm: "OK",
    cancel: "キャンセル",
    save: "保存",
    trigger: "トリガー",
    press: "押して",
    toExpand: "展開",
    enabled: "有効",
    category: "カテゴリ",
    shell: "Shell",
    any: "任意",
    description: "説明",
    descriptionPlaceholder: "このスニペットを使う場面",
    lines: "行",
    titleRequired: "タイトルと本文は必須です。",
    saved: "保存しました",
    deleted: "スニペットを削除しました。",
    restored: "スニペットを復元しました。",
    permanentlyDeleted: "スニペットを完全に削除しました。",
    copied: "本文をクリップボードにコピーしました。",
    noSnippets: "スニペットが見つかりません",
    settingsSubtitle: "AbraTab の環境設定",
    close: "閉じる",
    settingsTabs: {
      appearance: "外観",
      font: "フォント",
      window: "ウィンドウ",
      terminal: "ターミナル",
      sync: "同期",
      images: "画像ホスト",
      about: "情報",
    },
    subtitles: {
      appearance: "テーマ、言語、アクセント、表示密度。",
      font: "書体とエディタの読みやすさ。",
      window: "ウィンドウ動作とタイトルバー。",
      terminal: "シェル連携とショートカット展開を登録します。",
      sync: "Gitee コードスニペットでスニペット、カテゴリ、タグを同期します。",
      images: "Qiniu を設定すると、週次ログに画像を貼り付けできます。",
      about: "バージョンとローカル保存情報。",
    },
    giteeToken: "Gitee トークン",
    giteeTokenDetail: "コードスニペットの読み書き権限を持つ個人トークンをローカル設定に保存します。",
    giteeGistId: "コードスニペット ID",
    giteeGistIdDetail: "空のまま初回プッシュすると新しい Gitee コードスニペットを作成します。",
    giteeDescription: "説明",
    giteeDescriptionDetail: "Gitee のコードスニペット一覧に表示される名前です。",
    giteePublic: "公開コードスニペット",
    giteePublicDetail: "オフ推奨です。スニペットにはコマンド、ホスト、秘密情報が含まれる場合があります。",
    giteeSave: "設定を保存",
    giteePush: "Gitee へプッシュ",
    giteePull: "Gitee から取得",
    giteeConfigured: "設定済み",
    giteeNotConfigured: "未設定",
    giteeConfigPath: "設定ファイル",
    giteeTokenPlaceholder: "Gitee 個人トークンを入力",
    giteeGistPlaceholder: "空なら自動作成",
    giteeDescriptionPlaceholder: "AbraTab sync data",
    giteeSaved: "Gitee 同期設定を保存しました。",
    giteePushed: "Gitee へプッシュしました",
    giteePulled: "Gitee から取得しました",
    terminalCli: "CLI",
    terminalCliDetail: "Tab 展開にはローカルの abratab-cli が必要です。",
    terminalBuildCli: "CLI をビルド/更新",
    terminalRegistered: "登録済み",
    terminalNotRegistered: "未登録",
    terminalRegister: "登録",
    terminalReregister: "再登録",
    terminalUnregister: "登録解除",
    terminalConfig: "設定ファイル",
    terminalSourceHint: "開いているターミナルは source または新規ウィンドウが必要です。",
    terminalInstallGuide: "インストール手順",
    terminalFzf: "検索依存関係",
    terminalFzfDetail: "ターミナル検索には fzf が必要です。Tab 展開には不要です。",
    terminalFzfInstalled: "インストール済み",
    terminalFzfMissing: "未インストール",
    terminalInstallFzf: "fzf をインストール",
    terminalCopyInstall: "インストールコマンドをコピー",
    terminalShortcut: "検索ショートカット",
    terminalShortcutDetail: "シェルで Ctrl+G を押すとスニペットを検索してコマンドラインへ入力します。",
    terminalItermHint: "iTerm2 では Profiles > Keys で Command+G を Ctrl+G 送信に割り当てます。",
    terminalCopiedInstall: "インストールコマンドをコピーしました。",
    language: "言語",
    languageDetail: "表示言語を切り替えます。",
    theme: "テーマ",
    themeDetail: "アプリの見た目を選択します。",
    graphite: "グラファイト",
    notion: "Notion",
    paper: "ペーパー",
    mint: "ミント",
    dusk: "夕暮れ",
    midnight: "ミッドナイト",
    accentColor: "アクセントカラー",
    accentDetail: "選択状態、ショートカット、主要操作に使用します。",
    compactList: "コンパクトリスト",
    compactDetail: "スニペット一覧の行の高さを低くします。",
    defaultWorkspace: "デフォルトのワークスペース",
    defaultWorkspaceDetail: "起動時にスニペットと雑記のどちらを表示するか。",
    interfaceFont: "UI フォント",
    interfaceFontDetail: "ナビゲーション、フォーム、ラベルに使用します。",
    editorFont: "エディタフォント",
    editorFontDetail: "本文とトリガーに使用します。",
    editorSize: "エディタサイズ",
    editorSizeDetail: "コードエディタの文字サイズを調整します。",
    launchAtLogin: "ログイン時に起動",
    launchAtLoginDetail: "macOS 起動時に AbraTab を開きます。",
    alwaysOnTop: "常に手前に表示",
    alwaysOnTopDetail: "スニペットウィンドウを他のウィンドウの前に保ちます。",
    windowChrome: "ウィンドウ表示",
    windowChromeDetail: "コンパクトな overlay タイトルバーを使用します。",
    overlay: "Overlay",
    native: "ネイティブ",
    aboutText: "コマンド、プロンプト、定型文のためのターミナルスニペットツール。",
    version: "バージョン",
    database: "データベース",
    loading: "読み込み中...",
    wsSnippets: "スニペット",
    wsJournal: "雑記",
    wsWeeklog: "週次ログ",
    wsWeeklogUnit: "件",
    timeline: "タイムライン",
    allWeeklogs: "すべて",
    thisWeek: "今週",
    newWeeklog: "新規",
    searchWeeklogs: "週次ログを検索...",
    noWeeklogs: "週次ログがありません",
    weeklogTitlePlaceholder: "タイトル（任意）",
    weeklogBodyPlaceholder: "今週やったこと、起きたこと、来週の予定…",
    weeklogPickHint: "左からノートを選ぶか、「新規」で書き始めます。",
    weeklogSaved: "週次ログを保存しました",
    weeklogDeleted: "週次ログを削除しました",
    weeklogEmpty: "タイトルか本文を入力してください。",
    weeklogEdit: "編集",
    weeklogPreviewEmpty: "プレビューする内容がありません。",
    weeklogImageHint: "画像を貼り付けできます",
    weeklogImageUploading: "画像をアップロード中…",
    weeklogImageUploaded: "画像をアップロードしました",
    weeklogImageNotConfigured: "画像ホストが未設定です。「設定 → 画像ホスト」で Qiniu を設定してください。",
    weeklogStar: "スター",
    weeklogUnstar: "スター解除",
    weeklogStarred: "スターを付けました",
    weeklogUnstarred: "スターを外しました",
    weeklogStarredFilter: "スターのみ",
    weeklogNoStarred: "スター付きの週次ログがありません",
    qiniuTitle: "画像ホスト（Qiniu）",
    qiniuDetail: "週次ログに貼り付けた画像は Qiniu にアップロードされ、ノートにはリンクのみ保存します。",
    qiniuAccessKey: "AccessKey",
    qiniuSecretKey: "SecretKey",
    qiniuSecretKeyDetail: "ローカル設定ファイルに保存し、同期データには書き込みません。",
    qiniuBucket: "バケット",
    qiniuDomain: "バインドドメイン",
    qiniuDomainDetail: "画像URLの生成に使用します。例: https://cdn.example.com。",
    qiniuUpHost: "アップロードホスト",
    qiniuUpHostDetail: "保存リージョンに合わせて入力。空欄なら https://up.qiniup.com。",
    qiniuSave: "画像ホストを保存",
    qiniuSaved: "Qiniu 画像ホスト設定を保存しました。",
    qiniuConfigured: "設定済み",
    qiniuNotConfigured: "未設定",
    qiniuAccessKeyPlaceholder: "Qiniu の AccessKey を入力",
    qiniuSecretKeyPlaceholder: "Qiniu の SecretKey を入力",
    qiniuBucketPlaceholder: "例: my-images",
    qiniuDomainPlaceholder: "https://cdn.example.com",
    wsTrack: "アイデア",
    trackUnit: "件のトピック",
    untitledTrack: "無題のトピック",
    newTrack: "新しいトピック",
    searchTracks: "アイデアを検索...",
    noTracks: "まだありません。新しく作成しましょう。",
    trackTitlePlaceholder: "トピック名",
    trackPickHint: "左からトピックを選ぶか、新しく作成します。",
    entryUnit: "件の記録",
    newEntryPlaceholder: "新しい記録を追加…",
    addEntry: "記録",
    noEntries: "まだ記録がありません。上から追加してください。",
    trackSaved: "トピックを保存しました",
    trackDeleted: "トピックを削除しました",
    entryAdded: "記録しました",
    entryDeleted: "記録を削除しました",
    entrySaved: "記録を更新しました",
    editEntry: "記録を編集",
  },
} as const;

function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<LibraryView>("all");
  const [defaultWorkspace, setDefaultWorkspace] = useState<Workspace>(readDefaultWorkspace);
  const [workspace, setWorkspace] = useState<Workspace>(readDefaultWorkspace);
  const [journalMode, setJournalMode] = useState<JournalMode>("weeklog");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(() => new Set());
  const [form, setForm] = useState<FormState>(blankForm);
  const [dbPath, setDbPath] = useState("");
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const [locale, setLocale] = useState<Locale>("zh");
  const [theme, setTheme] = useState<Theme>("graphite");
  const [terminalStatuses, setTerminalStatuses] = useState<TerminalIntegrationStatus[]>([]);
  const [terminalDependency, setTerminalDependency] = useState<TerminalDependencyStatus | null>(null);
  const [terminalMessage, setTerminalMessage] = useState("");
  const [giteeStatus, setGiteeStatus] = useState<GiteeSyncStatus | null>(null);
  const [giteeToken, setGiteeToken] = useState("");
  const [giteeGistId, setGiteeGistId] = useState("");
  const [giteeDescription, setGiteeDescription] = useState("AbraTab sync data");
  const [giteePublic, setGiteePublic] = useState(false);
  const [giteeMessage, setGiteeMessage] = useState("");
  const [qiniuStatus, setQiniuStatus] = useState<QiniuStatus | null>(null);
  const [qiniuAccessKey, setQiniuAccessKey] = useState("");
  const [qiniuSecretKey, setQiniuSecretKey] = useState("");
  const [qiniuBucket, setQiniuBucket] = useState("");
  const [qiniuDomain, setQiniuDomain] = useState("");
  const [qiniuUpHost, setQiniuUpHost] = useState("");
  const [qiniuMessage, setQiniuMessage] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; snippet: Snippet } | null>(null);
  const [textPrompt, setTextPrompt] = useState<{ title: string; value: string } | null>(null);
  const promptResolver = useRef<((value: string | null) => void) | null>(null);

  const selected = snippets.find((snippet) => snippet.id === selectedId) ?? null;
  const liveSnippets = useMemo(() => snippets.filter((snippet) => !snippet.deleted_at), [snippets]);
  const deletedSnippets = useMemo(() => snippets.filter((snippet) => snippet.deleted_at), [snippets]);
  const text = translations[locale];
  const displayCategory = (category: string | null | undefined) =>
    !category || category === "Uncategorized" ? text.uncategorized : category;

  const variables = useMemo(() => {
    const matches = form.body.matchAll(/\{\{\s*([a-zA-Z0-9_.-]+)(?::[^}]*)?\s*\}\}/g);
    return Array.from(new Set(Array.from(matches, (match) => match[1])));
  }, [form.body]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const snippet of liveSnippets) {
      const category = normalizeCategoryPath(snippet.category) || "Uncategorized";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [liveSnippets]);

  const categoryTree = useMemo(() => buildCategoryTree(liveSnippets), [liveSnippets]);

  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const snippet of liveSnippets) {
      for (const tag of snippet.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [liveSnippets]);

  const filteredSnippets = useMemo(() => {
    return snippets.filter((snippet) => {
      if (activeView === "trash") {
        return Boolean(snippet.deleted_at);
      }
      if (snippet.deleted_at) return false;
      if (activeView === "favorites" && !snippet.favorite) return false;
      const category = normalizeCategoryPath(snippet.category) || "Uncategorized";
      if (activeCategory) {
        const normalizedActiveCategory = normalizeCategoryPath(activeCategory) || "Uncategorized";
        if (
          normalizedActiveCategory === "Uncategorized"
            ? category !== "Uncategorized"
            : category !== normalizedActiveCategory && !category.startsWith(`${normalizedActiveCategory}/`)
        ) {
          return false;
        }
      }
      if (activeTag && !snippet.tags.includes(activeTag)) return false;
      return true;
    });
  }, [activeCategory, activeTag, activeView, snippets]);

  useEffect(() => {
    void refresh();
    invoke<string>("database_path").then(setDbPath).catch(showError);
  }, []);

  useEffect(() => {
    if (settingsOpen && settingsTab === "terminal") {
      void refreshTerminalStatus();
    }
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    if (settingsOpen && settingsTab === "sync") {
      void refreshGiteeStatus();
    }
    if (settingsOpen && settingsTab === "images") {
      void refreshQiniuStatus();
    }
  }, [settingsOpen, settingsTab]);

  useEffect(() => {
    const category = normalizeCategoryPath(activeCategory);
    if (!category || category === "Uncategorized") return;

    setExpandedCategories((current) => {
      const next = new Set(current);
      const parts = category.split("/");
      for (let index = 1; index <= parts.length; index += 1) {
        next.add(parts.slice(0, index).join("/"));
      }
      return next;
    });
  }, [activeCategory]);

  async function refresh(nextQuery = query) {
    const rows = await invoke<Snippet[]>("list_snippets", {
      query: nextQuery.trim() || null,
      includeDeleted: true,
    });
    setSnippets(rows);
    const selectedRow = selectedId ? rows.find((row) => row.id === selectedId) : null;
    if (selectedRow) {
      loadIntoForm(selectedRow);
    } else if (!selectedId) {
      const firstLive = rows.find((row) => !row.deleted_at);
      if (firstLive) loadIntoForm(firstLive);
    }
  }

  function loadIntoForm(snippet: Snippet) {
    setSelectedId(snippet.id);
    setForm({
      id: snippet.id,
      title: snippet.title,
      body: snippet.body,
      description: snippet.description,
      category: snippet.category,
      tagsText: snippet.tags.join(", "),
      shortcut: snippet.shortcut,
      shell: snippet.shell,
      enabled: snippet.enabled,
      favorite: snippet.favorite,
      pinned: snippet.pinned,
    });
  }

  function createNew() {
    setSelectedId(null);
    setActiveView("all");
    setForm({
      ...blankForm,
      favorite: activeView === "favorites",
      category: activeCategory && activeCategory !== "Uncategorized" ? normalizeCategoryPath(activeCategory) : "",
      tagsText: activeTag ?? "",
    });
  }

  async function addCategory() {
    const parent = activeCategory && activeCategory !== "Uncategorized" ? `${normalizeCategoryPath(activeCategory)}/` : "";
    const category = await askText(text.addCategory, parent);
    const name = category?.trim();
    if (!name) return;
    const path = normalizeCategoryPath(name);

    setSelectedId(null);
    setActiveView("all");
    setActiveCategory(path);
    setActiveTag(null);
    setForm({
      ...blankForm,
      category: path,
    });
  }

  async function addTag() {
    const tag = await askText(text.addTag);
    const name = tag?.trim();
    if (!name) return;

    setSelectedId(null);
    setActiveView("all");
    setActiveCategory(null);
    setActiveTag(name);
    setForm({
      ...blankForm,
      tagsText: name,
    });
  }

  async function save() {
    if (!form.title.trim() || !form.body.trim()) {
      setStatus(text.titleRequired);
      return;
    }

    const saved = await invoke<Snippet>("save_snippet", {
      input: {
        id: form.id,
        title: form.title,
        body: form.body,
        description: form.description,
        category: normalizeCategoryPath(form.category),
        tags: form.tagsText
          .split(",")
          .map((tag) => tag.trim())
          .filter(Boolean),
        shortcut: form.shortcut,
        shell: form.shell,
        enabled: form.enabled,
        favorite: form.favorite,
        pinned: form.pinned,
      },
    });
    setStatus(`${text.saved} ${saved.title}`);
    await refresh();
    loadIntoForm(saved);
  }

  async function remove() {
    if (!form.id) return;
    if (selected?.deleted_at) {
      await invoke("purge_snippet", { id: form.id });
      setStatus(text.permanentlyDeleted);
    } else {
      await invoke("delete_snippet", { id: form.id });
      setStatus(text.deleted);
    }
    setSelectedId(null);
    setForm(blankForm);
    await refresh();
  }

  async function restore() {
    if (!form.id) return;
    await invoke("restore_snippet", { id: form.id });
    setStatus(text.restored);
    setActiveView("all");
    await refresh();
  }

  async function toggleFavorite() {
    const nextFavorite = !form.favorite;
    setForm({ ...form, favorite: nextFavorite });
    if (!form.id) return;
    await invoke("set_snippet_favorite", { id: form.id, favorite: nextFavorite });
    await refresh();
  }

  async function togglePinned(snippet = selected) {
    if (!snippet) return;
    await invoke("set_snippet_pinned", { id: snippet.id, pinned: !snippet.pinned });
    setContextMenu(null);
    await refresh();
  }

  async function moveCategory(snippet: Snippet) {
    const category = await askText(text.moveCategory, snippet.category || "");
    if (category === null) return;
    await invoke("move_snippet_category", { id: snippet.id, category });
    setContextMenu(null);
    await refresh();
  }

  async function deleteSnippet(snippet: Snippet) {
    await invoke("delete_snippet", { id: snippet.id });
    if (selectedId === snippet.id) {
      setSelectedId(null);
      setForm(blankForm);
    }
    setContextMenu(null);
    setStatus(text.deleted);
    await refresh();
  }

  async function copyBody() {
    if (!form.id) {
      await navigator.clipboard.writeText(form.body);
    } else {
      await invoke("copy_snippet", { id: form.id });
    }
    setStatus(text.copied);
  }

  function clearFilters() {
    setActiveView("all");
    setActiveCategory(null);
    setActiveTag(null);
  }

  function showFavorites() {
    setActiveView("favorites");
    setActiveCategory(null);
    setActiveTag(null);
  }

  function showTrash() {
    setActiveView("trash");
    setActiveCategory(null);
    setActiveTag(null);
  }

  function selectCategory(category: string) {
    setActiveView("all");
    setActiveCategory(category);
    setActiveTag(null);
  }

  function toggleCategory(category: string) {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  function renderCategoryNode(node: CategoryNode, depth = 0): React.ReactNode {
    const isExpanded = expandedCategories.has(node.path);
    const hasChildren = node.children.length > 0;
    const isActive = activeView === "all" && activeCategory === node.path;

    return (
      <React.Fragment key={node.path}>
        <div className="folder-tree-row" style={{ "--depth": depth } as React.CSSProperties}>
          <button
            className={`folder-toggle ${isExpanded ? "expanded" : ""}`}
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggleCategory(node.path);
            }}
            disabled={!hasChildren}
            aria-label={node.name}
          >
            <ChevronRight size={13} />
          </button>
          <button className={`folder-row ${isActive ? "on" : ""}`} onClick={() => selectCategory(node.path)}>
            <Folder size={15} />
            <span>{node.name}</span>
            <b>{node.count}</b>
          </button>
        </div>
        {hasChildren && isExpanded ? node.children.map((child) => renderCategoryNode(child, depth + 1)) : null}
      </React.Fragment>
    );
  }

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  function askText(title: string, defaultValue = ""): Promise<string | null> {
    return new Promise((resolve) => {
      promptResolver.current = resolve;
      setTextPrompt({ title, value: defaultValue });
    });
  }

  function resolvePrompt(result: string | null) {
    const resolve = promptResolver.current;
    promptResolver.current = null;
    setTextPrompt(null);
    resolve?.(result);
  }

  async function refreshGiteeStatus() {
    const syncStatus = await invoke<GiteeSyncStatus>("gitee_sync_status");
    setGiteeStatus(syncStatus);
    setGiteeGistId(syncStatus.gist_id ?? "");
    setGiteeDescription(syncStatus.description || "AbraTab sync data");
    setGiteePublic(syncStatus.public);
  }

  async function saveGiteeSyncConfig() {
    const syncStatus = await invoke<GiteeSyncStatus>("save_gitee_sync_config", {
      input: {
        accessToken: giteeToken,
        gistId: giteeGistId,
        description: giteeDescription,
        public: giteePublic,
      },
    });
    setGiteeToken("");
    setGiteeStatus(syncStatus);
    setGiteeGistId(syncStatus.gist_id ?? "");
    setGiteeMessage(text.giteeSaved);
  }

  async function refreshQiniuStatus() {
    const qiniu = await invoke<QiniuStatus>("qiniu_status");
    setQiniuStatus(qiniu);
    setQiniuAccessKey(qiniu.access_key);
    setQiniuBucket(qiniu.bucket);
    setQiniuDomain(qiniu.domain);
    setQiniuUpHost(qiniu.up_host);
  }

  async function saveQiniuConfig() {
    const qiniu = await invoke<QiniuStatus>("save_qiniu_config", {
      accessKey: qiniuAccessKey,
      secretKey: qiniuSecretKey,
      bucket: qiniuBucket,
      domain: qiniuDomain,
      upHost: qiniuUpHost,
    });
    setQiniuSecretKey("");
    setQiniuStatus(qiniu);
    setQiniuAccessKey(qiniu.access_key);
    setQiniuBucket(qiniu.bucket);
    setQiniuDomain(qiniu.domain);
    setQiniuUpHost(qiniu.up_host);
    setQiniuMessage(text.qiniuSaved);
  }

  async function pushGiteeSync() {
    const result = await invoke<{ gist_id: string; snippet_count: number }>("push_gitee_sync");
    setGiteeGistId(result.gist_id);
    setGiteeMessage(`${text.giteePushed}: ${result.snippet_count} ${text.snippets}`);
    await refreshGiteeStatus();
  }

  async function pullGiteeSync() {
    const result = await invoke<GiteePullResult>("pull_gitee_sync");
    const { inserted, updated, skipped } = result.imported;
    setGiteeMessage(`${text.giteePulled}: +${inserted}, ~${updated}, =${skipped}`);
    await refresh();
    await refreshGiteeStatus();
  }

  async function refreshTerminalStatus() {
    const rows = await invoke<TerminalIntegrationStatus[]>("terminal_integration_status");
    setTerminalStatuses(rows);
    const dependency = await invoke<TerminalDependencyStatus>("terminal_dependency_status");
    setTerminalDependency(dependency);
  }

  async function buildTerminalCli() {
    const path = await invoke<string>("build_cli");
    setTerminalMessage(`${text.terminalCli}: ${path}`);
    await refreshTerminalStatus();
  }

  async function installShell(shell: TerminalIntegrationStatus["shell"]) {
    await invoke("install_shell_integration", { shell });
    setTerminalMessage(`${shell}: ${text.terminalRegistered}. ${text.terminalSourceHint}`);
    await refreshTerminalStatus();
  }

  async function uninstallShell(shell: TerminalIntegrationStatus["shell"]) {
    await invoke("uninstall_shell_integration", { shell });
    setTerminalMessage(`${shell}: ${text.terminalNotRegistered}`);
    await refreshTerminalStatus();
  }

  async function installFzf() {
    const dependency = await invoke<TerminalDependencyStatus>("install_fzf");
    setTerminalDependency(dependency);
    setTerminalMessage(`fzf: ${dependency.fzf_path || text.terminalFzfInstalled}`);
  }

  async function copyFzfInstallCommand() {
    const command = terminalDependency?.install_command ?? "brew install fzf";
    await navigator.clipboard.writeText(command);
    setTerminalMessage(`${text.terminalCopiedInstall} ${command}`);
  }

  function showTerminalGuide() {
    setTerminalMessage(`Ctrl+G: ${text.terminalShortcutDetail}\n${text.terminalItermHint}`);
  }

  function startWindowDrag(event: React.MouseEvent<HTMLElement>) {
    if (event.button !== 0) return;

    const target = event.target as HTMLElement;
    if (target.closest("button,input,textarea,select,label,a,[role='button']")) return;

    void getCurrentWindow().startDragging().catch(showError);
  }

  return (
    <main className="app-shell" data-theme={theme} onClick={() => setContextMenu(null)}>
      <div className="window-drag-strip" data-tauri-drag-region onMouseDown={startWindowDrag} />
      {workspace === "journal" && journalMode === "weeklog" ? (
        <WeekLogWorkspace
          text={text}
          locale={locale}
          workspace={workspace}
          setWorkspace={setWorkspace}
          mode={journalMode}
          setMode={setJournalMode}
          onOpenSettings={() => setSettingsOpen(true)}
          startWindowDrag={startWindowDrag}
          dbPath={dbPath}
        />
      ) : workspace === "journal" ? (
        <TrackWorkspace
          text={text}
          locale={locale}
          workspace={workspace}
          setWorkspace={setWorkspace}
          mode={journalMode}
          setMode={setJournalMode}
          onOpenSettings={() => setSettingsOpen(true)}
          startWindowDrag={startWindowDrag}
          dbPath={dbPath}
        />
      ) : (
        <>
      <nav className="nav-panel">
        <div className="brand" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="brand-logo">
            <TerminalSquare size={20} />
          </div>
          <div data-tauri-drag-region>
            <h1>AbraTab</h1>
            <p>{liveSnippets.length} {text.snippets}</p>
          </div>
        </div>

        <WorkspaceToggle workspace={workspace} setWorkspace={setWorkspace} text={text} />

        <div className="nav-scroll">
          <div className="nav-section">{text.library}</div>
          <button className={`nav-item ${activeView === "all" && !activeCategory && !activeTag ? "on" : ""}`} onClick={clearFilters}>
            <Grid2X2 size={15} />
            <span>{text.allSnippets}</span>
            <b>{liveSnippets.length}</b>
          </button>
          <button className={`nav-item ${activeView === "favorites" ? "on" : ""}`} onClick={showFavorites}>
            <Star size={15} />
            <span>{text.favorites}</span>
            <b>{liveSnippets.filter((snippet) => snippet.favorite).length}</b>
          </button>
          <button
            className={`nav-item ${activeView === "all" && activeCategory === "Uncategorized" ? "on" : ""}`}
            onClick={() => {
              setActiveView("all");
              setActiveCategory("Uncategorized");
              setActiveTag(null);
            }}
          >
            <Folder size={15} />
            <span>{text.uncategorized}</span>
            <b>{categories.find(([name]) => name === "Uncategorized")?.[1] ?? 0}</b>
          </button>
          <button className={`nav-item ${activeView === "trash" ? "on" : ""}`} onClick={showTrash}>
            <Trash2 size={15} />
            <span>{text.trash}</span>
            <b>{deletedSnippets.length}</b>
          </button>

          <div className="nav-section-row">
            <div className="nav-section">{text.categories}</div>
            <button className="nav-section-add" title={text.addCategory} onClick={() => void addCategory().catch(showError)}>
              <Plus size={13} />
            </button>
          </div>
          {categoryTree.map((node) => renderCategoryNode(node))}

          <div className="nav-section-row">
            <div className="nav-section">{text.tags}</div>
            <button className="nav-section-add" title={text.addTag} onClick={() => void addTag().catch(showError)}>
              <Plus size={13} />
            </button>
          </div>
          {tags.map(([name, count], index) => (
            <button
              key={name}
              className={`tag-row ${activeView === "all" && activeTag === name ? "on" : ""}`}
              onClick={() => {
                setActiveView("all");
                setActiveTag(name);
                setActiveCategory(null);
              }}
            >
              <i style={{ background: tagColors[index % tagColors.length] }} />
              <span>{name}</span>
              <b>{count}</b>
            </button>
          ))}
        </div>

        <div className="nav-foot">
          <button title={text.newSnippet} onClick={createNew}>
            <FilePlus2 size={15} />
          </button>
          <span>
            {activeView === "trash"
              ? text.trash
              : activeView === "favorites"
                ? text.favorites
                : activeTag
                  ? `#${activeTag}`
                  : activeCategory
                    ? displayCategory(activeCategory)
                    : text.allSnippets}
          </span>
          <button title={text.settings} onClick={() => setSettingsOpen(true)}>
            <Settings size={15} />
          </button>
        </div>
      </nav>

      <section className="list-panel">
        <div className="list-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <label className="search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void refresh(event.target.value);
              }}
              placeholder={text.searchSnippets}
            />
          </label>
          <button className="add-button" onClick={createNew} title={text.newSnippet}>
            <FilePlus2 size={17} />
          </button>
        </div>

        <div className="snippet-list">
          {filteredSnippets.map((snippet) => (
            <button
              key={snippet.id}
              className={`snippet-item ${snippet.id === selectedId ? "selected" : ""}`}
              onClick={() => loadIntoForm(snippet)}
              onContextMenu={(event) => {
                event.preventDefault();
                loadIntoForm(snippet);
                setContextMenu({ x: event.clientX, y: event.clientY, snippet });
              }}
            >
              <div className="snippet-title-row">
                {snippet.pinned ? <Pin size={12} className="pin-mark" /> : null}
                {snippet.enabled ? <span className="hot">●</span> : null}
                <span className="snippet-title">{snippet.title}</span>
              </div>
              <div className="snippet-meta">
                <span className="folder-meta">
                  <Folder size={11} />
                  {displayCategory(snippet.category)}
                </span>
                {snippet.shortcut ? <span className="trigger">{snippet.shortcut}</span> : null}
              </div>
            </button>
          ))}
          {filteredSnippets.length === 0 ? <div className="empty-list">{text.noSnippets}</div> : null}
        </div>
      </section>

      <section className="editor-panel">
        <header className="editor-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="editor-title" data-tauri-drag-region onMouseDown={startWindowDrag}>
            <div className="crumb" data-tauri-drag-region onMouseDown={startWindowDrag}>
              <Folder size={11} />
              {displayCategory(form.category)}
            </div>
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder={text.untitledSnippet}
            />
          </div>

          <div className="editor-tools">
            <button
              className={`icon-button fav ${form.favorite ? "on" : ""}`}
              title={text.favorite}
              onClick={toggleFavorite}
              disabled={Boolean(selected?.deleted_at)}
            >
              <Star size={16} fill={form.favorite ? "currentColor" : "none"} />
            </button>
            {selected?.deleted_at ? (
              <button className="icon-button" title={text.restore} onClick={restore} disabled={!form.id}>
                <RotateCcw size={16} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="editor-body">
          <div className="trigger-zone">
            <div className="trigger-box">
              <span className="prompt">❯</span>
              <input
                value={form.shortcut}
                onChange={(event) => setForm({ ...form, shortcut: event.target.value })}
                placeholder={text.trigger}
                spellCheck={false}
              />
              <span className="hint">{text.press}</span>
              <span className="keycap">Tab</span>
              <span className="hint last">{text.toExpand}</span>
            </div>
            <label className="enabled">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
              />
              <span />
              {text.enabled}
            </label>
          </div>

          <div className="meta-strip">
            <label>
              <span>{text.category}</span>
              <input
                value={form.category}
                onChange={(event) => setForm({ ...form, category: event.target.value })}
                placeholder="API"
                list="category-options"
              />
            </label>
            <label>
              <span>{text.tags}</span>
              <input
                value={form.tagsText}
                onChange={(event) => setForm({ ...form, tagsText: event.target.value })}
                placeholder="curl, api"
                list="tag-options"
              />
            </label>
            <label>
              <span>{text.shell}</span>
              <select value={form.shell} onChange={(event) => setForm({ ...form, shell: event.target.value })}>
                <option value="any">{text.any}</option>
                <option value="zsh">zsh</option>
                <option value="bash">bash</option>
                <option value="fish">fish</option>
              </select>
            </label>
          </div>

          <label className="description">
            <span>{text.description}</span>
            <input
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder={text.descriptionPlaceholder}
            />
          </label>

          <datalist id="category-options">
            {categories
              .filter(([name]) => name !== "Uncategorized")
              .map(([name]) => (
                <option value={name} key={name} />
              ))}
          </datalist>
          <datalist id="tag-options">
            {tags.map(([name]) => (
              <option value={name} key={name} />
            ))}
          </datalist>

          <div className="code-card">
            <div className="code-top">
              <span className="code-label">expansion.sh</span>
              {variables.map((name) => (
                <span className="var-token" key={name}>{"{{"}{name}{"}}"}</span>
              ))}
              <span className="line-count">{form.body.split("\n").length} {text.lines}</span>
            </div>
            <div className="code-editor">
              <div className="gutter">
                {form.body.split("\n").map((_, index) => (
                  <div key={index}>{index + 1}</div>
                ))}
              </div>
              <textarea
                value={form.body}
                onChange={(event) => setForm({ ...form, body: event.target.value })}
                placeholder="curl -X POST {{url}}"
                spellCheck={false}
              />
            </div>
          </div>
        </div>

        <footer className="status-bar">
          <span>
            <Code2 size={13} />
            {form.shell === "any" ? text.shell : form.shell}
          </span>
          <span className="tag-pills">
            {form.tagsText
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean)
              .map((tag, index) => (
                <b key={tag} style={{ background: tagColors[index % tagColors.length] }}>
                  {tag}
                </b>
              ))}
          </span>
          <span className="db">
            <Database size={13} />
            {dbPath}
          </span>
          <span className="status">{status ? <Check size={13} /> : null}{status}</span>
        </footer>
      </section>
        </>
      )}

      {settingsOpen ? (
        <div className="settings-overlay" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="settings-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={text.settings}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <aside className="settings-menu">
              <div className="settings-head">
                <div className="settings-mark">
                  <Settings size={18} />
                </div>
                <div>
                  <h2>{text.settings}</h2>
                  <p>{text.settingsSubtitle}</p>
                </div>
              </div>

              <div className="settings-tabs">
                {settingsTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.id}
                      className={`settings-tab ${settingsTab === tab.id ? "active" : ""}`}
                      onClick={() => setSettingsTab(tab.id)}
                    >
                      <Icon size={16} />
                      <span>{text.settingsTabs[tab.id]}</span>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div className="settings-content">
              <header className="settings-content-head">
                <div>
                  <h3>{text.settingsTabs[settingsTab]}</h3>
                  <p>{settingsSubtitle(settingsTab, locale)}</p>
                </div>
                <button className="settings-close" onClick={() => setSettingsOpen(false)} title={text.close}>
                  <X size={17} />
                </button>
              </header>

              {settingsTab === "appearance" ? (
                <div className="settings-section">
                  <SettingRow title={text.language} detail={text.languageDetail}>
                    <div className="segmented">
                      <button className={locale === "zh" ? "selected" : ""} onClick={() => setLocale("zh")}>
                        中文
                      </button>
                      <button className={locale === "en" ? "selected" : ""} onClick={() => setLocale("en")}>
                        English
                      </button>
                      <button className={locale === "ja" ? "selected" : ""} onClick={() => setLocale("ja")}>
                        日本語
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow title={text.theme} detail={text.themeDetail}>
                    <select
                      className="settings-select"
                      value={theme}
                      onChange={(event) => setTheme(event.target.value as Theme)}
                    >
                      {themeOptions.map((name) => (
                        <option key={name} value={name}>
                          {text[name]}
                        </option>
                      ))}
                    </select>
                  </SettingRow>
                  <SettingRow title={text.accentColor} detail={text.accentDetail}>
                    <div className="swatches">
                      {["#1F6B57", "#2F7DB5", "#C2693F", "#7A5BB5"].map((color, index) => (
                        <button key={color} className={index === 0 ? "selected" : ""} style={{ background: color }} />
                      ))}
                    </div>
                  </SettingRow>
                  <SettingRow title={text.compactList} detail={text.compactDetail}>
                    <label className="settings-switch">
                      <input type="checkbox" />
                      <span />
                    </label>
                  </SettingRow>
                  <SettingRow title={text.defaultWorkspace} detail={text.defaultWorkspaceDetail}>
                    <div className="segmented">
                      <button
                        className={defaultWorkspace === "snippets" ? "selected" : ""}
                        onClick={() => {
                          setDefaultWorkspace("snippets");
                          writeDefaultWorkspace("snippets");
                          setWorkspace("snippets");
                        }}
                      >
                        {text.wsSnippets}
                      </button>
                      <button
                        className={defaultWorkspace === "journal" ? "selected" : ""}
                        onClick={() => {
                          setDefaultWorkspace("journal");
                          writeDefaultWorkspace("journal");
                          setWorkspace("journal");
                        }}
                      >
                        {text.wsJournal}
                      </button>
                    </div>
                  </SettingRow>
                </div>
              ) : null}

              {settingsTab === "font" ? (
                <div className="settings-section">
                  <SettingRow title={text.interfaceFont} detail={text.interfaceFontDetail}>
                    <select className="settings-select" defaultValue="system">
                      <option value="system">System UI</option>
                      <option value="hanken">Hanken Grotesk</option>
                      <option value="inter">Inter</option>
                    </select>
                  </SettingRow>
                  <SettingRow title={text.editorFont} detail={text.editorFontDetail}>
                    <select className="settings-select" defaultValue="mono">
                      <option value="mono">JetBrains Mono</option>
                      <option value="sfmono">SF Mono</option>
                      <option value="menlo">Menlo</option>
                    </select>
                  </SettingRow>
                  <SettingRow title={text.editorSize} detail={text.editorSizeDetail}>
                    <input className="settings-range" type="range" min="11" max="18" defaultValue="13" />
                  </SettingRow>
                </div>
              ) : null}

              {settingsTab === "window" ? (
                <div className="settings-section">
                  <SettingRow title={text.launchAtLogin} detail={text.launchAtLoginDetail}>
                    <label className="settings-switch">
                      <input type="checkbox" />
                      <span />
                    </label>
                  </SettingRow>
                  <SettingRow title={text.alwaysOnTop} detail={text.alwaysOnTopDetail}>
                    <label className="settings-switch">
                      <input type="checkbox" />
                      <span />
                    </label>
                  </SettingRow>
                  <SettingRow title={text.windowChrome} detail={text.windowChromeDetail}>
                    <div className="segmented">
                      <button className="selected">{text.overlay}</button>
                      <button>{text.native}</button>
                    </div>
                  </SettingRow>
                </div>
              ) : null}

              {settingsTab === "terminal" ? (
                <div className="settings-section terminal-panel">
                  <SettingRow title={text.terminalCli} detail={text.terminalCliDetail}>
                    <button className="settings-action" onClick={() => void buildTerminalCli().catch(showError)}>
                      {text.terminalBuildCli}
                    </button>
                  </SettingRow>

                  <SettingRow
                    title={text.terminalFzf}
                    detail={
                      terminalDependency?.fzf_path
                        ? `${text.terminalFzfDetail} ${terminalDependency.fzf_path}`
                        : text.terminalFzfDetail
                    }
                  >
                    <div className="terminal-actions">
                      <span className={`terminal-badge ${terminalDependency?.fzf_installed ? "ok" : ""}`}>
                        {terminalDependency?.fzf_installed ? text.terminalFzfInstalled : text.terminalFzfMissing}
                      </span>
                      {!terminalDependency?.fzf_installed ? (
                        <button
                          className="settings-action"
                          onClick={() => void installFzf().catch(showError)}
                          disabled={!terminalDependency?.homebrew_installed}
                        >
                          {text.terminalInstallFzf}
                        </button>
                      ) : null}
                      <button className="settings-action muted" onClick={() => void copyFzfInstallCommand().catch(showError)}>
                        {text.terminalCopyInstall}
                      </button>
                    </div>
                  </SettingRow>

                  <SettingRow title={text.terminalShortcut} detail={`${text.terminalShortcutDetail} ${text.terminalItermHint}`}>
                    <kbd className="shortcut-key">Ctrl+G</kbd>
                  </SettingRow>

                  <div className="terminal-shells">
                    {terminalStatuses.map((item) => (
                      <div className="terminal-shell" key={item.shell}>
                        <div>
                          <h4>
                            {item.shell}
                            <span className={`terminal-badge ${item.registered ? "ok" : ""}`}>
                              {item.registered ? text.terminalRegistered : text.terminalNotRegistered}
                            </span>
                          </h4>
                          <p>
                            {text.terminalConfig}: {item.config_path}
                          </p>
                        </div>
                        <div className="terminal-actions">
                          <button
                            className="settings-action"
                            onClick={() => void installShell(item.shell).catch(showError)}
                          >
                            {item.registered ? text.terminalReregister : text.terminalRegister}
                          </button>
                          <button
                            className="settings-action muted"
                            onClick={() => void uninstallShell(item.shell).catch(showError)}
                          >
                            {text.terminalUnregister}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="terminal-note">
                    <button className="settings-action muted" onClick={showTerminalGuide}>
                      {text.terminalInstallGuide}
                    </button>
                    <span>{terminalMessage || text.terminalSourceHint}</span>
                  </div>
                </div>
              ) : null}

              {settingsTab === "sync" ? (
                <div className="settings-section sync-panel">
                  <SettingRow title={text.giteeToken} detail={text.giteeTokenDetail}>
                    <input
                      className="settings-input"
                      type="password"
                      value={giteeToken}
                      placeholder={giteeStatus?.configured ? "••••••••••••" : text.giteeTokenPlaceholder}
                      onChange={(event) => setGiteeToken(event.target.value)}
                    />
                  </SettingRow>

                  <SettingRow title={text.giteeGistId} detail={text.giteeGistIdDetail}>
                    <input
                      className="settings-input"
                      value={giteeGistId}
                      placeholder={text.giteeGistPlaceholder}
                      onChange={(event) => setGiteeGistId(event.target.value)}
                    />
                  </SettingRow>

                  <SettingRow title={text.giteeDescription} detail={text.giteeDescriptionDetail}>
                    <input
                      className="settings-input"
                      value={giteeDescription}
                      placeholder={text.giteeDescriptionPlaceholder}
                      onChange={(event) => setGiteeDescription(event.target.value)}
                    />
                  </SettingRow>

                  <SettingRow title={text.giteePublic} detail={text.giteePublicDetail}>
                    <label className="settings-switch">
                      <input
                        type="checkbox"
                        checked={giteePublic}
                        onChange={(event) => setGiteePublic(event.target.checked)}
                      />
                      <span />
                    </label>
                  </SettingRow>

                  <div className="sync-actions">
                    <button
                      className="settings-action"
                      disabled={!giteeToken.trim() && !giteeStatus?.configured}
                      onClick={() => void saveGiteeSyncConfig().catch(showError)}
                    >
                      <Check size={14} />
                      <span>{text.giteeSave}</span>
                    </button>
                    <button
                      className="settings-action"
                      disabled={!giteeStatus?.configured}
                      onClick={() => void pushGiteeSync().catch(showError)}
                    >
                      <Upload size={14} />
                      <span>{text.giteePush}</span>
                    </button>
                    <button
                      className="settings-action muted"
                      disabled={!giteeStatus?.configured || !giteeGistId.trim()}
                      onClick={() => void pullGiteeSync().catch(showError)}
                    >
                      <Download size={14} />
                      <span>{text.giteePull}</span>
                    </button>
                  </div>

                  <div className="sync-status">
                    <span className={`terminal-badge ${giteeStatus?.configured ? "ok" : ""}`}>
                      {giteeStatus?.configured ? text.giteeConfigured : text.giteeNotConfigured}
                    </span>
                    <span>{giteeMessage || `${text.giteeConfigPath}: ${giteeStatus?.config_path ?? text.loading}`}</span>
                  </div>

                </div>
              ) : null}

              {settingsTab === "images" ? (
                <div className="settings-section sync-panel">
                  <SettingRow title={text.qiniuAccessKey}>
                    <input
                      className="settings-input"
                      value={qiniuAccessKey}
                      placeholder={text.qiniuAccessKeyPlaceholder}
                      onChange={(event) => setQiniuAccessKey(event.target.value)}
                    />
                  </SettingRow>

                  <SettingRow title={text.qiniuSecretKey} detail={text.qiniuSecretKeyDetail}>
                    <input
                      className="settings-input"
                      type="password"
                      value={qiniuSecretKey}
                      placeholder={qiniuStatus?.configured ? "••••••••••••" : text.qiniuSecretKeyPlaceholder}
                      onChange={(event) => setQiniuSecretKey(event.target.value)}
                    />
                  </SettingRow>

                  <SettingRow title={text.qiniuBucket}>
                    <input
                      className="settings-input"
                      value={qiniuBucket}
                      placeholder={text.qiniuBucketPlaceholder}
                      onChange={(event) => setQiniuBucket(event.target.value)}
                    />
                  </SettingRow>

                  <SettingRow title={text.qiniuDomain} detail={text.qiniuDomainDetail}>
                    <input
                      className="settings-input"
                      value={qiniuDomain}
                      placeholder={text.qiniuDomainPlaceholder}
                      onChange={(event) => setQiniuDomain(event.target.value)}
                    />
                  </SettingRow>

                  <SettingRow title={text.qiniuUpHost} detail={text.qiniuUpHostDetail}>
                    <input
                      className="settings-input"
                      value={qiniuUpHost}
                      placeholder="https://up.qiniup.com"
                      onChange={(event) => setQiniuUpHost(event.target.value)}
                    />
                  </SettingRow>

                  <div className="sync-actions">
                    <button
                      className="settings-action"
                      disabled={
                        !qiniuAccessKey.trim() ||
                        !qiniuBucket.trim() ||
                        !qiniuDomain.trim() ||
                        (!qiniuSecretKey.trim() && !qiniuStatus?.configured)
                      }
                      onClick={() => void saveQiniuConfig().catch(showError)}
                    >
                      <Check size={14} />
                      <span>{text.qiniuSave}</span>
                    </button>
                  </div>

                  <div className="sync-status">
                    <span className={`terminal-badge ${qiniuStatus?.configured ? "ok" : ""}`}>
                      {qiniuStatus?.configured ? text.qiniuConfigured : text.qiniuNotConfigured}
                    </span>
                    <span>{qiniuMessage || `${text.giteeConfigPath}: ${qiniuStatus?.config_path ?? text.loading}`}</span>
                  </div>
                </div>
              ) : null}

              {settingsTab === "about" ? (
                <div className="settings-section about-panel">
                  <div className="about-logo">
                    <TerminalSquare size={24} />
                  </div>
                  <h4>AbraTab</h4>
                  <p>{text.aboutText}</p>
                  <dl>
                    <div>
                      <dt>{text.version}</dt>
                      <dd>0.1.0</dd>
                    </div>
                    <div>
                      <dt>{text.database}</dt>
                      <dd>{dbPath || text.loading}</dd>
                    </div>
                  </dl>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {contextMenu ? (
        <div
          className="snippet-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button onClick={() => void togglePinned(contextMenu.snippet).catch(showError)}>
            <Pin size={14} />
            <span>{contextMenu.snippet.pinned ? text.unpin : text.pin}</span>
          </button>
          <button onClick={() => void moveCategory(contextMenu.snippet).catch(showError)}>
            <Folder size={14} />
            <span>{text.moveCategory}</span>
          </button>
          <button className="danger" onClick={() => void deleteSnippet(contextMenu.snippet).catch(showError)}>
            <Trash2 size={14} />
            <span>{text.delete}</span>
          </button>
        </div>
      ) : null}

      {textPrompt ? (
        <div className="prompt-overlay" role="presentation" onMouseDown={() => resolvePrompt(null)}>
          <form
            className="prompt-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={textPrompt.title}
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              resolvePrompt(textPrompt.value);
            }}
          >
            <h3>{textPrompt.title}</h3>
            <input
              autoFocus
              value={textPrompt.value}
              onChange={(event) => setTextPrompt({ title: textPrompt.title, value: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  resolvePrompt(null);
                }
              }}
            />
            <div className="prompt-actions">
              <button type="button" className="prompt-cancel" onClick={() => resolvePrompt(null)}>
                {text.cancel}
              </button>
              <button type="submit" className="prompt-confirm">
                {text.confirm}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function settingsSubtitle(tab: SettingsTab, locale: Locale) {
  return translations[locale].subtitles[tab];
}

type Strings = (typeof translations)[Locale];

function WorkspaceToggle({
  workspace,
  setWorkspace,
  text,
}: {
  workspace: Workspace;
  setWorkspace: (value: Workspace) => void;
  text: Strings;
}) {
  const tabs: Array<{ id: Workspace; label: string; Icon: React.ElementType }> = [
    { id: "snippets", label: text.wsSnippets, Icon: Code2 },
    { id: "journal", label: text.wsJournal, Icon: NotebookText },
  ];
  return (
    <div className="workspace-switch" role="tablist">
      {tabs.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={workspace === id}
          className={workspace === id ? "on" : ""}
          onClick={() => setWorkspace(id)}
        >
          <Icon size={13} />
          {label}
        </button>
      ))}
    </div>
  );
}

function JournalModeNav({
  mode,
  setMode,
  text,
}: {
  mode: JournalMode;
  setMode: (value: JournalMode) => void;
  text: Strings;
}) {
  const items: Array<{ id: JournalMode; label: string; Icon: React.ElementType }> = [
    { id: "weeklog", label: text.wsWeeklog, Icon: CalendarDays },
    { id: "track", label: text.wsTrack, Icon: Activity },
  ];
  return (
    <>
      {items.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`nav-item ${mode === id ? "on" : ""}`}
          onClick={() => setMode(id)}
        >
          <Icon size={15} />
          <span>{label}</span>
        </button>
      ))}
    </>
  );
}

function WeekLogWorkspace({
  text,
  locale,
  workspace,
  setWorkspace,
  mode,
  setMode,
  onOpenSettings,
  startWindowDrag,
  dbPath,
}: {
  text: Strings;
  locale: Locale;
  workspace: Workspace;
  setWorkspace: (value: Workspace) => void;
  mode: JournalMode;
  setMode: (value: JournalMode) => void;
  onOpenSettings: () => void;
  startWindowDrag: (event: React.MouseEvent<HTMLElement>) => void;
  dbPath: string;
}) {
  const [logs, setLogs] = useState<WeekLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<WeekForm | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [starredOnly, setStarredOnly] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const intl = localeTags[locale];

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  // Insert text at the textarea caret, keeping the caret after the inserted text.
  function insertAtCursor(snippet: string) {
    setForm((current) => {
      if (!current) return current;
      const el = textareaRef.current;
      const body = current.body;
      const start = el ? el.selectionStart : body.length;
      const end = el ? el.selectionEnd : body.length;
      const next = body.slice(0, start) + snippet + body.slice(end);
      if (el) {
        const caret = start + snippet.length;
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(caret, caret);
        });
      }
      return { ...current, body: next };
    });
  }

  async function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = clipboardImage(event);
    if (!file) return;
    event.preventDefault();
    setUploading(true);
    setStatus(text.weeklogImageUploading);
    try {
      const data = await fileToBase64(file);
      const result = await invoke<UploadResult>("upload_image", {
        filename: imageFilename(file),
        data,
      });
      insertAtCursor(`![](${result.url})\n`);
      setStatus(text.weeklogImageUploaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Surface a clear hint when the image host has not been set up yet.
      setStatus(
        /not configured/i.test(message) ? text.weeklogImageNotConfigured : message,
      );
    } finally {
      setUploading(false);
    }
  }

  function parseDate(value: string) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateLabel(value: string) {
    const date = parseDate(value);
    if (!date) return "";
    return new Intl.DateTimeFormat(intl, { month: "long", day: "numeric" }).format(date);
  }

  function monthLabel(value: string) {
    const date = parseDate(value);
    if (!date) return "";
    return new Intl.DateTimeFormat(intl, { year: "numeric", month: "long" }).format(date);
  }

  const selected = logs.find((log) => log.id === selectedId) ?? null;

  const visibleLogs = useMemo(
    () => (starredOnly ? logs.filter((log) => log.favorite) : logs),
    [logs, starredOnly],
  );

  const groups = useMemo(() => {
    const out: Array<{ label: string; items: WeekLog[] }> = [];
    for (const log of visibleLogs) {
      const label = monthLabel(log.created_at) || text.wsWeeklog;
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(log);
      else out.push({ label, items: [log] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleLogs, intl]);

  function loadIntoForm(log: WeekLog) {
    setSelectedId(log.id);
    setForm({ id: log.id, title: log.title, body: log.body });
  }

  function newNote() {
    setSelectedId(null);
    setForm({ title: "", body: "" });
  }

  async function refresh(nextQuery = query) {
    const rows = await invoke<WeekLog[]>("list_week_logs", { query: nextQuery.trim() || null });
    setLogs(rows);
    return rows;
  }

  useEffect(() => {
    void (async () => {
      const rows = await refresh("");
      if (rows.length) loadIntoForm(rows[0]);
    })().catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!form) return;
    if (!form.title.trim() && !form.body.trim()) {
      setStatus(text.weeklogEmpty);
      return;
    }
    try {
      const saved = await invoke<WeekLog>("save_week_log", {
        input: {
          id: form.id,
          week_key: "",
          title: form.title,
          body: form.body,
        },
      });
      await refresh();
      loadIntoForm(saved);
      setStatus(text.weeklogSaved);
    } catch (error) {
      showError(error);
    }
  }

  async function remove() {
    if (!form?.id) return;
    try {
      await invoke("delete_week_log", { id: form.id });
      const rows = await refresh();
      setStatus(text.weeklogDeleted);
      if (rows.length) loadIntoForm(rows[0]);
      else {
        setSelectedId(null);
        setForm(null);
      }
    } catch (error) {
      showError(error);
    }
  }

  async function toggleFavorite(log: WeekLog) {
    try {
      await invoke("set_week_log_favorite", { id: log.id, favorite: !log.favorite });
      await refresh();
      setStatus(!log.favorite ? text.weeklogStarred : text.weeklogUnstarred);
    } catch (error) {
      showError(error);
    }
  }

  return (
    <>
      <nav className="nav-panel">
        <div className="brand" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="brand-logo">
            <CalendarDays size={20} />
          </div>
          <div data-tauri-drag-region>
            <h1>AbraTab</h1>
            <p>{logs.length} {text.wsWeeklogUnit}</p>
          </div>
        </div>

        <WorkspaceToggle workspace={workspace} setWorkspace={setWorkspace} text={text} />

        <div className="nav-scroll">
          <JournalModeNav mode={mode} setMode={setMode} text={text} />
        </div>

        <div className="nav-foot">
          <button title={text.newWeeklog} onClick={() => newNote()}>
            <CalendarPlus size={15} />
          </button>
          <span>{text.wsWeeklog}</span>
          <button title={text.settings} onClick={onOpenSettings}>
            <Settings size={15} />
          </button>
        </div>
      </nav>

      <section className="list-panel">
        <div className="list-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <label className="search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void refresh(event.target.value).catch(showError);
              }}
              placeholder={text.searchWeeklogs}
            />
          </label>
          <button
            className={`add-button ${starredOnly ? "starred-on" : ""}`}
            onClick={() => setStarredOnly((value) => !value)}
            title={text.weeklogStarredFilter}
          >
            <Star size={16} fill={starredOnly ? "currentColor" : "none"} />
          </button>
          <button className="add-button" onClick={() => newNote()} title={text.newWeeklog}>
            <CalendarPlus size={17} />
          </button>
        </div>

        <div className="snippet-list">
          {groups.map((group) => (
            <React.Fragment key={group.label}>
              <div className="weeklog-group">{group.label}</div>
              {group.items.map((log) => (
                <button
                  key={log.id}
                  className={`snippet-item ${log.id === selectedId ? "selected" : ""}`}
                  onClick={() => loadIntoForm(log)}
                >
                  <div className="snippet-title-row">
                    <span className="snippet-title">{log.title.trim() || dateLabel(log.created_at) || text.wsWeeklog}</span>
                    {log.favorite ? <Star className="weeklog-star" size={13} fill="currentColor" /> : null}
                  </div>
                  <div className="snippet-meta">
                    <span className="folder-meta">
                      <CalendarRange size={11} />
                      {dateLabel(log.created_at)}
                    </span>
                  </div>
                  {log.body.trim() ? <div className="weeklog-preview">{log.body.trim().split("\n")[0]}</div> : null}
                </button>
              ))}
            </React.Fragment>
          ))}
          {visibleLogs.length === 0 ? (
            <div className="empty-list">{starredOnly ? text.weeklogNoStarred : text.noWeeklogs}</div>
          ) : null}
        </div>
      </section>

      <section className="editor-panel">
        <header className="editor-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="editor-title" data-tauri-drag-region onMouseDown={startWindowDrag}>
            <div className="crumb" data-tauri-drag-region onMouseDown={startWindowDrag}>
              <CalendarRange size={11} />
              {selected ? dateLabel(selected.created_at) : text.wsWeeklog}
            </div>
            <input
              value={form?.title ?? ""}
              onChange={(event) => form && setForm({ ...form, title: event.target.value })}
              placeholder={text.weeklogTitlePlaceholder}
              disabled={!form}
            />
          </div>
          <div className="editor-tools">
            {selected ? (
              <button
                className={`icon-button fav ${selected.favorite ? "on" : ""}`}
                title={selected.favorite ? text.weeklogUnstar : text.weeklogStar}
                onClick={() => void toggleFavorite(selected)}
              >
                <Star size={16} fill={selected.favorite ? "currentColor" : "none"} />
              </button>
            ) : null}
            {form ? (
              <button
                className={`icon-button ${showPreview ? "active" : ""}`}
                title={showPreview ? text.weeklogEdit : text.preview}
                onClick={() => setShowPreview((value) => !value)}
              >
                {showPreview ? <Pencil size={16} /> : <Eye size={16} />}
              </button>
            ) : null}
            {form?.id ? (
              <button className="icon-button" title={text.delete} onClick={() => void remove()}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="editor-body">
          {form ? (
            <>
              <div className="code-card weeklog-card">
                <div className="code-top">
                  <span className="code-label">{selected ? dateLabel(selected.created_at) : text.newWeeklog}</span>
                  <span className="weeklog-hint">
                    {uploading ? (
                      text.weeklogImageUploading
                    ) : (
                      <>
                        <ImagePlus size={12} />
                        {text.weeklogImageHint}
                      </>
                    )}
                  </span>
                  <span className="line-count">{form.body.split("\n").length} {text.lines}</span>
                </div>
                {showPreview ? (
                  form.body.trim() ? (
                    <div
                      className="weeklog-preview-pane markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(form.body) }}
                    />
                  ) : (
                    <div className="weeklog-preview-pane empty">{text.weeklogPreviewEmpty}</div>
                  )
                ) : (
                  <textarea
                    ref={textareaRef}
                    className="weeklog-textarea"
                    value={form.body}
                    onChange={(event) => setForm({ ...form, body: event.target.value })}
                    onPaste={(event) => void handlePaste(event)}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
                        event.preventDefault();
                        void save();
                      }
                    }}
                    placeholder={text.weeklogBodyPlaceholder}
                    spellCheck={false}
                  />
                )}
              </div>

              <div className="weeklog-actions">
                <button type="button" className="weeklog-save" onClick={() => void save()}>
                  <Check size={14} />
                  {text.save}
                </button>
              </div>
            </>
          ) : (
            <div className="weeklog-empty-editor">{text.weeklogPickHint}</div>
          )}
        </div>

        <footer className="status-bar">
          <span>
            <CalendarDays size={13} />
            {selected ? dateLabel(selected.created_at) : text.wsWeeklog}
          </span>
          <span className="db">
            <Database size={13} />
            {dbPath}
          </span>
          <span className="status">{status ? <Check size={13} /> : null}{status}</span>
        </footer>
      </section>
    </>
  );
}

function TrackWorkspace({
  text,
  locale,
  workspace,
  setWorkspace,
  mode,
  setMode,
  onOpenSettings,
  startWindowDrag,
  dbPath,
}: {
  text: Strings;
  locale: Locale;
  workspace: Workspace;
  setWorkspace: (value: Workspace) => void;
  mode: JournalMode;
  setMode: (value: JournalMode) => void;
  onOpenSettings: () => void;
  startWindowDrag: (event: React.MouseEvent<HTMLElement>) => void;
  dbPath: string;
}) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [entries, setEntries] = useState<TrackEntry[]>([]);
  const [newEntry, setNewEntry] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");

  const intl = localeTags[locale];

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  function formatDate(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(intl, { month: "numeric", day: "numeric" }).format(date);
  }

  function formatDateTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(intl, {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  async function refreshTracks(nextQuery = query) {
    const rows = await invoke<Track[]>("list_tracks", { query: nextQuery.trim() || null });
    setTracks(rows);
    return rows;
  }

  async function loadEntries(trackId: string) {
    const rows = await invoke<TrackEntry[]>("list_track_entries", { trackId });
    setEntries(rows);
  }

  async function selectTrack(track: Track) {
    setSelectedId(track.id);
    setTitleDraft(track.title);
    setNewEntry("");
    await loadEntries(track.id);
  }

  useEffect(() => {
    void (async () => {
      const rows = await refreshTracks("");
      if (rows.length) await selectTrack(rows[0]);
    })().catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createTrack() {
    try {
      const track = await invoke<Track>("save_track", { input: { title: "" } });
      await refreshTracks();
      await selectTrack(track);
    } catch (error) {
      showError(error);
    }
  }

  async function saveTitle() {
    if (!selectedId) return;
    try {
      await invoke<Track>("save_track", { input: { id: selectedId, title: titleDraft } });
      await refreshTracks();
    } catch (error) {
      showError(error);
    }
  }

  async function addEntry() {
    const body = newEntry.trim();
    if (!selectedId || !body) return;
    try {
      await invoke<TrackEntry>("add_track_entry", { input: { track_id: selectedId, body } });
      setNewEntry("");
      await loadEntries(selectedId);
      await refreshTracks();
      setStatus(text.entryAdded);
    } catch (error) {
      showError(error);
    }
  }

  async function deleteEntry(id: string) {
    if (!selectedId) return;
    try {
      await invoke("delete_track_entry", { id });
      await loadEntries(selectedId);
      await refreshTracks();
      setStatus(text.entryDeleted);
    } catch (error) {
      showError(error);
    }
  }

  function startEntryEdit(entry: TrackEntry) {
    setEditingId(entry.id);
    setEditDraft(entry.body);
  }

  async function saveEntryEdit() {
    const id = editingId;
    if (!id) return;
    const original = entries.find((entry) => entry.id === id);
    const body = editDraft.trim();
    setEditingId(null);
    if (!original || !body || body === original.body) return;
    try {
      await invoke("update_track_entry", { id, body });
      if (selectedId) await loadEntries(selectedId);
      setStatus(text.entrySaved);
    } catch (error) {
      showError(error);
    }
  }

  async function deleteTrack() {
    if (!selectedId) return;
    try {
      await invoke("delete_track", { id: selectedId });
      const rows = await refreshTracks();
      setStatus(text.trackDeleted);
      if (rows.length) {
        await selectTrack(rows[0]);
      } else {
        setSelectedId(null);
        setEntries([]);
        setTitleDraft("");
      }
    } catch (error) {
      showError(error);
    }
  }

  return (
    <>
      <nav className="nav-panel">
        <div className="brand" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="brand-logo">
            <Activity size={20} />
          </div>
          <div data-tauri-drag-region>
            <h1>AbraTab</h1>
            <p>{tracks.length} {text.trackUnit}</p>
          </div>
        </div>

        <WorkspaceToggle workspace={workspace} setWorkspace={setWorkspace} text={text} />

        <div className="nav-scroll">
          <JournalModeNav mode={mode} setMode={setMode} text={text} />
        </div>

        <div className="nav-foot">
          <button title={text.newTrack} onClick={() => void createTrack()}>
            <Plus size={15} />
          </button>
          <span>{text.wsTrack}</span>
          <button title={text.settings} onClick={onOpenSettings}>
            <Settings size={15} />
          </button>
        </div>
      </nav>

      <section className="list-panel">
        <div className="list-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <label className="search">
            <Search size={14} />
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                void refreshTracks(event.target.value).catch(showError);
              }}
              placeholder={text.searchTracks}
            />
          </label>
          <button className="add-button" onClick={() => void createTrack()} title={text.newTrack}>
            <Plus size={17} />
          </button>
        </div>

        <div className="snippet-list">
          {tracks.map((track) => (
            <button
              key={track.id}
              className={`snippet-item ${track.id === selectedId ? "selected" : ""}`}
              onClick={() => void selectTrack(track)}
            >
              <div className="snippet-title-row">
                <span className="snippet-title">{track.title.trim() || text.untitledTrack}</span>
              </div>
              <div className="snippet-meta">
                <span className="folder-meta">
                  <Activity size={11} />
                  {track.entry_count} {text.entryUnit}
                  {track.last_entry_at ? ` · ${formatDate(track.last_entry_at)}` : ""}
                </span>
              </div>
            </button>
          ))}
          {tracks.length === 0 ? <div className="empty-list">{text.noTracks}</div> : null}
        </div>
      </section>

      <section className="editor-panel">
        <header className="editor-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="editor-title" data-tauri-drag-region onMouseDown={startWindowDrag}>
            <div className="crumb" data-tauri-drag-region onMouseDown={startWindowDrag}>
              <Activity size={11} />
              {selectedId ? `${entries.length} ${text.entryUnit}` : text.wsTrack}
            </div>
            <input
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => void saveTitle()}
              placeholder={text.trackTitlePlaceholder}
              disabled={!selectedId}
            />
          </div>
          <div className="editor-tools">
            {selectedId ? (
              <button className="icon-button" title={text.delete} onClick={() => void deleteTrack()}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="editor-body">
          {selectedId ? (
            <>
              <div className="entry-compose">
                <textarea
                  value={newEntry}
                  onChange={(event) => setNewEntry(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void addEntry();
                    }
                  }}
                  placeholder={text.newEntryPlaceholder}
                  spellCheck={false}
                />
                <button
                  type="button"
                  className="weeklog-save"
                  onClick={() => void addEntry()}
                  disabled={!newEntry.trim()}
                >
                  <Plus size={14} />
                  {text.addEntry}
                </button>
              </div>

              <div className="timeline">
                {entries.map((entry) => (
                  <div className="timeline-item" key={entry.id}>
                    <span className="timeline-dot" />
                    <div className="timeline-row">
                      <div className="timeline-content">
                        <div className="timeline-body">{entry.body}</div>
                        <div className="timeline-time">{formatDateTime(entry.created_at)}</div>
                      </div>
                      <div className="timeline-actions">
                        <button
                          type="button"
                          className="timeline-action"
                          title={text.editEntry}
                          onClick={() => startEntryEdit(entry)}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="timeline-action"
                          title={text.delete}
                          onClick={() => void deleteEntry(entry.id)}
                        >
                          <X size={13} />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {entries.length === 0 ? <div className="empty-list">{text.noEntries}</div> : null}
              </div>
            </>
          ) : (
            <div className="weeklog-empty-editor">{text.trackPickHint}</div>
          )}
        </div>

        <footer className="status-bar">
          <span>
            <Activity size={13} />
            {text.wsTrack}
          </span>
          <span className="db">
            <Database size={13} />
            {dbPath}
          </span>
          <span className="status">{status ? <Check size={13} /> : null}{status}</span>
        </footer>
      </section>

      {editingId ? (
        <div className="prompt-overlay" role="presentation" onMouseDown={() => setEditingId(null)}>
          <form
            className="prompt-dialog entry-edit-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={text.editEntry}
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveEntryEdit();
            }}
          >
            <h3>{text.editEntry}</h3>
            <textarea
              autoFocus
              className="entry-edit-textarea"
              value={editDraft}
              onChange={(event) => setEditDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setEditingId(null);
                } else if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void saveEntryEdit();
                }
              }}
              spellCheck={false}
            />
            <div className="prompt-actions">
              <button type="button" className="prompt-cancel" onClick={() => setEditingId(null)}>
                {text.cancel}
              </button>
              <button type="submit" className="prompt-confirm">
                {text.save}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

function SettingRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <h4>{title}</h4>
        {detail ? <p>{detail}</p> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
