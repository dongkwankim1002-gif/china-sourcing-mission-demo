'use client';
/**
 * 황해 항로 지도 — 선택한 출발지 → 수출항 → 인천/평택 → 쿠팡 FC.
 * 해안선은 손으로 줄인 근사(0.1° 안팎). 장식이 아니라 「어디서 어디로」를 보여주는 도식이다.
 * 움직임은 입력이 바뀔 때 경로가 새로 그려지는 것 하나뿐(동작 줄이기면 없음).
 */
import * as React from 'react';

const W = 504;
const H = 640;
const LON0 = 112;
const LAT0 = 40.5;
const K = 28;
const KY = 1.2;
export const px = (lon: number, lat: number): [number, number] => [(lon - LON0) * K, (LAT0 - lat) * K * KY];

const COAST: [number, number][] = [
  [112, 21.5], [112, 21.8], [113.0, 22.1], [113.55, 22.2], [114.3, 22.5], [115.5, 22.8], [116.7, 23.35], [118.1, 24.45],
  [119.0, 25.3], [119.6, 26.0], [120.0, 26.8], [120.9, 27.9], [121.6, 28.7], [122.0, 29.9], [121.3, 30.35], [121.9, 31.0],
  [121.8, 31.7], [121.9, 31.9], [120.9, 32.7], [120.3, 33.8], [119.4, 34.7], [119.6, 35.3], [120.3, 35.9], [120.9, 36.4],
  [121.6, 36.75], [122.4, 36.9], [122.7, 37.4], [122.1, 37.55], [121.4, 37.55], [120.8, 37.8], [120.3, 37.65], [119.9, 37.2],
  [119.2, 37.15], [119.0, 37.8], [118.4, 38.2], [117.7, 38.95], [118.5, 39.2], [119.6, 39.9], [120.6, 40.4], [121.0, 40.5],
  [121.2, 40.0], [121.5, 39.4], [121.2, 38.8], [122.2, 39.3], [123.0, 39.6], [124.3, 39.9], [124.8, 39.6], [125.3, 38.7],
  [124.9, 38.2], [125.6, 37.8], [126.1, 37.75], [126.6, 37.45], [126.5, 37.0], [126.15, 36.75], [126.5, 36.3], [126.6, 35.95],
  [126.4, 35.4], [126.35, 34.8], [126.5, 34.3], [127.3, 34.5], [127.75, 34.75], [128.4, 34.85], [129.05, 35.1], [129.45, 35.9],
  [129.4, 37.1], [128.9, 37.8], [128.3, 38.7], [127.6, 39.7], [127.8, 40.5], [112, 40.5],
];
const TAIWAN: [number, number][] = [
  [120.1, 23.0], [120.3, 22.5], [120.7, 22.0], [121.0, 22.3], [121.5, 23.5], [121.9, 24.6], [121.6, 25.3], [121.0, 25.0], [120.6, 24.4], [120.2, 23.6],
];

const path = (pts: [number, number][]) => 'M' + pts.map(([lo, la]) => px(lo, la).map((v) => v.toFixed(1)).join(',')).join('L') + 'Z';
const LAND = path(COAST);
const TW = path(TAIWAN);

export const HUB_POS: Record<string, { lon: number; lat: number; name: string; exportPort: [number, number]; exportName: string }> = {
  YIW: { lon: 120.08, lat: 29.31, name: '이우', exportPort: [121.85, 29.93], exportName: '닝보' },
  QDG: { lon: 120.38, lat: 36.07, name: '청도', exportPort: [120.32, 36.02], exportName: '청도항' },
  WEH: { lon: 122.12, lat: 37.51, name: '위해', exportPort: [122.16, 37.49], exportName: '위해항' },
  YNT: { lon: 121.45, lat: 37.46, name: '연태', exportPort: [121.45, 37.56], exportName: '연태항' },
  RZH: { lon: 119.53, lat: 35.42, name: '일조', exportPort: [119.58, 35.36], exportName: '일조항' },
  CAN: { lon: 113.26, lat: 23.13, name: '광저우', exportPort: [113.62, 22.75], exportName: '난사' },
  SZX: { lon: 114.06, lat: 22.54, name: '선전', exportPort: [114.28, 22.58], exportName: '옌톈' },
};
export const PORT_POS: Record<string, { lon: number; lat: number; name: string }> = {
  ICN: { lon: 126.6, lat: 37.45, name: '인천' },
  PTK: { lon: 126.83, lat: 36.97, name: '평택' },
};
export const FC_POS: Record<string, { lon: number; lat: number; name: string }> = {
  'FC-ICN': { lon: 126.7, lat: 37.5, name: '인천 FC' },
  'FC-GOY': { lon: 126.83, lat: 37.66, name: '고양 FC' },
  'FC-ICH': { lon: 127.44, lat: 37.27, name: '이천 FC' },
  'FC-DPG': { lon: 127.35, lat: 37.23, name: '덕평 FC' },
  'FC-DTN': { lon: 127.08, lat: 37.2, name: '동탄 FC' },
  'FC-PTK': { lon: 126.99, lat: 36.99, name: '평택 FC' },
  'FC-CAN': { lon: 127.15, lat: 36.8, name: '천안 FC' },
  'FC-DGU': { lon: 128.6, lat: 35.87, name: '대구 FC' },
  'FC-CWN': { lon: 128.68, lat: 35.23, name: '창원 FC' },
  'FC-GWJ': { lon: 126.85, lat: 35.16, name: '광주 FC' },
};

