import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Box,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  FileVideo,
  FolderOpen,
  Image,
  Layers3,
  Loader2,
  Play,
  RefreshCcw,
  ShieldAlert,
  Trash2,
  Wand2
} from "lucide-react";
import "./styles.css";

type AssetType = "Image" | "Video" | "Audio";

interface PublicConfig {
  assetsCredentialsConfigured: boolean;
  arkAPIKeyConfigured: boolean;
  arkVideoModel: string;
  volcengineRegion: string;
  pollIntervalSeconds: number;
  pollTimeoutSeconds: number;
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

interface VideoTask {
  id: string;
  remoteTaskId?: string;
  prompt: string;
  assetIds: string[];
  status: "queued" | "running" | "succeeded" | "failed";
  errorMessage?: string;
  videoUrl?: string;
  downloadPath?: string;
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
  videoTasks: VideoTask[];
  pollLogs: PollLog[];
}

const emptyState: AppState = {
  assetGroups: [],
  assets: [],
  videoTasks: [],
  pollLogs: []
};

function App() {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [state, setState] = useState<AppState>(emptyState);
  const [groupName, setGroupName] = useState("default-portrait-group");
  const [groupDescription, setGroupDescription] = useState("SeeDance reference assets");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [assetName, setAssetName] = useState("reference-image");
  const [assetUrl, setAssetUrl] = useState("");
  const [assetType, setAssetType] = useState<AssetType>("Image");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [generationMode, setGenerationMode] = useState<"text" | "asset">("text");
  const [prompt, setPrompt] = useState("图片 1 里的人物缓慢转身看向镜头，动作自然，保持人物身份一致。");
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState("");

  const activeAssets = useMemo(() => state.assets.filter((asset) => asset.status === "Active"), [state.assets]);
  const latestTask = state.videoTasks[0];

  async function refresh() {
    const [configResponse, stateResponse] = await Promise.all([fetch("/api/config"), fetch("/api/state")]);
    setConfig(await configResponse.json());
    const nextState = await stateResponse.json();
    setState(nextState);
    if (!selectedGroupId && nextState.assetGroups?.[0]?.id) setSelectedGroupId(nextState.assetGroups[0].id);
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, []);

  async function submitGroup() {
    await mutate("group", "/api/asset-groups", {
      name: groupName,
      description: groupDescription,
      projectName: "default"
    });
  }

  async function submitAsset() {
    await mutate("asset", "/api/assets", {
      groupId: selectedGroupId,
      url: assetUrl,
      name: assetName,
      assetType,
      projectName: "default"
    });
  }

  async function submitVideoTask() {
    await mutate("video", "/api/video-tasks", {
      mode: generationMode,
      prompt,
      assetIds: generationMode === "asset" ? selectedAssetIds : []
    });
  }

  async function pollAsset(id: string) {
    await mutate(`poll-${id}`, `/api/assets/${id}/poll`, { projectName: "default" });
  }

  async function removeAsset(id: string) {
    setBusy(`delete-${id}`);
    try {
      const response = await fetch(`/api/assets/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error ?? "删除失败");
      await refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function openDownloadFolder() {
    setBusy("open-download-folder");
    setToast("");
    try {
      const response = await fetch("/api/downloads/open-folder", { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "打开下载文件夹失败");
      setToast(`已打开下载文件夹：${result.path}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  async function mutate(scope: string, url: string, body: unknown) {
    setBusy(scope);
    setToast("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "请求失败");
      await refresh();
    } catch (error) {
      setToast(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  }

  function toggleAsset(id: string) {
    setSelectedAssetIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]);
  }

  const assetsAPIReady = Boolean(config?.assetsCredentialsConfigured);
  const canGenerate = Boolean(config?.arkAPIKeyConfigured)
    && prompt.trim().length > 0
    && (generationMode === "text" || selectedAssetIds.length > 0);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Wand2 size={20} /></div>
          <div>
            <strong>SeeDance</strong>
            <span>Asset Workbench</span>
          </div>
        </div>
        <nav>
          <a href="#groups"><Layers3 size={17} />素材组</a>
          <a href="#assets"><Image size={17} />素材</a>
          <a href="#video"><FileVideo size={17} />视频任务</a>
          <a href="#downloads"><Download size={17} />下载记录</a>
        </nav>
        <div className="config-card">
          <h2><Database size={16} />配置</h2>
          <StatusLine ok={Boolean(config?.assetsCredentialsConfigured)} label="Assets AK/SK" />
          <StatusLine ok={Boolean(config?.arkAPIKeyConfigured)} label="Ark API Key" />
          <p>Model: <code>{config?.arkVideoModel ?? "loading"}</code></p>
          <p>Region: <code>{config?.volcengineRegion ?? "cn-beijing"}</code></p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Assets API + Seedance task pipeline</p>
            <h1>素材资产到视频生成</h1>
          </div>
          <button className="icon-button" onClick={refresh} title="刷新状态">
            <RefreshCcw size={18} />
          </button>
        </header>

        {toast && <div className="alert"><ShieldAlert size={18} />{toast}</div>}

        <section className="grid">
          <Panel id="groups" title="1. 创建或选择素材组" icon={<Layers3 />}>
            <div className="form-row">
              <label>名称<input value={groupName} maxLength={64} onChange={(event) => setGroupName(event.target.value)} /></label>
              <label>描述<input value={groupDescription} maxLength={300} onChange={(event) => setGroupDescription(event.target.value)} /></label>
            </div>
            {!assetsAPIReady && <div className="notice warn">缺少 VOLCENGINE_AK / VOLCENGINE_SK，素材库接口暂不可用；可以先用文生视频。</div>}
            <button disabled={busy === "group" || !groupName || !assetsAPIReady} onClick={submitGroup}>
              {busy === "group" ? <Loader2 className="spin" size={16} /> : <Box size={16} />}创建 Asset Group
            </button>
            <div className="list">
              {state.assetGroups.map((group) => (
                <button key={group.id} className={`list-item ${selectedGroupId === group.id ? "selected" : ""}`} onClick={() => setSelectedGroupId(group.id)}>
                  <strong>{group.name}</strong>
                  <span>{group.id}</span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel id="assets" title="2. 上传公网素材 URL" icon={<Image />}>
            <div className="notice">按文档要求仅支持公网 HTTPS URL，不支持 base64。本地文件请先上传到可访问地址。</div>
            {!assetsAPIReady && <div className="notice warn">填入 Assets AK/SK 后才能创建和轮询素材资产。</div>}
            <div className="form-row">
              <label>素材名<input value={assetName} maxLength={64} onChange={(event) => setAssetName(event.target.value)} /></label>
              <label>类型<select value={assetType} onChange={(event) => setAssetType(event.target.value as AssetType)}><option>Image</option><option>Video</option><option>Audio</option></select></label>
            </div>
            <label>公网 URL<input value={assetUrl} placeholder="https://example.com/reference.png" onChange={(event) => setAssetUrl(event.target.value)} /></label>
            <button disabled={busy === "asset" || !selectedGroupId || !assetUrl || !assetsAPIReady} onClick={submitAsset}>
              {busy === "asset" ? <Loader2 className="spin" size={16} /> : <Clock3 size={16} />}创建 Asset 并轮询
            </button>
            <div className="asset-list">
              {state.assets.map((asset) => (
                <article key={asset.id} className="asset-row">
                  <div>
                    <strong>{asset.name || asset.id}</strong>
                    <span>{asset.assetType} · {asset.status}</span>
                    {asset.errorMessage && <small>{asset.errorMessage}</small>}
                  </div>
                  <div className="row-actions">
                    <button className="icon-button" onClick={() => pollAsset(asset.id)} title="查询素材状态"><RefreshCcw size={15} /></button>
                    <button className="icon-button danger" onClick={() => removeAsset(asset.id)} title="删除素材"><Trash2 size={15} /></button>
                  </div>
                </article>
              ))}
            </div>
          </Panel>

          <Panel id="video" title="3. 选择生成形式并提交视频" icon={<FileVideo />}>
            <div className="segmented" role="tablist" aria-label="生成形式">
              <button className={generationMode === "text" ? "active" : ""} onClick={() => setGenerationMode("text")}>文生视频</button>
              <button className={generationMode === "asset" ? "active" : ""} onClick={() => setGenerationMode("asset")}>素材参考生成</button>
            </div>
            {generationMode === "text" ? (
              <div className="notice">文生视频不需要 Assets API，也不需要选择素材；只使用 Ark 视频 API Key 和当前模型。</div>
            ) : (
              <div className="selected-assets">
                {activeAssets.map((asset, index) => (
                  <button key={asset.id} className={selectedAssetIds.includes(asset.id) ? "chip active" : "chip"} onClick={() => toggleAsset(asset.id)}>
                    图片 {index + 1} · {asset.name || asset.id.slice(0, 12)}
                  </button>
                ))}
                {!activeAssets.length && <span className="empty">暂无 Active 素材</span>}
              </div>
            )}
            <label>Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} /></label>
            <button disabled={busy === "video" || !canGenerate} onClick={submitVideoTask}>
              {busy === "video" ? <Loader2 className="spin" size={16} /> : <Play size={16} />}提交视频任务
            </button>
            {latestTask && <TaskCard task={latestTask} logs={state.pollLogs.filter((log) => log.taskId === latestTask.id)} />}
          </Panel>

          <Panel id="downloads" title="4. 下载记录" icon={<Download />}>
            <button className="secondary-button" disabled={busy === "open-download-folder"} onClick={openDownloadFolder}>
              {busy === "open-download-folder" ? <Loader2 className="spin" size={16} /> : <FolderOpen size={16} />}打开下载文件夹
            </button>
            <div className="download-list">
              {state.videoTasks.filter((task) => task.downloadPath).map((task) => (
                <article key={task.id} className="download-row">
                  <CheckCircle2 size={18} />
                  <div>
                    <strong>{task.downloadPath}</strong>
                    <span>{task.remoteTaskId}</span>
                  </div>
                  <a className="download-link" href={`/api/video-tasks/${task.id}/download`}>
                    <Download size={15} />下载 MP4
                  </a>
                </article>
              ))}
              {!state.videoTasks.some((task) => task.downloadPath) && <p className="empty">生成成功后会自动下载到后端本地目录。</p>}
            </div>
          </Panel>
        </section>
      </section>
    </main>
  );
}

function StatusLine({ ok, label }: { ok: boolean; label: string }) {
  return <p className={ok ? "status ok" : "status warn"}>{ok ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}{label}</p>;
}

function Panel({ id, title, icon, children }: { id: string; title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return <section id={id} className="panel"><h2>{React.cloneElement(icon as React.ReactElement<{ size?: number }>, { size: 18 })}{title}</h2>{children}</section>;
}

function TaskCard({ task, logs }: { task: VideoTask; logs: PollLog[] }) {
  return (
    <article className={`task-card ${task.status}`}>
      <div>
        <strong>{task.status}</strong>
        <span>{task.remoteTaskId || "等待提交到远端"}</span>
      </div>
      {task.errorMessage && <p className="task-error">{task.errorMessage}</p>}
      {task.downloadPath && <p className="task-download">{task.downloadPath}</p>}
      <div className="logs">
        {logs.slice(0, 5).map((log) => <span key={log.id}>{new Date(log.createdAt).toLocaleTimeString()} · {log.message}</span>)}
      </div>
    </article>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
