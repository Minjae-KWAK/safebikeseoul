import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
const sdk = [];
const failures = [];
const consoleErrors = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().replace(/appkey=[^&\s]+/gi, "appkey=[key]").slice(0, 250)); });
page.on("response", (response) => { if (response.url().includes("dapi.kakao.com/v2/maps/sdk.js")) sdk.push(response.status()); });
page.on("requestfailed", (request) => { if (request.url().includes("dapi.kakao.com")) failures.push(request.failure()?.errorText ?? "failed"); });
await page.goto("http://localhost:3000", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(5000);
const state = await page.evaluate(() => ({ hasKakao: !!window.kakao, hasMaps: !!window.kakao?.maps, sdkTags: [...document.scripts].filter((script) => script.src.includes("dapi.kakao.com/v2/maps/sdk.js")).length, fallback: document.querySelector(".map-fallback")?.textContent?.trim() ?? "none", mapChildren: document.querySelector(".kakao-map")?.children.length ?? 0, devButtons: [...(document.querySelector("nextjs-portal")?.shadowRoot?.querySelectorAll("button") ?? [])].map((button) => ({ text: button.textContent?.trim().slice(0, 80), aria: button.getAttribute("aria-label") })) }));
const sdkUrl = await page.evaluate(() => [...document.scripts].find((script) => script.src.includes("dapi.kakao.com/v2/maps/sdk.js"))?.src);
let direct = null;
if (sdkUrl) {
  const response = await page.request.get(sdkUrl, { headers: { Referer: "http://localhost:3000/" } });
  const body = await response.json().catch(() => ({}));
  const publicKey = new URL(sdkUrl).searchParams.get("appkey") ?? "";
  direct = { status: response.status(), contentType: response.headers()["content-type"] ?? "none", code: body.code, message: String(body.msg ?? body.message ?? "").replaceAll(publicKey, "[key]") };
}
console.log(JSON.stringify({ sdk, failures, state, direct, consoleErrors }));
await browser.close();
