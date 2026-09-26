# 쿠팡 WING 연동 — 기획 (v2 2차 · wing)

> 이 문서는 사람이 읽고 결정하기 위한 것이다. 법률·약관 자문이 아니다.
> 사실에는 출처를 달았고, 확인하지 못한 것은 **「확인 필요」**로 적었다.
> 조사일: 2026-09-25. 이 작업 환경에서는 쿠팡 개발자 문서 사이트(`developers.coupang.com`, `developers.coupangcorp.com`)를
> 직접 열 수 없었다(네트워크 차단). 그래서 쿠팡 문서 내용은 **검색 결과에 나온 문서 제목·요약**과 **연동 솔루션사의 공개 안내서**로 확인했다.
> 운영 전에 사람이 쿠팡 문서 원문을 한 번 더 열어 확인해야 한다(맨 끝 「사람이 정할 일」 1번).

## 0. 한 줄 요약

- **읽기부터, 셀러 본인 키로, 스위치 꺼짐으로 시작한다.** 쓰기(입고 요청 만들기·상품 등록)는 만들지 않는다.
- 로켓그로스 **입고 요청·바코드 라벨을 가져오는 공개 API 는 확인하지 못했다**(재고·주문·상품 API 는 공개). 그래서 첫 판의 실제 경로는
  **셀러가 WING 에서 내려받은 입고 목록 엑셀·CSV 와 바코드 PDF 를 올리는 방식**이고, API 는 공개가 확인되는 항목부터 어댑터에 붙인다.
- 가져온 입고 요청은 FC도착의 **선적과 짝**을 맞춘다(자동 제안 + 사람이 확정). 짝이 맞으면 바코드 PDF 가 그 선적의 서류함 「쿠팡 바코드 PDF」 칸으로 가고,
  입고 결과·회송 수량이 **실측 회송률**이 되어 물류사가 적은 값과 나란히 보인다.

## 1. 목적 — 왜 연동하나

| 지금 셀러가 하는 일 | 연동하면 |
|---|---|
| WING 에서 입고 요청을 만들고, 번호·FC·예정일을 물류사에 카톡으로 다시 적어 보낸다 | 입고 요청 번호·FC·예정일·수량이 선적 옆에 붙는다(다시 적지 않는다) — 화주·물류사 선적 화면에 같은 한 줄(`fcd.wing_inbound_for_shipment`) |
| 바코드 PDF 를 받아 물류사에 따로 보낸다 | 바코드 PDF 가 짝 맞은 선적의 서류함으로 들어간다 — 물류사도 같은 칸에서 본다 |
| 회송·입고 반려를 나중에 알고, 몇 개가 돌아왔는지 물류사 말에 기댄다 | 쿠팡 쪽 입고 결과(입고 수량·회송 수량)로 **실측 회송률**을 잰다 — 추천 점수의 「FC 회송」과 회송 보장료(assure)의 근거가 물류사 자기 신고에서 쿠팡 기록으로 옮겨 간다 |
| 판매손익을 계산할 때 FC 입고 수량을 손으로 넣는다 | 입고 결과 수량으로 개당 도착원가의 분모를 맞춘다(다음 단계) |

플랫폼 전체로는: **「FC 도착 원가를 확정하고 책임진다」(V2 한 줄)의 마지막 칸 — 실제로 FC 에 몇 개가 들어갔는가 — 를 쿠팡 기록으로 잠근다.**
이것이 없으면 확정가·회송 보장은 물류사 신고를 믿는 수밖에 없다.

## 2. 쿠팡 오픈 API 는 무엇인가

### 2.1 무엇을 하는가
- 쿠팡 판매자(마켓플레이스·로켓그로스)가 WING 에서 하는 일(상품·주문·반품·정산·재고 등)을 프로그램으로 부르는 HTTP API.
  주소는 `https://api-gateway.coupang.com` 아래 `/v2/providers/...` 경로.
  출처: 쿠팡 Open API 「Creating HMAC Signature」, 「Python Example」(developers.coupangcorp.com/hc/en-us/articles/360033461914, 360033396034 — 검색 요약으로 확인).
- 문서 사이트가 둘 보인다: 옛 `developers.coupangcorp.com`(Zendesk 형식)과 새 `developers.coupang.com`(개발자 센터). 2025-06-26 「개발자 포털 변경」 공지가 있다
  (developers.coupangcorp.com/hc/ko/articles/48314250583705 — 제목으로 확인). 새 포털 기준 원문 확인 필요.

