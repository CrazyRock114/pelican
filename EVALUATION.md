# Pelican 盲测评测协议(Evaluation Protocol)

> 一句话:在 **不知道作品出自谁手** 的前提下,对每幅作品按 **5 个维度各打 1–5 分**,
> 提交后进入排行榜。支持人类与 Agent,支持三种提交通道。

## 1. 匿名化机制(为什么这是盲测)

- 打分入口 [eval.html](https://pelican-ochre.vercel.app/eval.html) **只加载匿名数据**
  (`assets/eval-data.js`:仅随机码 + 赛道),不加载任何"码 → 作品作者"映射;
- 作品 iframe 的地址经 Vercel 服务端重写为 `/w/<8位随机码>`,页面 DOM 中不存在真实路径;
- 每个评审会话内的作品顺序随机(会话内一致),避免位置偏差;
- 身份揭晓只发生在 [results.html](https://pelican-ochre.vercel.app/results.html)(汇总层)。

⚠️ 诚实声明:仓库是公开的,意志坚定、有技术能力的人可以从 `vercel.json` 重写规则
反查映射。本体系提供的是**界面级盲测(UI-blind)**,依赖评审者自律;如需更强盲测,
后续可引入私有映射服务。

## 2. 评分维度(5 × 1–5 分,1=很差,5=优秀)

| 维度 | key | 含义 |
|---|---|---|
| 还原度 | `faithfulness` | 鹈鹕骑自行车主题完成度:主体、车辆、场景是否切题 |
| 视觉美感 | `visual` | 配色、构图、造型 |
| 动画与交互 | `animation` | 流畅度、可玩性、交互反馈 |
| 技术实现 | `craft` | 产物工程质量:结构、稳定性、性能 |
| 整体印象 | `overall` | 总评 |

场次(round)由 `tools/eval_config.json` 配置,当前有:`all`(全部 24 幅)、`3d`(3D 12 幅)。

## 3. 提交通道

### 通道 A:页面直接打分(人类与浏览器 Agent 通用)

打开 [eval.html](https://pelican-ochre.vercel.app/eval.html) → 填昵称、选场次 →
逐幅打分(支持键盘:`←/→` 切换样本,`1–5` 打分,`Tab` 换维度)→ 全部完成后提交。
进度自动存本机,可续评。

**Agent console API**(页面控制台):

```js
const PE = window.PELICAN_EVAL;
await PE.start("all", "GPT-5.3-judge", "agent");   // 场次, 昵称, 类型(human/agent/llm)
PE.list();                                          // 未评样本码
PE.score(null, { faithfulness: 4, visual: 5, animation: 3, craft: 4, overall: 4 }, "备注");
                                                    // null = 当前样本;自动跳下一幅
PE.submit();                                        // 提交(优先 API,失败返回 payload 供导出)
```

### 通道 B:纯 API(无头 Agent,推荐)

```bash
# 1) 拉匿名样本池(仅含码,无身份)
curl -s https://pelican-ochre.vercel.app/assets/eval-data.js -o eval-data.js

# 2) 逐个看作品(匿名 URL,不包含任何模型信息)
#    https://pelican-ochre.vercel.app/w/<code>

# 3) 提交评分
curl -s -X POST https://pelican-ochre.vercel.app/api/submissions \
  -H 'Content-Type: application/json' -d '{
    "schema": 1,
    "sessionId": "my-judge-run-001",
    "roundId": "all",
    "evaluator": { "name": "GLM-5.3-Flash", "type": "llm" },
    "scores": [
      { "code": "f94c2d6c", "dims": { "faithfulness": 4, "visual": 5, "animation": 4, "craft": 4, "overall": 4 }, "comment": "…" }
    ]
  }'
# 201 → 成功;409 → 同 sessionId 已提交;400 → 校验失败(响应会说明原因)

# 4) 查看全部评分(GET 公开)
curl -s https://pelican-ochre.vercel.app/api/submissions
```

### 通道 C:离线 / 故障回退

eval.html 提交失败时会**自动导出 JSON**(并复制剪贴板)。把它:

- 直接发给站长,放入仓库 `submissions/` 目录;或
- 对本仓库提 PR:文件放进 `submissions/`,命名建议 `pelican-eval-<场次>-<评审名>.json`。

站长合并:`python3 tools/aggregate_scores.py submissions/` →
生成 `results/leaderboard.json` 快照 → commit + push,排行榜页在 API 不可用时展示快照。

## 4. 会话 JSON Schema(schema=1)

```jsonc
{
  "schema": 1,
  "sessionId": "uuid 或 8-64 位安全字符",       // 幂等键:重复提交同 ID 会被 API 拒绝(409)
  "roundId": "all | 3d | …",
  "evaluator": { "name": "≤60字符, 将公示", "type": "human | agent | llm" },
  "startedAt": "ISO 时间(可选)", "submittedAt": "ISO 时间",
  "blind": true,
  "scores": [
    {
      "code": "8位十六进制匿名码",               // 必须存在于 assets/eval-data.js
      "dims": { "faithfulness": 1-5, "visual": 1-5, "animation": 1-5, "craft": 1-5, "overall": 1-5 },
      "comment": "≤500 字符, 可选"
    }
  ]
}
```

聚合口径:同会话同作品只计一次;模型排名 = 其所有作品的评分按次数加权平均。

## 5. 数据流与文件

```
tools/eval_config.json           场次/维度配置(想改评分维度或加场次就动它)
tools/generate_eval.py           扫描 raw/(只读)→ eval-data.js / eval-map.js / vercel.json
tools/eval_state.json            匿名码缓存(保证码稳定;含 salt,勿删)
assets/eval-data.js              公开匿名池(评测页唯一数据源)
assets/eval-map.js               码→身份映射(仅 results.html 加载)
vercel.json                      /w/<code> → raw/<…> 重写规则
api/submissions.js               GET/POST 评分(Vercel Blob,公开读写,CORS 全开)
eval.html / assets/eval.js       盲测打分页
results.html / assets/results.js 排行榜(实时 API 优先,快照兜底)
tools/aggregate_scores.py        快照汇总
submissions/                     离线评分文件(人工收集或 PR)
```

新增作品后:`python3 tools/generate_eval.py` 会给新作品分配稳定匿名码并自动追加重写规则。
