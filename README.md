# Safe Bike Seoul

## GitHub 및 Vercel 배포

이 폴더(`safe-bike-seoul`)가 Git 저장소와 Next.js 프로젝트의 루트입니다. GitHub에 새 저장소를 만든 뒤 이 폴더에서 커밋하고 푸시하세요. `.env.local`, `.env`, 빌드 산출물, 테스트 화면은 `.gitignore`로 제외됩니다. `.env.example`에는 변수 이름만 있으며 실제 키가 없습니다. 이전에 비밀키를 커밋했다면 무시 목록을 추가해도 기존 기록에서는 제거되지 않으므로 해당 키를 재발급해야 합니다.

Vercel에서 GitHub 저장소를 Import하고 Framework Preset은 **Next.js**, Root Directory는 저장소 루트(`./`)로 설정하세요. 기본 Build Command(`next build`)를 사용합니다. 배포 전에 Project Settings → Environment Variables에서 다음 네 변수를 **Production**에 등록하고, 미리보기 배포를 사용할 경우 **Preview**에도 등록하세요. 값은 `.env.local`에서 확인하되 파일 자체를 업로드하지 마세요.

| 변수 | 용도 | 공개 여부 |
| --- | --- | --- |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 카카오맵 JavaScript SDK | 브라우저에 공개되는 키 |
| `SEOUL_API_KEY` | 서울 열린데이터광장 `bikeList` | 서버 전용 |
| `DATA_GO_KR_API_KEY` | 사고다발지역·기상청 단기예보 | 서버 전용 |
| `KAKAO_REST_API_KEY` | 카카오 장소 검색·자전거 경로 | 서버 전용 |

`NEXT_PUBLIC_`가 붙은 값은 Next.js가 빌드 시 브라우저 코드에 포함합니다. 나머지 세 키에는 이 접두사를 붙이지 마세요. 환경변수를 수정한 뒤에는 새 배포가 필요합니다.

카카오디벨로퍼스 **앱 → 플랫폼 키 → JavaScript 키 → JavaScript SDK 도메인**에 실제 서비스 주소(예: `https://safe-bike-seoul.vercel.app`)를 추가하세요. 로컬 테스트용 `http://localhost:3000`도 유지하세요. 별도 도메인이나 Preview URL에서 지도를 테스트하려면 그 주소도 등록해야 합니다. 카카오 제품 링크 관리의 웹 도메인과는 다른 설정입니다. 도메인 등록 전에 지도 SDK는 인증 오류를 반환할 수 있습니다.

배포 전 로컬 확인:

```powershell
npm.cmd ci
npm.cmd run lint
npm.cmd run build
```

배포 후에는 서비스 주소에서 지도, 대여소 검색, 경로, 사고정보, 날씨를 다시 확인하세요. 외부 API의 서비스 권한과 사용량 제한도 실제 배포 환경에 적용됩니다.

Next.js 지도 앱과 서버 API입니다. 따릉이 대여소 위치와 이용 가능한 자전거 수는 서울 열린데이터광장의 실제 `bikeList` 응답을 사용합니다. 출발지 주변 대여소는 직선거리순으로 정렬합니다. 선택한 대여소에서 목적지까지의 자전거도로 우선·최단 경로는 카카오맵 공식 REST API 응답을 사용합니다. 한국도로교통공단의 과거 자전거 사고다발지역을 지도에 표시하고, 두 경로에서 가까운 지역을 중심점 직선거리순으로 보여줍니다. 기상청 단기예보에서 출발지 격자의 예보 기온과 강수확률을 표시합니다.

## 환경 변수

`.env.example`을 참고해 프로젝트 루트의 `.env.local`에 키를 설정합니다. `.env.local`과 상위 폴더의 `.env.env`는 Git 무시 목록에 포함됩니다. 서버용 키는 클라이언트 코드나 `next.config.ts`의 `env` 설정에 넣지 마세요.

