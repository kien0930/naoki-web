// Naoki's chat endpoint: forwards the conversation to Anthropic with the key kept on the server.
// Guard rails: only Naoki's own prompt is accepted, inputs are capped, and every visitor is rate-limited.
const RULES_FINGERPRINT = require("./fingerprint.json").prefix;

// Which AI answers: a free Gemini key (Google AI Studio) if set, otherwise an Anthropic key.
const PROVIDER = process.env.GEMINI_API_KEY ? "gemini" : (process.env.ANTHROPIC_API_KEY ? "anthropic" : null);
const MODEL_QUICK = process.env.MODEL_QUICK || (PROVIDER === "gemini" ? "gemini-flash-lite-latest" : "claude-haiku-5-5");
const MODEL_DEEP = process.env.MODEL_DEEP || (PROVIDER === "gemini" ? MODEL_QUICK : "claude-sonnet-5-5");
const PER_IP_10MIN = +process.env.LIMIT_PER_10MIN || 12;   // messages per visitor per 10 minutes
const PER_IP_DAY = +process.env.LIMIT_PER_DAY || 60;       // messages per visitor per day
const GLOBAL_DAY = +process.env.LIMIT_GLOBAL_DAY || 400;   // messages per server instance per day
const MAX_SYSTEM = 34000, MAX_TURN = 4000, MAX_USER = 1500, MAX_TURNS = 16;

const hits = new Map();      // ip -> [timestamps]
let day = "", dayCount = 0;

function limited(ip){
  const now = Date.now(), today = new Date(now + 7 * 3600e3).toISOString().slice(0, 10);
  if (today !== day){ day = today; dayCount = 0; hits.clear(); }
  const list = (hits.get(ip) || []).filter(t => now - t < 24 * 3600e3);
  const recent = list.filter(t => now - t < 10 * 60e3).length;
  if (dayCount >= GLOBAL_DAY) return "global";
  if (list.length >= PER_IP_DAY) return "day";
  if (recent >= PER_IP_10MIN) return "burst";
  list.push(now); hits.set(ip, list); dayCount++;
  return null;
}

function bad(res, status, code, message){
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify({ code, message }));
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return bad(res, 405, "method", "POST only");
  if (!PROVIDER) return bad(res, 503, "not_configured", "Server chưa có API key.");

  let body = req.body;
  if (typeof body === "string"){ try { body = JSON.parse(body); } catch { body = null; } }
  const input = body && Array.isArray(body.messages) ? body.messages : null;
  if (!input || !input.length || input[0].role !== "user" || typeof input[0].content !== "string") return bad(res, 400, "bad_request", "Thiếu tin nhắn.");

  // the first message carries Naoki's prompt; anything else is refused
  let system = input[0].content;
  if (!system.startsWith(RULES_FINGERPRINT) || system.length > MAX_SYSTEM) return bad(res, 400, "bad_request", "Sai định dạng.");

  // history: user/assistant only, capped, alternating, starting with the user
  let msgs = input.slice(1).filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .slice(-MAX_TURNS).map(m => ({ role: m.role, content: m.content.slice(0, m.role === "user" ? MAX_USER : MAX_TURN) }));
  while (msgs.length && msgs[0].role !== "user") msgs.shift();
  const merged = [];
  for (const m of msgs){
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += "\n\n" + m.content; else merged.push({ ...m });
  }
  if (!merged.length || merged[merged.length - 1].role !== "user") return bad(res, 400, "bad_request", "Tin nhắn cuối phải là của bạn.");

  const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "?").split(",")[0].trim();
  const lim = limited(ip);
  if (lim) return bad(res, 429, lim === "burst" ? "rate_limited" : "daily_limit", lim === "burst" ? "Gửi chậm lại chút nha." : "Hôm nay nói nhiều quá rồi, mai quay lại nha.");

  if (PROVIDER === "gemini") system = system.replace("Bạn chạy trên Claude.", "Bạn chạy trên mô hình Gemini của Google (bản web riêng của Naoki).");
  const deep = body.tier === "complex" || body.tier === "deep";
  const ctl = new AbortController();
  req.on("close", () => ctl.abort());

  const model = deep ? MODEL_DEEP : MODEL_QUICK;
  let up;
  try {
    up = PROVIDER === "gemini"
      ? await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":streamGenerateContent?alt=sse", {
          method: "POST", signal: ctl.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: merged.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
            generationConfig: { maxOutputTokens: deep ? 3000 : 2000, temperature: 0.9 },
          }),
        })
      : await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", signal: ctl.signal,
          headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, max_tokens: deep ? 1200 : 700, system, messages: merged, stream: true }),
        });
  } catch (e){ return bad(res, 502, "upstream_error", "Không gọi được AI."); }
  if (!up.ok || !up.body){
    const t = await up.text().catch(() => "");
    console.error(PROVIDER, model, up.status, t.slice(0, 400));
    const busy = up.status === 429;
    return bad(res, busy ? 429 : 502, busy ? "daily_limit" : "upstream_error", busy ? "Hết lượt miễn phí rồi." : "AI đang bận.");
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  const reader = up.body.getReader(), dec = new TextDecoder();
  let buf = "", stop = "", wrote = false;
  const out = t => { if (t){ res.write(t); wrote = true; } };
  try {
    for (;;){
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0){
        const evt = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = evt.split("\n").find(l => l.startsWith("data:"));
        if (!line) continue;
        let d; try { d = JSON.parse(line.slice(5)); } catch { continue; }
        if (PROVIDER === "gemini"){
          if (d.promptFeedback && d.promptFeedback.blockReason) stop = "refusal";
          const c = d.candidates && d.candidates[0];
          if (c && c.content && c.content.parts) for (const part of c.content.parts) if (!part.thought) out(part.text);
          if (c && c.finishReason) stop = c.finishReason === "MAX_TOKENS" ? "max_tokens" : (c.finishReason === "STOP" ? "end_turn" : "refusal");
        } else {
          if (d.type === "content_block_delta" && d.delta && d.delta.type === "text_delta") out(d.delta.text);
          else if (d.type === "message_delta" && d.delta && d.delta.stop_reason) stop = d.delta.stop_reason;
        }
      }
    }
  } catch (e){ /* client left or upstream cut */ }
  res.end("\u0000" + (stop || "end") + (wrote ? "" : "|empty"));
};
