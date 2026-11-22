import "server-only";

type SeoulStation = {
  stationId?: string;
  stationName?: string;
  stationLatitude?: string;
  stationLongitude?: string;
  parkingBikeTotCnt?: string;
};

type BikePayload = {
  rentBikeStatus?: { row?: SeoulStation[]; list_total_count?: number; RESULT?: { CODE?: string } };
};

async function fetchPage(key: string, first: number, last: number): Promise<BikePayload> {
  const response = await fetch(`http://openapi.seoul.go.kr:8088/${encodeURIComponent(key)}/json/bikeList/${first}/${last}/`, {
    signal: AbortSignal.timeout(8000), cache: "no-store",
  });
  if (!response.ok) throw new Error("upstream request failed");
  const payload = await response.json() as BikePayload;
  if (payload.rentBikeStatus?.RESULT?.CODE !== "INFO-000" || !Array.isArray(payload.rentBikeStatus.row)) {
    throw new Error("invalid upstream response");
  }
  return payload;
}

export async function GET() {
  const key = process.env.SEOUL_API_KEY;
  if (!key) return Response.json({ error: "서울시 API 키가 설정되지 않았습니다." }, { status: 503 });

  try {
    const rows: SeoulStation[] = [];
    for (let first = 1; first <= 10000; first += 1000) {
      const page = await fetchPage(key, first, first + 999);
      const pageRows = page.rentBikeStatus?.row ?? [];
      rows.push(...pageRows);
      if (pageRows.length < 1000) break;
    }
    if (rows.length === 0 || rows.length >= 10000) throw new Error("unexpected station count");
    return Response.json({ source: "서울 열린데이터광장", isSample: false, fetchedAt: new Date().toISOString(), stations: rows.map((row) => ({
      id: row.stationId ?? "", name: row.stationName ?? "", latitude: Number(row.stationLatitude),
      longitude: Number(row.stationLongitude), availableBikes: Number(row.parkingBikeTotCnt),
    })).filter((row) => row.id && Number.isFinite(row.latitude) && Number.isFinite(row.longitude) && Number.isFinite(row.availableBikes)) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "대여소 정보를 가져오지 못했습니다." }, { status: 502 });
  }
}
