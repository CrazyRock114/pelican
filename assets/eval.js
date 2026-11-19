/* 盲测评测引擎 —— eval.html 专用
   本页只加载 eval-data.js(匿名码),绝不加载 eval-map.js / data.js。
   生产环境作品 iframe 走 /w/<code> 服务端重写;本地开发回退 eval-map.js 并显示明文警告。 */
(() => {
  "use strict";

  const DATA = window.PELICAN_EVAL_DATA;
  if (!DATA || !Array.isArray(DATA.rounds)) {
    document.body.insertAdjacentHTML("afterbegin",
      '<p style="padding:20px;color:#ff8a8a">⚠️ 未找到 assets/eval-data.js —— 请先运行 <code>python3 tools/generate_eval.py</code>。</p>');
    return;
  }

  const $ = (s) => document.querySelector(s);
  const LS_KEY = "pelican_eval_session_v1";
  const isProd = /\.vercel\.app$|^[^/]*pelican/i.test(location.hostname) && !/^(localhost|127\.)/.test(location.hostname);
  const dims = DATA.dims;
  const scale = DATA.scale || { min: 1, max: 5 };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    "s-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));
  const nowISO = () => new Date().toISOString();

  // ------------------------------------------------ 会话状态
  let session = null;   // {sessionId, roundId, evaluator:{name,type}, startedAt, order:[code], scores:{code:{dims,comment,ts}}}
  let curIdx = 0;
  let activeDimKey = dims[0].key;

  const roundWorks = (rid) => (DATA.rounds.find(r => r.id === rid) || DATA.rounds[0]).works;
  const workByCode = {};   // code -> {code, dim, attempt}(当前场次)
  let works = [];

  function seededShuffle(arr, seedStr) {
    let h = 2166136261;
    for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
    const rand = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function saveSession() {
    if (!session) return;
    try { localStorage.setItem(LS_KEY, JSON.stringify(session)); } catch {}
    $("#autoSaveHint").textContent = `已自动保存到本机 · 已评 ${Object.keys(session.scores).length}/${session.order.length}`;
  }
  function loadSession() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "null"); } catch { return null; }
  }
  function clearSession() { try { localStorage.removeItem(LS_KEY); } catch {} }

  // ------------------------------------------------ ① 准备
  function renderSetup() {
    const saved = loadSession();
    $("#roundList").innerHTML = DATA.rounds.map(r => `
      <label class="round-opt" data-id="${esc(r.id)}">
        <input type="radio" name="round" value="${esc(r.id)}" ${saved && saved.roundId === r.id ? "checked" : ""} style="accent-color:#5b9cf5">
        <span><b>${esc(r.title)}</b> · ${r.works.length} 幅匿名作品</span>
      </label>`).join("");
    $("#roundList").addEventListener("click", (ev) => {
      const opt = ev.target.closest(".round-opt");
      if (!opt) return;
      opt.querySelector("input").checked = true;
      $("#roundList").querySelectorAll(".round-opt").forEach(o => o.classList.toggle("on", o === opt));
    });
    const firstOpt = $("#roundList").querySelector(".round-opt");
    $("#roundList").querySelectorAll(".round-opt").forEach(o => o.classList.toggle("on", o === (saved && saved.roundId === o.dataset.id ? o : firstOpt)));

    if (saved) {
      $("#evalName").value = saved.evaluator?.name || "";
      $("#evalType").value = saved.evaluator?.type || "human";
      $("#startBtn").textContent = `继续未完成的盲测(${Object.keys(saved.scores).length}/${saved.order?.length || "?"})→`;
    }
    $("#dimNames").textContent = dims.map(d => d.label).join(" / ");
    $("#evalMeta").textContent = `评测池 ${DATA.generatedAt} 生成 · ${DATA.rounds.map(r => r.title + " " + r.works.length).join(" · ")}`;
  }

  $("#startBtn").addEventListener("click", () => {
    const rid = $("#roundList input:checked")?.value || DATA.rounds[0].id;
    const name = $("#evalName").value.trim() || "匿名评审";
    const type = $("#evalType").value;
    const saved = loadSession();

    if (saved && saved.roundId === rid && saved.order?.length === roundWorks(rid).length) {
      session = saved;   // 续评
      if (!session.evaluator) session.evaluator = { name, type };
    } else {
      works = roundWorks(rid);
      works.forEach(w => workByCode[w.code] = w);
      session = {
        schema: 1,
        sessionId: uuid(),
        roundId: rid,
        evaluator: { name, type },
        startedAt: nowISO(),
        userAgent: navigator.userAgent.slice(0, 200),
        blind: true,
        order: seededShuffle(works.map(w => w.code), name + type + Date.now()),
        scores: {},
      };
      curIdx = 0;
    }
    works = roundWorks(rid);
    works.forEach(w => workByCode[w.code] = w);
    saveSession();
    $("#setupPanel").hidden = true;
    $("#scorePanel").hidden = false;
    $("#roundBadge").textContent = "场次:" + (DATA.rounds.find(r => r.id === rid)?.title || rid);
    // 跳到第一个未完成的
    const firstUn = session.order.findIndex(c => !session.scores[c]);
    curIdx = firstUn < 0 ? 0 : firstUn;
    renderScore();
  });

  // ------------------------------------------------ ② 打分
  function mountFrame(code) {
    const holder = $("#sampleFrame");
    holder.innerHTML = "";
    const ifr = document.createElement("iframe");
    ifr.src = isProd ? `/w/${code}` : devPath(code);
    ifr.allow = "fullscreen; autoplay";
    ifr.title = "匿名样本 " + code;
    holder.appendChild(ifr);
    if (!isProd) {
      holder.parentElement.querySelectorAll(".dev-warn").forEach(n => n.remove());
      holder.insertAdjacentHTML("afterend",
        '<p class="hint-line dev-warn">⚠️ 本地开发模式:作品路径可见(仅站长本机)。正式盲测请使用线上站。</p>');
    }
  }
  function devPath(code) {
    // 本地回退:动态加载 eval-map.js(生产环境绝不加载)
    if (!window.PELICAN_EVAL_MAP) {
      const s = document.createElement("script");
      s.src = "assets/eval-map.js";
      s.onload = () => renderScore();   // 地图就位后重渲染(仅本地开发会发生)
      s.onerror = () => { $("#sampleFrame").innerHTML = '<p style="padding:20px">本地缺少 eval-map.js,请先跑 generate_eval.py</p>'; };
      document.head.appendChild(s);
      return "about:blank";
    }
    return window.PELICAN_EVAL_MAP.works.find(w => w.code === code)?.path || "about:blank";
  }

  function renderScore() {
    const code = session.order[curIdx];
    const sc = session.scores[code] || { dims: {}, comment: "" };
    $("#sampleIdx").textContent = `#${String(curIdx + 1).padStart(2, "0")} / ${session.order.length}`;
    $("#sampleCode").textContent = code;
    mountFrame(code);

    $("#dimList").innerHTML = dims.map(d => `
      <div class="dim-row ${d.key === activeDimKey ? "active" : ""}" data-dim="${d.key}">
        <div class="dim-head"><span class="dlabel">${esc(d.label)}</span><span class="dhint">${esc(d.hint)}</span></div>
        <div class="dim-scale">
          ${Array.from({ length: scale.max - scale.min + 1 }, (_, i) => scale.min + i).map(v =>
            `<button data-v="${v}" class="${sc.dims[d.key] === v ? "on" : ""}" aria-label="${esc(d.label)} ${v} 分">${v}</button>`).join("")}
          <span class="dstate">${sc.dims[d.key] ? "已评 " + sc.dims[d.key] + " 分" : "未评"}</span>
        </div>
      </div>`).join("");
    $("#commentBox").value = sc.comment || "";

    const done = Object.keys(session.scores).length;
    $("#progressBar").style.width = (done / session.order.length * 100) + "%";
    $("#progressText").textContent = `${done} / ${session.order.length} 已评`;
    $("#finishBtn").disabled = done < session.order.length;
    $("#finishBtn").textContent = done < session.order.length
      ? `还剩 ${session.order.length - done} 幅未评` : "完成,去提交 →";
    saveSession();
  }

  function setScore(dimKey, v) {
    const code = session.order[curIdx];
    const sc = session.scores[code] || (session.scores[code] = { dims: {}, comment: "" });
    sc.dims[dimKey] = v;
    sc.ts = Date.now();
    activeDimKey = dimKey;
    // 自动跳到下一个未评维度
    const nextDim = dims.find(d => !session.scores[code].dims[d.key]);
    if (nextDim) activeDimKey = nextDim.key;
    renderScore();
  }

  $("#dimList").addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-v]");
    if (!btn) return;
    const row = btn.closest(".dim-row");
    setScore(row.dataset.dim, parseInt(btn.dataset.v, 10));
  });
  $("#dimList").addEventListener("click", (ev) => {
    const row = ev.target.closest(".dim-row");
    if (row && !ev.target.closest("button")) activeDimKey = row.dataset.dim;
  }, true); // 捕获阶段处理行选择

  $("#commentBox").addEventListener("input", (ev) => {
    const code = session.order[curIdx];
    const sc = session.scores[code] || (session.scores[code] = { dims: {}, comment: "" });
    sc.comment = ev.target.value;
    saveSession();
  });

  const goto = (i) => { curIdx = (i + session.order.length) % session.order.length; renderScore(); };
  $("#prevBtn").addEventListener("click", () => goto(curIdx - 1));
  $("#nextBtn").addEventListener("click", () => goto(curIdx + 1));
  $("#quitBtn").addEventListener("click", () => {
    saveSession();
    $("#scorePanel").hidden = true;
    $("#setupPanel").hidden = false;
    renderSetup();
  });

  document.addEventListener("keydown", (ev) => {
    if ($("#scorePanel").hidden) return;
    if (ev.target.tagName === "TEXTAREA" || ev.target.tagName === "INPUT") return;
    if (ev.key === "ArrowLeft") goto(curIdx - 1);
    else if (ev.key === "ArrowRight") goto(curIdx + 1);
    else if (/^[1-5]$/.test(ev.key)) setScore(activeDimKey, parseInt(ev.key, 10));
    else if (ev.key === "Tab") {
      ev.preventDefault();
      const i = dims.findIndex(d => d.key === activeDimKey);
      activeDimKey = dims[(i + (ev.shiftKey ? dims.length - 1 : 1)) % dims.length].key;
      renderScore();
    }
  });

  // ------------------------------------------------ ③ 提交
  $("#finishBtn").addEventListener("click", renderReview);

  function renderReview() {
    $("#scorePanel").hidden = true;
    $("#reviewPanel").hidden = false;
    const rows = session.order.map(code => {
      const sc = session.scores[code] || { dims: {}, comment: "" };
      return `<tr><td><code>#${code}</code></td>` +
        dims.map(d => `<td class="num">${sc.dims[d.key] ?? "–"}</td>`).join("") +
        `<td>${esc((sc.comment || "").slice(0, 40))}${(sc.comment || "").length > 40 ? "…" : ""}</td>` +
        `<td class="num"><button class="ghost" data-goto="${code}" style="padding:2px 10px">改</button></td></tr>`;
    }).join("");
    $("#reviewTable").innerHTML =
      `<thead><tr><th>样本码</th>${dims.map(d => `<th>${esc(d.label)}</th>`).join("")}<th>备注</th><th></th></tr></thead><tbody>${rows}</tbody>`;
    $("#reviewSummary").textContent =
      `${session.evaluator.name}(${session.evaluator.type}) · 场次「${DATA.rounds.find(r => r.id === session.roundId)?.title}」· ${session.order.length} 幅全部完成`;
  }
  $("#reviewTable").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-goto]");
    if (!b) return;
    curIdx = session.order.indexOf(b.dataset.goto);
    $("#reviewPanel").hidden = true;
    $("#scorePanel").hidden = false;
    renderScore();
  });
  $("#backBtn").addEventListener("click", () => {
    $("#reviewPanel").hidden = true;
    $("#scorePanel").hidden = false;
    renderScore();
  });

  function buildPayload() {
    return {
      schema: 1,
      sessionId: session.sessionId,
      roundId: session.roundId,
      evaluator: session.evaluator,
      startedAt: session.startedAt,
      submittedAt: nowISO(),
      userAgent: session.userAgent,
      blind: true,
      scores: session.order.map(code => ({
        code,
        dims: session.scores[code]?.dims || {},
        comment: session.scores[code]?.comment || "",
      })),
    };
  }

  async function postToAPI(payload) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch("/api/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) throw new Error("HTTP " + res.status + " " + (await res.text()).slice(0, 120));
      return await res.json();
    } catch (e) {
      clearTimeout(t);
      throw e;
    }
  }

  function exportJSON(payload) {
    const txt = JSON.stringify(payload, null, 2);
    try { navigator.clipboard?.writeText(txt); } catch {}
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([txt], { type: "application/json" }));
    a.download = `pelican-eval-${session.roundId}-${session.evaluator.name.replace(/[^\w\u4e00-\u9fa5-]+/g, "_")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return txt;
  }

  $("#exportBtn").addEventListener("click", () => {
    const txt = exportJSON(buildPayload());
    showResult("warn", `📄 已导出 JSON 并尝试复制到剪贴板。请把它发到群里/发给站长,或对公开仓库提 PR 放入 <code>submissions/</code> 目录。<br><textarea readonly style="width:100%;height:120px;margin-top:8px">${esc(txt.slice(0, 4000))}</textarea>`);
  });

  $("#submitBtn").addEventListener("click", async () => {
    const payload = buildPayload();
    $("#submitBtn").disabled = true;
    $("#submitBtn").textContent = "提交中…";
    try {
      const out = await postToAPI(payload);
      showResult("ok", `✅ 提交成功!会话 ID <code>${esc(out.sessionId || payload.sessionId)}</code> 已进入排行榜数据源。<br>→ <a href="results.html" style="color:#8ee6b8">查看排行榜(含身份揭晓)</a> · 本机进度已清空。`);
      clearSession();
      session = null;
    } catch (e) {
      const txt = exportJSON(payload);
      showResult("warn", `⚠️ API 提交失败(${esc(String(e.message || e))})。<br>已自动导出 JSON(并尝试复制剪贴板)——请发给站长或提 PR 放入 <code>submissions/</code>。<br><textarea readonly style="width:100%;height:120px;margin-top:8px">${esc(txt.slice(0, 4000))}</textarea>`);
    } finally {
      $("#submitBtn").disabled = false;
      $("#submitBtn").textContent = "✓ 提交评分";
    }
  });

  function showResult(kind, html) {
    const box = $("#submitResult");
    box.hidden = false;
    box.className = "submit-result " + kind;
    box.innerHTML = html;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ------------------------------------------------ 🤖 console API
  window.PELICAN_EVAL = {
    status() {
      if (!session) return { state: "未开始", hint: "PE.start(roundId?, name?, type?) 或用页面表单开始" };
      const scored = Object.keys(session.scores).length;
      return { sessionId: session.sessionId, round: session.roundId, evaluator: session.evaluator,
        total: session.order.length, scored, current: session.order[curIdx], currentIndex: curIdx };
    },
    async start(roundId, name, type) {
      $("#evalName").value = name || "Agent";
      $("#evalType").value = type || "agent";
      const opt = [...$("#roundList").querySelectorAll(".round-opt")].find(o => o.dataset.id === (roundId || DATA.rounds[0].id));
      opt?.click();
      $("#startBtn").click();
      return this.status();
    },
    list() { return session ? session.order.filter(c => !session.scores[c]) : []; },
    current() { return session ? session.order[curIdx] : null; },
    goto(i) {
      if (!session) return "未开始";
      curIdx = typeof i === "number" ? Math.max(0, Math.min(session.order.length - 1, i))
        : Math.max(0, session.order.indexOf(i));
      renderScore();
      return this.current();
    },
    next() { if (session) goto(curIdx + 1); return this.current(); },
    prev() { if (session) goto(curIdx - 1); return this.current(); },
    score(code, dimScores, comment) {
      if (!session) return "未开始";
      const c = code || session.order[curIdx];
      const sc = session.scores[c] || (session.scores[c] = { dims: {}, comment: "" });
      for (const [k, v] of Object.entries(dimScores || {})) {
        if (!dims.some(d => d.key === k)) return `未知维度: ${k}(可用: ${dims.map(d => d.key).join(", ")})`;
        if (!Number.isInteger(v) || v < scale.min || v > scale.max) return `维度 ${k} 分数须为 ${scale.min}-${scale.max} 整数`;
        sc.dims[k] = v;
      }
      if (typeof comment === "string") sc.comment = comment.slice(0, 500);
      sc.ts = Date.now();
      saveSession();
      if (curIdx < session.order.length - 1 && session.order[curIdx] === c) goto(curIdx + 1);
      return this.status();
    },
    exportJSON: () => session ? buildPayload() : "未开始",
    async submit(note) {
      if (!session) return "未开始";
      if (typeof note === "string" && note) session.evaluator.note = note.slice(0, 300);
      const payload = buildPayload();
      try {
        const out = await postToAPI(payload);
        clearSession();
        session = null;
        return { ok: true, ...out };
      } catch (e) {
        return { ok: false, error: String(e.message || e), payload };
      }
    },
    clear() { clearSession(); session = null; location.reload(); return "已清空本机进度"; },
  };

  // ------------------------------------------------ 启动
  renderSetup();
})();