### 2.2 판매자가 키를 받는 법 (셀러 본인 키)
1. 사업자 인증을 마친 판매자로 WING(`https://wing.coupang.com`) 로그인. 사업자 인증 전 일반회원은 발급 불가.
2. **[판매자정보] → [추가판매정보] → [API Key 발급 받기]** (판매자 ID 에 따라 메뉴 위치가 다를 수 있다).
3. 키 사용 목적 **[OPEN API]** 선택 → 약관 확인·동의 → **[약관 동의 및 키 발급]**.
4. **연동 방식** 고르기(2023-07-10 이후): **「연동 업체 선택」**(목록에서 솔루션사를 고름) 또는 **「자체개발(직접입력)」**(업체명·URL·**IP 주소**를 적음).
5. 발급 화면에서 **업체 코드(vendorId)·Access Key·Secret Key** 를 복사한다.
6. 발급은 즉시지만 **실제 권한은 최대 24시간** 걸릴 수 있다.
7. 키 **유효기간 180일**(최대 6개월). 만료 2주 전·1주 전에 쿠팡이 메일로 알린다. 재발급은 기존 키를 **지운 뒤** 가능하고, 재발급하면 Secret Key 가 새로 생긴다 — 연동 서비스에 새 키를 다시 넣어야 한다.

출처: 솔루션사 공개 안내 — 캐시데이터 「쿠팡 OPEN API 발급 방법」(cashdata.oopy.io/d48e6920-92bf-4dcf-9902-2a322c63f39f),
윈셀링 「쿠팡 API 셋팅하기」(winselling.co.kr/guide/winshop/open_api/setting_coopang), 이셀러스 FAQ 22447·23784(esellers.co.kr/cms/faq/detail/22447),
쿠팡 공지 「유효기간 적용을 위한 OPEN API 키 삭제 및 재발급 2차 안내(2023-12-18)」(developers.coupangcorp.com/hc/ko/articles/24404324244249 — 제목·요약),
카페24 도움말 「쿠팡 마켓 OPEN API 키 재발급 대상과 방법」(support.cafe24.com/hc/ko/articles/29472295175449).
쿠팡 원문 「[구] OPENAPI Key 발급받기」(developers.coupangcorp.com/hc/ko/articles/360033980613)는 열지 못했다 — **확인 필요**.

> **자체개발(직접입력)을 고르면 IP 주소를 적는다.** FC도착은 Vercel 서버리스라 나가는 IP 가 고정되지 않는다.
> → 고정 IP 가 필요하면 나가는 호출을 고정 IP 프록시(또는 고정 IP 가 있는 작은 서버) 한 곳으로 모아야 한다. **IP 필수 여부·여러 개 등록 가능 여부 확인 필요.** (사람이 정할 일 4)

### 2.3 서명 방식 (HMAC-SHA256, 「CEA」)
요청마다 `Authorization` 머리글을 붙인다.

```
Authorization: CEA algorithm=HmacSHA256, access-key={ACCESS_KEY}, signed-date={SIGNED_DATE}, signature={SIGNATURE}
SIGNED_DATE = UTC 시각 yyMMdd'T'HHmmss'Z'      예) 260925T031500Z
message     = SIGNED_DATE + METHOD + PATH + QUERY   (QUERY 는 '?' 없이, 없으면 빈 문자열)
SIGNATURE   = hex( HMAC-SHA256( key = SECRET_KEY(utf-8), data = message(utf-8) ) )
```
출처: 쿠팡 Open API 「Creating HMAC Signature」·「Python Example」(검색 요약에 실린 파이썬 예시:
`datetime = strftime('%y%m%d')+'T'+strftime('%H%M%S')+'Z'`, `message = datetime + method + path + query`,
`hmac.new(secretkey.encode('utf-8'), message.encode('utf-8'), hashlib.sha256).hexdigest()`).
쿠팡 문서의 **「이 입력이면 이 서명」 예시 값은 찾지 못했다**(확인 필요). 그래서 서명 시험은
① HMAC-SHA256 자체는 공개 표준 시험값(RFC 4231 시험 2)으로, ② 쿠팡 규칙(날짜 모양·이어 붙이는 순서·'?' 없음·머리글 모양)은 규칙대로 고정했다(`tests/v2-wing.test.ts`).
쿼리 문자열의 **인코딩 규칙(공백·한글·정렬)** 은 예시가 `urlencode` 를 쓴다는 것까지만 확인했다 — 호출하는 쪽이 넘긴 문자열을 **그대로** 서명·전송하도록 만들었다(같은 문자열을 두 번 만들지 않는다).

