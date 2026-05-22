import React, { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import { insertReferenceToken, labelForReferenceIndex } from "./promptReferences";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock3,
  CopyPlus,
  Download,
  FilePenLine,
  FileImage,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  BarChart3,
  Gauge,
  ImagePlus,
  KeyRound,
  Loader2,
  PencilLine,
  RefreshCcw,
  Save,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  UploadCloud,
  Wand2
} from "lucide-react";
import "./styles.css";

type AssetType = "Image" | "Video" | "Audio";
type VideoMode = "multimodal" | "frames";
type ReferenceTransport = "asset" | "url";
type VideoModelVersion = "doubao-seedance-2-0-fast-260128" | "doubao-seedance-2-0-260128";
type VideoRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type VideoResolution = "480p" | "720p" | "1080p";
type ReferenceRole = "reference" | "first_frame" | "last_frame";

interface PublicConfig {
  assetsCredentialsConfigured: boolean;
  arkAPIKeyConfigured: boolean;
  arkVideoModel: string;
  arkBaseURL: string;
  imageHostURL: string;
  volcengineRegion: string;
  volcengineService: string;
  assetProjectNameConfigured: boolean;
  pollIntervalSeconds: number;
  pollTimeoutSeconds: number;
  uploadDir: string;
}

interface RuntimeSettings {
  port: string;
  host: string;
  databasePath: string;
  downloadDir: string;
  uploadDir: string;
  volcengineAK: string;
  volcengineSK: string;
  volcengineRegion: string;
  volcengineService: string;
  arkAPIKey: string;
  arkVideoModel: string;
  arkBaseURL: string;
  imageHostURL: string;
  assetProjectName: string;
  pollIntervalSeconds: string;
  pollTimeoutSeconds: string;
}

interface AssetGroup {
  id: string;
  name: string;
  description: string;
  groupType: "AIGC";
  projectName: string;
}

interface Asset {
  id: string;
  name: string;
  url: string;
  assetType: AssetType;
  groupId: string;
  status: string;
  errorMessage?: string;
  projectName: string;
}

interface VideoReference {
  assetId?: string;
  sourceUrl?: string;
  previewUrl?: string;
  localPath?: string;
  localUrl?: string;
  assetType: AssetType;
  role: ReferenceRole;
  label?: string;
}

interface VideoTask {
  id: string;
  projectId?: string;
  remoteTaskId?: string;
  prompt: string;
  assetIds: string[];
  mode?: VideoMode | "text";
  referenceTransport?: ReferenceTransport;
  modelVersion?: VideoModelVersion;
  ratio?: VideoRatio;
  duration?: number;
  resolution?: VideoResolution;
  references?: VideoReference[];
  status: "queued" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  tokenUsage?: TokenUsage;
  videoUrl?: string;
  downloadPath?: string;
  hiddenAt?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt: string;
}

interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

interface PollLog {
  id: string;
  taskId: string;
  message: string;
  createdAt: string;
}

interface AppState {
  assetGroups: AssetGroup[];
  assets: Asset[];
  videoProjects: VideoProject[];
  videoTasks: VideoTask[];
  pollLogs: PollLog[];
  runtimeSettings?: RuntimeSettings;
}

interface LocalUsageSummary {
  source: "local";
  credentialsRequired: false;
  totals: {
    requests: number;
    visible: number;
    hidden: number;
    downloaded: number;
    referenceImages: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  byStatus: Record<VideoTask["status"], number>;
  byProject: Array<{ projectId: string; projectName: string; requests: number; succeeded: number; failed: number; hidden: number }>;
  byModel: Array<{ modelVersion: string; requests: number; succeeded: number; failed: number }>;
  byDay: Array<{ day: string; requests: number }>;
}

interface OfficialUsageSummary {
  source: "official";
  totals: {
    requests: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    imageCount: number;
  };
  rows: Array<Record<string, string | number>>;
  dataCount: number;
  error?: string;
}

interface VideoProject {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

interface ReferenceSlot {
  id: string;
  role: ReferenceRole;
  label: string;
  token?: string;
  url?: string;
  remoteUrl?: string;
  localPath?: string;
  localUrl?: string;
  uploading?: boolean;
  error?: string;
}

const emptyState: AppState = { assetGroups: [], assets: [], videoProjects: [], videoTasks: [], pollLogs: [] };

const modelOptions: Array<{ value: VideoModelVersion; label: string; short: string }> = [
  { value: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 Fast", short: "Fast" },
  { value: "doubao-seedance-2-0-260128", label: "Seedance 2.0", short: "2.0" }
];
const defaultModelVersion: VideoModelVersion = "doubao-seedance-2-0-fast-260128";

const ratioOptions: VideoRatio[] = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const durationOptions = Array.from({ length: 12 }, (_, index) => index + 4);
const resolutionOptions: VideoResolution[] = ["480p", "720p", "1080p"];
const multimodalReferenceLimit = 9;

const modeLabels: Record<VideoMode, string> = {
  multimodal: "全能参考",
  frames: "首尾帧"
};

function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [state, setState] = useState<AppState>(emptyState);
  const [mode, setMode] = useState<VideoMode>("frames");
  const [referenceTransport, setReferenceTransport] = useState<ReferenceTransport>("url");
  const [modelVersion, setModelVersion] = useState<VideoModelVersion>(defaultModelVersion);
  const [ratio, setRatio] = useState<VideoRatio>("16:9");
  const [duration, setDuration] = useState(5);
  const [resolution, setResolution] = useState<VideoResolution>("720p");
  const [prompt, setPrompt] = useState("");
  const [slots, setSlots] = useState<ReferenceSlot[]>(initialSlots("frames"));
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [openMenu, setOpenMenu] = useState<"mode" | "model" | "ratio" | "duration" | "resolution" | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [view, setView] = useState<"generate" | "assets">("generate");
  const didInitialScrollRef = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);

