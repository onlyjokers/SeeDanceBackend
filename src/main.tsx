import React, { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowUp,
  Check,
  ChevronDown,
  Clock3,
  CopyPlus,
  FilePenLine,
  FileImage,
  Film,
  Folder,
  FolderPlus,
  HardDrive,
  BarChart3,
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
type VideoModelVersion = "seedance2.0fast_vip" | "seedance2.0fast" | "seedance2.0" | "seedance2.0_vip";
type VideoRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type ReferenceRole = "reference" | "first_frame" | "last_frame";

interface PublicConfig {
  assetsCredentialsConfigured: boolean;
  arkAPIKeyConfigured: boolean;
  arkVideoModel: string;
  arkBaseURL: string;
  imageHostURL: string;
  volcengineRegion: string;
  pollIntervalSeconds: number;
  pollTimeoutSeconds: number;
}

interface RuntimeSettings {
  arkAPIKey: string;
  arkVideoModel: string;
  arkBaseURL: string;
  imageHostURL: string;
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
  references?: VideoReference[];
  status: "queued" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  videoUrl?: string;
  downloadPath?: string;
  hiddenAt?: string;
  createdAt: string;
  updatedAt: string;
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
  };
  byStatus: Record<VideoTask["status"], number>;
  byProject: Array<{ projectId: string; projectName: string; requests: number; succeeded: number; failed: number; hidden: number }>;
  byModel: Array<{ modelVersion: string; requests: number; succeeded: number; failed: number }>;
  byDay: Array<{ day: string; requests: number }>;
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
  url?: string;
  uploading?: boolean;
  error?: string;
}

const emptyState: AppState = { assetGroups: [], assets: [], videoProjects: [], videoTasks: [], pollLogs: [] };

const modelOptions: Array<{ value: VideoModelVersion; label: string; short: string }> = [
  { value: "seedance2.0fast_vip", label: "Seedance 2.0 Fast VIP", short: "Fast VIP" },
  { value: "seedance2.0fast", label: "Seedance 2.0 Fast", short: "Fast" },
  { value: "seedance2.0", label: "Seedance 2.0", short: "2.0" },
  { value: "seedance2.0_vip", label: "Seedance 2.0 VIP", short: "VIP" }
];

const ratioOptions: VideoRatio[] = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const durationOptions = Array.from({ length: 12 }, (_, index) => index + 4);
const multimodalReferenceLimit = 9;

const modeLabels: Record<VideoMode, string> = {
  multimodal: "全能参考",
  frames: "首尾帧"
};

