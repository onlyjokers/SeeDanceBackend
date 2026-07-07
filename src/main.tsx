import React, { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createRoot } from "react-dom/client";
import { readJsonOrThrow } from "./http";
import { normalizeAppState } from "./appState";
import { insertReferenceToken, labelForReferenceIndex } from "./promptReferences";
import { resolveUsageCostEstimate, type UsageCostEstimate } from "./managerUsage";
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
type MediaType = "video" | "image";
type TaskKind = "video_generation" | "image_generation" | "video_upscale";
type ComposerKind = TaskKind;
type VideoMode = "multimodal" | "frames";
type ReferenceTransport = "asset" | "url";
type VideoModelVersion = "doubao-seedance-2-0-fast-260128" | "doubao-seedance-2-0-260128";
type ImageModelVersion = "gpt-image-2" | "gpt-image-2-pro";
type VideoRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16";
type ImageRatio = "2:1" | "16:9" | "3:2" | "1:1" | "2:3" | "9:16";
type GenerationRatio = VideoRatio | ImageRatio;
type VideoResolution = "480p" | "720p" | "1080p";
type ImageResolution = "1k" | "2k";
type ImageQuality = "auto" | "low" | "medium" | "high";
type ImageSize = `${number}x${number}`;
type ReferenceRole = "reference" | "first_frame" | "last_frame";
type TopazProcessMode = "upscale" | "enhance" | "stabilize" | "interpolate";
type TopazTargetPreset = "2k" | "4k" | "8k" | "2x" | "4x" | "8x";
type MenuKind = "media" | "mode" | "model" | "ratio" | "duration" | "resolution" | "quality" | "topazMode" | "topazModel" | "topazTarget" | "topazCodec" | "topazQuality";
type TopFilterKind = "time" | "media" | "mode" | "status";
type TimeFilter = "all" | "today" | "week";
type MediaFilter = "all" | MediaType;
type TaskKindFilter = "all" | TaskKind;
type ModeFilter = "all" | VideoMode;
type StatusFilter = "all" | VideoTask["status"];
type UsageGranularity = "hour" | "day" | "week" | "month";
type UsageMetricMode = "tokens" | "cost";
type ProjectCardSize = "compact" | "regular" | "wide";

interface OpenMenuState {
  kind: MenuKind;
  x: number;
}

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
  maxPollRetryCount: number;
  maxConcurrentVideoTasks: number;
  maxConcurrentImageTasks: number;
  tokenPricePerThousand: number;
  imageTokenPricePerThousand: number;
  image2APIKeyConfigured: boolean;
  image2APIURL: string;
  image2Model: string;
  topazEnabled: boolean;
  topazCLIPath: string;
  topazWorkDir: string;
  maxConcurrentTopazTasks: string;
  topazDefaultAIModel: string;
  topazCLIAvailable: boolean;
  topazCLIStatus: string;
  uploadDir: string;
  sqlitePath: string;
}

interface RuntimeSettings {
  port: string;
  host: string;
  databasePath: string;
  sqlitePath: string;
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
  maxPollRetryCount: string;
  maxConcurrentVideoTasks: string;
  maxConcurrentImageTasks: string;
  topazEnabled: string;
  topazCLIPath: string;
  topazWorkDir: string;
  maxConcurrentTopazTasks: string;
  topazDefaultAIModel: string;
  tokenPricePerThousand: string;
  imageTokenPricePerThousand: string;
  image2APIKey: string;
  image2APIURL: string;
  image2Model: string;
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
  taskKind?: TaskKind;
  mediaType?: MediaType;
  provider?: string;
  projectId?: string;
  remoteTaskId?: string;
  prompt: string;
  assetIds: string[];
  mode?: VideoMode | "text";
  referenceTransport?: ReferenceTransport;
  modelVersion?: VideoModelVersion;
  ratio?: GenerationRatio;
  duration?: number;
  resolution?: VideoResolution;
  imageSize?: string;
  imageResolution?: ImageResolution;
  imageQuality?: ImageQuality;
  references?: VideoReference[];
  status: "queued" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  tokenUsage?: TokenUsage;
  videoUrl?: string;
  downloadPath?: string;
  imageModel?: string;
  imageUrls?: string[];
  imageDownloadPaths?: string[];
  topaz?: TopazTaskMetadata;
  hiddenAt?: string;
  raw?: unknown;
  createdAt: string;
  updatedAt: string;
}

