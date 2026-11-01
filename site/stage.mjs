#!/usr/bin/env node
// Stage the blog source: copies site/ plus approved dated docs/articles/*.md posts into
// <outDir>, normalising each post for Jekyll. Never modifies docs/articles/.
// Usage: node site/stage.mjs <outDir>
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(siteDir, "..");
const articlesDir = path.join(repoRoot, "docs", "articles");
if (!process.argv[2]) throw new Error("usage: node site/stage.mjs <outDir>");
const outDir = path.resolve(process.argv[2]);

const REPO = "https://github.com/pmark/arcadia";
const RAW = "https://raw.githubusercontent.com/pmark/arcadia/main";
const POST = /^(\d{4}-\d{2}-\d{2})-(.+)\.md$/;

rmSync(outDir, { recursive: true, force: true });
mkdirSync(path.join(outDir, "_posts"), { recursive: true });
cpSync(siteDir, outDir, { recursive: true });

// Defensive privacy sanitising: agent e-mail addresses, local home paths and
// tailnet hosts must never reach the public site.
function sanitize(text) {
  return text
    .replace(/\s*<[^<>\s@]+@[^<>\s]+>/g, "")
    .replace(/[\w.+-]+@agents\.arcadia\.local/g, "")
    .replace(/\/Users\/[^\s)"'`]*/g, "[local path]")
    .replace(/[\w.-]+\.ts\.net/g, "[tailnet host]");
}

// Relative links would 404 on the site: point sibling posts at their post page,
// copy referenced images into the build, and send other files to the repo on main.
function rewriteLinks(body, dir) {
  let fenced = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (m, bang, label, target) => {
        if (/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(target)) return m; // absolute, anchor, root-absolute, //host
        const [file, hash = ""] = target.split(/(?=#)/);
        const sibling = POST.exec(file);
        if (!bang && sibling) return `[${label}](../${sibling[2]}/${hash})`;
        const repoPath = path.posix.normalize(path.posix.join(dir, file));
        if (repoPath.startsWith("..")) return m;
        if (bang) {
          const src = path.join(repoRoot, repoPath);
          if (existsSync(src)) {
            const name = repoPath.replace(/[^\w.-]+/g, "-");
            mkdirSync(path.join(outDir, "assets", "articles"), { recursive: true });
            cpSync(src, path.join(outDir, "assets", "articles", name));
            return `![${label}](../../assets/articles/${name})`;
          }
          return `![${label}](${RAW}/${repoPath})`;
        }
        return `[${label}](${REPO}/blob/main/${repoPath}${hash})`;
      });
    })
    .join("\n");
}

// Decision 0120 gate: only an approved Field Note whose claims receipt records an
// independent PASS is published. Anything else (draft, reviewed, withdrawn, no
// receipt) is skipped, so setting `status: withdrawn` and merging unpublishes.
function field(front, key) {
  const all = [...front.matchAll(new RegExp(`^${key}:\\s*(.*)$`, "gm"))];
  if (all.length > 1) return "<duplicate>"; // fail closed: YAML would take the last
  return all.length ? all[0][1].trim().replace(/^["']|["']$/g, "") : "";
}
// The verdict counts only inside "## Independent review", and the last one wins.
function reviewVerdict(receiptText) {
  const lines = receiptText.replace(/\r\n/g, "\n").split("\n");
  const start = lines.indexOf("## Independent review");
  if (start < 0) return "";
  let verdict = "";
  for (const line of lines.slice(start + 1)) {
    if (/^## /.test(line)) break;
    const m = /^- Verdict:\s*(.*?)\s*$/.exec(line);
    if (m) verdict = m[1];
  }
  return verdict;
}
function publicationRefusal(name, front) {
  if (field(front, "status") !== "approved") return `status is "${field(front, "status") || "missing"}", not approved`;
  if (!/^(ship|essay)$/.test(field(front, "type"))) return "type is not ship or essay";
  if (field(front, "channels").replace(/\s+/g, "") !== "[site,rss]") return "channels are not exactly [site, rss]";
  if (field(front, "not_done") !== "true") return "not_done is not true";
  const receipt = field(front, "claims_receipt");
  if (!/^docs\/articles\/receipts\/[\w.-]+\.md$/.test(receipt)) return "no claims receipt path";
  const receiptPath = path.join(repoRoot, receipt);
  if (!existsSync(receiptPath)) return `receipt ${receipt} is missing`;
  if (reviewVerdict(readFileSync(receiptPath, "utf8")) !== "PASS") return "receipt's Independent review records no final PASS";
  return "";
}

const skipped = [];
let count = 0;
for (const name of readdirSync(articlesDir).sort()) {
  if (!POST.test(name)) continue; // README.md, templates/ and receipts/ are not posts
  let text = readFileSync(path.join(articlesDir, name), "utf8").replace(/\r\n/g, "\n");
  text = sanitize(text);
  let front = "";
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fm) {
    front = fm[1];
    text = text.slice(fm[0].length);
  }
  const why = publicationRefusal(name, front);
  if (why) {
    skipped.push(`${name}: ${why}`);
    continue;
  }
  const h1 = /^# +(.+)$/m.exec(text);
  if (!/^title:/m.test(front)) {
    const title = (h1 ? h1[1] : name.replace(POST, "$2")).replace(/[\\"]/g, (c) => "\\" + c);
    front = `title: "${title}"\n${front}`;
  }
  if (h1) text = text.replace(h1[0] + "\n", ""); // the layout renders the title
  const body = rewriteLinks(text, "docs/articles");
  if (body.includes("{% endraw %}")) throw new Error(`${name}: contains an endraw tag`);
  writeFileSync(
    path.join(outDir, "_posts", name),
    `---\n${front}\n---\n{% raw %}\n${body}\n{% endraw %}\n`,
  );
  count++;
}
for (const line of skipped) console.log(`not published: ${line}`);
console.log(`staged ${count} posts into ${outDir}`);
