"use client";

import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./dashboard.css";
import "./stations.css";
import "./routes.css";
import "./accidents.css";
import "./weather.css";
import "./integration.css";

type Point = { name: string; lat: number; lng: number };
type Station = { id: string; name: string; latitude: number; longitude: number; availableBikes: number };
type StationResponse = { stations: Station[]; fetchedAt: string; isSample: false };
type BicycleRoute = { mode: "BIKE_ONLY" | "SHORTEST"; distanceMeters: number; durationSeconds: number; points: { latitude: number; longitude: number }[] };
type BicycleRoutes = { bikeRoad: BicycleRoute; shortest: BicycleRoute; fetchedAt: string; isSample: false };
type AccidentArea = { id: string; name: string; latitude: number; longitude: number; occurrences: number; casualties: number; district: string };
type AccidentResponse = { accidents: AccidentArea[]; referenceYear: number; historical: true; isSample: false };
type WeatherForecast = { temperatureC: number; precipitationProbability: number; publishedAt: string; forecastAt: string; grid: { nx: number; ny: number }; kind: "forecast"; isSample: false };
type KakaoMap = { setBounds: (bounds: unknown) => void; setCenter: (point: unknown) => void };
type KakaoMarker = { setMap: (map: KakaoMap | null) => void };
type KakaoMaps = {
  load: (callback: () => void) => void;
  LatLng: new (lat: number, lng: number) => unknown;
  LatLngBounds: new () => { extend: (point: unknown) => void };
  Map: new (element: HTMLElement, options: object) => KakaoMap;
  Marker: new (options: object) => KakaoMarker;
  MarkerClusterer: new (options: object) => { addMarkers: (markers: KakaoMarker[]) => void };
  CustomOverlay: new (options: object) => unknown;
  Circle: new (options: object) => unknown;
  Polyline: new (options: object) => unknown;
  InfoWindow: new (options: object) => { open: (map: KakaoMap, marker: KakaoMarker) => void; close: () => void; setContent: (content: HTMLElement) => void };
  event: { addListener: (target: unknown, event: string, listener: () => void) => void };
};
declare global { interface Window { kakao?: { maps: KakaoMaps } } }

const places: Point[] = [
  { name: "서울시청", lat: 37.5663, lng: 126.9779 },
  { name: "광화문광장", lat: 37.5729, lng: 126.9768 },
  { name: "경복궁", lat: 37.5796, lng: 126.9770 },
  { name: "종각역", lat: 37.5701, lng: 126.9830 },
  { name: "청계광장", lat: 37.5685, lng: 126.9786 },
  { name: "덕수궁", lat: 37.5658, lng: 126.9751 },
  { name: "명동역", lat: 37.5609, lng: 126.9859 },
];
const key = process.env.NEXT_PUBLIC_KAKAO_JS_KEY;
const kakaoKeyFormatValid = /^[0-9a-f]{32}$/i.test(key ?? "");

