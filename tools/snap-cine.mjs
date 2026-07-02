// Screenshot a cinematic shot + lighting:
//   node tools/snap-cine.mjs out.png hero '{"sunElevation":8,"sunWarmth":0.7}' '{"floor":8}'
import puppeteer from "puppeteer-core";

const out = process.argv[2] ?? "shot.png";
const shot = process.argv[3] ?? "hero";
const envOv = JSON.parse(process.argv[4] ?? "{}");
const paramOv = JSON.parse(process.argv[5] ?? "{}");

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: "shell",
  args: ["--enable-unsafe-swiftshader", "--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
page.on("console", m => { if (m.type() === "error") console.log("[err]", m.text()); });
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction("!document.getElementById('loading')", { timeout: 60000 });
if (Object.keys(paramOv).length) await page.evaluate(p => window.__setParams(p), paramOv);
if (Object.keys(envOv).length) await page.evaluate(e => window.__setEnv(e), envOv);
await page.evaluate(s => window.__shot(s), shot);
await new Promise(r => setTimeout(r, 3500));
await page.screenshot({ path: out });
await browser.close();
console.log("SNAP_OK", out);
