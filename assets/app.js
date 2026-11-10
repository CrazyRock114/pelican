/* Pelican 行车测试 · 对比导航站 —— 纯原生 JS,无外部依赖 */
(() => {
  "use strict";

  const DATA = window.PELICAN_DATA;
  if (!DATA || !Array.isArray(DATA.entries)) {
    document.body.insertAdjacentHTML("afterbegin",
      '<p style="padding:20px;color:#ff8a8a">⚠️ 未找到 assets/data.js —— 请先运行 <code>python3 tools/generate_data.py</code> 生成数据。</p>');
    return;
  }

  // ------------------------------------------------ 元信息表
  const MODEL_META = {
    "4carbon":   { color: "#5b9cf5", short: "4 Carbon" },
    "4argon":    { color: "#46c48e", short: "4 Argon" },
    "flashlite": { color: "#f2c14e", short: "Flash Lite" },
    "fable52":   { color: "#e2836a", short: "Fable 5.2" },
    "opus55":    { color: "#e05d6f", short: "Opus 5.5" },
  };
  const VENDOR_META = {
    google:    { label: "Google",    color: "#5b9cf5" },
    anthropic: { label: "Anthropic", color: "#e2836a" },
  };
  const HARNESS_META = {
    "claude-desktop": { icon: "🖥️", label: "Claude Desktop" },
    "antigravity":    { icon: "🛰️", label: "Antigravity" },
    "gemini-task":    { icon: "🧭", label: "Gemini Task 模式" },
    "gemini-chat":    { icon: "💬", label: "Gemini Chat 模式" },
  };
  const MODEL_ORDER = ["4carbon", "4argon", "flashlite", "fable52", "opus55"];
  const EFFORT_ORDER = { Medium: 0, High: 1, Extra: 2, Max: 3 };

  // ------------------------------------------------ 状态
  const state = {
    dim: "all", vendor: "all",
    models: new Set(), harnesses: new Set(),
    q: "", sort: "default",
  };
  const selection = new Map();   // id -> entry(保持勾选顺序)
  const previewOpen = new Set(); // 已展开内嵌预览的卡片 id

  const $ = (sel) => document.querySelector(sel);
  const grid = $("#grid");
  const entries = DATA.entries;
  const byId = new Map(entries.map(e => [e.id, e]));

  // ------------------------------------------------ 工具
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kb = (n) => n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
  const modelColor = (e) => MODEL_META[e.model].color;
  const cardLabel = (e) => e.modelLabel + (e.effort ? " · " + e.effort : "") + (e.attempt ? " · 第" + e.attempt + "次" : "");

  function badges(e, withDim = true) {
    let h = "";
    if (withDim) h += `<span class="badge dim-${e.dim}">${e.dim}</span>`;
    h += `<span class="badge model" style="--mc:${modelColor(e)}">${esc(e.modelLabel)}</span>`;
    if (e.effort) h += `<span class="badge effort">${esc(e.effort)}</span>`;
    if (e.attempt) h += `<span class="badge attempt">第${e.attempt}次</span>`;
    if (e.cdn) h += `<span class="badge cdn" title="引用外部 CDN(如 three.js),离线无法渲染">CDN</span>`;
    return h;
  }
  const harnessLine = (e) =>
    `<span class="hi">${HARNESS_META[e.harness].icon}</span>${esc(e.harnessLabel)}${e.vendor ? "" : ""}`;

  function mountIframe(container, entry) {
    const ifr = document.createElement("iframe");
    ifr.src = entry.path;
    ifr.loading = "lazy";
    ifr.allow = "fullscreen; autoplay";
    ifr.title = cardLabel(entry);
    container.appendChild(ifr);
  }

  // ------------------------------------------------ 头部统计
  (function renderStats() {
    const c = DATA.counts;
    const chip = (html) => `<span class="stat-chip">${html}</span>`;
    $("#statChips").innerHTML = [
      chip(`<b>${c.entries}</b> 幅作品 · <b>${c.folders}</b> 组测试`),
      chip(`2D <b>${c.dim2d}</b> · 3D <b>${c.dim3d}</b>`),
      ...Object.entries(MODEL_META).map(([k, m]) =>
        chip(`<span class="dot" style="background:${m.color}"></span>${esc(entries.find(e => e.model === k).modelLabel)} <b>${c.byModel[k]}</b>`)),
      ...Object.keys(HARNESS_META).map(h =>
        chip(`${HARNESS_META[h].icon} ${esc(HARNESS_META[h].label)} <b>${c.byHarness[h]}</b>`)),
    ].join("");
    $("#footMeta").textContent =
      `数据由 tools/generate_data.py 扫描 raw/ 生成(只读) · 生成时间 ${DATA.generatedAt} · 共 ${c.entries} 幅`;
  })();

  // ------------------------------------------------ 筛选条
  (function renderFilterChips() {
    $("#modelChips").innerHTML = MODEL_ORDER.map(k => {
      const m = MODEL_META[k];
      const label = entries.find(e => e.model === k).modelLabel;
      return `<button class="chip" data-group="models" data-v="${k}" style="--c:${m.color}"><span class="dot"></span>${esc(label)}</button>`;
    }).join("");
    $("#harnessChips").innerHTML = Object.entries(HARNESS_META).map(([k, h]) =>
      `<button class="chip" data-group="harnesses" data-v="${k}">${h.icon} ${esc(h.label)}</button>`).join("");
  })();

  function bindSeg(id, key) {
    $(id).addEventListener("click", (ev) => {
      const btn = ev.target.closest("button[data-v]");
      if (!btn) return;
      state[key] = btn.dataset.v;
      $(id).querySelectorAll("button").forEach(b => b.classList.toggle("on", b === btn));
      render();
    });
  }
  bindSeg("#segDim", "dim");
  bindSeg("#segVendor", "vendor");

  document.querySelectorAll(".chiprow").forEach(row => {
    row.addEventListener("click", (ev) => {
      const btn = ev.target.closest("button.chip");
      if (!btn) return;
      const set = state[btn.dataset.group];
      const v = btn.dataset.v;
      set.has(v) ? set.delete(v) : set.add(v);
      btn.classList.toggle("on", set.has(v));
      render();
    });
  });

  $("#q").addEventListener("input", (ev) => { state.q = ev.target.value.trim().toLowerCase(); render(); });
  $("#sort").addEventListener("change", (ev) => { state.sort = ev.target.value; render(); });
  $("#reset").addEventListener("click", () => resetFilters());
  $("#previewAll").addEventListener("click", () => {
    const list = filtered();
    if (!list.length) return;
    if (!confirm(`将为当前 ${list.length} 幅作品全部加载实时预览(含 3D/WebGL,较吃内存),继续?`)) return;
    list.forEach(e => previewOpen.add(e.id));
    render();
  });

  window.resetFilters = function () {
    state.dim = "all"; state.vendor = "all";
    state.models.clear(); state.harnesses.clear();
    state.q = ""; state.sort = "default";
    $("#q").value = ""; $("#sort").value = "default";
    document.querySelectorAll("#segDim button").forEach(b => b.classList.toggle("on", b.dataset.v === "all"));
    document.querySelectorAll("#segVendor button").forEach(b => b.classList.toggle("on", b.dataset.v === "all"));
    document.querySelectorAll(".chiprow .chip").forEach(b => b.classList.remove("on"));
    render();
  };

  // ------------------------------------------------ 过滤与排序
  function filtered() {
    let list = entries.filter(e => {
      if (state.dim !== "all" && e.dim !== state.dim) return false;
      if (state.vendor !== "all" && e.vendor !== state.vendor) return false;
      if (state.models.size && !state.models.has(e.model)) return false;
      if (state.harnesses.size && !state.harnesses.has(e.harness)) return false;
      if (state.q) {
        const hay = (e.folder + " " + e.file + " " + e.title + " " + e.modelLabel + " " + e.harnessLabel).toLowerCase();
        if (!hay.includes(state.q)) return false;
      }
      return true;
    });
    const cmp = {
      default: (a, b) => (a.dim < b.dim ? -1 : a.dim > b.dim ? 1 : 0)
        || MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model)
        || (EFFORT_ORDER[a.effort] ?? -1) - (EFFORT_ORDER[b.effort] ?? -1)
        || (a.attempt || 0) - (b.attempt || 0),
      mtime: (a, b) => b.mtimeTs - a.mtimeTs,
      size: (a, b) => b.size - a.size,
    }[state.sort];
    return list.sort(cmp);
  }

  // ------------------------------------------------ 卡片渲染
  function cardHTML(e) {
    const selected = selection.has(e.id);
    const open = previewOpen.has(e.id);
    return `
    <article class="card ${selected ? "selected" : ""}" data-id="${e.id}">
      <span class="pick">✓</span>
      <div class="badges">${badges(e)}</div>
      <h3 class="card-title">${esc(cardLabel(e))}<br><span class="wt">${esc(e.title || e.file)}</span></h3>
      <div class="harness-line">${harnessLine(e)}</div>
      <div class="preview" data-role="preview">
        ${open ? "" : `<div class="ph"><span class="big">${e.dim === "3D" ? "🧊" : "🖼️"}</span><span class="hint">点击「预览」加载实时画面${e.cdn ? " · 需联网" : ""}</span></div>`}
      </div>
      <div class="card-meta">
        <span class="path" title="${esc(e.folder + " / " + e.file)}">${esc(e.folder + " / " + e.file)}${e.typo ? "  (原始拼写)" : ""}</span>
        <span class="sz">${kb(e.size)} · ${e.mtime}</span>
      </div>
      <div class="card-actions">
        <button data-action="preview" class="${open ? "on" : ""}">${open ? "收起预览" : "▶ 预览"}</button>
        <button data-action="select" class="sel ${selected ? "on" : ""}">${selected ? "✓ 已选对比" : "＋ 加入对比"}</button>
        <button data-action="open">↗ 新窗口</button>
      </div>
    </article>`;
  }

  function render() {
    const list = filtered();
    const showDim = state.dim === "all";
    const sections = showDim ? ["2D", "3D"] : [state.dim];

    grid.innerHTML = sections.map(dim => {
      const sub = list.filter(e => e.dim === dim);
      if (!sub.length && !showDim) return "";
      return `
      <div class="section-head">
        <h2>${dim} 赛道</h2>
        <span class="tag t${dim}">${dim}</span>
        <span class="n">${sub.length} 幅作品</span>
      </div>
      <div class="grid">${sub.map(cardHTML).join("")}</div>`;
    }).join("");

    // 已展开预览的卡片挂 iframe
    list.filter(e => previewOpen.has(e.id)).forEach(e => {
      const holder = grid.querySelector(`.card[data-id="${CSS.escape(e.id)}"] [data-role="preview"]`);
      if (holder && !holder.querySelector("iframe")) mountIframe(holder, e);
    });

    $("#count").textContent = `${list.length} / ${entries.length} 幅`;
    $("#empty").hidden = list.length > 0;
    renderTray();
  }

  // ------------------------------------------------ 卡片事件(委托)
  grid.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest(".card");
    const e = byId.get(card.dataset.id);
    if (!e) return;
    const action = btn.dataset.action;

    if (action === "preview") {
      previewOpen.has(e.id) ? previewOpen.delete(e.id) : previewOpen.add(e.id);
      render();
      if (previewOpen.has(e.id)) {
        const el = grid.querySelector(`.card[data-id="${CSS.escape(e.id)}"]`);
        el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    } else if (action === "select") {
      selection.has(e.id) ? selection.delete(e.id) : selection.set(e.id, e);
      render();
    } else if (action === "open") {
      window.open(e.path, "_blank");
    }
  });

  // ------------------------------------------------ 对比托盘
  const tray = $("#tray");
  function renderTray() {
    tray.hidden = selection.size === 0;
    $("#trayText").textContent = `已选 ${selection.size} 幅`;
    $("#trayGo").disabled = selection.size < 2;
    $("#trayGo").textContent = selection.size < 2 ? "至少选 2 幅" : `开始对比 (${selection.size})`;
  }
  $("#trayClear").addEventListener("click", () => { selection.clear(); render(); });
  $("#trayGo").addEventListener("click", openCompare);

  // ------------------------------------------------ 对比视图
  const compareView = $("#compareView");
  function openCompare() {
    const list = [...selection.values()];
    if (list.length < 2) return;
    const cols = list.length <= 3 ? list.length : list.length === 4 ? 2 : 3;
    $("#compareTitle").textContent = `对比 ${list.length} 幅 · ${list.map(e => e.dim).filter((v, i, a) => a.indexOf(v) === i).join(" / ")}`;
    const g = $("#compareGrid");
    g.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    g.innerHTML = list.map(e => `
      <section class="pane">
        <div class="pane-head">${badges(e)}<span class="link"><a href="${e.path}" target="_blank">↗ 新窗口打开</a></span></div>
      </section>`).join("");
    [...g.querySelectorAll(".pane")].forEach((pane, i) => mountIframe(pane, list[i]));
    compareView.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function closeCompare() {
    compareView.hidden = true;
    $("#compareGrid").innerHTML = "";
    document.body.style.overflow = "";
  }
  $("#compareBack").addEventListener("click", closeCompare);
  $("#compareClose").addEventListener("click", closeCompare);

  // ------------------------------------------------ 详情视图
  const detailView = $("#detailView");
  let detailIdx = -1, detailList = [];
  function openDetail(e) {
    detailList = filtered();
    detailIdx = detailList.findIndex(x => x.id === e.id);
    if (detailIdx < 0) { detailList = entries; detailIdx = detailList.findIndex(x => x.id === e.id); }
    renderDetail();
    detailView.hidden = false;
    document.body.style.overflow = "hidden";
  }
  function renderDetail() {
    const e = detailList[detailIdx];
    if (!e) return closeDetail();
    $("#detailTitle").innerHTML = `${detailIdx + 1} / ${detailList.length} · ${badges(e)}`;
    $("#detailTitle").style.cssText = "margin-right:auto;display:flex;align-items:center;gap:6px;flex-wrap:wrap";
    const stage = $("#detailStage");
    stage.innerHTML = "";
    mountIframe(stage, e);
    $("#detailMeta").innerHTML = `
      <span class="path">${esc(e.folder + " / " + e.file)}${e.typo ? "  (原始拼写)" : ""}</span>
      <span>${esc(e.harnessLabel)}</span><span>${esc(e.modelLabel)}${e.effort ? " · " + esc(e.effort) : ""}</span>
      <span>${kb(e.size)}</span><span>${e.mtime}</span>
      <span>${esc(e.title)}</span>`;
  }
  function closeDetail() {
    detailView.hidden = true;
    $("#detailStage").innerHTML = "";
    document.body.style.overflow = "";
  }
  const step = (d) => { detailIdx = (detailIdx + d + detailList.length) % detailList.length; renderDetail(); };
  $("#detailPrev").addEventListener("click", () => step(-1));
  $("#detailNext").addEventListener("click", () => step(1));
  $("#detailOpen").addEventListener("click", () => { const e = detailList[detailIdx]; if (e) window.open(e.path, "_blank"); });
  $("#detailClose").addEventListener("click", closeDetail);

  // 点击卡片标题/预览区 → 详情
  grid.addEventListener("click", (ev) => {
    if (ev.target.closest("button") || ev.target.closest("iframe")) return;
    const card = ev.target.closest(".card");
    if (!card) return;
    const e = byId.get(card.dataset.id);
    if (e) openDetail(e);
  });

  // ------------------------------------------------ 键盘
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (!detailView.hidden) return closeDetail();
      if (!compareView.hidden) return closeCompare();
    }
    if (!detailView.hidden) {
      if (ev.key === "ArrowLeft") step(-1);
      if (ev.key === "ArrowRight") step(1);
    }
  });

  render();
})();