  const activeProjectId = selectedProjectId ?? state.videoProjects[0]?.id ?? "";
  const visibleTasks = useMemo(() => state.videoTasks.filter((task) => !task.hiddenAt), [state.videoTasks]);
  const sessionTasks = useMemo(() => sortTasksForBottomStack(visibleTasks.filter((task) => (task.projectId ?? state.videoProjects[0]?.id) === activeProjectId)), [activeProjectId, state.videoProjects, visibleTasks]);
  const generatedAssets = useMemo(() => sortTasksForBottomStack(visibleTasks.filter((task) => task.videoUrl || task.downloadPath)), [visibleTasks]);
  const selectedModel = modelOptions.find((item) => item.value === modelVersion) ?? modelOptions[0];
  const availableResolutions = useMemo(() => allowedResolutions(modelVersion), [modelVersion]);

  async function refresh() {
    const [configResponse, stateResponse] = await Promise.all([fetch("/api/config"), fetch("/api/state")]);
    setConfig(await configResponse.json());
    setState(await stateResponse.json());
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!selectedProjectId && state.videoProjects[0]?.id) setSelectedProjectId(state.videoProjects[0].id);
  }, [selectedProjectId, state.videoProjects]);

  useEffect(() => {
    if (didInitialScrollRef.current || !state.videoTasks.length) return;
    didInitialScrollRef.current = true;
    window.requestAnimationFrame(() => scrollTimelineToBottom());
  }, [state.videoTasks.length]);

  function switchMode(nextMode: VideoMode) {
    setMode(nextMode);
    setSlots(initialSlots(nextMode));
    setOpenMenu(null);
  }

  function chooseModel(nextModel: VideoModelVersion) {
    setModelVersion(nextModel);
    if (!allowedResolutions(nextModel).includes(resolution)) {
      setResolution("720p");
    }
  }

  async function submitVideoTask(overrides?: Partial<ComposerPayload>) {
    const payload = buildComposerPayload(overrides);
    setBusy("video");
    setToast("");
    try {
      const response = await fetch("/api/video-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "提交视频任务失败");
      setSelectedTaskId(result.id);
      await refresh();
      window.requestAnimationFrame(() => scrollTimelineToBottom("smooth"));
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  function buildComposerPayload(overrides: Partial<ComposerPayload> = {}): ComposerPayload {
    return {
      projectId: activeProjectId || undefined,
      mode,
      referenceTransport,
      prompt: prompt.trim(),
      modelVersion,
      ratio,
      duration,
      resolution,
      references: slots
        .filter((slot) => slot.url)
        .map((slot) => ({
          role: slot.role,
          sourceUrl: slot.remoteUrl || slot.url,
          previewUrl: slot.localUrl || slot.url,
          localPath: slot.localPath,
          localUrl: slot.localUrl,
          assetType: "Image" as const,
          label: slot.label
        })),
      ...overrides
    };
  }

  function restoreTask(task: VideoTask) {
    setMode((task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal");
    setReferenceTransport(task.referenceTransport ?? "url");
    setModelVersion(normalizeModelVersion(task.modelVersion));
    setRatio(task.ratio ?? "16:9");
    setDuration(task.duration ?? 5);
    setResolution(normalizeResolution(task.resolution, normalizeModelVersion(task.modelVersion)));
    setPrompt(task.prompt);
    setSlots(slotsFromTask(task));
    scrollTimelineToBottom("smooth");
  }

  function regenerateTask(task: VideoTask) {
    void submitVideoTask({
      mode: (task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal",
      referenceTransport: task.referenceTransport ?? "url",
      prompt: task.prompt,
      modelVersion: normalizeModelVersion(task.modelVersion),
      ratio: task.ratio ?? "16:9",
      duration: task.duration ?? 5,
      resolution: normalizeResolution(task.resolution, normalizeModelVersion(task.modelVersion)),
      references: task.references ?? []
    });
  }

  async function deleteTask(taskId: string) {
    setBusy(`delete-${taskId}`);
    setToast("");
    try {
      const response = await fetch(`/api/video-tasks/${taskId}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "删除记录失败");
      setSelectedTaskId((id) => id === taskId ? null : id);
      await refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function createProject() {
    setBusy("project");
    setToast("");
    try {
      const response = await fetch("/api/video-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `新项目 ${state.videoProjects.length + 1}` })
      });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error ?? "创建项目失败");
      setSelectedProjectId(project.id);
      setView("generate");
      setSelectedTaskId(null);
      await refresh();
      scrollTimelineToBottom("smooth");
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function renameProject(projectId: string, name: string) {
    setBusy(`rename-${projectId}`);
    setToast("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const project = await response.json();
      if (!response.ok) throw new Error(project.error ?? "重命名项目失败");
      await refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function uploadSlot(slotId: string, file: File) {
    setSlots((items) => items.map((slot) => slot.id === slotId ? { ...slot, uploading: true, error: "" } : slot));
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch("/api/uploads/image", { method: "POST", body });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "上传图片失败");
      setSlots((items) => items.map((slot) => slot.id === slotId ? {
        ...slot,
        url: result.localUrl || result.url,
        remoteUrl: result.url,
        localPath: result.localPath,
        localUrl: result.localUrl,
        uploading: false
      } : slot));
    } catch (error) {
      setSlots((items) => items.map((slot) => slot.id === slotId ? { ...slot, uploading: false, error: error instanceof Error ? error.message : String(error) } : slot));
    }
  }

  function swapFrameSlots() {
    setSlots((items) => {
      const first = items.find((slot) => slot.role === "first_frame");
      const last = items.find((slot) => slot.role === "last_frame");
      if (!first || !last) return items;
      return items.map((slot) => {
        if (slot.role === "first_frame") return { ...slot, url: last.url, remoteUrl: last.remoteUrl, localPath: last.localPath, localUrl: last.localUrl, error: last.error };
        if (slot.role === "last_frame") return { ...slot, url: first.url, remoteUrl: first.remoteUrl, localPath: first.localPath, localUrl: first.localUrl, error: first.error };
        return slot;
      });
    });
  }

  function insertReference(slot: ReferenceSlot) {
    const token = slot.token ?? slot.label;
    setPrompt((value) => insertReferenceToken(value, token));
    window.requestAnimationFrame(() => promptRef.current?.focus());
  }

  const canSubmit = useMemo(() => {
    if (!config?.arkAPIKeyConfigured || !prompt.trim() || slots.some((slot) => slot.uploading)) return false;
    const filled = slots.filter((slot) => slot.url);
    if (mode === "frames") return filled.some((slot) => slot.role === "first_frame") && filled.some((slot) => slot.role === "last_frame");
    return filled.length > 0 && filled.length <= multimodalReferenceLimit;
  }, [config?.arkAPIKeyConfigured, mode, prompt, slots]);

  return (
    <main className="dream-shell">
      <ConversationRail
        projects={state.videoProjects}
        selectedProjectId={activeProjectId}
        view={view}
        onView={setView}
        onCreateProject={createProject}
        onRenameProject={renameProject}
        onSelectProject={(projectId) => {
          setSelectedProjectId(projectId);
          setSelectedTaskId(null);
          setView("generate");
          scrollTimelineToBottom("smooth");
        }}
      />
      <header className="dream-topbar">
        <div className="search-pill">
          <button><Search size={17} /></button>
          <button>时间<ChevronDown size={14} /></button>
          <button>生成模式<ChevronDown size={14} /></button>
          <button>操作类型<ChevronDown size={14} /></button>
        </div>
      </header>

      {view === "assets" ? (
        <AssetLibrary tasks={generatedAssets} pollLogs={state.pollLogs} onEdit={restoreTask} onRegenerate={regenerateTask} onDelete={deleteTask} onDownloadDebug={downloadTaskDebug} />
      ) : (
        <section className="timeline">
          <div className="date-heading">5月19日</div>
          {!sessionTasks.length && (
            <section className="empty-state">
              <Wand2 size={30} />
              <h1>{projectName(state.videoProjects, activeProjectId)}</h1>
              <p>这个项目还是空的。上传参考图，输入画面与动作描述，提交后任务会从底部堆叠到这里。</p>
            </section>
          )}
          {sessionTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              selected={task.id === selectedTaskId}
              latestLog={state.pollLogs.find((log) => log.taskId === task.id)}
              onEdit={() => restoreTask(task)}
              onRegenerate={() => regenerateTask(task)}
              onDelete={() => deleteTask(task.id)}
              onDownloadDebug={() => downloadTaskDebug(task.id)}
            />
          ))}
        </section>
      )}

      {view === "generate" && <section className="composer-wrap">
        {toast && <div className="toast"><span>{toast}</span><button onClick={() => setToast("")} title="关闭提示">×</button></div>}
        <div className="composer">
          <ReferenceSlots slots={slots} mode={mode} onSwapFrames={swapFrameSlots} onUpload={uploadSlot} onClear={(slotId) => setSlots((items) => items.map((slot) => slot.id === slotId ? { ...slot, url: undefined, remoteUrl: undefined, localPath: undefined, localUrl: undefined, error: "" } : slot))} onInsertReference={insertReference} />
          <textarea
            ref={promptRef}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={mode === "frames" ? "输入文字，描述首帧到尾帧之间的画面内容、运动方式等。例如：镜头缓慢推近，人物抬头看向窗外。" : "上传最多9个参考素材，点击上方 @图片 按钮插入引用，再描述它们的关系。例如：图片 1 模仿图片 2 的动作。"}
          />
          <div className="composer-controls">
            <MenuButton active={openMenu === "mode"} onClick={() => setOpenMenu(openMenu === "mode" ? null : "mode")} icon={<Sparkles size={18} />} label="视频生成" />
            <MenuButton active={openMenu === "model"} onClick={() => setOpenMenu(openMenu === "model" ? null : "model")} icon={<Film size={18} />} label={selectedModel.label} />
            <MenuButton active={false} onClick={() => switchMode(mode === "frames" ? "multimodal" : "frames")} icon={<FileImage size={18} />} label={modeLabels[mode]} />
            <MenuButton active={openMenu === "ratio"} onClick={() => setOpenMenu(openMenu === "ratio" ? null : "ratio")} icon={<RatioIcon ratio={ratio} />} label={ratio} />
            <MenuButton active={openMenu === "duration"} onClick={() => setOpenMenu(openMenu === "duration" ? null : "duration")} icon={<Clock3 size={18} />} label={`${duration}s`} />
            <MenuButton active={openMenu === "resolution"} onClick={() => setOpenMenu(openMenu === "resolution" ? null : "resolution")} icon={<Gauge size={18} />} label={resolution} />
            <button className={`transport-toggle ${referenceTransport === "url" ? "active" : ""}`} onClick={() => setReferenceTransport(referenceTransport === "asset" ? "url" : "asset")} title="切换参考图片链路">
              {referenceTransport === "asset" ? "Asset" : "URL"}
            </button>
            <button className="submit-button" disabled={!canSubmit || busy === "video"} onClick={() => submitVideoTask()}>
              {busy === "video" ? <Loader2 className="spin" size={20} /> : <ArrowUp size={22} />}
            </button>
          </div>
          {openMenu && (
            <FloatingMenu kind={openMenu} mode={mode} modelVersion={modelVersion} ratio={ratio} duration={duration} resolution={resolution} availableResolutions={availableResolutions} onMode={switchMode} onModel={chooseModel} onRatio={setRatio} onDuration={setDuration} onResolution={setResolution} onClose={() => setOpenMenu(null)} />
          )}
        </div>
      </section>}
    </main>
  );
}

interface ComposerPayload {
  projectId?: string;
  mode: VideoMode;
  referenceTransport: ReferenceTransport;
  prompt: string;
  modelVersion: VideoModelVersion;
  ratio: VideoRatio;
  duration: number;
  resolution: VideoResolution;
  references: VideoReference[];
}

function ConversationRail({ projects, selectedProjectId, view, onView, onCreateProject, onRenameProject, onSelectProject }: {
  projects: VideoProject[];
  selectedProjectId: string;
  view: "generate" | "assets";
  onView: (view: "generate" | "assets") => void;
  onCreateProject: () => void;
  onRenameProject: (projectId: string, name: string) => void;
  onSelectProject: (projectId: string) => void;
}) {
  return (
    <aside className="conversation-rail">
      <nav className="icon-rail" aria-label="主导航">
        <div className="brand-star">✦</div>
        <button className={view === "generate" ? "active" : ""} onClick={() => onView("generate")}><Sparkles size={22} /><span>生成</span></button>
        <button className={view === "assets" ? "active" : ""} onClick={() => onView("assets")}><Folder size={22} /><span>资产</span></button>
        <div className="rail-spacer" />
        <div className="avatar" />
      </nav>
      <section className="session-list">
        <header>
          <h2>项目</h2>
          <button title="新建项目" onClick={onCreateProject}><FolderPlus size={15} /></button>
        </header>
        <button className="session-row new" onClick={onCreateProject}>
          <span className="session-thumb icon"><FolderPlus size={20} /></span>
          <strong>新建项目</strong>
        </button>
        <p className="session-label">文件夹</p>
        {projects.map((project) => {
          const selected = project.id === selectedProjectId && view === "generate";
          return (
            <button key={project.id} className={`session-row ${selected ? "selected" : ""}`} onClick={() => onSelectProject(project.id)}>
              <span className="session-thumb icon"><Folder size={18} /></span>
              <strong>{project.name}</strong>
              <ProjectNameEditor project={project} onRename={onRenameProject} />
            </button>
          );
        })}
      </section>
    </aside>
  );
}

function ProjectNameEditor({ project, onRename }: { project: VideoProject; onRename: (projectId: string, name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(project.name);

  useEffect(() => setValue(project.name), [project.name]);

  function commit() {
    const next = value.trim();
    setEditing(false);
    if (next && next !== project.name) onRename(project.id, next);
    else setValue(project.name);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") commit();
    if (event.key === "Escape") {
      setValue(project.name);
      setEditing(false);
    }
  }

  if (editing) {
    return (
      <input
        className="project-name-input"
        value={value}
        autoFocus
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => setValue(event.currentTarget.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
      />
    );
  }

  return (
    <span
      className="project-rename"
      title="重命名项目"
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      <FilePenLine size={15} />
    </span>
  );
}

function projectName(projects: VideoProject[], id: string) {
  return projects.find((project) => project.id === id)?.name ?? "默认项目";
}

function sortTasksForBottomStack(tasks: VideoTask[]) {
  return tasks
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function scrollTimelineToBottom(behavior: ScrollBehavior = "auto") {
  window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
}

function scrollTaskIntoView(taskId: string) {
  window.requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)?.scrollIntoView({
      behavior: "smooth",
      block: "center"
    });
  });
}

function initialSlots(mode: VideoMode): ReferenceSlot[] {
  if (mode === "frames") {
    return [
      { id: "first", role: "first_frame", label: "首帧" },
      { id: "last", role: "last_frame", label: "尾帧" }
    ];
  }
  return [
    ...Array.from({ length: multimodalReferenceLimit }, (_, index) => ({
      id: `ref-${index + 1}`,
      role: "reference" as const,
      label: `参考内容 ${index + 1}`,
      token: labelForReferenceIndex(index)
    }))
  ];
}

function slotsFromTask(task: VideoTask): ReferenceSlot[] {
  const mode = task.mode === "frames" ? "frames" : "multimodal";
  const base = initialSlots(mode);
  for (const reference of task.references ?? []) {
    const url = reference.localUrl || reference.previewUrl || reference.sourceUrl;
    const target = base.find((slot) => slot.role === reference.role && !slot.url) ?? base.find((slot) => slot.role === reference.role);
    if (target) {
      target.url = url;
      target.remoteUrl = reference.sourceUrl;
      target.localPath = reference.localPath;
      target.localUrl = reference.localUrl;
    }
  }
  return base;
}

function ReferenceSlots({ slots, mode, onSwapFrames, onUpload, onClear, onInsertReference }: { slots: ReferenceSlot[]; mode: VideoMode; onSwapFrames: () => void; onUpload: (slotId: string, file: File) => void; onClear: (slotId: string) => void; onInsertReference: (slot: ReferenceSlot) => void }) {
  if (mode === "frames") {
    const first = slots.find((slot) => slot.role === "first_frame") ?? slots[0];
    const last = slots.find((slot) => slot.role === "last_frame") ?? slots[1];
    return (
      <div className="reference-strip frames">
        <UploadSlot slot={first} onUpload={onUpload} onClear={onClear} />
        <button className="frame-swap" onClick={onSwapFrames} title="交换首尾帧">⇆</button>
        <UploadSlot slot={last} onUpload={onUpload} onClear={onClear} />
      </div>
    );
  }
  return (
    <div className={`reference-strip ${mode}`}>
      {slots.map((slot) => <UploadSlot key={slot.id} slot={slot} onUpload={onUpload} onClear={onClear} onInsertReference={onInsertReference} />)}
    </div>
  );
}

function UploadSlot({ slot, onUpload, onClear, onInsertReference }: { slot: ReferenceSlot; onUpload: (slotId: string, file: File) => void; onClear: (slotId: string) => void; onInsertReference?: (slot: ReferenceSlot) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <button
      className={`upload-slot ${slot.url ? "filled" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) onUpload(slot.id, file);
      }}
    >
      {slot.uploading ? <Loader2 className="spin" size={20} /> : slot.url ? <img src={slot.url} alt={slot.label} /> : <ImagePlus size={22} />}
      <span>{slot.uploading ? "上传中" : slot.label}</span>
      {onInsertReference && slot.token && <b className="reference-token" onClick={(event) => { event.stopPropagation(); onInsertReference(slot); }}>{`@${slot.token.replace(/\s+/g, "")}`}</b>}
      {slot.url && <Trash2 className="slot-clear" size={14} onClick={(event) => { event.stopPropagation(); onClear(slot.id); }} />}
      {slot.error && <small>{slot.error}</small>}
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) onUpload(slot.id, file);
        event.currentTarget.value = "";
      }} />
    </button>
  );
}

function MenuButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return <button className={`menu-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span><ChevronDown size={16} /></button>;
}

function FloatingMenu({ kind, mode, modelVersion, ratio, duration, resolution, availableResolutions, onMode, onModel, onRatio, onDuration, onResolution, onClose }: {
  kind: "mode" | "model" | "ratio" | "duration" | "resolution";
  mode: VideoMode;
  modelVersion: VideoModelVersion;
  ratio: VideoRatio;
  duration: number;
  resolution: VideoResolution;
  availableResolutions: VideoResolution[];
  onMode: (value: VideoMode) => void;
  onModel: (value: VideoModelVersion) => void;
  onRatio: (value: VideoRatio) => void;
  onDuration: (value: number) => void;
  onResolution: (value: VideoResolution) => void;
  onClose: () => void;
}) {
  if (kind === "ratio") {
    return <div className="floating-menu ratio-menu"><p>选择比例</p>{ratioOptions.map((item) => <button key={item} className={ratio === item ? "selected" : ""} onClick={() => { onRatio(item); onClose(); }}><RatioIcon ratio={item} />{item}</button>)}</div>;
  }
  if (kind === "duration") {
    return <div className="floating-menu duration-menu"><p>选择视频生成时长</p>{durationOptions.map((item) => <button key={item} className={duration === item ? "selected" : ""} onClick={() => { onDuration(item); onClose(); }}><Clock3 size={18} />{item}s{duration === item && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "resolution") {
    return <div className="floating-menu resolution-menu"><p>选择清晰度</p>{resolutionOptions.map((item) => {
      const disabled = !availableResolutions.includes(item);
      return <button key={item} disabled={disabled} className={resolution === item ? "selected" : ""} title={disabled ? "Seedance 2.0 Fast 不支持 1080p" : undefined} onClick={() => { if (disabled) return; onResolution(item); onClose(); }}><Gauge size={18} />{item}{resolution === item && <Check className="option-check" size={18} />}</button>;
    })}</div>;
  }
  if (kind === "model") {
    return <div className="floating-menu model-menu"><p>选择模型</p>{modelOptions.map((item) => <button key={item.value} className={modelVersion === item.value ? "selected" : ""} onClick={() => { onModel(item.value); onClose(); }}><Film size={18} />{item.label}{modelVersion === item.value && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  return <div className="floating-menu mode-menu"><p>选择生成模式</p>{(["multimodal", "frames"] as VideoMode[]).map((item) => <button key={item} className={mode === item ? "selected" : ""} onClick={() => onMode(item)}><UploadCloud size={18} />{modeLabels[item]}{mode === item && <Check className="option-check" size={18} />}</button>)}</div>;
}

function RatioIcon({ ratio }: { ratio: string }) {
  return <span className={`ratio-icon r-${ratio.replace(":", "-")}`} />;
}

function AssetLibrary({ tasks, pollLogs, onEdit, onRegenerate, onDelete, onDownloadDebug }: {
  tasks: VideoTask[];
  pollLogs: PollLog[];
  onEdit: (task: VideoTask) => void;
  onRegenerate: (task: VideoTask) => void;
  onDelete: (taskId: string) => void;
  onDownloadDebug: (taskId: string) => void;
}) {
  return (
    <section className="asset-library">
      <header>
        <p>全局数据库</p>
        <h1>生成视频资产</h1>
      </header>
      {!tasks.length && <section className="empty-state"><Film size={30} /><h1>暂无视频资产</h1><p>成功生成或下载后的视频会出现在这里。</p></section>}
      <div className="asset-grid">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            selected={false}
            latestLog={pollLogs.find((log) => log.taskId === task.id)}
            onEdit={() => onEdit(task)}
            onRegenerate={() => onRegenerate(task)}
            onDelete={() => onDelete(task.id)}
            onDownloadDebug={() => onDownloadDebug(task.id)}
          />
        ))}
      </div>
    </section>
  );
}

function TaskCard({ task, selected, latestLog, onEdit, onRegenerate, onDelete, onDownloadDebug }: { task: VideoTask; selected: boolean; latestLog?: PollLog; onEdit: () => void; onRegenerate: () => void; onDelete: () => void; onDownloadDebug: () => void }) {
  const model = modelOptions.find((item) => item.value === task.modelVersion)?.label ?? "Seedance 2.0";
  return (
    <article className={`history-card ${task.status} ${selected ? "selected" : ""}`} data-task-id={task.id}>
      <div className="prompt-line">
        <ReferenceThumbs references={task.references ?? []} />
        <p>{task.prompt}</p>
        <span>{model}</span>
        <span>{task.duration ?? 5}s</span>
        <span>{task.resolution ?? "720p"}</span>
        <span>{modeLabels[(task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal"]}</span>
        <span>{formatTokenUsage(resolveClientTokenUsage(task))}</span>
        <span className={`status-badge ${task.status}`}>{taskStatusLabel(task, latestLog)}</span>
      </div>
      <div className="result-frame">
        {videoPreviewUrl(task) ? <video src={videoPreviewUrl(task)} controls /> : <TaskPlaceholder status={task.status} />}
      </div>
      <div className="task-actions">
        <button onClick={onEdit}><PencilLine size={18} />重新编辑</button>
        <button onClick={onRegenerate}><CopyPlus size={18} />再次生成</button>
        <button onClick={onDownloadDebug}><Download size={18} />下载状态</button>
        <button className="more-button"><RefreshCcw size={18} />{task.status}</button>
        <button className="delete-record" onClick={onDelete} title="删除记录，不删除下载文件"><Trash2 size={16} /></button>
      </div>
      {task.errorMessage && <p className="task-error">{task.errorMessage}</p>}
    </article>
  );
}

function videoPreviewUrl(task: VideoTask) {
  return task.downloadPath ? `/api/video-tasks/${task.id}/download` : task.videoUrl;
}

function taskStatusLabel(task: VideoTask, latestLog?: PollLog) {
  if (task.status === "succeeded" && task.downloadPath) return "视频已下载";
  if (task.status === "succeeded") return "生成完成";
  return latestLog?.message.replace("视频任务状态：", "") || task.status;
}

function ReferenceThumbs({ references }: { references: VideoReference[] }) {
  const visible = references.filter((reference) => reference.localUrl || reference.previewUrl || reference.sourceUrl).slice(0, 9);
  if (!visible.length) return null;
  return <div className="reference-thumbs">{visible.slice(0, 4).map((reference, index) => <img key={`${reference.localUrl || reference.previewUrl || reference.sourceUrl}-${index}`} src={reference.localUrl || reference.previewUrl || reference.sourceUrl} alt={reference.label || `参考 ${index + 1}`} />)}{visible.length > 4 && <span>+{visible.length - 4}</span>}</div>;
}

function TaskPlaceholder({ status }: { status: VideoTask["status"] }) {
  return <div className="task-placeholder"><Loader2 className={status === "running" || status === "queued" ? "spin" : ""} size={30} /><span>{status === "failed" ? "生成失败" : "等待生成结果"}</span></div>;
}

function ManagerApp() {
  const [managerToken, setManagerToken] = useState(() => sessionStorage.getItem("sts-manager-token") || "");
  const [authenticated, setAuthenticated] = useState(() => sessionStorage.getItem("sts-manager-auth") === "true" && Boolean(sessionStorage.getItem("sts-manager-token")));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [settings, setSettings] = useState<RuntimeSettings | null>(null);
  const [state, setState] = useState<AppState>(emptyState);
  const [localUsage, setLocalUsage] = useState<LocalUsageSummary | null>(null);
  const [officialUsage, setOfficialUsage] = useState<OfficialUsageSummary | null>(null);
  const [managerView, setManagerView] = useState<"dashboard" | "records">("dashboard");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function refreshManager() {
    const [settingsResponse, stateResponse, localUsageResponse] = await Promise.all([
      fetch("/api/runtime-settings", { headers: { "x-sts-manager-token": managerToken } }),
      fetch("/api/state"),
      fetch("/api/manager/usage/local", { headers: { "x-sts-manager-token": managerToken } })
    ]);
    setSettings(await settingsResponse.json());
    setState(await stateResponse.json());
    setLocalUsage(await localUsageResponse.json());
  }

  async function refreshOfficialUsage() {
    setBusy("official-usage");
    setMessage("");
    try {
      const response = await fetch("/api/manager/usage/official", { headers: { "x-sts-manager-token": managerToken } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "刷新官方用量失败");
      setOfficialUsage(result);
    } catch (error) {
      setOfficialUsage({
        source: "official",
        totals: { requests: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, imageCount: 0 },
        rows: [],
        dataCount: 0,
        error: error instanceof Error ? error.message : String(error)
      });
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    if (!authenticated) return;
    void refreshManager();
    void refreshOfficialUsage();
    const timer = window.setInterval(refreshManager, 3000);
    return () => window.clearInterval(timer);
  }, [authenticated]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy("login");
    setMessage("");
    try {
      const response = await fetch("/api/manager/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "登录失败");
      sessionStorage.setItem("sts-manager-auth", "true");
      sessionStorage.setItem("sts-manager-token", result.token);
      setManagerToken(result.token);
      setAuthenticated(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function saveSettings() {
    if (!settings) return;
    setBusy("settings");
    setMessage("");
    try {
      const response = await fetch("/api/runtime-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-sts-manager-token": managerToken },
        body: JSON.stringify(settings)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "保存失败");
      setSettings(result);
      setMessage("运行时参数已更新");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function hardDeleteTask(taskId: string) {
    setBusy(`hard-delete-${taskId}`);
    setMessage("");
    try {
      const response = await fetch(`/api/manager/video-tasks/${taskId}`, {
        method: "DELETE",
        headers: { "x-sts-manager-token": managerToken }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "删除失败");
      await refreshManager();
      setMessage("记录已永久删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function openVideoDatabase() {
    setBusy("open-database");
    setMessage("");
    try {
      const response = await fetch("/api/downloads/open-folder", {
        method: "POST",
        headers: { "x-sts-manager-token": managerToken }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "打开视频数据库失败");
      setMessage(`视频数据库已打开：${result.path}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  if (!authenticated) {
    return (
      <main className="manager-shell login">
        <form className="manager-login" onSubmit={login}>
          <ShieldCheck size={30} />
          <h1>STS Manager</h1>
          <p>输入管理账号后才能修改实时参数和永久删除记录。</p>
          <label>
            <span>账号</span>
            <input value={username} onChange={(event) => setUsername(event.currentTarget.value)} autoComplete="username" />
          </label>
          <label>
            <span>密码</span>
            <input value={password} onChange={(event) => setPassword(event.currentTarget.value)} type="password" autoComplete="current-password" />
          </label>
          {message && <div className="manager-message error">{message}</div>}
          <button className="manager-primary" disabled={busy === "login"}>{busy === "login" ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}进入管理</button>
        </form>
      </main>
    );
  }

  return (
    <main className="manager-shell">
      <aside className="manager-side">
        <div className="manager-brand"><ShieldCheck size={22} />STS Manager</div>
        <button className={managerView === "dashboard" ? "active" : ""} onClick={() => setManagerView("dashboard")}><BarChart3 size={18} />用量与配置</button>
        <button className={managerView === "records" ? "active" : ""} onClick={() => setManagerView("records")}><HardDrive size={18} />生成记录</button>
        <a href="/executor"><Sparkles size={18} />Executor</a>
        <button onClick={() => { sessionStorage.removeItem("sts-manager-auth"); sessionStorage.removeItem("sts-manager-token"); setManagerToken(""); setAuthenticated(false); }}>退出登录</button>
      </aside>
      <section className="manager-main">
        <header className="manager-header">
          <div>
            <p>{managerView === "records" ? "全局数据库" : "实时配置"}</p>
            <h1>{managerView === "records" ? "生成记录" : "用量检测与关键参数"}</h1>
          </div>
          {managerView === "dashboard" && <button className="manager-primary" onClick={saveSettings} disabled={!settings || busy === "settings"}>
            {busy === "settings" ? <Loader2 className="spin" size={18} /> : <Save size={18} />}保存参数
          </button>}
          {managerView === "records" && <button className="manager-primary" onClick={openVideoDatabase} disabled={busy === "open-database"}>
            {busy === "open-database" ? <Loader2 className="spin" size={18} /> : <Folder size={18} />}打开视频数据库
          </button>}
        </header>
        {message && <div className={`manager-message ${message.includes("失败") || message.includes("错误") ? "error" : ""}`}>{message}</div>}
        {managerView === "dashboard" ? <section className="manager-grid">
          <section className="manager-card settings-card">
            <h2><span><Settings2 size={19} />运行时参数</span></h2>
            {settings && (
              <div className="settings-form">
                <SettingsGroup title="服务路径">
                  <SettingField label="PORT" value={settings.port} onChange={(value) => setSettings({ ...settings, port: value })} />
                  <SettingField label="HOST" value={settings.host} onChange={(value) => setSettings({ ...settings, host: value })} />
                  <SettingField label="DATABASE_PATH" value={settings.databasePath} onChange={(value) => setSettings({ ...settings, databasePath: value })} />
                  <SettingField label="DOWNLOAD_DIR" value={settings.downloadDir} onChange={(value) => setSettings({ ...settings, downloadDir: value })} />
                  <SettingField label="UPLOAD_DIR" value={settings.uploadDir} onChange={(value) => setSettings({ ...settings, uploadDir: value })} />
                </SettingsGroup>
                <SettingsGroup title="火山引擎">
                  <SettingField label="VOLCENGINE_AK" value={settings.volcengineAK} onChange={(value) => setSettings({ ...settings, volcengineAK: value })} />
                  <SettingField label="VOLCENGINE_SK" value={settings.volcengineSK} onChange={(value) => setSettings({ ...settings, volcengineSK: value })} />
                  <SettingField label="VOLCENGINE_REGION" value={settings.volcengineRegion} onChange={(value) => setSettings({ ...settings, volcengineRegion: value })} />
                  <SettingField label="VOLCENGINE_SERVICE" value={settings.volcengineService} onChange={(value) => setSettings({ ...settings, volcengineService: value })} />
                  <SettingField label="ASSET_PROJECT_NAME" value={settings.assetProjectName} onChange={(value) => setSettings({ ...settings, assetProjectName: value })} />
                </SettingsGroup>
                <SettingsGroup title="方舟生成">
                  <SettingField label="ARK_VIDEO_MODEL / EP" value={settings.arkVideoModel} onChange={(value) => setSettings({ ...settings, arkVideoModel: value })} />
                  <SettingField label="ARK_API_KEY" value={settings.arkAPIKey} onChange={(value) => setSettings({ ...settings, arkAPIKey: value })} />
                  <SettingField label="ARK_BASE_URL" value={settings.arkBaseURL} onChange={(value) => setSettings({ ...settings, arkBaseURL: value })} />
                  <SettingField label="IMAGE_HOST_URL" value={settings.imageHostURL} onChange={(value) => setSettings({ ...settings, imageHostURL: value })} />
                  <SettingField label="POLL_INTERVAL_SECONDS" value={settings.pollIntervalSeconds} onChange={(value) => setSettings({ ...settings, pollIntervalSeconds: value })} />
                  <SettingField label="POLL_TIMEOUT_SECONDS" value={settings.pollTimeoutSeconds} onChange={(value) => setSettings({ ...settings, pollTimeoutSeconds: value })} />
                </SettingsGroup>
              </div>
            )}
          </section>
          <section className="manager-card usage-card">
            <h2>
              <span><BarChart3 size={19} />请求量统计</span>
              <button className="usage-refresh" onClick={refreshOfficialUsage} disabled={busy === "official-usage"}>
                {busy === "official-usage" ? <Loader2 className="spin" size={15} /> : <RefreshCcw size={15} />}刷新官方
              </button>
            </h2>
            <UsagePanel localUsage={localUsage} officialUsage={officialUsage} officialLoading={busy === "official-usage"} />
          </section>
        </section> : (
          <ManagerRecords tasks={state.videoTasks} projects={state.videoProjects} busy={busy} onHardDelete={hardDeleteTask} onDownloadDebug={downloadTaskDebug} />
        )}
      </section>
    </main>
  );
}

function SettingField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="setting-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h3>{title}</h3>
      <div>{children}</div>
    </section>
  );
}