### 2.4 호출 제한
- 업체 코드(vendorId)당 **초당 5회** 넘게 부르면 `429 Too Many Requests`, 계속 넘으면 잠시(수 분~수십 분) 막힌다. 기준은 시스템·업체에 따라 달라질 수 있다.
  출처: 「Introduction of Open API rate limit policy」(developers.coupangcorp.com/hc/en-us/articles/20414599556889), 「Notice on strengthening OpenAPI speed limit policy (2023-10-12)」(…/23902034110617) — 검색 요약.
- 로켓그로스 재고·주문 API 는 **분당 50회** 이하. 출처: 개발자 센터 「로켓창고 재고 API」(developers.coupang.com/ko/api/rocket-growth/rg-inventory-api), 「로켓그로스 주문 API(목록 쿼리)」(developers.coupangcorp.com/hc/ko/articles/41131195825433) — 검색 요약.
- 우리 설정: `wing.call_rule`(첫 판 초당 4회·분당 40회·재시도 3회·시작 대기 1초·최대 30초·시간 초과 10초) — 문서 기준보다 조금 낮게. 운영자가 새 판으로 바꾼다.

## 3. 로켓그로스 — 무엇이 공개돼 있나

| 필요한 것 | 공개 API | 근거 | 우리 판단 |
|---|---|---|---|
| 상품·옵션(로켓그로스 상품 생성·조회·수정) | **있음**(2024-10-31 문서 갱신) | 「로켓그로스 상품 생성, 관리 API 문서 업데이트 안내」(developers.coupangcorp.com/hc/ko/articles/39472584005657), 「Query Product (Rocket Growth …)」(…/37338749441689) | 옵션 이름·바코드 값 대조에 쓸 수 있다(읽기만). 상품 생성 API 는 WING 에서 「로켓그로스 상품 생성 API 이용 및 검수 기준 동의」가 필요 — 우리는 생성하지 않는다 |
| 로켓창고 재고 요약 | **있음** — `GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/inventory/summaries`, 분당 50회 | 「로켓창고 재고 API」 | 입고 뒤 재고가 늘었는지로 「입고 완료」 교차 확인. 어댑터에 경로를 두었다(스위치 꺼짐) |
| 로켓그로스 주문 | **있음**(목록 쿼리, 분당 50회) | 「로켓그로스 주문 API(목록 쿼리)」 | 판매손익 다음 단계. 이번에는 안 한다 |
| **입고 요청(입고 생성·조회)** | **확인 못 함 — 없을 가능성이 높다** | 솔루션사 안내: 「물류 입고정보 입력 및 입고 생성은 쿠팡 윙에서 작업」(플레이오토 도움말 plto.com/customer/HelpDesc/gmp/15503) | **엑셀·CSV 올리기로 대신한다** |
| **바코드 라벨 PDF** | **확인 못 함** | 입고 신청과 함께 WING 에서 내려받는 것으로 안내됨(같은 출처·셀러 안내 글) | **셀러가 PDF 를 올린다** → 서류함 |
| 입고 결과·회송(반출) | **확인 못 함** | 미회송 재고·판매자 요청 반출은 WING 온라인 문의로 신청한다는 안내(장사왕 블로그 「로켓그로스 미회송 재고 폐기 정책」 sellerking.io/blog/rocketgross-return-inventory-policy) | 입고 목록 파일의 결과·회송 칸이 있으면 함께 읽는다(열 이름 확인 필요) |
| 쿠팡 「파트너 연동」 개발자 사이트 | 있음 — `partner-developers.coupangcorp.com`(「Create HMAC Signature」 문서가 따로 있다) | 검색 결과 | **누구를 위한 것인지(물류·배송 파트너? 공급사?) 확인 필요.** 로켓그로스 입고를 대행하는 3PL·포워더용 경로가 있는지 쿠팡에 물어볼 가치가 있다 |