function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [state, setState] = useState<AppState>(emptyState);
  const [mode, setMode] = useState<VideoMode>("frames");
  const [referenceTransport, setReferenceTransport] = useState<ReferenceTransport>("asset");
  const [modelVersion, setModelVersion] = useState<VideoModelVersion>("seedance2.0fast_vip");
  const [ratio, setRatio] = useState<VideoRatio>("16:9");
  const [duration, setDuration] = useState(5);
  const [prompt, setPrompt] = useState("");
  const [slots, setSlots] = useState<ReferenceSlot[]>(initialSlots("frames"));
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [openMenu, setOpenMenu] = useState<"mode" | "model" | "ratio" | "duration" | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [view, setView] = useState<"generate" | "assets">("generate");
  const didInitialScrollRef = useRef(false);

  const activeProjectId = selectedProjectId ?? state.videoProjects[0]?.id ?? "";
  const visibleTasks = useMemo(() => state.videoTasks.filter((task) => !task.hiddenAt), [state.videoTasks]);
  const sessionTasks = useMemo(() => sortTasksForBottomStack(visibleTasks.filter((task) => (task.projectId ?? state.videoProjects[0]?.id) === activeProjectId)), [activeProjectId, state.videoProjects, visibleTasks]);
  const generatedAssets = useMemo(() => sortTasksForBottomStack(visibleTasks.filter((task) => task.videoUrl || task.downloadPath)), [visibleTasks]);
  const selectedModel = modelOptions.find((item) => item.value === modelVersion) ?? modelOptions[0];

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
      references: slots
        .filter((slot) => slot.url)
        .map((slot) => ({
          role: slot.role,
          sourceUrl: slot.url,
          previewUrl: slot.url,
          assetType: "Image" as const,
          label: slot.label
        })),
      ...overrides
    };
  }

  function restoreTask(task: VideoTask) {
    setMode((task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal");
    setReferenceTransport(task.referenceTransport ?? "asset");
    setModelVersion(task.modelVersion ?? "seedance2.0fast_vip");
    setRatio(task.ratio ?? "16:9");
    setDuration(task.duration ?? 5);
    setPrompt(task.prompt);
    setSlots(slotsFromTask(task));
    scrollTimelineToBottom("smooth");
  }

  function regenerateTask(task: VideoTask) {
    void submitVideoTask({
      mode: (task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal",
      referenceTransport: task.referenceTransport ?? "asset",
      prompt: task.prompt,
      modelVersion: task.modelVersion ?? "seedance2.0fast_vip",
      ratio: task.ratio ?? "16:9",
      duration: task.duration ?? 5,
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
      setSlots((items) => items.map((slot) => slot.id === slotId ? { ...slot, url: result.url, uploading: false } : slot));
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
        if (slot.role === "first_frame") return { ...slot, url: last.url, error: last.error };
        if (slot.role === "last_frame") return { ...slot, url: first.url, error: first.error };
        return slot;
      });
    });
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
        <AssetLibrary tasks={generatedAssets} pollLogs={state.pollLogs} onEdit={restoreTask} onRegenerate={regenerateTask} onDelete={deleteTask} />
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
            />
          ))}
        </section>
      )}

      {view === "generate" && <section className="composer-wrap">
        {toast && <div className="toast">{toast}</div>}
        <div className="composer">
          <ReferenceSlots slots={slots} mode={mode} onSwapFrames={swapFrameSlots} onUpload={uploadSlot} onClear={(slotId) => setSlots((items) => items.map((slot) => slot.id === slotId ? { ...slot, url: undefined, error: "" } : slot))} />
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={mode === "frames" ? "输入文字，描述首帧到尾帧之间的画面内容、运动方式等。例如：镜头缓慢推近，人物抬头看向窗外。" : "上传最多9个参考素材，输入文字或 @ 参考内容，自由组合图、文、音、视频多元素，定义精彩互动。例如：@图片1 模仿 @图片2 的动作。"}
          />
          <div className="composer-controls">
            <MenuButton active={openMenu === "mode"} onClick={() => setOpenMenu(openMenu === "mode" ? null : "mode")} icon={<Sparkles size={18} />} label="视频生成" />
            <MenuButton active={openMenu === "model"} onClick={() => setOpenMenu(openMenu === "model" ? null : "model")} icon={<Film size={18} />} label={selectedModel.label} />
            <MenuButton active={false} onClick={() => switchMode(mode === "frames" ? "multimodal" : "frames")} icon={<FileImage size={18} />} label={modeLabels[mode]} />
            <MenuButton active={openMenu === "ratio"} onClick={() => setOpenMenu(openMenu === "ratio" ? null : "ratio")} icon={<RatioIcon ratio={ratio} />} label={ratio} />
            <MenuButton active={openMenu === "duration"} onClick={() => setOpenMenu(openMenu === "duration" ? null : "duration")} icon={<Clock3 size={18} />} label={`${duration}s`} />
            <button className={`transport-toggle ${referenceTransport === "url" ? "active" : ""}`} onClick={() => setReferenceTransport(referenceTransport === "asset" ? "url" : "asset")} title="切换参考图片链路">
              {referenceTransport === "asset" ? "Asset" : "URL"}
            </button>
            <button className="submit-button" disabled={!canSubmit || busy === "video"} onClick={() => submitVideoTask()}>
              {busy === "video" ? <Loader2 className="spin" size={20} /> : <ArrowUp size={22} />}
            </button>
          </div>
          {openMenu && (
            <FloatingMenu kind={openMenu} mode={mode} modelVersion={modelVersion} ratio={ratio} duration={duration} onMode={switchMode} onModel={setModelVersion} onRatio={setRatio} onDuration={setDuration} onClose={() => setOpenMenu(null)} />
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
      label: `参考内容 ${index + 1}`
    }))
  ];
}

