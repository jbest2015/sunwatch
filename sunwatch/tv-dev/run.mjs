// node run.mjs URL waitMs evalFile.js [shot.png]
// Loads URL on the real GPU, evaluates the file body (async) in the page, or in its first iframe when the file starts with //frame, and prints JSON.
import { chromium } from "playwright";
import fs from "node:fs";
const [url, wait, file, shot] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chromium", args: ["--use-angle=gl-egl", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const logs = [];
p.on("pageerror", (e) => logs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error" || /\[hearth\]/.test(m.text())) logs.push("console: " + m.text().slice(0, 200)); });
await p.goto(url);
await p.waitForTimeout(+wait);
const src = file && file !== "-" ? fs.readFileSync(file, "utf8") : "return 0";
const target = src.startsWith("//frame") ? p.frames().find((f) => f !== p.mainFrame()) : p;
const out = await target.evaluate("(async () => { " + src + " })()").catch((e) => "EVAL ERROR " + e.message);
console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
if (shot) await p.screenshot({ path: shot, timeout: 90000 });
console.log(logs.filter((l) => !/404/.test(l)).slice(0, 10).join("\n"));
await b.close();
