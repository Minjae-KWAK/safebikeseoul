import "server-only";
import { toKmaGrid } from "../../../lib/kma-grid";

type ForecastItem = { baseDate: string; baseTime: string; fcstDate: string; fcstTime: string; category: string; fcstValue: string };
type WeatherPayload = { response?: { header?: { resultCode?: string }; body?: { items?: { item?: ForecastItem[] } } } };

function kstTime(date: string, time: string) {
  return new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00+09:00`);
}

function latestBase(now: Date) {
  // Allow 20 minutes for the newest 3-hourly publication to become available.
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000 - 20 * 60 * 1000);
  const hour = kst.getUTCHours();
  const hours = [2, 5, 8, 11, 14, 17, 20, 23];
  const baseHour = [...hours].reverse().find((candidate) => candidate <= hour);
  if (baseHour === undefined) kst.setUTCDate(kst.getUTCDate() - 1);
  const date = `${kst.getUTCFullYear()}${String(kst.getUTCMonth() + 1).padStart(2, "0")}${String(kst.getUTCDate()).padStart(2, "0")}`;
  return { date, time: `${String(baseHour ?? 23).padStart(2, "0")}00` };
}

export async function GET(request: Request) {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) return Response.json({ error: "공공데이터포털 API 키가 설정되지 않았습니다." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const latitude = Number(params.get("latitude"));
  const longitude = Number(params.get("longitude"));
  if (!params.has("latitude") || !params.has("longitude") || !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < 37.3 || latitude > 37.75 || longitude < 126.65 || longitude > 127.25) {
    return Response.json({ error: "서울 내 출발지 좌표를 확인해 주세요." }, { status: 400 });
  }
  const grid = toKmaGrid(latitude, longitude);
  const base = latestBase(new Date());

  try {
    const url = new URL("https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst");
    url.searchParams.set("serviceKey", key);
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("numOfRows", "500");
    url.searchParams.set("dataType", "JSON");
    url.searchParams.set("base_date", base.date);
    url.searchParams.set("base_time", base.time);
    url.searchParams.set("nx", String(grid.nx));
    url.searchParams.set("ny", String(grid.ny));
    const response = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    if (!response.ok) throw new Error("upstream request failed");
    const payload = await response.json() as WeatherPayload;
    if (payload.response?.header?.resultCode !== "00") throw new Error("upstream returned an error");
    const items = payload.response.body?.items?.item;
    if (!Array.isArray(items)) throw new Error("forecast is missing");
    const slots = new Map<string, { TMP?: number; POP?: number }>();
    for (const item of items) {
      if (item.category !== "TMP" && item.category !== "POP") continue;
      const value = Number(item.fcstValue);
      if (!Number.isFinite(value)) continue;
      const slot = `${item.fcstDate}${item.fcstTime}`;
      const values = slots.get(slot) ?? {};
      values[item.category] = value;
      slots.set(slot, values);
    }
    const now = Date.now();
    const forecast = [...slots.entries()].filter(([slot, values]) => values.TMP !== undefined && values.POP !== undefined && kstTime(slot.slice(0, 8), slot.slice(8)).getTime() >= now)
      .sort(([a], [b]) => a.localeCompare(b))[0];
    if (!forecast || forecast[1].POP! < 0 || forecast[1].POP! > 100) throw new Error("forecast values are missing");
    const [slot, values] = forecast;
    const publication = items.find((item) => item.baseDate && item.baseTime);
    if (!publication) throw new Error("publication time is missing");
    return Response.json({ source: "기상청 단기예보", isSample: false, kind: "forecast", grid,
      location: { latitude, longitude }, temperatureC: values.TMP, precipitationProbability: values.POP,
      publishedAt: kstTime(publication.baseDate, publication.baseTime).toISOString(), forecastAt: kstTime(slot.slice(0, 8), slot.slice(8)).toISOString() },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "기상청 단기예보를 가져오지 못했습니다." }, { status: 502 });
  }
}