**대안(첫 판의 실제 경로):** 셀러가 WING 의 로켓그로스 입고 관리 화면에서 **입고 목록을 엑셀로 내려받아** `/app/integrations/wing` 에 올린다.
- 머리글 이름은 WING 화면을 직접 보지 못해 **짐작한 별칭**(입고 요청 번호·입고번호·입고예정일·물류센터·SKU 수·수량·박스 수·상태·입고 수량·회송 수량)으로 먼저 맞추고,
  못 맞춘 칸은 **사람이 파일 머리글을 골라 잇는 화면**(칸 잇기)에서 고른다. 화면에 「열 이름 확인 필요」를 띄운다.
- 실제 WING 파일 한 장(개인정보를 지운 것)을 받으면 별칭을 고친다(사람이 정할 일 2).

## 4. 허가 받는 길 둘

### ① 판매자 본인 키로 연동 (첫 판에 고른 길)
- **절차:** 셀러가 2.2 대로 키를 발급 → 연동 방식은 「자체개발(직접입력)」(업체명: FC도착, URL: 서비스 주소, IP: 우리 고정 IP) 또는 우리가 연동 업체 목록에 오른 뒤라면 「연동 업체 선택 → FC도착」
  → 셀러가 `/app/integrations/wing` 에 업체 코드·Access Key·Secret Key 를 넣는다.
- **준비물(셀러):** 사업자 인증된 WING 계정, 로켓그로스 이용 중. **(우리):** 고정 IP(자체개발 방식일 때), 키 암호화 키(`WING_KEY_ENCRYPTION_KEY`), 개인정보 처리방침에 「쿠팡 API 키 보관·이용 목적」 추가.
- **기간:** 발급은 즉시, 권한은 최대 24시간. 우리 쪽 준비(고정 IP·방침 개정)는 1~2주 추정.
- **장점:** 쿠팡의 별도 심사 없이 시작할 수 있다(셀러 자기 계정·자기 키). 이미 수많은 솔루션사가 이 방식이다(윈셀링·카페24·이셀러스 등 — 위 출처).
- **약관상 주의 — 확인 필요:**
  - OPEN API 이용약관 원문을 보지 못했다. **셀러 키를 제3자(우리)가 보관·사용해도 되는지, 받은 자료를 셀러 본인 업무 외에 써도 되는지(재판매·가공 제공 금지 여부)** 확인 필요.
    「연동 업체 선택」 목록이 있다는 것은 쿠팡이 제3자 연동을 예정한다는 뜻이지만, **목록에 없는 제3자가 「자체개발」로 들어가는 것이 허용되는지**는 확인 필요.
  - 우리는 가져온 자료를 **그 셀러에게만** 보여 주고, 다른 셀러·물류사에 넘기지 않는다(물류사에는 짝 맞은 그 선적의 바코드 PDF 만 — 셀러가 올린 서류로서). 지표는 비율로만 모은다.
    이 원칙이 약관과 맞는지 **확인 필요**.
  - 키 만료(180일)마다 셀러가 새 키를 다시 넣어야 한다 — 만료 14일 전부터 화면에 알린다(발급일을 적게 한다).

### ② 쿠팡 연동 파트너·솔루션사로 신청
- **무엇:** WING 키 발급 화면의 「연동 업체 선택」 목록에 FC도착이 오르는 것. 셀러는 목록에서 고르기만 하면 되고 IP 를 적지 않아도 된다(추정).
- **절차·준비물·기간: 확인 필요.** 공개된 신청 창구를 찾지 못했다. 짐작되는 준비물: 법인 사업자 등록증, 서비스 소개서, 개인정보 처리방침·보안 대책, 고정 IP, 담당자.
  쿠팡 판매자 콜센터·개발자 센터 문의로 창구부터 물어야 한다(사람이 정할 일 3).
- **장점:** 셀러 입장에서 쉽고 믿을 만하다. 입고·바코드처럼 공개 문서에 없는 기능을 파트너에게 따로 여는지 물어볼 수 있다(확인 필요).
- **단점:** 심사·계약 기간을 알 수 없다. 쿠팡과 경쟁하는 기능(로켓그로스 입고 대행 비교)으로 보일 위험.

### 고른 것
**①로 시작하고 ②를 병행 신청한다.** 코드는 두 길을 모두 받게 했다(연결 기록의 `method` = `self_key`·`partner_solution`).
어느 쪽이든 **읽기만**, 그리고 **`WING_ENABLED` 가 켜지기 전에는 쿠팡을 한 번도 부르지 않는다.**

