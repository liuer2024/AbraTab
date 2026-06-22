import React, { useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Check,
  ChevronRight,
  Code2,
  Database,
  FilePlus2,
  Folder,
  Grid2X2,
  Info,
  Monitor,
  Palette,
  Pin,
  RotateCcw,
  Search,
  Settings,
  Star,
  Tag,
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
type SettingsTab = "appearance" | "font" | "window" | "terminal" | "about";
type Locale = "zh" | "en" | "ja";
type Theme = "graphite" | "notion" | "paper" | "mint" | "dusk" | "midnight";
type LibraryView = "all" | "favorites" | "trash";

type TerminalIntegrationStatus = {
  shell: "zsh" | "bash" | "fish";
  config_path: string;
  registered: boolean;
  cli_path: string;
  cli_built: boolean;
};

const settingsTabs: Array<{ id: SettingsTab; icon: React.ElementType }> = [
  { id: "appearance", icon: Palette },
  { id: "font", icon: Type },
  { id: "window", icon: Monitor },
  { id: "terminal", icon: TerminalSquare },
  { id: "about", icon: Info },
];

const themeOptions: Theme[] = ["graphite", "notion", "paper", "mint", "dusk", "midnight"];

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
      about: "关于",
    },
    subtitles: {
      appearance: "主题、语言、强调色和密度。",
      font: "字体和编辑器阅读体验。",
      window: "窗口行为和标题栏。",
      terminal: "注册 shell 集成和快捷词展开。",
      about: "版本和本地存储信息。",
    },
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
      about: "About",
    },
    subtitles: {
      appearance: "Theme, language, accent, and density.",
      font: "Typeface and editor reading comfort.",
      window: "Window behavior and chrome.",
      terminal: "Register shell integrations and shortcut expansion.",
      about: "Version and local storage details.",
    },
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
      about: "情報",
    },
    subtitles: {
      appearance: "テーマ、言語、アクセント、表示密度。",
      font: "書体とエディタの読みやすさ。",
      window: "ウィンドウ動作とタイトルバー。",
      terminal: "シェル連携とショートカット展開を登録します。",
      about: "バージョンとローカル保存情報。",
    },
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
  },
} as const;

function App() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeView, setActiveView] = useState<LibraryView>("all");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [dbPath, setDbPath] = useState("");
  const [status, setStatus] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>("appearance");
  const [locale, setLocale] = useState<Locale>("zh");
  const [theme, setTheme] = useState<Theme>("graphite");
  const [terminalStatuses, setTerminalStatuses] = useState<TerminalIntegrationStatus[]>([]);
  const [terminalMessage, setTerminalMessage] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; snippet: Snippet } | null>(null);
  const tagsInputRef = useRef<HTMLInputElement>(null);

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
      const category = snippet.category || "Uncategorized";
      counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [liveSnippets]);

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
      const category = snippet.category || "Uncategorized";
      if (activeCategory && category !== activeCategory) return false;
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
      category: activeCategory && activeCategory !== "Uncategorized" ? activeCategory : "",
      tagsText: activeTag ?? "",
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
        category: form.category,
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
    const category = window.prompt(text.moveCategory, snippet.category || "");
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

  function showError(error: unknown) {
    setStatus(error instanceof Error ? error.message : String(error));
  }

  async function refreshTerminalStatus() {
    const rows = await invoke<TerminalIntegrationStatus[]>("terminal_integration_status");
    setTerminalStatuses(rows);
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

  function showTerminalGuide() {
    setTerminalMessage(`./scripts/install-zsh-integration.sh\nsource ~/.zshrc`);
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

          <div className="nav-section">{text.categories}</div>
          {categories
            .filter(([name]) => name !== "Uncategorized")
            .map(([name, count]) => (
              <button
                key={name}
                className={`folder-row ${activeView === "all" && activeCategory === name ? "on" : ""}`}
                onClick={() => {
                  setActiveView("all");
                  setActiveCategory(name);
                  setActiveTag(null);
                }}
              >
                <ChevronRight size={13} />
                <Folder size={15} />
                <span>{name}</span>
                <b>{count}</b>
              </button>
            ))}

          <div className="nav-section">{text.tags}</div>
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
            <button className="icon-button" title={text.tags} onClick={() => tagsInputRef.current?.focus()}>
              <Tag size={16} />
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
              />
            </label>
            <label>
              <span>{text.tags}</span>
              <input
                ref={tagsInputRef}
                value={form.tagsText}
                onChange={(event) => setForm({ ...form, tagsText: event.target.value })}
                placeholder="curl, api"
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
    </main>
  );
}

function settingsSubtitle(tab: SettingsTab, locale: Locale) {
  return translations[locale].subtitles[tab];
}

function SettingRow({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row">
      <div>
        <h4>{title}</h4>
        <p>{detail}</p>
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
