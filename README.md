# Pelican 行车测试 · 对比导航站

2026-11-09 ~ 11-10,对 Google(Gemini 4 Carbon / 4 Argon / Flash Lite)与
Anthropic(Fable 5.2 / Opus 5.5)在 4 种 Harness(Claude Desktop / Antigravity /
Gemini Task / Gemini Chat)下做的「鹈鹕骑车」测试作品做导航与对比的本地静态站。

## 使用

```bash
./serve.sh          # 默认 8787 端口,或 ./serve.sh 9000 指定端口
# 打开 http://127.0.0.1:8787/
```

功能:2D/3D 分组浏览、按模型 / Harness / 厂商 / 强度筛选与搜索、
卡片内点击加载实时预览、勾选 2~6 幅进入并排对比、详情浮层(←/→ 翻页)。

## 目录

```
index.html            导航站入口
assets/style.css      样式(无外部依赖)
assets/app.js         交互逻辑(无外部依赖)
assets/data.js        作品清单(由脚本扫描 raw/ 生成)
tools/generate_data.py 清单生成器(对 raw/ 只读)
tools/raw_manifest_before.txt  建站前 raw/ 全部文件的 md5 基线
serve.sh              本地预览脚本
raw/                  原始素材 —— 只读,未做任何改动
```

## 说明

- **原始素材零改动**:所有作品页通过相对路径 `raw/<文件夹>/<文件>.html` 直接引用,
  未复制、未重命名、未修改;`raw/` 的 md5 基线存于 `tools/raw_manifest_before.txt`,
  可随时复检。
- 文件夹 `3Dpenlican_Anti_4CarbonHigh` 的拼写原始素材即如此(penlican),保留未动。
- raw/ 增删作品后,重跑 `python3 tools/generate_data.py` 即可刷新清单。
- 部分作品自身引用 three.js / Tailwind CDN,离线时这些作品无法渲染属正常现象
  (卡片带 `CDN` 徽标);导航站本身无任何外部依赖,可离线打开。
- 亦可直接双击 `index.html` 用 file:// 打开(站点无需服务),但建议用 serve.sh
  以获得最稳妥的 iframe 行为。

## 命名约定解析(raw/ → 数据)

`{2D|3D}pelican_[Harness_]模型+强度`,大小写不敏感;`penlican` 视为 pelican 拼写容忍:

| 前缀 | Harness | 模型 token | 模型 / 强度 |
|---|---|---|---|
| (无) | Claude Desktop | fable52Medium / fable52max | Fable 5.2 · Medium / Max |
| (无) | Claude Desktop | opus55Medium / High / Extra | Opus 5.5 · Medium / High / Extra |
| `Anti_` | Antigravity | Opus55Medium、4CarbonHigh | 同上 / 4 Carbon · High |
| `Gemini_` | Gemini Task 模式 | 4Carbon、4Argon | 不标强度 |
| `GeminiChat_` | Gemini Chat 模式 | 4CarbonHigh、FlashLite | 4 Carbon · High / Flash Lite |

`2Dpelican_GeminiChat_4CarbonHigh` 内 3 个 html 为同配置独立跑 3 次,
按文件名序标「第 1/2/3 次」。
