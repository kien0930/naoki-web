// Naoki's chat endpoint: forwards the conversation to Anthropic with the key kept on the server.
// Guard rails: only Naoki's own prompt is accepted, inputs are capped, and every visitor is rate-limited.
const RULES_FINGERPRINT = require("./fingerprint.json").prefix;

const MODEL_QUICK = process.env.MODEL_QUICK || "claude-haiku-5-5";
const MODEL_DEEP = process.env.MODEL_DEEP || "claude-sonnet-5-5";
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
  if (!process.env.ANTHROPIC_API_KEY) return bad(res, 503, "not_configured", "Server chưa có API key.");

  let body = req.body;
  if (typeof body === "string"){ try { body = JSON.parse(body); } catch { body = null; } }
  const input = body && Array.isArray(body.messages) ? body.messages : null;
  if (!input || !input.length || input[0].role !== "user" || typeof input[0].content !== "string") return bad(res, 400, "bad_request", "Thiếu tin nhắn.");

  // the first message carries Naoki's prompt; anything else is refused
  const system = input[0].content;
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

  const deep = body.tier === "complex" || body.tier === "deep";
  const ctl = new AbortController();
  req.on("close", () => ctl.abort());

  let up;
  try {
    up = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: deep ? MODEL_DEEP : MODEL_QUICK, max_tokens: deep ? 1200 : 700, system, messages: merged, stream: true }),
    });
  } catch (e){ return bad(res, 502, "upstream_error", "Không gọi được Claude."); }
  if (!up.ok || !up.body){
    const t = await up.text().catch(() => "");
    console.error("anthropic", up.status, t.slice(0, 300));
    return bad(res, up.status === 429 ? 429 : 502, up.status === 429 ? "rate_limited" : "upstream_error", "Claude đang bận.");
  }

  res.statusCode = 200;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  const reader = up.body.getReader(), dec = new TextDecoder();
  let buf = "", stop = "";
  try {
    for (;;){
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0){
        const evt = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = evt.split("\n").find(l => l.startsWith("data:"));
        if (!line) continue;
        let d; try { d = JSON.parse(line.slice(5)); } catch { continue; }
        if (d.type === "content_block_delta" && d.delta && d.delta.type === "text_delta") res.write(d.delta.text);
        else if (d.type === "message_delta" && d.delta && d.delta.stop_reason) stop = d.delta.stop_reason;
      }
    }
  } catch (e){ /* client left or upstream cut */ }
  res.end("\u0000" + (stop || "end"));
};
