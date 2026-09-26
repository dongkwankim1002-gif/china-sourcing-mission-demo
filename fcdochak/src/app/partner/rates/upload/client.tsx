'use client';
import { useRouter } from 'next/navigation';
import { ExcelImport, type ParsedRow } from '@/components/excel-import';
import { importRateCards } from '@/app/actions/partner';
import { BASES, DEFAULT_BASIS, type RateCardInputT } from '@/lib/schemas';
import { SEGMENTS, SEGMENT_LABEL_KO, SEGMENT_LABEL_ZH } from '@/lib/money/segments';

const SEG_ALIAS: Record<string, string> = Object.fromEntries(
  SEGMENTS.flatMap((s) => [[SEGMENT_LABEL_KO[s].replace(/\s/g, ''), s], [SEGMENT_LABEL_ZH[s].replace(/\s/g, ''), s], [s, s]]),
);
const MODE_ALIAS: Record<string, string> = { lcl: 'LCL', 혼적: 'LCL', 拼箱: 'LCL', ferry: 'FERRY', 카페리: 'FERRY', 客滚船: 'FERRY', fcl: 'FCL', 컨테이너: 'FCL', 整箱: 'FCL', air: 'AIR', 항공: 'AIR', 空运: 'AIR' };
const HUB_ALIAS: Record<string, string> = { 이우: 'YIW', 义乌: 'YIW', 청도: 'QDG', 青岛: 'QDG', 위해: 'WEH', 威海: 'WEH', 연태: 'YNT', 烟台: 'YNT', 일조: 'RZH', 日照: 'RZH', 광저우: 'CAN', 广州: 'CAN', 선전: 'SZX', 深圳: 'SZX' };
const PORT_ALIAS: Record<string, string> = { 인천: 'ICN', 仁川: 'ICN', 평택: 'PTK', 平泽: 'PTK' };

const up = (s: unknown) => String(s ?? '').trim();
const code = (s: unknown, alias: Record<string, string>) => {
  const v = up(s);
  return alias[v] ?? alias[v.toLowerCase()] ?? v.toUpperCase();
};
const ymd = (s: unknown) => {
  const v = up(s).replace(/[./]/g, '-');
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
};

export function UploadClient({ locale }: { locale: 'ko' | 'zh' }) {
  const router = useRouter();
  const zh = locale === 'zh';
  return (
    <ExcelImport
      locale={locale}
      templateName={zh ? '运价表模板' : '요금표-양식'}
      columns={[
        { key: 'card', label: zh ? '运价表编号' : '요금표키', aliases: ['카드', 'card', '编号', 'key'], type: 'string', required: true },
        { key: 'hub', label: zh ? '起运地' : '출발', aliases: ['출발거점', 'origin', '起运'], type: 'string', required: true },
        { key: 'port', label: zh ? '目的港' : '도착항', aliases: ['port', '港口'], type: 'string', required: true },
        { key: 'mode', label: zh ? '方式' : '방식', aliases: ['운송방식', 'mode', '运输方式'], type: 'string', required: true },
        { key: 'from', label: zh ? '有效期起' : '유효시작', aliases: ['from', '开始'], type: 'string', required: true },
        { key: 'to', label: zh ? '有效期至' : '유효끝', aliases: ['to', '结束', '截止'], type: 'string', required: true },
        { key: 'tmin', label: zh ? '时效最短' : '기간최소', aliases: ['tmin', '最短'], type: 'number', required: true },
        { key: 'tmax', label: zh ? '时效最长' : '기간최대', aliases: ['tmax', '最长'], type: 'number', required: true },
        { key: 'segment', label: zh ? '区段' : '구간', aliases: ['segment', '段'], type: 'string', required: true },
        { key: 'included', label: zh ? '包含' : '포함', aliases: ['포함여부', 'included', '是否包含'], type: 'bool', required: true },
        { key: 'basis', label: zh ? '计费方式' : '기준', aliases: ['basis', '计费'], type: 'string' },
        { key: 'price', label: zh ? '单价' : '단가', aliases: ['price', '价格'], type: 'number' },
        { key: 'currency', label: zh ? '币种' : '통화', aliases: ['currency'], type: 'string' },
        { key: 'min', label: zh ? '最低收费' : '최저요금', aliases: ['min'], type: 'number' },
        { key: 'certainty', label: zh ? '确定程度' : '확정도', aliases: ['certainty'], type: 'string' },
      ]}
      validate={(r: ParsedRow) => {
        if (!SEG_ALIAS[up(r.segment).replace(/\s/g, '')]) return zh ? '区段名称不对' : '구간 이름을 알 수 없습니다';
        if (!ymd(r.from) || !ymd(r.to)) return zh ? '日期格式 YYYY-MM-DD' : '날짜는 YYYY-MM-DD';
        if (r.included && !(Number(r.price) > 0)) return zh ? '包含的区段需要单价' : '포함 구간은 단가가 필요합니다';
        if (r.basis && !(BASES as readonly string[]).includes(up(r.basis))) return zh ? '计费方式不对' : `기준은 ${BASES.join('/')} 중 하나`;
        return null;
      }}
      onConfirm={async (rows) => {
        const groups = new Map<string, ParsedRow[]>();
        for (const r of rows) groups.set(up(r.card), [...(groups.get(up(r.card)) ?? []), r]);
        const cards: RateCardInputT[] = [];
        for (const [key, g] of groups) {
          const f = g[0];
          const segs = new Map(g.map((r) => [SEG_ALIAS[up(r.segment).replace(/\s/g, '')], r]));
          const missing = SEGMENTS.filter((s) => !segs.has(s));
          if (missing.length) return { ok: false, error: `${key}: ${zh ? '缺少区段' : '빠진 구간'} ${missing.map((s) => (zh ? SEGMENT_LABEL_ZH : SEGMENT_LABEL_KO)[s]).join(', ')} — ${zh ? '九段都要写「包含/不含」' : '9구간 모두 포함/제외를 적어야 합니다'}` };
          cards.push({
            hub: code(f.hub, HUB_ALIAS),
            port: code(f.port, PORT_ALIAS) as 'ICN',
            mode: code(f.mode, MODE_ALIAS) as 'LCL',
            validFrom: ymd(f.from),
            validTo: ymd(f.to),
            transitMin: Number(f.tmin),
            transitMax: Number(f.tmax),
            certainty: 'confirmed',
            fuelSeparate: false,
            isPublicPrice: false,
            tiers: [],
            lines: SEGMENTS.map((s) => {
              const r = segs.get(s)!;
              const cur = up(r.currency).toUpperCase();
              const cert = up(r.certainty);
              return {
                segment: s,
                included: r.included as boolean,
                basis: ((BASES as readonly string[]).includes(up(r.basis)) ? up(r.basis) : DEFAULT_BASIS[s]) as RateCardInputT['lines'][number]['basis'],
                unitPrice: r.included ? Number(r.price) : 0,
                currency: (['KRW', 'RMB', 'USD'].includes(cur) ? cur : 'KRW') as 'KRW',
                minCharge: r.min == null ? null : Number(r.min),
                certainty: (cert === '예상' || cert === '预估' || cert === 'estimated' ? 'estimated' : cert === '추가비용 가능' || cert === '可能加收' || cert === 'extra_possible' ? 'extra_possible' : 'confirmed') as 'confirmed',
              };
            }),
          });
        }
        const r = await importRateCards(cards);
        if (r.ok) router.refresh();
        return { ok: r.ok, error: r.error, created: r.data?.created };
      }}
    />
  );
}