function seaCurve(a: [number, number], b: [number, number], bend = 0.18) {
  const [x1, y1] = a;
  const [x2, y2] = b;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  // 바다 쪽(오른쪽 아래)으로 부풀린다
  const cx = mx + dy * bend;
  const cy = my - dx * bend;
  return `M${x1.toFixed(1)},${y1.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
}

export function SeaMap({
  hub,
  port,
  fc,
  mode,
  className,
}: {
  hub: string;
  port: string;
  fc: string;
  mode: string | null;
  className?: string;
}) {
  const h = HUB_POS[hub] ?? HUB_POS.YIW;
  const p = PORT_POS[port] ?? PORT_POS.ICN;
  const f = FC_POS[fc] ?? FC_POS['FC-ICH'];
  const hubXY = px(h.lon, h.lat);
  const expXY = px(...h.exportPort);
  const portXY = px(p.lon, p.lat);
  const fcXY = px(f.lon, f.lat);
  const air = mode === 'AIR';
  const sea = air ? `M${hubXY[0]},${hubXY[1]} L${portXY[0]},${portXY[1]}` : seaCurve(expXY, portXY, hub === 'YIW' || hub === 'CAN' || hub === 'SZX' ? 0.22 : 0.12);
  const key = `${hub}-${port}-${fc}-${mode}`;
  const grid = [];
  for (let lon = 115; lon <= 130; lon += 5) grid.push(<line key={'lo' + lon} x1={px(lon, 0)[0]} x2={px(lon, 0)[0]} y1={0} y2={H} />);
  for (let lat = 25; lat <= 40; lat += 5) grid.push(<line key={'la' + lat} y1={px(0, lat)[1]} y2={px(0, lat)[1]} x1={0} x2={W} />);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={`${h.name} → ${h.exportName} → ${p.name}항 → ${f.name} 경로`}>
      <defs>
        <pattern id="sea-dots" width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r="0.8" fill="currentColor" opacity="0.10" />
        </pattern>
      </defs>
      <rect width={W} height={H} fill="url(#sea-dots)" className="text-on-ink" />
      <g stroke="currentColor" strokeWidth="0.6" opacity="0.10" className="text-on-ink">
        {grid}
      </g>
      <path d={LAND} className="fill-white/[0.07] stroke-white/25" strokeWidth="1" />
      <path d={TW} className="fill-white/[0.07] stroke-white/25" strokeWidth="1" />
      <ellipse cx={px(126.55, 33.38)[0]} cy={px(126.55, 33.38)[1]} rx={10} ry={5} className="fill-white/[0.07] stroke-white/25" />
      <text x={px(120.75, 34.1)[0]} y={px(120.75, 34.1)[1]} className="fill-on-ink-muted" fontSize="13" letterSpacing="6" opacity="0.6">황해</text>
      <text x={px(125.5, 30.5)[0]} y={px(125.5, 30.5)[1]} className="fill-on-ink-muted" fontSize="11" letterSpacing="4" opacity="0.45">동중국해</text>

      {/* 다른 거점 */}
      {Object.entries(HUB_POS).map(([code, v]) => {
        const [x, y] = px(v.lon, v.lat);
        const on = code === hub;
        const right = code === 'WEH' || code === 'CAN' || code === 'SZX';
        const dy = code === 'YNT' ? -6 : code === 'SZX' ? 12 : 4;
        return (
          <g key={code} opacity={on ? 1 : 0.55}>
            <circle cx={x} cy={y} r={on ? 5 : 3} className={on ? 'fill-label' : 'fill-on-ink-muted'} />
            <text x={right ? x + 8 : x - 8} y={y + dy} textAnchor={right ? 'start' : 'end'} fontSize={on ? 13 : 11} fontWeight={on ? 700 : 500} className={on ? 'fill-on-ink' : 'fill-on-ink-muted'}>
              {v.name}
            </text>
          </g>
        );
      })}

      <g key={key} className="[&_path]:motion-safe:animate-[fcd-draw_700ms_ease-out_both]">
        {!air && hub !== 'QDG' && hub !== 'WEH' && hub !== 'YNT' && hub !== 'RZH' ? (
          <path d={`M${hubXY[0]},${hubXY[1]} L${expXY[0]},${expXY[1]}`} stroke="var(--label)" strokeWidth="2" strokeDasharray="3 4" fill="none" />
        ) : null}
        <path d={sea} stroke="var(--label)" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeDasharray={air ? '1 6' : undefined} />
        <path d={`M${portXY[0]},${portXY[1]} L${fcXY[0]},${fcXY[1]}`} stroke="var(--label)" strokeWidth="2" strokeDasharray="3 4" fill="none" />
      </g>
      <circle cx={portXY[0]} cy={portXY[1]} r={5} className="fill-ink stroke-label" strokeWidth="2.5" />
      <text x={portXY[0] - 9} y={portXY[1] - 8} textAnchor="end" fontSize="13" fontWeight="700" className="fill-on-ink">
        {p.name}항
      </text>
      <rect x={fcXY[0] - 5} y={fcXY[1] - 5} width={10} height={10} rx={2} className="fill-label" />
      <text x={fcXY[0] + 9} y={fcXY[1] + 4} fontSize="12" fontWeight="700" className="fill-on-ink">
        {f.name}
      </text>
    </svg>
  );
}