function distanceMeters(a: { lat: number; lng: number }, b: { latitude: number; longitude: number }) {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.lat) * rad;
  const dLng = (b.longitude - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)}m` : `${(meters / 1000).toFixed(1)}km`;
}

function formatKst(iso: string) {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

function distanceToRoute(area: AccidentArea, points: BicycleRoute["points"]) {
  if (!points.length) return Infinity;
  const metersPerDegreeLat = 111_195;
  const metersPerDegreeLng = metersPerDegreeLat * Math.cos(area.latitude * Math.PI / 180);
  const xy = (point: { latitude: number; longitude: number }) => ({
    x: (point.longitude - area.longitude) * metersPerDegreeLng,
    y: (point.latitude - area.latitude) * metersPerDegreeLat,
  });
  let closest = Infinity;
  for (let index = 1; index < points.length; index++) {
    const a = xy(points[index - 1]);
    const b = xy(points[index]);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared ? Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / lengthSquared)) : 0;
    closest = Math.min(closest, Math.hypot(a.x + t * dx, a.y + t * dy));
  }
  return closest;
}

export default function Home() {
  const mapElement = useRef<HTMLDivElement>(null);
  const mapRef = useRef<KakaoMap | null>(null);
  const routeRequestId = useRef(0);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">(key ? "loading" : "error");
  const [startQuery, setStartQuery] = useState("서울시청");
  const [endQuery, setEndQuery] = useState("광화문광장");
  const [start, setStart] = useState<Point>(places[0]);
  const [end, setEnd] = useState<Point>(places[1]);
  const [activeField, setActiveField] = useState<"start" | "end" | null>(null);
  const [routeShown, setRouteShown] = useState(true);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [routes, setRoutes] = useState<BicycleRoutes | null>(null);
  const [routeStatus, setRouteStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [routeError, setRouteError] = useState("");
  const [message, setMessage] = useState("");
  const [stations, setStations] = useState<Station[]>([]);
  const [stationsStatus, setStationsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [fetchedAt, setFetchedAt] = useState("");
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [accidents, setAccidents] = useState<AccidentArea[]>([]);
  const [accidentYear, setAccidentYear] = useState<number | null>(null);
  const [accidentStatus, setAccidentStatus] = useState<"loading" | "ready" | "error">("loading");
  const [weather, setWeather] = useState<WeatherForecast | null>(null);
  const [weatherStatus, setWeatherStatus] = useState<"loading" | "ready" | "error">("loading");
  const weatherOrigin = selectedStation ? { latitude: selectedStation.latitude, longitude: selectedStation.longitude } : { latitude: start.lat, longitude: start.lng };
  const weatherLocationName = selectedStation?.name ?? start.name;

  useEffect(() => {
    const controller = new AbortController();
    async function loadWeather() {
      setWeather(null);
      setWeatherStatus("loading");
      try {
        const url = `/api/weather?latitude=${weatherOrigin.latitude}&longitude=${weatherOrigin.longitude}`;
        const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("weather request failed");
        const payload = await response.json() as WeatherForecast;
        if (payload.kind !== "forecast" || !Number.isFinite(payload.temperatureC) || !Number.isFinite(payload.precipitationProbability)) throw new Error("invalid weather response");
        setWeather(payload);
        setWeatherStatus("ready");
      } catch {
        if (!controller.signal.aborted) setWeatherStatus("error");
      }
    }
    loadWeather();
    return () => controller.abort();
  }, [weatherOrigin.latitude, weatherOrigin.longitude]);

  useEffect(() => {
    const controller = new AbortController();
    async function loadAccidents() {
      try {
        const response = await fetch("/api/accidents", { signal: controller.signal });
        if (!response.ok) throw new Error("accident request failed");
        const payload = await response.json() as AccidentResponse;
        if (!Array.isArray(payload.accidents) || !payload.historical) throw new Error("invalid accident response");
        setAccidents(payload.accidents);
        setAccidentYear(payload.referenceYear);
        setAccidentStatus("ready");
      } catch {
        if (!controller.signal.aborted) setAccidentStatus("error");
      }
    }
    loadAccidents();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function loadStations() {
      setStationsStatus("loading");
      try {
        const response = await fetch("/api/stations", { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("station request failed");
        const payload = await response.json() as StationResponse;
        if (!Array.isArray(payload.stations)) throw new Error("invalid station response");
        setStations(payload.stations);
        setFetchedAt(payload.fetchedAt);
        setStationsStatus("ready");
      } catch {
        if (!controller.signal.aborted) { setStations([]); setStationsStatus("error"); }
      }
    }
    loadStations();
    return () => controller.abort();
  }, [refreshIndex]);

  const nearby = useMemo(() => stations.map((station) => ({ ...station, distance: distanceMeters(start, station) }))
    .sort((a, b) => a.distance - b.distance).slice(0, 6), [stations, start]);
  const accidentDistances = useMemo(() => routes ? accidents.map((area) => ({ ...area,
    distance: Math.min(distanceToRoute(area, routes.bikeRoad.points), distanceToRoute(area, routes.shortest.points)),
  })).sort((a, b) => a.distance - b.distance) : [], [accidents, routes]);
  const routeAccidents = accidentDistances.slice(0, 5);
  const closeAccidentIds = useMemo(() => new Set(accidentDistances.filter((area) => area.distance <= 200).map((area) => area.id)), [accidentDistances]);
  const routeComparison = useMemo(() => routes && accidentStatus === "ready" ? [
    { nearbyCount: accidents.filter((area) => distanceToRoute(area, routes.bikeRoad.points) <= 200).length },
    { nearbyCount: accidents.filter((area) => distanceToRoute(area, routes.shortest.points) <= 200).length },
  ] : null, [routes, accidents, accidentStatus]);

  const drawMap = useCallback(() => {
    const maps = window.kakao?.maps;
    if (!maps || !mapElement.current) return;
    maps.load(() => {
      if (!mapElement.current) return;
      const coords = (p: { lat: number; lng: number }) => new maps.LatLng(p.lat, p.lng);
      const map = new maps.Map(mapElement.current, { center: coords(start), level: 5 });
      mapRef.current = map;
      const bounds = new maps.LatLngBounds();
      [selectedStation ? { lat: selectedStation.latitude, lng: selectedStation.longitude } : start, end].forEach((point) => bounds.extend(coords(point)));
      if (routes) [routes.bikeRoad, routes.shortest].forEach((route) => route.points.forEach((point) => bounds.extend(new maps.LatLng(point.latitude, point.longitude))));
      map.setBounds(bounds);

      if (stations.length) {
        const clusterer = new maps.MarkerClusterer({ map, averageCenter: true, minLevel: 6, gridSize: 65 });
        const info = new maps.InfoWindow({ zIndex: 5 });
        const markers = stations.map((station) => {
          const marker = new maps.Marker({ position: new maps.LatLng(station.latitude, station.longitude), title: `${station.name} · 이용 가능 ${station.availableBikes}대` });
          const content = document.createElement("div");
          content.className = "station-info-window";
          content.textContent = `${station.name} · 이용 가능 ${station.availableBikes}대`;
          maps.event.addListener(marker, "click", () => { info.close(); info.setContent(content); info.open(map, marker); });
          return marker;
        });
        clusterer.addMarkers(markers);
        nearby.forEach((station) => {
          const badge = document.createElement("div");
          badge.className = `station-map-badge${station.availableBikes === 0 ? " empty" : ""}`;
          badge.textContent = `${station.availableBikes}대`;
          badge.title = `${station.name}: 이용 가능 ${station.availableBikes}대`;
          new maps.CustomOverlay({ map, position: new maps.LatLng(station.latitude, station.longitude), content: badge, yAnchor: 1.8, zIndex: 4 });
        });
      }

      accidents.forEach((area) => new maps.Circle({ map, center: new maps.LatLng(area.latitude, area.longitude), radius: 200,
        strokeWeight: closeAccidentIds.has(area.id) ? 4 : 2, strokeColor: closeAccidentIds.has(area.id) ? "#c44c32" : "#e77a51",
        fillColor: "#f3a17e", fillOpacity: closeAccidentIds.has(area.id) ? .5 : .24 }));
      if (selectedStation) new maps.Marker({ map, position: new maps.LatLng(selectedStation.latitude, selectedStation.longitude), title: `선택한 대여소: ${selectedStation.name}` });
      new maps.Marker({ map, position: coords(end), title: `도착: ${end.name}` });
      if (routeShown && routes) {
        new maps.Polyline({ map, path: routes.shortest.points.map((point) => new maps.LatLng(point.latitude, point.longitude)), strokeWeight: 6, strokeColor: "#ec8b50", strokeOpacity: .9 });
        new maps.Polyline({ map, path: routes.bikeRoad.points.map((point) => new maps.LatLng(point.latitude, point.longitude)), strokeWeight: 5, strokeColor: "#2477c7", strokeOpacity: .95 });
      }
      setMapStatus("ready");
    });
  }, [start, end, selectedStation, routes, routeShown, stations, nearby, accidents, closeAccidentIds]);

  useEffect(() => { if (window.kakao?.maps) drawMap(); }, [drawMap]);

  function choosePlace(point: Point, field: "start" | "end") {
    routeRequestId.current += 1;
    if (field === "start") { setStart(point); setStartQuery(point.name); setSelectedStation(null); }
    else { setEnd(point); setEndQuery(point.name); }
    setRoutes(null); setRouteStatus("idle"); setRouteError("");
    setActiveField(null);
    setMessage("");
  }

  async function showRoute() {
    const foundEnd = places.find((p) => p.name === endQuery.trim());
    if (!selectedStation) { setMessage("먼저 주변 따릉이 목록에서 출발 대여소를 선택해 주세요."); return; }
    if (!foundEnd) { setMessage("목적지를 장소 목록에서 선택해 주세요."); return; }
    const requestId = ++routeRequestId.current;
    setEnd(foundEnd); setMessage(""); setRoutes(null); setRouteError(""); setRouteStatus("loading");
    try {
      const response = await fetch("/api/routes/bicycle", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ origin: { latitude: selectedStation.latitude, longitude: selectedStation.longitude }, destination: { latitude: foundEnd.lat, longitude: foundEnd.lng } }) });
      const payload = await response.json();
      if (requestId !== routeRequestId.current) return;
      if (!response.ok) throw new Error(payload.error ?? "카카오 자전거 경로를 조회하지 못했습니다.");
      if (!payload.bikeRoad?.points?.length || !payload.shortest?.points?.length) throw new Error("카카오 API 응답에 경로 좌표가 없습니다.");
      setRoutes(payload as BicycleRoutes); setRouteShown(true); setRouteStatus("ready");
    } catch (error) {
      if (requestId !== routeRequestId.current) return;
      setRoutes(null); setRouteStatus("error");
      setRouteError(error instanceof Error ? error.message : "자전거 경로 조회에 실패했습니다.");
    }
  }

  function field(kind: "start" | "end", label: string, value: string, setter: (value: string) => void) {
    const matches = places.filter((p) => p.name.includes(value.trim())).slice(0, 5);
    return <div className="field"><label htmlFor={kind}>{label}</label><div className="input-wrap"><span className={`place-dot ${kind}`} /><input id={kind} value={value} onChange={(e) => { routeRequestId.current += 1; setter(e.target.value); setActiveField(kind); setRoutes(null); setRouteStatus("idle"); if (kind === "start") setSelectedStation(null); }} onFocus={() => setActiveField(kind)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (matches[0]) choosePlace(matches[0], kind); } }} placeholder="예시 장소 검색" autoComplete="off" /></div>{activeField === kind && value.trim() && <div className="suggestions">{matches.length ? matches.map((p) => <button type="button" key={p.name} onMouseDown={(e) => e.preventDefault()} onClick={() => choosePlace(p, kind)}>{p.name}</button>) : <span>일치하는 예시 장소가 없습니다.</span>}</div>}</div>;
  }

  return <div className="app-shell">
    {key && <Script src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=clusterer`} strategy="afterInteractive" onReady={drawMap} onError={() => setMapStatus("error")} />}
    <header className="app-header"><div className="brand"><span className="brand-icon">♢</span><span>Safe Bike Seoul</span></div><div className="header-right"><span className="demo-pill">● 혼합 데이터 화면</span><span>서울 자전거 안전 길잡이</span></div></header>
    <main className="dashboard"><div className="heading"><div><h1>안전한 자전거 길을 찾아보세요</h1><p>실제 따릉이 대여 현황, 자전거 경로, 과거 사고다발지역과 출발지 예보를 확인하세요.</p></div><span className="heading-note">대여소·경로·사고 이력·단기예보: 실제 API</span></div>
      <div className="dashboard-grid"><div className="left-column">
        <section className="panel search-panel"><h2>어디로 가시나요?</h2>{field("start", "대여소 검색 기준 위치", startQuery, setStartQuery)}{field("end", "목적지", endQuery, setEndQuery)}<button className="primary-button" onClick={showRoute} disabled={routeStatus === "loading"}>{routeStatus === "loading" ? "카카오 경로 조회 중…" : "선택한 대여소에서 경로 조회 →"}</button>{message && <p className="form-error" role="alert">{message}</p>}<p className="small-note">오른쪽 목록에서 출발 대여소를 선택하세요. 장소 검색은 준비된 장소를 지원합니다.</p></section>
        <section className="panel"><div className="route-heading"><h2>자전거 경로 비교</h2><span className="sample-badge">카카오맵</span></div>
          {selectedStation && <p className="route-selection">{selectedStation.name} → {end.name}</p>}
          {routeStatus === "idle" && <p className="route-empty">대여소를 선택한 뒤 두 경로를 조회해 주세요.</p>}
          {routeStatus === "loading" && <p className="route-empty">자전거도로 우선·최단 경로를 조회하고 있습니다.</p>}
          {routeStatus === "error" && <p className="route-error" role="alert">{routeError}</p>}
          {routes && <><div className="route-comparison" role="table" aria-label="자전거 경로별 거리와 주변 사고다발지역 비교">
            <div className="compare-row compare-head" role="row"><span role="columnheader">경로</span><span role="columnheader">거리</span><span role="columnheader">사고 인접</span></div>
            <div className="compare-row" role="row"><strong role="cell">자전거도로 우선</strong><span role="cell">{formatDistance(routes.bikeRoad.distanceMeters)}</span><span role="cell">{routeComparison ? `${routeComparison[0].nearbyCount}곳` : accidentStatus === "error" ? "확인 불가" : "조회 중"}</span></div>
            <div className="compare-row" role="row"><strong role="cell">최단 경로</strong><span role="cell">{formatDistance(routes.shortest.distanceMeters)}</span><span role="cell">{routeComparison ? `${routeComparison[1].nearbyCount}곳` : accidentStatus === "error" ? "확인 불가" : "조회 중"}</span></div>
          </div><p className="small-note">인접 건수는 2025년 사고다발지역 중심점과 경로의 직선거리 기준입니다. 경로별 안전성을 뜻하지 않습니다.</p><p className="small-note">카카오맵 경로 조회: {formatKst(routes.fetchedAt)} KST</p></>}
        </section>
      </div>
      <section className="map-card" aria-label="카카오맵 지도"><div ref={mapElement} className="kakao-map" />{mapStatus !== "ready" && <div className="map-fallback"><div><strong>{mapStatus === "loading" ? "카카오맵을 불러오는 중입니다" : "카카오맵을 표시할 수 없습니다"}</strong><span>{mapStatus === "error" ? kakaoKeyFormatValid ? "카카오 JavaScript 키와 localhost 도메인 등록을 확인해 주세요." : "카카오 JavaScript 키 형식이 올바르지 않습니다. .env.local의 NEXT_PUBLIC_KAKAO_JS_KEY를 확인해 주세요." : "잠시만 기다려 주세요."}</span></div></div>}<div className="map-top"><span className="map-tag">따릉이·경로 실제 정보 · {accidentYear ?? "조회 중"}년 사고 이력</span>{routes && <button className="map-control" onClick={() => setRouteShown((shown) => !shown)}>{routeShown ? "경로 숨기기" : "경로 표시"}</button>}</div><div className="map-legend"><span><i className="legend-station" /> 따릉이 대여소</span><span><i className="legend-route" /> 자전거도로 우선</span><span><i className="legend-shortest" /> 최단 경로</span><span><i className="legend-incident" /> 과거 사고다발지역</span></div></section>
      <aside className="right-column">
        <section className="panel"><div className="section-heading"><h2>출발지 주변 따릉이</h2><span>서울시 실시간</span></div><p className="station-summary">{start.name} 기준 직선거리순 · 전체 {stations.length.toLocaleString()}개</p>{stationsStatus === "loading" && <p className="station-state">대여소 정보를 불러오는 중입니다…</p>}{stationsStatus === "error" && <p className="station-state error">대여소 정보를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>}{stationsStatus === "ready" && nearby.length === 0 && <p className="station-state">조회된 따릉이 대여소가 없습니다.</p>}{stationsStatus === "ready" && nearby.map((station) => <button type="button" className={`station station-button${selectedStation?.id === station.id ? " selected" : ""}`} key={station.id} onClick={() => { routeRequestId.current += 1; setSelectedStation(station); setRoutes(null); setRouteStatus("idle"); setRouteError(""); setMessage(""); mapRef.current?.setCenter(new window.kakao!.maps.LatLng(station.latitude, station.longitude)); }}><div><strong>{station.name}</strong><small>출발지에서 직선거리 {formatDistance(station.distance)}</small></div><b>{station.availableBikes}대</b></button>)}<button type="button" className="refresh-button" onClick={() => setRefreshIndex((n) => n + 1)}>대여 현황 새로고침</button>{fetchedAt && <p className="small-note">조회 시각: {formatKst(fetchedAt)} · 대여 가능 대수는 수시로 변합니다.</p>}</section>
        <section className="panel"><div className="section-heading"><h2>자전거 사고다발지역</h2><span>{accidentYear ? `${accidentYear}년 기준` : "과거 자료"}</span></div>
          <p className="accident-disclaimer">과거 1년 사고를 집계한 지역입니다. 현재 사고나 실시간 위험을 뜻하지 않습니다.</p>
          {accidentStatus === "loading" && <p className="station-state">사고 이력을 불러오는 중입니다…</p>}
          {accidentStatus === "error" && <p className="station-state error">공공데이터포털 사고 이력을 가져오지 못했습니다.</p>}
          {accidentStatus === "ready" && accidents.length === 0 && <p className="station-state">해당 기준연도의 사고다발지역 데이터가 없습니다.</p>}
          {accidentStatus === "ready" && accidents.length > 0 && !routes && <p className="station-state">서울 {accidents.length}개 지역을 지도에 표시했습니다. 경로를 조회하면 가까운 지역을 보여줍니다.</p>}
          {accidentStatus === "ready" && accidents.length > 0 && routes && <><p className="accident-summary">두 경로 중심선에서 가까운 순서 · 200m 이내 {closeAccidentIds.size}곳</p>{routeAccidents.map((area) => <div className="incident" key={area.id}><strong><i />{area.name}</strong><p>경로에서 약 {formatDistance(area.distance)} · {area.occurrences}건 발생 · 사상자 {area.casualties}명</p>{area.distance <= 200 && <span className="near-route-badge">200m 이내</span>}</div>)}</>}
          <p className="small-note">지역 중심점과 경로의 직선거리입니다. 사고다발지역은 중심 반경 약 200m 기준으로 선정됩니다.</p>
        </section>
        <section className="panel"><div className="section-heading"><h2>출발지 단기예보</h2><span>기상청</span></div><p className="weather-location">{weatherLocationName} 기준</p>
          {weatherStatus === "loading" && <p className="station-state">기상청 예보를 불러오는 중입니다…</p>}
          {weatherStatus === "error" && <p className="station-state error">기상청 단기예보를 가져오지 못했습니다.</p>}
          {weatherStatus === "ready" && weather && <><div className="weather"><div><strong>{weather.temperatureC}°C</strong><span>🌡</span></div><p>예보 기온 · 현재 관측값 아님</p><div className="weather-meta"><span>강수확률 {weather.precipitationProbability}%</span></div></div><dl className="weather-times"><div><dt>발표시각</dt><dd>{formatKst(weather.publishedAt)}</dd></div><div><dt>예보시각</dt><dd>{formatKst(weather.forecastAt)}</dd></div></dl><p className="small-note">출발지 좌표를 기상청 5km 격자 ({weather.grid.nx}, {weather.grid.ny})로 변환했습니다.</p></>}
        </section>
      </aside></div>
      <section className="provenance-panel" aria-label="정보 출처와 시각"><div className="provenance-heading"><h2>정보 출처와 시각</h2><p>각 기관이 제공한 시각의 의미를 구분했습니다.</p></div>
        <div className="provenance-grid">
          <div><strong>따릉이 · 서울 열린데이터광장</strong><span>{fetchedAt ? `${formatKst(fetchedAt)} KST 조회` : "조회 전"}</span><small>원천 측정시각은 API에서 제공하지 않습니다.</small></div>
          <div><strong>자전거 경로 · 카카오맵</strong><span>{routes ? `${formatKst(routes.fetchedAt)} KST 조회` : "경로 조회 전"}</span><small>조회 당시의 경로 결과이며 현장 상태 측정값이 아닙니다.</small></div>
          <div><strong>사고다발지역 · 한국도로교통공단</strong><span>{accidentYear ? `${accidentYear}년 사고 기준 자료` : "자료 조회 중"}</span><small>과거 사고 집계입니다. 개별 사고시각은 제공하지 않습니다.</small></div>
          <div><strong>단기예보 · 기상청</strong><span>{weather ? `발표 ${formatKst(weather.publishedAt)} · 예보 ${formatKst(weather.forecastAt)} KST` : "예보 조회 중"}</span><small>예보값이며 현재 기온의 관측시각이 아닙니다.</small></div>
        </div>
        <p className="safety-note">사고다발지역 인접 건수는 과거 자료와 경로의 공간적 근접성만 보여줍니다. 교통량, 도로 상태, 시간대와 현장 상황을 반영한 안전성 평가가 아닙니다.</p>
      </section>
      <footer>Safe Bike Seoul · 지도 정보는 참고용이며 실제 주행 시 현장 교통 상황과 법규를 확인하세요.</footer>
    </main>
  </div>;
}
