#!/usr/bin/env python3
"""
generate_eval.py — 生成盲测评测体系的数据文件(对 raw/ 只读)

产出:
  1. assets/eval-data.js   公开:场次/维度/匿名码(不含任何路径或身份)
  2. assets/eval-map.js    仅汇总页加载:匿名码 → raw 路径(评测页绝不加载)
  3. vercel.json           /w/<匿名码> 服务端重写到真实作品页(生产环境路径不可见)
  4. tools/eval_state.json 匿名码缓存(salt + code 映射,保证重复生成时码稳定)

用法: python3 tools/generate_eval.py [raw目录]
"""
import hashlib
import json
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "tools" / "eval_config.json"
STATE = ROOT / "tools" / "eval_state.json"


def load_state(works_key_list):
    """读取/初始化匿名码缓存:salt 固定,码一经分配不再变化。"""
    if STATE.exists():
        state = json.loads(STATE.read_text(encoding="utf-8"))
    else:
        state = {"salt": secrets.token_hex(16), "codes": {}}
    codes = state.setdefault("codes", {})
    changed = False
    for key in works_key_list:
        if key not in codes:
            digest = hashlib.sha256((state["salt"] + key).encode()).hexdigest()
            codes[key] = digest[:8]
            changed = True
    if changed:
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    return state["salt"], codes


def build_works(raw_dir: Path):
    """与 generate_data.py 相同的命名解析(大小写不敏感),产出带身份的清单。"""
    MODEL_MAP = {
        "4carbonhigh":  ("4carbon",  "High",   "Gemini 4 Carbon",   "google"),
        "4carbon":      ("4carbon",  None,     "Gemini 4 Carbon",   "google"),
        "4argon":       ("4argon",   None,     "Gemini 4 Argon",    "google"),
        "flashlite":    ("flashlite", None,    "Gemini Flash Lite", "google"),
        "fable52max":   ("fable52",  "Max",    "Fable 5.2",         "anthropic"),
        "fable52medium":("fable52",  "Medium", "Fable 5.2",         "anthropic"),
        "opus55medium": ("opus55",   "Medium", "Opus 5.5",          "anthropic"),
        "opus55high":   ("opus55",   "High",   "Opus 5.5",          "anthropic"),
        "opus55extra":  ("opus55",   "Extra",  "Opus 5.5",          "anthropic"),
        "opus55max":    ("opus55",   "Max",    "Opus 5.5",          "anthropic"),
    }
    HARNESS_MAP = {
        "claude-desktop": "Claude Desktop",
        "antigravity":    "Antigravity",
        "gemini-task":    "Gemini Task 模式",
        "gemini-chat":    "Gemini Chat 模式",
    }
    import re
    works = []
    for folder in sorted(raw_dir.iterdir()):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        m = re.match(r"^(2D|3D)pe(nl|l)ican_(.+)$", folder.name)
        if not m:
            continue
        dim, rest = m.group(1), m.group(3)
        harness = "claude-desktop"
        for prefix, h in (("Anti_", "antigravity"), ("GeminiChat_", "gemini-chat"), ("Gemini_", "gemini-task")):
            if rest.startswith(prefix):
                harness, rest = h, rest[len(prefix):]
                break
        if rest.lower() not in MODEL_MAP:
            continue
        model, effort, model_label, vendor = MODEL_MAP[rest.lower()]
        for f in sorted(folder.glob("*.html")):
            works.append({
                "key": f"{folder.name}/{f.name}",
                "folder": folder.name,
                "file": f.name,
                "path": f"raw/{folder.name}/{f.name}",
                "dim": dim,
                "model": model,
                "modelLabel": model_label,
                "effort": effort,
                "harness": harness,
                "harnessLabel": HARNESS_MAP[harness],
                "vendor": vendor,
                "attempt": None,
            })
    # 多文件组(同文件夹多作品)按文件名序标 attempt
    from collections import Counter
    by_folder = Counter(w["folder"] for w in works)
    for folder_name, n in by_folder.items():
        if n > 1:
            group = sorted([w for w in works if w["folder"] == folder_name],
                           key=lambda w: (1, int(re.search(r"(\d+)\.html$", w["file"]).group(1)))
                           if re.search(r"(\d+)\.html$", w["file"]) else (0, 0))
            for i, w in enumerate(group, 1):
                w["attempt"] = i
    return works


def round_matches(work, include):
    if not include:
        return True
    for field in ("dim", "model", "harness", "vendor"):
        if include.get(field) and work[field] != include[field]:
            return False
    if include.get("folders") and work["folder"] not in include["folders"]:
        return False
    return True


def main():
    raw_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "raw"
    cfg = json.loads(CONFIG.read_text(encoding="utf-8"))
    works = build_works(raw_dir)
    if not works:
        raise SystemExit("raw/ 下没有可解析的作品文件夹")

    _, codes = load_state([w["key"] for w in works])

    # 1) 公开评测数据:只有匿名码,无路径无身份
    eval_data = {
        "generatedAt": __import__("datetime").datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "scale": cfg["scale"],
        "dims": cfg["dims"],
        "rounds": [
            {
                "id": r["id"],
                "title": r["title"],
                "works": [
                    {"code": codes[w["key"]], "dim": w["dim"], "attempt": w["attempt"]}
                    for w in works if round_matches(w, r.get("include"))
                ],
            }
            for r in cfg["rounds"]
        ],
    }
    (ROOT / "assets" / "eval-data.js").write_text(
        "// 由 tools/generate_eval.py 自动生成 —— 仅含匿名码,无任何身份/路径信息\n"
        "window.PELICAN_EVAL_DATA = " + json.dumps(eval_data, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8")

    # 2) 匿名码 → 真实路径(仅 results.html 汇总页加载)
    eval_map = {
        "works": [
            {
                "code": codes[w["key"]],
                "path": w["path"],
                "dim": w["dim"],
                "folder": w["folder"],
                "file": w["file"],
                "model": w["model"],
                "modelLabel": w["modelLabel"],
                "effort": w["effort"],
                "harness": w["harness"],
                "harnessLabel": w["harnessLabel"],
                "vendor": w["vendor"],
                "attempt": w["attempt"],
            }
            for w in works
        ]
    }
    (ROOT / "assets" / "eval-map.js").write_text(
        "// 仅 results.html(汇总页)加载 —— 评测页(eval.html)绝不加载本文件\n"
        "window.PELICAN_EVAL_MAP = " + json.dumps(eval_map, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8")

    # 3) vercel.json:/w/<code> 服务端重写,生产环境真实路径不可见
    vercel_cfg = {
        "rewrites": [
            {"source": f"/w/{codes[w['key']]}", "destination": f"/{w['path']}"}
            for w in works
        ]
    }
    (ROOT / "vercel.json").write_text(json.dumps(vercel_cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    total = sum(len(r["works"]) for r in eval_data["rounds"])
    print(f"✔ eval-data.js:{len(works)} 幅作品 → {len(eval_data['rounds'])} 个场次共 {total} 个匿名样本")
    print(f"✔ vercel.json:{len(vercel_cfg['rewrites'])} 条 /w/<code> 重写规则")
    for r in eval_data["rounds"]:
        print(f"   · 场次 {r['id']}({r['title']}):{len(r['works'])} 幅")


if __name__ == "__main__":
    main()