function UsagePanel({ localUsage, officialUsage, officialLoading }: { localUsage: LocalUsageSummary | null; officialUsage: OfficialUsageSummary | null; officialLoading: boolean }) {
  if (!localUsage) return <div className="record-empty">正在读取本地统计</div>;
  return (
    <div className="usage-panel">
      <p className="usage-note">本地统计记录本系统提交次数；官方统计来自火山 GetInferenceUsage，取最近 7 天可返回的请求、Token 和图片量。</p>
      <div className="usage-metrics">
        <UsageMetric label="本地总请求" value={localUsage.totals.requests} />
        <UsageMetric label="本地成功" value={localUsage.byStatus.succeeded} />
        <UsageMetric label="本地失败" value={localUsage.byStatus.failed} />
        <UsageMetric label="官方请求" value={officialUsage?.totals.requests ?? 0} />
        <UsageMetric label="官方 Token" value={officialUsage?.totals.totalTokens ?? 0} />
        <UsageMetric label="任务 Token" value={localUsage.totals.totalTokens} />
        <UsageMetric label="官方图片量" value={officialUsage?.totals.imageCount ?? 0} />
      </div>
      {officialLoading && <p className="usage-note">正在刷新官方用量...</p>}
      {officialUsage?.error && <p className="usage-error">{officialUsage.error}</p>}
      <div className="usage-lists">
        <UsageList title="项目请求" rows={localUsage.byProject.slice(0, 5).map((item) => [item.projectName, `${item.requests} 次 / 成功 ${item.succeeded}`])} />
        <UsageList title="模型请求" rows={localUsage.byModel.slice(0, 5).map((item) => [modelLabel(item.modelVersion), `${item.requests} 次`])} />
        <UsageList title="最近日期" rows={localUsage.byDay.slice(-5).reverse().map((item) => [item.day, `${item.requests} 次`])} />
      </div>
    </div>
  );
}

