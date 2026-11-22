import "server-only";

type Place = { id?: string; place_name?: string; address_name?: string; x?: string; y?: string };

export async function GET(request: Request) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return Response.json({ error: "카카오 REST API 키가 설정되지 않았습니다." }, { status: 503 });
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (query.length < 2 || query.length > 80) return Response.json({ error: "검색어는 2~80자로 입력해 주세요." }, { status: 400 });

  try {
    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", query);
    url.searchParams.set("size", "10");
    const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(8000), cache: "no-store" });
    if (!response.ok) throw new Error("upstream request failed");
    const payload = await response.json() as { documents?: Place[] };
    if (!Array.isArray(payload.documents)) throw new Error("invalid upstream response");
    return Response.json({ source: "카카오 로컬", isSample: false, places: payload.documents.map((place) => ({
      id: place.id ?? "", name: place.place_name ?? "", address: place.address_name ?? "",
      latitude: Number(place.y), longitude: Number(place.x),
    })).filter((place) => Number.isFinite(place.latitude) && Number.isFinite(place.longitude)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "장소 검색에 실패했습니다." }, { status: 502 });
  }
}
