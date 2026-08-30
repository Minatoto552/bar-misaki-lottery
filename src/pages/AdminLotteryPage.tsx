import { useCallback, useEffect, useMemo, useState } from 'react';
import { Armchair, BarChart3, DoorOpen, LayoutDashboard, LogOut, RefreshCw, Search, Settings2, ShieldCheck, Users } from 'lucide-react';
import { Link } from 'react-router-dom';

import type { AdminLotterySnapshot, LotteryEntry, LotteryKind } from '../../shared/models';
import { BrandMark } from '../components/Brand';
import {
  excludeWinners,
  getAdminLotterySnapshot,
  isAdminSessionActive,
  loginAdmin,
  logoutAdmin,
  publishLotteryResults,
  redrawLottery,
  redrawVacancies,
  resetLottery,
  runLottery,
  undoExclusions,
  updateAvailableLotteryKinds,
} from '../lib/lottery-api';

const tabs = ['dashboard', 'recruitment', 'counter', 'private', 'table', 'results', 'history'] as const;
type Tab = (typeof tabs)[number];
const tabLabels = { dashboard: '運用ダッシュボード', recruitment: '募集項目設定', counter: 'カウンター', private: '個室', table: 'テーブル席', results: '抽選結果', history: '操作履歴' };
const kindLabels: Record<LotteryKind, string> = { counter: 'カウンター', private: '個室', table: 'テーブル席' };
const stateLabels = { accepting: '応募受付中', drawing: '抽選中', drawn: '抽選済み・未公開', published: '結果公開済み', closed: '受付終了' };
const statusLabels = { pending: '抽選待ち', winner: '当選', loser: '落選', excluded: '除外' };

const formatDate = (value: string | null) => value ? new Intl.DateTimeFormat('ja-JP', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) : '—';

