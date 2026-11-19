#!/usr/bin/env python3
"""
aggregate_scores.py — 汇总盲测评分,生成 results/leaderboard.json(仓库快照)

输入:  一个或多个评分文件(单会话 JSON / {submissions:[...]} / 数组均可)
输出:  results/leaderboard.json(模型排行 + 单作品明细 + 评分人),提交进仓库即可让
       results.html 在 API 不可用时展示快照。

用法:
  python3 tools/aggregate_scores.py submissions/*.json
  python3 tools/aggregate_scores.py submissions/          # 扫描目录
"""
import json
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIM_KEYS = ["faithfulness", "visual", "animation", "craft", "overall"]


def parse_map_js():
    text = (ROOT / "assets" / "eval-map.js").read_text(encoding="utf-8")
    payload = text[text.index("{"): text.rindex("}") + 1]
    return json.loads(payload)["works"]


def load_sessions(paths):
    sessions, seen = [], set()
    for p in paths:
        path = Path(p)
        files = sorted(path.glob("*.json")) if path.is_dir() else [path]
        for f in files:
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except Exception as e:
                print(f"⚠ 跳过 {f}: {e}", file=sys.stderr)
                continue
            if isinstance(data, dict) and isinstance(data.get("submissions"), list):
                data = data["submissions"]
            elif isinstance(data, dict):
                data = [data]
            if not isinstance(data, list):
                continue
            for sess in data:
                sid = sess.get("sessionId")
                if sid and sid in seen:
                    continue
                if sid:
                    seen.add(sid)
                sessions.append(sess)
    return sessions


def main():
    args = sys.argv[1:] or ["submissions/"]
    works_map = parse_map_js()
    by_code = {w["code"]: w for w in works_map}

    sessions = load_sessions(args)
    if not sessions:
        print("⚠ 没有可汇总的评分会话", file=sys.stderr)

    per_work = {}
    evals = {}
    score_count = 0
    for sess in sessions:
        if not isinstance(sess, dict) or not isinstance(sess.get("scores"), list):
            continue
        evKey = sess.get("sessionId") or f"anon-{len(evals)}"
        st = evals.setdefault(evKey, {
            "name": (sess.get("evaluator") or {}).get("name", "匿名"),
            "type": (sess.get("evaluator") or {}).get("type", "human"),
            "n": 0,
        })
        for s in sess["scores"]:
            w = by_code.get(s.get("code"))
            if not w or not isinstance(s.get("dims"), dict):
                continue
            dims_in = {k: v for k in DIM_KEYS if isinstance(s["dims"].get(k), (int, float))}
            if not dims_in:  # 空条目(未实际评分)不计入聚合
                continue
            score_count += 1
            st["n"] += 1
            agg = per_work.setdefault(s["code"], {"n": 0, "dims": {}})
            agg["n"] += 1
            for k in DIM_KEYS:
                if k in dims_in:
                    agg["dims"][k] = agg["dims"].get(k, 0) + s["dims"][k]

    work_rows = []
    for code, agg in per_work.items():
        w = by_code[code]
        dims = {k: (agg["dims"][k] / agg["n"] if k in agg["dims"] else None) for k in DIM_KEYS}
        work_rows.append({
            "code": code, "folder": w["folder"], "file": w["file"], "dim": w["dim"],
            "model": w["model"], "modelLabel": w["modelLabel"], "effort": w["effort"],
            "harness": w["harness"], "harnessLabel": w["harnessLabel"], "vendor": w["vendor"],
            "attempt": w["attempt"], "n": agg["n"], "dimMeans": dims, "overall": dims["overall"],
        })
    work_rows.sort(key=lambda r: (r["overall"] if r["overall"] is not None else -1), reverse=True)

    def group(field):
        m = {}
        for r in work_rows:
            g = m.setdefault(r[field], {"n": 0, "dims": {}, "works": set()})
            g["n"] += r["n"]
            g["works"].add(r["code"])
            for k in DIM_KEYS:
                if r["dimMeans"][k] is not None:
                    g["dims"][k] = g["dims"].get(k, 0) + r["dimMeans"][k] * r["n"]
        out = []
        for key, g in m.items():
            dims = {k: (g["dims"][k] / g["n"] if k in g["dims"] else None) for k in DIM_KEYS}
            out.append({
                "model" if field == "model" else field: key,
                "modelLabel": key if field != "model" else next(
                    r["modelLabel"] for r in work_rows if r["model"] == key),
                "n": g["n"], "worksCount": len(g["works"]),
                "dimMeans": dims, "overall": dims["overall"],
            })
        out.sort(key=lambda r: (r["overall"] if r["overall"] is not None else -1), reverse=True)
        return out

    leaderboard = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "sessionCount": len(sessions),
        "scoreCount": score_count,
        "models": group("model"),
        "harnesses": group("harness"),
        "works": work_rows,
        "evaluators": sorted(evals.values(), key=lambda e: -e["n"]),
    }

    out_path = ROOT / "results" / "leaderboard.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(leaderboard, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"✔ 生成 {out_path}")
    print(f"  会话 {leaderboard['sessionCount']} · 评分 {score_count} 条 · 作品 {len(work_rows)} 幅 · 评审 {len(evals)} 位")
    for i, m in enumerate(leaderboard["models"], 1):
        print(f"  {i}. {m['modelLabel']}: 整体 {m['overall']:.2f}(n={m['n']})")


if __name__ == "__main__":
    main()
