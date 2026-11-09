/* Naoki on her own site: stands in for Claude's window.claude so the page code runs unchanged.
   Chat goes to /api/chat (the API key lives on the server); everything else answers null. */
(function(){
  async function sample(input, opts){
    opts = opts || {};
    let full = "";
    let r;
    try {
      r = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" }, signal: opts.signal,
        body: JSON.stringify({ messages: input, tier: opts.modelTier || "quick" }),
      });
    } catch (e){
      throw (e && e.name === "AbortError") ? { code: "cancelled", message: "cancelled" } : { code: "upstream_error", message: "network" };
    }
    if (!r.ok){
      let j = {}; try { j = await r.json(); } catch (e){}
      throw { code: j.code || "upstream_error", message: j.message || String(r.status) };
    }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let stop = "";
    try {
      for (;;){
        const { value, done } = await reader.read();
        if (done) break;
        let chunk = dec.decode(value, { stream: true });
        const z = chunk.indexOf("\u0000");
        if (z >= 0){ stop = chunk.slice(z + 1); chunk = chunk.slice(0, z); }
        if (chunk){ full += chunk; if (opts.onText) opts.onText({ text: full, delta: chunk }); }
      }
    } catch (e){
      if (e && e.name === "AbortError") throw { code: "cancelled", message: "cancelled", text: full || undefined };
      throw { code: "upstream_error", message: "stream", text: full || undefined };
    }
    if (!full.trim()) throw { code: /refusal/.test(stop) ? "refused" : "empty_completion", message: stop };
    return { text: full, truncated: stop === "max_tokens" };
  }
  sample.limits = async function(){ return { tools: false, images: false }; };
  sample.json = async function(input, opts){ const r = await sample(input, opts); return JSON.parse(r.text); };
  window.claude = { use: async function(name){ return name === "sample" ? sample : null; } };
})();
