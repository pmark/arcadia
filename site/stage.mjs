#!/usr/bin/env node
// Stage the blog source: copies site/ plus dated docs/articles/*.md posts into
// <outDir>, normalising each post for Jekyll. Never modifies docs/articles/.
// Usage: node site/stage.mjs <outDir>
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

// Relative links would 404 on the site: point sibling posts at their post page
// and everything else at the repository file on main.
function rewriteLinks(body, dir) {
  let fenced = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/(!?)\]\((?!https?:|mailto:|#)([^)\s]+)\)/g, (m, bang, target) => {
        const [file, hash = ""] = target.split(/(?=#)/);
        const sibling = POST.exec(file);
        if (!bang && sibling) return `](../${sibling[2]}/${hash})`;
        const repoPath = path.posix.normalize(path.posix.join(dir, file));
        if (repoPath.startsWith("..")) return m;
        return `](${bang ? RAW : `${REPO}/blob/main`}/${repoPath}${hash})`;
      });
    })
    .join("\n");
}

let count = 0;
for (const name of readdirSync(articlesDir).sort()) {
  if (!POST.test(name)) continue; // README.md, templates/ and receipts/ are not posts
  let text = readFileSync(path.join(articlesDir, name), "utf8").replace(/\r\n/g, "\n");
  let front = "";
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (fm) {
    front = fm[1];
    text = text.slice(fm[0].length);
  }
  const h1 = /^# +(.+)$/m.exec(text);
  if (!/^title:/m.test(front)) {
    const title = (h1 ? h1[1] : name.replace(POST, "$2")).replace(/"/g, '\\"');
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
console.log(`staged ${count} posts into ${outDir}`);