interface TopazTaskMetadata {
  sourceTaskId?: string;
  sourceLocalPath?: string;
  sourceFileName?: string;
  sourceInfo?: { width?: number; height?: number; duration?: string; bitrate?: string; videoCodec?: string };
  processMode: TopazProcessMode;
  processModes?: TopazProcessMode[];
  aiModel: string;
  targetPreset: TopazTargetPreset;
  scale?: number;
  codec: string;
  bitrate?: string;
  qv?: number;
  crf?: number;
  qualityParams?: Record<string, number | boolean | string>;
  outputPath?: string;
  outputSize?: number;
  durationMs?: number;
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

interface VideoTaskPage {
  items: VideoTask[];
  nextCursor?: string;
  hasMore: boolean;
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
    videos?: number;
    images?: number;
    downloadedVideos?: number;
    downloadedImages?: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costEstimate?: UsageCostEstimate;
  byStatus: Record<VideoTask["status"], number>;
  byMediaType?: Record<MediaType, MediaUsageSummary>;
  byProject: Array<{ projectId: string; projectName: string; requests: number; succeeded: number; failed: number; hidden: number }>;
  byModel: Array<{ modelVersion: string; requests: number; succeeded: number; failed: number }>;
  byDay: Array<{ day: string; requests: number }>;
  projectUsage?: ProjectUsageSummary[];
}

interface MediaUsageSummary {
  requests: number;
  succeeded: number;
  failed: number;
  hidden: number;
  downloaded: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface UsageBucket {
  key: string;
  label: string;
  requests: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

interface ProjectUsageSummary {
  projectId: string;
  projectName: string;
  deletedAt?: string;
  requests: number;
  succeeded: number;
  failed: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  mediaTypes?: Record<MediaType, MediaUsageSummary>;
  taskKinds?: Record<TaskKind, number>;
  buckets: Record<UsageGranularity, UsageBucket[]>;
  bucketsByMediaType?: Record<MediaType, Record<UsageGranularity, UsageBucket[]>>;
}

interface StorageStats {
  database: {
    jsonPath: string;
    sqlitePath: string;
    jsonBytes: number;
    sqliteBytes: number;
  };
  files: {
    downloadDir: string;
    uploadDir: string;
    downloadBytes: number;
    uploadBytes: number;
    totalBytes: number;
  };
  tasks: {
    total: number;
    visible: number;
    hidden: number;
    succeeded: number;
    failed: number;
    running: number;
    queued: number;
    generatedVideos: number;
    downloadedVideos: number;
    generatedImages?: number;
    downloadedImages?: number;
  };
}

interface VideoProject {
  id: string;
  name: string;
  deletedAt?: string;
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

function mergeTasksById(...groups: VideoTask[][]) {
  const byId = new Map<string, VideoTask>();
  for (const group of groups) {
    for (const task of group) {
      byId.set(task.id, { ...byId.get(task.id), ...task });
    }
  }
  return sortTasksForBottomStack(Array.from(byId.values()));
}

function executorTasksUrl({ projectId, limit, before }: { projectId?: string; limit: number; before?: string }) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.set("projectId", projectId);
  if (before) params.set("before", before);
  return `/api/executor/tasks?${params.toString()}`;
}

function managerTasksUrl(input: {
  limit: number;
  before?: string;
  query?: string;
  mediaType?: MediaFilter;
  taskKind?: TaskKindFilter;
  status?: "all" | VideoTask["status"] | "hidden";
  sort?: "newest" | "oldest" | "status" | "project";
}) {
  const params = new URLSearchParams({ limit: String(input.limit) });
  if (input.before) params.set("before", input.before);
  if (input.query?.trim()) params.set("query", input.query.trim());
  if (input.mediaType && input.mediaType !== "all") params.set("mediaType", input.mediaType);
  if (input.taskKind && input.taskKind !== "all") params.set("taskKind", input.taskKind);
  if (input.status && input.status !== "all") params.set("status", input.status);
  if (input.sort) params.set("sort", input.sort);
  return `/api/manager/generation-tasks?${params.toString()}`;
}

const modelOptions: Array<{ value: VideoModelVersion; label: string; short: string }> = [
  { value: "doubao-seedance-2-0-fast-260128", label: "Seedance 2.0 Fast", short: "Fast" },
  { value: "doubao-seedance-2-0-260128", label: "Seedance 2.0", short: "2.0" }
];
const defaultModelVersion: VideoModelVersion = "doubao-seedance-2-0-fast-260128";
const imageModelOptions: Array<{ value: ImageModelVersion; label: string; short: string }> = [
  { value: "gpt-image-2", label: "Image2 标准", short: "标准" },
  { value: "gpt-image-2-pro", label: "Image2 Pro", short: "Pro" }
];
const defaultImageModel: ImageModelVersion = "gpt-image-2";
const topazAIModelOptions = [
  { value: "proteus", label: "Proteus", short: "Proteus" },
  { value: "iris-2", label: "Iris", short: "Iris" },
  { value: "artemis", label: "Artemis", short: "Artemis" },
  { value: "nyx", label: "Nyx", short: "Nyx" },
  { value: "theia", label: "Theia", short: "Theia" },
  { value: "gfx", label: "GFX", short: "GFX" },
  { value: "rhea", label: "Rhea", short: "Rhea" }
];
const topazProcessOptions: Array<{ value: TopazProcessMode; label: string }> = [
  { value: "upscale", label: "放大" },
  { value: "enhance", label: "增强" },
  { value: "stabilize", label: "稳定" },
  { value: "interpolate", label: "补帧" }
];
const topazTargetOptions: Array<{ value: TopazTargetPreset; label: string }> = [
  { value: "2k", label: "2K" },
  { value: "4k", label: "4K" },
  { value: "8k", label: "8K" },
  { value: "2x", label: "2x" },
  { value: "4x", label: "4x" },
  { value: "8x", label: "8x" }
];
const topazCodecOptions = ["h264_videotoolbox", "hevc_videotoolbox", "prores_videotoolbox", "libx264", "libx265"];

const ratioOptions: VideoRatio[] = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const imageRatioOptions: ImageRatio[] = ["2:1", "16:9", "3:2", "1:1", "2:3", "9:16"];
const durationOptions = Array.from({ length: 12 }, (_, index) => index + 4);
const resolutionOptions: VideoResolution[] = ["480p", "720p", "1080p"];
const imageResolutionOptions: Array<{ value: ImageResolution; label: string; short: string }> = [
  { value: "1k", label: "1K", short: "1K" },
  { value: "2k", label: "2K", short: "2K" }
];
const imageQualityOptions: Array<{ value: ImageQuality; label: string; short: string }> = [
  { value: "auto", label: "自动质量", short: "自动" },
  { value: "low", label: "低质量", short: "低" },
  { value: "medium", label: "中等质量", short: "中" },
  { value: "high", label: "高质量", short: "高" }
];
const imageRatioBaseSizes: Record<ImageRatio, readonly [number, number]> = {
  "2:1": [2048, 1024],
  "16:9": [1792, 1024],
  "3:2": [1536, 1024],
  "1:1": [1024, 1024],
  "2:3": [1024, 1536],
  "9:16": [1024, 1792]
};
const imageResolutionScale: Record<ImageResolution, number> = {
  "1k": 1,
  "2k": 2
};
const imageSizeOptions: Array<{ value: ImageSize; ratio: ImageRatio; resolution: ImageResolution; label: string }> = imageRatioOptions.flatMap((ratio) => imageResolutionOptions.map((resolution) => {
  const value = resolveImageSizeLabelValue(ratio, resolution.value);
  return {
    value,
    ratio,
    resolution: resolution.value,
    label: formatImageSize(value)
  };
}));
const defaultImageRatio: ImageRatio = "1:1";
const defaultImageResolution: ImageResolution = "1k";
const defaultImageQuality: ImageQuality = "auto";
const defaultImageSize: ImageSize = "1024x1024";
const multimodalReferenceLimit = 9;

const modeLabels: Record<VideoMode, string> = {
  multimodal: "全能参考",
  frames: "首尾帧"
};

const mediaLabels: Record<MediaType, string> = {
  video: "视频生成",
  image: "图片生成"
};

const composerKindLabels: Record<ComposerKind, string> = {
  video_generation: "视频生成",
  image_generation: "图片生成",
  video_upscale: "视频放大"
};

const taskKindLabels: Record<TaskKind, string> = composerKindLabels;

const EXECUTOR_COMPOSER_STORAGE_KEY = "seendance.executor.composer.v1";

interface PersistedComposerState {
  composerKind?: ComposerKind;
  mediaType?: MediaType;
  mode?: VideoMode;
  referenceTransport?: ReferenceTransport;
  modelVersion?: VideoModelVersion;
  imageModel?: ImageModelVersion;
  ratio?: GenerationRatio;
  duration?: number;
  resolution?: VideoResolution;
  imageResolution?: ImageResolution;
  imageQuality?: ImageQuality;
  topazProcessMode?: TopazProcessMode;
  topazProcessModes?: TopazProcessMode[];
  topazAIModel?: string;
  topazTargetPreset?: TopazTargetPreset;
  topazCodec?: string;
  topazBitrate?: string;
  topazQv?: number;
  prompt?: string;
  slots?: ReferenceSlot[];
}

function App() {
  const persistedComposer = useMemo(() => loadPersistedComposerState(), []);
  const initialComposerKind = normalizeComposerKind(persistedComposer?.composerKind, persistedComposer?.mediaType);
  const initialMediaType = initialComposerKind === "image_generation" ? "image" : "video";
  const initialMode = initialMediaType === "image" ? "multimodal" : normalizeMode(persistedComposer?.mode);
  const initialRatio = initialMediaType === "image" ? normalizeImageRatio(persistedComposer?.ratio) : normalizeVideoRatio(persistedComposer?.ratio);
  const initialTopazProcessModes = normalizeTopazProcessModes(persistedComposer?.topazProcessModes, persistedComposer?.topazProcessMode);
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [state, setState] = useState<AppState>(emptyState);
  const [composerKind, setComposerKind] = useState<ComposerKind>(initialComposerKind);
  const [mediaType, setMediaType] = useState<MediaType>(initialMediaType);
  const [mode, setMode] = useState<VideoMode>(initialMode);
  const [referenceTransport, setReferenceTransport] = useState<ReferenceTransport>(normalizeReferenceTransport(persistedComposer?.referenceTransport));
  const [modelVersion, setModelVersion] = useState<VideoModelVersion>(normalizeModelVersion(persistedComposer?.modelVersion));
  const [imageModel, setImageModel] = useState<ImageModelVersion>(normalizeImageModel(persistedComposer?.imageModel));
  const [ratio, setRatio] = useState<GenerationRatio>(initialRatio);
  const [duration, setDuration] = useState(normalizeDuration(persistedComposer?.duration));
  const [resolution, setResolution] = useState<VideoResolution>(normalizeResolution(persistedComposer?.resolution, normalizeModelVersion(persistedComposer?.modelVersion)));
  const [imageResolution, setImageResolution] = useState<ImageResolution>(normalizeImageResolution(persistedComposer?.imageResolution, persistedComposer?.ratio));
  const [imageQuality, setImageQuality] = useState<ImageQuality>(normalizeImageQuality(persistedComposer?.imageQuality));
  const [topazSourceTaskId, setTopazSourceTaskId] = useState("");
  const [topazSourceLocalPath, setTopazSourceLocalPath] = useState("");
  const [topazSourceName, setTopazSourceName] = useState("");
  const [topazProcessMode, setTopazProcessMode] = useState<TopazProcessMode>(initialTopazProcessModes[0] ?? "enhance");
  const [topazProcessModes, setTopazProcessModes] = useState<TopazProcessMode[]>(initialTopazProcessModes);
  const [topazAIModel, setTopazAIModel] = useState(normalizeTopazAIModel(persistedComposer?.topazAIModel));
  const [topazTargetPreset, setTopazTargetPreset] = useState<TopazTargetPreset>(normalizeTopazTargetPreset(persistedComposer?.topazTargetPreset));
  const [topazCodec, setTopazCodec] = useState(persistedComposer?.topazCodec || "h264_videotoolbox");
  const [topazBitrate, setTopazBitrate] = useState(persistedComposer?.topazBitrate || "");
  const [topazQv, setTopazQv] = useState(normalizeTopazQv(persistedComposer?.topazQv));
  const [prompt, setPrompt] = useState(persistedComposer?.prompt ?? "");
  const [slots, setSlots] = useState<ReferenceSlot[]>(() => restorePersistedSlots(persistedComposer, initialMode));
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [openMenu, setOpenMenu] = useState<OpenMenuState | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [view, setView] = useState<"generate" | "assets">("generate");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>("all");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [openTopFilter, setOpenTopFilter] = useState<TopFilterKind | null>(null);
  const [executorTasks, setExecutorTasks] = useState<VideoTask[]>([]);
  const [executorCursor, setExecutorCursor] = useState<string | undefined>();
  const [executorHasMore, setExecutorHasMore] = useState(false);
  const [executorLoadingOlder, setExecutorLoadingOlder] = useState(false);
  const didInitialScrollRef = useRef(false);
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRef = useRef<HTMLDivElement | null>(null);

  const activeProjects = useMemo(() => state.videoProjects.filter((project) => !project.deletedAt), [state.videoProjects]);
  const activeProjectIds = useMemo(() => new Set(activeProjects.map((project) => project.id)), [activeProjects]);
  const activeProjectId = selectedProjectId ?? activeProjects[0]?.id ?? "";
  const activeProjectIdRef = useRef(activeProjectId);
  activeProjectIdRef.current = activeProjectId;
  const filteredTasks = useMemo(() => filterTasks(executorTasks, { timeFilter, mediaFilter, modeFilter, statusFilter }), [executorTasks, mediaFilter, modeFilter, statusFilter, timeFilter]);
  const sessionTasks = useMemo(() => sortTasksForBottomStack(filteredTasks), [filteredTasks]);
  const generatedAssets = useMemo(() => sortTasksForBottomStack(executorTasks.filter(hasGeneratedAsset)), [executorTasks]);
  const selectedModel = modelOptions.find((item) => item.value === modelVersion) ?? modelOptions[0];
  const selectedImageModel = imageModelOptions.find((item) => item.value === imageModel) ?? imageModelOptions[0];
  const selectedImageQuality = imageQualityOptions.find((item) => item.value === imageQuality) ?? imageQualityOptions[0];
  const availableResolutions = useMemo(() => allowedResolutions(modelVersion), [modelVersion]);

  async function refresh() {
    try {
      const [configResponse, stateResponse, tasksResponse] = await Promise.all([
        fetch("/api/config"),
        fetch("/api/shell-state"),
        fetch(executorTasksUrl({ projectId: activeProjectIdRef.current, limit: 30 }))
      ]);
      if (!configResponse.ok || !stateResponse.ok || !tasksResponse.ok) return;
      setConfig(await configResponse.json());
      setState(normalizeAppState(await stateResponse.json()) as AppState);
      const taskPage = await tasksResponse.json() as VideoTaskPage;
      setExecutorTasks((current) => mergeTasksById(current, taskPage.items));
      setExecutorCursor((cursor) => cursor ?? taskPage.nextCursor);
      setExecutorHasMore(taskPage.hasMore);
    } catch {
      // Ignore transient refresh failures; explicit actions still surface errors.
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (selectedProjectId && activeProjectIds.has(selectedProjectId)) return;
    if (activeProjects[0]?.id) setSelectedProjectId(activeProjects[0].id);
    else setSelectedProjectId(null);
  }, [activeProjectIds, activeProjects, selectedProjectId]);

  useEffect(() => {
    if (!activeProjectId) return;
    didInitialScrollRef.current = false;
    setExecutorTasks([]);
    setExecutorCursor(undefined);
    setExecutorHasMore(false);
    void refresh();
  }, [activeProjectId]);

  useEffect(() => {
    if (didInitialScrollRef.current || !executorTasks.length) return;
    didInitialScrollRef.current = true;
    window.requestAnimationFrame(() => scrollTimelineToBottom());
  }, [executorTasks.length]);

  useEffect(() => {
    savePersistedComposerState({
      composerKind,
      mediaType,
      mode,
      referenceTransport,
      modelVersion,
      imageModel,
      ratio,
      duration,
      resolution,
      imageResolution,
      imageQuality,
      topazProcessMode,
      topazProcessModes,
      topazAIModel,
      topazTargetPreset,
      topazCodec,
      topazBitrate,
      topazQv,
      prompt,
      slots
    });
  }, [composerKind, duration, imageModel, imageQuality, imageResolution, mediaType, mode, modelVersion, prompt, ratio, referenceTransport, resolution, slots, topazAIModel, topazBitrate, topazCodec, topazProcessMode, topazProcessModes, topazQv, topazTargetPreset]);

  useEffect(() => {
    if (view !== "generate") return;
    window.addEventListener("scroll", handleTimelineScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleTimelineScroll);
  }, [view, executorHasMore, executorLoadingOlder, executorCursor, activeProjectId]);

  async function loadOlderExecutorTasks() {
    if (!executorHasMore || executorLoadingOlder || !executorCursor) return;
    const previousHeight = document.documentElement.scrollHeight;
    setExecutorLoadingOlder(true);
    try {
      const response = await fetch(executorTasksUrl({ projectId: activeProjectId, limit: 30, before: executorCursor }));
      if (!response.ok) return;
      const page = await response.json() as VideoTaskPage;
      setExecutorTasks((current) => mergeTasksById(current, page.items));
      setExecutorCursor(page.nextCursor);
      setExecutorHasMore(page.hasMore);
      window.requestAnimationFrame(() => {
        const delta = document.documentElement.scrollHeight - previousHeight;
        if (delta > 0) window.scrollBy({ top: delta });
      });
    } finally {
      setExecutorLoadingOlder(false);
    }
  }

  function handleTimelineScroll() {
    if (view !== "generate" || window.scrollY > 180) return;
    void loadOlderExecutorTasks();
  }

  function switchMode(nextMode: VideoMode) {
    setMode(nextMode);
    setSlots(initialSlots(nextMode));
    setOpenMenu(null);
  }

  function switchComposerKind(nextKind: ComposerKind) {
    setComposerKind(nextKind);
    const nextMediaType: MediaType = nextKind === "image_generation" ? "image" : "video";
    setMediaType(nextMediaType);
    if (nextKind === "video_upscale") {
      setMode("multimodal");
      setSlots([]);
      setOpenMenu(null);
      return;
    }
    if (nextMediaType === "image") {
      setMode("multimodal");
      setSlots(initialSlots("multimodal"));
      setRatio(normalizeImageRatio(ratio));
    } else {
      setRatio(normalizeVideoRatio(ratio));
      setSlots(initialSlots(mode));
    }
    setOpenMenu(null);
  }

  function toggleMenu(kind: MenuKind, event: React.MouseEvent<HTMLButtonElement>) {
    if (openMenu?.kind === kind) {
      setOpenMenu(null);
      return;
    }
    const buttonBox = event.currentTarget.getBoundingClientRect();
    const composerBox = composerRef.current?.getBoundingClientRect();
    const centerX = composerBox ? buttonBox.left + buttonBox.width / 2 - composerBox.left : buttonBox.width / 2;
    setOpenMenu({ kind, x: centerX });
  }

  function chooseModel(nextModel: VideoModelVersion) {
    setModelVersion(nextModel);
    if (!allowedResolutions(nextModel).includes(resolution)) {
      setResolution("720p");
    }
  }

  function chooseRatio(nextRatio: GenerationRatio) {
    if (mediaType === "image") {
      const normalized = normalizeImageRatio(nextRatio);
      setRatio(normalized);
      return;
    }
    setRatio(normalizeVideoRatio(nextRatio));
  }

  function chooseImageResolution(nextResolution: ImageResolution) {
    setImageResolution(nextResolution);
  }

  async function submitGenerationTask(overrides?: Partial<ComposerPayload>) {
    const payload = buildComposerPayload(overrides);
    const nextMediaType = payload.mediaType ?? "video";
    const nextTaskKind = payload.taskKind ?? (nextMediaType === "image" ? "image_generation" : "video_generation");
    setBusy("generation");
    setToast("");
    try {
      const response = await fetch(nextMediaType === "image" || nextTaskKind === "video_upscale" ? "/api/generation-tasks" : "/api/video-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await readJsonOrThrow<VideoTask>(response, nextTaskKind === "video_upscale" ? "提交视频放大任务失败" : nextMediaType === "image" ? "提交图片任务失败" : "提交视频任务失败");
      setSelectedTaskId(result.id);
      setExecutorTasks((current) => mergeTasksById([result], current));
      await refresh();
      window.requestAnimationFrame(() => scrollTimelineToBottom("smooth"));
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  function buildComposerPayload(overrides: Partial<ComposerPayload> = {}): ComposerPayload {
    const nextMediaType = overrides.mediaType ?? mediaType;
    const nextTaskKind = overrides.taskKind ?? composerKind;
    if (nextTaskKind === "video_upscale") {
      return {
        taskKind: "video_upscale",
        mediaType: "video",
        projectId: activeProjectId || undefined,
        sourceTaskId: topazSourceTaskId || undefined,
        sourceLocalPath: topazSourceTaskId ? undefined : topazSourceLocalPath || undefined,
        processMode: topazProcessModes[0] ?? topazProcessMode,
        processModes: topazProcessModes,
        aiModel: topazAIModel,
        targetPreset: topazTargetPreset,
        codec: topazCodec,
        bitrate: topazBitrate.trim() || undefined,
        qv: topazQv,
        crf: undefined,
        qualityParams: {}
      } as ComposerPayload;
    }
    return {
      taskKind: nextMediaType === "image" ? "image_generation" : "video_generation",
      mediaType: nextMediaType,
      projectId: activeProjectId || undefined,
      mode,
      referenceTransport,
      prompt: prompt.trim(),
      modelVersion,
      ratio: nextMediaType === "image" ? normalizeImageRatio(ratio) : normalizeVideoRatio(ratio),
      duration,
      resolution,
      imageModel,
      imageResolution,
      imageQuality,
      references: slots
        .filter((slot) => slot.url)
        .map((slot) => ({
          role: nextMediaType === "image" ? "reference" as const : slot.role,
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
    if (taskKindOf(task) === "video_upscale") {
      setComposerKind("video_upscale");
      setMediaType("video");
      setTopazSourceTaskId(task.topaz?.sourceTaskId ?? "");
      setTopazSourceLocalPath(task.topaz?.sourceTaskId ? "" : task.topaz?.sourceLocalPath ?? "");
      setTopazSourceName(task.topaz?.sourceFileName ?? task.topaz?.sourceLocalPath?.split("/").pop() ?? "");
      const nextModes = normalizeTopazProcessModes(task.topaz?.processModes, task.topaz?.processMode);
      setTopazProcessModes(nextModes);
      setTopazProcessMode(nextModes[0] ?? "enhance");
      setTopazAIModel(task.topaz?.aiModel ?? "proteus");
      setTopazTargetPreset(task.topaz?.targetPreset ?? "2x");
      setTopazCodec(task.topaz?.codec ?? "h264_videotoolbox");
      setTopazBitrate(task.topaz?.bitrate ?? "");
      setTopazQv(task.topaz?.qv ?? 82);
      setSlots([]);
      scrollTimelineToBottom("smooth");
      return;
    }
    const taskMediaType = mediaTypeOf(task);
    setComposerKind(taskMediaType === "image" ? "image_generation" : "video_generation");
    setMediaType(taskMediaType);
    setMode(taskMediaType === "image" ? "multimodal" : (task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal");
    setReferenceTransport(task.referenceTransport ?? "url");
    setModelVersion(normalizeModelVersion(task.modelVersion));
    setImageModel(normalizeImageModel(task.imageModel));
    setRatio(taskMediaType === "image" ? normalizeImageRatio(task.ratio) : normalizeVideoRatio(task.ratio));
    setDuration(task.duration ?? 5);
    setResolution(normalizeResolution(task.resolution, normalizeModelVersion(task.modelVersion)));
    setImageResolution(normalizeImageResolution(task.imageResolution, task.ratio, task.imageSize));
    setImageQuality(normalizeImageQuality(task.imageQuality));
    setPrompt(task.prompt);
    setSlots(slotsFromTask(task));
    scrollTimelineToBottom("smooth");
  }

  function regenerateTask(task: VideoTask) {
    if (taskKindOf(task) === "video_upscale") {
      void submitGenerationTask({
        taskKind: "video_upscale",
        mediaType: "video",
        sourceTaskId: task.topaz?.sourceTaskId,
        sourceLocalPath: task.topaz?.sourceTaskId ? undefined : task.topaz?.sourceLocalPath,
        processMode: task.topaz?.processMode ?? "enhance",
        processModes: task.topaz?.processModes ?? [task.topaz?.processMode ?? "enhance"],
        aiModel: task.topaz?.aiModel ?? "proteus",
        targetPreset: task.topaz?.targetPreset ?? "2x",
        codec: task.topaz?.codec ?? "h264_videotoolbox",
        bitrate: task.topaz?.bitrate,
        qv: task.topaz?.qv ?? 82,
        qualityParams: task.topaz?.qualityParams ?? {}
      });
      return;
    }
    const taskMediaType = mediaTypeOf(task);
    void submitGenerationTask({
      mediaType: taskMediaType,
      mode: taskMediaType === "image" ? "multimodal" : (task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal",
      referenceTransport: task.referenceTransport ?? "url",
      prompt: task.prompt,
      modelVersion: normalizeModelVersion(task.modelVersion),
      ratio: taskMediaType === "image" ? normalizeImageRatio(task.ratio) : normalizeVideoRatio(task.ratio),
      duration: task.duration ?? 5,
      resolution: normalizeResolution(task.resolution, normalizeModelVersion(task.modelVersion)),
      imageModel: normalizeImageModel(task.imageModel),
      imageResolution: normalizeImageResolution(task.imageResolution, task.ratio, task.imageSize),
      imageQuality: normalizeImageQuality(task.imageQuality),
      references: task.references ?? []
    });
  }

  function useTaskAsTopazSource(task: VideoTask) {
    setComposerKind("video_upscale");
    setMediaType("video");
    setMode("multimodal");
    setTopazSourceTaskId(task.id);
    setTopazSourceLocalPath("");
    setTopazSourceName(`${task.prompt.slice(0, 48) || "已生成视频"} · ${formatDate(task.createdAt)}`);
    setSlots([]);
    setView("generate");
    scrollTimelineToBottom("smooth");
  }

  async function deleteTask(taskId: string) {
    setBusy(`delete-${taskId}`);
    setToast("");
    try {
      const response = await fetch(`/api/generation-tasks/${taskId}`, { method: "DELETE" });
      await readJsonOrThrow(response, "删除记录失败");
      setSelectedTaskId((id) => id === taskId ? null : id);
      setExecutorTasks((tasks) => tasks.filter((task) => task.id !== taskId));
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
      const project = await readJsonOrThrow<VideoProject>(response, "创建项目失败");
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
      await readJsonOrThrow<VideoProject>(response, "重命名项目失败");
      await refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function deleteProject(projectId: string) {
    if (!window.confirm("删除项目只会隐藏文件夹，不会删除其中的任务、视频和下载文件。")) return;
    setBusy(`delete-project-${projectId}`);
    setToast("");
    try {
      const response = await fetch(`/api/video-projects/${projectId}`, { method: "DELETE" });
      await readJsonOrThrow<VideoProject>(response, "删除项目失败");
      setSelectedProjectId((id) => id === projectId ? null : id);
      setSelectedTaskId(null);
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
      const result = await readJsonOrThrow<{ url: string; localUrl?: string; localPath?: string }>(response, "上传图片失败");
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

  async function uploadTopazSource(file: File) {
    setBusy("topaz-upload");
    setToast("");
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch("/api/uploads/video", { method: "POST", body });
      const result = await readJsonOrThrow<{ localPath: string; localUrl?: string }>(response, "上传源视频失败");
      setTopazSourceTaskId("");
      setTopazSourceLocalPath(result.localPath);
      setTopazSourceName(file.name);
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  function clearTopazSource() {
    setTopazSourceTaskId("");
    setTopazSourceLocalPath("");
    setTopazSourceName("");
  }

  function toggleTopazProcessMode(value: TopazProcessMode) {
    setTopazProcessModes((current) => {
      const next = current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value];
      const safe = next.length ? next : current;
      setTopazProcessMode(safe[0] ?? "enhance");
      return safe;
    });
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
    if (composerKind === "video_upscale") {
      return Boolean(config?.topazEnabled && (topazSourceTaskId || topazSourceLocalPath));
    }
    if (!prompt.trim() || slots.some((slot) => slot.uploading)) return false;
    if (mediaType === "image") return Boolean(config?.image2APIKeyConfigured);
    if (!config?.arkAPIKeyConfigured) return false;
    const filled = slots.filter((slot) => slot.url);
    if (mode === "frames") return filled.some((slot) => slot.role === "first_frame") && filled.some((slot) => slot.role === "last_frame");
    return filled.length > 0 && filled.length <= multimodalReferenceLimit;
  }, [composerKind, config?.arkAPIKeyConfigured, config?.image2APIKeyConfigured, config?.topazEnabled, mediaType, mode, prompt, slots, topazSourceLocalPath, topazSourceTaskId]);

  return (
    <main className="dream-shell">
      <ConversationRail
        projects={activeProjects}
        selectedProjectId={activeProjectId}
        view={view}
        onView={setView}
        onCreateProject={createProject}
        onRenameProject={renameProject}
        onDeleteProject={deleteProject}
        onSelectProject={(projectId) => {
          setSelectedProjectId(projectId);
          setSelectedTaskId(null);
          setView("generate");
          scrollTimelineToBottom("smooth");
        }}
      />
      <header className="dream-topbar">
        <TopFilters
          open={openTopFilter}
          timeFilter={timeFilter}
          mediaFilter={mediaFilter}
          modeFilter={modeFilter}
          statusFilter={statusFilter}
          onOpen={setOpenTopFilter}
          onTime={setTimeFilter}
          onMedia={setMediaFilter}
          onMode={setModeFilter}
          onStatus={setStatusFilter}
        />
      </header>

      {view === "assets" ? (
        <AssetLibrary tasks={generatedAssets} pollLogs={state.pollLogs} onEdit={restoreTask} onRegenerate={regenerateTask} onDelete={deleteTask} onDownloadDebug={downloadTaskDebug} onUpscale={useTaskAsTopazSource} />
      ) : (
        <section className="timeline" onScroll={handleTimelineScroll}>
          <div className="date-heading">5月19日</div>
          {executorHasMore && (
            <button className="load-history" disabled={executorLoadingOlder} onClick={loadOlderExecutorTasks}>
              {executorLoadingOlder ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}加载更早记录
            </button>
          )}
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
              onUpscale={() => useTaskAsTopazSource(task)}
            />
          ))}
        </section>
      )}

      {view === "generate" && <section className="composer-wrap">
        {toast && <div className="toast"><span>{toast}</span><button onClick={() => setToast("")} title="关闭提示">×</button></div>}
        <div className={`composer ${mediaType === "image" ? "image-composer" : ""} ${composerKind === "video_upscale" ? "topaz-composer" : ""}`} ref={composerRef}>
          {composerKind === "video_upscale" ? (
            <TopazComposerPanel
              sourceTaskId={topazSourceTaskId}
              sourceLocalPath={topazSourceLocalPath}
              sourceName={topazSourceName}
              busy={busy}
              onUpload={uploadTopazSource}
              onClearSource={clearTopazSource}
            />
          ) : (
            <>
              <ReferenceSlots slots={slots} mode={mode} onSwapFrames={swapFrameSlots} onUpload={uploadSlot} onClear={(slotId) => setSlots((items) => items.map((slot) => slot.id === slotId ? { ...slot, url: undefined, remoteUrl: undefined, localPath: undefined, localUrl: undefined, error: "" } : slot))} onInsertReference={insertReference} />
              <textarea
                ref={promptRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={mediaType === "image" ? "输入图片生成提示词。可以只写文字，也可以上传参考图后用 @图片 引用它们。" : mode === "frames" ? "输入文字，描述首帧到尾帧之间的画面内容、运动方式等。例如：镜头缓慢推近，人物抬头看向窗外。" : "上传最多9个参考素材，点击上方 @图片 按钮插入引用，再描述它们的关系。例如：图片 1 模仿图片 2 的动作。"}
              />
            </>
          )}
          <div className="composer-controls">
            <MenuButton active={openMenu?.kind === "media"} onClick={(event) => toggleMenu("media", event)} icon={composerKind === "image_generation" ? <FileImage size={18} /> : composerKind === "video_upscale" ? <Gauge size={18} /> : <Sparkles size={18} />} label={composerKindLabels[composerKind]} />
            {composerKind === "video_upscale" && <MenuButton active={openMenu?.kind === "topazMode"} onClick={(event) => toggleMenu("topazMode", event)} icon={<Settings2 size={18} />} label={topazModeLabel(topazProcessModes)} />}
            {composerKind === "video_upscale" && <MenuButton active={openMenu?.kind === "topazModel"} onClick={(event) => toggleMenu("topazModel", event)} icon={<Film size={18} />} label={topazAIModelLabel(topazAIModel)} />}
            {composerKind === "video_upscale" && <MenuButton active={openMenu?.kind === "topazTarget"} onClick={(event) => toggleMenu("topazTarget", event)} icon={<Gauge size={18} />} label={topazTargetLabel(topazTargetPreset)} />}
            {composerKind === "video_upscale" && <MenuButton active={openMenu?.kind === "topazCodec"} onClick={(event) => toggleMenu("topazCodec", event)} icon={<FilePenLine size={18} />} label={topazCodecLabel(topazCodec)} />}
            {composerKind === "video_upscale" && <MenuButton active={openMenu?.kind === "topazQuality"} onClick={(event) => toggleMenu("topazQuality", event)} icon={<Sparkles size={18} />} label={`q:v ${topazQv ?? 82}`} />}
            {composerKind !== "video_upscale" && <MenuButton active={openMenu?.kind === "model"} onClick={(event) => toggleMenu("model", event)} icon={mediaType === "image" ? <FileImage size={18} /> : <Film size={18} />} label={mediaType === "image" ? selectedImageModel.label : selectedModel.label} />}
            {composerKind === "video_generation" && <MenuButton active={openMenu?.kind === "mode"} onClick={(event) => toggleMenu("mode", event)} icon={<FileImage size={18} />} label={modeLabels[mode]} />}
            {composerKind !== "video_upscale" && <MenuButton active={openMenu?.kind === "ratio"} onClick={(event) => toggleMenu("ratio", event)} icon={<RatioIcon ratio={ratio} />} label={ratio} />}
            {composerKind === "video_generation" && <MenuButton active={openMenu?.kind === "duration"} onClick={(event) => toggleMenu("duration", event)} icon={<Clock3 size={18} />} label={`${duration}s`} />}
            {composerKind !== "video_upscale" && <MenuButton active={openMenu?.kind === "resolution"} onClick={(event) => toggleMenu("resolution", event)} icon={<Gauge size={18} />} label={mediaType === "image" ? imageResolutionLabel(imageResolution) : resolution} />}
            {composerKind === "image_generation" && <MenuButton active={openMenu?.kind === "quality"} onClick={(event) => toggleMenu("quality", event)} icon={<Sparkles size={18} />} label={selectedImageQuality.short} />}
            {composerKind === "video_generation" && <button className={`transport-toggle ${referenceTransport === "url" ? "active" : ""}`} onClick={() => setReferenceTransport(referenceTransport === "asset" ? "url" : "asset")} title="切换参考图片链路">
              {referenceTransport === "asset" ? "Asset" : "URL"}
            </button>}
            <button className="submit-button" disabled={!canSubmit || busy === "generation"} onClick={() => submitGenerationTask()}>
              {busy === "generation" ? <Loader2 className="spin" size={20} /> : <ArrowUp size={22} />}
            </button>
          </div>
          {openMenu && (
            <FloatingMenu kind={openMenu.kind} anchorX={openMenu.x} composerKind={composerKind} mediaType={mediaType} mode={mode} modelVersion={modelVersion} imageModel={imageModel} ratio={ratio} duration={duration} resolution={resolution} imageResolution={imageResolution} imageQuality={imageQuality} topazProcessModes={topazProcessModes} topazAIModel={topazAIModel} topazTargetPreset={topazTargetPreset} topazCodec={topazCodec} topazQv={topazQv ?? 82} topazBitrate={topazBitrate} availableResolutions={availableResolutions} onComposerKind={switchComposerKind} onMode={switchMode} onModel={chooseModel} onImageModel={setImageModel} onRatio={chooseRatio} onDuration={setDuration} onResolution={setResolution} onImageResolution={chooseImageResolution} onImageQuality={setImageQuality} onTopazProcessModeToggle={toggleTopazProcessMode} onTopazAIModel={setTopazAIModel} onTopazTargetPreset={setTopazTargetPreset} onTopazCodec={setTopazCodec} onTopazQv={setTopazQv} onTopazBitrate={setTopazBitrate} onClose={() => setOpenMenu(null)} />
          )}
        </div>
      </section>}
    </main>
  );
}

interface ComposerPayload {
  taskKind?: TaskKind;
  mediaType: MediaType;
  projectId?: string;
  mode?: VideoMode;
  referenceTransport?: ReferenceTransport;
  prompt?: string;
  modelVersion?: VideoModelVersion;
  ratio?: GenerationRatio;
  duration?: number;
  resolution?: VideoResolution;
  imageModel?: ImageModelVersion;
  imageResolution?: ImageResolution;
  imageQuality?: ImageQuality;
  references?: VideoReference[];
  sourceTaskId?: string;
  sourceLocalPath?: string;
  processMode?: TopazProcessMode;
  processModes?: TopazProcessMode[];
  aiModel?: string;
  targetPreset?: TopazTargetPreset;
  codec?: string;
  bitrate?: string;
  qv?: number;
  crf?: number;
  qualityParams?: Record<string, number | boolean | string>;
}

function TopFilters({ open, timeFilter, mediaFilter, modeFilter, statusFilter, onOpen, onTime, onMedia, onMode, onStatus }: {
  open: TopFilterKind | null;
  timeFilter: TimeFilter;
  mediaFilter: MediaFilter;
  modeFilter: ModeFilter;
  statusFilter: StatusFilter;
  onOpen: (kind: TopFilterKind | null) => void;
  onTime: (value: TimeFilter) => void;
  onMedia: (value: MediaFilter) => void;
  onMode: (value: ModeFilter) => void;
  onStatus: (value: StatusFilter) => void;
}) {
  return (
    <div className="search-pill">
      <button title="筛选"><Search size={17} /></button>
      <TopFilterButton active={open === "time"} label={timeFilterLabel(timeFilter)} onClick={() => onOpen(open === "time" ? null : "time")} />
      <TopFilterButton active={open === "media"} label={mediaFilterLabel(mediaFilter)} onClick={() => onOpen(open === "media" ? null : "media")} />
      <TopFilterButton active={open === "mode"} label={modeFilterLabel(modeFilter)} onClick={() => onOpen(open === "mode" ? null : "mode")} />
      <TopFilterButton active={open === "status"} label={statusFilterLabel(statusFilter)} onClick={() => onOpen(open === "status" ? null : "status")} />
      {open === "time" && (
        <div className="top-filter-menu time-filter-menu">
          {(["all", "today", "week"] as TimeFilter[]).map((item) => <button key={item} className={timeFilter === item ? "selected" : ""} onClick={() => { onTime(item); onOpen(null); }}>{timeFilterLabel(item)}</button>)}
        </div>
      )}
      {open === "mode" && (
        <div className="top-filter-menu mode-filter-menu">
          {(["all", "multimodal", "frames"] as ModeFilter[]).map((item) => <button key={item} className={modeFilter === item ? "selected" : ""} onClick={() => { onMode(item); onOpen(null); }}>{modeFilterLabel(item)}</button>)}
        </div>
      )}
      {open === "media" && (
        <div className="top-filter-menu media-filter-menu">
          {(["all", "video", "image"] as MediaFilter[]).map((item) => <button key={item} className={mediaFilter === item ? "selected" : ""} onClick={() => { onMedia(item); onOpen(null); }}>{mediaFilterLabel(item)}</button>)}
        </div>
      )}
      {open === "status" && (
        <div className="top-filter-menu status-filter-menu">
          {(["all", "queued", "running", "succeeded", "failed"] as StatusFilter[]).map((item) => <button key={item} className={statusFilter === item ? "selected" : ""} onClick={() => { onStatus(item); onOpen(null); }}>{statusFilterLabel(item)}</button>)}
        </div>
      )}
    </div>
  );
}

function TopFilterButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return <button className={active ? "active" : ""} onClick={onClick}>{label}<ChevronDown size={14} /></button>;
}

function ConversationRail({ projects, selectedProjectId, view, onView, onCreateProject, onRenameProject, onDeleteProject, onSelectProject }: {
  projects: VideoProject[];
  selectedProjectId: string;
  view: "generate" | "assets";
  onView: (view: "generate" | "assets") => void;
  onCreateProject: () => void;
  onRenameProject: (projectId: string, name: string) => void;
  onDeleteProject: (projectId: string) => void;
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
            <div
              key={project.id}
              className={`session-row ${selected ? "selected" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectProject(project.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") onSelectProject(project.id);
              }}
            >
              <span className="session-thumb icon"><Folder size={18} /></span>
              <strong>{project.name}</strong>
              <ProjectNameEditor project={project} onRename={onRenameProject} onDelete={onDeleteProject} />
            </div>
          );
        })}
      </section>
    </aside>
  );
}

function ProjectNameEditor({ project, onRename, onDelete }: { project: VideoProject; onRename: (projectId: string, name: string) => void; onDelete: (projectId: string) => void }) {
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
    <span className="project-actions">
      <button
        type="button"
        className="project-rename"
        title="重命名项目"
        onClick={(event) => {
          event.stopPropagation();
          setEditing(true);
        }}
      >
        <FilePenLine size={15} />
      </button>
      <button
        type="button"
        className="project-delete"
        title="删除项目"
        onClick={(event) => {
          event.stopPropagation();
          onDelete(project.id);
        }}
      >
        <Trash2 size={14} />
      </button>
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

function filterTasks(tasks: VideoTask[], filters: { timeFilter: TimeFilter; mediaFilter: MediaFilter; modeFilter: ModeFilter; statusFilter: StatusFilter }) {
  const now = Date.now();
  return tasks.filter((task) => {
    if (filters.mediaFilter !== "all" && mediaTypeOf(task) !== filters.mediaFilter) return false;
    if (filters.modeFilter !== "all" && task.mode !== filters.modeFilter) return false;
    if (filters.statusFilter !== "all" && task.status !== filters.statusFilter) return false;
    if (filters.timeFilter === "today") return new Date(task.createdAt).toDateString() === new Date(now).toDateString();
    if (filters.timeFilter === "week") return now - new Date(task.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
    return true;
  });
}

function mediaTypeOf(task: Pick<VideoTask, "mediaType">): MediaType {
  return task.mediaType === "image" ? "image" : "video";
}

function taskKindOf(task: Pick<VideoTask, "taskKind" | "mediaType" | "provider">): TaskKind {
  if (task.taskKind) return task.taskKind;
  if (task.provider === "topaz") return "video_upscale";
  return task.mediaType === "image" ? "image_generation" : "video_generation";
}

function hasGeneratedAsset(task: VideoTask) {
  return mediaTypeOf(task) === "image"
    ? Boolean((task.imageUrls?.length ?? 0) || (task.imageDownloadPaths?.length ?? 0))
    : Boolean(task.videoUrl || task.downloadPath);
}

function timeFilterLabel(value: TimeFilter) {
  if (value === "today") return "今天";
  if (value === "week") return "近7天";
  return "时间";
}

function mediaFilterLabel(value: MediaFilter) {
  if (value === "video") return "视频";
  if (value === "image") return "图片";
  return "类型";
}

function taskKindFilterLabel(value: TaskKindFilter) {
  if (value === "video_generation") return "视频生成";
  if (value === "image_generation") return "图片生成";
  if (value === "video_upscale") return "视频放大";
  return "全部任务";
}

function modeFilterLabel(value: ModeFilter) {
  if (value === "multimodal") return "全能参考";
  if (value === "frames") return "首尾帧";
  return "生成模式";
}

function statusFilterLabel(value: StatusFilter) {
  if (value === "queued") return "排队中";
  if (value === "running") return "运行中";
  if (value === "succeeded") return "成功";
  if (value === "failed") return "失败";
  return "操作类型";
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

function loadPersistedComposerState(): PersistedComposerState | null {
  try {
    const raw = localStorage.getItem(EXECUTOR_COMPOSER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as PersistedComposerState : null;
  } catch {
    return null;
  }
}

function savePersistedComposerState(state: PersistedComposerState) {
  try {
    localStorage.setItem(EXECUTOR_COMPOSER_STORAGE_KEY, JSON.stringify({
      ...state,
      slots: serializePersistedSlots(state.slots ?? [])
    }));
  } catch {
    // Persistence is a convenience; generation should not fail if storage is unavailable.
  }
}

function serializePersistedSlots(slots: ReferenceSlot[]) {
  return slots
    .filter((slot) => slot.url || slot.remoteUrl || slot.localUrl || slot.localPath)
    .map((slot) => ({
      id: slot.id,
      role: slot.role,
      label: slot.label,
      token: slot.token,
      url: slot.url,
      remoteUrl: slot.remoteUrl,
      localPath: slot.localPath,
      localUrl: slot.localUrl
    }));
}

function restorePersistedSlots(state: PersistedComposerState | null, mode: VideoMode): ReferenceSlot[] {
  const base = initialSlots(mode);
  for (const saved of state?.slots ?? []) {
    const target = base.find((slot) => slot.id === saved.id) ?? base.find((slot) => slot.role === saved.role && !slot.url);
    if (!target) continue;
    target.url = saved.url;
    target.remoteUrl = saved.remoteUrl;
    target.localPath = saved.localPath;
    target.localUrl = saved.localUrl;
  }
  return base;
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

function TopazComposerPanel({ sourceTaskId, sourceLocalPath, sourceName, busy, onUpload, onClearSource }: {
  sourceTaskId: string;
  sourceLocalPath: string;
  sourceName: string;
  busy: string;
  onUpload: (file: File) => void;
  onClearSource: () => void;
}) {
  return (
    <section className="topaz-panel">
      <div className="reference-strip topaz-video-strip">
        <TopazUploadSlot
          selected={Boolean(sourceTaskId || sourceLocalPath)}
          label={busy === "topaz-upload" ? "上传中" : sourceName || "上传源视频"}
          uploading={busy === "topaz-upload"}
          onUpload={onUpload}
          onClear={onClearSource}
        />
      </div>
    </section>
  );
}

function TopazUploadSlot({ selected, label, uploading, onUpload, onClear }: { selected: boolean; label: string; uploading: boolean; onUpload: (file: File) => void; onClear: () => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <button
      type="button"
      className={`upload-slot topaz-video-slot ${selected ? "filled" : ""}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) onUpload(file);
      }}
    >
      {uploading ? <Loader2 className="spin" size={20} /> : selected ? <Film size={22} /> : <UploadCloud size={22} />}
      <span>{label}</span>
      {selected && <Trash2 className="slot-clear" size={14} onClick={(event) => { event.stopPropagation(); onClear(); }} />}
      <input ref={inputRef} type="file" accept="video/*" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        if (file) onUpload(file);
        event.currentTarget.value = "";
      }} />
    </button>
  );
}

function MenuButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  return <button className={`menu-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span><ChevronDown size={16} /></button>;
}

function FloatingMenu({ kind, anchorX, composerKind, mediaType, mode, modelVersion, imageModel, ratio, duration, resolution, imageResolution, imageQuality, topazProcessModes, topazAIModel, topazTargetPreset, topazCodec, topazQv, topazBitrate, availableResolutions, onComposerKind, onMode, onModel, onImageModel, onRatio, onDuration, onResolution, onImageResolution, onImageQuality, onTopazProcessModeToggle, onTopazAIModel, onTopazTargetPreset, onTopazCodec, onTopazQv, onTopazBitrate, onClose }: {
  kind: MenuKind;
  anchorX: number;
  composerKind: ComposerKind;
  mediaType: MediaType;
  mode: VideoMode;
  modelVersion: VideoModelVersion;
  imageModel: ImageModelVersion;
  ratio: GenerationRatio;
  duration: number;
  resolution: VideoResolution;
  imageResolution: ImageResolution;
  imageQuality: ImageQuality;
  topazProcessModes: TopazProcessMode[];
  topazAIModel: string;
  topazTargetPreset: TopazTargetPreset;
  topazCodec: string;
  topazQv: number;
  topazBitrate: string;
  availableResolutions: VideoResolution[];
  onComposerKind: (value: ComposerKind) => void;
  onMode: (value: VideoMode) => void;
  onModel: (value: VideoModelVersion) => void;
  onImageModel: (value: ImageModelVersion) => void;
  onRatio: (value: GenerationRatio) => void;
  onDuration: (value: number) => void;
  onResolution: (value: VideoResolution) => void;
  onImageResolution: (value: ImageResolution) => void;
  onImageQuality: (value: ImageQuality) => void;
  onTopazProcessModeToggle: (value: TopazProcessMode) => void;
  onTopazAIModel: (value: string) => void;
  onTopazTargetPreset: (value: TopazTargetPreset) => void;
  onTopazCodec: (value: string) => void;
  onTopazQv: (value: number) => void;
  onTopazBitrate: (value: string) => void;
  onClose: () => void;
}) {
  const style = { "--menu-anchor-x": `${Math.round(anchorX)}px` } as React.CSSProperties;
  if (kind === "media") {
    return <div className="floating-menu media-menu" style={style}><p>选择生成类型</p>{(["video_generation", "image_generation", "video_upscale"] as ComposerKind[]).map((item) => <button key={item} className={composerKind === item ? "selected" : ""} onClick={() => onComposerKind(item)}>{item === "image_generation" ? <FileImage size={18} /> : item === "video_upscale" ? <Gauge size={18} /> : <Film size={18} />}{composerKindLabels[item]}{composerKind === item && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "ratio") {
    if (mediaType === "image") {
      return <div className="floating-menu ratio-menu image-ratio-menu" style={style}><p>选择图片比例</p>{imageRatioOptions.map((item) => {
        const size = imageSizeFor(item, imageResolution);
        return <button key={item} className={ratio === item ? "selected" : ""} onClick={() => { onRatio(item); onClose(); }}><RatioIcon ratio={item} /><span>{item}</span><em>{imageResolutionLabel(imageResolution)} · {size.label}</em>{ratio === item && <Check className="option-check" size={18} />}</button>;
      })}</div>;
    }
    return <div className="floating-menu ratio-menu" style={style}><p>选择比例</p>{ratioOptions.map((item) => <button key={item} className={ratio === item ? "selected" : ""} onClick={() => { onRatio(item); onClose(); }}><RatioIcon ratio={item} />{item}</button>)}</div>;
  }
  if (kind === "duration") {
    return <div className="floating-menu duration-menu" style={style}><p>选择视频生成时长</p>{durationOptions.map((item) => <button key={item} className={duration === item ? "selected" : ""} onClick={() => { onDuration(item); onClose(); }}><Clock3 size={18} />{item}s{duration === item && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "resolution") {
    if (mediaType === "image") {
      const imageRatio = normalizeImageRatio(ratio);
      return <div className="floating-menu resolution-menu" style={style}><p>选择图片清晰度</p>{imageResolutionOptions.map((item) => {
        const size = imageSizeFor(imageRatio, item.value);
        return <button key={item.value} className={imageResolution === item.value ? "selected" : ""} title={size.label} onClick={() => { onImageResolution(item.value); onClose(); }}><Gauge size={18} /><span>{item.label}</span><em>{size.label}</em>{imageResolution === item.value && <Check className="option-check" size={18} />}</button>;
      })}</div>;
    }
    return <div className="floating-menu resolution-menu" style={style}><p>选择清晰度</p>{resolutionOptions.map((item) => {
      const disabled = !availableResolutions.includes(item);
      return <button key={item} disabled={disabled} className={resolution === item ? "selected" : ""} title={disabled ? "Seedance 2.0 Fast 不支持 1080p" : undefined} onClick={() => { if (disabled) return; onResolution(item); onClose(); }}><Gauge size={18} />{item}{resolution === item && <Check className="option-check" size={18} />}</button>;
    })}</div>;
  }
  if (kind === "quality") {
    return <div className="floating-menu quality-menu" style={style}><p>选择图片质量</p>{imageQualityOptions.map((item) => <button key={item.value} className={imageQuality === item.value ? "selected" : ""} onClick={() => { onImageQuality(item.value); onClose(); }}><Sparkles size={18} /><span>{item.label}</span><em>{item.value}</em>{imageQuality === item.value && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "topazMode") {
    return <div className="floating-menu topaz-mode-menu" style={style}><p>选择处理模式</p>{topazProcessOptions.map((item) => <button key={item.value} className={topazProcessModes.includes(item.value) ? "selected" : ""} onClick={() => onTopazProcessModeToggle(item.value)}><Settings2 size={18} /><span>{item.label}</span><em>{item.value}</em>{topazProcessModes.includes(item.value) && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "topazModel") {
    return <div className="floating-menu model-menu" style={style}><p>选择 Topaz AI 模型</p>{topazAIModelOptions.map((item) => <button key={item.value} className={topazAIModel === item.value ? "selected" : ""} onClick={() => { onTopazAIModel(item.value); onClose(); }}><Film size={18} /><span>{item.label}</span><em>{item.value}</em>{topazAIModel === item.value && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "topazTarget") {
    return <div className="floating-menu resolution-menu" style={style}><p>选择目标规格</p>{topazTargetOptions.map((item) => <button key={item.value} className={topazTargetPreset === item.value ? "selected" : ""} onClick={() => { onTopazTargetPreset(item.value); onClose(); }}><Gauge size={18} /><span>{item.label}</span><em>{item.value.endsWith("x") ? "倍数" : "长边换算"}</em>{topazTargetPreset === item.value && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "topazCodec") {
    return <div className="floating-menu model-menu" style={style}><p>选择编码</p>{topazCodecOptions.map((item) => <button key={item} className={topazCodec === item ? "selected" : ""} onClick={() => { onTopazCodec(item); onClose(); }}><FilePenLine size={18} /><span>{topazCodecLabel(item)}</span><em>{item}</em>{topazCodec === item && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  if (kind === "topazQuality") {
    return <div className="floating-menu topaz-quality-menu" style={style}><p>输出质量</p><label><span>q:v {topazQv}</span><input type="range" min="1" max="180" value={topazQv} onChange={(event) => onTopazQv(Number(event.currentTarget.value))} /></label><label><span>固定码率</span><input value={topazBitrate} onChange={(event) => onTopazBitrate(event.currentTarget.value)} placeholder="可选，如 10M" /></label></div>;
  }
  if (kind === "model") {
    if (mediaType === "image") {
      return <div className="floating-menu model-menu" style={style}><p>选择图片模型</p>{imageModelOptions.map((item) => <button key={item.value} className={imageModel === item.value ? "selected" : ""} onClick={() => { onImageModel(item.value); onClose(); }}><FileImage size={18} />{item.label}{imageModel === item.value && <Check className="option-check" size={18} />}</button>)}</div>;
    }
    return <div className="floating-menu model-menu" style={style}><p>选择模型</p>{modelOptions.map((item) => <button key={item.value} className={modelVersion === item.value ? "selected" : ""} onClick={() => { onModel(item.value); onClose(); }}><Film size={18} />{item.label}{modelVersion === item.value && <Check className="option-check" size={18} />}</button>)}</div>;
  }
  return <div className="floating-menu mode-menu" style={style}><p>选择生成模式</p>{(["multimodal", "frames"] as VideoMode[]).map((item) => <button key={item} className={mode === item ? "selected" : ""} onClick={() => onMode(item)}><UploadCloud size={18} />{modeLabels[item]}{mode === item && <Check className="option-check" size={18} />}</button>)}</div>;
}

function RatioIcon({ ratio }: { ratio: string }) {
  return <span className={`ratio-icon r-${ratio.replace(":", "-")}`} />;
}

function AssetLibrary({ tasks, pollLogs, onEdit, onRegenerate, onDelete, onDownloadDebug, onUpscale }: {
  tasks: VideoTask[];
  pollLogs: PollLog[];
  onEdit: (task: VideoTask) => void;
  onRegenerate: (task: VideoTask) => void;
  onDelete: (taskId: string) => void;
  onDownloadDebug: (taskId: string) => void;
  onUpscale: (task: VideoTask) => void;
}) {
  return (
    <section className="asset-library">
      <header>
        <p>全局数据库</p>
        <h1>生成资产</h1>
      </header>
      {!tasks.length && <section className="empty-state"><Film size={30} /><h1>暂无生成资产</h1><p>成功生成或下载后的视频和图片会出现在这里。</p></section>}
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
            onUpscale={() => onUpscale(task)}
          />
        ))}
      </div>
    </section>
  );
}

function TaskCard({ task, selected, latestLog, onEdit, onRegenerate, onDelete, onDownloadDebug, onUpscale }: { task: VideoTask; selected: boolean; latestLog?: PollLog; onEdit: () => void; onRegenerate: () => void; onDelete: () => void; onDownloadDebug: () => void; onUpscale?: () => void }) {
  const taskMediaType = mediaTypeOf(task);
  const taskKind = taskKindOf(task);
  const model = taskKind === "video_upscale"
    ? `Topaz ${topazAIModelOptions.find((item) => item.value === task.topaz?.aiModel)?.label ?? task.topaz?.aiModel ?? "Proteus"}`
    : taskMediaType === "image" ? modelLabel(task.imageModel || "gpt-image-2") : modelOptions.find((item) => item.value === task.modelVersion)?.label ?? "Seedance 2.0";
  const taskImageRatio = normalizeImageRatio(task.ratio);
  const taskImageResolution = normalizeImageResolution(task.imageResolution, task.ratio, task.imageSize);
  const taskImageQuality = normalizeImageQuality(task.imageQuality);
  return (
    <article className={`history-card ${task.status} ${taskMediaType} ${selected ? "selected" : ""}`} data-task-id={task.id}>
      <div className="prompt-line">
        <ReferenceThumbs references={task.references ?? []} />
        <p>{task.prompt}</p>
        <span>{model}</span>
        {taskKind === "video_upscale" && <span>{topazProcessModeLabel(task.topaz)}</span>}
        {taskKind === "video_upscale" && <span>{topazTargetLabel(task.topaz?.targetPreset)}</span>}
        {taskKind === "video_generation" && <span>{task.duration ?? 5}s</span>}
        {taskKind === "video_generation" && <span>{task.resolution ?? "720p"}</span>}
        {taskMediaType === "image" && <span>{taskImageRatio}</span>}
        {taskMediaType === "image" && <span>{imageResolutionLabel(taskImageResolution)}</span>}
        {taskMediaType === "image" && <span>{imageQualityLabel(taskImageQuality)}</span>}
        <span>{taskKind === "video_upscale" ? "视频放大" : taskMediaType === "image" ? "图片生成" : modeLabels[(task.mode === "frames" || task.mode === "multimodal") ? task.mode : "multimodal"]}</span>
        <span>{taskKind === "video_upscale" ? "不消耗 Token" : formatTokenUsage(resolveClientTokenUsage(task))}</span>
        <span className={`status-badge ${task.status}`}>{taskStatusLabel(task, latestLog)}</span>
      </div>
      <div className="result-frame">
        {taskMediaType === "image" && imagePreviewUrl(task) ? <img src={imagePreviewUrl(task)} loading="lazy" alt={task.prompt} /> : videoPreviewUrl(task) ? <video src={videoPreviewUrl(task)} controls /> : <TaskPlaceholder status={task.status} />}
      </div>
      <div className="task-actions">
        <button onClick={onEdit}><PencilLine size={18} />重新编辑</button>
        <button onClick={onRegenerate}><CopyPlus size={18} />再次生成</button>
        {taskMediaType === "video" && task.downloadPath && onUpscale && <button onClick={onUpscale}><Gauge size={18} />放大</button>}
        <button onClick={onDownloadDebug}><Download size={18} />下载状态</button>
        <button className="more-button"><RefreshCcw size={18} />{task.status}</button>
        <button className="delete-record" onClick={onDelete} title="删除记录，不删除下载文件"><Trash2 size={16} /></button>
      </div>
      {task.errorMessage && <p className="task-error">{task.errorMessage}</p>}
    </article>
  );
}

function videoPreviewUrl(task: VideoTask) {
  if (mediaTypeOf(task) !== "video") return undefined;
  return task.downloadPath ? `/api/video-tasks/${task.id}/download` : task.videoUrl;
}

function imagePreviewUrl(task: VideoTask) {
  if (mediaTypeOf(task) !== "image") return undefined;
  return (task.imageDownloadPaths?.length ?? 0) > 0 ? `/api/generation-tasks/${task.id}/file/0` : task.imageUrls?.[0];
}

function taskStatusLabel(task: VideoTask, latestLog?: PollLog) {
  if (taskKindOf(task) === "video_upscale") {
    if (task.status === "succeeded" && task.downloadPath) return "Topaz 视频已输出";
    if (task.status === "succeeded") return "Topaz 处理完成";
    return latestLog?.message || task.status;
  }
  if (mediaTypeOf(task) === "image") {
    if (task.status === "succeeded" && (task.imageDownloadPaths?.length ?? 0) > 0) return "图片已下载";
    if (task.status === "succeeded") return "图片生成完成";
    return latestLog?.message.replace("图片任务状态：", "") || task.status;
  }
  if (task.status === "succeeded" && task.downloadPath) return "视频已下载";
  if (task.status === "succeeded") return "生成完成";
  return latestLog?.message.replace("视频任务状态：", "") || task.status;
}

function mediaAssetLabel(task: VideoTask) {
  if (mediaTypeOf(task) === "image") {
    if ((task.imageDownloadPaths?.length ?? 0) > 0) return "本地图片";
    if ((task.imageUrls?.length ?? 0) > 0) return "远程图片";
    return "未生成";
  }
  return task.downloadPath ? "本地视频" : task.videoUrl ? "远程视频" : "未生成";
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
  const [publicConfigState, setPublicConfigState] = useState<PublicConfig | null>(null);
  const [state, setState] = useState<AppState>(emptyState);
  const [localUsage, setLocalUsage] = useState<LocalUsageSummary | null>(null);
  const [storageStats, setStorageStats] = useState<StorageStats | null>(null);
  const [managerView, setManagerView] = useState<"dashboard" | "records" | "projects">("dashboard");
  const [usageGranularity, setUsageGranularity] = useState<UsageGranularity>("day");
  const [usageMetric, setUsageMetric] = useState<UsageMetricMode>("tokens");
  const [usageMediaType, setUsageMediaType] = useState<MediaFilter>("all");
  const [cardSize, setCardSize] = useState<ProjectCardSize>("regular");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  async function refreshManager() {
    const headers = { "x-sts-manager-token": managerToken };
    const [settingsResult, publicConfigResult, stateResult, localUsageResult, storageResult] = await Promise.allSettled([
      fetchManagerJson<RuntimeSettings>("/api/runtime-settings", headers),
      fetchManagerJson<PublicConfig>("/api/config"),
      fetchManagerJson<AppState>("/api/shell-state"),
      fetchManagerJson<LocalUsageSummary>("/api/manager/usage/local", headers),
      fetchManagerJson<StorageStats>("/api/manager/storage", headers)
    ]);
    if (settingsResult.status === "fulfilled") setSettings(settingsResult.value);
    if (publicConfigResult.status === "fulfilled") setPublicConfigState(publicConfigResult.value);
    if (stateResult.status === "fulfilled") setState(normalizeAppState(stateResult.value) as AppState);
    if (localUsageResult.status === "fulfilled") setLocalUsage(localUsageResult.value);
    if (storageResult.status === "fulfilled") setStorageStats(storageResult.value);
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
      const result = await readJsonOrThrow<{ token: string }>(response, "登录失败");
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
      const result = await readJsonOrThrow<RuntimeSettings>(response, "保存失败");
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
      const response = await fetch(`/api/manager/generation-tasks/${taskId}`, {
        method: "DELETE",
        headers: { "x-sts-manager-token": managerToken }
      });
      await readJsonOrThrow(response, "删除失败");
      await refreshManager();
      setMessage("记录已永久删除");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  }

  async function restoreProject(projectId: string) {
    setBusy(`restore-project-${projectId}`);
    setMessage("");
    try {
      const response = await fetch(`/api/manager/video-projects/${projectId}/restore`, {
        method: "POST",
        headers: { "x-sts-manager-token": managerToken }
      });
      await readJsonOrThrow<VideoProject>(response, "恢复项目失败");
      await refreshManager();
      setMessage("项目已恢复");
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
      const result = await readJsonOrThrow<{ path: string }>(response, "打开媒体数据库失败");
      setMessage(`媒体数据库已打开：${result.path}`);
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
        <button className={managerView === "projects" ? "active" : ""} onClick={() => setManagerView("projects")}><Folder size={18} />项目监控</button>
        <a href="/executor"><Sparkles size={18} />Executor</a>
        <button onClick={() => { sessionStorage.removeItem("sts-manager-auth"); sessionStorage.removeItem("sts-manager-token"); setManagerToken(""); setAuthenticated(false); }}>退出登录</button>
      </aside>
      <section className="manager-main">
        <header className="manager-header">
          <div>
            <p>{managerView === "records" ? "全局数据库" : managerView === "projects" ? "项目用量" : "实时配置"}</p>
            <h1>{managerView === "records" ? "生成记录" : managerView === "projects" ? "项目监控" : "用量检测与关键参数"}</h1>
          </div>
          {managerView === "dashboard" && <button className="manager-primary" onClick={saveSettings} disabled={!settings || busy === "settings"}>
            {busy === "settings" ? <Loader2 className="spin" size={18} /> : <Save size={18} />}保存参数
          </button>}
          {managerView === "records" && <button className="manager-primary" onClick={openVideoDatabase} disabled={busy === "open-database"}>
            {busy === "open-database" ? <Loader2 className="spin" size={18} /> : <Folder size={18} />}打开媒体数据库
          </button>}
          {managerView === "projects" && <div className="monitor-controls">
            <SegmentedControl
              value={usageMediaType}
              options={[
                ["all", "全部"],
                ["video", "视频"],
                ["image", "图片"]
              ]}
              onChange={(value) => setUsageMediaType(value as MediaFilter)}
            />
            <SegmentedControl
              value={usageGranularity}
              options={[
                ["hour", "小时"],
                ["day", "每日"],
                ["week", "每周"],
                ["month", "每月"]
              ]}
              onChange={(value) => setUsageGranularity(value as UsageGranularity)}
            />
            <SegmentedControl
              value={usageMetric}
              options={[
                ["tokens", "Token"],
                ["cost", "费用"]
              ]}
              onChange={(value) => setUsageMetric(value as UsageMetricMode)}
            />
            <SegmentedControl
              value={cardSize}
              options={[
                ["compact", "小"],
                ["regular", "中"],
                ["wide", "大"]
              ]}
              onChange={(value) => setCardSize(value as ProjectCardSize)}
            />
          </div>}
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
                  <SettingField label="SQLITE_PATH" value={settings.sqlitePath} onChange={(value) => setSettings({ ...settings, sqlitePath: value })} />
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
                  <SettingField label="MAX_POLL_RETRY_COUNT" value={settings.maxPollRetryCount} onChange={(value) => setSettings({ ...settings, maxPollRetryCount: value })} />
                  <SettingField label="MAX_CONCURRENT_VIDEO_TASKS" value={settings.maxConcurrentVideoTasks} onChange={(value) => setSettings({ ...settings, maxConcurrentVideoTasks: value })} />
                  <SettingField label="MAX_CONCURRENT_IMAGE_TASKS" value={settings.maxConcurrentImageTasks} onChange={(value) => setSettings({ ...settings, maxConcurrentImageTasks: value })} />
                  <SettingField label="TOPAZ_ENABLED" value={settings.topazEnabled} onChange={(value) => setSettings({ ...settings, topazEnabled: value })} />
                  <SettingField label="TOPAZ_CLI_PATH" value={settings.topazCLIPath} onChange={(value) => setSettings({ ...settings, topazCLIPath: value })} />
                  <SettingField label="TOPAZ_WORK_DIR" value={settings.topazWorkDir} onChange={(value) => setSettings({ ...settings, topazWorkDir: value })} />
                  <SettingField label="MAX_CONCURRENT_TOPAZ_TASKS" value={settings.maxConcurrentTopazTasks} onChange={(value) => setSettings({ ...settings, maxConcurrentTopazTasks: value })} />
                  <SettingField label="TOPAZ_DEFAULT_AI_MODEL" value={settings.topazDefaultAIModel} onChange={(value) => setSettings({ ...settings, topazDefaultAIModel: value })} />
                  {publicConfigState && <div className={`settings-status ${publicConfigState.topazCLIAvailable ? "ok" : "error"}`}>{publicConfigState.topazCLIStatus}</div>}
                  <SettingField label="TOKEN_PRICE_PER_THOUSAND" value={settings.tokenPricePerThousand} onChange={(value) => setSettings({ ...settings, tokenPricePerThousand: value })} />
                  <SettingField label="IMAGE_TOKEN_PRICE_PER_THOUSAND" value={settings.imageTokenPricePerThousand} onChange={(value) => setSettings({ ...settings, imageTokenPricePerThousand: value })} />
                  <SettingField label="IMAGE2_API_KEY" value={settings.image2APIKey} onChange={(value) => setSettings({ ...settings, image2APIKey: value })} />
                  <SettingField label="IMAGE2_API_URL" value={settings.image2APIURL} onChange={(value) => setSettings({ ...settings, image2APIURL: value })} />
                  <SettingField label="IMAGE2_MODEL" value={settings.image2Model} onChange={(value) => setSettings({ ...settings, image2Model: value })} />
                </SettingsGroup>
              </div>
            )}
          </section>
          <section className="manager-card usage-card">
            <h2>
              <span><BarChart3 size={19} />请求量统计</span>
            </h2>
            <UsagePanel localUsage={localUsage} storageStats={storageStats} />
          </section>
        </section> : managerView === "records" ? (
          <ManagerRecords managerToken={managerToken} projects={state.videoProjects} busy={busy} onHardDelete={hardDeleteTask} onDownloadDebug={downloadTaskDebug} />
        ) : (
          <ManagerProjects projects={state.videoProjects} localUsage={localUsage} mediaFilter={usageMediaType} granularity={usageGranularity} metric={usageMetric} cardSize={cardSize} busy={busy} onRestoreProject={restoreProject} />
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

function SegmentedControl({ value, options, onChange }: { value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <div className="segmented-control">
      {options.map(([optionValue, label]) => (
        <button key={optionValue} className={value === optionValue ? "active" : ""} type="button" onClick={() => onChange(optionValue)}>
          {label}
        </button>
      ))}
    </div>
  );
}

async function fetchManagerJson<T>(url: string, headers?: HeadersInit): Promise<T> {
  const response = await fetch(url, headers ? { headers } : undefined);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.json() as Promise<T>;
}

function UsagePanel({ localUsage, storageStats }: { localUsage: LocalUsageSummary | null; storageStats: StorageStats | null }) {
  if (!localUsage) return <div className="record-empty">正在读取本地统计</div>;
  const costEstimate = resolveUsageCostEstimate(localUsage);
  return (
    <div className="usage-panel">
      <p className="usage-note">本地统计记录本系统提交次数、任务 Token 和估算消费；存储统计来自本地 SQLite、下载目录和上传目录。</p>
      <div className="usage-metrics">
        <UsageMetric label="本地总请求" value={localUsage.totals.requests} />
        <UsageMetric label="本地成功" value={localUsage.byStatus.succeeded} />
        <UsageMetric label="本地失败" value={localUsage.byStatus.failed} />
        <UsageMetric label="任务记录" value={storageStats?.tasks.total ?? localUsage.totals.requests} />
        <UsageMetric label="视频任务" value={localUsage.totals.videos ?? localUsage.byMediaType?.video.requests ?? 0} />
        <UsageMetric label="图片任务" value={localUsage.totals.images ?? localUsage.byMediaType?.image.requests ?? 0} />
        <UsageMetric label="视频数量" value={storageStats?.tasks.generatedVideos ?? localUsage.totals.downloadedVideos ?? localUsage.totals.downloaded} />
        <UsageMetric label="图片数量" value={storageStats?.tasks.generatedImages ?? localUsage.totals.downloadedImages ?? 0} />
        <UsageMetric label="本地视频" value={storageStats?.tasks.downloadedVideos ?? localUsage.totals.downloadedVideos ?? localUsage.totals.downloaded} />
        <UsageMetric label="本地图片" value={storageStats?.tasks.downloadedImages ?? localUsage.totals.downloadedImages ?? 0} />
        <UsageMetric label="SQLite" value={formatBytes(storageStats?.database.sqliteBytes ?? 0)} />
        <UsageMetric label="下载占用" value={formatBytes(storageStats?.files.downloadBytes ?? 0)} />
        <UsageMetric label="上传占用" value={formatBytes(storageStats?.files.uploadBytes ?? 0)} />
        <UsageMetric label="总占用" value={formatBytes(storageStats?.files.totalBytes ?? 0)} />
        <UsageMetric label="任务 Token" value={localUsage.totals.totalTokens} />
        <UsageMetric label="图片 Token" value={localUsage.byMediaType?.image.totalTokens ?? 0} />
        <UsageMetric label="估算消费" value={formatCurrency(costEstimate.estimatedCost)} />
        <UsageMetric label="估算单价" value={`¥${formatDecimal(costEstimate.ratePerThousandTokens, 6)} / 千 Token`} />
      </div>
      <div className="usage-lists">
        {storageStats && <UsageList title="存储路径" rows={[
          ["SQLite", storageStats.database.sqlitePath],
          ["旧 JSON", `${storageStats.database.jsonPath} / ${formatBytes(storageStats.database.jsonBytes)}`],
          ["下载目录", storageStats.files.downloadDir],
          ["上传目录", storageStats.files.uploadDir]
        ]} />}
        <UsageList title="项目请求" rows={localUsage.byProject.slice(0, 5).map((item) => [item.projectName, `${item.requests} 次 / 成功 ${item.succeeded}`])} />
        <UsageList title="模型请求" rows={localUsage.byModel.slice(0, 5).map((item) => [modelLabel(item.modelVersion), `${item.requests} 次`])} />
        <UsageList title="媒体类型" rows={[
          ["视频", `${localUsage.byMediaType?.video.requests ?? 0} 次 / ${formatTokenNumber(localUsage.byMediaType?.video.totalTokens ?? 0)} Token`],
          ["图片", `${localUsage.byMediaType?.image.requests ?? 0} 次 / ${formatTokenNumber(localUsage.byMediaType?.image.totalTokens ?? 0)} Token`]
        ]} />
        <UsageList title="最近日期" rows={localUsage.byDay.slice(-5).reverse().map((item) => [item.day, `${item.requests} 次`])} />
      </div>
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatCurrency(value: number) {
  if (!Number.isFinite(value)) return "¥0.00";
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(value);
}

function formatDecimal(value: number, maximumFractionDigits = 4) {
  if (!Number.isFinite(value)) return "0";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits
  }).format(value);
}

function ManagerProjects({
  projects,
  localUsage,
  mediaFilter,
  granularity,
  metric,
  cardSize,
  busy,
  onRestoreProject
}: {
  projects: VideoProject[];
  localUsage: LocalUsageSummary | null;
  mediaFilter: MediaFilter;
  granularity: UsageGranularity;
  metric: UsageMetricMode;
  cardSize: ProjectCardSize;
  busy: string;
  onRestoreProject: (projectId: string) => void;
}) {
  if (!projects.length) {
    return <section className="manager-record-empty"><Folder size={30} /><h2>暂无项目</h2><p>executor 创建的项目会出现在这里。</p></section>;
  }
  const usageByProject = new Map((localUsage?.projectUsage ?? []).map((item) => [item.projectId, item]));
  return (
    <section className={`manager-projects ${cardSize}`}>
      {projects.map((project) => {
        const usage = usageByProject.get(project.id) ?? emptyProjectUsage(project);
        return (
          <article className={`manager-project-card ${project.deletedAt ? "deleted" : ""}`} key={project.id}>
            <div className="manager-project-title">
              <span className="session-thumb icon"><Folder size={18} /></span>
              <div>
                <h2>{project.name}</h2>
                <p>{project.deletedAt ? "已删除项目" : "正常项目"}</p>
              </div>
            </div>
            <div className="manager-project-stats">
              <span>{usage.requests} 个任务</span>
              <span>成功 {usage.succeeded}</span>
              <span>失败 {usage.failed}</span>
              <span>视频生成 {usage.taskKinds?.video_generation ?? 0}</span>
              <span>图片生成 {usage.taskKinds?.image_generation ?? 0}</span>
              <span>Topaz {usage.taskKinds?.video_upscale ?? 0}</span>
              <span>{formatTokenNumber(usage.totalTokens)} Token</span>
              <span>{formatCurrency(usage.estimatedCost)}</span>
              <span>创建 {formatDate(project.createdAt)}</span>
              <span>更新 {formatDate(project.updatedAt)}</span>
            </div>
            <ProjectUsageChart usage={usage} mediaFilter={mediaFilter} granularity={granularity} metric={metric} />
            {project.deletedAt ? (
              <button className="manager-primary" disabled={busy === `restore-project-${project.id}`} onClick={() => onRestoreProject(project.id)}>
                {busy === `restore-project-${project.id}` ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}恢复项目
              </button>
            ) : (
              <span className="project-live-label">可在 executor 使用</span>
            )}
          </article>
        );
      })}
    </section>
  );
}

function emptyProjectUsage(project: VideoProject): ProjectUsageSummary {
  return {
    projectId: project.id,
    projectName: project.name,
    deletedAt: project.deletedAt,
    requests: 0,
    succeeded: 0,
    failed: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0,
    mediaTypes: {
      video: emptyMediaUsage(),
      image: emptyMediaUsage()
    },
    taskKinds: {
      video_generation: 0,
      image_generation: 0,
      video_upscale: 0
    },
    buckets: { hour: [], day: [], week: [], month: [] },
    bucketsByMediaType: {
      video: { hour: [], day: [], week: [], month: [] },
      image: { hour: [], day: [], week: [], month: [] }
    }
  };
}

function emptyMediaUsage(): MediaUsageSummary {
  return {
    requests: 0,
    succeeded: 0,
    failed: 0,
    hidden: 0,
    downloaded: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: 0
  };
}

function ProjectUsageChart({ usage, mediaFilter, granularity, metric }: { usage: ProjectUsageSummary; mediaFilter: MediaFilter; granularity: UsageGranularity; metric: UsageMetricMode }) {
  const buckets = mediaFilter === "all" ? usage.buckets[granularity] ?? [] : usage.bucketsByMediaType?.[mediaFilter]?.[granularity] ?? [];
  const visibleBuckets = buckets.slice(-24);
  const maxValue = Math.max(...visibleBuckets.map((bucket) => usageBucketValue(bucket, metric)), 0);
  if (!visibleBuckets.length || maxValue <= 0) {
    return (
      <div className="project-usage-chart empty">
        <div>暂无 {usageMetricLabel(metric)} 消耗</div>
      </div>
    );
  }
  return (
    <div className="project-usage-chart" aria-label={`${usage.projectName} ${granularityLabel(granularity)} ${usageMetricLabel(metric)} 图表`}>
      <div className="chart-body">
        <div className="chart-y-axis" aria-hidden="true">
          <span>{formatUsageMetricValue(maxValue, metric)}</span>
          <span>{formatUsageMetricValue(maxValue / 2, metric)}</span>
          <span>0</span>
        </div>
        <div className="chart-bars">
          {visibleBuckets.map((bucket) => {
            const value = usageBucketValue(bucket, metric);
            const height = Math.max(6, Math.round((value / maxValue) * 100));
            return (
              <span key={bucket.key} className="chart-bar-wrap">
                <span
                  className="chart-bar"
                  style={{ height: `${height}%` }}
                />
                <span className="chart-tooltip">
                  <strong>{bucket.label}</strong>
                  <em>{formatTokenNumber(bucket.totalTokens)} Token</em>
                  <em>{formatCurrency(bucket.estimatedCost)}</em>
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <div className="chart-foot">
        <span>{visibleBuckets[0]?.label}</span>
        <strong>{formatUsageMetricValue(visibleBuckets.reduce((sum, bucket) => sum + usageBucketValue(bucket, metric), 0), metric)}</strong>
        <span>{visibleBuckets[visibleBuckets.length - 1]?.label}</span>
      </div>
    </div>
  );
}

function usageBucketValue(bucket: UsageBucket, metric: UsageMetricMode) {
  return metric === "cost" ? bucket.estimatedCost : bucket.totalTokens;
}

function usageMetricLabel(metric: UsageMetricMode) {
  return metric === "cost" ? "费用" : "Token";
}

function granularityLabel(granularity: UsageGranularity) {
  if (granularity === "hour") return "小时";
  if (granularity === "day") return "每日";
  if (granularity === "week") return "每周";
  return "每月";
}

function formatUsageMetricValue(value: number, metric: UsageMetricMode) {
  return metric === "cost" ? formatCurrency(value) : `${formatTokenNumber(value)} Token`;
}

function formatTokenNumber(value: number) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 }).format(value);
}

function ManagerRecords({ managerToken, projects, busy, onHardDelete, onDownloadDebug }: { managerToken: string; projects: VideoProject[]; busy: string; onHardDelete: (taskId: string) => Promise<void> | void; onDownloadDebug: (taskId: string) => void }) {
  const [query, setQuery] = useState("");
  const [mediaType, setMediaType] = useState<MediaFilter>("all");
  const [taskKind, setTaskKind] = useState<TaskKindFilter>("all");
  const [status, setStatus] = useState<"all" | VideoTask["status"] | "hidden">("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "status" | "project">("newest");
  const [records, setRecords] = useState<VideoTask[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  async function loadMoreManagerRecords(reset = false) {
    if (loading || (!reset && !hasMore)) return;
    setLoading(true);
    try {
      const response = await fetch(managerTasksUrl({
        limit: 50,
        before: reset ? undefined : nextCursor,
        query,
        mediaType,
        taskKind,
        status,
        sort
      }), {
        headers: { "x-sts-manager-token": managerToken }
      });
      const page = await readJsonOrThrow<VideoTaskPage>(response, "读取生成记录失败");
      setRecords((current) => reset ? page.items : mergeTasksById(current, page.items));
      setNextCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setRecords([]);
    setNextCursor(undefined);
    setHasMore(false);
    void loadMoreManagerRecords(true);
  }, [managerToken, query, mediaType, taskKind, status, sort]);

  async function handleHardDelete(taskId: string) {
    await onHardDelete(taskId);
    setRecords((items) => items.filter((task) => task.id !== taskId));
  }

  if (!records.length && !loading) return <section className="manager-record-empty"><Film size={30} /><h2>暂无生成记录</h2><p>所有项目的生成任务都会出现在这里。</p></section>;
  return (
    <section className="manager-records">
      <div className="manager-record-tools">
        <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索提示词 / 项目 / 模型 / ID" /></label>
        <select value={mediaType} onChange={(event) => setMediaType(event.currentTarget.value as MediaFilter)}>
          <option value="all">全部类型</option>
          <option value="video">视频</option>
          <option value="image">图片</option>
        </select>
        <select value={taskKind} onChange={(event) => setTaskKind(event.currentTarget.value as TaskKindFilter)}>
          <option value="all">全部任务</option>
          <option value="video_generation">视频生成</option>
          <option value="image_generation">图片生成</option>
          <option value="video_upscale">视频放大</option>
        </select>
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
      {!records.length && loading && <section className="manager-record-empty compact"><Loader2 className="spin" size={24} /><h2>正在读取记录</h2><p>只加载当前页，避免一次性打开全部视频。</p></section>}
      <div className="manager-record-grid">
      {records.map((task) => (
        <article className={`manager-record-card ${task.status}`} key={task.id}>
          <div className="manager-record-preview">
            {imagePreviewUrl(task) ? <img src={imagePreviewUrl(task)} loading="lazy" alt={task.prompt} /> : videoPreviewUrl(task) ? <video src={videoPreviewUrl(task)} controls preload="none" /> : <TaskPlaceholder status={task.status} />}
          </div>
          <div className="manager-record-body">
            <div className="manager-record-meta">
              <span><i className={`status-dot ${task.status}`} />{task.hiddenAt ? "已隐藏" : taskStatusLabel(task)}</span>
              <span>{taskKindLabels[taskKindOf(task)]}</span>
              <span>{projectName(projects, task.projectId ?? "")}{projects.find((project) => project.id === task.projectId)?.deletedAt ? "（已删除）" : ""}</span>
              <span>{formatDate(task.createdAt)}</span>
            </div>
            <p>{task.prompt}</p>
            <div className="manager-record-foot">
              <span>{mediaAssetLabel(task)}</span>
              <span>{taskKindOf(task) === "video_upscale" ? "不消耗 Token" : formatTokenUsage(resolveClientTokenUsage(task))}</span>
              <button className="hard-delete secondary" onClick={() => onDownloadDebug(task.id)}>
                <Download size={15} />下载状态
              </button>
              <button className="hard-delete" disabled={busy === `hard-delete-${task.id}`} onClick={() => void handleHardDelete(task.id)}>
                <Trash2 size={15} />永久删除
              </button>
            </div>
          </div>
        </article>
      ))}
      </div>
      {hasMore && <button className="load-more-records" disabled={loading} onClick={() => loadMoreManagerRecords(false)}>
        {loading ? <Loader2 className="spin" size={16} /> : <RefreshCcw size={16} />}加载更多记录
      </button>}
    </section>
  );
}

function UsageMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="usage-metric">
      <strong>{typeof value === "number" ? new Intl.NumberFormat("zh-CN").format(value) : value}</strong>
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
  return modelOptions.find((item) => item.value === value)?.label ?? imageModelOptions.find((item) => item.value === value)?.label ?? value;
}

function downloadTaskDebug(taskId: string) {
  window.location.href = `/api/generation-tasks/${taskId}/debug`;
}

function formatTokenUsage(tokenUsage?: TokenUsage) {
  if (!tokenUsage) return "Token -";
  return `Token ${new Intl.NumberFormat("zh-CN").format(tokenUsage.totalTokens)}`;
}

function resolveClientTokenUsage(task: VideoTask): TokenUsage | undefined {
  if (taskKindOf(task) === "video_upscale") return undefined;
  return task.tokenUsage ?? extractClientTokenUsage(task.raw);
}

function topazTargetLabel(value: TopazTargetPreset | undefined) {
  return topazTargetOptions.find((item) => item.value === value)?.label ?? "2x";
}

function topazAIModelLabel(value: string) {
  return topazAIModelOptions.find((item) => item.value === value)?.label ?? value;
}

function topazCodecLabel(value: string) {
  return value.replace("_videotoolbox", "").replace("lib", "").toUpperCase();
}

function topazModeLabel(modes: TopazProcessMode[]) {
  return modes.map((mode) => topazProcessOptions.find((item) => item.value === mode)?.label ?? mode).join(" + ");
}

function topazProcessModeLabel(topaz: TopazTaskMetadata | undefined) {
  const modes = normalizeTopazProcessModes(topaz?.processModes, topaz?.processMode);
  return topazModeLabel(modes);
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

function normalizeMediaType(value?: string): MediaType {
  return value === "image" ? "image" : "video";
}

function normalizeComposerKind(value?: string, legacyMediaType?: string): ComposerKind {
  if (value === "video_generation" || value === "image_generation" || value === "video_upscale") return value;
  return legacyMediaType === "image" ? "image_generation" : "video_generation";
}

function normalizeMode(value?: string): VideoMode {
  return value === "multimodal" || value === "frames" ? value : "frames";
}

function normalizeReferenceTransport(value?: string): ReferenceTransport {
  return value === "asset" ? "asset" : "url";
}

function normalizeImageModel(value?: string): ImageModelVersion {
  if (value === "image2") return defaultImageModel;
  if (value === "image2-pro") return "gpt-image-2-pro";
  return imageModelOptions.find((item) => item.value === value)?.value ?? defaultImageModel;
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

function normalizeDuration(value: number | undefined) {
  return durationOptions.includes(value ?? 0) ? value! : 5;
}

function normalizeVideoRatio(value: string | undefined): VideoRatio {
  return ratioOptions.find((item) => item === value) ?? "16:9";
}

function normalizeImageRatio(value: string | undefined): ImageRatio {
  if (imageRatioOptions.some((item) => item === value)) return value as ImageRatio;
  const legacySize = imageSizeOptionForValue(value);
  return legacySize?.ratio ?? defaultImageRatio;
}

function normalizeImageResolution(value: string | undefined, ratio?: string, size?: string): ImageResolution {
  const bySize = imageSizeOptionForValue(size);
  return imageResolutionOptions.find((item) => item.value === value)?.value ?? bySize?.resolution ?? defaultImageResolution;
}

function normalizeImageQuality(value: string | undefined): ImageQuality {
  return imageQualityOptions.find((item) => item.value === value)?.value ?? defaultImageQuality;
}

function normalizeTopazProcessMode(value: string | undefined): TopazProcessMode {
  return topazProcessOptions.find((item) => item.value === value)?.value ?? "enhance";
}

function normalizeTopazProcessModes(values: string[] | undefined, fallback?: string): TopazProcessMode[] {
  const normalized = (values ?? [])
    .map((value) => topazProcessOptions.find((item) => item.value === value)?.value)
    .filter((value): value is TopazProcessMode => Boolean(value));
  const unique = normalized.filter((value, index) => normalized.indexOf(value) === index);
  return unique.length ? unique : [normalizeTopazProcessMode(fallback)];
}

function normalizeTopazAIModel(value: string | undefined) {
  return topazAIModelOptions.find((item) => item.value === value)?.value ?? "proteus";
}

function normalizeTopazTargetPreset(value: string | undefined): TopazTargetPreset {
  return topazTargetOptions.find((item) => item.value === value)?.value ?? "2x";
}

function normalizeTopazQv(value: number | undefined): number {
  if (value === undefined) return 82;
  return Number.isInteger(value) && value >= 1 && value <= 1024 ? value : 82;
}

function imageSizeFor(ratio: ImageRatio, resolution: ImageResolution) {
  const value = resolveImageSizeLabelValue(ratio, resolution);
  return imageSizeOptions.find((item) => item.value === value) ?? {
    value,
    ratio,
    resolution,
    label: formatImageSize(value)
  };
}

function imageSizeOptionForValue(value: string | undefined) {
  return imageSizeOptions.find((item) => item.value === value);
}

function imageResolutionLabel(value: ImageResolution) {
  return imageResolutionOptions.find((item) => item.value === value)?.label ?? value.toUpperCase();
}

function imageQualityLabel(value: ImageQuality) {
  return imageQualityOptions.find((item) => item.value === value)?.short ?? value;
}

function resolveImageSizeLabelValue(ratio: ImageRatio, resolution: ImageResolution): ImageSize {
  const [baseWidth, baseHeight] = imageRatioBaseSizes[ratio];
  const scale = imageResolutionScale[resolution];
  return `${baseWidth * scale}x${baseHeight * scale}` as ImageSize;
}

function formatImageSize(value: ImageSize) {
  return value.replace("x", " x ");
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
