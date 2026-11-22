import { chromium } from "playwright-core";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseURL = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const executablePath = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const output = path.resolve("test-results");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const problems = [];
page.on("pageerror", () => problems.push("browser JavaScript error"));
page.on("console", (message) => { if (message.type() === "error") problems.push(message.text().replace(/appkey=[^&\s]+/gi, "appkey=[key]").slice(0, 200)); });

function check(condition, label) {
  if (!condition) throw new Error(label);
}

try {
  const response = await page.goto(baseURL, { waitUntil: "domcontentloaded", timeout: 20000 });
  check(response?.status() === 200, "home page response");
  await page.getByText("출발지 주변 따릉이").waitFor();
  await page.locator(".station-button").first().waitFor({ timeout: 30000 });
  await page.getByText("자전거 사고다발지역").waitFor();
  await page.getByText("2025년 기준").waitFor({ timeout: 30000 });
  await page.getByText("출발지 단기예보").waitFor();
  await page.locator(".weather-times").waitFor({ timeout: 30000 });

  const mapReady = await page.waitForFunction(() => !!window.kakao?.maps && !document.querySelector(".map-fallback") && (document.querySelector(".kakao-map")?.children.length ?? 0) > 0, null, { timeout: 20000 }).then(() => true).catch(() => false);
  check(mapReady, "Kakao map render");
  const stationCount = await page.locator(".station-button").count();
  check(stationCount === 6, "nearby station list");
  await page.locator(".station-button").first().click();
  await page.locator(".weather-times").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /선택한 대여소에서 경로 조회/ }).click();
  await page.locator(".route-comparison .compare-row").nth(2).waitFor({ timeout: 20000 });
  const comparison = await page.locator(".route-comparison").innerText();
  check(comparison.includes("자전거도로 우선") && comparison.includes("최단 경로") && comparison.includes("곳"), "route comparison");
  const nearbyAccidentText = await page.locator(".accident-summary").innerText();
  check(nearbyAccidentText.includes("200m 이내"), "route accident comparison");
  await page.screenshot({ path: path.join(output, "desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, "mobile.png"), fullPage: true });
  const mobile = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, mapWidth: document.querySelector(".map-card")?.getBoundingClientRect().width }));
  check(mobile.document <= mobile.viewport + 2, "mobile horizontal overflow");
  check((mobile.mapWidth ?? 0) > 300, "mobile map width");
  check(await page.locator(".route-comparison .compare-row").count() === 3, "mobile route comparison");

  await page.locator("#start").fill("경복궁");
  await page.locator(".suggestions button").first().click();
  await page.getByText("경복궁 기준 직선거리순").waitFor();
  check(await page.locator(".station-button").count() === 6, "station search after origin change");
  await page.locator(".weather-times").waitFor({ timeout: 20000 });

  const api = page.request;
  const [stations, accidents, places, weather] = await Promise.all([
    api.get(`${baseURL}/api/stations`), api.get(`${baseURL}/api/accidents`),
    api.get(`${baseURL}/api/places?q=서울시청`), api.get(`${baseURL}/api/weather?latitude=37.5663&longitude=126.9779`),
  ]);
  check([stations, accidents, places, weather].every((r) => r.status() === 200), "real API responses");
  const stationData = await stations.json();
  const accidentData = await accidents.json();
  const placeData = await places.json();
  const weatherData = await weather.json();
  check(stationData.stations.length > 1000 && accidentData.accidents.length > 0 && placeData.places.length > 0, "real API data");
  check(weatherData.publishedAt !== weatherData.forecastAt, "forecast timestamps");
  check((await api.get(`${baseURL}/api/weather?latitude=0&longitude=0`)).status() === 400, "invalid weather coordinates");
  check((await api.get(`${baseURL}/api/places?q=a`)).status() === 400, "invalid place search");
  check((await api.post(`${baseURL}/api/routes/bicycle`, { data: {} })).status() === 400, "invalid route request");

  const devButtons = await page.evaluate(() => [...(document.querySelector("nextjs-portal")?.shadowRoot?.querySelectorAll("button") ?? [])].map((button) => ({ text: button.textContent?.trim().slice(0, 50), aria: button.getAttribute("aria-label") })));
  console.log(JSON.stringify({ ok: true, mapReady, stationCount: stationData.stations.length, accidentCount: accidentData.accidents.length, weatherGrid: weatherData.grid, mobile, problems, devButtons, screenshots: ["test-results/desktop.png", "test-results/mobile.png"] }));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  console.error(JSON.stringify({ ok: false, error: error.message, problems }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
