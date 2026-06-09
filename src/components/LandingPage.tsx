import { useEffect, useState } from "react";
import {
  ArrowRight,
  Check,
  Cloud,
  Cpu,
  Download,
  Github,
  Languages,
  Mic2,
  Monitor,
  Sparkles,
  Terminal,
  Zap,
  Apple,
} from "lucide-react";
import appIcon from "../assets/landing/typefree-app-icon.png";
import floatingWindowImage from "../assets/landing/typefree-floating-window.png";
import "./LandingPage.css";

const latestReleaseUrl = "https://github.com/Charlo-O/typefree/releases/latest";
const latestReleaseApiUrl = "https://api.github.com/repos/Charlo-O/typefree/releases/latest";

const appNames = [
  "微信",
  "飞书",
  "Notion",
  "Gmail",
  "Cursor",
  "Obsidian",
  "Slack",
  "Docs",
  "Teams",
  "Outlook",
  "Linear",
  "Word",
  "ChatGPT",
  "VS Code",
  "Telegram",
  "浏览器",
];

const proofPoints = [
  { label: "全局热键", copy: "不切换窗口，直接在当前光标输入。" },
  { label: "中英可用", copy: "中文优先，同时支持英文工作流。" },
  { label: "三端安装", copy: "Linux、macOS、Windows 都可下载。" },
  { label: "MIT 开源", copy: "源码、构建和发布都可以检查。" },
];

const workflowSteps = [
  {
    step: "01",
    title: "按下热键",
    titleEn: "Press the hotkey",
    copy: "保持在文档、聊天或编辑器里，不需要先打开录音面板。",
  },
  {
    step: "02",
    title: "自然说话",
    titleEn: "Speak naturally",
    copy: "Typefree 负责转写，必要时把口语整理成可直接发送的文本。",
  },
  {
    step: "03",
    title: "贴回光标",
    titleEn: "Paste back",
    copy: "结果回到当前输入位置，适合写邮件、回复消息、记笔记和改文档。",
  },
];

const capabilityRows = [
  {
    icon: Mic2,
    title: "全局听写",
    copy: "Anywhere you can type, you can speak.",
  },
  {
    icon: Sparkles,
    title: "AI 润色",
    copy: "Turn rough speech into sendable writing.",
  },
  {
    icon: Cloud,
    title: "多引擎",
    copy: "Pick providers by language, speed, and budget.",
  },
];

const modeRows = [
  ["输入方式", "全局热键，当前光标粘贴", "Hotkey in, paste back out"],
  ["转写引擎", "OpenAI、AssemblyAI、Groq、Z.ai、豆包等", "Multiple ASR providers"],
  ["文本处理", "OpenAI / Anthropic / Gemini / 本地模型", "Cloud and local cleanup models"],
  ["使用场景", "文档、聊天、邮件、代码注释、会议摘要", "Docs, chat, email, notes, summaries"],
];

const downloadOptions = [
  {
    key: "linux",
    title: "Linux",
    subtitle: "AppImage",
    detail: "通用 Linux 桌面版",
    detailEn: "Portable Linux desktop build",
    icon: Terminal,
    primaryLabel: "下载 Linux",
    pattern: /Typefree_.*_amd64\.AppImage$/i,
    altLinks: [
      { label: ".deb", pattern: /Typefree_.*_amd64\.deb$/i },
      { label: ".rpm", pattern: /Typefree-.*\.x86_64\.rpm$/i },
    ],
  },
  {
    key: "mac",
    title: "Mac",
    subtitle: "macOS DMG",
    detail: "Apple Silicon 版优先",
    detailEn: "Apple Silicon first, Intel available",
    icon: Apple,
    primaryLabel: "下载 Mac",
    pattern: /Typefree_.*_aarch64\.dmg$/i,
    altLinks: [{ label: "Intel", pattern: /Typefree_.*_x64\.dmg$/i }],
  },
  {
    key: "windows",
    title: "Windows",
    subtitle: "Setup.exe",
    detail: "Windows 安装器",
    detailEn: "Windows installer",
    icon: Monitor,
    primaryLabel: "下载 Windows",
    pattern: /Typefree_.*_x64-setup\.exe$/i,
    altLinks: [{ label: "MSI", pattern: /Typefree_.*_x64_en-US\.msi$/i }],
  },
];

