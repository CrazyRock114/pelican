#!/usr/bin/env python3
"""
generate_data.py — 扫描 raw/ 素材目录(只读),生成导航站数据文件 assets/data.js

用法: python3 tools/generate_data.py [raw目录] [输出文件]
本脚本对 raw/ 仅做读取,绝不写入/修改原始素材。
"""
import json
import re
import sys
from datetime import datetime
from pathlib import Path

# ---------------------------------------------------------------- 知识表

MODEL_MAP = {
    # folder token(小写化后匹配) -> (model key, effort, 显示名, 厂商)
    "4carbonhigh":  ("4carbon",  "High",   "Gemini 4 Carbon",   "google"),
    "4carbon":      ("4carbon",  None,     "Gemini 4 Carbon",   "google"),
    "4argon":       ("4argon",   None,     "Gemini 4 Argon",    "google"),
    "flashlite":    ("flashlite", None,    "Gemini Flash Lite", "google"),
    "fable52max":   ("fable52",  "Max",    "Fable 5.2",         "anthropic"),
    "fable52medium":("fable52",  "Medium", "Fable 5.2",         "anthropic"),
    "opus55medium": ("opus55",   "Medium", "Opus 5.5",          "anthropic"),
    "opus55high":   ("opus55",   "High",   "Opus 5.5",          "anthropic"),
    "opus55extra":  ("opus55",   "Extra",  "Opus 5.5",          "anthropic"),
}

MODEL_ORDER = ["4carbon", "4argon", "flashlite", "fable52", "opus55"]
EFFORT_ORDER = {"Medium": 0, "High": 1, "Extra": 2, "Max": 3}

HARNESS_MAP = {
    "claude-desktop": "Claude Desktop",
    "antigravity":    "Antigravity",
    "gemini-task":    "Gemini Task 模式",
    "gemini-chat":    "Gemini Chat 模式",
}

HARNESS_ORDER = ["gemini-chat", "gemini-task", "antigravity", "claude-desktop"]


def parse_folder(name: str):
    """按命名约定解析文件夹名: {2D|3D}pelican_[Harness_]模型+强度 (容忍 penlican 拼写)"""
    m = re.match(r"^(2D|3D)pe(nl|l)ican_(.+)$", name)
    if not m:
        raise ValueError(f"无法解析文件夹名: {name}")
    dim, rest = m.group(1), m.group(3)

    harness = "claude-desktop"  # 无前缀 = Claude Desktop
    for prefix, h in (("Anti_", "antigravity"), ("GeminiChat_", "gemini-chat"), ("Gemini_", "gemini-task")):
        if rest.startswith(prefix):
            harness = h
            rest = rest[len(prefix):]
            break

    if rest.lower() not in MODEL_MAP:
        raise ValueError(f"无法识别模型/强度 token: {rest!r} (文件夹 {name})")
    model, effort, model_label, vendor = MODEL_MAP[rest.lower()]
    return dim, harness, model, effort, model_label, vendor


def parse_file_order(files):
    """多文件组排序: 无数字后缀者第 1,其后按文件名尾号(1,2,…)"""
    def key(p: Path):
        m = re.search(r"(\d+)\.html$", p.name)
        return (1, int(m.group(1))) if m else (0, 0)
    return sorted(files, key=key)


def extract_title(html_path: Path) -> str:
    try:
        text = html_path.read_text(encoding="utf-8", errors="replace")
        m = re.search(r"<title>(.*?)</title>", text, re.S | re.I)
        if m:
            return re.sub(r"\s+", " ", m.group(1)).strip()
        return ""
    except Exception:
        return ""


def detect_cdn(html_path: Path) -> bool:
    try:
        text = html_path.read_text(encoding="utf-8", errors="replace")
        return bool(re.search(r'(?:src|href)="https?://', text))
    except Exception:
        return False


def main():
    root = Path(__file__).resolve().parent.parent
    raw_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "raw"
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else root / "assets" / "data.js"

    entries = []
    for folder in sorted(raw_dir.iterdir()):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        htmls = [p for p in folder.iterdir() if p.is_file() and p.suffix == ".html"]
        if not htmls:
            continue
        dim, harness, model, effort, model_label, vendor = parse_folder(folder.name)
        ordered = parse_file_order(htmls)
        for i, f in enumerate(ordered, start=1):
            stat = f.stat()
            entries.append({
                "id": f"{folder.name}__{i}",
                "dim": dim,
                "vendor": vendor,
                "model": model,
                "modelLabel": model_label,
                "effort": effort,
                "harness": harness,
                "harnessLabel": HARNESS_MAP[harness],
                "attempt": i if len(ordered) > 1 else None,
                "folder": folder.name,
                "file": f.name,
                "path": f"raw/{folder.name}/{f.name}",
                "size": stat.st_size,
                "mtime": datetime.fromtimestamp(stat.st_mtime).strftime("%m-%d %H:%M"),
                "mtimeTs": int(stat.st_mtime),
                "title": extract_title(f),
                "cdn": detect_cdn(f),
                "typo": "penlican" in folder.name,
            })

    def sort_key(e):
        return (e["dim"], MODEL_ORDER.index(e["model"]),
                EFFORT_ORDER.get(e["effort"], -1), e["attempt"] or 0)

    entries.sort(key=sort_key)

    counts = {
        "entries": len(entries),
        "folders": len({e["folder"] for e in entries}),
        "dim2d": sum(1 for e in entries if e["dim"] == "2D"),
        "dim3d": sum(1 for e in entries if e["dim"] == "3D"),
        "google": sum(1 for e in entries if e["vendor"] == "google"),
        "anthropic": sum(1 for e in entries if e["vendor"] == "anthropic"),
        "byModel": {m: sum(1 for e in entries if e["model"] == m) for m in MODEL_ORDER},
        "byHarness": {h: sum(1 for e in entries if e["harness"] == h) for h in HARNESS_ORDER},
    }

    payload = {
        "generatedAt": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "counts": counts,
        "entries": entries,
    }

    out_path.parent.mkdir(parents=True, exist_ok=True)
    js = ("// 由 tools/generate_data.py 自动生成 — 请勿手写,重跑脚本即可刷新\n"
          "window.PELICAN_DATA = " + json.dumps(payload, ensure_ascii=False, indent=2) + ";\n")
    out_path.write_text(js, encoding="utf-8")

    print(f"✔ 生成 {out_path}  (作品 {counts['entries']} 幅 / 文件夹 {counts['folders']} 个)")
    print(f"  2D {counts['dim2d']} · 3D {counts['dim3d']} · Google {counts['google']} · Anthropic {counts['anthropic']}")
    for e in entries:
        eff = f" [{e['effort']}]" if e["effort"] else ""
        att = f" (第{e['attempt']}次)" if e["attempt"] else ""
        print(f"  - {e['dim']}  {e['modelLabel']}{eff}{att}  @ {e['harnessLabel']}:  {e['path']}  ({e['size']//1024} KB)")


if __name__ == "__main__":
    main()