const EntryTable = ({ entries, selected, onSelect, selectable = false }: { entries: LotteryEntry[]; selected: Set<string>; onSelect: (id: string, checked: boolean) => void; selectable?: boolean }) => (
  <div className="overflow-x-auto rounded-2xl border border-slate-200">
    <table className="min-w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500"><tr>{selectable ? <th className="px-4 py-3">選択</th> : null}<th className="px-4 py-3">応募番号</th><th className="px-4 py-3">応募項目</th><th className="px-4 py-3">代表者X</th><th className="px-4 py-3">代表者VRC名</th><th className="px-4 py-3">同行者VRC名</th><th className="px-4 py-3">人数</th><th className="px-4 py-3">応募日時</th><th className="px-4 py-3">状態</th><th className="px-4 py-3">当選者コード</th></tr></thead>
      <tbody className="divide-y divide-slate-100 bg-white">{entries.map((entry) => <tr key={entry.id} className="hover:bg-slate-50">{selectable ? <td className="px-4 py-3"><input aria-label={`${entry.entryNumber}を選択`} checked={selected.has(entry.id)} onChange={(event) => onSelect(entry.id, event.target.checked)} type="checkbox" /></td> : null}<td className="whitespace-nowrap px-4 py-3 font-semibold">{entry.entryNumber}</td><td className="whitespace-nowrap px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${entry.kind === 'counter' ? 'bg-violet-100 text-violet-800' : entry.kind === 'private' ? 'bg-blue-100 text-blue-800' : 'bg-fuchsia-100 text-fuchsia-800'}`}>{kindLabels[entry.kind]}</span></td><td className="whitespace-nowrap px-4 py-3">{entry.representativeId}</td><td className="whitespace-nowrap px-4 py-3 font-semibold">{entry.representativeVrcName}</td><td className="whitespace-nowrap px-4 py-3">{entry.companionVrcName ?? '—'}</td><td className="px-4 py-3">{entry.peopleCount}</td><td className="whitespace-nowrap px-4 py-3 text-slate-500">{formatDate(entry.createdAt)}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.status === 'winner' ? 'bg-emerald-100 text-emerald-800' : entry.status === 'excluded' ? 'bg-orange-100 text-orange-800' : entry.status === 'loser' ? 'bg-slate-200 text-slate-700' : 'bg-blue-100 text-blue-800'}`}>{statusLabels[entry.status]}</span></td><td className="whitespace-nowrap px-4 py-3 font-mono font-semibold">{entry.winnerCode ?? '—'}</td></tr>)}</tbody>
    </table>
    {!entries.length ? <p className="bg-white px-5 py-10 text-center text-sm text-slate-500">該当する応募はありません。</p> : null}
  </div>
);

export const AdminLotteryPage = () => {
  const [signedIn, setSignedIn] = useState(isAdminSessionActive());
  const [password, setPassword] = useState('');
  const [snapshot, setSnapshot] = useState<AdminLotterySnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [search, setSearch] = useState('');
  const [counterSlots, setCounterSlots] = useState(0);
  const [privateSlots, setPrivateSlots] = useState(0);
  const [tableSlots, setTableSlots] = useState(0);
  const [enabledKinds, setEnabledKinds] = useState<Set<LotteryKind>>(new Set(['counter', 'private', 'table']));
  const [availableKinds, setAvailableKinds] = useState<Set<LotteryKind>>(new Set(['counter', 'private', 'table']));
  const [availableKindsDirty, setAvailableKindsDirty] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lockedWinners, setLockedWinners] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [resetText, setResetText] = useState('');

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try { setSnapshot(await getAdminLotterySnapshot()); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '管理データの取得に失敗しました'); }
  }, [signedIn]);

  useEffect(() => { void refresh(); const id = window.setInterval(() => void refresh(), 5000); return () => window.clearInterval(id); }, [refresh]);
  useEffect(() => {
    if (snapshot && !availableKindsDirty) setAvailableKinds(new Set(snapshot.settings.availableKinds));
  }, [snapshot, availableKindsDirty]);
  useEffect(() => {
    sessionStorage.setItem('bar-misaki-redraw-locks', JSON.stringify([...lockedWinners]));
  }, [lockedWinners]);

  const execute = async (operation: () => Promise<void>, success: string) => {
    setBusy(true); setError(''); setMessage('');
    try { await operation(); setMessage(success); setSelected(new Set()); setLockedWinners(new Set()); sessionStorage.removeItem('bar-misaki-redraw-locks'); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : '操作に失敗しました'); }
    finally { setBusy(false); }
  };

  const login = async () => {
    setBusy(true); setError('');
    try { await loginAdmin(password); setSignedIn(true); setPassword(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'ログインに失敗しました'); }
    finally { setBusy(false); }
  };

  const entries = useMemo(() => snapshot?.entries ?? [], [snapshot?.entries]);
  const counts = useMemo(() => {
    const make = (kind: LotteryKind) => { const items = entries.filter((entry) => entry.kind === kind); return { groups: items.length, people: items.reduce((sum, entry) => sum + entry.peopleCount, 0) }; };
    return { counter: make('counter'), private: make('private'), table: make('table') };
  }, [entries]);
  useEffect(() => {
    if (snapshot?.settings.state !== 'accepting') return;
    setCounterSlots((value) => value || counts.counter.groups);
    setPrivateSlots((value) => value || counts.private.groups);
    setTableSlots((value) => value || counts.table.groups);
  }, [snapshot?.settings.roundId, snapshot?.settings.state, counts.counter.groups, counts.private.groups, counts.table.groups]);
  const filteredEntries = useMemo(() => {
    const kind = activeTab as LotteryKind;
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => entry.kind === kind && (!needle || entry.representativeId.toLowerCase().includes(needle) || entry.representativeVrcName.toLowerCase().includes(needle) || entry.companionVrcName?.toLowerCase().includes(needle)));
  }, [activeTab, entries, search]);
  const winners = entries.filter((entry) => entry.status === 'winner');
  const excluded = entries.filter((entry) => entry.status === 'excluded');

  if (!signedIn) return (
    <main className="grid min-h-screen place-items-center bg-[#eef0f3] p-5 text-slate-900"><form className="w-full max-w-md rounded-[28px] bg-white p-7 shadow-xl" onSubmit={(event) => { event.preventDefault(); void login(); }}><Link aria-label="管理者ログインに戻る" className="inline-block rounded-full ring-2 ring-slate-900 ring-offset-4 transition-transform hover:scale-105" to="/admin"><BrandMark size="lg" /></Link><p className="mt-6 text-xs font-bold tracking-[0.18em] text-violet-600">STAFF ONLY</p><h1 className="mt-2 text-3xl font-bold">従業員ログイン</h1><p className="mt-3 text-sm leading-relaxed text-slate-500">抽選管理画面は従業員専用です。管理パスワードを入力してください。</p><label className="mt-7 block text-sm font-semibold">管理パスワード<input autoFocus className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-violet-600" onChange={(event) => setPassword(event.target.value)} type="password" value={password} /></label>{error ? <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}<button className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50" disabled={busy || !password} type="submit">{busy ? '認証中...' : 'ログイン'}</button><Link className="mt-5 block text-center text-sm text-slate-500 underline" to="/lottery">お客様用画面へ戻る</Link></form></main>
  );

  return (
    <main className="min-h-screen bg-[#eef0f3] text-slate-900">
      {snapshot?.settings.state === 'drawn' && winners.length ? <div className="mx-auto max-w-[1500px] px-5 pt-5 sm:px-7"><div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-emerald-950">再抽選の当選確定枠</h2><p className="mt-1 text-sm text-emerald-800">再抽選から除外する当選者にチェックを入れてください。チェックした応募は当選のまま固定されます。</p></div><span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-emerald-800">確定 {lockedWinners.size}組</span></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{winners.map((entry) => <label className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${lockedWinners.has(entry.id) ? 'border-emerald-400 bg-white' : 'border-emerald-100 bg-white/50'}`} key={entry.id}><input checked={lockedWinners.has(entry.id)} onChange={(event) => setLockedWinners((current) => { const next = new Set(current); if (event.target.checked) next.add(entry.id); else next.delete(entry.id); return next; })} type="checkbox" /><span><strong className="block">{entry.entryNumber} · {kindLabels[entry.kind]}</strong><span className="text-xs text-slate-600">{entry.representativeVrcName}</span></span></label>)}</div></div></div> : null}
      {snapshot?.settings.state === 'drawn' ? <div className="mx-auto max-w-[1500px] px-5 pt-5 sm:px-7"><div className="flex items-center justify-between gap-3 rounded-2xl border border-indigo-200 bg-indigo-50 px-4 py-3"><p className="text-sm font-semibold text-indigo-900">抽選結果をやり直せます（現在の対象・当選枠を維持）</p><button className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy} onClick={() => { if (window.confirm('現在の抽選結果を破棄し、同じ条件で抽選をやり直します。よろしいですか？')) void execute(redrawLottery, '抽選をやり直しました'); }} type="button">抽選をやり直す</button></div></div> : null}
      <header className="border-b border-slate-700 bg-slate-950 text-white"><div className="mx-auto flex max-w-[1500px] items-center justify-between px-5 py-4"><div className="flex items-center gap-3"><Link aria-label="管理ダッシュボードに戻る" className="rounded-full bg-white ring-2 ring-violet-400 ring-offset-2 ring-offset-slate-950 transition-transform hover:scale-105" onClick={() => { setActiveTab('dashboard'); setSelected(new Set()); window.scrollTo({ top: 0, behavior: 'smooth' }); }} to="/admin"><BrandMark size="sm" /></Link><div><strong className="block">Bar Misaki 抽選管理</strong><span className="text-xs text-slate-400">STAFF CONSOLE</span></div></div><div className="flex gap-2"><button aria-label="更新" className="rounded-xl border border-slate-700 p-2.5 hover:bg-slate-800" onClick={() => void refresh()} type="button"><RefreshCw size={19} /></button><button className="flex items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm hover:bg-slate-800" onClick={() => void logoutAdmin().then(() => setSignedIn(false))} type="button"><LogOut size={17} />ログアウト</button></div></div></header>
      <div className="mx-auto max-w-[1500px] p-5 sm:p-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold tracking-[0.16em] text-violet-600">LOTTERY OVERVIEW</p><h1 className="mt-1 text-3xl font-bold">抽選運用ダッシュボード</h1></div>{snapshot ? <div className="text-right text-sm"><span className="rounded-full bg-violet-100 px-3 py-1.5 font-semibold text-violet-800">{stateLabels[snapshot.settings.state]}</span><p className="mt-2 text-xs text-slate-500">最終更新 {formatDate(snapshot.settings.lastUpdatedAt)}</p></div> : null}</div>
        {error ? <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700" role="alert">{error}</p> : null}{message ? <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
        {!snapshot ? <div className="rounded-2xl bg-white p-12 text-center">読み込み中...</div> : <>
          <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5"><div className="rounded-2xl bg-white p-5"><Users className="text-violet-600" /><span className="mt-4 block text-sm text-slate-500">カウンター応募</span><strong className="mt-1 block text-2xl">{counts.counter.groups}組 / {counts.counter.people}名</strong></div><div className="rounded-2xl bg-white p-5"><DoorOpen className="text-blue-600" /><span className="mt-4 block text-sm text-slate-500">個室応募</span><strong className="mt-1 block text-2xl">{counts.private.groups}組 / {counts.private.people}名</strong></div><div className="rounded-2xl bg-white p-5"><Armchair className="text-fuchsia-600" /><span className="mt-4 block text-sm text-slate-500">テーブル席応募</span><strong className="mt-1 block text-2xl">{counts.table.groups}組 / {counts.table.people}名</strong></div><div className="rounded-2xl bg-white p-5"><ShieldCheck className="text-emerald-600" /><span className="mt-4 block text-sm text-slate-500">現在の当選組</span><strong className="mt-1 block text-2xl">{winners.length}組</strong></div><div className="rounded-2xl bg-white p-5"><BarChart3 className="text-orange-600" /><span className="mt-4 block text-sm text-slate-500">空き枠</span><strong className="mt-1 block text-2xl">{snapshot.settings.vacantCounterSlots + snapshot.settings.vacantPrivateSlots + snapshot.settings.vacantTableSlots}組</strong></div></section>
          <section className="rounded-2xl bg-white p-4 sm:p-6"><div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-4" role="tablist">{tabs.map((tab) => <button aria-selected={activeTab === tab} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${activeTab === tab ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`} key={tab} onClick={() => { setActiveTab(tab); setSelected(new Set()); }} role="tab" type="button">{tabLabels[tab]}</button>)}</div>
            {activeTab === 'dashboard' ? <div className="grid gap-6 xl:grid-cols-[1.25fr_0.75fr]"><section><div className="flex items-center gap-3"><span className="grid size-11 place-items-center rounded-2xl bg-slate-900 text-white"><LayoutDashboard size={22} /></span><div><p className="text-xs font-bold tracking-[0.15em] text-violet-600">STAFF HOME</p><h2 className="text-xl font-bold">抽選運用ダッシュボード</h2></div></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><button className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setActiveTab('counter')} type="button"><span className="text-sm font-bold text-violet-700">応募者を確認</span><strong className="mt-2 block text-xl">カウンター {counts.counter.groups}組</strong><span className="mt-1 block text-sm text-slate-500">応募一覧・X ID検索</span></button><button className="rounded-2xl border border-blue-200 bg-blue-50 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setActiveTab('private')} type="button"><span className="text-sm font-bold text-blue-700">応募者を確認</span><strong className="mt-2 block text-xl">個室 {counts.private.groups}組</strong><span className="mt-1 block text-sm text-slate-500">応募一覧・X ID検索</span></button><button className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setActiveTab('results')} type="button"><span className="text-sm font-bold text-emerald-700">抽選を運用</span><strong className="mt-2 block text-xl">抽選・公開・再抽選</strong><span className="mt-1 block text-sm text-slate-500">現在 {stateLabels[snapshot.settings.state]}</span></button><button className="rounded-2xl border border-orange-200 bg-orange-50 p-5 text-left transition hover:-translate-y-0.5 hover:shadow-md" onClick={() => setActiveTab('history')} type="button"><span className="text-sm font-bold text-orange-700">監査ログ</span><strong className="mt-2 block text-xl">操作履歴を確認</strong><span className="mt-1 block text-sm text-slate-500">全 {snapshot.audits.length}件</span></button></div></section><aside className="rounded-2xl bg-slate-950 p-5 text-white"><p className="text-xs font-bold tracking-[0.15em] text-violet-300">CURRENT OPERATION</p><h3 className="mt-2 text-lg font-bold">現在の運用状況</h3><dl className="mt-5 space-y-4 text-sm"><div className="flex items-center justify-between border-b border-slate-700 pb-3"><dt className="text-slate-400">ステータス</dt><dd className="font-semibold text-violet-200">{stateLabels[snapshot.settings.state]}</dd></div><div className="flex items-center justify-between border-b border-slate-700 pb-3"><dt className="text-slate-400">ラウンドID</dt><dd className="font-mono">{snapshot.settings.roundId}</dd></div><div className="flex items-center justify-between border-b border-slate-700 pb-3"><dt className="text-slate-400">当選組数</dt><dd className="font-semibold">{winners.length}組</dd></div><div className="flex items-center justify-between"><dt className="text-slate-400">結果公開日時</dt><dd className="text-right font-semibold">{formatDate(snapshot.settings.publishedAt)}</dd></div></dl></aside></div> : null}
            {activeTab === 'recruitment' ? (
              <div className="max-w-4xl">
                <div className="flex items-center gap-3">
                  <span className="grid size-11 place-items-center rounded-2xl bg-violet-600 text-white"><Settings2 size={22} /></span>
                  <div><p className="text-xs font-bold tracking-[0.15em] text-violet-600">APPLICATION SETTINGS</p><h2 className="text-xl font-bold">募集項目設定</h2></div>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-slate-500">お客様用の応募画面に表示する席種を選択してください。ここで非表示にした項目には新しく応募できなくなります。抽選対象の設定とは別に管理されます。</p>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  {(['counter', 'private', 'table'] as const).map((item) => {
                    const active = availableKinds.has(item);
                    const Icon = item === 'counter' ? Users : item === 'private' ? DoorOpen : Armchair;
                    return <button aria-pressed={active} className={`rounded-2xl border p-5 text-left transition ${active ? 'border-violet-500 bg-violet-50 text-violet-950 shadow-sm' : 'border-slate-200 bg-slate-50 text-slate-400'}`} key={item} onClick={() => { setAvailableKinds((current) => { const next = new Set(current); if (next.has(item)) next.delete(item); else next.add(item); return next; }); setAvailableKindsDirty(true); }} type="button"><Icon size={24} /><span className="mt-5 block text-xs font-bold tracking-wider">{active ? '募集中・表示' : '募集停止・非表示'}</span><strong className="mt-1 block text-lg">{kindLabels[item]}</strong></button>;
                  })}
                </div>
                {!availableKinds.size ? <p className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">募集項目を1つ以上選択してください。</p> : null}
                <button className="mt-6 rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || !availableKinds.size || !availableKindsDirty || snapshot.settings.state !== 'accepting'} onClick={() => void execute(async () => { await updateAvailableLotteryKinds([...availableKinds]); setAvailableKindsDirty(false); }, '募集項目を更新しました')} type="button">募集項目を保存</button>
                {snapshot.settings.state !== 'accepting' ? <p className="mt-3 text-sm font-semibold text-amber-700">募集項目は「応募受付中」のときだけ変更できます。</p> : null}
              </div>
            ) : null}
            {activeTab === 'counter' || activeTab === 'private' || activeTab === 'table' ? <div><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">{tabLabels[activeTab]}応募者</h2><label className="relative"><Search className="absolute left-3 top-3 text-slate-400" size={18} /><input className="rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm" onChange={(event) => setSearch(event.target.value)} placeholder="X ID・VRC名を検索" value={search} /></label></div><EntryTable entries={filteredEntries} onSelect={() => undefined} selected={selected} /></div> : null}
            {activeTab === 'results' ? <div className="space-y-8"><section><h2 className="text-xl font-bold">抽選対象と当選枠</h2><p className="mt-2 text-sm text-slate-500">今回抽選する席だけを選択してください。未選択の席種は応募を保持したまま抽選対象から除外されます。</p><div className="mt-4 grid gap-3 sm:grid-cols-3">{(['counter', 'private', 'table'] as const).map((item) => { const active = enabledKinds.has(item); return <button aria-pressed={active} className={`rounded-2xl border p-4 text-left transition ${active ? 'border-blue-600 bg-blue-50 text-blue-900' : 'border-slate-200 bg-slate-50 text-slate-400'}`} key={item} onClick={() => setEnabledKinds((current) => { const next = new Set(current); if (next.has(item)) next.delete(item); else next.add(item); return next; })} type="button"><span className="text-xs font-bold tracking-wider">{active ? '抽選対象' : '対象外'}</span><strong className="mt-1 block">{kindLabels[item]}</strong></button>; })}</div><div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="text-sm font-semibold">カウンター当選組数<input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100 disabled:text-slate-400" disabled={!enabledKinds.has('counter')} max={counts.counter.groups} min={0} onChange={(event) => setCounterSlots(Number(event.target.value))} type="number" value={counterSlots} /></label><label className="text-sm font-semibold">個室当選組数<input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100 disabled:text-slate-400" disabled={!enabledKinds.has('private')} max={counts.private.groups} min={0} onChange={(event) => setPrivateSlots(Number(event.target.value))} type="number" value={privateSlots} /></label><label className="text-sm font-semibold">テーブル席当選組数<input className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 disabled:bg-slate-100 disabled:text-slate-400" disabled={!enabledKinds.has('table')} max={counts.table.groups} min={0} onChange={(event) => setTableSlots(Number(event.target.value))} type="number" value={tableSlots} /></label></div><button className="mt-4 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-40" disabled={busy || !enabledKinds.size || !['accepting', 'closed'].includes(snapshot.settings.state)} onClick={() => { const summary = [...enabledKinds].map((item) => `${kindLabels[item]}${item === 'counter' ? counterSlots : item === 'private' ? privateSlots : tableSlots}組`).join('、'); if (window.confirm(`${summary}を抽選します。よろしいですか？`)) void execute(() => runLottery({ enabledKinds: [...enabledKinds], winnerSlots: { counter: counterSlots, private: privateSlots, table: tableSlots } }), '抽選が完了しました'); }} type="button">選択した内容で抽選開始</button></section>
              <section><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">当選者一覧</h2><button className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !selected.size} onClick={() => { if (window.confirm(`選択した${selected.size}組を当選から除外しますか？`)) void execute(() => excludeWinners([...selected]), '当選者を除外しました'); }} type="button">選択した当選者を除外</button></div><EntryTable entries={winners} onSelect={(id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; })} selectable selected={selected} /></section>
              {excluded.length ? <section><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">除外した応募</h2><button className="rounded-xl border border-orange-400 px-4 py-2.5 text-sm font-semibold text-orange-700 disabled:opacity-40" disabled={busy || !selected.size || snapshot.settings.state === 'published'} onClick={() => void execute(() => undoExclusions([...selected]), '除外を取り消しました')} type="button">選択した除外を取り消す</button></div><EntryTable entries={excluded} onSelect={(id, checked) => setSelected((current) => { const next = new Set(current); if (checked) next.add(id); else next.delete(id); return next; })} selectable selected={selected} /></section> : null}
              <section className="grid gap-4 border-t border-slate-200 pt-6 lg:grid-cols-3"><div className="rounded-2xl bg-blue-50 p-5"><h3 className="font-bold">空き枠を再抽選</h3><p className="mt-2 text-sm text-slate-600">カウンター {snapshot.settings.vacantCounterSlots}組 / 個室 {snapshot.settings.vacantPrivateSlots}組 / テーブル席 {snapshot.settings.vacantTableSlots}組</p><button className="mt-4 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || !(snapshot.settings.vacantCounterSlots + snapshot.settings.vacantPrivateSlots + snapshot.settings.vacantTableSlots)} onClick={() => void execute(redrawVacancies, '空き枠を再抽選しました')} type="button">空き枠を再抽選</button></div><div className="rounded-2xl bg-emerald-50 p-5"><h3 className="font-bold">結果を公開</h3><p className="mt-2 text-sm text-slate-600">公開後、お客様はキャストコインを選び、ガチャで確定済みの結果を開封します。</p><button className="mt-4 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || snapshot.settings.state !== 'drawn'} onClick={() => { if (window.confirm('抽選結果を公開します。お客様はコインガチャで確定済みの結果を開封します。よろしいですか？')) void execute(publishLotteryResults, '結果を公開しました'); }} type="button">抽選結果を公開</button></div><div className="rounded-2xl bg-red-50 p-5"><h3 className="font-bold text-red-800">抽選をリセット</h3><p className="mt-2 text-sm text-red-700">応募・結果・コードを無効化します。履歴は残ります。</p><input className="mt-4 w-full rounded-xl border border-red-200 px-3 py-2.5 text-sm" onChange={(event) => setResetText(event.target.value)} placeholder="リセット と入力" value={resetText} /><button className="mt-3 rounded-xl bg-red-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40" disabled={busy || resetText !== 'リセット'} onClick={() => { if (window.confirm('すべての応募情報と抽選結果をリセットします。最終確認です。')) void execute(() => resetLottery(resetText).then(() => setResetText('')), '抽選をリセットしました'); }} type="button">抽選をリセット</button></div></section>
            </div> : null}
            {activeTab === 'history' ? <div><h2 className="mb-4 text-xl font-bold">操作履歴</h2><div className="space-y-2">{snapshot.audits.map((audit) => <article className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4" key={audit.id}><div><strong>{audit.action}</strong><p className="mt-1 text-sm text-slate-600">{audit.details}</p><span className="mt-2 block text-xs text-slate-400">操作者: {audit.actor} / 対象: {audit.target}</span></div><time className="text-xs text-slate-500">{formatDate(audit.createdAt)}</time></article>)}</div></div> : null}
          </section>
        </>}
      </div>
    </main>
  );
};
