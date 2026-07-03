// Capture a debug-isolation screenshot:
//   node tools/snap-debug.mjs out.png <off|albedo|normals|uniform> '[px,py,pz,tx,ty,tz]'
import puppeteer from "puppeteer-core";

const out = process.argv[2];
const mode = process.argv[3] ?? "off";
const cam = process.argv[4] ? JSON.parse(process.argv[4]) : null;

const browser = await puppeteer.launch({
  executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  headless: "shell",
  args: ["--enable-unsafe-swiftshader", "--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000 },
});
const page = await browser.newPage();
page.on("pageerror", e => console.log("[pageerror]", e.message));
await page.goto("http://localhost:5173/", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction("!document.getElementById('loading')", { timeout: 60000 });
await page.evaluate(m => window.__debug(m), mode);
if (cam) await page.evaluate(c => window.__setCamera(...c), cam);
await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: out });
await browser.close();
console.log("SNAP_OK", mode, out);