export default function LandingPage() {
  const [downloadState, setDownloadState] = useState({
    key: "",
    message: "",
  });

  useEffect(() => {
    document.documentElement.classList.add("landing-html");
    document.body.classList.add("landing-body");
    const previousTitle = document.title;
    document.title = "Typefree - 说出来，不用打字";

    return () => {
      document.documentElement.classList.remove("landing-html");
      document.body.classList.remove("landing-body");
      document.title = previousTitle;
    };
  }, []);

  const openReleaseFallback = (fallbackUrl) => {
    window.setTimeout(() => {
      window.location.href = fallbackUrl;
    }, 700);
  };

  const handleDownload = async (event, pattern, downloadKey, label) => {
    event.preventDefault();
    const fallbackUrl = event.currentTarget.href;
    if (downloadState.key) return;

    setDownloadState({
      key: downloadKey,
      message: `正在查找 ${label} 最新安装包...`,
    });

    try {
      const response = await fetch(latestReleaseApiUrl, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) throw new Error("Unable to load latest release");

      const release = await response.json();
      const asset = release?.assets?.find((item) => pattern.test(item.name));
      if (asset?.browser_download_url) {
        window.location.href = asset.browser_download_url;
        return;
      }

      setDownloadState({
        key: "",
        message: "没有找到对应安装包，正在打开 GitHub 发布页。",
      });
      openReleaseFallback(fallbackUrl);
    } catch {
      setDownloadState({
        key: "",
        message: "暂时无法连接 GitHub，正在打开发布页。",
      });
      openReleaseFallback(fallbackUrl);
    }
  };

  return (
    <main className="landing-page">
      <header className="landing-nav" aria-label="Typefree navigation">
        <a className="landing-brand" href="#top" aria-label="Typefree home">
          <img src={appIcon} alt="" />
          <span>Typefree</span>
        </a>
        <nav className="landing-links" aria-label="Primary">
          <a href="#everywhere">工作场景</a>
          <a href="#models">模型与集成</a>
          <a href="#download">下载</a>
        </nav>
        <a className="landing-nav-cta" href="#download">
          <Download size={16} aria-hidden="true" />
          下载最新版
        </a>
      </header>

      <section id="top" className="landing-hero" aria-labelledby="landing-title">
        <div className="hero-copy">
          <p className="hero-kicker">OPEN SOURCE VOICE DICTATION · 中文优先</p>
          <h1 id="landing-title">Typefree</h1>
          <p className="hero-title">说出来，不用打字</p>
          <p className="hero-title-en">Speak, don&apos;t type.</p>
          <p className="hero-description">
            Typefree 把自然语音变成干净的中文和英文文本，再粘贴到任何应用里。
            <span>Speak naturally, get polished writing, keep working in the app you already use.</span>
          </p>
          <div className="hero-actions" aria-label="Download actions">
            <a className="primary-action" href="#download">
              <Download size={18} aria-hidden="true" />
              下载最新版
            </a>
            <a className="secondary-action" href="https://github.com/Charlo-O/typefree">
              <Github size={18} aria-hidden="true" />
              查看源码
            </a>
          </div>
        </div>

        <div className="hero-product" aria-label="Typefree product preview">
          <div className="product-window">
            <div className="window-bar">
              <span></span>
              <span></span>
              <span></span>
              <p>工作文档.md</p>
            </div>
            <div className="document-preview">
              <p># 产品周报</p>
              <p className="spoken-line">本周完成了语音识别模块优化，会议记录可以直接贴回文档。</p>
              <div className="voice-panel">
                <div>
                  <strong>Typefree 听写</strong>
                  <span>正在识别</span>
                </div>
                <div className="voice-bars" aria-hidden="true">
                  {Array.from({ length: 22 }).map((_, index) => (
                    <i key={index} style={{ height: `${14 + (index % 7) * 5}px` }} />
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="proof-strip" aria-label="Typefree trust points">
        {proofPoints.map((point) => (
          <div key={point.label} className="proof-item">
            <strong>{point.label}</strong>
            <span>{point.copy}</span>
          </div>
        ))}
      </section>

      <section className="landing-section workflow-section" aria-labelledby="workflow-title">
        <div className="workflow-copy">
          <p>VOICE TO TEXT WORKFLOW</p>
          <h2 id="workflow-title">一句话，从麦克风到当前光标。</h2>
          <span>
            The page should feel like the app: small, quick, and already sitting inside your daily
            writing flow.
          </span>
        </div>
        <div className="workflow-board">
          <div className="workflow-preview">
            <img src={floatingWindowImage} alt="Typefree floating dictation window preview" />
            <div>
              <strong>悬浮窗只出现片刻</strong>
              <span>Recording appears when you need it, then gets out of the way.</span>
            </div>
          </div>
          <div className="workflow-steps">
            {workflowSteps.map((item) => (
              <article key={item.step} className="workflow-step">
                <strong>{item.step}</strong>
                <div>
                  <h3>{item.title}</h3>
                  <small>{item.titleEn}</small>
                  <p>{item.copy}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="everywhere" className="landing-section everywhere-section">
        <div className="section-heading">
          <p>WORKS EVERYWHERE</p>
          <h2>你在哪里写字，它就在哪里听写。</h2>
          <span>Use your voice in every app where typing normally slows you down.</span>
        </div>
        <div className="app-grid" aria-label="Supported writing destinations">
          {appNames.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
      </section>

      <section className="landing-section capability-section">
        <div className="capability-rail">
          {capabilityRows.map((feature) => {
            const Icon = feature.icon;
            return (
              <article key={feature.title} className="capability-row">
                <div className="capability-icon">
                  <Icon size={20} aria-hidden="true" />
                </div>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.copy}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="models" className="landing-section split-section">
        <div className="split-copy">
          <p>CHOOSE YOUR ENGINE</p>
          <h2>转写和润色，都按你的工作流来。</h2>
          <span>
            Start with a provider that fits your language, latency, and budget. The interface stays
            simple while the engine layer stays flexible.
          </span>
          <div className="mode-table" aria-label="Typefree mode comparison">
            {modeRows.map(([label, zh, en]) => (
              <div key={label}>
                <strong>{label}</strong>
                <span>{zh}</span>
                <small>{en}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="engine-panel" aria-label="Typefree engine routing preview">
          <div className="engine-header">
            <Cpu size={22} aria-hidden="true" />
            <div>
              <strong>Engine router</strong>
              <span>转写与润色分开选择</span>
            </div>
          </div>
          <div className="engine-pipeline">
            <div className="engine-node">
              <Mic2 size={18} aria-hidden="true" />
              <span>Voice</span>
            </div>
            <ArrowRight size={18} aria-hidden="true" />
            <div className="engine-node">
              <Cloud size={18} aria-hidden="true" />
              <span>ASR</span>
            </div>
            <ArrowRight size={18} aria-hidden="true" />
            <div className="engine-node">
              <Sparkles size={18} aria-hidden="true" />
              <span>Cleanup</span>
            </div>
          </div>
          <div className="provider-groups">
            <div>
              <p>转写引擎</p>
              <span>OpenAI</span>
              <span>AssemblyAI</span>
              <span>Groq</span>
              <span>Z.ai</span>
              <span>豆包</span>
            </div>
            <div>
              <p>文本处理</p>
              <span>OpenAI</span>
              <span>Anthropic</span>
              <span>Gemini</span>
              <span>本地模型</span>
            </div>
          </div>
          <div className="engine-row">
            <Languages size={20} aria-hidden="true" />
            <div>
              <strong>语言与任务分开调</strong>
              <span>Choose language, ASR, and cleanup model without changing the writing flow.</span>
            </div>
            <Check size={18} aria-hidden="true" />
          </div>
        </div>
      </section>

      <section id="download" className="landing-section download-section">
        <div className="download-header">
          <Zap size={28} aria-hidden="true" />
          <h2>把键盘留给需要精确编辑的时刻。</h2>
          <p>
            Typefree 是 MIT 开源的桌面听写工具。下载后即可在 macOS、Windows 和 Linux
            上尝试语音输入、AI 润色和跨应用粘贴。
          </p>
          <span>
            Typefree is an open-source desktop dictation app for faster writing, cleaner text, and
            less switching between your voice and your keyboard.
          </span>
        </div>
        <div className="download-panel">
          {downloadState.message ? (
            <p className="download-status" role="status" aria-live="polite">
              {downloadState.message}
            </p>
          ) : null}
          <div className="platform-downloads" aria-label="Platform downloads">
            {downloadOptions.map((option) => {
              const Icon = option.icon;
              const primaryKey = `${option.key}-primary`;
              const primaryLoading = downloadState.key === primaryKey;

              return (
                <article className="download-platform-card" key={option.title}>
                  <div className="download-platform-icon">
                    <Icon size={22} aria-hidden="true" />
                  </div>
                  <h3>{option.title}</h3>
                  <p>{option.subtitle}</p>
                  <span>{option.detail}</span>
                  <small>{option.detailEn}</small>
                  <a
                    className="platform-primary-action"
                    href={latestReleaseUrl}
                    aria-busy={primaryLoading ? "true" : undefined}
                    aria-disabled={downloadState.key ? "true" : undefined}
                    onClick={(event) =>
                      handleDownload(event, option.pattern, primaryKey, option.title)
                    }
                  >
                    <Download size={17} aria-hidden="true" />
                    {primaryLoading ? "正在查找..." : option.primaryLabel}
                  </a>
                  <div className="platform-alt-links">
                    {option.altLinks.map((link) => {
                      const altKey = `${option.key}-${link.label}`;
                      return (
                        <a
                          key={link.label}
                          href={latestReleaseUrl}
                          aria-busy={downloadState.key === altKey ? "true" : undefined}
                          aria-disabled={downloadState.key ? "true" : undefined}
                          onClick={(event) =>
                            handleDownload(event, link.pattern, altKey, `${option.title} ${link.label}`)
                          }
                        >
                          {downloadState.key === altKey ? "查找中" : link.label}
                        </a>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="download-actions">
            <a className="text-action" href="https://github.com/Charlo-O/typefree">
              GitHub
              <ArrowRight size={16} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