function ManagerRecords({ tasks, projects, busy, onHardDelete, onDownloadDebug }: { tasks: VideoTask[]; projects: VideoProject[]; busy: string; onHardDelete: (taskId: string) => void; onDownloadDebug: (taskId: string) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | VideoTask["status"] | "hidden">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "status" | "project">("newest");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return tasks
      .filter((task) => {
        if (status === "hidden" && !task.hiddenAt) return false;
        if (status !== "all" && status !== "hidden" && task.status !== status) return false;
        if (!normalized) return true;
        const haystack = [
          task.id,
          task.remoteTaskId,
          task.prompt,
          task.modelVersion,
          task.status,
          projectName(projects, task.projectId ?? "")
        ].filter(Boolean).join(" ").toLowerCase();
        return haystack.includes(normalized);
      })
      .sort((a, b) => {
        if (sort === "oldest") return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        if (sort === "status") return a.status.localeCompare(b.status);
        if (sort === "project") return projectName(projects, a.projectId ?? "").localeCompare(projectName(projects, b.projectId ?? ""), "zh-CN");
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
  }, [projects, query, sort, status, tasks]);
  if (!tasks.length) return <section className="manager-record-empty"><Film size={30} /><h2>暂无生成记录</h2><p>所有项目的生成任务都会出现在这里。</p></section>;
  return (
    <section className="manager-records">
      <div className="manager-record-tools">
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索提示词 / 项目 / 模型 / ID" /></label>
        <select value={status} onChange={(event) => setStatus(event.currentTarget.value as typeof status)}>
          <option value="all">全部状态</option>
          <option value="succeeded">成功</option>
          <option value="running">运行中</option>
          <option value="queued">排队中</option>
          <option value="failed">失败</option>
          <option value="hidden">已隐藏</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.currentTarget.value as typeof sort)}>
          <option value="newest">最新优先</option>
          <option value="oldest">最早优先</option>
          <option value="status">按状态</option>
          <option value="project">按项目</option>
        </select>
      </div>
      {!filtered.length && <section className="manager-record-empty compact"><Search size={24} /><h2>没有匹配记录</h2><p>换一个搜索词或筛选条件。</p></section>}
      <div className="manager-record-grid">
      {filtered.map((task) => (
        <article className={`manager-record-card ${task.status}`} key={task.id}>
          <div className="manager-record-preview">
            {videoPreviewUrl(task) ? <video src={videoPreviewUrl(task)} controls preload="metadata" /> : <TaskPlaceholder status={task.status} />}
          </div>
          <div className="manager-record-body">
            <div className="manager-record-meta">
              <span><i className={`status-dot ${task.status}`} />{task.hiddenAt ? "已隐藏" : taskStatusLabel(task)}</span>
              <span>{projectName(projects, task.projectId ?? "")}</span>
              <span>{formatDate(task.createdAt)}</span>
            </div>
            <p>{task.prompt}</p>
            <div className="manager-record-foot">
              <span>{task.downloadPath ? "本地视频" : task.videoUrl ? "远程视频" : "未生成"}</span>
              <span>{formatTokenUsage(resolveClientTokenUsage(task))}</span>
              <button className="hard-delete secondary" onClick={() => onDownloadDebug(task.id)}>
                <Download size={15} />下载状态
              </button>
              <button className="hard-delete" disabled={busy === `hard-delete-${task.id}`} onClick={() => onHardDelete(task.id)}>
                <Trash2 size={15} />永久删除
              </button>
            </div>
          </div>
        </article>
      ))}
      </div>
    </section>
  );
}

function UsageMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="usage-metric">
      <strong>{new Intl.NumberFormat("zh-CN").format(value)}</strong>
      <span>{label}</span>
    </div>
  );
}

function UsageList({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <section className="usage-list">
      <h3>{title}</h3>
      {rows.length ? rows.map(([label, value]) => (
        <p key={`${label}-${value}`}><span>{label}</span><strong>{value}</strong></p>
      )) : <p><span>暂无数据</span><strong>-</strong></p>}
    </section>
  );
}

function modelLabel(value: string) {
  return modelOptions.find((item) => item.value === value)?.label ?? value;
}

function downloadTaskDebug(taskId: string) {
  window.location.href = `/api/video-tasks/${taskId}/debug`;
}

function formatTokenUsage(tokenUsage?: TokenUsage) {
  if (!tokenUsage) return "Token -";
  return `Token ${new Intl.NumberFormat("zh-CN").format(tokenUsage.totalTokens)}`;
}

function resolveClientTokenUsage(task: VideoTask): TokenUsage | undefined {
  return task.tokenUsage ?? extractClientTokenUsage(task.raw);
}

function extractClientTokenUsage(source: unknown): TokenUsage | undefined {
  const inputTokens = findClientNumber(source, ["input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]);
  const outputTokens = findClientNumber(source, ["output_tokens", "outputTokens", "completion_tokens", "completionTokens"]);
  const totalTokens = findClientNumber(source, ["total_tokens", "totalTokens"]);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined) return undefined;
  const input = inputTokens ?? 0;
  const output = outputTokens ?? 0;
  return { inputTokens: input, outputTokens: output, totalTokens: totalTokens ?? input + output };
}

function findClientNumber(source: unknown, keys: string[]): number | undefined {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const visit = (value: unknown): number | undefined => {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    for (const [key, child] of Object.entries(value)) {
      if (!wanted.has(key.toLowerCase())) continue;
      if (typeof child === "number" && Number.isFinite(child)) return child;
      if (typeof child === "string" && child.trim()) {
        const parsed = Number(child);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return visit(source);
}

function normalizeModelVersion(value?: string): VideoModelVersion {
  return modelOptions.find((item) => item.value === value)?.value ?? defaultModelVersion;
}

function allowedResolutions(modelVersion: VideoModelVersion): VideoResolution[] {
  return modelVersion === "doubao-seedance-2-0-fast-260128"
    ? ["480p", "720p"]
    : resolutionOptions;
}

function normalizeResolution(value: string | undefined, modelVersion: VideoModelVersion): VideoResolution {
  const fallback: VideoResolution = "720p";
  const resolution = resolutionOptions.find((item) => item === value) ?? fallback;
  return allowedResolutions(modelVersion).includes(resolution) ? resolution : fallback;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function Root() {
  const path = window.location.pathname;
  useEffect(() => {
    if (path === "/") window.history.replaceState(null, "", "/executor");
  }, [path]);
  if (path === "/STSManager" || path === "/manager") return <ManagerApp />;
  return <App />;
}

createRoot(document.getElementById("root")!).render(<Root />);
