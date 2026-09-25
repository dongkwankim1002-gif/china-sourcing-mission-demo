'use client';
import {
  BarChart3,
  Bell,
  Building2,
  Calculator,
  ClipboardCheck,
  Coins,
  FileSpreadsheet,
  FileText,
  Gauge,
  Handshake,
  Inbox,
  LayoutDashboard,
  Megaphone,
  Package,
  Palette,
  Receipt,
  Scale,
  ScrollText,
  Settings,
  Ship,
  Sparkles,
  Tags,
  type LucideIcon,
} from 'lucide-react';

export type AreaKey = 'app' | 'partner' | 'admin';
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  tab?: boolean;
  exact?: boolean;
}

export function navFor(area: AreaKey, locale: 'ko' | 'zh' = 'ko'): NavItem[] {
  if (area === 'app')
    return [
      { href: '/app', label: '대시보드', icon: LayoutDashboard, tab: true, exact: true },
      { href: '/app/compare', label: '비교', icon: Scale, tab: true },
      { href: '/app/requests', label: '견적 요청', icon: FileText, tab: true },
      { href: '/app/shipments', label: '선적', icon: Ship, tab: true },
      { href: '/app/pnl', label: '판매손익', icon: Calculator },
      { href: '/app/skus', label: '저장한 SKU', icon: Package },
      { href: '/app/notifications', label: '알림', icon: Bell },
      { href: '/app/settings', label: '설정', icon: Settings },
    ];
  if (area === 'partner') {
    const zh = locale === 'zh';
    return [
      { href: '/partner', label: zh ? '概览' : '대시보드', icon: LayoutDashboard, tab: true, exact: true },
      { href: '/partner/inbox', label: zh ? '询价收件箱' : '견적 수신함', icon: Inbox, tab: true },
      { href: '/partner/shipments', label: zh ? '订舱·货件' : '예약·선적', icon: Ship, tab: true },
      { href: '/partner/rates', label: zh ? '运价表' : '요금표', icon: FileSpreadsheet, tab: true },
      { href: '/partner/invoices', label: zh ? '账单' : '청구서', icon: Receipt },
      { href: '/partner/market', label: zh ? '市场数据' : '시장 데이터', icon: BarChart3 },
      { href: '/partner/profile', label: zh ? '公司资料' : '회사 프로필', icon: Building2 },
      { href: '/partner/notifications', label: zh ? '通知' : '알림', icon: Bell },
    ];
  }
  return [
    { href: '/admin', label: '대시보드', icon: Gauge, tab: true, exact: true },
    { href: '/admin/queues', label: '처리 대기', icon: ClipboardCheck, tab: true },
    { href: '/admin/data', label: '업체·자료', icon: Building2, tab: true },
    { href: '/admin/grades', label: '등급 기록', icon: Tags },
    { href: '/admin/ads', label: '광고 자리', icon: Megaphone },
    { href: '/admin/commission', label: '수수료 기준', icon: Coins },
    { href: '/admin/related', label: '특수관계 공개', icon: Handshake },
    { href: '/admin/settings', label: '설정', icon: Settings, tab: true },
    { href: '/admin/audit', label: '감사 기록', icon: ScrollText },
    { href: '/admin/demo', label: '데모 관리', icon: Sparkles },
    { href: '/styleguide', label: '스타일가이드', icon: Palette },
  ];
}

export function isActive(pathname: string, item: NavItem) {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');
}
