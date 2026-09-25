'use client';
/**
 * 엑셀 올리기 — 끌어놓기 → 미리보기 → 줄별 오류 → 확정.
 * .xlsx(read-excel-file) 와 .csv 를 받는다. 머리글은 한국어·중국어·영문 별칭을 모두 알아본다.
 */
import * as React from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/core';
import { parseLooseNumber } from '@/components/number-field';
import { cn } from '@/lib/cn';

export interface ImportColumn {
  key: string;
  label: string;
  aliases: string[];
  type: 'number' | 'string' | 'bool';
  required?: boolean;
}

export type ParsedRow = Record<string, string | number | boolean | null>;

function norm(s: string) {
  return s.normalize('NFKC').toLowerCase().replace(/[\s_()（）·\-./]/g, '');
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let f = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') {
        f += '"';
        i++;
      } else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',' || c === '\t') {
      cur.push(f);
      f = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cur.push(f);
      rows.push(cur);
      cur = [];
      f = '';
    } else f += c;
  }
  if (f || cur.length) {
    cur.push(f);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export function ExcelImport({
  columns,
  validate,
  onConfirm,
  templateName,
  locale = 'ko',
}: {
  columns: ImportColumn[];
  validate: (row: ParsedRow) => string | null;
  onConfirm: (rows: ParsedRow[]) => Promise<{ ok: boolean; error?: string; created?: number }>;
  templateName: string;
  locale?: 'ko' | 'zh';
}) {
  const zh = locale === 'zh';
  const [drag, setDrag] = React.useState(false);
  const [file, setFile] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<{ row: ParsedRow; error: string | null; line: number }[]>([]);
  const [headerErr, setHeaderErr] = React.useState<string | null>(null);
  const [pending, start] = React.useTransition();
  const [done, setDone] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);

  const read = async (f: File) => {
    setDone(null);
    setHeaderErr(null);
    setFile(f.name);
    let table: unknown[][];
    if (/\.xlsx$/i.test(f.name)) {
      const { readSheet } = await import('read-excel-file/browser');
      table = (await readSheet(f)) as unknown as unknown[][];
    } else {
      table = parseCsv((await f.text()).replace(/^﻿/, ''));
    }
    if (table.length < 2) {
      setRows([]);
      setHeaderErr(zh ? '没有数据行。第一行为表头，第二行起为数据。' : '데이터 줄이 없습니다. 첫 줄은 머리글, 둘째 줄부터 자료입니다.');
      return;
    }
    const head = table[0].map((h) => norm(String(h ?? '')));
    const idx = columns.map((c) => head.findIndex((h) => [c.label, ...c.aliases].map(norm).includes(h)));
    const missing = columns.filter((c, i) => c.required && idx[i] < 0).map((c) => c.label);
    if (missing.length) {
      setRows([]);
      setHeaderErr(`${zh ? '缺少表头' : '머리글이 없습니다'}: ${missing.join(', ')}`);
      return;
    }
    setRows(
      table.slice(1).map((raw, n) => {
        const row: ParsedRow = {};
        let err: string | null = null;
        columns.forEach((c, i) => {
          const v = idx[i] >= 0 ? raw[idx[i]] : null;
          const s = v == null ? '' : String(v).trim();
          if (c.type === 'number') {
            const num = typeof v === 'number' ? v : parseLooseNumber(s);
            if (num == null && c.required) err ??= `${c.label} ${zh ? '不是数字' : '숫자가 아닙니다'}`;
            row[c.key] = num;
          } else if (c.type === 'bool') {
            row[c.key] = ['1', 'y', 'yes', 'true', 'o', '포함', '예', '是', '包含', 'include'].includes(s.toLowerCase()) ? true : ['0', 'n', 'no', 'false', 'x', '제외', '아니오', '否', '不含', 'exclude'].includes(s.toLowerCase()) ? false : null;
            if (row[c.key] == null && c.required) err ??= `${c.label} ${zh ? '请填 包含/不含' : '포함/제외를 적어 주세요'}`;
          } else {
            row[c.key] = s || null;
            if (!s && c.required) err ??= `${c.label} ${zh ? '为空' : '이(가) 비었습니다'}`;
          }
        });
        return { row, error: err ?? validate(row), line: n + 2 };
      }),
    );
  };

  const good = rows.filter((r) => !r.error);
  const bad = rows.filter((r) => r.error);
  const template = () => {
    const csv = '﻿' + columns.map((c) => c.label).join(',') + '\r\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `${templateName}.csv`;
    a.click();
  };

  return (
    <div className="grid gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) void read(f);
        }}
        className={cn('grid place-items-center gap-2 rounded-md border-2 border-dashed px-6 py-10 text-center', drag ? 'border-label bg-label/10' : 'border-line bg-surface')}
      >
        <UploadCloud className="size-7 text-muted" aria-hidden />
        <p className="text-sm font-semibold">{zh ? '把 Excel(.xlsx) 或 CSV 文件拖到这里' : '엑셀(.xlsx)이나 CSV 파일을 여기에 끌어놓으세요'}</p>
        <p className="text-xs text-muted">{zh ? '第一行是表头。支持中韩英表头。' : '첫 줄은 머리글입니다. 한국어·중국어·영문 머리글을 모두 알아봅니다.'}</p>
        <div className="mt-2 flex gap-2">
          <input ref={input} type="file" accept=".xlsx,.csv,.tsv,.txt" className="sr-only" aria-label="파일 고르기" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} />
          <Button size="sm" variant="primary" onClick={() => input.current?.click()}>{zh ? '选择文件' : '파일 고르기'}</Button>
          <Button size="sm" variant="secondary" onClick={template}><FileSpreadsheet aria-hidden /> {zh ? '下载模板' : '양식 받기'}</Button>
        </div>
      </div>
      {headerErr ? <p role="alert" className="flex items-center gap-2 rounded-sm border border-stamp/40 bg-stamp-bg p-3 text-sm text-stamp"><AlertTriangle className="size-4" /> {headerErr}</p> : null}
      {rows.length ? (
        <section aria-label={zh ? '预览' : '미리보기'} className="rounded-md border border-line bg-surface">
          <div className="flex flex-wrap items-center gap-3 border-b border-line-2 px-4 py-3 text-sm">
            <b className="truncate">{file}</b>
            <span className="text-ok">{zh ? '可导入' : '올릴 수 있음'} {good.length}</span>
            <span className={bad.length ? 'font-semibold text-stamp' : 'text-muted'}>{zh ? '有错误' : '오류'} {bad.length}</span>
            <span className="flex-1" />
            <Button
              variant="primary"
              size="sm"
              disabled={pending || good.length === 0}
              onClick={() =>
                start(async () => {
                  const r = await onConfirm(good.map((g) => g.row));
                  if (r.ok) {
                    setDone(`${zh ? '已导入' : '올렸습니다'} ${r.created ?? good.length}${zh ? '条' : '건'}`);
                    setRows([]);
                  } else setHeaderErr(r.error ?? (zh ? '导入失败' : '올리지 못했습니다'));
                })
              }
            >
              {pending ? (zh ? '导入中…' : '올리는 중…') : `${zh ? '确认导入' : '확정'} (${good.length})`}
            </Button>
          </div>
          <div className="max-h-[50vh] overflow-auto">
            <table className="w-full min-w-[720px] text-xs tnum">
              <thead className="sticky top-0 bg-surface-2 text-muted">
                <tr>
                  <th scope="col" className="px-2 py-1.5 text-left">{zh ? '行' : '줄'}</th>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className="px-2 py-1.5 text-left font-semibold">{c.label}</th>
                  ))}
                  <th scope="col" className="px-2 py-1.5 text-left">{zh ? '检查' : '확인'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.line} className={cn('border-t border-line-2', r.error && 'bg-stamp-bg/50')}>
                    <td className="px-2 py-1.5 text-muted">{r.line}</td>
                    {columns.map((c) => (
                      <td key={c.key} className="max-w-40 truncate px-2 py-1.5">{r.row[c.key] == null ? '' : String(r.row[c.key])}</td>
                    ))}
                    <td className="px-2 py-1.5">{r.error ? <span className="font-semibold text-stamp">{r.error}</span> : <CheckCircle2 className="size-3.5 text-ok" aria-label="통과" />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
      {done ? <p role="status" className="flex items-center gap-2 rounded-sm border border-ok/40 bg-ok-bg p-3 text-sm text-ok"><CheckCircle2 className="size-4" /> {done}</p> : null}
    </div>
  );
}