## 5. 가져올 것과 이유

| 가져올 것 | 어디에 쓰나 | 첫 판 경로 |
|---|---|---|
| 입고 요청 번호 | 선적과 짝을 맞추는 열쇠. 한 번 짝이 맞으면 물류사·셀러가 같은 번호로 말한다 | 파일(엑셀·CSV) · 데모는 흉내 |
| 물류센터(FC) · 입고 예정일 · SKU 수 · 수량 · 박스 수 | 자동 짝 제안의 근거(같은 FC, 예정일이 FC 도착 예정일 근처, 수량이 비슷) | 파일 |
| 바코드 PDF | 서류함 「쿠팡 바코드 PDF」 칸 → 빠진 서류 알림이 꺼진다 | 셀러가 올림(짝 맞은 입고 요청 줄에서) |
| 상품 옵션(옵션 이름·옵션 수) | 한 입고 요청에 옵션 몇 개인지 — 창고 작업(라벨 부착) 견적의 근거 | 파일의 SKU 수, 옵션 상세는 다음 단계(상품 조회 API) |
| 입고 결과(입고 수량) · 회송 수량 | **실측 회송률** = 회송 ÷ (입고 + 회송). 물류사가 선적에 적은 회송 수량과 나란히 | 파일(칸이 있으면) |
| 로켓창고 재고 요약 | 입고 완료 교차 확인 | API(스위치 켜진 뒤) |

가져오지 않는 것: 주문자·수령인 개인정보, 정산 금액(이번 범위 밖), 광고.

## 6. 키 보관 설계

- **암호화:** AES-256-GCM. 암호화 키는 서버 환경변수 **`WING_KEY_ENCRYPTION_KEY`(32자 이상 임의 문자열 — 값은 Vercel 설정에만)** 에서 SHA-256 으로 32바이트를 만든다.
  암호문 모양 `v1.<키 지문 8자>.<iv>.<tag>.<본문>`(base64url). 추가 인증 자료(AAD)로 **조직 id** 를 묶어, 다른 조직 줄로 옮긴 암호문은 풀리지 않는다.
  키 지문이 있어 암호화 키를 바꿀 때 어느 키로 잠갔는지 안다(바꾸기 절차는 사람이 정할 일 6).
- **평문으로 남기는 것:** 업체 코드·Access Key 의 **끝 4자리**, 발급일, 상태. Secret Key 는 끝자리도 남기지 않는다.
- **본인만:** 연결 기록은 그 **화주 조직 사람**만 본다(RLS). **암호문 칸은 `fcd_user` 에게 읽기 권한 자체가 없다**(칸 단위 권한).
  암호문은 보안 정의 함수 `fcd.wing_key_blob(연결 id)` 로만 꺼내고, 그 함수는 ① 그 조직 사람 ② 현재 판 ③ 폐기 아님일 때만 돌려주며 **꺼낼 때마다 접근 기록**을 남긴다.
  **플랫폼 운영자도 암호문을 못 꺼낸다**(함수가 조직 사람만 받는다). 화면·로그·오류 문구에 키 값이 나가지 않는다.
- **지우기 = 새 판으로 폐기 표시.** 폐기하면 암호문이 빈 새 판(`status = revoked`)이 쌓이고, 옛 판은 새 판에 밀려 함수가 더는 돌려주지 않는다. UPDATE·DELETE 권한은 없다.
  → 옛 암호문이 DB 에 남는다는 한계가 있다. 그래서 화면은 **「WING 에서도 키를 지우세요」**를 함께 안내한다(쿠팡 쪽에서 지운 키는 암호문이 새어도 못 쓴다).
  암호문을 아예 없애는 방법(① 줄마다 따로 만든 키를 두고 그 키만 지우는 「암호 파쇄」 ② 보안 정의 함수로 옛 판 암호문 칸만 비우기)은 **지우는 SQL 이 필요해 사람이 정한다**(사람이 정할 일 5).
