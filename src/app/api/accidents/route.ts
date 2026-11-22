import "server-only";

// Verified against all 25 Seoul districts on 2026-11-22: 2026 has no records; 2025 has 110.
const latestAvailableYear = 2025;
const districts = ["110", "140", "170", "200", "215", "230", "260", "290", "305", "320", "350", "380", "410", "440", "470", "500", "530", "545", "560", "590", "620", "650", "680", "710", "740"] as const;
type AccidentRow = { spot_nm?: string; la_crd?: number | string; lo_crd?: number | string; occrrnc_cnt?: number | string; caslt_cnt?: number | string };
type ApiPayload = { resultCode?: string; totalCount?: number; items?: { item?: AccidentRow[] | AccidentRow } };
type Accident = { id: string; name: string; latitude: number; longitude: number; occurrences: number; casualties: number; district: string };

const cache = new Map<string, { expires: number; accidents: Accident[] }>();

async function fetchDistrict(key: string, year: number, district: string): Promise<Accident[]> {
  const url = new URL("https://apis.data.go.kr/B552061/frequentzoneBicycle/getRestFrequentzoneBicycle");
  url.searchParams.set("ServiceKey", key);
  url.searchParams.set("searchYearCd", String(year));
  url.searchParams.set("siDo", "11");
  url.searchParams.set("guGun", district);
  url.searchParams.set("type", "json");
  url.searchParams.set("numOfRows", "100");
  url.searchParams.set("pageNo", "1");
  const response = await fetch(url, { signal: AbortSignal.timeout(10000), cache: "no-store" });
  if (!response.ok) throw new Error("upstream request failed");
  const payload = await response.json() as ApiPayload;
  if (payload.resultCode === "03") return []; // No records for this district and year.
  if (payload.resultCode !== "00") throw new Error("upstream returned an error");
  const items = payload.items?.item;
  const rows = Array.isArray(items) ? items : items ? [items] : [];
  if (Number(payload.totalCount) > rows.length) throw new Error("accident response was truncated");
  return rows.map((row, index) => ({
    id: `${year}-${district}-${index}`,
    name: row.spot_nm ?? "위치 정보 없음", district,
    latitude: Number(row.la_crd), longitude: Number(row.lo_crd),
    occurrences: Number(row.occrrnc_cnt), casualties: Number(row.caslt_cnt),
  })).filter((row) => Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && Number.isFinite(row.occurrences));
}

export async function GET(request: Request) {
  const key = process.env.DATA_GO_KR_API_KEY;
  if (!key) return Response.json({ error: "공공데이터포털 API 키가 설정되지 않았습니다." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const year = params.get("year") ?? String(latestAvailableYear);
  const district = params.get("district");
  if (!/^20\d{2}$/.test(year) || Number(year) > new Date().getFullYear() || (district !== null && !districts.some((code) => code === district))) {
    return Response.json({ error: "year 또는 district 값이 올바르지 않습니다." }, { status: 400 });
  }
  const cacheKey = `${year}:${district ?? "all"}`;
  try {
    const cached = cache.get(cacheKey);
    let accidents: Accident[];
    if (cached && cached.expires > Date.now()) {
      accidents = cached.accidents;
    } else {
      const selected = district ? [district] : [...districts];
      accidents = [];
      for (let index = 0; index < selected.length; index += 5) {
        const batch = await Promise.all(selected.slice(index, index + 5).map((code) => fetchDistrict(key, Number(year), code)));
        accidents.push(...batch.flat());
      }
      cache.set(cacheKey, { expires: Date.now() + 60 * 60 * 1000, accidents });
    }
    return Response.json({ source: "한국도로교통공단", isSample: false, historical: true,
      referenceYear: Number(year), latestAvailableYear, district: district ?? "서울 전체", accidents }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch {
    return Response.json({ error: "사고다발지역 정보를 가져오지 못했습니다." }, { status: 502 });
  }
}
