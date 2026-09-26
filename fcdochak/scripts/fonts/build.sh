#!/bin/sh
# 글꼴 묶음 만들기 — Pretendard Variable · Black Han Sans 를 KS X 1001 한글 2,350자 + 라틴·기호로 한 파일씩 줄인다.
# 조각 수십 개(unicode-range) 대신 한 파일: 조각마다 드는 배치 비용이 커서 모바일 성능이 크게 떨어졌다(docs/DECISIONS.md).
# 필요: pip install fonttools brotli · 원본: node_modules/pretendard, Google Fonts(OFL) Black Han Sans
set -e
cd "$(dirname "$0")/../.."
OUT=public/fonts/fcd
TMP=$(mktemp -d)
python3 -c "
ks=[chr(c) for c in range(0xAC00,0xD7A4) if (lambda b: len(b)==2 and 0xB0<=b[0]<=0xC8)(chr(c).encode('euc-kr'))]
open('$TMP/ks.txt','w').write(''.join(ks))"
UNI="U+0020-007E,U+00A0-00FF,U+2000-206F,U+20A9,U+2190-21FF,U+2460-24FF,U+2500-257F,U+25A0-25FF,U+2605-2606,U+3000-303F,U+3131-318E,U+FF01-FF5E,U+2212"
curl -sSL -o "$TMP/BlackHanSans-Regular.ttf" https://raw.githubusercontent.com/google/fonts/main/ofl/blackhansans/BlackHanSans-Regular.ttf
mkdir -p "$OUT"
pyftsubset node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2 --text-file="$TMP/ks.txt" --unicodes="$UNI" \
  --flavor=woff2 --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk,tnum,ss06,case,frac,sups' --output-file="$OUT/PretendardVariable.ks.woff2"
pyftsubset "$TMP/BlackHanSans-Regular.ttf" --text-file="$TMP/ks.txt" --unicodes="$UNI" \
  --flavor=woff2 --layout-features='kern,liga,calt,ccmp,locl' --output-file="$OUT/BlackHanSans.ks.woff2"
rm -rf "$TMP"
ls -la "$OUT"
