// Summarize per-request prompt tokens (input + cache_creation + cache_read) from stream-json runs.
const fs = require("fs");
const rows = [];
for (const f of fs.readdirSync(require("path").join(__dirname, "raw")).filter((n) => /^out-.*\.jsonl$/.test(n)).sort()) {
  const ev = fs.readFileSync(require("path").join(__dirname, "raw", f), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const seen = new Set(), turns = [];
  let version = null, model = null, cost = null, tools = 0, hookEvents = [];
  for (const e of ev) {
    if (e.type === "system" && e.subtype === "init") { version = e.claude_code_version; model = e.model; }
    if (e.type === "system" && /hook/.test(e.subtype || "")) hookEvents.push(e.subtype + ":" + (e.hook_event || e.hook_name || ""));
    if (e.type === "assistant" && !seen.has(e.message.id)) {
      seen.add(e.message.id);
      const u = e.message.usage;
      turns.push({ prompt: u.input_tokens + u.cache_creation_input_tokens + u.cache_read_input_tokens, out: u.output_tokens });
    }
    if (e.type === "assistant") tools += e.message.content.filter((c) => c.type === "tool_use").length;
    if (e.type === "result") cost = e.total_cost_usd;
  }
  const t1 = turns[0]?.prompt, t2 = turns[1]?.prompt;
  rows.push({ run: f.replace(/^out-|\.jsonl$/g, ""), version, model, toolUses: tools, turn1Prompt: t1, turn2Prompt: t2,
    turn2Growth: t2 - t1, turn1Out: turns[0]?.out, costUsd: cost, hookSystemEvents: hookEvents.length });
}
console.log(JSON.stringify(rows, null, 1));
