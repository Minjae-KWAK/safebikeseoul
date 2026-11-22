import { chromium } from "playwright-core";

const browser = await chromium.launch({ executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const base = "http://localhost:3000";
const results = [];
const json = (value) => ({ contentType: "application/json", body: JSON.stringify(value) });

try {
  const authPage = await browser.newPage();
  await authPage.route("**/api/stations", (route) => route.fulfill({ status: 503, ...json({ error: "서울시 API 키가 설정되지 않았습니다." }) }));
  await authPage.route("**/api/accidents", (route) => route.fulfill({ status: 503, ...json({ error: "공공데이터포털 API 키가 설정되지 않았습니다." }) }));
  await authPage.route("**/api/weather?**", (route) => route.fulfill({ status: 503, ...json({ error: "공공데이터포털 API 키가 설정되지 않았습니다." }) }));
  await authPage.goto(base);
  await authPage.getByText("대여소 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.").waitFor();
  await authPage.getByText("공공데이터포털 사고 이력을 가져오지 못했습니다.").waitFor();
  await authPage.getByText("기상청 단기예보를 가져오지 못했습니다.").waitFor();
  if (await authPage.locator(".station-button").count()) throw new Error("station fallback contained fake data");
  results.push("authentication failure UI");
  await authPage.close();

  const emptyPage = await browser.newPage();
  await emptyPage.route("**/api/stations", (route) => route.fulfill({ status: 200, ...json({ stations: [], fetchedAt: new Date().toISOString(), isSample: false }) }));
  await emptyPage.route("**/api/accidents", (route) => route.fulfill({ status: 200, ...json({ accidents: [], referenceYear: 2025, historical: true, isSample: false }) }));
  await emptyPage.goto(base);
  await emptyPage.getByText("조회된 따릉이 대여소가 없습니다.").waitFor();
  await emptyPage.getByText("해당 기준연도의 사고다발지역 데이터가 없습니다.").waitFor();
  if (await emptyPage.locator(".station-button").count()) throw new Error("empty station response contained fake data");
  results.push("empty data UI");
  await emptyPage.close();

  const routePage = await browser.newPage();
  await routePage.route("**/api/routes/bicycle", (route) => route.fulfill({ status: 503, ...json({ error: "카카오 REST 키가 설정되지 않았습니다." }) }));
  await routePage.goto(base);
  await routePage.locator(".station-button").first().waitFor({ timeout: 30000 });
  await routePage.locator(".station-button").first().click();
  await routePage.getByRole("button", { name: /선택한 대여소에서 경로 조회/ }).click();
  await routePage.getByText("카카오 REST 키가 설정되지 않았습니다.").waitFor();
  if (await routePage.locator(".route-comparison").count()) throw new Error("authentication failure displayed a route");
  results.push("route authentication failure UI");
  await routePage.close();

  console.log(JSON.stringify({ ok: true, scenarios: results }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error.message, scenarios: results }));
  process.exitCode = 1;
} finally {
  await browser.close();
}
