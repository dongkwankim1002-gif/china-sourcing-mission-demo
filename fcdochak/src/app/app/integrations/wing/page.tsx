import Link from 'next/link';
import { asUser, todayKst } from '@/lib/db';
import { env } from '@/lib/env';
import { requireViewer } from '@/lib/server/viewer';
import { ACCESS_ACTION_LABEL, accessLog, coupangFcs, currentConnection, currentMatches, listInbound, wingSettings, wingShipments } from '@/lib/server/wing';
import { WingKeyPanel, type KeyView } from '@/components/wing/key-form';
import { WingImportPanel } from '@/components/wing/import-panel';
import { WingInboundList, type InboundItem } from '@/components/wing/inbound-list';
import { Chip, PageTitle, Panel, PanelHead } from '@/components/ui/core';
import { dateTimeKo, num } from '@/lib/format';
import { measuredReturnRate, reasonText, suggestMatches } from '@/lib/wing/match';
import { keyExpiry, keyExpiryState } from '@/lib/wing/settings';
import { consentOk, egressIps, latestConsent } from '@/lib/server/sales'; // v2 3차 sales
import { ensureKeyExpiryAlert } from '@/lib/server/sales-alerts';
import { WingSetupGuide } from '@/components/sales/wing-guide';
import { ConsentPanel } from '@/components/sales/consent-panel';
import { ConnectionTestPanel } from '@/components/sales/connection-test';

export const metadata = { title: '쿠팡 WING 연동' };

