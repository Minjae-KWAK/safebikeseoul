import "server-only";

type RouteMode = "BIKE_ONLY" | "SHORTEST";
type KakaoRoute = {
  status?: string;
  route?: {
    properties?: { totalDistance?: number; totalTime?: number };
    legs?: { steps?: { path?: { points?: number[][] } }[] }[];
  };
};

function inSeoul(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= 37.3 && latitude <= 37.75 && longitude >= 126.65 && longitude <= 127.25;
}

async function fetchRoute(key: string, mode: RouteMode, origin: { latitude: number; longitude: number }, destination: { latitude: number; longitude: number }) {
  const url = new URL("https://dapi.kakao.com/v2/routing/bicycle");
  url.searchParams.set("start_x", String(origin.longitude));
  url.searchParams.set("start_y", String(origin.latitude));
  url.searchParams.set("end_x", String(destination.longitude));
  url.searchParams.set("end_y", String(destination.latitude));
  url.searchParams.set("input_coord", "WGS84");
  url.searchParams.set("output_coord", "WGS84");
  url.searchParams.set("route_mode", mode);

  const response = await fetch(url, { headers: { Authorization: `KakaoAK ${key}` }, signal: AbortSignal.timeout(12000), cache: "no-store" });
  if (!response.ok) {
    const reason = response.status === 401 || response.status === 403 ? "카카오 자전거 경로 API 사용 권한이 없거나 REST 키가 유효하지 않습니다." : response.status === 429 ? "카카오 API 호출 한도를 초과했습니다." : `카카오 API 요청이 실패했습니다. (HTTP ${response.status})`;
    throw new Error(reason);
  }
  const data = await response.json() as KakaoRoute;
  if (data.status !== "OK") {
    const reasons: Record<string, string> = {
      SAME_POINT: "출발지와 목적지가 같습니다.", START_LINK_NOT_FOUND: "대여소 주변의 자전거 경로를 찾지 못했습니다.",
      END_LINK_NOT_FOUND: "목적지 주변의 자전거 경로를 찾지 못했습니다.", TOO_FAR_AWAY: "출발지와 목적지가 너무 멉니다.",
      TOO_MANY_SEARCH_LINK: "탐색 범위를 초과했습니다.", ROUTE_RESULT_NOT_FOUND: "해당 조건의 자전거 경로가 없습니다.",
    };
    throw new Error(reasons[data.status ?? ""] ?? `카카오 경로 탐색에 실패했습니다. (${data.status ?? "응답 오류"})`);
  }
  const properties = data.route?.properties;
  const points = data.route?.legs?.flatMap((leg) => leg.steps?.flatMap((step) => step.path?.points ?? []) ?? []) ?? [];
  if (!Number.isFinite(properties?.totalDistance) || !Number.isFinite(properties?.totalTime) || points.length < 2 ||
      points.some((point) => !Array.isArray(point) || point.length < 2 || !inSeoul(point[1], point[0]))) {
    throw new Error("카카오 API가 유효한 경로 좌표를 반환하지 않았습니다.");
  }
  return { mode, distanceMeters: properties!.totalDistance!, durationSeconds: properties!.totalTime!, points: points.map(([longitude, latitude]) => ({ latitude, longitude })) };
}

export async function POST(request: Request) {
  const key = process.env.KAKAO_REST_API_KEY;
  if (!key) return Response.json({ error: "카카오 REST 키가 설정되지 않았습니다." }, { status: 503 });
  let body: { origin?: { latitude?: number; longitude?: number }; destination?: { latitude?: number; longitude?: number } };
  try { body = await request.json(); } catch { return Response.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 }); }
  const origin = body?.origin;
  const destination = body?.destination;
  if (!origin || !destination || !inSeoul(origin.latitude!, origin.longitude!) || !inSeoul(destination.latitude!, destination.longitude!)) {
    return Response.json({ error: "서울 내 출발지와 목적지 좌표를 확인해 주세요." }, { status: 400 });
  }
  try {
    const [bikeRoad, shortest] = await Promise.all([
      fetchRoute(key, "BIKE_ONLY", origin as { latitude: number; longitude: number }, destination as { latitude: number; longitude: number }),
      fetchRoute(key, "SHORTEST", origin as { latitude: number; longitude: number }, destination as { latitude: number; longitude: number }),
    ]);
    return Response.json({ source: "카카오맵 자전거 경로 API", isSample: false, fetchedAt: new Date().toISOString(), bikeRoad, shortest }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "자전거 경로를 가져오지 못했습니다.";
    return Response.json({ error: message }, { status: 502 });
  }
}
