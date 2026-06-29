import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import {
  Activity,
  Archive,
  ArchiveRestore,
  BookOpen,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Download,
  Eye,
  FilePlus2,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  Grid2X2,
  ImagePlus,
  Inbox,
  Info,
  Lock,
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
  Tag,
  TerminalSquare,
  Trash2,
  Type,
  X,
} from "lucide-react";
import MDEditor, { commands } from "@uiw/react-md-editor";
import "@uiw/react-md-editor/markdown-editor.css";
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
type SettingsTab = "appearance" | "font" | "window" | "security" | "terminal" | "sync" | "images" | "about";
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

type SyncCounts = {
  snippet_count: number;
  week_log_count: number;
  track_count: number;
  project_count: number;
  inbox_count: number;
};

type SyncLogEntry = SyncCounts & {
  at: string;
  action: string;
  ok: boolean;
  gist_id: string | null;
  message: string;
};

type GiteeSyncStatus = {
  configured: boolean;
  gist_id: string | null;
  description: string;
  public: boolean;
  config_path: string;
  last_sync: SyncLogEntry | null;
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
type JournalMode = "weeklog" | "track" | "project" | "inbox" | "book";

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

type Project = {
  id: string;
  name: string;
  path: string;
  git_url: string;
  description: string;
  tags: string[];
  created_at: string;
  updated_at: string;
};

type ProjectForm = {
  id?: string;
  name: string;
  path: string;
  git_url: string;
  description: string;
  tags: string[];
};

type InboxItem = {
  id: string;
  source: string;
  title: string;
  body: string;
  format: string;
  read: boolean;
  created_at: string;
  archived_at: string | null;
};

type BookStatus = "want" | "reading" | "finished";

type Book = {
  id: string;
  title: string;
  author: string;
  cover_url: string;
  intro: string;
  status: BookStatus;
  rating: number;
  start_date: string;
  end_date: string;
  thoughts: string;
  created_at: string;
  updated_at: string;
  excerpt_count: number;
};

type BookExcerpt = {
  id: string;
  book_id: string;
  text: string;
  page: string;
  created_at: string;
};

type BookForm = {
  id?: string;
  title: string;
  author: string;
  cover_url: string;
  intro: string;
  status: BookStatus;
  rating: number;
  start_date: string;
  end_date: string;
  thoughts: string;
};

type InboxConnectionInfo = {
  cli_path: string;
  db_path: string;
};

type DayActivity = {
  date: string;
  count: number;
};

type Track = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
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

const ALWAYS_ON_TOP_KEY = "abratab.alwaysOnTop";
const TITLE_BAR_STYLE_KEY = "abratab.titleBarStyle";

type TitleBarPref = "overlay" | "visible";

function readAlwaysOnTop(): boolean {
  try {
    return localStorage.getItem(ALWAYS_ON_TOP_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAlwaysOnTop(value: boolean) {
  try {
    localStorage.setItem(ALWAYS_ON_TOP_KEY, value ? "1" : "0");
  } catch {
    /* localStorage unavailable; ignore */
  }
}

// Build a "3 周记 · 3 奇思妙想 · 3 收件箱" summary, hiding categories with no data.
function syncBreakdown(counts: SyncCounts, text: Strings): string {
  const parts: string[] = [];
  if (counts.snippet_count) parts.push(`${counts.snippet_count} ${text.snippets}`);
  if (counts.week_log_count) parts.push(`${counts.week_log_count} ${text.wsWeeklog}`);
  if (counts.track_count) parts.push(`${counts.track_count} ${text.wsTrack}`);
  if (counts.project_count) parts.push(`${counts.project_count} ${text.wsProject}`);
  if (counts.inbox_count) parts.push(`${counts.inbox_count} ${text.wsInbox}`);
  return parts.length ? parts.join(" · ") : text.giteeNoData;
}

function formatSyncTime(value: string, locale: Locale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(localeTags[locale], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function readTitleBarStyle(): TitleBarPref {
  try {
    return localStorage.getItem(TITLE_BAR_STYLE_KEY) === "visible" ? "visible" : "overlay";
  } catch {
    return "overlay";
  }
}

function writeTitleBarStyle(value: TitleBarPref) {
  try {
    localStorage.setItem(TITLE_BAR_STYLE_KEY, value);
  } catch {
    /* localStorage unavailable; ignore */
  }
}

const WEEKLOG_TEMPLATE_KEY = "abratab.weeklogTemplate";

// New-note mode + how a week-framed note is shown:
//   "blank"  → empty note, edited as one whole body;
//   "paged"  → this week's 7 days, shown one day at a time (‹ › pager);
//   "blocks" → this week's 7 days, shown as stacked per-day blocks.
type WeeklogTemplate = "blank" | "paged" | "blocks";

function readWeeklogTemplate(): WeeklogTemplate {
  try {
    const value = localStorage.getItem(WEEKLOG_TEMPLATE_KEY);
    if (value === "blocks") return "blocks";
    if (value === "paged" || value === "week") return "paged"; // "week": legacy paged
    return "blank";
  } catch {
    return "blank";
  }
}

function writeWeeklogTemplate(value: WeeklogTemplate) {
  try {
    localStorage.setItem(WEEKLOG_TEMPLATE_KEY, value);
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
// Build an <img> tag, honoring an optional `=WIDTHxHEIGHT` size hint.
function imageTag(src: string, alt: string, width?: string, height?: string): string {
  const styles: string[] = [];
  if (width) styles.push(`width:${width}px`);
  if (height) styles.push(`height:${height}px`);
  const cls = styles.length ? ' class="md-img-sized"' : "";
  const style = styles.length ? ` style="${styles.join(";")}"` : "";
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${cls}${style} />`;
}

function renderMarkdown(source: string): string {
  const blocks = source.replace(/\r\n/g, "\n").split(/\n{2,}/);
  const html = blocks.map((block) => {
    const trimmed = block.trim();
    if (!trimmed) return "";

    // Standalone image: render large, not inside a paragraph.
    // Optional size hint: ![alt](url =宽x) or ![alt](url =宽x高).
    const loneImage = trimmed.match(/^!\[([^\]]*)\]\(([^)\s]+)(?:\s+=(\d*)x(\d*))?\)$/);
    if (loneImage) {
      const src = safeUrl(loneImage[2]);
      if (src) {
        return `<p class="md-image">${imageTag(src, loneImage[1], loneImage[3], loneImage[4])}</p>`;
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
  // Images: ![alt](url) with optional `=宽x高` size hint.
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+=(\d*)x(\d*))?\)/g, (match, alt, url, w, h) => {
    const src = safeUrl(url);
    return src ? imageTag(src, alt, w, h) : match;
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
  { id: "security", icon: Lock },
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
    appName: "妙手",
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
    settingsSubtitle: "妙手 偏好设置",
    close: "关闭",
    settingsTabs: {
      appearance: "外观",
      font: "字体",
      window: "窗口",
      security: "安全",
      terminal: "终端",
      sync: "同步",
      images: "图床",
      about: "关于",
    },
    subtitles: {
      appearance: "主题、语言、强调色和密度。",
      font: "字体和编辑器阅读体验。",
      window: "窗口行为和标题栏。",
      security: "锁定周记的主密码。",
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
    giteePushing: "推送中…",
    giteePulling: "拉取中…",
    giteeSyncOk: "成功",
    giteeSyncFail: "失败",
    giteeNoData: "无数据",
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
    windowSize: "窗口尺寸",
    windowSizeDetail: "宽 × 高（像素），应用后下次启动按此尺寸打开。",
    windowSizeApply: "应用",
    windowSizeApplied: "已调整窗口尺寸",
    windowSizeInvalid: "宽至少 940，高至少 620",
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
    weeklogTemplate: "新建周记默认模板",
    weeklogTemplateDetail: "新建周记时预填的内容",
    weeklogTemplateBlank: "空白",
    weeklogTemplatePaged: "翻页",
    weeklogTemplateBlocks: "多块",
    weeklogNewOptions: "选择新建模板",
    searchWeeklogs: "搜索周记...",
    noWeeklogs: "还没有周记",
    weeklogTitlePlaceholder: "标题（可选）",
    weeklogBodyPlaceholder: "记录这一周做了什么、遇到了什么、下周打算做什么…",
    weeklogDayPlaceholder: "记录这一天做了什么、遇到了什么…",
    weeklogPickHint: "从左侧选择一篇，或点「新增」开始记录。",
    lockSet: "加锁",
    lockRemove: "解锁",
    lockSetMaster: "设置主密码（所有加锁记录通用）",
    lockEnterMaster: "输入主密码",
    lockScreenTitle: "此记录已锁定",
    lockUnlock: "解锁",
    lockLocked: "已锁定",
    lockRemoved: "已解锁",
    lockWrong: "密码错误",
    lockEmpty: "请输入密码",
    lockMismatch: "两次输入的密码不一致",
    lockPasswordPlaceholder: "密码",
    lockConfirmPlaceholder: "再次输入密码",
    lockNeedSetup: "请先到「设置 · 安全」设置锁密码",
    lockSecurityHelp: "为锁定的周记设置一个主密码，所有加锁的周记都用它解锁。",
    lockConfigured: "锁密码已设置",
    lockCurrentPlaceholder: "当前密码",
    lockNewPlaceholder: "新密码",
    lockSetPassword: "设置密码",
    lockChangePassword: "修改密码",
    lockRemovePassword: "移除密码",
    lockSaved: "已保存",
    lockPasswordRemoved: "已移除锁密码",
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
    trackArchive: "归档",
    trackUnarchive: "取消归档",
    trackArchived: "已归档主题",
    trackUnarchived: "已取消归档",
    showArchived: "查看已归档",
    hideArchived: "返回",
    noArchivedTracks: "还没有归档的主题。",
    wsProject: "项目坞",
    projectUnit: "个项目",
    newProject: "新建项目",
    searchProjects: "搜索项目…",
    noProjects: "还没有项目，新建一个开始登记。",
    projectUntitled: "未命名项目",
    projectNoPath: "未设置目录",
    projectNamePlaceholder: "项目名称",
    projectPath: "本地目录",
    projectPathPlaceholder: "/Users/you/code/my-project",
    projectGitUrl: "Git 地址",
    projectGitPlaceholder: "https://github.com/you/my-project.git",
    projectDesc: "备注",
    projectDescPlaceholder: "记下项目用途、技术栈等…",
    projectOpenFolder: "打开文件夹",
    projectOpenTerminal: "在终端打开",
    projectPickHint: "从左侧选择一个项目，或新建一个开始登记。",
    projectEmpty: "项目名称、目录或 Git 地址至少填一个",
    projectSaved: "已保存项目",
    projectTagSet: "打标签",
    projectTagPlaceholder: "用逗号分隔，如：工作, 重要",
    projectDeleted: "已删除项目",
    wsBook: "读书",
    bookUnit: "本书",
    newBook: "新建图书",
    searchBooks: "搜索书名 / 作者…",
    noBooks: "还没有读书记录，新建一本开始。",
    untitledBook: "未命名图书",
    bookTitlePlaceholder: "书名",
    bookAuthor: "作者",
    bookAuthorPlaceholder: "作者",
    bookCover: "封面",
    bookCoverHint: "点击上传本地图片作为封面",
    bookCoverUrl: "封面链接",
    bookCoverUpload: "上传图片",
    bookCoverView: "查看图片",
    bookCoverUrlPlaceholder: "粘贴图片链接",
    bookCoverUploading: "封面上传中…",
    bookIntro: "简介",
    bookIntroPlaceholder: "这本书讲了什么…",
    bookStatus: "状态",
    bookStatusWant: "想读",
    bookStatusReading: "在读",
    bookStatusFinished: "已读",
    bookStart: "开始",
    bookEnd: "读完",
    bookRating: "评分",
    bookThoughts: "感想",
    bookThoughtsPlaceholder: "读完的感想、收获…",
    bookExcerpts: "精彩摘录",
    bookExcerptPlaceholder: "记下打动你的一段文字…",
    bookExcerptPage: "页码",
    bookExcerptAdd: "添加",
    bookExcerptUnit: "条摘录",
    bookAllAuthors: "全部作者",
    bookSaved: "已保存图书",
    bookDeleted: "已删除图书",
    bookPickHint: "从左侧选择一本书，或新建一本开始记录。",
    wsInbox: "收件箱",
    inboxUnit: "条",
    inboxUnread: "未读",
    inboxRefresh: "刷新",
    searchInbox: "搜索收件箱…",
    noInbox: "收件箱还是空的。让 Claude / Codex 推一条进来试试。",
    noArchivedInbox: "没有已归档的内容。",
    inboxArchive: "归档",
    inboxUnarchive: "取消归档",
    inboxArchived: "已归档",
    inboxUnarchived: "已取消归档",
    inboxUntitled: "无标题",
    inboxPickHint: "从左侧选择一条记录查看，或按下面任意一种方式从 Claude / Codex 写入。",
    inboxConnectCliLabel: "命令行（最简单，让 AI 顺手敲一句）",
    inboxConnectMcpClaude: "MCP · Claude Code（写入 ~/.claude.json 或项目 .mcp.json）",
    inboxConnectMcpCodex: "MCP · Codex（写入 ~/.codex/config.toml）",
    inboxConnectNote: "MCP 配好后，Claude / Codex 会把“存到 AbraTab”当成一个工具自动调用，无需每次手动敲命令。",
    inboxMarkRead: "标为已读",
    inboxMarkUnread: "标为未读",
    inboxCopy: "复制",
    inboxCopied: "已复制",
    inboxDeleted: "已删除",
    inboxNew: "新建",
    inboxNewTitle: "标题（可选）",
    inboxNewBody: "记点什么…（⌘/Ctrl+Enter 保存）",
    inboxAdded: "已添加",
    inboxEdit: "编辑",
    inboxSaved: "已保存",
    inboxFormatText: "文本",
    inboxEmptyBody: "内容不能为空",
  },
  en: {
    snippets: "snippets",
    appName: "AbraTab",
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
      security: "Security",
      terminal: "Terminal",
      sync: "Sync",
      images: "Image host",
      about: "About",
    },
    subtitles: {
      appearance: "Theme, language, accent, and density.",
      font: "Typeface and editor reading comfort.",
      window: "Window behavior and chrome.",
      security: "Master password for locking notes.",
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
    giteePushing: "Pushing…",
    giteePulling: "Pulling…",
    giteeSyncOk: "Success",
    giteeSyncFail: "Failed",
    giteeNoData: "no data",
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
    windowSize: "Window size",
    windowSizeDetail: "Width × height (px). Applied size is restored on next launch.",
    windowSizeApply: "Apply",
    windowSizeApplied: "Window size updated",
    windowSizeInvalid: "Width ≥ 940, height ≥ 620",
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
    weeklogTemplate: "New note template",
    weeklogTemplateDetail: "What a new note is prefilled with",
    weeklogTemplateBlank: "Blank",
    weeklogTemplatePaged: "Paged",
    weeklogTemplateBlocks: "Blocks",
    weeklogNewOptions: "Choose template",
    searchWeeklogs: "Search logs...",
    noWeeklogs: "No weekly logs yet",
    weeklogTitlePlaceholder: "Title (optional)",
    weeklogBodyPlaceholder: "What you did this week, what came up, what's next…",
    weeklogDayPlaceholder: "What you did and ran into today…",
    weeklogPickHint: "Pick a note on the left, or hit New to start.",
    lockSet: "Lock",
    lockRemove: "Unlock",
    lockSetMaster: "Set a master password (used for all locked notes)",
    lockEnterMaster: "Enter master password",
    lockScreenTitle: "This note is locked",
    lockUnlock: "Unlock",
    lockLocked: "Locked",
    lockRemoved: "Unlocked",
    lockWrong: "Wrong password",
    lockEmpty: "Enter a password",
    lockMismatch: "Passwords do not match",
    lockPasswordPlaceholder: "Password",
    lockConfirmPlaceholder: "Repeat password",
    lockNeedSetup: "Set a lock password in Settings · Security first",
    lockSecurityHelp: "Set a master password to lock weekly notes; all locked notes use it.",
    lockConfigured: "Lock password is set",
    lockCurrentPlaceholder: "Current password",
    lockNewPlaceholder: "New password",
    lockSetPassword: "Set password",
    lockChangePassword: "Change password",
    lockRemovePassword: "Remove password",
    lockSaved: "Saved",
    lockPasswordRemoved: "Lock password removed",
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
    trackArchive: "Archive",
    trackUnarchive: "Unarchive",
    trackArchived: "Topic archived",
    trackUnarchived: "Topic unarchived",
    showArchived: "View archived",
    hideArchived: "Back",
    noArchivedTracks: "No archived topics yet.",
    wsProject: "Projects",
    projectUnit: "projects",
    newProject: "New project",
    searchProjects: "Search projects…",
    noProjects: "No projects yet. Create one to get started.",
    projectUntitled: "Untitled project",
    projectNoPath: "No directory set",
    projectNamePlaceholder: "Project name",
    projectPath: "Local directory",
    projectPathPlaceholder: "/Users/you/code/my-project",
    projectGitUrl: "Git URL",
    projectGitPlaceholder: "https://github.com/you/my-project.git",
    projectDesc: "Notes",
    projectDescPlaceholder: "Note the purpose, tech stack, etc…",
    projectOpenFolder: "Open folder",
    projectOpenTerminal: "Open in terminal",
    projectPickHint: "Select a project on the left, or create a new one.",
    projectEmpty: "Enter at least a name, directory, or Git URL",
    projectSaved: "Project saved",
    projectTagSet: "Set tags",
    projectTagPlaceholder: "Comma-separated, e.g. work, important",
    projectDeleted: "Project deleted",
    wsBook: "Reading",
    bookUnit: "books",
    newBook: "Add book",
    searchBooks: "Search title / author…",
    noBooks: "No books yet — add one to start.",
    untitledBook: "Untitled book",
    bookTitlePlaceholder: "Title",
    bookAuthor: "Author",
    bookAuthorPlaceholder: "Author",
    bookCover: "Cover",
    bookCoverHint: "Click to upload a local image",
    bookCoverUrl: "Cover URL",
    bookCoverUpload: "Upload image",
    bookCoverView: "View image",
    bookCoverUrlPlaceholder: "Paste an image URL",
    bookCoverUploading: "Uploading cover…",
    bookIntro: "About",
    bookIntroPlaceholder: "What's this book about…",
    bookStatus: "Status",
    bookStatusWant: "To read",
    bookStatusReading: "Reading",
    bookStatusFinished: "Finished",
    bookStart: "Started",
    bookEnd: "Finished",
    bookRating: "Rating",
    bookThoughts: "Thoughts",
    bookThoughtsPlaceholder: "Takeaways, impressions…",
    bookExcerpts: "Excerpts",
    bookExcerptPlaceholder: "A passage that struck you…",
    bookExcerptPage: "Page",
    bookExcerptAdd: "Add",
    bookExcerptUnit: "excerpts",
    bookAllAuthors: "All authors",
    bookSaved: "Book saved",
    bookDeleted: "Book deleted",
    bookPickHint: "Pick a book on the left, or add one to start.",
    wsInbox: "Inbox",
    inboxUnit: "items",
    inboxUnread: "unread",
    inboxRefresh: "Refresh",
    searchInbox: "Search inbox…",
    noInbox: "Inbox is empty. Try pushing one from Claude / Codex.",
    noArchivedInbox: "No archived items.",
    inboxArchive: "Archive",
    inboxUnarchive: "Unarchive",
    inboxArchived: "Archived",
    inboxUnarchived: "Unarchived",
    inboxUntitled: "Untitled",
    inboxPickHint: "Select a record to view, or push from Claude / Codex using any method below.",
    inboxConnectCliLabel: "CLI (simplest — have the agent run a command)",
    inboxConnectMcpClaude: "MCP · Claude Code (add to ~/.claude.json or project .mcp.json)",
    inboxConnectMcpCodex: "MCP · Codex (add to ~/.codex/config.toml)",
    inboxConnectNote: "Once MCP is configured, Claude / Codex call “save to AbraTab” as a tool automatically — no need to type a command each time.",
    inboxMarkRead: "Mark as read",
    inboxMarkUnread: "Mark as unread",
    inboxCopy: "Copy",
    inboxCopied: "Copied",
    inboxDeleted: "Deleted",
    inboxNew: "New",
    inboxNewTitle: "Title (optional)",
    inboxNewBody: "Jot something… (⌘/Ctrl+Enter to save)",
    inboxAdded: "Added",
    inboxEdit: "Edit",
    inboxSaved: "Saved",
    inboxFormatText: "Text",
    inboxEmptyBody: "Content can't be empty",
  },
  ja: {
    snippets: "スニペット",
    appName: "AbraTab",
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
      security: "セキュリティ",
      terminal: "ターミナル",
      sync: "同期",
      images: "画像ホスト",
      about: "情報",
    },
    subtitles: {
      appearance: "テーマ、言語、アクセント、表示密度。",
      font: "書体とエディタの読みやすさ。",
      window: "ウィンドウ動作とタイトルバー。",
      security: "ノートをロックするマスターパスワード。",
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
    giteePushing: "プッシュ中…",
    giteePulling: "プル中…",
    giteeSyncOk: "成功",
    giteeSyncFail: "失敗",
    giteeNoData: "データなし",
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
    windowSize: "ウィンドウサイズ",
    windowSizeDetail: "幅 × 高さ（px）。適用したサイズは次回起動時に復元されます。",
    windowSizeApply: "適用",
    windowSizeApplied: "ウィンドウサイズを変更しました",
    windowSizeInvalid: "幅は 940 以上、高さは 620 以上",
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
    weeklogTemplate: "新規ノートの初期内容",
    weeklogTemplateDetail: "新規作成時に挿入する雛形",
    weeklogTemplateBlank: "空白",
    weeklogTemplatePaged: "ページ",
    weeklogTemplateBlocks: "ブロック",
    weeklogNewOptions: "雛形を選択",
    searchWeeklogs: "週次ログを検索...",
    noWeeklogs: "週次ログがありません",
    weeklogTitlePlaceholder: "タイトル（任意）",
    weeklogBodyPlaceholder: "今週やったこと、起きたこと、来週の予定…",
    weeklogDayPlaceholder: "今日やったこと、気づいたことを記録…",
    weeklogPickHint: "左からノートを選ぶか、「新規」で書き始めます。",
    lockSet: "ロック",
    lockRemove: "ロック解除",
    lockSetMaster: "マスターパスワードを設定（全ロックノート共通）",
    lockEnterMaster: "マスターパスワードを入力",
    lockScreenTitle: "このノートはロックされています",
    lockUnlock: "ロック解除",
    lockLocked: "ロックしました",
    lockRemoved: "ロック解除しました",
    lockWrong: "パスワードが違います",
    lockEmpty: "パスワードを入力してください",
    lockMismatch: "パスワードが一致しません",
    lockPasswordPlaceholder: "パスワード",
    lockConfirmPlaceholder: "パスワード（確認）",
    lockNeedSetup: "先に「設定 · セキュリティ」でロックパスワードを設定してください",
    lockSecurityHelp: "週次ノートをロックするためのマスターパスワードを設定します。全ロックノート共通です。",
    lockConfigured: "ロックパスワード設定済み",
    lockCurrentPlaceholder: "現在のパスワード",
    lockNewPlaceholder: "新しいパスワード",
    lockSetPassword: "パスワードを設定",
    lockChangePassword: "パスワードを変更",
    lockRemovePassword: "パスワードを削除",
    lockSaved: "保存しました",
    lockPasswordRemoved: "ロックパスワードを削除しました",
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
    trackArchive: "アーカイブ",
    trackUnarchive: "アーカイブ解除",
    trackArchived: "トピックをアーカイブしました",
    trackUnarchived: "アーカイブを解除しました",
    showArchived: "アーカイブを表示",
    hideArchived: "戻る",
    noArchivedTracks: "アーカイブされたトピックはありません。",
    wsProject: "プロジェクト",
    projectUnit: "件",
    newProject: "新規プロジェクト",
    searchProjects: "プロジェクトを検索…",
    noProjects: "まだプロジェクトがありません。新規作成しましょう。",
    projectUntitled: "無題のプロジェクト",
    projectNoPath: "ディレクトリ未設定",
    projectNamePlaceholder: "プロジェクト名",
    projectPath: "ローカルディレクトリ",
    projectPathPlaceholder: "/Users/you/code/my-project",
    projectGitUrl: "Git URL",
    projectGitPlaceholder: "https://github.com/you/my-project.git",
    projectDesc: "メモ",
    projectDescPlaceholder: "用途や技術スタックなどをメモ…",
    projectOpenFolder: "フォルダを開く",
    projectOpenTerminal: "ターミナルで開く",
    projectPickHint: "左側からプロジェクトを選ぶか、新規作成してください。",
    projectEmpty: "名前・ディレクトリ・Git URL のいずれかを入力してください",
    projectSaved: "プロジェクトを保存しました",
    projectTagSet: "タグを設定",
    projectTagPlaceholder: "カンマ区切り、例：仕事, 重要",
    projectDeleted: "プロジェクトを削除しました",
    wsBook: "読書",
    bookUnit: "冊",
    newBook: "本を追加",
    searchBooks: "書名 / 著者を検索…",
    noBooks: "まだ記録がありません。追加して始めましょう。",
    untitledBook: "無題の本",
    bookTitlePlaceholder: "書名",
    bookAuthor: "著者",
    bookAuthorPlaceholder: "著者",
    bookCover: "表紙",
    bookCoverHint: "クリックでローカル画像をアップロード",
    bookCoverUrl: "表紙URL",
    bookCoverUpload: "画像をアップロード",
    bookCoverView: "画像を表示",
    bookCoverUrlPlaceholder: "画像URLを貼り付け",
    bookCoverUploading: "表紙をアップロード中…",
    bookIntro: "紹介",
    bookIntroPlaceholder: "この本の内容…",
    bookStatus: "状態",
    bookStatusWant: "未読",
    bookStatusReading: "読書中",
    bookStatusFinished: "読了",
    bookStart: "開始",
    bookEnd: "読了",
    bookRating: "評価",
    bookThoughts: "感想",
    bookThoughtsPlaceholder: "学び・感想…",
    bookExcerpts: "抜粋",
    bookExcerptPlaceholder: "心に残った一節…",
    bookExcerptPage: "ページ",
    bookExcerptAdd: "追加",
    bookExcerptUnit: "件の抜粋",
    bookAllAuthors: "すべての著者",
    bookSaved: "本を保存しました",
    bookDeleted: "本を削除しました",
    bookPickHint: "左から本を選ぶか、追加して始めましょう。",
    wsInbox: "受信箱",
    inboxUnit: "件",
    inboxUnread: "未読",
    inboxRefresh: "更新",
    searchInbox: "受信箱を検索…",
    noInbox: "受信箱は空です。Claude / Codex から送ってみましょう。",
    noArchivedInbox: "アーカイブされた項目はありません。",
    inboxArchive: "アーカイブ",
    inboxUnarchive: "アーカイブ解除",
    inboxArchived: "アーカイブしました",
    inboxUnarchived: "アーカイブを解除しました",
    inboxUntitled: "無題",
    inboxPickHint: "左から記録を選ぶか、下のいずれかの方法で Claude / Codex から送信してください。",
    inboxConnectCliLabel: "CLI（最も簡単 — エージェントにコマンドを実行させる）",
    inboxConnectMcpClaude: "MCP · Claude Code（~/.claude.json またはプロジェクトの .mcp.json に追加）",
    inboxConnectMcpCodex: "MCP · Codex（~/.codex/config.toml に追加）",
    inboxConnectNote: "MCP を設定すると、Claude / Codex が「AbraTab に保存」をツールとして自動的に呼び出します。毎回コマンドを入力する必要はありません。",
    inboxMarkRead: "既読にする",
    inboxMarkUnread: "未読にする",
    inboxCopy: "コピー",
    inboxCopied: "コピーしました",
    inboxDeleted: "削除しました",
    inboxNew: "新規",
    inboxNewTitle: "タイトル（任意）",
    inboxNewBody: "メモを入力…（⌘/Ctrl+Enter で保存）",
    inboxAdded: "追加しました",
    inboxEdit: "編集",
    inboxSaved: "保存しました",
    inboxFormatText: "テキスト",
    inboxEmptyBody: "内容を入力してください",
  },
} as const;

function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<LibraryView>("all");
  const [defaultWorkspace, setDefaultWorkspace] = useState<Workspace>(readDefaultWorkspace);
  const [weeklogTemplate, setWeeklogTemplate] = useState<WeeklogTemplate>(readWeeklogTemplate);
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
  const [windowWidth, setWindowWidth] = useState("");
  const [windowHeight, setWindowHeight] = useState("");
  const [alwaysOnTop, setAlwaysOnTop] = useState(readAlwaysOnTop);
  const [titleBarStyle, setTitleBarStyle] = useState<TitleBarPref>(readTitleBarStyle);
  const [autostart, setAutostart] = useState(false);
  const [lockConfigured, setLockConfigured] = useState(false);
  const [lockCur, setLockCur] = useState("");
  const [lockNew, setLockNew] = useState("");
  const [lockNew2, setLockNew2] = useState("");
  const [lockMsg, setLockMsg] = useState("");
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
  const [giteeSyncing, setGiteeSyncing] = useState<"push" | "pull" | null>(null);
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

  // Cmd/Ctrl+, toggles Settings (macOS Preferences convention); Escape closes it.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setSettingsOpen((open) => !open);
      } else if (event.key === "Escape") {
        setSettingsOpen((open) => (open ? false : open));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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
    if (settingsOpen && settingsTab === "security") {
      setLockCur("");
      setLockNew("");
      setLockNew2("");
      setLockMsg("");
      invoke<{ configured: boolean }>("lock_state")
        .then((state) => setLockConfigured(state.configured))
        .catch(showError);
    }
  }, [settingsOpen, settingsTab]);

  async function saveLockPassword() {
    if (!lockNew) {
      setLockMsg(text.lockEmpty);
      return;
    }
    if (lockNew !== lockNew2) {
      setLockMsg(text.lockMismatch);
      return;
    }
    try {
      if (lockConfigured) {
        const ok = await invoke<boolean>("verify_master_password", { password: lockCur });
        if (!ok) {
          setLockMsg(text.lockWrong);
          return;
        }
      }
      await invoke("set_master_password", { password: lockNew });
      setLockConfigured(true);
      setLockCur("");
      setLockNew("");
      setLockNew2("");
      setLockMsg(text.lockSaved);
    } catch (error) {
      setLockMsg(error instanceof Error ? error.message : String(error));
    }
  }

  async function removeLockPassword() {
    try {
      const ok = await invoke<boolean>("verify_master_password", { password: lockCur });
      if (!ok) {
        setLockMsg(text.lockWrong);
        return;
      }
      await invoke("clear_master_password");
      setLockConfigured(false);
      setLockCur("");
      setLockNew("");
      setLockNew2("");
      setLockMsg(text.lockPasswordRemoved);
    } catch (error) {
      setLockMsg(error instanceof Error ? error.message : String(error));
    }
  }

  // Populate the width/height inputs with the live window size when the Window tab opens.
  useEffect(() => {
    if (!settingsOpen || settingsTab !== "window") return;
    void (async () => {
      const win = getCurrentWindow();
      const size = (await win.innerSize()).toLogical(await win.scaleFactor());
      setWindowWidth(String(Math.round(size.width)));
      setWindowHeight(String(Math.round(size.height)));
    })().catch(showError);
  }, [settingsOpen, settingsTab]);

  async function applyWindowSize() {
    const width = Math.round(Number(windowWidth));
    const height = Math.round(Number(windowHeight));
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 940 || height < 620) {
      setStatus(text.windowSizeInvalid);
      return;
    }
    try {
      await getCurrentWindow().setSize(new LogicalSize(width, height));
      setWindowWidth(String(width));
      setWindowHeight(String(height));
      setStatus(text.windowSizeApplied);
    } catch (error) {
      showError(error);
    }
  }

  // Apply saved window preferences on startup and read the OS autostart state.
  useEffect(() => {
    const win = getCurrentWindow();
    void win.setAlwaysOnTop(alwaysOnTop).catch(showError);
    void win.setTitleBarStyle(titleBarStyle).catch(showError);
    invoke<boolean>("get_autostart").then(setAutostart).catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleAlwaysOnTop(next: boolean) {
    setAlwaysOnTop(next);
    writeAlwaysOnTop(next);
    try {
      await getCurrentWindow().setAlwaysOnTop(next);
    } catch (error) {
      showError(error);
    }
  }

  async function changeTitleBarStyle(next: TitleBarPref) {
    setTitleBarStyle(next);
    writeTitleBarStyle(next);
    try {
      await getCurrentWindow().setTitleBarStyle(next);
    } catch (error) {
      showError(error);
    }
  }

  async function toggleAutostart(next: boolean) {
    try {
      await invoke("set_autostart", { enabled: next });
      setAutostart(next);
    } catch (error) {
      showError(error);
    }
  }

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
    setGiteeMessage("");
    setGiteeSyncing("push");
    try {
      const result = await invoke<{ gist_id: string } & SyncCounts>("push_gitee_sync");
      setGiteeGistId(result.gist_id);
      setGiteeMessage(`${text.giteePushed}: ${syncBreakdown(result, text)}`);
    } finally {
      setGiteeSyncing(null);
      void refreshGiteeStatus().catch(() => {});
    }
  }

  async function pullGiteeSync() {
    setGiteeMessage("");
    setGiteeSyncing("pull");
    try {
      const result = await invoke<GiteePullResult>("pull_gitee_sync");
      const { inserted, updated, skipped } = result.imported;
      setGiteeMessage(`${text.giteePulled}: +${inserted}, ~${updated}, =${skipped}`);
      await refresh();
    } finally {
      setGiteeSyncing(null);
      void refreshGiteeStatus().catch(() => {});
    }
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
          weeklogTemplate={weeklogTemplate}
        />
      ) : workspace === "journal" && journalMode === "project" ? (
        <ProjectWorkspace
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
      ) : workspace === "journal" && journalMode === "inbox" ? (
        <InboxWorkspace
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
      ) : workspace === "journal" && journalMode === "book" ? (
        <BookWorkspace
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
            <h1>{text.appName}</h1>
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

      <section
        className="editor-panel"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            void save().catch(showError);
          }
        }}
      >
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
            <button className="snippet-save" title={text.save} onClick={() => void save().catch(showError)}>
              <Check size={14} />
              <span>{text.save}</span>
            </button>
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
                  <SettingRow title={text.weeklogTemplate} detail={text.weeklogTemplateDetail}>
                    <div className="segmented">
                      <button
                        className={weeklogTemplate === "blank" ? "selected" : ""}
                        onClick={() => {
                          setWeeklogTemplate("blank");
                          writeWeeklogTemplate("blank");
                        }}
                      >
                        {text.weeklogTemplateBlank}
                      </button>
                      <button
                        className={weeklogTemplate === "paged" ? "selected" : ""}
                        onClick={() => {
                          setWeeklogTemplate("paged");
                          writeWeeklogTemplate("paged");
                        }}
                      >
                        {text.weeklogTemplatePaged}
                      </button>
                      <button
                        className={weeklogTemplate === "blocks" ? "selected" : ""}
                        onClick={() => {
                          setWeeklogTemplate("blocks");
                          writeWeeklogTemplate("blocks");
                        }}
                      >
                        {text.weeklogTemplateBlocks}
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
                  <SettingRow title={text.windowSize} detail={text.windowSizeDetail}>
                    <div className="window-size-control">
                      <input
                        type="number"
                        className="window-size-input"
                        value={windowWidth}
                        min={940}
                        onChange={(event) => setWindowWidth(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void applyWindowSize();
                        }}
                      />
                      <span className="window-size-x">×</span>
                      <input
                        type="number"
                        className="window-size-input"
                        value={windowHeight}
                        min={620}
                        onChange={(event) => setWindowHeight(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void applyWindowSize();
                        }}
                      />
                      <button className="settings-action" onClick={() => void applyWindowSize()}>
                        {text.windowSizeApply}
                      </button>
                    </div>
                  </SettingRow>
                  <SettingRow title={text.launchAtLogin} detail={text.launchAtLoginDetail}>
                    <label className="settings-switch">
                      <input
                        type="checkbox"
                        checked={autostart}
                        onChange={(event) => void toggleAutostart(event.target.checked)}
                      />
                      <span />
                    </label>
                  </SettingRow>
                  <SettingRow title={text.alwaysOnTop} detail={text.alwaysOnTopDetail}>
                    <label className="settings-switch">
                      <input
                        type="checkbox"
                        checked={alwaysOnTop}
                        onChange={(event) => void toggleAlwaysOnTop(event.target.checked)}
                      />
                      <span />
                    </label>
                  </SettingRow>
                  <SettingRow title={text.windowChrome} detail={text.windowChromeDetail}>
                    <div className="segmented">
                      <button
                        className={titleBarStyle === "overlay" ? "selected" : ""}
                        onClick={() => void changeTitleBarStyle("overlay")}
                      >
                        {text.overlay}
                      </button>
                      <button
                        className={titleBarStyle === "visible" ? "selected" : ""}
                        onClick={() => void changeTitleBarStyle("visible")}
                      >
                        {text.native}
                      </button>
                    </div>
                  </SettingRow>
                </div>
              ) : null}

              {settingsTab === "security" ? (
                <div className="settings-section">
                  <div className="lock-settings">
                    <p className="lock-settings-help">{text.lockSecurityHelp}</p>
                    {lockConfigured ? (
                      <div className="lock-status-row">
                        <Lock size={14} />
                        {text.lockConfigured}
                      </div>
                    ) : null}
                    {lockConfigured ? (
                      <input
                        type="password"
                        className="lock-input"
                        value={lockCur}
                        onChange={(event) => setLockCur(event.target.value)}
                        placeholder={text.lockCurrentPlaceholder}
                      />
                    ) : null}
                    <input
                      type="password"
                      className="lock-input"
                      value={lockNew}
                      onChange={(event) => setLockNew(event.target.value)}
                      placeholder={lockConfigured ? text.lockNewPlaceholder : text.lockPasswordPlaceholder}
                    />
                    <input
                      type="password"
                      className="lock-input"
                      value={lockNew2}
                      onChange={(event) => setLockNew2(event.target.value)}
                      placeholder={text.lockConfirmPlaceholder}
                    />
                    <div className="lock-settings-actions">
                      <button className="settings-action" onClick={() => void saveLockPassword()}>
                        {lockConfigured ? text.lockChangePassword : text.lockSetPassword}
                      </button>
                      {lockConfigured ? (
                        <button className="settings-action muted" onClick={() => void removeLockPassword()}>
                          {text.lockRemovePassword}
                        </button>
                      ) : null}
                    </div>
                    {lockMsg ? <div className="lock-settings-msg">{lockMsg}</div> : null}
                  </div>
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
                      disabled={(!giteeToken.trim() && !giteeStatus?.configured) || giteeSyncing !== null}
                      onClick={() => void saveGiteeSyncConfig().catch(showError)}
                    >
                      <Check size={14} />
                      <span>{text.giteeSave}</span>
                    </button>
                    <button
                      className="settings-action"
                      disabled={!giteeStatus?.configured || giteeSyncing !== null}
                      onClick={() => void pushGiteeSync().catch(showError)}
                    >
                      <Upload size={14} />
                      <span>{giteeSyncing === "push" ? text.giteePushing : text.giteePush}</span>
                    </button>
                    <button
                      className="settings-action muted"
                      disabled={!giteeStatus?.configured || !giteeGistId.trim() || giteeSyncing !== null}
                      onClick={() => void pullGiteeSync().catch(showError)}
                    >
                      <Download size={14} />
                      <span>{giteeSyncing === "pull" ? text.giteePulling : text.giteePull}</span>
                    </button>
                  </div>

                  {giteeSyncing ? (
                    <div className="sync-progress" role="progressbar" aria-busy="true">
                      <div className="sync-progress-bar" />
                    </div>
                  ) : null}

                  {giteeStatus?.last_sync ? (
                    <div className={`sync-log ${giteeStatus.last_sync.ok ? "ok" : "fail"}`}>
                      {giteeStatus.last_sync.ok ? <Check size={12} /> : <X size={12} />}
                      <span>
                        {giteeStatus.last_sync.action === "pull" ? text.giteePull : text.giteePush}
                        {" · "}
                        {formatSyncTime(giteeStatus.last_sync.at, locale)}
                        {" · "}
                        {giteeStatus.last_sync.ok
                          ? `${text.giteeSyncOk} · ${syncBreakdown(giteeStatus.last_sync, text)}`
                          : `${text.giteeSyncFail}: ${giteeStatus.last_sync.message}`}
                      </span>
                    </div>
                  ) : null}

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

// Compact one-month activity heatmap shown at the bottom of the journal nav.
function JournalHeatmap({ locale }: { locale: Locale }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Months offset from the current month: 0 = this month, -1 = last month, …
  const [offset, setOffset] = useState(0);

  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  const ymd = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const year = base.getFullYear();
  const month = base.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const start = ymd(first);
  const end = ymd(last);

  useEffect(() => {
    invoke<DayActivity[]>("journal_activity", { start, end })
      .then((rows) => setCounts(Object.fromEntries(rows.map((row) => [row.date, row.count]))))
      .catch(() => {});
  }, [start, end]);

  const daysInMonth = last.getDate();
  const leading = (first.getDay() + 6) % 7; // Monday-first column offset
  const cells: Array<{ date: string; day: number; count: number } | null> = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${year}-${pad(month + 1)}-${pad(day)}`;
    cells.push({ date, day, count: counts[date] ?? 0 });
  }

  const todayStr = ymd(now);
  const monthLabel = new Intl.DateTimeFormat(localeTags[locale], {
    year: "numeric",
    month: "long",
  }).format(base);
  // Monday-first weekday labels, localized (Jan 1 2024 was a Monday).
  const weekdayFmt = new Intl.DateTimeFormat(localeTags[locale], { weekday: "narrow" });
  const weekdays = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(2024, 0, 1 + i)));

  const level = (count: number) => {
    if (count <= 0) return 0;
    if (count === 1) return 1;
    if (count <= 3) return 2;
    if (count <= 5) return 3;
    return 4;
  };

  return (
    <div className="nav-heatmap">
      <div className="heatmap-head">
        <div className="heatmap-monthnav">
          <button type="button" onClick={() => setOffset((value) => value - 1)} title="←">
            <ChevronLeft size={13} />
          </button>
          <button type="button" className="heatmap-month" onClick={() => setOffset(0)}>
            {monthLabel}
          </button>
          <button
            type="button"
            onClick={() => setOffset((value) => value + 1)}
            disabled={offset >= 0}
            title="→"
          >
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
      <div className="heatmap-weekdays" aria-hidden="true">
        {weekdays.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>
      <div className="heatmap-grid">
        {cells.map((cell, index) =>
          cell ? (
            <div
              key={cell.date}
              className={`heatmap-cell ${cell.date === todayStr ? "today" : ""}`}
              data-level={level(cell.count)}
              title={`${cell.date} · ${cell.count}`}
            >
              {cell.day}
            </div>
          ) : (
            <div key={`blank-${index}`} className="heatmap-cell empty" />
          ),
        )}
      </div>
    </div>
  );
}

// Lightweight calendar date picker (no external deps), styled to match the app.
function DatePicker({
  value,
  onChange,
  locale,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  locale: Locale;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const intl = localeTags[locale];

  const pad = (n: number) => String(n).padStart(2, "0");
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (v: string): Date | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
  };

  const selected = parse(value);
  const ref = selected ?? new Date();
  const view = new Date(ref.getFullYear(), ref.getMonth() + offset, 1);
  const year = view.getFullYear();
  const month = view.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const todayStr = ymd(new Date());

  const weekdayFmt = new Intl.DateTimeFormat(intl, { weekday: "narrow" });
  const weekdays = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(2024, 0, 1 + i)));
  const monthLabel = new Intl.DateTimeFormat(intl, { year: "numeric", month: "long" }).format(view);
  const displayLabel = selected
    ? new Intl.DateTimeFormat(intl, { year: "numeric", month: "numeric", day: "numeric" }).format(selected)
    : "";

  const cells: Array<number | null> = [];
  for (let i = 0; i < leading; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

  function pick(day: number) {
    onChange(ymd(new Date(year, month, day)));
    setOpen(false);
    setOffset(0);
  }

  return (
    <div className="datepicker">
      <button
        type="button"
        className={`datepicker-input ${selected ? "" : "empty"}`}
        onClick={() => {
          setOffset(0);
          setOpen((o) => !o);
        }}
      >
        <CalendarDays size={13} />
        <span>{displayLabel || placeholder || ""}</span>
        {selected ? (
          <span
            className="datepicker-clear"
            role="button"
            onClick={(event) => {
              event.stopPropagation();
              onChange("");
              setOpen(false);
            }}
          >
            <X size={12} />
          </span>
        ) : null}
      </button>
      {open ? (
        <>
          <div className="context-backdrop" onClick={() => setOpen(false)} />
          <div className="datepicker-pop">
            <div className="datepicker-head">
              <button type="button" onClick={() => setOffset((v) => v - 1)}>
                <ChevronLeft size={14} />
              </button>
              <span>{monthLabel}</span>
              <button type="button" onClick={() => setOffset((v) => v + 1)}>
                <ChevronRight size={14} />
              </button>
            </div>
            <div className="datepicker-week">
              {weekdays.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>
            <div className="datepicker-grid">
              {cells.map((d, i) =>
                d === null ? (
                  <span key={`blank-${i}`} className="datepicker-cell empty" />
                ) : (
                  <button
                    key={d}
                    type="button"
                    className={`datepicker-cell ${ymd(new Date(year, month, d)) === value ? "selected" : ""} ${
                      ymd(new Date(year, month, d)) === todayStr ? "today" : ""
                    }`}
                    onClick={() => pick(d)}
                  >
                    {d}
                  </button>
                ),
              )}
            </div>
          </div>
        </>
      ) : null}
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
    { id: "inbox", label: text.wsInbox, Icon: Inbox },
    { id: "weeklog", label: text.wsWeeklog, Icon: CalendarDays },
    { id: "track", label: text.wsTrack, Icon: Activity },
    { id: "project", label: text.wsProject, Icon: FolderGit2 },
    { id: "book", label: text.wsBook, Icon: BookOpen },
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
  weeklogTemplate,
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
  weeklogTemplate: WeeklogTemplate;
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; log: WeekLog } | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [dayIndex, setDayIndex] = useState(0);
  const [lockedIds, setLockedIds] = useState<Set<string>>(() => new Set());
  const [unlocked, setUnlocked] = useState(false);
  const [pwdDialog, setPwdDialog] = useState<{
    title: string;
    confirm: boolean;
    onSubmit: (password: string) => void | Promise<void>;
  } | null>(null);
  const [pwdValue, setPwdValue] = useState("");
  const [pwdValue2, setPwdValue2] = useState("");
  const [pwdError, setPwdError] = useState("");

  const intl = localeTags[locale];

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  // Day-paging derivations. A note splits into per-day pages only when it
  // actually contains day-label lines; otherwise it is edited as one whole body.
  const editingLog = logs.find((log) => log.id === selectedId) ?? null;
  const dayLabels = form ? weekLabels(editingLog?.created_at) : [];
  const dayParsed = form
    ? splitDays(form.body, dayLabels)
    : { found: false, contents: [] as string[] };
  const framed = !!form && dayParsed.found && !showPreview;
  const paged = framed && weeklogTemplate === "paged";
  const blocks = framed && weeklogTemplate === "blocks";
  const dayContent = paged ? dayParsed.contents[dayIndex] ?? "" : form?.body ?? "";

  // Insert text at the caret of the currently-edited text (a single day's
  // content when paging, else the whole body), keeping the caret after it.
  function insertAtCursor(snippet: string) {
    const el = textareaRef.current;
    setForm((current) => {
      if (!current) return current;
      const moveCaret = (start: number) => {
        if (!el) return;
        const caret = start + snippet.length;
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(caret, caret);
        });
      };
      if (paged) {
        const contents = splitDays(current.body, dayLabels).contents.slice();
        const content = contents[dayIndex] ?? "";
        const start = el ? el.selectionStart : content.length;
        const end = el ? el.selectionEnd : content.length;
        contents[dayIndex] = content.slice(0, start) + snippet + content.slice(end);
        moveCaret(start);
        return { ...current, body: joinDays(dayLabels, contents) };
      }
      const body = current.body;
      const start = el ? el.selectionStart : body.length;
      const end = el ? el.selectionEnd : body.length;
      moveCaret(start);
      return { ...current, body: body.slice(0, start) + snippet + body.slice(end) };
    });
  }

  // Write back edited text: one day's content when paging, else the whole body.
  function setDayContent(next: string) {
    setForm((current) => {
      if (!current) return current;
      if (!paged) return { ...current, body: next };
      const contents = splitDays(current.body, dayLabels).contents.slice();
      contents[dayIndex] = next;
      return { ...current, body: joinDays(dayLabels, contents) };
    });
  }

  // Blocks mode: write back a specific day's content by index.
  function setDayContentAt(index: number, next: string) {
    setForm((current) => {
      if (!current) return current;
      const contents = splitDays(current.body, dayLabels).contents.slice();
      contents[index] = next;
      return { ...current, body: joinDays(dayLabels, contents) };
    });
  }

  // Blocks mode: paste an image into a specific day's block.
  async function handleBlockPaste(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
    index: number,
  ) {
    const file = clipboardImage(event);
    if (!file) return;
    event.preventDefault();
    const el = event.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    setUploading(true);
    setStatus(text.weeklogImageUploading);
    try {
      const data = await fileToBase64(file);
      const result = await invoke<UploadResult>("upload_image", {
        filename: imageFilename(file),
        data,
      });
      const snippet = `![](${result.url})\n`;
      setForm((current) => {
        if (!current) return current;
        const contents = splitDays(current.body, dayLabels).contents.slice();
        const content = contents[index] ?? "";
        contents[index] = content.slice(0, start) + snippet + content.slice(end);
        return { ...current, body: joinDays(dayLabels, contents) };
      });
      setStatus(text.weeklogImageUploaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(/not configured/i.test(message) ? text.weeklogImageNotConfigured : message);
    } finally {
      setUploading(false);
    }
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

  const isLocked = (id: string) => lockedIds.has(id);

  async function refreshLock() {
    const state = await invoke<{ configured: boolean; locked_ids: string[] }>("lock_state");
    setLockedIds(new Set(state.locked_ids));
  }

  useEffect(() => {
    void refreshLock().catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function askPassword(
    title: string,
    confirm: boolean,
    onSubmit: (password: string) => void | Promise<void>,
  ) {
    setPwdValue("");
    setPwdValue2("");
    setPwdError("");
    setPwdDialog({ title, confirm, onSubmit });
  }

  async function submitPassword() {
    if (!pwdDialog) return;
    if (!pwdValue) {
      setPwdError(text.lockEmpty);
      return;
    }
    if (pwdDialog.confirm && pwdValue !== pwdValue2) {
      setPwdError(text.lockMismatch);
      return;
    }
    try {
      await pwdDialog.onSubmit(pwdValue);
      setPwdDialog(null);
    } catch (error) {
      setPwdError(error instanceof Error ? error.message : String(error));
    }
  }

  function lockRecord(log: WeekLog) {
    setContextMenu(null);
    void (async () => {
      const state = await invoke<{ configured: boolean }>("lock_state");
      if (!state.configured) {
        setStatus(text.lockNeedSetup);
        return;
      }
      await invoke("set_week_log_locked", { id: log.id, locked: true });
      setUnlocked(true);
      await refreshLock();
      setStatus(text.lockLocked);
    })().catch(showError);
  }

  function removeLock(log: WeekLog) {
    setContextMenu(null);
    const doRemove = async () => {
      await invoke("set_week_log_locked", { id: log.id, locked: false });
      await refreshLock();
      setStatus(text.lockRemoved);
    };
    if (unlocked) {
      void doRemove().catch(showError);
      return;
    }
    askPassword(text.lockEnterMaster, false, async (password) => {
      const ok = await invoke<boolean>("verify_master_password", { password });
      if (!ok) throw new Error(text.lockWrong);
      setUnlocked(true);
      await doRemove();
    });
  }

  function unlockSession() {
    askPassword(text.lockEnterMaster, false, async (password) => {
      const ok = await invoke<boolean>("verify_master_password", { password });
      if (!ok) throw new Error(text.lockWrong);
      setUnlocked(true);
    });
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
    setDayIndex(todayDayIndex(log.created_at));
  }

  // The 7 Mon→Sun day labels (e.g. "6月29日 周一") for the week containing `ref`.
  function weekLabels(refIso?: string): string[] {
    const ref = (refIso && parseDate(refIso)) || new Date();
    const monday = new Date(
      ref.getFullYear(),
      ref.getMonth(),
      ref.getDate() - ((ref.getDay() + 6) % 7),
    );
    const dayFmt = new Intl.DateTimeFormat(intl, { month: "long", day: "numeric" });
    const weekdayFmt = new Intl.DateTimeFormat(intl, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
      return `${dayFmt.format(d)} ${weekdayFmt.format(d)}`;
    });
  }

  // This week's Mon→Sun frame: one day label per line, a blank line between days.
  function buildWeekFrame(): string {
    return weekLabels()
      .map((label) => `${label}\n`)
      .join("\n");
  }

  // Split a note body into each day's content by matching day-label lines.
  // `found` is false for free-form / legacy notes (no label line) → no paging.
  function splitDays(body: string, labels: string[]): { found: boolean; contents: string[] } {
    const buffers: string[][] = labels.map(() => []);
    let current = -1;
    let found = false;
    for (const line of body.split("\n")) {
      const idx = labels.indexOf(line.trim());
      if (idx >= 0) {
        current = idx;
        found = true;
        continue;
      }
      if (current >= 0) buffers[current].push(line);
    }
    const contents = buffers.map((lines) => lines.join("\n").replace(/^\n+|\n+$/g, ""));
    return { found, contents };
  }

  // Reassemble per-day contents back into a single body.
  function joinDays(labels: string[], contents: string[]): string {
    return labels
      .map((label, i) => (contents[i]?.trim() ? `${label}\n${contents[i]}` : label))
      .join("\n\n");
  }

  // Index of today within `ref`'s week, or 0 when today is outside that week.
  function todayDayIndex(refIso?: string): number {
    const labels = weekLabels(refIso);
    const t = new Date();
    const dayFmt = new Intl.DateTimeFormat(intl, { month: "long", day: "numeric" });
    const weekdayFmt = new Intl.DateTimeFormat(intl, { weekday: "short" });
    const idx = labels.indexOf(`${dayFmt.format(t)} ${weekdayFmt.format(t)}`);
    return idx >= 0 ? idx : 0;
  }

  function newNote(template: WeeklogTemplate = weeklogTemplate) {
    setSelectedId(null);
    setNewMenuOpen(false);
    setDayIndex(todayDayIndex());
    setForm({ title: "", body: template === "blank" ? "" : buildWeekFrame() });
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

  // Cmd/Ctrl+P toggles preview/edit while a weeklog is open.
  useEffect(() => {
    if (!form) return;
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setShowPreview((value) => !value);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [form != null]);

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
            <h1>{text.appName}</h1>
            <p>{logs.length} {text.wsWeeklogUnit}</p>
          </div>
        </div>

        <WorkspaceToggle workspace={workspace} setWorkspace={setWorkspace} text={text} />

        <div className="nav-scroll">
          <JournalModeNav mode={mode} setMode={setMode} text={text} />
        </div>

        <JournalHeatmap locale={locale} />

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
          <div className="weeklog-new">
            <button className="add-button" onClick={() => newNote()} title={text.newWeeklog}>
              <CalendarPlus size={17} />
            </button>
            <button
              className="add-button add-caret"
              onClick={() => setNewMenuOpen((value) => !value)}
              title={text.weeklogNewOptions}
            >
              <ChevronDown size={13} />
            </button>
            {newMenuOpen ? (
              <>
                <div className="context-backdrop" onClick={() => setNewMenuOpen(false)} />
                <div className="weeklog-new-menu">
                  <button onClick={() => newNote("blank")}>{text.weeklogTemplateBlank}</button>
                  <button onClick={() => newNote("paged")}>{text.weeklogTemplatePaged}</button>
                  <button onClick={() => newNote("blocks")}>{text.weeklogTemplateBlocks}</button>
                </div>
              </>
            ) : null}
          </div>
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
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setContextMenu({ x: event.clientX, y: event.clientY, log });
                  }}
                >
                  <div className="snippet-title-row">
                    <span className="snippet-title">
                      {isLocked(log.id) ? <Lock className="weeklog-lock" size={12} /> : null}
                      {log.title.trim() || dateLabel(log.created_at) || text.wsWeeklog}
                    </span>
                    {log.favorite ? <Star className="weeklog-star" size={13} fill="currentColor" /> : null}
                  </div>
                  <div className="snippet-meta">
                    <span className="folder-meta">
                      <CalendarRange size={11} />
                      {dateLabel(log.created_at)}
                    </span>
                  </div>
                  {log.body.trim() ? (
                    <div className={`weeklog-preview ${isLocked(log.id) && !unlocked ? "blurred" : ""}`}>
                      {log.body.trim().split("\n")[0]}
                    </div>
                  ) : null}
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
                title={`${showPreview ? text.weeklogEdit : text.preview} (⌘/Ctrl+P)`}
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
            selected && isLocked(selected.id) && !unlocked ? (
              <div className="weeklog-locked">
                <Lock size={30} />
                <p>{text.lockScreenTitle}</p>
                <button type="button" className="weeklog-save" onClick={unlockSession}>
                  {text.lockUnlock}
                </button>
              </div>
            ) : (
            <>
              <div className="code-card weeklog-card">
                {!blocks ? (
                  <div className="code-top">
                    {paged ? (
                      <span className="weeklog-daynav">
                        <button
                          type="button"
                          className="weeklog-dayarrow"
                          onClick={() => setDayIndex((i) => Math.max(0, i - 1))}
                          disabled={dayIndex === 0}
                        >
                          <ChevronLeft size={14} />
                        </button>
                        <span className="code-label">{dayLabels[dayIndex]}</span>
                        <button
                          type="button"
                          className="weeklog-dayarrow"
                          onClick={() => setDayIndex((i) => Math.min(dayLabels.length - 1, i + 1))}
                          disabled={dayIndex >= dayLabels.length - 1}
                        >
                          <ChevronRight size={14} />
                        </button>
                      </span>
                    ) : (
                      <span className="code-label">{selected ? dateLabel(selected.created_at) : text.newWeeklog}</span>
                    )}
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
                    <span className="line-count">{(paged ? dayContent : form.body).split("\n").length} {text.lines}</span>
                  </div>
                ) : null}
                {showPreview ? (
                  form.body.trim() ? (
                    <div
                      className="weeklog-preview-pane markdown-body"
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(form.body) }}
                    />
                  ) : (
                    <div className="weeklog-preview-pane empty">{text.weeklogPreviewEmpty}</div>
                  )
                ) : blocks ? (
                  <div className="weeklog-blocks">
                    {dayLabels.map((label, blockIndex) => (
                      <div className="weeklog-block" key={label}>
                        <div className="weeklog-block-head">
                          <span className="code-label">{label}</span>
                          <span className="weeklog-hint">
                            <ImagePlus size={12} />
                            {text.weeklogImageHint}
                          </span>
                          <span className="line-count">
                            {(dayParsed.contents[blockIndex] ?? "").split("\n").length} {text.lines}
                          </span>
                        </div>
                        <textarea
                          className="weeklog-block-input"
                          value={dayParsed.contents[blockIndex] ?? ""}
                          rows={Math.max(2, (dayParsed.contents[blockIndex] ?? "").split("\n").length)}
                          onChange={(event) => setDayContentAt(blockIndex, event.target.value)}
                          onPaste={(event) => void handleBlockPaste(event, blockIndex)}
                          placeholder={text.weeklogDayPlaceholder}
                          spellCheck={false}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <textarea
                    ref={textareaRef}
                    className="weeklog-textarea"
                    value={dayContent}
                    onChange={(event) => setDayContent(event.target.value)}
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
            )
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

      {contextMenu ? (
        <>
          <div
            className="context-backdrop"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div className="snippet-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {isLocked(contextMenu.log.id) ? (
              <button onClick={() => removeLock(contextMenu.log)}>
                <Lock size={13} />
                {text.lockRemove}
              </button>
            ) : (
              <button onClick={() => lockRecord(contextMenu.log)}>
                <Lock size={13} />
                {text.lockSet}
              </button>
            )}
          </div>
        </>
      ) : null}

      {pwdDialog ? (
        <div className="prompt-overlay" role="presentation" onMouseDown={() => setPwdDialog(null)}>
          <form
            className="prompt-dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void submitPassword();
            }}
          >
            <h3>{pwdDialog.title}</h3>
            <input
              autoFocus
              type="password"
              value={pwdValue}
              onChange={(event) => setPwdValue(event.target.value)}
              placeholder={text.lockPasswordPlaceholder}
            />
            {pwdDialog.confirm ? (
              <input
                type="password"
                value={pwdValue2}
                onChange={(event) => setPwdValue2(event.target.value)}
                placeholder={text.lockConfirmPlaceholder}
              />
            ) : null}
            {pwdError ? <div className="prompt-error">{pwdError}</div> : null}
            <div className="prompt-actions">
              <button type="button" className="prompt-cancel" onClick={() => setPwdDialog(null)}>
                {text.cancel}
              </button>
              <button type="submit" className="prompt-confirm">
                {text.confirm}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}

// Curated, tidier toolbar for the inbox markdown editor.
const inboxMdCommands = [
  commands.bold,
  commands.italic,
  commands.strikethrough,
  commands.divider,
  commands.title,
  commands.link,
  commands.quote,
  commands.code,
  commands.codeBlock,
  commands.divider,
  commands.image,
  commands.table,
  commands.divider,
  commands.unorderedListCommand,
  commands.orderedListCommand,
  commands.checkedListCommand,
];

const inboxMdExtraCommands = [commands.codeEdit, commands.codePreview];

function InboxWorkspace({
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
  const [items, setItems] = useState<InboxItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [conn, setConn] = useState<InboxConnectionInfo | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeId, setComposeId] = useState<string | null>(null);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeFormat, setComposeFormat] = useState<"markdown" | "text">("markdown");
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: InboxItem } | null>(
    null,
  );

  const intl = localeTags[locale];

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  function openCompose() {
    setComposeId(null);
    setComposeTitle("");
    setComposeBody("");
    setComposeFormat("text");
    setSelectedId(null);
    setComposeOpen(true);
  }

  function startEdit(item: InboxItem) {
    setComposeId(item.id);
    setComposeTitle(item.title);
    setComposeBody(item.body);
    setComposeFormat(item.format === "text" ? "text" : "markdown");
    setComposeOpen(true);
  }

  async function saveCompose() {
    if (!composeBody.trim()) {
      setStatus(text.inboxEmptyBody);
      return;
    }
    const title = composeTitle.trim();
    const body = composeBody.trim();
    try {
      if (composeId) {
        await invoke("update_inbox_item", { id: composeId, title, body, format: composeFormat });
        setComposeOpen(false);
        await refresh();
        setSelectedId(composeId);
        setStatus(text.inboxSaved);
      } else {
        const created = await invoke<InboxItem>("create_inbox_item", { title, body, format: composeFormat });
        setComposeOpen(false);
        await refresh();
        setSelectedId(created.id);
        setStatus(text.inboxAdded);
      }
    } catch (error) {
      showError(error);
    }
  }

  // Paste an image → upload → insert a Markdown link at the caret.
  async function handleImagePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = clipboardImage(event);
    if (!file) return;
    event.preventDefault();
    const textarea = event.currentTarget;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setUploading(true);
    setStatus(text.weeklogImageUploading);
    try {
      const data = await fileToBase64(file);
      const result = await invoke<UploadResult>("upload_image", {
        filename: imageFilename(file),
        data,
      });
      const snippet = `![](${result.url})\n`;
      setComposeBody((value) => value.slice(0, start) + snippet + value.slice(end));
      setStatus(text.weeklogImageUploaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(/not configured/i.test(message) ? text.weeklogImageNotConfigured : message);
    } finally {
      setUploading(false);
    }
  }

  function dateTimeLabel(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(intl, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  }

  const selected = items.find((item) => item.id === selectedId) ?? null;

  async function refresh(nextQuery = query, archived = showArchived) {
    const rows = await invoke<InboxItem[]>("list_inbox_items", {
      query: nextQuery.trim() || null,
      archived,
    });
    setItems(rows);
    return rows;
  }

  function selectItem(item: InboxItem) {
    setComposeOpen(false);
    setSelectedId(item.id);
  }

  // Archive / unarchive an item; it leaves the current view, so re-pick selection.
  async function archiveItem(item: InboxItem, archived: boolean) {
    setContextMenu(null);
    try {
      await invoke("set_inbox_archived", { id: item.id, archived });
      const rows = await refresh();
      setStatus(archived ? text.inboxArchived : text.inboxUnarchived);
      if (item.id === selectedId) setSelectedId(rows[0]?.id ?? null);
    } catch (error) {
      showError(error);
    }
  }

  async function toggleArchivedView() {
    const next = !showArchived;
    setShowArchived(next);
    setContextMenu(null);
    setComposeOpen(false);
    try {
      const rows = await refresh(query, next);
      setSelectedId(rows[0]?.id ?? null);
    } catch (error) {
      showError(error);
    }
  }

  async function remove(item: InboxItem) {
    try {
      await invoke("delete_inbox_item", { id: item.id });
      const rows = await refresh();
      setStatus(text.inboxDeleted);
      if (item.id === selectedId) setSelectedId(rows[0]?.id ?? null);
    } catch (error) {
      showError(error);
    }
  }

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(text.inboxCopied);
    } catch (error) {
      showError(error);
    }
  }

  useEffect(() => {
    void refresh("").catch(showError);
    invoke<InboxConnectionInfo>("inbox_connection_info").then(setConn).catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll so records pushed by Claude/Codex show up without a manual refresh.
  useEffect(() => {
    const timer = setInterval(() => void refresh(query).catch(() => {}), 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const cliPath = conn?.cli_path ?? "abratab-cli";
  const cliSnippet = `${cliPath} inbox "今天完成了 X"`;
  const mcpClaudeSnippet = `{
  "mcpServers": {
    "abratab": {
      "command": "${cliPath}",
      "args": ["mcp"]
    }
  }
}`;
  const mcpCodexSnippet = `[mcp_servers.abratab]
command = "${cliPath}"
args = ["mcp"]`;

  return (
    <>
      <nav className="nav-panel">
        <div className="brand" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="brand-logo">
            <Inbox size={20} />
          </div>
          <div data-tauri-drag-region>
            <h1>{text.appName}</h1>
            <p>{items.length} {text.inboxUnit}</p>
          </div>
        </div>

        <WorkspaceToggle workspace={workspace} setWorkspace={setWorkspace} text={text} />

        <div className="nav-scroll">
          <JournalModeNav mode={mode} setMode={setMode} text={text} />
        </div>

        <JournalHeatmap locale={locale} />

        <div className="nav-foot">
          <button title={text.inboxRefresh} onClick={() => void refresh().catch(showError)}>
            <RotateCcw size={15} />
          </button>
          <span>{text.wsInbox}</span>
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
              placeholder={text.searchInbox}
            />
          </label>
          <button className="add-button" onClick={() => void refresh().catch(showError)} title={text.inboxRefresh}>
            <RotateCcw size={16} />
          </button>
          <button
            className={`add-button ${showArchived ? "archived-on" : ""}`}
            onClick={() => void toggleArchivedView()}
            title={showArchived ? text.hideArchived : text.showArchived}
          >
            {showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
          {!showArchived ? (
            <button className="add-button" onClick={openCompose} title={text.inboxNew}>
              <Plus size={17} />
            </button>
          ) : null}
        </div>

        <div className="snippet-list">
          {items.map((item) => (
            <button
              key={item.id}
              className={`snippet-item ${item.id === selectedId ? "selected" : ""}`}
              onClick={() => void selectItem(item)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, item });
              }}
            >
              <div className="snippet-title-row">
                <span className="snippet-title">
                  {item.title.trim() || item.body.trim().split("\n")[0] || text.inboxUntitled}
                </span>
              </div>
              <div className="snippet-meta">
                <span className="inbox-source">{item.source}</span>
                <span className="folder-meta">{dateTimeLabel(item.created_at)}</span>
              </div>
            </button>
          ))}
          {items.length === 0 ? (
            <div className="empty-list">{showArchived ? text.noArchivedInbox : text.noInbox}</div>
          ) : null}
        </div>
      </section>

      <section className="editor-panel">
        <header className="editor-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="editor-title" data-tauri-drag-region onMouseDown={startWindowDrag}>
            <div className="crumb" data-tauri-drag-region onMouseDown={startWindowDrag}>
              <Inbox size={11} />
              {composeOpen
                ? composeId
                  ? text.inboxEdit
                  : text.inboxNew
                : selected
                ? selected.source
                : text.wsInbox}
            </div>
            <input
              value={composeOpen ? composeTitle : selected?.title ?? ""}
              onChange={(event) => composeOpen && setComposeTitle(event.target.value)}
              placeholder={composeOpen ? text.inboxNewTitle : text.wsInbox}
              disabled={!composeOpen && !selected}
              readOnly={!composeOpen}
            />
          </div>
          <div className="editor-tools">
            {composeOpen ? (
              <>
                <div className="segmented inbox-format-toggle">
                  <button
                    className={composeFormat === "markdown" ? "selected" : ""}
                    onClick={() => setComposeFormat("markdown")}
                  >
                    Markdown
                  </button>
                  <button
                    className={composeFormat === "text" ? "selected" : ""}
                    onClick={() => setComposeFormat("text")}
                  >
                    {text.inboxFormatText}
                  </button>
                </div>
                <button type="button" className="inbox-cancel" onClick={() => setComposeOpen(false)}>
                  {text.cancel}
                </button>
                <button className="snippet-save" onClick={() => void saveCompose()}>
                  <Check size={14} />
                  {text.save}
                </button>
              </>
            ) : selected ? (
              <>
                <button className="icon-button" title={text.inboxEdit} onClick={() => startEdit(selected)}>
                  <Pencil size={16} />
                </button>
                <button className="icon-button" title={text.inboxCopy} onClick={() => void copy(selected.body)}>
                  <Copy size={16} />
                </button>
                <button className="icon-button" title={text.delete} onClick={() => void remove(selected)}>
                  <Trash2 size={16} />
                </button>
              </>
            ) : null}
          </div>
        </header>

        <div className="editor-body">
          {composeOpen ? (
            <div className="inbox-compose-pane" data-color-mode="light">
              {composeFormat === "markdown" ? (
                <>
                  <MDEditor
                    className="inbox-md"
                    value={composeBody}
                    onChange={(value) => setComposeBody(value ?? "")}
                    height="100%"
                    preview="edit"
                    visibleDragbar={false}
                    commands={inboxMdCommands}
                    extraCommands={inboxMdExtraCommands}
                    textareaProps={{
                      placeholder: text.inboxNewBody,
                      onPaste: (event) => void handleImagePaste(event),
                      onKeyDown: (event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                          event.preventDefault();
                          void saveCompose();
                        }
                      },
                    }}
                  />
                  <div className="entry-compose-hint">
                    {uploading ? (
                      text.weeklogImageUploading
                    ) : (
                      <>
                        <ImagePlus size={12} />
                        {text.weeklogImageHint}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <textarea
                  autoFocus
                  className="inbox-text-editor"
                  value={composeBody}
                  onChange={(event) => setComposeBody(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void saveCompose();
                    }
                  }}
                  onPaste={(event) => void handleImagePaste(event)}
                  placeholder={text.inboxNewBody}
                  spellCheck={false}
                />
              )}
            </div>
          ) : selected ? (
            <div className="inbox-detail">
              <div className="inbox-detail-meta">
                <span className="inbox-source">{selected.source}</span>
                <span>{dateTimeLabel(selected.created_at)}</span>
              </div>
              {selected.title.trim() ? <h3 className="inbox-detail-title">{selected.title}</h3> : null}
              {selected.format === "text" ? (
                <div className="inbox-detail-body">{selected.body}</div>
              ) : (
                <div
                  className="inbox-detail-body"
                  data-color-mode="light"
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target instanceof HTMLImageElement) setLightbox(target.src);
                  }}
                >
                  <MDEditor.Markdown source={selected.body} />
                </div>
              )}
            </div>
          ) : (
            <div className="inbox-connect">
              <p className="inbox-connect-lead">{text.inboxPickHint}</p>

              <div className="inbox-connect-block">
                <div className="inbox-connect-head">
                  <span>{text.inboxConnectCliLabel}</span>
                  <button className="settings-action" onClick={() => void copy(cliSnippet)}>
                    <Copy size={13} />
                    {text.inboxCopy}
                  </button>
                </div>
                <pre className="inbox-code">{cliSnippet}</pre>
              </div>

              <div className="inbox-connect-block">
                <div className="inbox-connect-head">
                  <span>{text.inboxConnectMcpClaude}</span>
                  <button className="settings-action" onClick={() => void copy(mcpClaudeSnippet)}>
                    <Copy size={13} />
                    {text.inboxCopy}
                  </button>
                </div>
                <pre className="inbox-code">{mcpClaudeSnippet}</pre>
              </div>

              <div className="inbox-connect-block">
                <div className="inbox-connect-head">
                  <span>{text.inboxConnectMcpCodex}</span>
                  <button className="settings-action" onClick={() => void copy(mcpCodexSnippet)}>
                    <Copy size={13} />
                    {text.inboxCopy}
                  </button>
                </div>
                <pre className="inbox-code">{mcpCodexSnippet}</pre>
              </div>

              <p className="inbox-connect-note">{text.inboxConnectNote}</p>
            </div>
          )}
        </div>

        <footer className="status-bar">
          <span>
            <Inbox size={13} />
            {items.length} {text.inboxUnit}
          </span>
          <span className="db">
            <Database size={13} />
            {dbPath}
          </span>
          <span className="status">{status ? <Check size={13} /> : null}{status}</span>
        </footer>
      </section>

      {lightbox ? (
        <div className="lightbox" role="presentation" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      ) : null}

      {contextMenu ? (
        <>
          <div
            className="context-backdrop"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div className="snippet-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {contextMenu.item.archived_at ? (
              <button onClick={() => void archiveItem(contextMenu.item, false)}>
                <ArchiveRestore size={13} />
                {text.inboxUnarchive}
              </button>
            ) : (
              <button onClick={() => void archiveItem(contextMenu.item, true)}>
                <Archive size={13} />
                {text.inboxArchive}
              </button>
            )}
          </div>
        </>
      ) : null}
    </>
  );
}

function ProjectWorkspace({
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<ProjectForm | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: Project } | null>(null);
  const [tagDialog, setTagDialog] = useState<Project | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  const selected = projects.find((project) => project.id === selectedId) ?? null;
  const allTags = Array.from(new Set(projects.flatMap((project) => project.tags))).sort();
  const visibleProjects = tagFilter ? projects.filter((project) => project.tags.includes(tagFilter)) : projects;

  function parseTags(value: string): string[] {
    return Array.from(
      new Set(
        value
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
      ),
    );
  }

  function openTagDialog(project: Project) {
    setContextMenu(null);
    setTagInput(project.tags.join(", "));
    setTagDialog(project);
  }

  async function saveTags() {
    if (!tagDialog) return;
    const tags = parseTags(tagInput);
    try {
      await invoke("save_project", {
        input: {
          id: tagDialog.id,
          name: tagDialog.name,
          path: tagDialog.path,
          git_url: tagDialog.git_url,
          description: tagDialog.description,
          tags,
        },
      });
      setTagDialog(null);
      const rows = await refresh();
      if (form?.id === tagDialog.id) setForm((current) => (current ? { ...current, tags } : current));
      if (tagFilter && !rows.some((project) => project.tags.includes(tagFilter))) setTagFilter(null);
    } catch (error) {
      showError(error);
    }
  }

  async function refresh(nextQuery = query) {
    const rows = await invoke<Project[]>("list_projects", { query: nextQuery.trim() || null });
    setProjects(rows);
    return rows;
  }

  function loadIntoForm(project: Project) {
    setSelectedId(project.id);
    setForm({
      id: project.id,
      name: project.name,
      path: project.path,
      git_url: project.git_url,
      description: project.description,
      tags: project.tags,
    });
  }

  function newProject() {
    setSelectedId(null);
    setForm({ name: "", path: "", git_url: "", description: "", tags: [] });
  }

  async function save() {
    if (!form) return;
    if (!form.name.trim() && !form.path.trim() && !form.git_url.trim()) {
      setStatus(text.projectEmpty);
      return;
    }
    try {
      const saved = await invoke<Project>("save_project", {
        input: {
          id: form.id,
          name: form.name.trim() || text.projectUntitled,
          path: form.path.trim(),
          git_url: form.git_url.trim(),
          description: form.description,
          tags: form.tags,
        },
      });
      await refresh();
      loadIntoForm(saved);
      setStatus(text.projectSaved);
    } catch (error) {
      showError(error);
    }
  }

  async function remove() {
    if (!form?.id) return;
    try {
      await invoke("delete_project", { id: form.id });
      const rows = await refresh();
      setStatus(text.projectDeleted);
      if (rows.length) loadIntoForm(rows[0]);
      else {
        setSelectedId(null);
        setForm(null);
      }
    } catch (error) {
      showError(error);
    }
  }

  async function openFolder() {
    const path = form?.path.trim();
    if (!path) return;
    try {
      await invoke("open_path", { path });
    } catch (error) {
      showError(error);
    }
  }

  async function openTerminal() {
    const path = form?.path.trim();
    if (!path) return;
    try {
      await invoke("open_terminal", { path });
    } catch (error) {
      showError(error);
    }
  }

  useEffect(() => {
    void (async () => {
      const rows = await refresh("");
      if (rows.length) loadIntoForm(rows[0]);
    })().catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <nav className="nav-panel">
        <div className="brand" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="brand-logo">
            <FolderGit2 size={20} />
          </div>
          <div data-tauri-drag-region>
            <h1>{text.appName}</h1>
            <p>{projects.length} {text.projectUnit}</p>
          </div>
        </div>

        <WorkspaceToggle workspace={workspace} setWorkspace={setWorkspace} text={text} />

        <div className="nav-scroll">
          <JournalModeNav mode={mode} setMode={setMode} text={text} />
        </div>

        <JournalHeatmap locale={locale} />

        <div className="nav-foot">
          <button title={text.newProject} onClick={() => newProject()}>
            <Plus size={15} />
          </button>
          <span>{text.wsProject}</span>
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
              placeholder={text.searchProjects}
            />
          </label>
          <button className="add-button" onClick={() => newProject()} title={text.newProject}>
            <Plus size={17} />
          </button>
        </div>

        {allTags.length > 0 ? (
          <div className="tag-filter">
            {allTags.map((tag) => (
              <button
                key={tag}
                className={`tag-chip ${tagFilter === tag ? "on" : ""}`}
                onClick={() => setTagFilter((current) => (current === tag ? null : tag))}
              >
                {tag}
              </button>
            ))}
          </div>
        ) : null}

        <div className="snippet-list">
          {visibleProjects.map((project) => (
            <button
              key={project.id}
              className={`snippet-item ${project.id === selectedId ? "selected" : ""}`}
              onClick={() => loadIntoForm(project)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, project });
              }}
            >
              <div className="snippet-title-row">
                <span className="snippet-title">{project.name.trim() || text.projectUntitled}</span>
              </div>
              <div className="snippet-meta">
                <span className="folder-meta">
                  <Folder size={11} />
                  {project.path.trim() || text.projectNoPath}
                </span>
              </div>
              {project.tags.length > 0 ? (
                <div className="project-tags">
                  {project.tags.map((tag) => (
                    <span className="project-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </button>
          ))}
          {visibleProjects.length === 0 ? <div className="empty-list">{text.noProjects}</div> : null}
        </div>
      </section>

      <section className="editor-panel">
        <header className="editor-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="editor-title" data-tauri-drag-region onMouseDown={startWindowDrag}>
            <div className="crumb" data-tauri-drag-region onMouseDown={startWindowDrag}>
              <FolderGit2 size={11} />
              {text.wsProject}
            </div>
            <input
              value={form?.name ?? ""}
              onChange={(event) => form && setForm({ ...form, name: event.target.value })}
              placeholder={text.projectNamePlaceholder}
              disabled={!form}
            />
          </div>
          <div className="editor-tools">
            {form?.path.trim() ? (
              <button
                className="icon-button"
                title={text.projectOpenTerminal}
                onClick={() => void openTerminal()}
              >
                <TerminalSquare size={16} />
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
            <div
              className="project-form"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  void save();
                }
              }}
            >
              <div className="project-field">
                <span className="project-field-label">
                  <Folder size={13} />
                  {text.projectPath}
                </span>
                <div className="project-field-row">
                  <input
                    value={form.path}
                    onChange={(event) => setForm({ ...form, path: event.target.value })}
                    placeholder={text.projectPathPlaceholder}
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="project-field-action"
                    title={text.projectOpenFolder}
                    disabled={!form.path.trim()}
                    onClick={() => void openFolder()}
                  >
                    <FolderOpen size={15} />
                  </button>
                </div>
              </div>
              <label className="project-field">
                <span className="project-field-label">
                  <GitBranch size={13} />
                  {text.projectGitUrl}
                </span>
                <input
                  value={form.git_url}
                  onChange={(event) => setForm({ ...form, git_url: event.target.value })}
                  placeholder={text.projectGitPlaceholder}
                  spellCheck={false}
                />
              </label>
              <label className="project-field">
                <span className="project-field-label">
                  <Info size={13} />
                  {text.projectDesc}
                </span>
                <textarea
                  className="project-textarea"
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  placeholder={text.projectDescPlaceholder}
                  spellCheck={false}
                />
              </label>

              <div className="weeklog-actions">
                <button type="button" className="weeklog-save" onClick={() => void save()}>
                  <Check size={14} />
                  {text.save}
                </button>
              </div>
            </div>
          ) : (
            <div className="weeklog-empty-editor">{text.projectPickHint}</div>
          )}
        </div>

        <footer className="status-bar">
          <span>
            <FolderGit2 size={13} />
            {selected ? selected.name.trim() || text.projectUntitled : text.wsProject}
          </span>
          <span className="db">
            <Database size={13} />
            {dbPath}
          </span>
          <span className="status">{status ? <Check size={13} /> : null}{status}</span>
        </footer>
      </section>

      {contextMenu ? (
        <>
          <div
            className="context-backdrop"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div className="snippet-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button onClick={() => openTagDialog(contextMenu.project)}>
              <Tag size={13} />
              {text.projectTagSet}
            </button>
          </div>
        </>
      ) : null}

      {tagDialog ? (
        <div className="prompt-overlay" role="presentation" onMouseDown={() => setTagDialog(null)}>
          <form
            className="prompt-dialog"
            role="dialog"
            aria-modal="true"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void saveTags();
            }}
          >
            <h3>{text.projectTagSet}</h3>
            <input
              autoFocus
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              placeholder={text.projectTagPlaceholder}
            />
            <div className="prompt-actions">
              <button type="button" className="prompt-cancel" onClick={() => setTagDialog(null)}>
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

function BookWorkspace({
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
  const [books, setBooks] = useState<Book[]>([]);
  const [authors, setAuthors] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [authorFilter, setAuthorFilter] = useState<string | null>(null);
  const [form, setForm] = useState<BookForm | null>(null);
  const [excerpts, setExcerpts] = useState<BookExcerpt[]>([]);
  const [newExcerpt, setNewExcerpt] = useState("");
  const [newPage, setNewPage] = useState("");
  const [editingExcerptId, setEditingExcerptId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [editPage, setEditPage] = useState("");
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState(false);
  const [coverMenuOpen, setCoverMenuOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const intl = localeTags[locale];

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  const STATUSES: BookStatus[] = ["want", "reading", "finished"];
  function statusLabel(value: BookStatus) {
    if (value === "reading") return text.bookStatusReading;
    if (value === "finished") return text.bookStatusFinished;
    return text.bookStatusWant;
  }

  function monthLabel(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(intl, { year: "numeric", month: "long" }).format(date);
  }

  // Group books by their added month (newest first), with a header per month.
  const groups = useMemo(() => {
    const sorted = [...books].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const out: Array<{ label: string; items: Book[] }> = [];
    for (const book of sorted) {
      const label = monthLabel(book.created_at) || text.wsBook;
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(book);
      else out.push({ label, items: [book] });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, intl]);

  async function refreshBooks(nextQuery = query, author = authorFilter) {
    const rows = await invoke<Book[]>("list_books", {
      query: nextQuery.trim() || null,
      author: author || null,
    });
    setBooks(rows);
    return rows;
  }

  async function refreshAuthors() {
    setAuthors(await invoke<string[]>("list_book_authors"));
  }

  async function loadExcerpts(bookId: string) {
    setExcerpts(await invoke<BookExcerpt[]>("list_book_excerpts", { bookId }));
  }

  function toForm(book: Book): BookForm {
    return {
      id: book.id,
      title: book.title,
      author: book.author,
      cover_url: book.cover_url,
      intro: book.intro,
      status: book.status,
      rating: book.rating,
      start_date: book.start_date,
      end_date: book.end_date,
      thoughts: book.thoughts,
    };
  }

  async function selectBook(book: Book) {
    setSelectedId(book.id);
    setForm(toForm(book));
    setNewExcerpt("");
    setNewPage("");
    setEditingExcerptId(null);
    await loadExcerpts(book.id);
  }

  useEffect(() => {
    void (async () => {
      const rows = await refreshBooks("");
      await refreshAuthors();
      if (rows.length) await selectBook(rows[0]);
    })().catch(showError);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createBook() {
    try {
      const book = await invoke<Book>("save_book", { input: { status: "want" } });
      await refreshBooks();
      await refreshAuthors();
      await selectBook(book);
    } catch (error) {
      showError(error);
    }
  }

  // Persist the form. Pass a patch for fields saved immediately (status/rating/date/cover).
  async function saveForm(patch?: Partial<BookForm>) {
    const current = form;
    if (!current) return;
    const merged = { ...current, ...patch };
    if (patch) setForm(merged);
    try {
      await invoke<Book>("save_book", {
        input: {
          id: merged.id,
          title: merged.title,
          author: merged.author,
          cover_url: merged.cover_url,
          intro: merged.intro,
          status: merged.status,
          rating: merged.rating,
          start_date: merged.start_date,
          end_date: merged.end_date,
          thoughts: merged.thoughts,
        },
      });
      await refreshBooks();
      await refreshAuthors();
      setStatus(text.bookSaved);
    } catch (error) {
      showError(error);
    }
  }

  async function deleteBook() {
    if (!form?.id) return;
    try {
      await invoke("delete_book", { id: form.id });
      const rows = await refreshBooks();
      await refreshAuthors();
      setStatus(text.bookDeleted);
      if (rows.length) {
        await selectBook(rows[0]);
      } else {
        setSelectedId(null);
        setForm(null);
        setExcerpts([]);
      }
    } catch (error) {
      showError(error);
    }
  }

  async function onCoverFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !form) return;
    setUploading(true);
    setStatus(text.bookCoverUploading);
    try {
      const data = await fileToBase64(file);
      const result = await invoke<UploadResult>("upload_image", {
        filename: imageFilename(file),
        data,
      });
      await saveForm({ cover_url: result.url });
      setCoverMenuOpen(false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(/not configured/i.test(message) ? text.weeklogImageNotConfigured : message);
    } finally {
      setUploading(false);
    }
  }

  function applyAuthor(author: string | null) {
    setAuthorFilter(author);
    void refreshBooks(query, author).catch(showError);
  }

  async function addExcerpt() {
    const body = newExcerpt.trim();
    if (!form?.id || !body) return;
    try {
      await invoke<BookExcerpt>("add_book_excerpt", {
        input: { book_id: form.id, text: body, page: newPage.trim() },
      });
      setNewExcerpt("");
      setNewPage("");
      await loadExcerpts(form.id);
    } catch (error) {
      showError(error);
    }
  }

  function startEditExcerpt(ex: BookExcerpt) {
    setEditingExcerptId(ex.id);
    setEditText(ex.text);
    setEditPage(ex.page);
  }

  async function saveEditExcerpt() {
    const id = editingExcerptId;
    if (!id) return;
    const body = editText.trim();
    setEditingExcerptId(null);
    if (!body) return;
    try {
      await invoke("update_book_excerpt", { id, text: body, page: editPage.trim() });
      if (form?.id) await loadExcerpts(form.id);
    } catch (error) {
      showError(error);
    }
  }

  async function deleteExcerpt(id: string) {
    try {
      await invoke("delete_book_excerpt", { id });
      if (form?.id) await loadExcerpts(form.id);
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
            <h1>{text.appName}</h1>
            <p>{books.length} {text.bookUnit}</p>
          </div>
        </div>

        <WorkspaceToggle workspace={workspace} setWorkspace={setWorkspace} text={text} />

        <div className="nav-scroll">
          <JournalModeNav mode={mode} setMode={setMode} text={text} />
        </div>

        <JournalHeatmap locale={locale} />

        <div className="nav-foot">
          <button title={text.newBook} onClick={() => void createBook()}>
            <Plus size={15} />
          </button>
          <span>{text.wsBook}</span>
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
                void refreshBooks(event.target.value).catch(showError);
              }}
              placeholder={text.searchBooks}
            />
          </label>
          <button className="add-button" onClick={() => void createBook()} title={text.newBook}>
            <Plus size={17} />
          </button>
        </div>

        {authors.length ? (
          <div className="book-authors">
            <button className={!authorFilter ? "on" : ""} onClick={() => applyAuthor(null)}>
              {text.bookAllAuthors}
            </button>
            {authors.map((author) => (
              <button
                key={author}
                className={authorFilter === author ? "on" : ""}
                onClick={() => applyAuthor(author)}
              >
                {author}
              </button>
            ))}
          </div>
        ) : null}

        <div className="snippet-list">
          {groups.map((group) => (
            <React.Fragment key={group.label}>
              <div className="weeklog-group">{group.label}</div>
              {group.items.map((book) => (
                <button
                  key={book.id}
                  className={`snippet-item book-item ${book.id === selectedId ? "selected" : ""}`}
                  onClick={() => void selectBook(book)}
                >
                  <div className="book-thumb">
                    {book.cover_url ? <img src={book.cover_url} alt="" /> : <BookOpen size={16} />}
                  </div>
                  <div className="book-item-main">
                    <span className="snippet-title">{book.title.trim() || text.untitledBook}</span>
                    <div className="book-item-meta">
                      <span className={`book-status book-status-${book.status}`}>
                        {statusLabel(book.status)}
                      </span>
                      {book.author ? <span className="book-item-author">{book.author}</span> : null}
                    </div>
                  </div>
                </button>
              ))}
            </React.Fragment>
          ))}
          {books.length === 0 ? <div className="empty-list">{text.noBooks}</div> : null}
        </div>
      </section>

      <section className="editor-panel">
        <header className="editor-top" data-tauri-drag-region onMouseDown={startWindowDrag}>
          <div className="editor-title" data-tauri-drag-region onMouseDown={startWindowDrag}>
            <div className="crumb" data-tauri-drag-region onMouseDown={startWindowDrag}>
              <BookOpen size={11} />
              {form ? statusLabel(form.status) : text.wsBook}
            </div>
            <input
              value={form?.title ?? ""}
              onChange={(event) => form && setForm({ ...form, title: event.target.value })}
              onBlur={() => void saveForm()}
              placeholder={text.bookTitlePlaceholder}
              disabled={!form}
            />
          </div>
          <div className="editor-tools">
            {form ? (
              <button className="icon-button" title={text.delete} onClick={() => void deleteBook()}>
                <Trash2 size={16} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="editor-body">
          {form ? (
            <div className="book-form">
              <div className="book-form-top">
                <div className="book-cover-col">
                  <div className="book-cover" onClick={() => setCoverMenuOpen(true)}>
                    {form.cover_url ? (
                      <img src={form.cover_url} alt="" />
                    ) : (
                      <div className="book-cover-empty">
                        <ImagePlus size={20} />
                        <span>{uploading ? text.bookCoverUploading : text.bookCoverHint}</span>
                      </div>
                    )}
                    <input
                      ref={coverInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => void onCoverFile(event)}
                    />
                  </div>
                </div>

                <div className="book-fields">
                  <label className="book-field">
                    <span>{text.bookAuthor}</span>
                    <input
                      value={form.author}
                      onChange={(event) => setForm({ ...form, author: event.target.value })}
                      onBlur={() => void saveForm()}
                      placeholder={text.bookAuthorPlaceholder}
                    />
                  </label>

                  <div className="book-field">
                    <span>{text.bookStatus}</span>
                    <div className="segmented">
                      {STATUSES.map((s) => (
                        <button
                          key={s}
                          className={form.status === s ? "selected" : ""}
                          onClick={() => void saveForm({ status: s })}
                        >
                          {statusLabel(s)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="book-dates">
                    <div className="book-field">
                      <span>{text.bookStart}</span>
                      <DatePicker
                        value={form.start_date}
                        onChange={(value) => void saveForm({ start_date: value })}
                        locale={locale}
                        placeholder="—"
                      />
                    </div>
                    <div className="book-field">
                      <span>{text.bookEnd}</span>
                      <DatePicker
                        value={form.end_date}
                        onChange={(value) => void saveForm({ end_date: value })}
                        locale={locale}
                        placeholder="—"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="book-field">
                <span>{text.bookRating}</span>
                <div className="book-rating">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="book-star"
                      onClick={() => void saveForm({ rating: form.rating === n ? 0 : n })}
                    >
                      <Star size={16} fill={n <= form.rating ? "currentColor" : "none"} />
                    </button>
                  ))}
                </div>
              </div>

              <label className="book-field">
                <span>{text.bookIntro}</span>
                <textarea
                  className="book-textarea"
                  value={form.intro}
                  onChange={(event) => setForm({ ...form, intro: event.target.value })}
                  onBlur={() => void saveForm()}
                  placeholder={text.bookIntroPlaceholder}
                  rows={3}
                />
              </label>

              <label className="book-field">
                <span>{text.bookThoughts}</span>
                <textarea
                  className="book-textarea"
                  value={form.thoughts}
                  onChange={(event) => setForm({ ...form, thoughts: event.target.value })}
                  onBlur={() => void saveForm()}
                  placeholder={text.bookThoughtsPlaceholder}
                  rows={4}
                />
              </label>

              <div className="book-field">
                <span>
                  {text.bookExcerpts}
                  {excerpts.length ? ` · ${excerpts.length} ${text.bookExcerptUnit}` : ""}
                </span>
                <div className="book-excerpt-add">
                  <textarea
                    value={newExcerpt}
                    onChange={(event) => setNewExcerpt(event.target.value)}
                    placeholder={text.bookExcerptPlaceholder}
                    rows={2}
                  />
                  <div className="book-excerpt-add-foot">
                    <input
                      className="book-page-input"
                      value={newPage}
                      onChange={(event) => setNewPage(event.target.value)}
                      placeholder={text.bookExcerptPage}
                    />
                    <button
                      type="button"
                      className="snippet-save"
                      onClick={() => void addExcerpt()}
                      disabled={!newExcerpt.trim()}
                    >
                      <Plus size={13} />
                      {text.bookExcerptAdd}
                    </button>
                  </div>
                </div>

                <div className="book-excerpt-list">
                  {excerpts.map((ex) =>
                    editingExcerptId === ex.id ? (
                      <div className="book-excerpt editing" key={ex.id}>
                        <textarea
                          value={editText}
                          onChange={(event) => setEditText(event.target.value)}
                          rows={2}
                          autoFocus
                        />
                        <div className="book-excerpt-add-foot">
                          <input
                            className="book-page-input"
                            value={editPage}
                            onChange={(event) => setEditPage(event.target.value)}
                            placeholder={text.bookExcerptPage}
                          />
                          <button type="button" className="snippet-save" onClick={() => void saveEditExcerpt()}>
                            <Check size={13} />
                            {text.save}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="book-excerpt" key={ex.id}>
                        <div className="book-excerpt-text">{ex.text}</div>
                        <div className="book-excerpt-foot">
                          {ex.page ? <span className="book-excerpt-page">P{ex.page}</span> : <span />}
                          <div className="book-excerpt-actions">
                            <button
                              type="button"
                              className="timeline-action"
                              title={text.editEntry}
                              onClick={() => startEditExcerpt(ex)}
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              type="button"
                              className="timeline-action"
                              title={text.delete}
                              onClick={() => void deleteExcerpt(ex.id)}
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="weeklog-empty-editor">{text.bookPickHint}</div>
          )}
        </div>

        <footer className="status-bar">
          <span>
            <BookOpen size={13} />
            {text.wsBook}
          </span>
          <span className="db">
            <Database size={13} />
            {dbPath}
          </span>
          <span className="status">{status ? <Check size={13} /> : null}{status}</span>
        </footer>
      </section>

      {coverMenuOpen && form ? (
        <div
          className="prompt-overlay"
          role="presentation"
          onMouseDown={() => {
            void saveForm();
            setCoverMenuOpen(false);
          }}
        >
          <div className="book-cover-dialog" onMouseDown={(event) => event.stopPropagation()}>
            <div className="book-cover-actions">
              <button
                type="button"
                className="book-cover-upload"
                onClick={() => coverInputRef.current?.click()}
              >
                <ImagePlus size={13} />
                {uploading ? text.bookCoverUploading : text.bookCoverUpload}
              </button>
              {form.cover_url.trim() ? (
                <button
                  type="button"
                  className="book-cover-upload"
                  onClick={() => {
                    const url = form.cover_url;
                    setCoverMenuOpen(false);
                    setLightbox(url);
                  }}
                >
                  <Eye size={13} />
                  {text.bookCoverView}
                </button>
              ) : null}
            </div>
            <input
              className="book-cover-url"
              value={form.cover_url}
              onChange={(event) => setForm({ ...form, cover_url: event.target.value })}
              placeholder={text.bookCoverUrlPlaceholder}
              autoFocus
            />
            <button
              type="button"
              className="book-cover-save"
              onClick={() => {
                void saveForm();
                setCoverMenuOpen(false);
              }}
            >
              {text.save}
            </button>
          </div>
        </div>
      ) : null}

      {lightbox ? (
        <div className="lightbox" role="presentation" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      ) : null}
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
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const composeRef = useRef<HTMLTextAreaElement | null>(null);
  const editRef = useRef<HTMLTextAreaElement | null>(null);

  const intl = localeTags[locale];

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  // Insert text at the textarea caret, keeping the caret after the inserted text.
  function insertAtCaret(
    ref: React.RefObject<HTMLTextAreaElement | null>,
    setValue: React.Dispatch<React.SetStateAction<string>>,
    snippet: string,
  ) {
    const el = ref.current;
    setValue((value) => {
      const start = el ? el.selectionStart : value.length;
      const end = el ? el.selectionEnd : value.length;
      if (el) {
        const caret = start + snippet.length;
        requestAnimationFrame(() => {
          el.focus();
          el.setSelectionRange(caret, caret);
        });
      }
      return value.slice(0, start) + snippet + value.slice(end);
    });
  }

  // Paste an image → upload to the configured image host → insert a Markdown link.
  async function handleImagePaste(
    event: React.ClipboardEvent<HTMLTextAreaElement>,
    insert: (snippet: string) => void,
  ) {
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
      insert(`![](${result.url})\n`);
      setStatus(text.weeklogImageUploaded);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(/not configured/i.test(message) ? text.weeklogImageNotConfigured : message);
    } finally {
      setUploading(false);
    }
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

  async function refreshTracks(nextQuery = query, archived = showArchived) {
    const rows = await invoke<Track[]>("list_tracks", {
      query: nextQuery.trim() || null,
      archived,
    });
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

  // Archive/unarchive a topic. It leaves the current view either way, so re-pick
  // the selection when the affected topic was the one open in the editor.
  async function archiveTrack(track: Track, archived: boolean) {
    setContextMenu(null);
    try {
      await invoke<Track>("set_track_archived", { id: track.id, archived });
      const rows = await refreshTracks();
      setStatus(archived ? text.trackArchived : text.trackUnarchived);
      if (track.id === selectedId) {
        if (rows.length) {
          await selectTrack(rows[0]);
        } else {
          setSelectedId(null);
          setEntries([]);
          setTitleDraft("");
        }
      }
    } catch (error) {
      showError(error);
    }
  }

  async function toggleArchivedView() {
    const next = !showArchived;
    setShowArchived(next);
    setContextMenu(null);
    try {
      const rows = await refreshTracks(query, next);
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
            <h1>{text.appName}</h1>
            <p>{tracks.length} {text.trackUnit}</p>
          </div>
        </div>

        <WorkspaceToggle workspace={workspace} setWorkspace={setWorkspace} text={text} />

        <div className="nav-scroll">
          <JournalModeNav mode={mode} setMode={setMode} text={text} />
        </div>

        <JournalHeatmap locale={locale} />

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
          <button
            className={`add-button ${showArchived ? "archived-on" : ""}`}
            onClick={() => void toggleArchivedView()}
            title={showArchived ? text.hideArchived : text.showArchived}
          >
            {showArchived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
          </button>
          {!showArchived ? (
            <button className="add-button" onClick={() => void createTrack()} title={text.newTrack}>
              <Plus size={17} />
            </button>
          ) : null}
        </div>

        <div className="snippet-list">
          {tracks.map((track) => (
            <button
              key={track.id}
              className={`snippet-item ${track.id === selectedId ? "selected" : ""}`}
              onClick={() => void selectTrack(track)}
              onContextMenu={(event) => {
                event.preventDefault();
                setContextMenu({ x: event.clientX, y: event.clientY, track });
              }}
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
          {tracks.length === 0 ? (
            <div className="empty-list">{showArchived ? text.noArchivedTracks : text.noTracks}</div>
          ) : null}
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
              <>
                <button
                  type="button"
                  className="snippet-save"
                  onClick={() => void addEntry()}
                  disabled={!newEntry.trim()}
                >
                  <Plus size={14} />
                  {text.addEntry}
                </button>
                <button className="icon-button" title={text.delete} onClick={() => void deleteTrack()}>
                  <Trash2 size={16} />
                </button>
              </>
            ) : null}
          </div>
        </header>

        <div className="editor-body">
          {selectedId ? (
            <>
              <div className="entry-compose">
                <textarea
                  ref={composeRef}
                  value={newEntry}
                  onChange={(event) => setNewEntry(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      void addEntry();
                    }
                  }}
                  onPaste={(event) =>
                    void handleImagePaste(event, (snippet) =>
                      insertAtCaret(composeRef, setNewEntry, snippet),
                    )
                  }
                  placeholder={text.newEntryPlaceholder}
                  spellCheck={false}
                />
                <div className="entry-compose-hint">
                  {uploading ? (
                    text.weeklogImageUploading
                  ) : (
                    <>
                      <ImagePlus size={12} />
                      {text.weeklogImageHint}
                    </>
                  )}
                </div>
              </div>

              <div
                className="timeline"
                onClick={(event) => {
                  const target = event.target as HTMLElement;
                  if (target instanceof HTMLImageElement) setLightbox(target.src);
                }}
              >
                {entries.map((entry) => (
                  <div className="timeline-item" key={entry.id}>
                    <span className="timeline-dot" />
                    <div className="timeline-row">
                      <div className="timeline-content">
                        <div
                          className="timeline-body markdown-body"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(entry.body) }}
                        />
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
              ref={editRef}
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
              onPaste={(event) =>
                void handleImagePaste(event, (snippet) =>
                  insertAtCaret(editRef, setEditDraft, snippet),
                )
              }
              spellCheck={false}
            />
            <div className="entry-compose-hint">
              {uploading ? (
                text.weeklogImageUploading
              ) : (
                <>
                  <ImagePlus size={12} />
                  {text.weeklogImageHint}
                </>
              )}
            </div>
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

      {lightbox ? (
        <div className="lightbox" role="presentation" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
        </div>
      ) : null}

      {contextMenu ? (
        <>
          <div
            className="context-backdrop"
            onClick={() => setContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setContextMenu(null);
            }}
          />
          <div className="snippet-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            {contextMenu.track.archived_at ? (
              <button onClick={() => void archiveTrack(contextMenu.track, false)}>
                <ArchiveRestore size={13} />
                {text.trackUnarchive}
              </button>
            ) : (
              <button onClick={() => void archiveTrack(contextMenu.track, true)}>
                <Archive size={13} />
                {text.trackArchive}
              </button>
            )}
          </div>
        </>
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
