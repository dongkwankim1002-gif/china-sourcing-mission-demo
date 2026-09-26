# 통관알리미(7customs.com) 분석 — 조사 불가 기록

- 조사일: 2026-09-26 (KST)
- 결과: **조사 중단 — 컨테이너 네트워크가 대상 사이트를 막고 있음.** 지시에 따라 차단 사실만 기록한다.
- 이 문서에는 7customs.com·UNI-PASS·스토어에 대한 확인된 사실이 **하나도 없다.** 기억이나 추정으로 칸을 채우지 않았다.

## 1. 확인 방법과 결과

`curl -sI https://7customs.com` 및 각 대상 주소에 1회씩 접속을 시도했다(요청 총 8회, 쓰기 행동 없음).

| 대상 | 결과 |
|---|---|
| https://7customs.com | 프록시가 CONNECT 에 403 (정책 거부) |
| https://www.7customs.com | 403 (정책 거부) |
| https://unipass.customs.go.kr | 403 (정책 거부) |
| https://play.google.com | 403 (정책 거부) |
| https://apps.apple.com | 403 (정책 거부) |
| https://chromewebstore.google.com | 403 (정책 거부) |
| https://www.google.com | 403 (정책 거부) |

프록시 상태 기록 원문(발췌):

```
"kind": "connect_rejected",
"detail": "gateway answered 403 to CONNECT (policy denial or upstream failure)",
"host": "7customs.com:443"
```

결론: 이 클라우드 환경의 네트워크 정책이 위 도메인을 허용하지 않는다. 사이트 쪽 차단이 아니라 **환경 설정 문제**다. Playwright 도 같은 프록시를 쓰므로 브라우저로도 열 수 없다(시도하지 않음).

## 2. 조사하지 못한 항목 (전부 미확인)

1. 조회 결과 화면의 「업체정보」 출처(HTML/API), 관세청 응답 칸 이름
2. 관세사무소 상세(/customs-office/{id})
3. 통계 페이지(/statistics, /statistics/tracking, /statistics/delivery, /ports, /forwarder/{코드}/1)의 기준 문구·기간·표본 수·차트 로더 경로
4. 사용법·FAQ·약관·개인정보처리방침·제휴문의의 데이터 출처·운영사 정보
5. 수익 구조(광고 스크립트, 제휴 링크, /payment 가격, /freight)
6. 크롬 확장 설명·권한·사용자 수
7. 구글 플레이(com.trandent.hkh.customs)·앱스토어(id1456720251) 지표
8. UNI-PASS 오픈API 목록·연계가이드(API001 응답 칸)
9. 결론(업체별 통계·관세사 정보의 원천, 자료 증식 구조, 수익 구조, FC도착 시사점) — **근거 없음으로 작성하지 않음**

## 3. 다시 하려면

클라우드 환경 설정(세션 제목 표시줄의 환경 메뉴 → Edit → Network access)에서 접근 수준을 넓히거나 다음 도메인을 허용 목록에 추가한 뒤 같은 지시로 다시 실행한다.

- 7customs.com, www.7customs.com
- unipass.customs.go.kr
- play.google.com, apps.apple.com, chromewebstore.google.com
- (광고·차트 스크립트 확인용) 사이트가 불러오는 외부 도메인 — 전체 허용이 아니면 일부 네트워크 응답이 빠질 수 있음

참고: https://code.claude.com/docs/en/claude-code-on-the-web
