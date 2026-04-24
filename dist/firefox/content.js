(function chatGptHistoryLocator() {
  if (window.__CGHL_CONTROLLER__) {
    window.__CGHL_CONTROLLER__.refreshNow();
    return;
  }

  /* ═══════════════════════════════════════════════
     Constants & Config
     ═══════════════════════════════════════════════ */

  const SELECTORS = {
    userTurns: [
      'main section[data-testid^="conversation-turn-"][data-turn="user"]',
      'main [data-testid^="conversation-turn-"][data-turn="user"]',
      '[data-testid^="conversation-turn-"][data-turn="user"]'
    ],
    userMessages: [
      'main [data-testid^="conversation-turn-"] [data-message-author-role="user"][data-message-id]',
      '[data-message-author-role="user"][data-message-id]',
      'main [data-message-author-role="user"][data-message-id]'
    ],
    assistantTurns: [
      'main section[data-testid^="conversation-turn-"][data-turn="assistant"]',
      'main [data-testid^="conversation-turn-"][data-turn="assistant"]',
      '[data-testid^="conversation-turn-"][data-turn="assistant"]'
    ],
    containers: [
      'section[data-testid^="conversation-turn-"]',
      '[data-testid^="conversation-turn-"]'
    ]
  };

  const PAGE_RE = /https:\/\/(chatgpt\.com|chat\.openai\.com)\//;
  const STORAGE_PREFIX = "cghl:";
  const THROTTLE_MS = 120;
  const SCROLL_ANCHOR = 0.28;
  const URL_CHANGE_EVENT = "cghl-url-change";
  const THEME_CHECK_EVENT = "cghl-theme-check";
  const DEBUG_MAX_LOG = 500;
  const DEFAULT_LAUNCHER_SVG =
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none">' +
    '<circle cx="8" cy="3" r="1.5" fill="currentColor" opacity="0.9"/>' +
    '<circle cx="4.5" cy="11" r="1.5" fill="currentColor" opacity="0.7"/>' +
    '<circle cx="11.5" cy="11" r="1.5" fill="currentColor" opacity="0.7"/>' +
    '<path d="M8 4.5V7.5L4.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
    '<path d="M8 7.5L11.5 9.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>' +
    "</svg>";
  const INJECTED_LAUNCHER_SVG = "<svg width=\"16\" height=\"16\" viewBox=\"0 0 16 16\" fill=\"none\" xmlns=\"http://www.w3.org/2000/svg\"><circle cx=\"8\" cy=\"3\" r=\"1.5\" fill=\"currentColor\" opacity=\"0.9\" /><circle cx=\"4.5\" cy=\"11\" r=\"1.5\" fill=\"currentColor\" opacity=\"0.7\" /><circle cx=\"11.5\" cy=\"11\" r=\"1.5\" fill=\"currentColor\" opacity=\"0.7\" /><path d=\"M8 4.5V7.5L4.5 9.5\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" /><path d=\"M8 7.5L11.5 9.5\" stroke=\"currentColor\" stroke-width=\"1.2\" stroke-linecap=\"round\" /></svg>";

  /* ═══════════════════════════════════════════════
     Utilities
     ═══════════════════════════════════════════════ */

  function throttle(fn, ms) {
    let timer = null;
    let lastArgs = null;
    return function throttled(...args) {
      lastArgs = args;
      if (timer) return;
      timer = window.setTimeout(() => {
        timer = null;
        fn(...lastArgs);
      }, ms);
    };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function sleep(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function dedupe(elements) {
    const seen = new Set();
    const out = [];
    for (const el of elements) {
      if (!el || seen.has(el)) continue;
      seen.add(el);
      out.push(el);
    }
    return out;
  }

  function getLauncherSvgMarkup() {
    return INJECTED_LAUNCHER_SVG || DEFAULT_LAUNCHER_SVG;
  }

  function hasText(el) {
    return Boolean(el && el.textContent && el.textContent.trim().length > 0);
  }

  function elTop(el) {
    return el.getBoundingClientRect().top + window.scrollY;
  }

  function elTopIn(el, container) {
    if (!el || !container) return 0;
    if (container === document.scrollingElement || container === document.documentElement) {
      return elTop(el);
    }
    return el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
  }

  function scrollAncestor(el) {
    let cur = el?.parentElement;
    while (cur && cur !== document.body) {
      const s = window.getComputedStyle(cur);
      if (/(auto|scroll|overlay)/.test(s.overflowY) && cur.scrollHeight > cur.clientHeight + 20) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function isNonConv(el) {
    if (!el) return true;
    return Boolean(
      el.closest(
        [
          "form", "textarea", '[contenteditable="true"]', '[role="textbox"]',
          "nav", "aside", "footer", "header",
          '[aria-live="assertive"]', "#thread-bottom", "#thread-bottom-container",
          '[data-type="unified-composer"]'
        ].join(", ")
      )
    );
  }

  function parseVersion(text) {
    if (!text) return null;
    const m = text.replace(/\s+/g, "").match(/^(\d+)\/(\d+)$/);
    if (!m) return null;
    const current = Number(m[1]);
    const total = Number(m[2]);
    if (!Number.isFinite(current) || !Number.isFinite(total) || current < 1 || total < 1) return null;
    return { current, total, hasVariants: total > 1 };
  }

  function parseColorChannel(token) {
    if (!token) return 0;
    if (token.endsWith("%")) {
      return clamp(Math.round((Number(token.slice(0, -1)) / 100) * 255), 0, 255);
    }
    return clamp(Number(token), 0, 255);
  }

  function luminanceFromColor(color) {
    if (!color) return null;
    const normalized = color.trim().toLowerCase();
    if (!normalized || normalized === "transparent") return null;

    const rgb = normalized.match(/^rgba?\(([^)]+)\)$/);
    if (rgb) {
      const parts = rgb[1].split(",").map(part => part.trim());
      if (parts.length >= 3) {
        const r = parseColorChannel(parts[0]);
        const g = parseColorChannel(parts[1]);
        const b = parseColorChannel(parts[2]);
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
    }

    const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (hex) {
      const raw = hex[1];
      const full = raw.length === 3 ? raw.split("").map(ch => ch + ch).join("") : raw;
      const r = parseInt(full.slice(0, 2), 16);
      const g = parseInt(full.slice(2, 4), 16);
      const b = parseInt(full.slice(4, 6), 16);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }

    return null;
  }

  function ts() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}.${String(d.getMilliseconds()).padStart(3, "0")}`;
  }

  /**
   * Get a stable position identifier from a conversation turn element.
   * data-testid (e.g. "conversation-turn-3") is stable across version switches
   * because it encodes position, not content. data-message-id changes when
   * user-message branches are switched (edited messages have different IDs).
   */
  function getStableTestId(el) {
    if (!el) return null;
    const section = el.closest('[data-testid^="conversation-turn-"]');
    return section?.getAttribute("data-testid") || null;
  }

  /* ═══════════════════════════════════════════════
     URL Change Hook
     ═══════════════════════════════════════════════ */

  function installUrlHook() {
    if (window.__CGHL_URL_HOOK__) return;
    window.__CGHL_URL_HOOK__ = true;
    const dispatch = () => window.dispatchEvent(new CustomEvent(URL_CHANGE_EVENT));
    const wrap = name => {
      const orig = history[name];
      history[name] = function (...args) {
        const result = orig.apply(this, args);
        dispatch();
        return result;
      };
    };
    wrap("pushState");
    wrap("replaceState");
    window.addEventListener("popstate", dispatch);
    window.addEventListener("hashchange", dispatch);
  }

  /* ═══════════════════════════════════════════════
     Controller
     ═══════════════════════════════════════════════ */

  class Controller {
    constructor() {
      // State
      this.messages = [];
      this.activeIndex = -1;
      this.currentHref = location.href;
      this.scrollContainer = null;
      this.treeNodes = new Map();
      this.branchCache = new Map();
      this.replySwitcherIndex = new Map();
      this.livePathKeys = [];
      this.activeNodeKey = "";
      this.switching = false;
      this.harvesting = false;
      this.panelOpen = false;
      this.lastSignature = "";
      this.nodeSeq = 0;
      this.theme = "dark";
      this.themeObserver = null;
      this.themeMedia = null;

      // Debug mode
      this.debugEnabled = false;
      this.debugPaused = false;
      this.debugEntries = [];
      this.debugPanel = null;
      this.debugToggleBtn = null;
      this.debugPauseBtn = null;
      this.debugCopyBtn = null;
      this._debugRafId = null;
      this._debugDirty = false;

      // DOM refs
      this.root = null;
      this.panel = null;
      this.list = null;
      this.launcher = null;
      this.countBadge = null;
      this.launcherCount = null;
      this.status = null;
      this.harvestBtn = null;

      // Timers
      this.persistTimer = null;
      this.jumpTimer = null;
      this.flashTimer = null;
      this.statusTimer = null;
      this.urlPollTimer = null;
      this.observer = null;

      // Throttled callbacks
      this.rebuildT = throttle(() => this.rebuild(), THROTTLE_MS);
      this.updateActiveT = throttle(() => this.updateActive(), 60);
      this.handleScroll = this.handleScroll.bind(this);
      this.handleResize = this.handleResize.bind(this);
    }

    /* ─── Init ──────────────────────────────────── */

    init() {
      this.loadCache();
      this.injectUI();
      this.applyTheme(this.detectTheme());
      this.attachEvents();
      this.observeDom();
      this.rebuild();
      this.startUrlPoll();
      this.log("init", "Controller initialized");
    }

    /* ─── Debug log ─────────────────────────────── */

    log(event, detail, data) {
      const entry = { t: ts(), event, detail: String(detail || "") };
      if (data !== undefined) {
        try { entry.data = JSON.stringify(data); } catch (_e) { entry.data = String(data); }
      }
      this.debugEntries.push(entry);
      if (this.debugEntries.length > DEBUG_MAX_LOG) {
        this.debugEntries = this.debugEntries.slice(-DEBUG_MAX_LOG);
      }

      // Also emit to console while debug is on
      if (this.debugEnabled) {
        console.debug(`[CGHL ${entry.t}] ${event}: ${entry.detail}`, data !== undefined ? data : "");
      }

      // Schedule batched render (max once per animation frame)
      if (!this._debugDirty) {
        this._debugDirty = true;
        if (this._debugRafId) cancelAnimationFrame(this._debugRafId);
        this._debugRafId = requestAnimationFrame(() => {
          this._debugDirty = false;
          this._debugRafId = null;
          if (this.debugEnabled && !this.debugPaused) this.renderDebugLog();
        });
      }
    }

    toggleDebug() {
      this.debugEnabled = !this.debugEnabled;
      if (this.debugToggleBtn) {
        this.debugToggleBtn.textContent = this.debugEnabled ? "调试 ✓" : "调试";
        this.debugToggleBtn.classList.toggle("cghl-debug-on", this.debugEnabled);
      }
      if (this.debugPanel) {
        this.debugPanel.style.display = this.debugEnabled ? "flex" : "none";
        if (this.debugEnabled) this.renderDebugLog();
      }
      this.log("debug", this.debugEnabled ? "Debug ON" : "Debug OFF");
    }

    toggleDebugPause() {
      this.debugPaused = !this.debugPaused;
      if (this.debugPauseBtn) {
        this.debugPauseBtn.textContent = this.debugPaused ? "▶" : "⏸";
        this.debugPauseBtn.title = this.debugPaused ? "Resume log" : "Pause log";
      }
      if (!this.debugPaused) this.renderDebugLog();
    }

    copyDebugLog() {
      const text = this.debugEntries.map(e => {
        const d = e.data ? ` | ${e.data}` : "";
        return `[${e.t}] ${e.event}: ${e.detail}${d}`;
      }).join("\n");
      navigator.clipboard.writeText(text).then(() => {
        this.showStatus(`已复制 ${this.debugEntries.length} 条日志`, false);
      }).catch(() => {
        // Fallback: select in debug panel
        const body = this.debugPanel?.querySelector(".cghl-dbg-body");
        if (body) {
          const range = document.createRange();
          range.selectNodeContents(body);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          this.showStatus("已选中日志，请手动复制", false);
        }
      });
    }

    renderDebugLog() {
      if (!this.debugPanel || !this.debugEnabled) return;
      const body = this.debugPanel.querySelector(".cghl-dbg-body");
      if (!body) return;

      // Check if user has scrolled up (don't auto-scroll in that case)
      const wasAtBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30;

      const lines = this.debugEntries.slice(-80).map(e => {
        const d = e.data ? ` | ${e.data}` : "";
        return `<span class="cghl-dbg-ts">${e.t}</span> <span class="cghl-dbg-ev">${e.event}</span> ${e.detail}${d}`;
      });
      body.innerHTML = lines.join("\n");

      // Only auto-scroll if user was already at the bottom
      if (wasAtBottom) body.scrollTop = body.scrollHeight;
    }

    /* ─── UI Injection ──────────────────────────── */

    injectUI() {
      if (document.getElementById("cghl-root")) {
        this.root = document.getElementById("cghl-root");
        this.panel = document.getElementById("cghl-panel");
        this.list = document.getElementById("cghl-list");
        this.launcher = document.getElementById("cghl-launcher");
        this.countBadge = document.getElementById("cghl-count");
        this.launcherCount = document.getElementById("cghl-launcher-count");
        this.status = document.getElementById("cghl-status");
        this.harvestBtn = document.getElementById("cghl-harvest");
        this.debugPanel = document.getElementById("cghl-debug-panel");
        this.debugToggleBtn = document.getElementById("cghl-debug-toggle");
        return;
      }

      // Root
      this.root = document.createElement("div");
      this.root.id = "cghl-root";

      // Status toast
      this.status = document.createElement("div");
      this.status.id = "cghl-status";

      // Panel
      this.panel = document.createElement("div");
      this.panel.id = "cghl-panel";

      // Panel header
      const header = document.createElement("div");
      header.id = "cghl-panel-header";

      const title = document.createElement("span");
      title.id = "cghl-panel-title";
      title.textContent = "对话树";

      this.countBadge = document.createElement("span");
      this.countBadge.id = "cghl-count";
      this.countBadge.textContent = "0";

      this.harvestBtn = document.createElement("button");
      this.harvestBtn.id = "cghl-harvest";
      this.harvestBtn.type = "button";
      this.harvestBtn.textContent = "采集图谱";
      this.harvestBtn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        this.harvestAll();
      });

      this.debugToggleBtn = document.createElement("button");
      this.debugToggleBtn.id = "cghl-debug-toggle";
      this.debugToggleBtn.type = "button";
      this.debugToggleBtn.textContent = "调试";
      this.debugToggleBtn.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        this.toggleDebug();
      });

      header.appendChild(title);
      header.appendChild(this.countBadge);
      header.appendChild(this.harvestBtn);
      header.appendChild(this.debugToggleBtn);

      // List
      this.list = document.createElement("div");
      this.list.id = "cghl-list";

      // Debug panel
      this.debugPanel = document.createElement("div");
      this.debugPanel.id = "cghl-debug-panel";
      this.debugPanel.style.display = "none";

      const dbgHeader = document.createElement("div");
      dbgHeader.className = "cghl-dbg-header";

      const dbgTitle = document.createElement("span");
      dbgTitle.textContent = "Debug Log";
      dbgHeader.appendChild(dbgTitle);

      this.debugPauseBtn = document.createElement("button");
      this.debugPauseBtn.className = "cghl-dbg-btn";
      this.debugPauseBtn.type = "button";
      this.debugPauseBtn.textContent = "⏸";
      this.debugPauseBtn.title = "Pause log";
      this.debugPauseBtn.addEventListener("click", e => { e.stopPropagation(); this.toggleDebugPause(); });
      dbgHeader.appendChild(this.debugPauseBtn);

      this.debugCopyBtn = document.createElement("button");
      this.debugCopyBtn.className = "cghl-dbg-btn";
      this.debugCopyBtn.type = "button";
      this.debugCopyBtn.textContent = "📋";
      this.debugCopyBtn.title = "Copy log";
      this.debugCopyBtn.addEventListener("click", e => { e.stopPropagation(); this.copyDebugLog(); });
      dbgHeader.appendChild(this.debugCopyBtn);

      const dbgBody = document.createElement("pre");
      dbgBody.className = "cghl-dbg-body";

      this.debugPanel.appendChild(dbgHeader);
      this.debugPanel.appendChild(dbgBody);

      this.panel.appendChild(header);
      this.panel.appendChild(this.list);
      this.panel.appendChild(this.debugPanel);

      // Launcher button
      this.launcher = document.createElement("button");
      this.launcher.id = "cghl-launcher";
      this.launcher.type = "button";
      this.launcher.innerHTML =
        '<span class="cghl-launcher-icon">' +
        getLauncherSvgMarkup() +
        "</span>" +
        '<span>对话树</span>' +
        '<span id="cghl-launcher-count">0</span>';

      this.launcherCount = this.launcher.querySelector("#cghl-launcher-count");
      this.launcher.addEventListener("click", () => this.setPanelOpen(!this.panelOpen));

      // Event delegation for the tree list
      this.list.addEventListener("click", e => {
        const jumpBtn = e.target.closest("[data-action='jump']");
        if (jumpBtn) {
          e.preventDefault();
          e.stopPropagation();
          const nodeKey = jumpBtn.dataset.nodeKey;
          if (nodeKey) this.jumpToNode(nodeKey);
          return;
        }

        const row = e.target.closest(".cghl-row");
        if (row) {
          e.preventDefault();
          e.stopPropagation();
          const nodeKey = row.dataset.nodeKey;
          if (nodeKey) this.jumpToNode(nodeKey);
        }
      });

      this.root.appendChild(this.status);
      this.root.appendChild(this.panel);
      this.root.appendChild(this.launcher);
      document.body.appendChild(this.root);
    }

    /* ─── Panel state ───────────────────────────── */

    setPanelOpen(open) {
      this.panelOpen = open;
      this.root.classList.toggle("is-open", open);
      if (open) this.scrollActiveIntoView();
    }

    showStatus(text, persist) {
      this.status.textContent = text;
      this.status.classList.add("is-visible");
      if (this.statusTimer) {
        window.clearTimeout(this.statusTimer);
        this.statusTimer = null;
      }
      if (!persist) {
        this.statusTimer = window.setTimeout(() => {
          this.status.classList.remove("is-visible");
        }, 2600);
      }
    }

    hideStatus() {
      this.status.classList.remove("is-visible");
    }

    detectTheme() {
      const html = document.documentElement;
      const body = document.body;
      const themeTokens = [
        html?.getAttribute("data-theme"),
        body?.getAttribute("data-theme"),
        html?.className,
        body?.className
      ].filter(Boolean).join(" ").toLowerCase();

      if (/(^|\s)dark($|\s)|dark-mode|theme-dark/.test(themeTokens)) return "dark";
      if (/(^|\s)light($|\s)|light-mode|theme-light/.test(themeTokens)) return "light";

      const backgroundCandidates = [
        body ? window.getComputedStyle(body).backgroundColor : "",
        html ? window.getComputedStyle(html).backgroundColor : ""
      ];

      for (const color of backgroundCandidates) {
        const luminance = luminanceFromColor(color);
        if (luminance == null) continue;
        return luminance < 140 ? "dark" : "light";
      }

      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }

    applyTheme(theme) {
      this.theme = theme === "light" ? "light" : "dark";
      if (this.root) this.root.dataset.theme = this.theme;
      if (this.status) this.status.dataset.theme = this.theme;
    }

    refreshTheme() {
      this.applyTheme(this.detectTheme());
    }

    /* ─── Events ────────────────────────────────── */

    attachEvents() {
      window.addEventListener("scroll", this.handleScroll, { passive: true });
      window.addEventListener("resize", this.handleResize, { passive: true });
      window.addEventListener(URL_CHANGE_EVENT, () => this.handleUrlChange());
      window.addEventListener(THEME_CHECK_EVENT, () => this.refreshTheme());
      if (window.matchMedia) {
        this.themeMedia = window.matchMedia("(prefers-color-scheme: dark)");
        const onThemeMediaChange = () => this.refreshTheme();
        if (typeof this.themeMedia.addEventListener === "function") {
          this.themeMedia.addEventListener("change", onThemeMediaChange);
        } else if (typeof this.themeMedia.addListener === "function") {
          this.themeMedia.addListener(onThemeMediaChange);
        }
      }
      if (document.documentElement && document.body) {
        this.themeObserver = new MutationObserver(() => this.refreshTheme());
        this.themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme", "style"]
        });
        this.themeObserver.observe(document.body, {
          attributes: true,
          attributeFilter: ["class", "data-theme", "style"]
        });
      }
      document.addEventListener("click", e => {
        if (this.root && !this.root.contains(e.target)) {
          this.setPanelOpen(false);
        }
      });
    }

    observeDom() {
      if (this.observer) this.observer.disconnect();
      this.observer = new MutationObserver(() => {
        if (this.switching) return;
        this.rebuildT();
      });
      this.observer.observe(document.body, { childList: true, subtree: true });
    }

    handleScroll() {
      this.updateActiveT();
    }

    handleResize() {
      this.refreshTheme();
      this.rebuildT();
    }

    handleUrlChange() {
      if (this.currentHref === location.href) return;
      this.log("urlChange", `${this.currentHref} → ${location.href}`);
      this.currentHref = location.href;
      this.loadCache();
      this.refreshTheme();
      this.rebuild();
    }

    startUrlPoll() {
      this.urlPollTimer = window.setInterval(() => {
        if (this.currentHref === location.href) return;
        this.currentHref = location.href;
        this.loadCache();
        this.rebuild();
      }, 1000);
    }

    /* ─── Cache management ──────────────────────── */

    cacheKey(kind) {
      const path = `${location.origin}${location.pathname}`.replace(/\/+$/, "") || location.origin;
      return `${STORAGE_PREFIX}${kind}:${path}`;
    }

    loadCache() {
      this.treeNodes = new Map();
      this.branchCache = new Map();
      this.nodeSeq = 0;

      try {
        const raw = window.localStorage.getItem(this.cacheKey("tree-v4"));
        if (!raw) return;
        const data = JSON.parse(raw);
        if (!data || typeof data !== "object") return;

        this.nodeSeq = Math.max(0, Number(data.nodeSeq) || 0);

        if (data.nodes) {
          for (const [key, n] of Object.entries(data.nodes)) {
            if (!key || !n) continue;
            this.treeNodes.set(key, {
              nodeKey: key,
              turnId: n.turnId || "",
              testId: n.testId || "",
              messageId: n.messageId || "",
              parentNodeKey: n.parentNodeKey || null,
              parentSelectedVersion: n.parentSelectedVersion != null ? n.parentSelectedVersion : null,
              summary: n.summary || "",
              replyVersionTotal: Math.max(1, n.replyVersionTotal || 1),
              replyVersionCurrent: Math.max(1, n.replyVersionCurrent || 1),
              childrenByVersion: n.childrenByVersion || {},
              seenAtLeastOnce: Boolean(n.seenAtLeastOnce),
              lastSeenVisible: false,
              depth: Math.max(0, n.depth || 0),
              firstSeenOrder: Math.max(0, n.firstSeenOrder || 0),
              liveIndex: -1
            });
          }
        }

        if (data.branches) {
          for (const [turnId, b] of Object.entries(data.branches)) {
            if (!turnId || !b) continue;
            this.branchCache.set(turnId, {
              total: Math.max(1, b.total || 1),
              current: Math.max(1, b.current || 1),
              seenVersions: b.seenVersions || {}
            });
          }
        }

        // Re-validate childrenByVersion links
        this.treeNodes.forEach(node => {
          const cbv = {};
          for (const [v, keys] of Object.entries(node.childrenByVersion || {})) {
            cbv[v] = Array.isArray(keys) ? keys.filter(k => this.treeNodes.has(k)) : [];
          }
          node.childrenByVersion = cbv;
        });

        this.log("loadCache", `Loaded ${this.treeNodes.size} nodes, ${this.branchCache.size} branches`);
      } catch (_e) {
        this.log("loadCache", "Cache load failed: " + _e.message);
        this.treeNodes = new Map();
        this.branchCache = new Map();
        this.nodeSeq = 0;
      }
    }

    saveCache() {
      try {
        const nodes = {};
        this.treeNodes.forEach((n, key) => {
          nodes[key] = {
            turnId: n.turnId,
            testId: n.testId,
            messageId: n.messageId,
            parentNodeKey: n.parentNodeKey,
            parentSelectedVersion: n.parentSelectedVersion,
            summary: n.summary,
            replyVersionTotal: n.replyVersionTotal,
            replyVersionCurrent: n.replyVersionCurrent,
            childrenByVersion: n.childrenByVersion,
            seenAtLeastOnce: n.seenAtLeastOnce,
            depth: n.depth,
            firstSeenOrder: n.firstSeenOrder
          };
        });

        const branches = {};
        this.branchCache.forEach((b, turnId) => {
          branches[turnId] = { total: b.total, current: b.current, seenVersions: b.seenVersions };
        });

        window.localStorage.setItem(
          this.cacheKey("tree-v4"),
          JSON.stringify({ nodeSeq: this.nodeSeq, nodes, branches })
        );
      } catch (_e) {
        // Ignore storage failures.
      }
    }

    scheduleSave() {
      if (this.persistTimer) window.clearTimeout(this.persistTimer);
      this.persistTimer = window.setTimeout(() => this.saveCache(), 150);
    }

    /* ─── DOM queries ───────────────────────────── */

    isSupportedPage() {
      return PAGE_RE.test(location.href) && Boolean(document.querySelector("main"));
    }

    queryAll(selectorList) {
      const hits = [];
      for (const sel of selectorList) {
        hits.push(...document.querySelectorAll(sel));
      }
      return dedupe(hits);
    }

    getAssistantTurns() {
      return this.queryAll(SELECTORS.assistantTurns)
        .filter(t => t.closest("main"))
        .filter(t => t.getAttribute("data-turn") === "assistant")
        .filter(t => !isNonConv(t))
        .sort((a, b) => elTop(a) - elTop(b));
    }

    getTurnId(turn, focus) {
      const candidates = [
        focus?.getAttribute("data-message-id"),
        turn?.getAttribute("data-message-id"),
        turn?.getAttribute("data-turn-id"),
        focus?.getAttribute("data-turn-id"),
        turn?.getAttribute("data-testid"),
        focus?.getAttribute("data-testid")
      ];
      return candidates.find(Boolean) || `pos-${Math.round(elTop(turn || focus || document.body))}`;
    }

    scanReplyVersion(root) {
      if (!root) return null;

      // Fast path: tabular-nums indicator
      for (const node of root.querySelectorAll(".tabular-nums")) {
        const parsed = parseVersion(node.textContent || "");
        if (parsed) return parsed;
      }

      // Strategy 2: find version text near prev/next buttons
      const buttons = root.querySelectorAll('button[aria-label]');
      for (const btn of buttons) {
        const label = btn.getAttribute("aria-label") || "";
        if (!/上一回复|下一回复|Previous|Next|上一|下一/i.test(label)) continue;
        // Walk up to find a container with version text
        let container = btn.parentElement;
        for (let depth = 0; depth < 4 && container; depth++) {
          const text = (container.textContent || "").trim();
          const parsed = parseVersion(text);
          if (parsed) return parsed;
          container = container.parentElement;
        }
      }

      // Strategy 3: scan small text elements for "N / N" pattern
      const candidates = root.querySelectorAll("span, div");
      for (const el of candidates) {
        if (el.children.length > 3) continue;
        const text = (el.textContent || "").trim();
        if (text.length > 12) continue;
        const parsed = parseVersion(text);
        if (parsed) return parsed;
      }

      return null;
    }

    scanReplyVersionStable(root) {
      const fallback = this.scanReplyVersion(root);
      if (!root) return fallback;

      const candidates = [];
      const seen = new Set();
      const addCandidate = (el, source) => {
        if (!el || seen.has(el)) return;
        const text = (el.textContent || "").trim();
        if (!text || text.length > 12) return;
        const parsed = parseVersion(text);
        if (!parsed) return;
        seen.add(el);
        candidates.push({ el, parsed, source });
      };

      for (const node of root.querySelectorAll(".tabular-nums")) {
        addCandidate(node, "tabular");
      }

      const navButtons = Array.from(root.querySelectorAll('button[aria-label], [role="button"][aria-label]')).filter(btn => {
        const label = btn.getAttribute("aria-label") || "";
        return /涓婁竴鍥炲|涓嬩竴鍥炲|Previous|Next|涓婁竴|涓嬩竴/i.test(label);
      });

      for (const btn of navButtons) {
        let container = btn.parentElement;
        for (let depth = 0; depth < 4 && container; depth++) {
          addCandidate(container, "button-container");
          for (const nearby of container.querySelectorAll(".tabular-nums, span, div")) {
            if (nearby.children.length > 3 && !nearby.classList.contains("tabular-nums")) continue;
            addCandidate(nearby, "button-nearby");
          }
          container = container.parentElement;
        }
      }

      for (const el of root.querySelectorAll("span, div")) {
        if (el.children.length > 3) continue;
        addCandidate(el, "generic");
      }

      if (candidates.length === 0) return fallback;

      const buttonRects = navButtons.map(btn => btn.getBoundingClientRect());
      const bandLeft = buttonRects.length > 0 ? Math.min(...buttonRects.map(rect => rect.left)) : 0;
      const bandRight = buttonRects.length > 0 ? Math.max(...buttonRects.map(rect => rect.right)) : 0;
      const scoreCandidate = candidate => {
        const { el, source } = candidate;
        const rect = el.getBoundingClientRect();
        let score = 0;

        if (source === "tabular") score += 8;
        if (source === "button-container") score += 7;
        if (source === "button-nearby") score += 5;

        if (buttonRects.length > 0) {
          let minDistance = Infinity;
          let aligned = false;
          for (const btnRect of buttonRects) {
            const dx = Math.abs((rect.left + rect.right) / 2 - (btnRect.left + btnRect.right) / 2);
            const dy = Math.abs((rect.top + rect.bottom) / 2 - (btnRect.top + btnRect.bottom) / 2);
            minDistance = Math.min(minDistance, dx + dy);
            if (rect.bottom >= btnRect.top - 10 && rect.top <= btnRect.bottom + 10) aligned = true;
          }

          const insideBand = rect.left >= bandLeft - 24 && rect.right <= bandRight + 24;
          if (aligned) score += 8;
          if (insideBand) score += 5;
          if (Number.isFinite(minDistance)) score += Math.max(0, 18 - minDistance / 12);
        }

        score += rect.top / 1000;
        return score;
      };

      candidates.sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
      return candidates[0]?.parsed || fallback;
    }

    getReplyVersion(userTurn, assistantTurn, turnId) {
      const fresh =
        this.scanReplyVersionStable(userTurn) ||
        this.scanReplyVersionStable(assistantTurn) ||
        { current: 1, total: 1, hasVariants: false };

      const cached = this.branchCache.get(turnId);

      // Merge with cache for max-known total
      if (fresh.hasVariants || (cached && cached.total > 1)) {
        const total = Math.max(fresh.total || 1, cached?.total || 1);
        const current = fresh.hasVariants ? fresh.current : (cached?.current || 1);
        return { current, total, hasVariants: total > 1 };
      }

      return fresh;
    }

    updateBranchCache(turnId, replyVersion) {
      if (!turnId) return;
      const existing = this.branchCache.get(turnId) || { total: 1, current: 1, seenVersions: {} };
      this.branchCache.set(turnId, {
        total: Math.max(existing.total, replyVersion.total || 1),
        current: replyVersion.current || existing.current || 1,
        seenVersions: { ...existing.seenVersions, [String(replyVersion.current || 1)]: true }
      });
    }

    getReplyLabels(direction) {
      return direction < 0
        ? ["涓婁竴鍥炲", "Previous response"]
        : ["涓嬩竴鍥炲", "Next response"];
    }

    getReplyButtonPatterns(direction) {
      return direction < 0
        ? [/涓婁竴/i, /previous/i, /prev/i, /鍚戝墠/i]
        : [/涓嬩竴/i, /next/i, /鍚戝悗/i];
    }

    findReplyButtonsInRoot(root, direction) {
      if (!root) return [];
      const labels = this.getReplyLabels(direction);
      const patterns = this.getReplyButtonPatterns(direction);
      const seen = new Set();
      const matches = [];
      const add = btn => {
        if (!btn || btn.disabled || seen.has(btn)) return;
        seen.add(btn);
        matches.push(btn);
      };

      for (const label of labels) {
        root.querySelectorAll(`button[aria-label="${label}"], [role="button"][aria-label="${label}"]`).forEach(add);
      }

      root.querySelectorAll('button, [role="button"]').forEach(btn => {
        if (btn.disabled || seen.has(btn)) return;
        const haystack = [
          btn.getAttribute("aria-label") || "",
          btn.getAttribute("title") || "",
          btn.textContent || ""
        ].join(" ");
        if (patterns.some(pattern => pattern.test(haystack))) add(btn);
      });

      return matches;
    }

    buildReplySwitcherIndex(turnHits, assistantTurns) {
      const index = new Map();
      if (!turnHits?.length) return index;

      const allButtons = this.findReplyButtonsInRoot(document, -1)
        .concat(this.findReplyButtonsInRoot(document, 1));
      if (allButtons.length === 0) return index;

      const groups = [];
      const seenContainers = new Set();

      for (const btn of allButtons) {
        let container = btn.parentElement;
        let best = null;
        for (let depth = 0; depth < 6 && container; depth++) {
          const prevButtons = this.findReplyButtonsInRoot(container, -1);
          const nextButtons = this.findReplyButtonsInRoot(container, 1);
          const version = this.scanReplyVersionStable(container) || this.scanReplyVersion(container);
          if ((prevButtons.length || nextButtons.length) && version) {
            best = { container, prevButtons, nextButtons, version };
            if (prevButtons.length && nextButtons.length) break;
          }
          container = container.parentElement;
        }

        if (!best || seenContainers.has(best.container)) continue;
        seenContainers.add(best.container);
        groups.push(best);
      }

      const turnMeta = turnHits
        .map((turn, idx) => {
          const testId = getStableTestId(turn) || "";
          const turnTop = elTop(turn);
          const nextTurn = turnHits[idx + 1] || null;
          const nextTurnTop = nextTurn ? elTop(nextTurn) : Infinity;
          const assistantTurn = assistantTurns.find(a => {
            const aTop = elTop(a);
            return aTop > turnTop && aTop < nextTurnTop;
          }) || null;
          const anchorTop = assistantTurn ? elTop(assistantTurn) : turnTop;
          return { testId, turnTop, nextTurnTop, anchorTop };
        })
        .filter(meta => meta.testId);

      for (const group of groups) {
        const rect = group.container.getBoundingClientRect();
        const centerY = rect.top + window.scrollY + rect.height / 2;
        let bestMeta = null;
        let bestScore = -Infinity;

        for (const meta of turnMeta) {
          const inRange = centerY >= meta.turnTop - 40 && centerY < meta.nextTurnTop + 20;
          const distance = Math.abs(centerY - meta.anchorTop);
          let score = -distance / 20;
          if (inRange) score += 100;
          if (centerY >= meta.turnTop - 8) score += 20;
          if (centerY < meta.turnTop - 60) score -= 80;
          if (score > bestScore) {
            bestScore = score;
            bestMeta = meta;
          }
        }

        if (!bestMeta) continue;
        index.set(bestMeta.testId, {
          testId: bestMeta.testId,
          container: group.container,
          version: group.version,
          prevButtons: group.prevButtons,
          nextButtons: group.nextButtons
        });
      }

      return index;
    }

    scoreReplyButtonCandidate(msg, button) {
      if (!msg || !button) return -Infinity;

      const buttonRect = button.getBoundingClientRect();
      const buttonCenterY = buttonRect.top + window.scrollY + buttonRect.height / 2;
      const buttonCenterX = buttonRect.left + window.scrollX + buttonRect.width / 2;
      const anchors = [msg.assistantTurn, msg.focusElement, msg.element].filter(Boolean);
      let score = 0;

      for (const anchor of anchors) {
        if (!anchor?.isConnected) continue;
        const anchorRect = anchor.getBoundingClientRect();
        const anchorCenterY = anchorRect.top + window.scrollY + anchorRect.height / 2;
        const anchorCenterX = anchorRect.left + window.scrollX + anchorRect.width / 2;
        const dy = Math.abs(buttonCenterY - anchorCenterY);
        const dx = Math.abs(buttonCenterX - anchorCenterX);
        score = Math.max(score, 100 - dy / 10 - dx / 20);

        const sameSection = anchor.closest('[data-testid^="conversation-turn-"]') === button.closest('[data-testid^="conversation-turn-"]');
        if (sameSection) score += 80;
      }

      const sameAssistantTurn = msg.assistantTurn && msg.assistantTurn.contains(button);
      if (sameAssistantTurn) score += 120;

      const container = button.parentElement;
      if (container && (this.scanReplyVersionStable(container) || this.scanReplyVersion(container))) {
        score += 40;
      }

      if (button.closest("#cghl-root")) score -= 500;
      return score;
    }

    pickBestReplyButton(msg, buttons, direction, source) {
      const uniqueButtons = dedupe((buttons || []).filter(Boolean)).filter(btn => !btn.disabled);
      if (uniqueButtons.length === 0) return null;

      let best = null;
      let bestScore = -Infinity;
      for (const btn of uniqueButtons) {
        const score = this.scoreReplyButtonCandidate(msg, btn);
        if (score > bestScore) {
          bestScore = score;
          best = btn;
        }
      }

      if (best) {
        this.log("getReplyButton", `Found via ${source} for ${msg?.testId || msg?.turnId || "unknown"}`, {
          dir: direction,
          score: Math.round(bestScore)
        });
      }
      return best;
    }

    /**
     * Find the prev/next response button near a given message.
     * Searches multiple DOM roots (assistant turn, user turn, local containers)
     * for buttons with known aria-labels or text patterns.
     */
    getReplyButton(msg, direction) {
      const indexed = msg?.testId ? this.replySwitcherIndex.get(msg.testId) : null;
      if (indexed) {
        const buttons = direction < 0 ? indexed.prevButtons : indexed.nextButtons;
        const btn = Array.from(buttons || []).find(node => node && !node.disabled);
        if (btn) {
          this.log("getReplyButton", `Found via switcher index for ${msg.testId}`, {
            dir: direction,
            version: indexed.version
          });
          return btn;
        }
      }

      const possibleRoots = [];

      // 1. Assistant turn and its parent
      if (msg.assistantTurn) {
        possibleRoots.push(msg.assistantTurn);
        const parent = msg.assistantTurn.parentElement;
        if (parent) possibleRoots.push(parent);
      }

      // 2. User turn element and its local section container
      if (msg.element) {
        possibleRoots.push(msg.element);
        const section = msg.element.closest('section[data-testid^="conversation-turn-"]');
        if (section) {
          possibleRoots.push(section);
          const parent = section.parentElement;
          if (parent) possibleRoots.push(parent);
        }
      }

      // 3. Focus element section and its local container
      if (msg.focusElement && msg.focusElement !== msg.element) {
        possibleRoots.push(msg.focusElement);
        const section = msg.focusElement.closest('section[data-testid^="conversation-turn-"]');
        if (section) {
          possibleRoots.push(section);
          const parent = section.parentElement;
          if (parent) possibleRoots.push(parent);
        }
      }

      const roots = dedupe(possibleRoots);

      const directCandidates = [];
      for (const root of roots) {
        for (const label of this.getReplyLabels(direction)) {
          root.querySelectorAll(`button[aria-label="${label}"]`).forEach(btn => {
            if (!btn.disabled) directCandidates.push(btn);
          });
        }
      }
      const directBest = this.pickBestReplyButton(msg, directCandidates, direction, "scored direct labels");
      if (directBest) return directBest;

      const regexCandidates = [];
      const patterns = this.getReplyButtonPatterns(direction);
      for (const root of roots) {
        root.querySelectorAll('button, [role="button"]').forEach(btn => {
          if (btn.disabled) return;
          const haystack = [
            btn.getAttribute("aria-label") || "",
            btn.getAttribute("title") || "",
            btn.textContent || ""
          ].join(" ");
          if (patterns.some(p => p.test(haystack))) regexCandidates.push(btn);
        });
      }
      const regexBest = this.pickBestReplyButton(msg, regexCandidates, direction, "scored regex");
      if (regexBest) return regexBest;

      // Direct selectors (fastest)
      const directLabels = direction < 0
        ? ["上一回复", "Previous response"]
        : ["下一回复", "Next response"];

      for (const root of roots) {
        for (const label of directLabels) {
          const btn = Array.from(root.querySelectorAll(`button[aria-label="${label}"]`)).find(node => !node.disabled);
          if (btn) {
            this.log("getReplyButton", `Found via label "${label}" in ${root.tagName}.${root.className?.split(" ")[0] || ""}#${root.dataset?.testid || "?"}`);
            return btn;
          }
        }
      }

      // Regex fallback: broader set of patterns
      const legacyPatterns = direction < 0
        ? [/上一/i, /previous/i, /prev/i, /向前/i]
        : [/下一/i, /next/i, /向后/i];

      for (const root of roots) {
        const buttons = root.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          if (btn.disabled) continue;
          const haystack = [
            btn.getAttribute("aria-label") || "",
            btn.getAttribute("title") || "",
            btn.textContent || ""
          ].join(" ");
          if (legacyPatterns.some(p => p.test(haystack))) {
            this.log("getReplyButton", `Found via regex in ${root.tagName}`, { haystack: haystack.slice(0, 40) });
            return btn;
          }
        }
      }

      // Nuclear fallback: look for buttons NEAR a version indicator
      for (const root of roots) {
        const versionEl = Array.from(root.querySelectorAll("span, div")).find(el => {
          return parseVersion((el.textContent || "").trim()) !== null;
        });
        if (!versionEl) continue;

        // Find adjacent buttons (siblings or parent's children)
        const container = versionEl.parentElement;
        if (!container) continue;
        const btns = container.querySelectorAll("button");
        const sorted = Array.from(btns).filter(b => !b.disabled);
        if (sorted.length >= 2) {
          // Assume first button is "prev" and last is "next"
          const btn = direction < 0 ? sorted[0] : sorted[sorted.length - 1];
          this.log("getReplyButton", `Found via nuclear fallback near version indicator`, { btnText: btn.textContent?.slice(0, 20) });
          return btn;
        }
      }

      this.log("getReplyButton", `NOT FOUND dir=${direction}`, {
        rootCount: roots.length,
        rootTags: roots.map(r => `${r.tagName}.${r.dataset?.testid || r.id || "?"}`).join(", "),
        msgTurnId: msg.turnId,
        msgTestId: msg.testId
      });
      return null;
    }

    getUserTurnEntries() {
      // Strategy 1: section[data-turn="user"]
      const turnHits = this.queryAll(SELECTORS.userTurns)
        .filter(t => t.closest("main"))
        .filter(t => t.getAttribute("data-turn") === "user")
        .filter(t => !isNonConv(t));

      const assistantTurns = this.getAssistantTurns();
      this.replySwitcherIndex = this.buildReplySwitcherIndex(turnHits, assistantTurns);

      if (turnHits.length > 0) {
        const entries = turnHits.map(turn => {
          const focus =
            turn.querySelector('[data-message-author-role="user"][data-message-id]') ||
            turn.querySelector('[data-message-author-role="user"]') ||
            turn;
          const turnId = this.getTurnId(turn, focus);
          const messageId = focus?.getAttribute("data-message-id") || turnId;
          const testId = getStableTestId(turn) || getStableTestId(focus) || "";
          const turnTop = elTop(turn);
          const nextUserTop = turnHits.map(t => elTop(t)).find(top => top > turnTop);
          const assistantTurn =
            assistantTurns.find(a => {
              const aTop = elTop(a);
              return aTop > turnTop && (nextUserTop === undefined || aTop < nextUserTop);
            }) || null;
          const switcher = this.replySwitcherIndex.get(testId);
          const replyVersion = switcher?.version || this.getReplyVersion(turn, assistantTurn, turnId);
          return { turnElement: turn, focusElement: focus, assistantTurn, replyVersion, turnId, messageId, testId };
        });

        // Dedupe by turnId
        const seen = new Set();
        const deduped = [];
        for (const e of entries) {
          const key = e.turnId;
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(e);
        }
        return deduped.sort((a, b) => elTop(a.turnElement) - elTop(b.turnElement));
      }

      // Strategy 2: [data-message-author-role="user"][data-message-id]
      const msgHits = this.queryAll(SELECTORS.userMessages)
        .filter(n => n.getAttribute("data-message-author-role") === "user")
        .filter(n => hasText(n))
        .filter(n => !isNonConv(n))
        .sort((a, b) => elTop(a) - elTop(b));

      if (msgHits.length > 0) {
        this.replySwitcherIndex = new Map();
        return msgHits.map(node => {
          const turnEl = node.closest('[data-testid^="conversation-turn-"]') || node;
          const turnId = this.getTurnId(turnEl, node);
          const messageId = node.getAttribute("data-message-id") || turnId;
          const testId = getStableTestId(turnEl) || getStableTestId(node) || "";
          return {
            turnElement: turnEl,
            focusElement: node,
            assistantTurn: null,
            replyVersion: { current: 1, total: 1, hasVariants: false },
            turnId,
            messageId,
            testId
          };
        });
      }

      this.replySwitcherIndex = new Map();
      return [];
    }

    /* ─── Message lookup methods ────────────────── */

    findMsgByTurnId(turnId) {
      return this.messages.find(m => m.turnId === turnId) || null;
    }

    /**
     * Find a message by its stable position ID (data-testid).
     * This is crucial: data-testid stays the same when switching user-message
     * branches, unlike data-message-id which changes per version.
     */
    findMsgByTestId(testId) {
      if (!testId) return null;
      return this.messages.find(m => m.testId === testId) || null;
    }

    /**
     * Find a message by position index. Used as a last-resort fallback
     * when both turnId and testId lookups fail.
     */
    findMsgByIndex(index) {
      if (index < 0 || index >= this.messages.length) return null;
      return this.messages[index];
    }

    /**
     * Robust message lookup: tries turnId first, then testId, then index.
     * Returns { msg, newTurnId } so callers can update their tracking.
     */
    findMsgRobust(turnId, testId, posIndex) {
      let msg = this.findMsgByTurnId(turnId);
      if (msg) return { msg, newTurnId: msg.turnId };

      // turnId changed (e.g. user-message branch switch changes data-message-id)
      msg = this.findMsgByTestId(testId);
      if (msg) {
        this.log("findMsgRobust", `turnId "${turnId}" not found, but testId "${testId}" matched → new turnId = "${msg.turnId}"`);
        return { msg, newTurnId: msg.turnId };
      }

      // Last resort: positional
      msg = this.findMsgByIndex(posIndex);
      if (msg) {
        this.log("findMsgRobust", `Fallback to index ${posIndex} → turnId = "${msg.turnId}"`);
        return { msg, newTurnId: msg.turnId };
      }

      this.log("findMsgRobust", `ALL lookups failed: turnId="${turnId}", testId="${testId}", idx=${posIndex}`);
      return { msg: null, newTurnId: turnId };
    }

    /* ─── Tree model ────────────────────────────── */

    findNodeByContext(parentKey, parentVersion, turnId) {
      if (!parentKey) {
        for (const [key, node] of this.treeNodes) {
          if (!node.parentNodeKey && node.turnId === turnId) return key;
        }
        return null;
      }

      const parent = this.treeNodes.get(parentKey);
      if (!parent) return null;

      const vKey = String(parentVersion || 0);

      // 1. Check exact version bucket
      const children = parent.childrenByVersion[vKey] || [];
      for (const ck of children) {
        const child = this.treeNodes.get(ck);
        if (child && child.turnId === turnId) return ck;
      }

      // 2. Search ALL version buckets as fallback.
      //    This is critical: version detection (scanReplyVersion) can fluctuate
      //    between returning hasVariants=true (parentVersion=N) and false
      //    (parentVersion=0) across rebuilds. Without this fallback, a node
      //    recorded under v1 becomes permanently orphaned when detection
      //    returns v0, creating a duplicate node and onLive=false.
      for (const [v, keys] of Object.entries(parent.childrenByVersion)) {
        if (v === vKey) continue;
        for (const ck of keys || []) {
          const child = this.treeNodes.get(ck);
          if (child && child.turnId === turnId) {
            this.log("findNodeByContext", `Found "${turnId.slice(0,12)}" in v${v} instead of v${vKey} under parent (version detection mismatch)`);
            return ck;
          }
        }
      }

      return null;
    }

    createNodeKey(parentKey, parentVersion, turnId) {
      if (!parentKey) return `root::${turnId}`;
      return `${parentKey}>v${parentVersion || 0}>${turnId}`;
    }

    captureCurrentPath() {
      let parentKey = null;
      let parentVersion = null;

      this.treeNodes.forEach(n => {
        n.lastSeenVisible = false;
        n.liveIndex = -1;
      });

      const pathKeys = [];

      for (let i = 0; i < this.messages.length; i++) {
        const msg = this.messages[i];
        let nodeKey = this.findNodeByContext(parentKey, parentVersion, msg.turnId);

        if (!nodeKey) {
          nodeKey = this.createNodeKey(parentKey, parentVersion, msg.turnId);
          this.treeNodes.set(nodeKey, {
            nodeKey,
            turnId: msg.turnId,
            testId: msg.testId || "",
            messageId: msg.messageId,
            parentNodeKey: parentKey,
            parentSelectedVersion: parentVersion,
            summary: (msg.previewText || "").slice(0, 120),
            replyVersionTotal: msg.replyVersion?.total || 1,
            replyVersionCurrent: msg.replyVersion?.current || 1,
            childrenByVersion: {},
            seenAtLeastOnce: true,
            lastSeenVisible: true,
            depth: parentKey ? (this.treeNodes.get(parentKey)?.depth || 0) + 1 : 0,
            firstSeenOrder: ++this.nodeSeq,
            liveIndex: i
          });
          this.log("newNode", `Created ${nodeKey}`, { turnId: msg.turnId, testId: msg.testId, parentKey, pv: parentVersion });
        } else {
          const node = this.treeNodes.get(nodeKey);
          node.summary = (msg.previewText || node.summary || "").slice(0, 120);
          node.messageId = msg.messageId || node.messageId;
          node.testId = msg.testId || node.testId;
          node.replyVersionTotal = Math.max(node.replyVersionTotal || 1, msg.replyVersion?.total || 1);
          node.replyVersionCurrent = msg.replyVersion?.current || node.replyVersionCurrent || 1;
          node.seenAtLeastOnce = true;
          node.lastSeenVisible = true;
          node.liveIndex = i;
        }

        if (parentKey) {
          const parent = this.treeNodes.get(parentKey);
          if (parent) {
            const vKey = String(parentVersion || 0);
            if (!parent.childrenByVersion[vKey]) parent.childrenByVersion[vKey] = [];
            if (!parent.childrenByVersion[vKey].includes(nodeKey)) {
              parent.childrenByVersion[vKey].push(nodeKey);
            }
          }
        }

        msg.nodeKey = nodeKey;
        pathKeys.push(nodeKey);
        this.updateBranchCache(msg.turnId, msg.replyVersion);

        parentKey = nodeKey;
        parentVersion = msg.replyVersion?.hasVariants ? msg.replyVersion.current : 0;
      }

      this.livePathKeys = pathKeys;
      this.scheduleSave();
    }

    getNodeChain(nodeKey) {
      const chain = [];
      let current = nodeKey;
      const seen = new Set();
      while (current) {
        if (seen.has(current)) break;
        seen.add(current);
        const node = this.treeNodes.get(current);
        if (!node) break;
        chain.unshift(node);
        current = node.parentNodeKey;
      }
      return chain;
    }

    getAllChildrenFlat(node) {
      if (!node) return [];
      const children = [];
      const versions = Object.keys(node.childrenByVersion).map(Number).sort((a, b) => a - b);
      for (const v of versions) {
        for (const childKey of node.childrenByVersion[String(v)] || []) {
          const child = this.treeNodes.get(childKey);
          if (child) children.push(child);
        }
      }
      children.sort((a, b) => (a.firstSeenOrder || 0) - (b.firstSeenOrder || 0));
      return children;
    }

    /* ─── Render order computation ──────────────── */

    computeRenderOrder() {
      const result = [];
      const visited = new Set();

      const roots = [];
      this.treeNodes.forEach(node => {
        if (!node.parentNodeKey || !this.treeNodes.has(node.parentNodeKey)) {
          roots.push(node);
        }
      });
      roots.sort((a, b) => (a.firstSeenOrder || 0) - (b.firstSeenOrder || 0));

      const dfs = (node, guides) => {
        if (!node || visited.has(node.nodeKey)) return;
        visited.add(node.nodeKey);

        result.push({ node, guides: guides.slice() });

        const children = this.getAllChildrenFlat(node);
        for (let i = 0; i < children.length; i++) {
          const isLast = i === children.length - 1;
          dfs(children[i], [...guides, !isLast]);
        }
      };

      for (const root of roots) {
        dfs(root, []);
      }

      return result;
    }

    /* ─── Signature (for render-diffing) ────────── */

    getSignature() {
      const parts = [];
      this.treeNodes.forEach(n => {
        const branchSig = `${n.replyVersionTotal}:${n.replyVersionCurrent}`;
        parts.push(`${n.nodeKey}|${n.summary?.slice(0, 20)}|${n.lastSeenVisible ? 1 : 0}|${branchSig}`);
      });
      parts.push(`live:${this.livePathKeys.join(",")}`);
      parts.push(`active:${this.activeNodeKey}`);
      return parts.join("~");
    }

    /* ─── Rebuild (main entry) ──────────────────── */

    rebuild() {
      if (!this.isSupportedPage()) {
        this.messages = [];
        this.livePathKeys = [];
        this.renderTree();
        return;
      }

      const entries = this.getUserTurnEntries();
      this.scrollContainer =
        (entries[0] && scrollAncestor(entries[0].turnElement)) ||
        document.scrollingElement ||
        document.documentElement;

      const sc = this.scrollContainer;
      const isDoc = sc === document.scrollingElement || sc === document.documentElement;
      const scrollH = isDoc ? document.documentElement.scrollHeight : sc.scrollHeight;
      const clientH = isDoc ? window.innerHeight : sc.clientHeight;
      const scrollRange = Math.max(1, scrollH - clientH);

      const prevMsgCount = this.messages.length;
      const prevNodeCount = this.treeNodes.size;

      this.messages = entries.map((entry, index) => {
        const top = elTopIn(entry.turnElement, sc);
        const previewText = (entry.focusElement?.textContent || entry.turnElement?.textContent || "")
          .trim()
          .replace(/\s+/g, " ");
        return {
          index,
          element: entry.turnElement,
          focusElement: entry.focusElement || entry.turnElement,
          assistantTurn: entry.assistantTurn || null,
          replyVersion: entry.replyVersion || { current: 1, total: 1, hasVariants: false },
          turnId: entry.turnId,
          testId: entry.testId || "",
          messageId: entry.messageId,
          previewText,
          top,
          relative: clamp(top / scrollRange, 0, 1),
          nodeKey: ""
        };
      });

      this.captureCurrentPath();
      this.updateActive();
      this.updateHarvestBtn();

      const sig = this.getSignature();
      if (sig !== this.lastSignature) {
        this.lastSignature = sig;
        this.renderTree();
      }

      // Only log rebuild when something interesting changed
      if (this.messages.length !== prevMsgCount || this.treeNodes.size !== prevNodeCount) {
        this.log("rebuild", `${this.messages.length} msgs, ${this.treeNodes.size} nodes`);
      }
    }

    /* ─── Tree rendering ────────────────────────── */

    renderTree() {
      if (!this.list) return;
      this.list.textContent = "";

      const order = this.computeRenderOrder();
      const fragment = document.createDocumentFragment();
      const liveSet = new Set(this.livePathKeys);

      if (order.length === 0) {
        const empty = document.createElement("div");
        empty.className = "cghl-empty";
        empty.textContent = "暂无节点\n打开对话页面后自动采集";
        fragment.appendChild(empty);
        this.list.appendChild(fragment);
        this.updateCounts(0);
        return;
      }

      for (const { node, guides } of order) {
        const isActive = liveSet.has(node.nodeKey);
        const isCurrent = node.nodeKey === this.activeNodeKey;

        const row = document.createElement("div");
        row.className = "cghl-row";
        row.dataset.nodeKey = node.nodeKey;
        if (isActive) row.dataset.active = "";
        if (isCurrent) row.dataset.current = "";

        // ── Indent guides ──
        const indent = document.createElement("div");
        indent.className = "cghl-indent";

        for (let i = 0; i < guides.length; i++) {
          const g = document.createElement("span");
          g.className = "cghl-guide";
          if (i < guides.length - 1) {
            g.classList.add(guides[i] ? "cghl-guide--pipe" : "cghl-guide--empty");
          } else {
            g.classList.add(guides[i] ? "cghl-guide--branch" : "cghl-guide--elbow");
          }
          indent.appendChild(g);
        }
        row.appendChild(indent);

        // ── Dot ──
        const dot = document.createElement("span");
        dot.className = "cghl-dot";
        row.appendChild(dot);

        // ── Info ──
        const info = document.createElement("div");
        info.className = "cghl-info";

        const textBtn = document.createElement("button");
        textBtn.className = "cghl-text-btn";
        textBtn.type = "button";
        textBtn.dataset.action = "jump";
        textBtn.dataset.nodeKey = node.nodeKey;
        const text = node.summary || "…";
        textBtn.textContent = text.length > 40 ? text.slice(0, 38) + "…" : text;
        info.appendChild(textBtn);

        // Branch count indicator (non-interactive)
        const total = node.replyVersionTotal || 1;
        if (total > 1) {
          const branchInfo = this.branchCache.get(node.turnId);
          const currentV = branchInfo?.current || node.replyVersionCurrent || 1;
          const branchTag = document.createElement("span");
          branchTag.className = "cghl-branch-tag";
          branchTag.textContent = `${currentV}/${total}`;
          branchTag.title = `当前版本 ${currentV}，共 ${total} 个版本`;
          info.appendChild(branchTag);
        }

        // Branch badge (parent version this node is under)
        if (node.parentSelectedVersion && node.parentSelectedVersion !== 0) {
          const badge = document.createElement("span");
          badge.className = "cghl-badge";
          badge.textContent = `← v${node.parentSelectedVersion}`;
          info.appendChild(badge);
        }

        row.appendChild(info);
        fragment.appendChild(row);
      }

      this.list.appendChild(fragment);
      this.updateCounts(this.treeNodes.size);
    }

    updateCounts(count) {
      const str = String(count);
      if (this.countBadge) this.countBadge.textContent = str;
      if (this.launcherCount) this.launcherCount.textContent = str;
    }

    /* ─── Active marker ─────────────────────────── */

    findCurrentIndex() {
      if (this.messages.length === 0) return -1;
      const sc = this.scrollContainer || document.scrollingElement || document.documentElement;
      const isDoc = sc === document.scrollingElement || sc === document.documentElement;
      const scrollTop = isDoc ? window.scrollY : sc.scrollTop;
      const vh = isDoc ? window.innerHeight : sc.clientHeight;
      const anchor = scrollTop + vh * 0.35;

      let current = 0;
      for (let i = 0; i < this.messages.length; i++) {
        if (this.messages[i].top <= anchor) current = i;
        else break;
      }
      return current;
    }

    updateActive() {
      const idx = this.findCurrentIndex();
      this.activeIndex = idx;
      const newKey = idx >= 0 ? (this.messages[idx]?.nodeKey || "") : "";

      if (newKey === this.activeNodeKey) return;
      this.activeNodeKey = newKey;

      this.list.querySelectorAll(".cghl-row[data-current]").forEach(r => delete r.dataset.current);
      if (this.activeNodeKey) {
        const row = this.list.querySelector(`.cghl-row[data-node-key="${CSS.escape(this.activeNodeKey)}"]`);
        if (row) {
          row.dataset.current = "";
          this.scrollActiveIntoView();
        }
      }
    }

    scrollActiveIntoView() {
      if (!this.panelOpen) return;
      const active = this.list.querySelector(".cghl-row[data-current]");
      if (active) active.scrollIntoView({ block: "nearest" });
    }

    /* ─── Navigation ────────────────────────────── */

    scrollToMsg(index, smooth) {
      const msg = this.messages[index];
      if (!msg || !msg.element?.isConnected) return;

      const sc = this.scrollContainer || document.scrollingElement || document.documentElement;
      const isDoc = sc === document.scrollingElement || sc === document.documentElement;
      const vh = isDoc ? window.innerHeight : sc.clientHeight;
      const scrollTop = isDoc ? window.scrollY : sc.scrollTop;

      // Always recalculate fresh position (msg.top may be stale after DOM changes)
      const freshTop = elTopIn(msg.element, sc);
      const scrollH = isDoc ? document.documentElement.scrollHeight : sc.scrollHeight;
      const maxTop = Math.max(0, scrollH - vh);
      const targetTop = clamp(freshTop - Math.floor(vh * SCROLL_ANCHOR), 0, maxTop);

      // For large distances (> 1.5 viewports), use instant scroll
      // — smooth scroll is unreliable over huge distances and can be
      //   interrupted by ChatGPT's own scroll handlers.
      const distance = Math.abs(targetTop - scrollTop);
      const useSmooth = smooth && distance < vh * 1.5;

      if (this.jumpTimer) window.clearTimeout(this.jumpTimer);

      // Single scroll call (no conflicting scrollIntoView + scrollTo)
      const behavior = useSmooth ? "smooth" : "auto";
      if (isDoc) {
        window.scrollTo({ top: targetTop, behavior });
      } else {
        sc.scrollTo({ top: targetTop, behavior });
      }

      // Post-scroll verification: if layout shifted (lazy-loaded content,
      // dynamic resizing), do a corrective instant scroll.
      const verifyDelay = useSmooth ? 400 : 80;
      this.jumpTimer = window.setTimeout(() => {
        if (!msg.element?.isConnected) return;
        const newTop = elTopIn(msg.element, sc);
        const newScrollH = isDoc ? document.documentElement.scrollHeight : sc.scrollHeight;
        const newMaxTop = Math.max(0, newScrollH - vh);
        const corrected = clamp(newTop - Math.floor(vh * SCROLL_ANCHOR), 0, newMaxTop);
        const currentScroll = isDoc ? window.scrollY : sc.scrollTop;

        if (Math.abs(currentScroll - corrected) > 40) {
          this.log("scrollToMsg", `Corrective scroll: off by ${Math.round(currentScroll - corrected)}px`);
          if (isDoc) window.scrollTo({ top: corrected, behavior: "auto" });
          else sc.scrollTo({ top: corrected, behavior: "auto" });
        }

        this.updateActive();
      }, verifyDelay);

      this.flashElement(msg.focusElement || msg.element);
      this.activeIndex = index;
    }

    flashElement(el) {
      if (!el) return;
      if (this.flashTimer) window.clearTimeout(this.flashTimer);
      el.classList.add("cghl-message-flash");
      this.flashTimer = window.setTimeout(() => el.classList.remove("cghl-message-flash"), 1050);
    }

    scrollContainerBy(delta) {
      const sc = this.scrollContainer || document.scrollingElement || document.documentElement;
      const isDoc = sc === document.scrollingElement || sc === document.documentElement;
      if (isDoc) {
        window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: "auto" });
      } else {
        sc.scrollTo({ top: Math.max(0, sc.scrollTop + delta), behavior: "auto" });
      }
    }

    triggerClick(button) {
      if (!button) return false;
      try { button.focus?.({ preventScroll: true }); } catch (_e) { /* ignore */ }
      try {
        const init = { bubbles: true, cancelable: true, composed: true, view: window };
        for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
          const evt = type.startsWith("pointer") && typeof PointerEvent === "function"
            ? new PointerEvent(type, { ...init, pointerId: 1, pointerType: "mouse", isPrimary: true, buttons: type === "pointerup" ? 0 : 1 })
            : new MouseEvent(type, init);
          button.dispatchEvent(evt);
        }
      } catch (_e) { /* fallthrough */ }
      try { button.click(); return true; } catch (_e) { return false; }
    }

    async waitDom(ms = 150) {
      await sleep(ms);
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    async waitForMsgReappear(testId, turnId, posIndex, timeoutMs = 2500) {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        await sleep(100);
        await new Promise(r => requestAnimationFrame(r));
        this.rebuild();
        const { msg } = this.findMsgRobust(turnId, testId, posIndex);
        if (msg) {
          this.log("waitReappear", `testId=${testId} reappeared after ${Date.now() - start}ms`);
          return msg;
        }
      }
      this.log("waitReappear", `TIMEOUT waiting for testId=${testId} to reappear (${timeoutMs}ms)`);
      return null;
    }

    /**
     * Wait for the version indicator at a given position to change.
     * Uses testId (data-testid) for lookup since turnId (data-message-id)
     * may change during version switches.
     */
    async waitForVersionChange(testId, turnId, expectedVersion, timeoutMs = 2500) {
      const start = Date.now();
      let missingLogged = false;
      while (Date.now() - start < timeoutMs) {
        await sleep(100);
        await new Promise(r => requestAnimationFrame(r));

        const entries = this.getUserTurnEntries();
        // Find by testId first (stable), then turnId
        const match = entries.find(e => e.testId === testId) || entries.find(e => e.turnId === turnId);
        if (!match && !missingLogged) {
          this.log("waitVersion", `testId=${testId} temporarily missing while waiting for v${expectedVersion}`);
          missingLogged = true;
        }
        if (match && match.replyVersion?.current === expectedVersion) {
          this.log("waitVersion", `v${expectedVersion} confirmed for testId=${testId} after ${Date.now() - start}ms`);
          return true;
        }
      }
      this.log("waitVersion", `TIMEOUT waiting for v${expectedVersion} on testId=${testId} (${timeoutMs}ms)`);
      return false;
    }

    /* ─── Path restoration ──────────────────────── */

    async ensureLive(node) {
      if (!node) return null;
      let msg = this.findMsgByTurnId(node.turnId) || this.findMsgByTestId(node.testId);
      if (msg) return msg;

      this.log("ensureLive", `Scrolling to find ${node.turnId} / ${node.testId}`);
      for (let attempt = 0; attempt < 6; attempt++) {
        const sc = this.scrollContainer || document.scrollingElement || document.documentElement;
        const isDoc = sc === document.scrollingElement || sc === document.documentElement;
        const vh = isDoc ? window.innerHeight : sc.clientHeight;
        this.scrollContainerBy(Math.floor(vh * 0.8));
        await sleep(200);
        this.rebuild();
        msg = this.findMsgByTurnId(node.turnId) || this.findMsgByTestId(node.testId);
        if (msg) {
          this.log("ensureLive", `Found after ${attempt + 1} scrolls`);
          return msg;
        }
      }
      this.log("ensureLive", `FAILED after 6 scrolls`);
      return null;
    }

    async restorePath(nodeKey) {
      const chain = this.getNodeChain(nodeKey);
      if (chain.length === 0) {
        this.log("restorePath", `Empty chain for ${nodeKey}`);
        return false;
      }

      this.log("restorePath", `Chain length=${chain.length}`, chain.map(n => ({
        key: n.nodeKey.slice(-30), turnId: n.turnId?.slice(0, 12), testId: n.testId, pv: n.parentSelectedVersion
      })));

      for (let i = 0; i < chain.length - 1; i++) {
        const ancestor = chain[i];
        const next = chain[i + 1];

        // Find the ancestor in the live DOM (try multiple methods)
        const { msg: liveMsg } = this.findMsgRobust(ancestor.turnId, ancestor.testId, ancestor.liveIndex);
        if (!liveMsg) {
          const scrolledMsg = await this.ensureLive(ancestor);
          if (!scrolledMsg) {
            this.log("restorePath", `FAILED: ancestor "${ancestor.turnId}" not found in DOM`);
            return false;
          }
        }

        // Re-find after possible scroll
        this.rebuild();
        const { msg: freshMsg } = this.findMsgRobust(ancestor.turnId, ancestor.testId, ancestor.liveIndex);
        if (!freshMsg) {
          this.log("restorePath", `FAILED: ancestor still not found after scroll`);
          return false;
        }

        // If the next node requires a specific parent version, switch to it
        if (
          next.parentSelectedVersion != null &&
          next.parentSelectedVersion !== 0
        ) {
          // Check if variants exist via DOM detection OR branchCache
          const cachedBranch = this.branchCache.get(freshMsg.turnId);
          const hasVariants = freshMsg.replyVersion?.hasVariants || (cachedBranch && cachedBranch.total > 1);

          if (!hasVariants) {
            this.log("restorePath", `WARN: next.pv=${next.parentSelectedVersion} but no variants detected for "${ancestor.turnId}" (dom=${freshMsg.replyVersion?.hasVariants}, cache.total=${cachedBranch?.total})`);
            // Still try the switch — the indicator might be hidden but buttons exist
          }

          const currentVersion = freshMsg.replyVersion?.current || cachedBranch?.current || 1;
          if (currentVersion !== next.parentSelectedVersion) {
            this.log("restorePath", `Switching ${ancestor.turnId} (testId=${ancestor.testId}) from v${currentVersion} to v${next.parentSelectedVersion}`);
            const ok = await this.goToVariant(ancestor.turnId, ancestor.testId, freshMsg.index, next.parentSelectedVersion);
            if (!ok) {
              this.log("restorePath", `FAILED: goToVariant returned false`);
              return false;
            }

            // Critical: rebuild after switch to get fresh DOM state
            await this.waitDom(250);
            this.rebuild();
          }
        }
      }

      this.log("restorePath", "OK");
      return true;
    }

    /**
     * Switch a turn's reply version by clicking prev/next buttons.
     * Uses testId (stable position) for tracking across button clicks,
     * since data-message-id can change during user-message branch switches.
     *
     * @param {string} turnId - data-message-id (may become stale after switch)
     * @param {string} testId - data-testid (stable position identifier)
     * @param {number} posIndex - position in messages array (fallback)
     * @param {number} target - target version number
     */
    async goToVariant(turnId, testId, posIndex, target) {
      this.log("goToVariant", `turnId=${turnId}, testId=${testId}, idx=${posIndex}, target=v${target}`);

      let currentTurnId = turnId;
      let safety = 20;
      let waitMs = 120;

      while (safety-- > 0) {
        this.rebuild();

        let { msg, newTurnId } = this.findMsgRobust(currentTurnId, testId, posIndex);
        if (!msg) {
          const reappeared = await this.waitForMsgReappear(testId, currentTurnId, posIndex, Math.max(waitMs * 10, 1200));
          if (!reappeared) {
            this.log("goToVariant", `msg NOT FOUND (tried turnId=${currentTurnId}, testId=${testId}, idx=${posIndex})`);
            return false;
          }
          this.rebuild();
          ({ msg, newTurnId } = this.findMsgRobust(currentTurnId, testId, posIndex));
          if (!msg) {
            this.log("goToVariant", `msg missing before step, waiting for reappear (turnId=${currentTurnId}, testId=${testId}, idx=${posIndex})`);
            return false;
          }
        }
        currentTurnId = newTurnId;

        const current = msg.replyVersion?.current;
        this.log("goToVariant", `v${current} → v${target}, hasVariants=${msg.replyVersion?.hasVariants}, total=${msg.replyVersion?.total}`);

        if (current === target) {
          this.log("goToVariant", "OK — on target");
          return true;
        }

        if (!msg.replyVersion?.hasVariants) {
          this.log("goToVariant", "FAILED — no variants detected");
          return false;
        }

        const dir = target > current ? 1 : -1;
        const btn = this.getReplyButton(msg, dir);
        if (!btn) {
          this.log("goToVariant", `FAILED — button not found for dir=${dir}`);
          return false;
        }

        if (btn.disabled) {
          this.log("goToVariant", "FAILED — button disabled");
          return false;
        }

        this.log("goToVariant", `Clicking (dir=${dir})...`);
        this.triggerClick(btn);

        const expectedV = current + dir;
        const changed = await this.waitForVersionChange(testId, currentTurnId, expectedV, Math.max(waitMs * 8, 1600));
        if (!changed) {
          this.log("goToVariant", `Version change not detected, fallback wait ${waitMs}ms`);
          await this.waitDom(waitMs);
          await this.waitForMsgReappear(testId, currentTurnId, posIndex, Math.max(waitMs * 10, 1200));
          waitMs = Math.min(waitMs * 1.5, 1000);
        } else {
          waitMs = 120;
        }
      }

      // Final check
      this.rebuild();
      const { msg: finalMsg } = this.findMsgRobust(currentTurnId, testId, posIndex);
      const finalResult = finalMsg?.replyVersion?.current === target;
      this.log("goToVariant", finalResult ? "OK (final)" : `FAILED (final: got v${finalMsg?.replyVersion?.current})`);
      return finalResult;
    }

    async jumpToNode(nodeKey) {
      if (this.switching) {
        this.log("jumpToNode", `BLOCKED — switching in progress`);
        return;
      }
      this.switching = true;

      try {
        const node = this.treeNodes.get(nodeKey);
        if (!node) {
          this.log("jumpToNode", `Node not found: ${nodeKey}`);
          return;
        }

        // Derive testId for old cached nodes that don't have it
        if (!node.testId && node.parentNodeKey) {
          const parent = this.treeNodes.get(node.parentNodeKey);
          if (parent?.testId) {
            const m = parent.testId.match(/conversation-turn-(\d+)/);
            if (m) {
              node.testId = `conversation-turn-${Number(m[1]) + 2}`;
              this.log("jumpToNode", `Derived testId=${node.testId} from parent ${parent.testId}`);
            }
          }
        }

        this.log("jumpToNode", `→ ${nodeKey.slice(-40)}`, {
          turnId: node.turnId?.slice(0, 12),
          testId: node.testId,
          onLive: this.livePathKeys.includes(nodeKey)
        });

        // If already on live path, just scroll
        if (this.livePathKeys.includes(nodeKey)) {
          const msg = this.messages.find(m => m.nodeKey === nodeKey);
          if (msg) {
            this.log("jumpToNode", "On live path → scroll");
            this.scrollToMsg(msg.index, true);
            this.setPanelOpen(false);
            return;
          }
          this.log("jumpToNode", "On live path but msg not found — will restore");
        }

        // Restore path to make target visible
        this.showStatus("正在还原路径…", true);
        const ok = await this.restorePath(nodeKey);
        if (!ok) {
          this.showStatus("路径还原失败", false);
          this.log("jumpToNode", "restorePath FAILED");
          return;
        }

        // Force clean rebuild after path restoration
        this.lastSignature = "";
        this.rebuild();

        // Find the target by turnId only — testId alone is NOT enough
        // (testId matches the position, but a different version may be showing)
        let msg = this.findMsgByTurnId(node.turnId);

        // If not found, the target might need version cycling at its own position.
        // restorePath only ensures ANCESTOR versions are correct.
        // The target's own position may show a different version.
        if (!msg && node.testId) {
          this.log("jumpToNode", `turnId not found, trying version cycling at ${node.testId}`);
          msg = await this.findByVersionCycling(node);
        }

        // Still not found — try scrolling to reveal it
        if (!msg) {
          this.log("jumpToNode", "Target not visible after restore, scrolling...");
          msg = await this.ensureLive(node);
        }

        if (msg) {
          this.log("jumpToNode", "OK — scrolling to target");
          this.scrollToMsg(msg.index, true);
          this.hideStatus();
          this.setPanelOpen(false);
        } else {
          this.log("jumpToNode", "Target not found, trying ancestors...");
          const chain = this.getNodeChain(nodeKey);
          for (let i = chain.length - 1; i >= 0; i--) {
            const anc = chain[i];
            const ancestor = this.findMsgByTurnId(anc.turnId) || this.findMsgByTestId(anc.testId);
            if (ancestor) {
              this.scrollToMsg(ancestor.index, true);
              this.showStatus("已还原到最近的祖先节点", false);
              return;
            }
          }
          this.showStatus("节点未找到", false);
        }
      } finally {
        this.switching = false;
        this.lastSignature = "";
        this.rebuild();
      }
    }

    /**
     * Cycle through versions at the target node's position to find its turnId.
     * This handles the case where restorePath ensures all ANCESTORS are on
     * the correct version, but the target's own position (e.g. turn-7)
     * has its own version selector showing the wrong version.
     */
    async findByVersionCycling(targetNode) {
      this.rebuild();
      const posMsg = this.findMsgByTestId(targetNode.testId);
      if (!posMsg) {
        this.log("versionCycle", `No message at position ${targetNode.testId}`);
        return null;
      }

      // If it already matches, return it
      if (posMsg.turnId === targetNode.turnId) return posMsg;

      // Check if this position has variants
      const cachedBranch = this.branchCache.get(posMsg.turnId);
      const total = Math.max(
        posMsg.replyVersion?.total || 1,
        cachedBranch?.total || 1
      );

      if (total <= 1) {
        this.log("versionCycle", `Position ${targetNode.testId} has no variants (total=${total})`);
        return null;
      }

      this.log("versionCycle", `Cycling ${total} versions at ${targetNode.testId} (current turnId=${posMsg.turnId.slice(0,12)}, want=${targetNode.turnId.slice(0,12)})`);

      const originalVersion = posMsg.replyVersion?.current || 1;

      for (let v = 1; v <= total; v++) {
        if (v === originalVersion) continue; // already checked this version

        const switched = await this.goToVariant(
          posMsg.turnId, targetNode.testId, posMsg.index, v
        );
        if (!switched) {
          this.log("versionCycle", `Could not switch to v${v}`);
          continue;
        }

        await this.waitDom(200);
        this.rebuild();

        const found = this.findMsgByTurnId(targetNode.turnId);
        if (found) {
          this.log("versionCycle", `FOUND at v${v}`);
          return found;
        }

        // turnId may have changed, update for next goToVariant call
        const currentPosMsg = this.findMsgByTestId(targetNode.testId);
        if (currentPosMsg) {
          posMsg.turnId = currentPosMsg.turnId;
        }
      }

      this.log("versionCycle", "NOT FOUND after cycling all versions");
      return null;
    }

    /* ─── Harvest (DFS branch exploration) ──────── */

    findSeedNode() {
      for (const key of this.livePathKeys) {
        const node = this.treeNodes.get(key);
        if (node && (node.replyVersionTotal || 1) > 1) return node;
      }
      return null;
    }

    updateHarvestBtn() {
      if (!this.harvestBtn) return;
      if (this.harvesting) {
        this.harvestBtn.textContent = "采集中…";
        this.harvestBtn.disabled = true;
        return;
      }

      let missing = 0;
      this.branchCache.forEach(b => {
        if ((b.total || 1) <= 1) return;
        missing += Math.max(0, (b.total || 1) - Object.keys(b.seenVersions || {}).length);
      });

      this.harvestBtn.disabled = this.messages.length === 0;
      this.harvestBtn.textContent = missing > 0 ? `采集 ${missing}` : "图谱已齐";
    }

    async harvestAll() {
      if (this.harvesting) return;
      if (this.messages.length === 0) {
        this.showStatus("无可采集内容", false);
        return;
      }

      this.harvesting = true;
      this.switching = true;
      this.updateHarvestBtn();
      this.showStatus("正在采集分支…", true);
      this.log("harvest", "Starting");

      try {
        const visited = new Set();
        await this.harvestSubtree(visited);
        this.showStatus("分支采集完成", false);
        this.log("harvest", `Done, ${visited.size} branches visited`);
      } finally {
        this.harvesting = false;
        this.switching = false;
        this.lastSignature = "";
        this.rebuild();
      }
    }

    async harvestSubtree(visited) {
      this.rebuild();
      const seed = this.findSeedNode();
      if (!seed) return;

      const total = Math.max(
        seed.replyVersionTotal || 1,
        this.branchCache.get(seed.turnId)?.total || 1
      );
      const original =
        seed.replyVersionCurrent || this.branchCache.get(seed.turnId)?.current || 1;

      this.log("harvest", `Exploring ${seed.turnId} (testId=${seed.testId}, ${total} versions, now v${original})`);

      for (let v = 1; v <= total; v++) {
        const branchKey = `${seed.nodeKey}::v${v}`;
        if (visited.has(branchKey)) continue;
        visited.add(branchKey);

        const msg = this.findMsgByTurnId(seed.turnId) || this.findMsgByTestId(seed.testId);
        const ok = await this.goToVariant(seed.turnId, seed.testId, msg?.index ?? -1, v);
        if (!ok) break;
        await this.waitDom(150);
        this.rebuild();
        await this.harvestSubtree(visited);
      }

      // Restore original version
      const currentMsg = this.findMsgByTurnId(seed.turnId) || this.findMsgByTestId(seed.testId);
      if (currentMsg && currentMsg.replyVersion?.current !== original) {
        await this.goToVariant(seed.turnId, seed.testId, currentMsg.index, original);
        await this.waitDom(150);
        this.rebuild();
      }
    }

    /* ─── Public ────────────────────────────────── */

    refreshNow() {
      this.rebuild();
    }
  }

  /* ═══════════════════════════════════════════════
     Boot
     ═══════════════════════════════════════════════ */

  installUrlHook();
  const controller = new Controller();
  window.__CGHL_CONTROLLER__ = controller;
  controller.init();
})();