- **접근 기록(`fcd.wing_access_log`):** 키 저장·폐기·꺼냄·호출 막힘·호출·가져오기·짝 확정·짝 풀기·바코드 올림을 쌓기만 한다. 그 조직 사람과 운영자가 본다. 키 값은 싣지 않는다.
- **암호화 키 모양:** 무작위 32바이트(`openssl rand -base64 32`). 공백이 있는 문장·같은 글자 반복(서로 다른 글자 16개 미만)은 없는 것으로 본다(`kekLooksRandom`). 유도는 SHA-256 한 번이라 약한 값이면 DB 와 함께 샜을 때 버티지 못한다 — 키 회전·옛 암호문 파쇄 절차는 켜기 전에 사람이 정한다(사람이 정할 일 5·6).
- **만료 알림:** 발급일 + `wing.key_valid_days` 기준, `wing.key_warn_days`(첫 판 14) 전부터 연동 화면에만 「곧 만료」. 메일·문자는 보내지 않는다.
- **암호화 키가 없으면** 키를 받지 않는다(「운영자가 암호화 키를 설정하기 전까지 키를 받지 않습니다」). 평문으로 떨어지는 길은 없다.

## 7. 호출 제한 · 실패 · 재시도

- **스위치:** `WING_ENABLED` 가 켜짐(1·on·true)이 아니면 HTTP 어댑터는 **`fetch` 를 부르기 전에** `WingDisabledError` 를 던진다. 화면은 「연동 준비 중」.
- **속도:** 한 연결(업체 코드)당 설정 `wing.call_rule.perSecond`·`perMinute` 를 넘지 않게 호출 사이를 띄운다(인스턴스 메모리 기준 — 여러 인스턴스면 느슨해진다. 실제 켜기 전에 한 곳(작업 대기열)으로 모은다).
- **재시도:** 429·5xx·네트워크 오류·시간 초과만, 지수 대기(1초 → 2초 → 4초…, 최대 30초, `Retry-After` 가 있으면 그 값), 최대 3회. 400·401·403·404 는 바로 실패.
  401·403 이면 연결 상태를 「확인 실패」 새 판으로 쌓고(같은 암호문을 잇는다) 셀러에게 「키를 다시 넣어 주세요(만료 또는 권한 대기 24시간)」. 호출이 성공하면 「확인됨」 새 판(0016 고침 — `syncWingApi`).
- **누가:** 키 넣기·폐기·꺼냄(= 쿠팡에서 바로 가져오기)은 화주 조직 관리자만(0016 제한 정책·`fcd.wing_key_blob`). 파일 올리기·짝 맞추기는 구성원 누구나.
- **부분 실패:** 가져오기는 한 번의 묶음(`import_batch_id`)으로 쌓고, 같은 입고 요청 번호가 이미 있고 내용이 같으면 건너뛰며, 바뀌었으면(상태·결과 수량) **새 판**으로 쌓는다.
- **쓰기 없음:** 어댑터에 POST·PUT·DELETE 를 만들지 않았다(GET 만).

## 8. 짝 맞추기 규칙 (순수 함수 `src/lib/wing/match.ts`)

- 후보 = 그 화주의 선적 중 FC 입고 전이거나 만든 지 60일 안인 것, 그리고 이미 짝이 있는 선적(`src/lib/server/wing.ts` `wingShipments`).
- 점수(100점): **FC 같음 40** · **날짜 30**(입고 예정일과 선적의 FC 도착 예정일 차이가 0일이면 30, `dateWindowDays` 에서 0으로 곧게 줄어든다) ·
  **수량 30**(수량 차이 비율이 0이면 30, `unitsToleranceBp` 에서 0; 수량이 없으면 박스로).
  FC 가 다르면 최대 60점이라 기본 `minScore`(70) 를 못 넘는다 — 다른 FC 는 사람이 직접 골라야 한다.
- 한 선적에 한 입고 요청(가장 높은 점수부터 나눠 준다). 동점이면 날짜 차이가 작은 쪽, 그다음 선적 번호.
- **자동으로 확정하지 않는다.** 제안은 화면에 「제안」으로만, 사람이 「짝 확정」을 눌러야 기록된다(`fcd.wing_matches`, 새 판).
- 기준치는 설정 `wing.match_rule`(첫 판 `dateWindowDays` 10 · `unitsToleranceBp` 2000 · `minScore` 70).

## 9. 단계별 계획

