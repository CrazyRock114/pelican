// Vercel Serverless Function: /api/submissions
// GET  → 返回全部评分会话 { submissions: [...], count, generatedAt }
// POST → 校验并存储一个评分会话(Blob: submissions/<sessionId>.json)
// CORS 全开:允许任意来源的评测者/Agent 提交与读取。
import { put, head, list, del } from "@vercel/blob";

const PREFIX = "submissions/";
const MAX_BODY = 64 * 1024; // 64KB

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(res, status, body) {
  return res.status(status).setHeader("Content-Type", "application/json")
    .setHeader("Cache-Control", "no-store")
    .setHeader("Access-Control-Allow-Origin", cors["Access-Control-Allow-Origin"])
    .setHeader("Access-Control-Allow-Methods", cors["Access-Control-Allow-Methods"])
    .setHeader("Access-Control-Allow-Headers", cors["Access-Control-Allow-Headers"])
    .json(body);
}

function validate(payload) {
  const e = (msg) => msg;
  if (!payload || typeof payload !== "object") return e("body 必须是 JSON 对象");
  if (payload.schema !== 1) return e("schema 必须为 1");
  if (typeof payload.sessionId !== "string" || !/^[a-zA-Z0-9_-]{8,64}$/.test(payload.sessionId))
    return e("sessionId 格式非法");
  if (typeof payload.roundId !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(payload.roundId))
    return e("roundId 格式非法");
  if (!payload.evaluator || typeof payload.evaluator.name !== "string" || payload.evaluator.name.length > 60)
    return e("evaluator.name 缺失或过长");
  if (!Array.isArray(payload.scores) || payload.scores.length === 0 || payload.scores.length > 200)
    return e("scores 数组为空或过大");
  for (const s of payload.scores) {
    if (typeof s.code !== "string" || !/^[a-f0-9]{8}$/.test(s.code)) return e("scores[].code 格式非法");
    if (!s.dims || typeof s.dims !== "object") return e("scores[].dims 缺失");
    for (const [k, v] of Object.entries(s.dims)) {
      if (!/^[a-z]+$/.test(k) || !Number.isInteger(v) || v < 0 || v > 10)
        return e(`scores[].dims.${k} 非法`);
    }
    if (s.comment !== undefined && typeof s.comment !== "string") return e("comment 必须为字符串");
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }

  let token;
  try { token = process.env.BLOB_READ_WRITE_TOKEN; } catch { token = undefined; }
  if (!token) return json(res, 503, { error: "Blob 存储未配置(BLOB_READ_WRITE_TOKEN 缺失)" });

  // ---------- GET:列出全部会话
  if (req.method === "GET") {
    try {
      const listed = await list({ prefix: PREFIX, token, limit: 1000 });
      const submissions = [];
      for (const blob of listed.blobs) {
        const r = await fetch(blob.url, { cache: "no-store" });
        if (r.ok) {
          try { submissions.push(await r.json()); } catch { /* 跳过损坏行 */ }
        }
      }
      submissions.sort((a, b) => (a.submittedAt || "") < (b.submittedAt || "") ? -1 : 1);
      return json(res, 200, { count: submissions.length, generatedAt: new Date().toISOString(), submissions });
    } catch (e) {
      return json(res, 500, { error: "读取失败: " + String(e.message || e).slice(0, 200) });
    }
  }

  // ---------- POST:提交一个会话
  if (req.method === "POST") {
    let payload;
    try {
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {});
      if (raw.length > MAX_BODY) return json(res, 413, { error: "payload 超过 64KB" });
      payload = typeof req.body === "object" && req.body !== null && Object.keys(req.body).length
        ? req.body : JSON.parse(raw);
    } catch {
      return json(res, 400, { error: "body 不是合法 JSON" });
    }

    const err = validate(payload);
    if (err) return json(res, 400, { error: err });

    const pathname = `${PREFIX}${payload.sessionId}.json`;
    try {
      let exists = false;
      try {
        await head(pathname, { token });
        exists = true;
      } catch (headErr) {
        if (headErr?.name && headErr.name !== "BlobNotFoundError") throw headErr;
        // BlobNotFoundError → 不存在,继续写入
      }
      if (exists) {
        return json(res, 409, { error: "该 sessionId 已提交过,请勿重复提交", sessionId: payload.sessionId });
      }
      const blob = await put(pathname, JSON.stringify(payload, null, 2), {
        access: "public",
        addRandomSuffix: false,
        token,
        contentType: "application/json",
      });
      return json(res, 201, { ok: true, sessionId: payload.sessionId, url: blob.url });
    } catch (e) {
      return json(res, 500, { error: "写入失败: " + String(e.message || e).slice(0, 200) });
    }
  }

  return json(res, 405, { error: "仅支持 GET / POST" });
}
