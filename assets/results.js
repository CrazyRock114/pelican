/* 盲测排行榜 —— 汇总 + 身份揭晓
   数据源优先级:① /api/submissions(Blob 实时) ② results/leaderboard.json(仓库快照) */
(() => {
  "use strict";

  const MAP = window.PELICAN_EVAL_MAP;      // code → 身份
  const NAV = window.PELICAN_DATA;          // 模型元数据(色卡)
  const root = document.querySelector("#resultsRoot");
  const badge = document.querySelector("#sourceBadge");

  if (!MAP || !NAV) {
    root.innerHTML = '<section class="panel"><p style="color:#ff8a8a">⚠️ 缺少 assets/eval-map.js 或 assets/data.js —— 请先运行生成脚本。</p></section>';
    return;
  }

  const byCode = new Map(MAP.works.map(w => [w.code, w]));
  const MODEL_COLOR = {
    "4carbon": "#5b9cf5", "4argon": "#46c48e", "flashlite": "#f2c14e",
    "fable52": "#e2836a", "opus55": "#e05d6f",
  };
  const DIM_KEYS = ["faithfulness", "visual", "animation", "craft", "overall"];
  const DIM_LABELS = { faithfulness: "还原度", visual: "视觉", animation: "动画交互", craft: "技术", overall: "整体" };
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (x) => (x == null ? "–" : (Math.round(x * 100) / 100).toFixed(2));

  async function fetchSubmissions() {
    try {
      const res = await fetch("/api/submissions", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!Array.isArray(data.submissions)) throw new Error("格式不符");
      return { sessions: data.submissions, source: "live" };
    } catch {
      try {
        const res = await fetch("results/leaderboard.json?v=" + Date.now(), { cache: "no-store" });
        if (!res.ok) throw new Error();
        const data = await res.json();
        return { sessions: data.rawSessions || [], source: "snapshot", snapshot: data };
      } catch {
        return { sessions: [], source: "none" };
      }
    }
  }

  // 聚合:每作品 / 每模型 / 每Harness / 评分人
  function aggregate(sessions) {
    const perWork = new Map();      // code → {n, dims:{k:sum}, sessions:Set}
    const evalStats = new Map();    // sessionId → {name,type,n}
    let scoreCount = 0;

    for (const sess of sessions) {
      if (!sess || !Array.isArray(sess.scores)) continue;
      const evKey = sess.sessionId || Math.random().toString(36).slice(2);
      let evWorks = 0;
      for (const s of sess.scores) {
        if (!byCode.has(s.code) || !s.dims) continue;
        evWorks++; scoreCount++;
        const agg = perWork.get(s.code) || { n: 0, dims: {}, sessions: new Set() };
        agg.n++; agg.sessions.add(sess.sessionId);
        for (const k of DIM_KEYS) {
          if (Number.isInteger(s.dims[k])) agg.dims[k] = (agg.dims[k] || 0) + s.dims[k];
        }
        perWork.set(s.code, agg);
      }
      const st = evalStats.get(evKey) || { name: sess.evaluator?.name || "匿名", type: sess.evaluator?.type || "human", n: 0 };
      st.n += evWorks;
      evalStats.set(evKey, st);
    }

    const works = [...perWork.entries()].map(([code, agg]) => {
      const w = byCode.get(code);
      const dims = {};
      for (const k of DIM_KEYS) dims[k] = agg.dims[k] != null ? agg.dims[k] / agg.n : null;
      const overall = dims.overall ?? null;
      return { code, ...w, n: agg.n, dimMeans: dims, overall, sessions: agg.sessions.size };
    });

    const groupBy = (field) => {
      const m = new Map();
      for (const w of works) {
        const g = m.get(w[field]) || { n: 0, dims: {}, worksCount: new Set() };
        g.n += w.n;
        g.worksCount.add(w.code);
        for (const k of DIM_KEYS) if (w.dimMeans[k] != null) g.dims[k] = (g.dims[k] || 0) + w.dimMeans[k] * w.n;
        m.set(w[field], g);
      }
      return [...m.entries()].map(([key, g]) => {
        const dims = {};
        for (const k of DIM_KEYS) dims[k] = g.dims[k] != null ? g.dims[k] / g.n : null;
        return { key, n: g.n, worksCount: g.worksCount.size, dimMeans: dims, overall: dims.overall };
      }).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
    };

    return {
      sessions, works: works.sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1)),
      models: groupBy("model"), harnesses: groupBy("harness"),
      evaluators: [...evalStats.values()].sort((a, b) => b.n - a.n),
      scoreCount,
    };
  }

  function dimBars(dimMeans) {
    return `<div class="dim-bars">` + DIM_KEYS.filter(k => k !== "overall").map(k => `
      <div class="dim-bar"><span class="lbl"><span>${DIM_LABELS[k]}</span><span>${fmt(dimMeans[k])}</span></span>
      <div class="track"><div class="fill" style="width:${((dimMeans[k] ?? 0) / 5 * 100).toFixed(0)}%"></div></div></div>`).join("") + `</div>`;
  }

  function render(agg, source) {
    const hasData = agg.sessions.length > 0;
    badge.innerHTML = source === "live"
      ? '<span style="color:#8ee6b8">● API 实时(Vercel Blob)</span>'
      : source === "snapshot" ? '<span style="color:#f2c14e">◈ 仓库快照(leaderboard.json)</span>'
      : '<span style="color:#ff8a8a">暂无数据源</span>';

    if (!hasData) {
      root.innerHTML = `
      <section class="panel"><div class="empty-state">
        <div class="big">🪶</div>
        <p>还没有任何评分记录 —— 匿名池已经就绪,就差你了。</p>
        <a href="eval.html"><button class="primary big">去盲测打分 →</button></a>
      </div></section>`;
      document.querySelector("#resultsMeta").textContent = "评分数据将通过 /api/submissions 或 submissions/ 快照出现";
      return;
    }

    const lastAt = agg.sessions.map(s => s.submittedAt || "").sort().at(-1) || "";
    const modelRows = agg.models.map((m, i) => {
      const meta = NAV.entries.find(e => e.model === m.key);
      const label = meta ? meta.modelLabel : m.key;
      const color = MODEL_COLOR[m.key] || "#888";
      return `
      <div class="model-row">
        <span class="rank">${i + 1}</span>
        <div class="mmain">
          <div class="mname"><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${color}"></span>
            ${esc(label)} <span class="n">${m.worksCount} 幅 · ${m.n} 次评分</span></div>
          ${dimBars(m.dimMeans)}
        </div>
        <div class="mscore"><b>${fmt(m.overall)}</b><span>整体印象均值</span></div>
      </div>`;
    }).join("");

    const workRows = agg.works.map(w => `
      <tr>
        <td><code>${esc(w.code)}</code></td>
        <td class="rev">${esc(w.modelLabel)}${w.effort ? " · " + esc(w.effort) : ""}${w.attempt ? " · 第" + w.attempt + "次" : ""}</td>
        <td>${esc(w.dim)} · ${esc(w.harnessLabel)}</td>
        <td class="num">${w.n}</td>
        ${DIM_KEYS.map(k => `<td class="num">${fmt(w.dimMeans[k])}</td>`).join("")}
        <td class="num"><b>${fmt(w.overall)}</b></td>
      </tr>`).join("");

    const evalRows = agg.evaluators.map(e => `
      <tr><td>${esc(e.name)}</td><td>${e.type === "agent" ? "🤖 Agent" : e.type === "llm" ? "🧠 LLM" : "🧑 人类"}</td>
      <td class="num">${e.n}</td></tr>`).join("");

    root.innerHTML = `
    <section class="panel">
      <div class="lb-overview">
        <div class="lb-stat"><b>${agg.sessions.length}</b><span>评分会话</span></div>
        <div class="lb-stat"><b>${agg.scoreCount}</b><span>作品×评分总数</span></div>
        <div class="lb-stat"><b>${agg.works.length}</b><span>被评作品数</span></div>
        <div class="lb-stat"><b>${agg.evaluators.length}</b><span>参与评审</span></div>
        <div class="lb-stat"><b>${esc(lastAt.slice(0, 10))}</b><span>最近提交</span></div>
      </div>
      <h2>模型排行(按整体印象均值)</h2>
      ${modelRows}
    </section>

    <section class="panel">
      <h2>单作品明细(身份已揭晓)</h2>
      <div class="review-table-wrap"><table class="work-table">
        <thead><tr><th>盲测码</th><th>作品</th><th>赛道 · Harness</th><th>n</th>
        ${DIM_KEYS.map(k => `<th>${DIM_LABELS[k]}</th>`).join("")}<th>整体</th></tr></thead>
        <tbody>${workRows}</tbody>
      </table></div>
    </section>

    <section class="panel">
      <h2>评分人</h2>
      <div class="review-table-wrap"><table class="eval-table">
        <thead><tr><th>昵称</th><th>类型</th><th>已评作品数</th></tr></thead>
        <tbody>${evalRows}</tbody>
      </table></div>
    </section>`;

    document.querySelector("#resultsMeta").textContent =
      `数据生成于本页 · ${agg.scoreCount} 条评分 · 排名仅代表当前样本的盲测印象,样本量小时波动较大`;
  }

  fetchSubmissions().then(({ sessions, source, snapshot }) => {
    if (source === "snapshot" && (!sessions || !sessions.length) && snapshot && snapshot.works) {
      badge.innerHTML = '<span style="color:#f2c14e">◈ 仓库快照(leaderboard.json)</span>';
      renderSnapshot(snapshot);
      return;
    }
    render(aggregate(sessions), source);
  });

  function renderSnapshot(snap) {
    // 快照结构与实时聚合不同(由 aggregate_scores.py 生成)——直接渲染其已聚合数据
    const modelRows = (snap.models || []).map((m, i) => `
      <div class="model-row">
        <span class="rank">${i + 1}</span>
        <div class="mmain">
          <div class="mname"><span class="dot" style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${MODEL_COLOR[m.model] || "#888"}"></span>
            ${esc(m.modelLabel)} <span class="n">${m.worksCount} 幅 · ${m.n} 次评分</span></div>
          ${dimBars(m.dimMeans || {})}
        </div>
        <div class="mscore"><b>${fmt(m.overall)}</b><span>整体印象均值</span></div>
      </div>`).join("");
    root.innerHTML = `
      <section class="panel">
        <div class="lb-overview">
          <div class="lb-stat"><b>${snap.sessionCount ?? "–"}</b><span>评分会话</span></div>
          <div class="lb-stat"><b>${snap.scoreCount ?? "–"}</b><span>评分总数</span></div>
          <div class="lb-stat"><b>${esc((snap.generatedAt || "").slice(0, 10))}</b><span>快照生成日</span></div>
        </div>
        <h2>模型排行(快照)</h2>${modelRows || '<p class="hint-line">快照为空。</p>'}
        <p class="hint-line">快照不含单作品明细;要交互式明细请确保 API 可用。</p>
      </section>`;
  }
})();