| 단계 | 무엇 | 켜는 조건 |
|---|---|---|
| **0 (이번)** | 기획 · 어댑터(서명·HTTP·흉내) · 표 · 화면 · 파일 가져오기 · 짝 맞추기 · 바코드 → 서류함 · 실측 회송률 · 접근 기록 | 없음(스위치 꺼짐, 데모는 흉내) |
| 1 | 셀러 5명과 WING 입고 목록 파일로 시범 — 머리글 별칭 고치기, 짝 맞추기 정확도 재기(제안 채택률) | 사람이 정할 일 2 |
| 2 | 쿠팡 문서 원문·약관 확인 → 고정 IP → `WING_ENABLED` 켜고 **재고 요약 API 만**(입고 교차 확인) · 키 만료 알림 | 사람이 정할 일 1·3·4 |
| 3 | 입고 요청·입고 결과 API 가 공개(또는 파트너에게만 열림)되면 어댑터 `listInboundRequests` 를 채운다 · 판매손익에 입고 수량 | 쿠팡 답변 |
| 4 | 실측 회송률을 추천 점수·회송 보장료에 넣는다(물류사 신고보다 우선) | 표본·약관 확인, 물류사 안내 |

## 10. 책임 · 위험

| 위험 | 대비 |
|---|---|
| 키가 새면 셀러 WING 계정이 조작될 수 있다(OPEN API 는 쓰기 권한도 있다) | 암호화·칸 권한·꺼낼 때 기록·운영자도 못 꺼냄·폐기 안내. 쓰기 호출을 코드에 두지 않는다. 사고 시 셀러에게 즉시 WING 키 삭제 안내 |
| 약관 위반(제3자 보관·자료 이용) | 원문 확인 전에는 스위치 꺼짐. 파일 올리기는 셀러가 자기 자료를 올리는 것이라 약관 위험이 낮다(그래도 확인 필요) |
| 쿠팡 정책 변경(키 방식·호출 제한·메뉴 위치) | 어댑터 한 겹에 가둔다. 설정으로 제한값을 바꾼다 |
| 짝을 잘못 맞춰 바코드가 다른 선적으로 감 | 자동 확정 없음. 짝 풀기(새 판). 서류는 셀러가 올릴 때 선적 번호를 보고 올린다 |
| 파일 머리글이 짐작과 다름 | 칸 잇기 화면. 필수 칸(입고 요청 번호)이 없으면 올리지 않는다 |
| 개인정보 | 주문·수령인 자료는 받지 않는다. 입고 파일의 담당자 이름 칸 등은 읽지 않고 원문(`raw`)에도 우리가 고른 칸만 남긴다 |

## 11. 사람이 정할 일

1. **쿠팡 문서 원문 확인**(이 환경에서 못 열었다): 키 발급 절차·연동 방식·IP 조건 · HMAC 예시 값 · 호출 제한 · 로켓그로스 입고/바코드/반출 API 유무.
2. **WING 입고 목록 엑셀 실물 한 장**(개인정보 지운 것)으로 머리글 별칭 확정.
3. **쿠팡 연동 업체(솔루션사) 등록 창구** 문의 — 절차·준비물·기간·심사 기준, 입고 기능을 파트너에게 따로 여는지.
4. **고정 IP** — 자체개발 방식에 IP 가 필수인지, 필수면 나가는 호출을 어디로 모을지(비용).
5. **폐기한 키 암호문을 DB 에서 없앨지**(암호 파쇄/칸 비우기 — 지우는 SQL 이 필요).
6. **암호화 키 관리** — 누가 만들고 어디에 두고, 바꿀 때 옛 암호문을 어떻게 다시 잠글지.
7. **약관 검토** — OPEN API 이용약관의 제3자 보관·재판매 금지·자료 이용 범위. 개인정보 처리방침 개정 문구.
8. **`WING_ENABLED` 를 켤 때** — 1~7 이 끝난 뒤, 미리보기에서 셀러 한 곳으로 먼저.

## 12. 코드 자리

