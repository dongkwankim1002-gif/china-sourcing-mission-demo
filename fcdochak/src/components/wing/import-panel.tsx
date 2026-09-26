'use client';
/**
 * 입고 요청 가져오기 — ① WING 에서 내려받은 파일(엑셀·CSV, 칸 잇기) ② 예시(데모 계정만, 흉내 어댑터) ③ WING 에서 바로(스위치 꺼짐이면 「연동 준비 중」).
 */
import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { CloudDownload, FlaskConical, Upload } from 'lucide-react';
import { importWingFile, importWingMock, syncWingApi } from '@/app/actions/wing';
import { ExcelImport, type ImportColumn } from '@/components/excel-import';
import { Button, Panel, PanelHead } from '@/components/ui/core';
import { WING_ACTION } from '@/lib/terms';
import { WING_IMPORT_COLUMNS } from '@/lib/wing/import';

const COLUMNS: ImportColumn[] = WING_IMPORT_COLUMNS.map((c) => ({ key: c.key, label: c.label, aliases: c.aliases, type: c.type, required: c.required }));

export function WingImportPanel({ demo, enabled }: { demo: boolean; enabled: boolean }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const summary = (d?: { created: number; updated: number; skipped: number }) => (d ? `새로 ${d.created}건 · 바뀜 ${d.updated}건 · 그대로 ${d.skipped}건` : undefined);

  return (
    <Panel aria-labelledby="wi-h">
      <PanelHead
        id="wi-h"
        title="입고 요청 가져오기"
        sub="읽기만 합니다 — FC도착은 쿠팡에 입고 요청을 만들거나 고치지 않습니다."
      />
      <div className="flex flex-wrap gap-2 px-4 py-3">
        <Button variant="secondary" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Upload aria-hidden /> {WING_ACTION.importFile}
        </Button>
        {demo ? (
          <Button
            variant="secondary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await importWingMock();
                if (r.ok) {
                  toast.success('예시 입고 요청을 가져왔습니다', { description: summary(r.data) });
                  router.refresh();
                } else toast.error(r.error ?? '가져오지 못했습니다');
              })
            }
          >
            <FlaskConical aria-hidden /> {WING_ACTION.importMock}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await syncWingApi();
              if (r.ok) {
                toast.success('WING 에서 가져왔습니다', { description: summary(r.data) });
                router.refresh();
              } else toast.message(r.error ?? '가져오지 못했습니다');
            })
          }
        >
          <CloudDownload aria-hidden /> {WING_ACTION.syncApi}
        </Button>
        {!enabled ? <span className="self-center text-2xs text-muted">바로 가져오기는 연동이 켜진 뒤에 됩니다(지금은 파일 올리기)</span> : null}
      </div>
      {open ? (
        <div className="grid min-w-0 gap-3 border-t border-line-2 p-4 [&>*]:min-w-0" data-testid="wing-file-import">
          <ol className="list-decimal pl-5 text-xs text-muted">
            <li>WING → 로켓그로스 입고 관리에서 입고 목록을 엑셀로 내려받습니다(메뉴 이름은 확인 필요).</li>
            <li>그 파일을 아래에 끌어놓습니다. 머리글을 알아보지 못한 칸은 「칸 잇기」에서 고릅니다.</li>
            <li>미리보기에서 줄별 오류를 보고 확정합니다. 같은 입고 요청 번호를 다시 올리면 바뀐 줄만 새 판으로 쌓입니다.</li>
          </ol>
          <ExcelImport
            columns={COLUMNS}
            templateName="WING-입고목록-양식"
            allowMapping
            mappingNote={
              <>
                <b className="text-caution">열 이름 확인 필요</b> — WING 파일 실물을 아직 보지 못해 머리글 이름은 짐작한 별칭입니다. 필수는 「입고 요청 번호」 하나입니다.
              </>
            }
            validate={(row) => (row.externalNo && !/^[A-Za-z0-9][A-Za-z0-9_-]{2,39}$/.test(String(row.externalNo)) ? '입고 요청 번호는 영문·숫자 3~40자입니다' : null)}
            onConfirm={async (rows) => {
              const r = await importWingFile(rows);
              if (!r.ok || !r.data) return { ok: false, error: r.error };
              if (r.data.errors.length) toast.message(`${r.data.errors.length}줄은 올리지 못했습니다`, { description: `${r.data.errors[0].line}줄: ${r.data.errors[0].error}` });
              toast.success('입고 요청을 올렸습니다', { description: summary(r.data) });
              router.refresh();
              return { ok: true, created: r.data.created + r.data.updated };
            }}
          />
        </div>
      ) : null}
    </Panel>
  );
}