function slotsFromTask(task: VideoTask): ReferenceSlot[] {
  const mode = task.mode === "frames" ? "frames" : "multimodal";
  const base = initialSlots(mode);
  for (const reference of task.references ?? []) {
    const url = reference.previewUrl || reference.sourceUrl;
    const target = base.find((slot) => slot.role === reference.role && !slot.url) ?? base.find((slot) => slot.role === reference.role);
    if (target) target.url = url;
  }
  return base;
}

function ReferenceSlots({ slots, mode, onSwapFrames, onUpload, onClear }: { slots: ReferenceSlot[]; mode: VideoMode; onSwapFrames: () => void; onUpload: (slotId: string, file: File) => void; onClear: (slotId: string) => void }) {
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
      {slots.map((slot) => <UploadSlot key={slot.id} slot={slot} onUpload={onUpload} onClear={onClear} />)}
    </div>
  );
}

function UploadSlot({ slot, onUpload, onClear }: { slot: ReferenceSlot; onUpload: (slotId: string, file: File) => void; onClear: (slotId: string) => void }) {
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

function FloatingMenu({ kind, mode, modelVersion, ratio, duration, onMode, onModel, onRatio, onDuration, onClose }: {
  kind: "mode" | "model" | "ratio" | "duration";
  mode: VideoMode;
  modelVersion: VideoModelVersion;
  ratio: VideoRatio;
  duration: number;
  onMode: (value: VideoMode) => void;
  onModel: (value: VideoModelVersion) => void;
  onRatio: (value: VideoRatio) => void;
  onDuration: (value: number) => void;
  onClose: () => void;
}) {
  if (kind === "ratio") {
    return <div className="floating-menu ratio-menu"><p>选择比例</p>{ratioOptions.map((item) => <button key={item} className={ratio === item ? "selected" : ""} onClick={() => { onRatio(item); onClose(); }}><RatioIcon ratio={item} />{item}</button>)}</div>;
  }
  if (kind === "duration") {
    return <div className="floating-menu duration-menu"><p>选择视频生成时长</p>{durationOptions.map((item) => <button key={item} className={duration === item ? "selected" : ""} onClick={() => { onDuration(item); onClose(); }}><Clock3 size={18} />{item}s{duration === item && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "model") {
    return <div className="floating-menu model-menu"><p>选择模型</p>{modelOptions.map((item) => <button key={item.value} className={modelVersion === item.value ? "selected" : ""} onClick={() => { onModel(item.value); onClose(); }}><Film size={18} />{item.label}{modelVersion === item.value && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  return <div className="floating-menu mode-menu"><p>选择生成模式</p>{(["multimodal", "frames"] as VideoMode[]).map((item) => <button key={item} className={mode === item ? "selected" : ""} onClick={() => onMode(item)}><UploadCloud size={18} />{modeLabels[item]}{mode === item && <Check className="option-check" size={18} />}</button>)}</div>;
}

function RatioIcon({ ratio }: { ratio: string }) {
  return <span className={`ratio-icon r-${ratio.replace(":", "-")}`} />;
}

function AssetLibrary({ tasks, pollLogs, onEdit, onRegenerate, onDelete }: {
  tasks: VideoTask[];
  pollLogs: PollLog[];
  onEdit: (task: VideoTask) => void;
  onRegenerate: (task: VideoTask) => void;
  onDelete: (taskId: string) => void;
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
          />
        ))}
      </div>
    </section>
  );
}

function TaskCard({ task, selected, latestLog, onEdit, onRegenerate, onDelete }: { task: VideoTask; selected: boolean; latestLog?: PollLog; onEdit: () => void; onRegenerate: () => void; onDelete: () => void }) {
  const model = modelOptions.find((item) => item.value === task.modelVersion)?.label ?? "Seedance 2.0";
  return (
    <article className={`history-card ${task.status} ${selected ? "selected" : ""}`} data-task-id={task.id}>
      <div className="prompt-line">
        <ReferenceThumbs references={task.references ?? []} />
        <p>{task.prompt}</p>
        <span>{model}</span>
        <span>{task.duration ?? 5}s</span>
        <span>{modeLabels[(task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal"]}</span>
        <span className={`status-badge ${task.status}`}>{taskStatusLabel(task, latestLog)}</span>
      </div>
      <div className="result-frame">
        {videoPreviewUrl(task) ? <video src={videoPreviewUrl(task)} controls /> : <TaskPlaceholder status={task.status} />}
      </div>
      <div className="task-actions">
        <button onClick={onEdit}><PencilLine size={18} />重新编辑</button>
        <button onClick={onRegenerate}><CopyPlus size={18} />再次生成</button>
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
  const visible = references.filter((reference) => reference.previewUrl || reference.sourceUrl).slice(0, 9);
  if (!visible.length) return null;
  return <div className="reference-thumbs">{visible.slice(0, 4).map((reference, index) => <img key={`${reference.previewUrl}-${index}`} src={reference.previewUrl || reference.sourceUrl} alt={reference.label || `参考 ${index + 1}`} />)}{visible.length > 4 && <span>+{visible.length - 4}</span>}</div>;
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

  useEffect(() => {
    if (!authenticated) return;
    void refreshManager();
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
            <h2><Settings2 size={19} />运行时参数</h2>
            {settings && (
              <div className="settings-form">
                <SettingField label="EP" value={settings.arkVideoModel} onChange={(value) => setSettings({ ...settings, arkVideoModel: value })} />
                <SettingField label="APIKey" value={settings.arkAPIKey} onChange={(value) => setSettings({ ...settings, arkAPIKey: value })} />
                <SettingField label="请求地址" value={settings.arkBaseURL} onChange={(value) => setSettings({ ...settings, arkBaseURL: value })} />
                <SettingField label="图床地址" value={settings.imageHostURL} onChange={(value) => setSettings({ ...settings, imageHostURL: value })} />
              </div>
            )}
          </section>
          <section className="manager-card usage-card">
            <h2><BarChart3 size={19} />请求量统计</h2>
            <LocalUsagePanel usage={localUsage} />
          </section>
        </section> : (
          <ManagerRecords tasks={state.videoTasks} projects={state.videoProjects} busy={busy} onHardDelete={hardDeleteTask} />
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

function LocalUsagePanel({ usage }: { usage: LocalUsageSummary | null }) {
  if (!usage) return <div className="record-empty">正在读取本地统计</div>;
  return (
    <div className="usage-panel">
      <p className="usage-note">这里统计的是本系统实际提交的任务，不需要额外的火山 AK/SK。</p>
      <div className="usage-metrics">
        <UsageMetric label="总请求" value={usage.totals.requests} />
        <UsageMetric label="成功" value={usage.byStatus.succeeded} />
        <UsageMetric label="失败" value={usage.byStatus.failed} />
        <UsageMetric label="已下载" value={usage.totals.downloaded} />
        <UsageMetric label="隐藏记录" value={usage.totals.hidden} />
        <UsageMetric label="参考图" value={usage.totals.referenceImages} />
      </div>
      <div className="usage-lists">
        <UsageList title="项目请求" rows={usage.byProject.slice(0, 5).map((item) => [item.projectName, `${item.requests} 次 / 成功 ${item.succeeded}`])} />
        <UsageList title="模型请求" rows={usage.byModel.slice(0, 5).map((item) => [modelLabel(item.modelVersion), `${item.requests} 次`])} />
        <UsageList title="最近日期" rows={usage.byDay.slice(-5).reverse().map((item) => [item.day, `${item.requests} 次`])} />
      </div>
    </div>
  );
}

function ManagerRecords({ tasks, projects, busy, onHardDelete }: { tasks: VideoTask[]; projects: VideoProject[]; busy: string; onHardDelete: (taskId: string) => void }) {
  if (!tasks.length) return <section className="manager-record-empty"><Film size={30} /><h2>暂无生成记录</h2><p>所有项目的生成任务都会出现在这里。</p></section>;
  return (
    <section className="manager-record-grid">
      {tasks.map((task) => (
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
              <button className="hard-delete" disabled={busy === `hard-delete-${task.id}`} onClick={() => onHardDelete(task.id)}>
                <Trash2 size={15} />永久删除
              </button>
            </div>
          </div>
        </article>
      ))}
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