| 변수 | 용도 | 브라우저 노출 |
| --- | --- | --- |
| `NEXT_PUBLIC_KAKAO_JS_KEY` | 카카오맵 JavaScript SDK | 예. SDK 구조상 공개됨 |
| `SEOUL_API_KEY` | 서울시 따릉이 대여소 API | 아니요 |
| `DATA_GO_KR_API_KEY` | 공공데이터포털 자전거 사고 다발지역·기상청 단기예보 API | 아니요 |
| `KAKAO_REST_API_KEY` | 카카오 장소 검색 REST API | 아니요 |

카카오 JavaScript 키에는 `http://localhost:3000` 등 실제 사용 도메인을 등록하세요. GitHub에 과거에 키를 커밋한 적이 있다면 `.gitignore`를 추가하는 것만으로는 삭제되지 않으므로 해당 키를 재발급해야 합니다.

## 실행

```powershell
npm.cmd install
npm.cmd run dev
```

## 서버 API

| 경로 | 설명 |
| --- | --- |
| `GET /api/stations` | 서울시 따릉이 대여소 전체 페이지. 각 요청은 최대 1,000건씩 조회 |
| `GET /api/accidents` | 서울 25개 구의 최근 제공 사고 기준연도 자료. 2026-11-22 확인 기준 2025년 110건 |
| `GET /api/accidents?year=2021&district=110` | 특정 연도·서울 구 조회. `district`는 서울 구 코드 |
| `GET /api/places?q=서울시청` | 카카오 장소 검색, 최대 10개 |
| `POST /api/routes/bicycle` | 카카오 자전거도로 우선·최단 경로. JSON 본문에 `origin`과 `destination`의 `latitude`, `longitude` 전달 |
| `GET /api/weather?latitude=37.5663&longitude=126.9779` | 출발지 위경도를 기상청 격자로 변환해 가장 가까운 미래 단기예보의 기온·강수확률 반환 |

API 응답은 필요한 필드만 반환하며 인증키와 외부 요청 URL을 포함하지 않습니다. 외부 API 오류는 일반화된 오류 메시지로 반환합니다. 운영 환경에서는 호출량 제한과 캐시 정책을 추가하는 것이 좋습니다.

자전거 경로 API가 권한 오류나 경로 없음 상태를 반환하면 지도에 경로를 생성하지 않고 오류 이유를 표시합니다.

## 화면 검증

로컬 서버를 실행한 뒤 설치된 Chrome으로 실제 API·지도·경로·모바일 화면을 확인할 수 있습니다.

```powershell
npm.cmd run test:smoke
npm.cmd run test:error-states
```

두 번째 명령은 브라우저에서 인증 실패와 빈 데이터 응답을 모의해 오류 화면을 확인합니다. 화면 캡처는 Git에서 제외된 `test-results/`에 저장됩니다. 카카오 JavaScript 키는 올바른 형식이어야 하며 `http://localhost:3000`이 SDK 도메인으로 등록되어 있어야 실제 지도 테스트가 통과합니다.

사고다발지역은 실시간 사고가 아닙니다. 2026-11-22 확인 당시 2026년 자료는 서울 25개 구 모두 비어 있고, 2025년 자료가 가장 최근 제공 연도였습니다. 경로와의 거리는 사고다발지역 중심점에서 경로 선분까지의 직선거리이며, 실제 충돌 위험도를 뜻하지 않습니다.

날씨 카드는 현재 관측값이 아닌 기상청 단기예보입니다. `publishedAt`은 자료 발표시각, `forecastAt`은 기온·강수확률이 적용되는 예보시각입니다. 두 시각은 화면에서 한국 표준시로 별도 표시합니다.

## 통합 화면의 경로 비교

두 카카오 경로의 거리와 경로별 과거 사고다발지역 200m 이내 건수를 나란히 보여줍니다. 거리는 카카오 API가 반환한 경로 거리이고, 건수는 2025년 사고다발지역 중심점에서 각 경로 선분까지의 직선거리를 계산한 결과입니다. 이 건수는 실제 안전성이나 사고 확률을 뜻하지 않습니다.

출처와 시각 패널은 따릉이 API 조회시각, 경로 조회시각, 사고 기준연도, 기상청 발표시각과 예보시각을 구분합니다. 따릉이 API는 대여 가능 수의 원천 측정시각을 제공하지 않습니다.