| 자리 | 무엇 |
|---|---|
| `src/lib/wing/sign.ts` | 서명(순수 함수): `wingSignedDate` · `wingMessage` · `wingSignature` · `wingAuthorization` |
| `src/lib/wing/types.ts` | 어댑터 인터페이스 `WingAdapter`, 입고 요청 모양 `WingInbound`, 오류 |
| `src/lib/wing/http.ts` | 실제 HTTP 어댑터 — `WING_ENABLED` 꺼짐이면 부르지 않고 오류, 속도·재시도, GET 만 |
| `src/lib/wing/mock.ts` | 흉내 어댑터 — 시드와 선적 힌트로 같은 입력이면 같은 가짜 입고 요청 |
| `src/lib/wing/crypto.ts` | 키 암호화·풀기(AES-256-GCM), 끝 4자리 |
| `src/lib/wing/import.ts` | 입고 목록 파일의 칸 정의(별칭 · 확인 필요), 줄 검사·정리, FC 이름 → 코드 |
| `src/lib/wing/match.ts` | 짝 제안(순수 함수) · 실측 회송률 |
| `supabase/migrations/0014_wing.sql` | `wing_connections` · `wing_inbound_requests` · `wing_matches` · `wing_access_log`, RLS |
| `src/app/app/integrations/wing/` | 화주 화면 |
| `src/app/actions/wing.ts` | 키 저장·폐기 · 가져오기(흉내·파일·API) · 짝 확정·풀기 · 바코드 올리기 |
| 설정 | `wing.match_rule` · `wing.call_rule` · `wing.key_valid_days` |
| 환경변수 | `WING_ENABLED`(기본 꺼짐) · `WING_KEY_ENCRYPTION_KEY`(이름만 `.env.example`) |

## 출처 (조사일 2026-09-25 · 쿠팡 문서는 검색 요약으로 확인, 원문 확인 필요)

- 쿠팡 Open API — Creating HMAC Signature: https://developers.coupangcorp.com/hc/en-us/articles/360033461914-Creating-HMAC-Signature
- 쿠팡 Open API — Python Example: https://developers.coupangcorp.com/hc/en-us/articles/360033396034-Python-Example
- 쿠팡 개발자 센터 — HMAC Signature 생성: https://developers.coupang.com/ko/getting-started/creating-hmac-signature
- 쿠팡 Open API — Introduction of Open API rate limit policy: https://developers.coupangcorp.com/hc/en-us/articles/20414599556889-Introduction-of-Open-API-rate-limit-policy
- 쿠팡 Open API — Notice on strengthening OpenAPI speed limit policy (2023-10-12): https://developers.coupangcorp.com/hc/en-us/articles/23902034110617
- 쿠팡 — 유효기간 적용을 위한 OPEN API 키 삭제 및 재발급 2차 안내(2023-12-18): https://developers.coupangcorp.com/hc/ko/articles/24404324244249
- 쿠팡 — [구] OPENAPI Key 발급받기: https://developers.coupangcorp.com/hc/ko/articles/360033980613
- 쿠팡 개발자 센터 — 로켓그로스 API 이용 안내: https://developers.coupang.com/ko/getting-started/guide-for-rocket-growth-open-apis
- 쿠팡 개발자 센터 — 로켓창고 재고 API: https://developers.coupang.com/ko/api/rocket-growth/rg-inventory-api
- 쿠팡 Open API — 로켓그로스 주문 API(목록 쿼리): https://developers.coupangcorp.com/hc/ko/articles/41131195825433
- 쿠팡 — 로켓그로스 상품 생성, 관리 API 문서 업데이트 안내(2024-10-31): https://developers.coupangcorp.com/hc/ko/articles/39472584005657
- 쿠팡 — 개발자 포털 변경 및 24 API 국제화 관련 안내(2025-06-26): https://developers.coupangcorp.com/hc/ko/articles/48314250583705
- 쿠팡 파트너 연동 — Create HMAC Signature: https://partner-developers.coupangcorp.com/hc/en-us/articles/360053719371-Create-HMAC-Signature
- 캐시데이터 — 쿠팡 OPEN API 발급 방법: https://cashdata.oopy.io/d48e6920-92bf-4dcf-9902-2a322c63f39f
- 윈셀링 — 쿠팡 API 셋팅하기: https://winselling.co.kr/guide/winshop/open_api/setting_coopang
- 이셀러스 FAQ — 쿠팡 API 신청은 어떻게 하나요?: https://www.esellers.co.kr/cms/faq/detail/22447
- 카페24 — 쿠팡 마켓 OPEN API 키 재발급 대상과 방법: https://support.cafe24.com/hc/ko/articles/29472295175449
- 플레이오토 — 쿠팡 로켓그로스 도움말(입고 생성은 윙에서): https://www.plto.com/customer/HelpDesc/gmp/15503/
- 장사왕 — 로켓그로스 미회송 재고 폐기 정책 안내: https://www.sellerking.io/blog/rocketgross-return-inventory-policy
- RFC 4231 — HMAC-SHA256 시험값: https://www.rfc-editor.org/rfc/rfc4231
