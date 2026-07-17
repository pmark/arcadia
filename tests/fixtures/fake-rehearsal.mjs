#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const input = path.resolve(process.argv.at(-1));
const stem = path.parse(input).name;
const collected = path.join(path.dirname(input), "rehearsal-out", stem, "fixture", "001", "collected");
mkdirSync(collected, { recursive: true });
writeFileSync(path.join(collected, "01 - 3m50s.mp3"), "fixture mp3 one");
writeFileSync(path.join(collected, "02 - Working Song.mp3"), "fixture mp3 two");
writeFileSync(path.join(collected, "03 - 6m19s.mp3"), "fixture mp3 three");
process.stdout.write("--- rehearsal pipeline ---\n");
process.stdout.write(`collected: 3 files → ${collected}\n`);