export default async function WingPage() {
  const v = await requireViewer('app');
  const today = todayKst();
  const d = await asUser(v, async (q) => ({
    conn: await currentConnection(q, v.org.id),
    inbound: await listInbound(q, v.org.id),
    matches: await currentMatches(q, v.org.id),
    ships: await wingShipments(q, v.org.id),
    log: await accessLog(q, v.org.id),
    set: await wingSettings(q),
    fcs: await coupangFcs(q),
    consent: await latestConsent(q, v.org.id), // v2 3차 sales
    ips: await egressIps(q),
  }));
  // v2 3차 sales — 만료 D-(wing.key_warn_days) 알림을 알림함에 한 번(발송 없음)
  const expiryAlert = await ensureKeyExpiryAlert(v.org.id, d.conn, d.set, today);
  const consented = consentOk(d.consent);
  const canManage = v.org.role === 'shipper_admin';
  const live = !!d.conn?.has_key;
  const shipById = new Map(d.ships.map((s) => [s.id, s]));
  const confirmed = new Map(d.matches.filter((m) => m.action === 'confirmed' && m.shipment_id).map((m) => [m.external_no, m.shipment_id!]));
  const idByNo = new Map(d.inbound.map((i) => [i.external_no, i.id]));
  const taken = new Map([...confirmed].filter(([no]) => idByNo.has(no)).map(([no, sid]) => [idByNo.get(no)!, sid]));
  const sugg = suggestMatches(
    d.inbound.map((i) => ({ id: i.id, externalNo: i.external_no, fcCode: i.fc_code, plannedOn: i.planned_on, units: i.units, boxes: i.boxes })),
    d.ships.map((s) => ({ id: s.id, shipmentNo: s.shipment_no, fcCode: s.fc_code, etaFc: s.eta_fc, units: s.units, cartons: s.cartons })),
    d.set.match,
    taken,
  );
  const suggById = new Map(sugg.map((s) => [s.inboundId, s]));
  const fcName = new Map(d.fcs.map((f) => [f.code, f.name]));
  const items: InboundItem[] = d.inbound.map((i) => {
    const sid = confirmed.get(i.external_no);
    const s = sid ? shipById.get(sid) : undefined;
    const g = suggById.get(i.id)?.best;
    const m = d.matches.find((x) => x.external_no === i.external_no);
    return {
      externalNo: i.external_no,
      source: i.source,
      centerName: i.center_name,
      fcName: i.fc_code ? (fcName.get(i.fc_code) ?? i.fc_code) : null,
      plannedOn: i.planned_on,
      skuCount: i.sku_count,
      units: i.units,
      boxes: i.boxes,
      statusRaw: i.status_raw,
      receivedUnits: i.received_units,
      returnedUnits: i.returned_units,
      version: i.version,
      match: sid ? { shipmentId: sid, shipmentNo: s?.shipment_no ?? '선적', stage: s?.stage ?? 1, hasBarcode: !!s?.has_barcode, score: m?.score ?? null } : null,
      suggestion: g ? { shipmentId: g.shipmentId, shipmentNo: g.shipmentNo, score: g.score, why: reasonText(g.reason) } : null,
    };
  });
  const matchedWithResult = d.inbound.filter((i) => confirmed.has(i.external_no) && (i.received_units != null || i.returned_units != null));
  const rate = measuredReturnRate(matchedWithResult.map((i) => ({ receivedUnits: i.received_units, returnedUnits: i.returned_units })));
  const expiresOn = d.conn ? keyExpiry(d.conn.issued_on, d.set.keyValidDays) : null;
  const key: KeyView | null = d.conn
    ? {
        method: d.conn.method,
        status: d.conn.status,
        vendorLast4: d.conn.vendor_last4,
        accessLast4: d.conn.access_last4,
        issuedOn: d.conn.issued_on,
        expiresOn,
        expiry: keyExpiryState(expiresOn, today, d.set.keyWarnDays),
        version: d.conn.version,
        savedAt: d.conn.created_at,
        who: d.conn.who,
      }
    : null;
  const shipOptions = d.ships.filter((s) => ![...confirmed.values()].includes(s.id)).map((s) => ({ id: s.id, label: `${s.shipment_no} · ${s.fc_name} · ${num(s.units)}개${s.eta_fc ? ` · ${s.eta_fc.slice(5)} 도착 예정` : ''}` }));

  return (
    <>
      <PageTitle
        title="쿠팡 WING 연동"
        sub="쿠팡 API 를 맡기는 법(단계 안내) · 입고 요청을 선적과 짝 · 바코드 PDF 는 서류함으로 · 맡긴 키로 판매 분석을 엽니다. 읽기만 합니다."
        actions={
          <>
            {env.wingEnabled ? <Chip tone="ok">연동 켜짐</Chip> : <Chip tone="caution">연동 준비 중</Chip>}
            <Link className="text-sm font-semibold text-text underline-offset-2 hover:underline" href="/app/sales">
              판매 분석 보기
            </Link>
          </>
        }
      />
      {expiryAlert ? (
        <p role="status" data-testid="wing-expiry-alert" className={`mb-4 rounded-md border px-4 py-3 text-sm font-semibold ${expiryAlert.kind === 'expired' ? 'border-stamp/40 bg-stamp-bg text-stamp' : 'border-caution/40 bg-caution-bg text-caution'}`}>
          {expiryAlert.title} — {expiryAlert.body} (알림함에도 남겼습니다 · 메일·문자는 보내지 않습니다)
        </p>
      ) : null}
      <div className="mb-6">
        <WingSetupGuide egressIps={d.ips} consented={consented} hasKey={live} verified={d.conn?.status === 'verified'} validDays={d.set.keyValidDays} warnDays={d.set.keyWarnDays} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-w-0 content-start gap-4">
          <WingImportPanel demo={v.org.is_demo} enabled={env.wingEnabled} />
          <Panel aria-labelledby="wl-h">
            <PanelHead
              id="wl-h"
              title={`가져온 입고 요청 ${d.inbound.length}건`}
              sub={`짝 ${confirmed.size}건 · 제안은 FC·입고 예정일·수량으로 셈합니다(${d.set.match.minScore}점 이상). 자동으로 확정하지 않습니다.`}
            />
            <WingInboundList items={items} shipments={shipOptions} />
          </Panel>
          <Panel aria-labelledby="wr-h">
            <PanelHead id="wr-h" title="실측 회송률" sub="짝 맞은 입고 요청의 쿠팡 입고 결과 기준 — 물류사가 선적에 적은 회송 수량과 나란히" />
            {rate.rows ? (
              <div className="grid gap-3 p-4" data-testid="wing-return-rate">
                <p className="text-sm">
                  <b className="tnum">{rate.rateBp == null ? '—' : `${(rate.rateBp / 100).toFixed(2)}%`}</b>
                  <span className="text-muted tnum"> · 입고 {num(rate.received)}개 · 회송 {num(rate.returned)}개 · {rate.rows}건</span>
                </p>
                <ul className="divide-y divide-line-2 rounded-sm border border-line-2 text-xs">
                  {matchedWithResult.map((i) => {
                    const s = shipById.get(confirmed.get(i.external_no)!);
                    const diff = s ? (i.returned_units ?? 0) - s.fc_returned_units : 0;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 tnum">
                        <span className="font-mono">{i.external_no}</span>
                        <span>{s ? <Link className="font-semibold hover:underline" href={`/app/shipments/${s.id}`}>{s.shipment_no}</Link> : '—'}</span>
                        <span>쿠팡 회송 {num(i.returned_units ?? 0)}개</span>
                        <span className="text-muted">물류사 기록 {num(s?.fc_returned_units ?? 0)}개</span>
                        {diff !== 0 ? <Chip tone="caution">{diff > 0 ? `쿠팡 기록이 ${num(diff)}개 많음` : `물류사 기록이 ${num(-diff)}개 많음`}</Chip> : null}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-xs text-muted">추천 점수의 「FC 회송」은 아직 물류사 기록으로 셉니다. 쿠팡 기록으로 바꾸는 것은 다음 단계에서 합니다.</p>
              </div>
            ) : (
              <p className="px-4 py-4 text-sm text-muted">짝 맞은 입고 요청에 입고 결과(입고·회송 수량)가 아직 없습니다.</p>
            )}
          </Panel>
        </div>
        <div className="grid min-w-0 content-start gap-4">
          <ConsentPanel consented={consented} at={d.consent?.agreed ? d.consent.created_at : null} who={d.consent?.agreed ? d.consent.who : null} canManage={canManage} />
          {consented || live || !canManage ? (
          <WingKeyPanel current={key} canStore={!!env.wingKeyEncryptionKey} enabled={env.wingEnabled} today={today} warnDays={d.set.keyWarnDays} canManage={canManage} />
          ) : (
            <p className="rounded-md border border-dashed border-line px-4 py-3 text-sm text-muted" data-testid="wing-key-needs-consent">
              위 「읽는 것 · 하지 않는 것」에 동의하면 WING 키 칸이 열립니다.
            </p>
          )}
          <ConnectionTestPanel testMode={!env.wingEnabled || v.org.is_demo} />
          <Panel aria-labelledby="wa-h">
            <PanelHead id="wa-h" title="접근 기록" sub="키 저장·꺼냄·가져오기·짝 — 키 값은 적지 않습니다" />
            {d.log.length ? (
              <ul className="divide-y divide-line-2" data-testid="wing-access-log">
                {d.log.map((l, n) => (
                  <li key={n} className="flex flex-wrap items-baseline justify-between gap-x-2 px-4 py-2 text-xs">
                    <span className="font-semibold">{ACCESS_ACTION_LABEL[l.action] ?? l.action}</span>
                    <span className="text-muted">
                      {dateTimeKo(l.created_at)}
                      {l.who ? ` · ${l.who}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">아직 기록이 없습니다.</p>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
