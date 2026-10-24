import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Armchair,
  BarChart3,
  DoorOpen,
  LogOut,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";

import type {
  AdminLotterySnapshot,
  LotteryConfigurationInput,
  LotteryEntry,
  LotteryKind,
} from "../../shared/models";
import { Toast } from "../components/Feedback";
import { useConfirmation } from "../components/useConfirmation";
import { BrandMark } from "../components/Brand";
import {
  adminUpdateLotteryEntry,
  closeLottery,
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
  updateLotteryConfiguration,
} from "../lib/lottery-api";

const tabs = [
  "dashboard",
  "counter",
  "private",
  "table",
  "draw",
  "results",
  "recruitment",
  "history",
] as const;
type Tab = (typeof tabs)[number];
const tabLabels = {
  dashboard: "運用ダッシュボード",
  recruitment: "募集項目設定",
  counter: "カウンター",
  private: "個室",
  table: "テーブル席",
  draw: "抽選実行",
  results: "当選者・結果公開",
  history: "操作履歴",
};
const kindLabels: Record<LotteryKind, string> = {
  counter: "カウンター",
  private: "個室",
  table: "テーブル席",
};
const winnerKindOrder: Record<LotteryKind, number> = {
  table: 0,
  counter: 1,
  private: 2,
};
const stateLabels = {
  accepting: "応募受付中",
  drawing: "抽選中",
  drawn: "抽選済み・未公開",
  published: "結果公開済み",
  closed: "受付締切済み",
};
const statusLabels = {
  pending: "抽選待ち",
  winner: "当選",
  loser: "落選",
  excluded: "除外",
  cancelled: "当選取り消し",
};

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "short",
        timeStyle: "medium",
      }).format(new Date(value))
    : "—";

const EntryTable = ({
  entries,
  selected,
  onSelect,
  selectable = false,
  onEdit,
}: {
  entries: LotteryEntry[];
  selected: Set<string>;
  onSelect: (id: string, checked: boolean) => void;
  selectable?: boolean;
  onEdit?: (entry: LotteryEntry) => void;
}) => (
  <div className="overflow-x-auto rounded-2xl border border-slate-200">
    <table className="min-w-full text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500">
        <tr>
          {selectable ? <th className="px-4 py-3">選択</th> : null}
          <th className="px-4 py-3">応募番号</th>
          <th className="px-4 py-3">応募項目</th>
          <th className="px-4 py-3">希望条件</th>
          <th className="px-4 py-3">割当結果</th>
          <th className="px-4 py-3">代表者X</th>
          <th className="px-4 py-3">代表者VRC名</th>
          <th className="px-4 py-3">同行者VRC名</th>
          <th className="px-4 py-3">人数</th>
          <th className="px-4 py-3">応募日時</th>
          <th className="px-4 py-3">状態</th>
          <th className="px-4 py-3">当選者コード</th>
          {onEdit ? <th className="px-4 py-3">管理</th> : null}
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100 bg-white">
        {entries.map((entry) => (
          <tr key={entry.id} className="hover:bg-slate-50">
            {selectable ? (
              <td className="px-4 py-3">
                <input
                  aria-label={`${entry.entryNumber}を選択`}
                  checked={selected.has(entry.id)}
                  onChange={(event) => onSelect(entry.id, event.target.checked)}
                  type="checkbox"
                />
              </td>
            ) : null}
            <td className="whitespace-nowrap px-4 py-3 font-semibold">
              {entry.entryNumber}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-bold ${entry.kind === "counter" ? "bg-violet-100 text-violet-800" : entry.kind === "private" ? "bg-blue-100 text-blue-800" : "bg-fuchsia-100 text-fuchsia-800"}`}
              >
                {kindLabels[entry.kind]}
              </span>
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold">
              {entry.preferenceMode === "omakase"
                ? `おまかせ${entry.legacyAutoOmakase ? "（自動移行）" : ""}`
                : `${entry.requestedInstanceId?.replace("instance", "インスタンス") ?? "未設定"}・${kindLabels[entry.kind]}`}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold">
              {entry.assignedInstanceId
                ? `${entry.assignedInstanceId.replace("instance", "インスタンス")}・${kindLabels[entry.assignedKind ?? entry.kind]}`
                : "—"}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              {entry.representativeId}
            </td>
            <td className="whitespace-nowrap px-4 py-3 font-semibold">
              {entry.representativeVrcName}
            </td>
            <td className="whitespace-nowrap px-4 py-3">
              {entry.companionVrcName ?? "—"}
            </td>
            <td className="px-4 py-3">{entry.peopleCount}</td>
            <td className="whitespace-nowrap px-4 py-3 text-slate-500">
              {formatDate(entry.createdAt)}
            </td>
            <td className="px-4 py-3">
              <span
                className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.status === "winner" && entry.confirmedAt ? "bg-violet-100 text-violet-800" : entry.status === "winner" ? "bg-emerald-100 text-emerald-800" : entry.status === "excluded" ? "bg-orange-100 text-orange-800" : entry.status === "cancelled" ? "bg-red-100 text-red-800" : entry.status === "loser" ? "bg-slate-200 text-slate-700" : "bg-blue-100 text-blue-800"}`}
              >
                {entry.status === "winner" && entry.confirmedAt
                  ? "確認済み"
                  : statusLabels[entry.status]}
              </span>
            </td>
            <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold">
              {entry.winnerCode ?? "—"}
            </td>
            {onEdit ? (
              <td className="px-4 py-3">
                <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold" onClick={() => onEdit(entry)} type="button">
                  条件を修正
                </button>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
    {!entries.length ? (
      <p className="bg-white px-5 py-10 text-center text-sm text-slate-500">
        該当する応募はありません。
      </p>
    ) : null}
  </div>
);

export const AdminLotteryPage = () => {
  const [signedIn, setSignedIn] = useState(isAdminSessionActive());
  const [password, setPassword] = useState("");
  const [snapshot, setSnapshot] = useState<AdminLotterySnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");
  const [search, setSearch] = useState("");
  const [configuration, setConfiguration] =
    useState<LotteryConfigurationInput | null>(null);
  const [entryEditor, setEntryEditor] = useState<LotteryEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lockedWinners, setLockedWinners] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { confirm, confirmation } = useConfirmation();

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      setSnapshot(await getAdminLotterySnapshot());
      setError("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "管理データの取得に失敗しました",
      );
    }
  }, [signedIn]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(id);
  }, [refresh]);
  useEffect(() => {
    if (!snapshot) return;
    setConfiguration({
      applicationDeadline: snapshot.settings.applicationDeadline,
      instances: snapshot.settings.instances,
      recruitmentSlots: snapshot.settings.recruitmentSlots,
      featureSettings: snapshot.settings.featureSettings,
    });
  }, [snapshot?.settings.lastUpdatedAt]);
  useEffect(() => {
    sessionStorage.setItem(
      "bar-misaki-redraw-locks",
      JSON.stringify([...lockedWinners]),
    );
  }, [lockedWinners]);

  const execute = async (operation: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
      setMessage(success);
      setSelected(new Set());
      setLockedWinners(new Set());
      sessionStorage.removeItem("bar-misaki-redraw-locks");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const login = async () => {
    setBusy(true);
    setError("");
    try {
      await loginAdmin(password);
      setSignedIn(true);
      setPassword("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "ログインに失敗しました",
      );
    } finally {
      setBusy(false);
    }
  };

  const entries = useMemo(() => snapshot?.entries ?? [], [snapshot?.entries]);
  const counts = useMemo(() => {
    const make = (kind: LotteryKind) => {
      const items = entries.filter((entry) => entry.kind === kind);
      return {
        groups: items.length,
        people: items.reduce((sum, entry) => sum + entry.peopleCount, 0),
      };
    };
    return {
      counter: make("counter"),
      private: make("private"),
      table: make("table"),
    };
  }, [entries]);
  const filteredEntries = useMemo(() => {
    const kind = activeTab as LotteryKind;
    const needle = search.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        entry.kind === kind &&
        (!needle ||
          entry.representativeId.toLowerCase().includes(needle) ||
          entry.representativeVrcName.toLowerCase().includes(needle) ||
          entry.companionVrcName?.toLowerCase().includes(needle)),
    );
  }, [activeTab, entries, search]);
  const winners = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === "winner")
        .sort(
          (left, right) =>
            winnerKindOrder[left.kind] - winnerKindOrder[right.kind],
        ),
    [entries],
  );
  const excluded = entries.filter((entry) => entry.status === "excluded");
  const cancelled = entries.filter((entry) => entry.status === "cancelled");
  const selectedWinners = winners.filter((entry) => selected.has(entry.id));
  const selectedExcluded = excluded.filter((entry) => selected.has(entry.id));

  if (!signedIn)
    return (
      <main className="grid min-h-screen place-items-center bg-[#eef0f3] p-5 text-slate-900">
        <form
          className="w-full max-w-md rounded-[28px] bg-white p-7 shadow-xl"
          onSubmit={(event) => {
            event.preventDefault();
            void login();
          }}
        >
          <Link
            aria-label="管理者ログインに戻る"
            className="inline-block rounded-full ring-2 ring-slate-900 ring-offset-4 transition-transform hover:scale-105"
            to="/admin"
          >
            <BrandMark size="lg" />
          </Link>
          <p className="mt-6 text-xs font-bold tracking-[0.18em] text-violet-600">
            STAFF ONLY
          </p>
          <h1 className="mt-2 text-3xl font-bold">従業員ログイン</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            抽選管理画面は従業員専用です。管理パスワードを入力してください。
          </p>
          <label className="mt-7 block text-sm font-semibold">
            管理パスワード
            <input
              autoFocus
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-violet-600"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          {error ? (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          ) : null}
          <button
            className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50"
            disabled={busy || !password}
            type="submit"
          >
            {busy ? "認証中..." : "ログイン"}
          </button>
          <Link
            className="mt-5 block text-center text-sm text-slate-500 underline"
            to="/lottery"
          >
            お客様用画面へ戻る
          </Link>
        </form>
      </main>
    );

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <Link
          className="admin-brand"
          to="/admin"
          onClick={() => setActiveTab("dashboard")}
          aria-label="抽選運用ダッシュボード"
        >
          <BrandMark size="sm" />
          <span>
            BAR MISAKI<small>STAFF CONSOLE</small>
          </span>
        </Link>
        <p className="eyebrow">WORKSPACE</p>
        <nav aria-label="管理メニュー">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              aria-current={activeTab === tab ? "page" : undefined}
              onClick={() => {
                setActiveTab(tab);
                setSelected(new Set());
                setSearch("");
              }}
            >
              <span>{tabLabels[tab]}</span>
              {(["counter", "private", "table"] as string[]).includes(tab) && (
                <small>{counts[tab as LotteryKind].groups}</small>
              )}
            </button>
          ))}
        </nav>
        <button
          className="admin-logout"
          onClick={() => void logoutAdmin().then(() => setSignedIn(false))}
        >
          <LogOut size={16} />
          ログアウト
        </button>
      </aside>
      <div className="admin-workspace">
        <div className="admin-location">
          <span>
            ワークスペース <span aria-hidden="true">/</span>{" "}
            {tabLabels[activeTab]}
          </span>
          <button
            className="button-secondary"
            aria-label="最新のデータに更新"
            disabled={busy}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} />
            更新
          </button>
        </div>

        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.16em] text-violet-600">
              LOTTERY OVERVIEW
            </p>
            <h1 className="mt-1 text-2xl font-bold">{tabLabels[activeTab]}</h1>
          </div>
          {snapshot ? (
            <div className="text-right text-sm">
              <span className="rounded-full bg-violet-100 px-3 py-1.5 font-semibold text-violet-800">
                {stateLabels[snapshot.settings.state]}
              </span>
              <p className="mt-2 text-xs text-slate-500">
                最終更新 {formatDate(snapshot.settings.lastUpdatedAt)}
              </p>
            </div>
          ) : null}
        </div>
        {error ? (
          <p
            className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="mb-4 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">
            {message}
          </p>
        ) : null}
        {!snapshot ? (
          <div className="rounded-2xl bg-white p-12 text-center">
            読み込み中...
          </div>
        ) : (
          <>
            <section className="admin-kpis">
              <div className="rounded-2xl bg-white p-5">
                <Users className="text-violet-600" />
                <span className="mt-4 block text-sm text-slate-500">
                  カウンター応募
                </span>
                <strong className="mt-1 block text-2xl">
                  {counts.counter.groups}組 / {counts.counter.people}名
                </strong>
              </div>
              <div className="rounded-2xl bg-white p-5">
                <DoorOpen className="text-blue-600" />
                <span className="mt-4 block text-sm text-slate-500">
                  個室応募
                </span>
                <strong className="mt-1 block text-2xl">
                  {counts.private.groups}組 / {counts.private.people}名
                </strong>
              </div>
              <div className="rounded-2xl bg-white p-5">
                <Armchair className="text-fuchsia-600" />
                <span className="mt-4 block text-sm text-slate-500">
                  テーブル席応募
                </span>
                <strong className="mt-1 block text-2xl">
                  {counts.table.groups}組 / {counts.table.people}名
                </strong>
              </div>
              <div className="rounded-2xl bg-white p-5">
                <ShieldCheck className="text-emerald-600" />
                <span className="mt-4 block text-sm text-slate-500">
                  現在の当選組
                </span>
                <strong className="mt-1 block text-2xl">
                  {winners.length}組
                </strong>
              </div>
              <div className="rounded-2xl bg-white p-5">
                <BarChart3 className="text-orange-600" />
                <span className="mt-4 block text-sm text-slate-500">
                  空き枠
                </span>
                <strong className="mt-1 block text-2xl">
                  {snapshot.settings.vacantCounterSlots +
                    snapshot.settings.vacantPrivateSlots +
                    snapshot.settings.vacantTableSlots}
                  組
                </strong>
              </div>
            </section>
            <section className="rounded-2xl bg-white p-4 sm:p-6">
              {activeTab === "dashboard" ? (
                <div className="overview-grid">
                  <section>
                    <div className="section-heading">
                      <h2>最近の応募</h2>
                      <span>{entries.length}組</span>
                    </div>
                    <EntryTable
                      entries={[...entries]
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                        .slice(0, 5)}
                      selected={new Set()}
                      onSelect={() => undefined}
                    />
                    <div className="overview-shortcuts">
                      <button
                        className="button-secondary"
                        onClick={() => setActiveTab("recruitment")}
                      >
                        募集項目を設定
                      </button>
                      <button
                        className="button-primary"
                        onClick={() =>
                          setActiveTab(
                            ["accepting", "closed"].includes(
                              snapshot.settings.state,
                            )
                              ? "draw"
                              : "results",
                          )
                        }
                      >
                        {snapshot.settings.state === "accepting"
                          ? "受付を締め切る"
                          : snapshot.settings.state === "closed"
                            ? "抽選へ進む"
                            : "結果を管理"}
                      </button>
                    </div>
                  </section>
                  <aside className="operation-summary">
                    <p className="eyebrow">CURRENT OPERATION</p>
                    <h2>運用状況</h2>
                    <dl>
                      <div>
                        <dt>現在の状態</dt>
                        <dd>{stateLabels[snapshot.settings.state]}</dd>
                      </div>
                      <div>
                        <dt>募集項目</dt>
                        <dd>
                          {snapshot.settings.availableKinds
                            .map((item) => kindLabels[item])
                            .join("・")}
                        </dd>
                      </div>
                      <div>
                        <dt>確認済み</dt>
                        <dd>
                          {winners.filter((entry) => entry.confirmedAt).length}{" "}
                          / {winners.length}組
                        </dd>
                      </div>
                      <div>
                        <dt>公開日時</dt>
                        <dd>{formatDate(snapshot.settings.publishedAt)}</dd>
                      </div>
                    </dl>
                  </aside>
                </div>
              ) : null}
              {activeTab === "recruitment" ? (
                <div className="max-w-4xl">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 place-items-center rounded-2xl bg-violet-600 text-white">
                      <Settings2 size={22} />
                    </span>
                    <div>
                      <p className="text-xs font-bold tracking-[0.15em] text-violet-600">
                        APPLICATION SETTINGS
                      </p>
                      <h2 className="text-xl font-bold">募集項目設定</h2>
                    </div>
                  </div>
                  <p className="mt-4 text-sm leading-relaxed text-slate-500">
                    インスタンスごとに席種・募集数・有効状態を設定します。表示設定と募集枠の有効状態は別々に管理されます。
                  </p>
                  {configuration ? (
                    <div className="mt-6 space-y-6">
                      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
                        {([
                          ["showInstanceSelection", "インスタンス選択を表示"],
                          ["showKindSelection", "席種選択を表示"],
                          ["showOmakase", "おまかせを表示"],
                        ] as const).map(([key, label]) => (
                          <label className="flex items-center gap-3 text-sm font-semibold" key={key}>
                            <input
                              checked={configuration.featureSettings[key]}
                              onChange={(event) =>
                                setConfiguration((current) =>
                                  current
                                    ? {
                                        ...current,
                                        featureSettings: {
                                          ...current.featureSettings,
                                          [key]: event.target.checked,
                                        },
                                      }
                                    : current,
                                )
                              }
                              type="checkbox"
                            />
                            {label}
                          </label>
                        ))}
                        <label className="text-sm font-semibold sm:col-span-2">
                          応募締切時刻（任意）
                          <input
                            className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-4 py-3"
                            onChange={(event) =>
                              setConfiguration((current) =>
                                current
                                  ? {
                                      ...current,
                                      applicationDeadline: event.target.value
                                        ? new Date(event.target.value).toISOString()
                                        : null,
                                    }
                                  : current,
                              )
                            }
                            type="datetime-local"
                            value={configuration.applicationDeadline ? new Date(new Date(configuration.applicationDeadline).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ""}
                          />
                        </label>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-3">
                        {(["counter", "table", "private"] as const).map((item) => (
                          <label className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 text-sm font-semibold" key={item}>
                            <input
                              checked={configuration.featureSettings.kindVisibility[item]}
                              onChange={(event) =>
                                setConfiguration((current) =>
                                  current
                                    ? {
                                        ...current,
                                        featureSettings: {
                                          ...current.featureSettings,
                                          kindVisibility: {
                                            ...current.featureSettings.kindVisibility,
                                            [item]: event.target.checked,
                                          },
                                        },
                                      }
                                    : current,
                                )
                              }
                              type="checkbox"
                            />
                            {kindLabels[item]}を表示
                          </label>
                        ))}
                      </div>
                      {configuration.instances.map((instance) => (
                        <section className="rounded-2xl border border-slate-200 p-4" key={instance.id}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <input
                              aria-label={`${instance.label}の表示名`}
                              className="rounded-xl border border-slate-300 px-3 py-2 font-bold"
                              onChange={(event) => setConfiguration((current) => current ? {...current, instances: current.instances.map((item) => item.id === instance.id ? {...item, label:event.target.value} : item)} : current)}
                              value={instance.label}
                            />
                            <div className="flex gap-4 text-sm font-semibold">
                              <label><input checked={instance.visible} onChange={(event) => setConfiguration((current) => current ? {...current, instances: current.instances.map((item) => item.id === instance.id ? {...item, visible:event.target.checked} : item)} : current)} type="checkbox" /> 表示</label>
                              <label><input checked={instance.enabled} onChange={(event) => setConfiguration((current) => current ? {...current, instances: current.instances.map((item) => item.id === instance.id ? {...item, enabled:event.target.checked} : item)} : current)} type="checkbox" /> 使用</label>
                            </div>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            {(["counter", "table", "private"] as const).map((item) => {
                              const slot = configuration.recruitmentSlots.find((candidate) => candidate.instanceId === instance.id && candidate.kind === item)!;
                              const applications = entries.filter((entry) => entry.preferenceMode === "specified" && entry.requestedInstanceId === instance.id && entry.kind === item).length;
                              const winners = entries.filter((entry) => entry.status === "winner" && entry.assignedInstanceId === instance.id && entry.assignedKind === item).length;
                              return (
                                <div className="rounded-xl bg-slate-50 p-3" key={item}>
                                  <strong>{kindLabels[item]}</strong>
                                  <p className="mt-1 text-xs text-slate-500">応募 {applications}組・当選 {winners}組</p>
                                  <label className="mt-3 flex items-center gap-2 text-sm"><input checked={slot.enabled} onChange={(event) => setConfiguration((current) => current ? {...current, recruitmentSlots: current.recruitmentSlots.map((candidate) => candidate.id === slot.id ? {...candidate, enabled:event.target.checked} : candidate)} : current)} type="checkbox" /> 募集枠を有効化</label>
                                  <label className="mt-2 block text-sm">募集数<input className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2" min={0} onChange={(event) => setConfiguration((current) => current ? {...current, recruitmentSlots: current.recruitmentSlots.map((candidate) => candidate.id === slot.id ? {...candidate, capacity:Number(event.target.value)} : candidate)} : current)} type="number" value={slot.capacity} /></label>
                                  <div className="mt-2 grid grid-cols-2 gap-2">
                                    <label className="block text-xs font-semibold">最低人数<input className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2" max={2} min={1} onChange={(event) => setConfiguration((current) => current ? {...current, recruitmentSlots: current.recruitmentSlots.map((candidate) => candidate.id === slot.id ? {...candidate, minPeople:Number(event.target.value)} : candidate)} : current)} type="number" value={slot.minPeople} /></label>
                                    <label className="block text-xs font-semibold">最大人数<input className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2" max={2} min={1} onChange={(event) => setConfiguration((current) => current ? {...current, recruitmentSlots: current.recruitmentSlots.map((candidate) => candidate.id === slot.id ? {...candidate, maxPeople:Number(event.target.value)} : candidate)} : current)} type="number" value={slot.maxPeople} /></label>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </section>
                      ))}
                      <div className="rounded-xl bg-violet-50 px-4 py-3 text-sm font-semibold text-violet-900">
                        有効な募集枠：{configuration.recruitmentSlots.filter((slot) => slot.enabled && slot.capacity > 0).reduce((sum, slot) => sum + slot.capacity, 0)}組
                      </div>
                      <button
                        className="rounded-xl bg-violet-600 px-5 py-3 font-semibold text-white disabled:opacity-40"
                        disabled={busy || snapshot.settings.state !== "accepting"}
                        onClick={() => void execute(() => updateLotteryConfiguration(configuration), "インスタンス・募集枠設定を更新しました")}
                        type="button"
                      >
                        設定を保存
                      </button>
                    </div>
                  ) : null}
                  {snapshot.settings.state !== "accepting" ? (
                    <p className="mt-3 text-sm font-semibold text-amber-700">
                      募集項目は「応募受付中」のときだけ変更できます。
                    </p>
                  ) : null}
                </div>
              ) : null}
              {activeTab === "counter" ||
              activeTab === "private" ||
              activeTab === "table" ? (
                <div>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-xl font-bold">
                      {tabLabels[activeTab]}応募者
                    </h2>
                    <label className="relative">
                      <Search
                        className="absolute left-3 top-3 text-slate-400"
                        size={18}
                      />
                      <input
                        className="rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm"
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="X ID・VRC名を検索"
                        value={search}
                      />
                    </label>
                  </div>
                  <EntryTable
                    entries={filteredEntries}
                    onEdit={setEntryEditor}
                    onSelect={() => undefined}
                    selected={selected}
                  />
                  {entryEditor ? (
                    <div className="mt-4 rounded-2xl border border-violet-200 bg-violet-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="font-bold">{entryEditor.entryNumber} の応募条件を修正</h3>
                          <p className="text-sm text-slate-600">締切後の変更も操作履歴に記録されます。</p>
                        </div>
                        <button className="text-sm font-semibold" onClick={() => setEntryEditor(null)} type="button">閉じる</button>
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-3">
                        <label className="text-sm font-semibold">応募方式<select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" onChange={(event) => setEntryEditor((current) => current ? {...current, preferenceMode:event.target.value as LotteryEntry["preferenceMode"]} : current)} value={entryEditor.preferenceMode}><option value="specified">条件指定</option><option value="omakase">おまかせ</option></select></label>
                        <label className="text-sm font-semibold">インスタンス<select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" disabled={entryEditor.preferenceMode === "omakase"} onChange={(event) => setEntryEditor((current) => current ? {...current, requestedInstanceId:event.target.value as LotteryEntry["requestedInstanceId"]} : current)} value={entryEditor.requestedInstanceId ?? "instance1"}>{snapshot.settings.instances.map((instance) => <option key={instance.id} value={instance.id}>{instance.label}</option>)}</select></label>
                        <label className="text-sm font-semibold">席種<select className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2" disabled={entryEditor.preferenceMode === "omakase"} onChange={(event) => setEntryEditor((current) => current ? {...current, kind:event.target.value as LotteryKind} : current)} value={entryEditor.kind}>{(["counter", "table", "private"] as const).map((item) => <option key={item} value={item}>{kindLabels[item]}</option>)}</select></label>
                      </div>
                      <button className="mt-4 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white" onClick={() => void execute(async () => { await adminUpdateLotteryEntry(entryEditor.id, {kind:entryEditor.kind, instanceId:entryEditor.requestedInstanceId ?? "instance1", preferenceMode:entryEditor.preferenceMode}); setEntryEditor(null); }, "応募条件を修正しました")} type="button">修正を保存</button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {activeTab === "results" || activeTab === "draw" ? (
                <div className="space-y-8">
                  {activeTab === "draw" && (
                    <section>
                      <div
                        className={`mb-6 rounded-2xl border p-5 ${snapshot.settings.state === "accepting" ? "border-amber-200 bg-amber-50" : snapshot.settings.state === "closed" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
                      >
                        <p className="text-xs font-bold tracking-[0.15em] text-slate-500">
                          APPLICATION STATUS
                        </p>
                        <h2 className="mt-1 text-lg font-bold">
                          {snapshot.settings.state === "accepting"
                            ? "現在、応募受付中です"
                            : stateLabels[snapshot.settings.state]}
                        </h2>
                        <p className="mt-2 text-sm leading-relaxed text-slate-600">
                          {snapshot.settings.state === "accepting"
                            ? "受付を締め切ると、新規応募と応募キャンセルを停止します。この操作だけでは抽選は行われません。"
                            : snapshot.settings.state === "closed"
                              ? "応募受付は締め切られています。応募者と当選枠を確認し、準備ができたタイミングで抽選を実行してください。"
                              : "この回の受付締切・抽選操作は完了しています。"}
                        </p>
                        {snapshot.settings.state === "accepting" ? (
                          <button
                            className="mt-4 rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white disabled:opacity-40"
                            disabled={busy}
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: "応募受付を締め切りますか？",
                                  description:
                                    "締切後は新規応募と応募キャンセルができなくなります。抽選はまだ行われません。",
                                  label: "受付を締め切る",
                                })
                              )
                                void execute(
                                  closeLottery,
                                  "応募受付を締め切りました。抽選はまだ実行されていません",
                                );
                            }}
                            type="button"
                          >
                            応募受付を締め切る
                          </button>
                        ) : null}
                      </div>
                      <h2 className="text-xl font-bold">抽選対象と当選枠</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        募集項目設定で有効にしたインスタンス・席種・募集数を使用します。おまかせ応募は指定応募の抽選後、残っている有効枠へ割り当てます。
                      </p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {snapshot.settings.recruitmentSlots
                          .filter((slot) => slot.enabled && slot.capacity > 0)
                          .map((slot) => (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={slot.id}>
                              <strong className="block">
                                {snapshot.settings.instances.find((instance) => instance.id === slot.instanceId)?.label}
                              </strong>
                              <span className="text-sm text-slate-600">{kindLabels[slot.kind]}・募集 {slot.capacity}組</span>
                              <span className="mt-2 block text-xs font-semibold text-violet-700">
                                指定応募 {entries.filter((entry) => entry.preferenceMode === "specified" && entry.requestedInstanceId === slot.instanceId && entry.kind === slot.kind).length}組
                              </span>
                            </div>
                          ))}
                        <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
                          <strong className="block">おまかせ応募</strong>
                          <span className="text-sm text-violet-800">{entries.filter((entry) => entry.preferenceMode === "omakase").length}組</span>
                        </div>
                      </div>
                      <button
                        className="button-primary mt-4 disabled:opacity-40"
                        disabled={
                          busy ||
                          !snapshot.settings.recruitmentSlots.some(
                            (slot) => slot.enabled && slot.capacity > 0,
                          ) ||
                          snapshot.settings.state !== "closed"
                        }
                        onClick={async () => {
                          const summary = snapshot.settings.recruitmentSlots
                            .filter((slot) => slot.enabled && slot.capacity > 0)
                            .map((slot) => `${snapshot.settings.instances.find((instance) => instance.id === slot.instanceId)?.label}・${kindLabels[slot.kind]}${slot.capacity}組`)
                            .join("、");
                          if (
                            await confirm(
                              `${summary}を抽選します。よろしいですか？`,
                            )
                          )
                            void execute(
                              () =>
                                runLottery({
                                  enabledKinds: snapshot.settings.availableKinds,
                                  winnerSlots: {
                                    counter: snapshot.settings.counterWinnerSlots,
                                    private: snapshot.settings.privateWinnerSlots,
                                    table: snapshot.settings.tableWinnerSlots,
                                  },
                                }),
                              "抽選が完了しました。結果画面で確認してください",
                            );
                        }}
                        type="button"
                      >
                        抽選を実行する
                      </button>
                      {snapshot.settings.state === "accepting" ? (
                        <p className="mt-3 text-sm font-semibold text-amber-700">
                          抽選を実行するには、先に応募受付を締め切ってください。
                        </p>
                      ) : null}
                    </section>
                  )}
                  {activeTab === "results" && (
                    <>
                      <section>
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <h2 className="text-xl font-bold">当選者一覧</h2>
                          <button
                            className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                            hidden={!selectedWinners.length}
                            disabled={busy || !selectedWinners.length}
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: "選択した当選者を除外しますか？",
                                  description: `${selectedWinners.length}組を当選から除外します。`,
                                  label: "当選から除外",
                                  danger: true,
                                })
                              )
                                void execute(
                                  () =>
                                    excludeWinners(
                                      selectedWinners.map((entry) => entry.id),
                                    ),
                                  "当選者を除外しました",
                                );
                            }}
                            type="button"
                          >
                            {selectedWinners.length}組を除外
                          </button>
                        </div>
                        <EntryTable
                          entries={winners}
                          onSelect={(id, checked) =>
                            setSelected((current) => {
                              const next = new Set(current);
                              if (checked) next.add(id);
                              else next.delete(id);
                              return next;
                            })
                          }
                          selectable
                          selected={selected}
                        />
                      </section>
                      {snapshot.settings.state === "drawn" ? (
                        <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <h2 className="font-bold text-emerald-950">
                                再抽選の当選確定枠
                              </h2>
                              <p className="mt-1 text-sm text-emerald-800">
                                再抽選から除外する当選者にチェックを入れてください。チェックした応募は当選のまま固定されます。
                              </p>
                            </div>
                            <span className="rounded-full bg-white/70 px-3 py-1.5 text-xs font-bold text-emerald-800">
                              確定 {lockedWinners.size}組
                            </span>
                          </div>
                          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-2">
                            {winners.map((entry) => (
                              <label
                                className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${lockedWinners.has(entry.id) ? "border-emerald-400 bg-white" : "border-emerald-100 bg-white/50"}`}
                                key={entry.id}
                              >
                                <input
                                  checked={lockedWinners.has(entry.id)}
                                  onChange={(event) =>
                                    setLockedWinners((current) => {
                                      const next = new Set(current);
                                      if (event.target.checked)
                                        next.add(entry.id);
                                      else next.delete(entry.id);
                                      return next;
                                    })
                                  }
                                  type="checkbox"
                                />
                                <span>
                                  <strong className="block">
                                    {entry.entryNumber} ·{" "}
                                    {kindLabels[entry.kind]}
                                  </strong>
                                  <span className="text-xs text-slate-600">
                                    {entry.representativeVrcName}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
                            <p className="text-sm font-semibold text-indigo-900">
                              現在の対象・当選枠を維持して再抽選します。
                            </p>
                            <button
                              className="shrink-0 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                              disabled={busy}
                              onClick={async () => {
                                if (
                                  await confirm(
                                    "現在の抽選結果を破棄し、同じ条件で抽選をやり直します。よろしいですか？",
                                  )
                                )
                                  void execute(
                                    () => redrawLottery([...lockedWinners]),
                                    "抽選をやり直しました",
                                  );
                              }}
                              type="button"
                            >
                              抽選をやり直す
                            </button>
                          </div>
                        </section>
                      ) : null}
                      {excluded.length ? (
                        <section>
                          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                            <h2 className="text-xl font-bold">除外した応募</h2>
                            <button
                              className="rounded-xl border border-orange-400 px-4 py-2.5 text-sm font-semibold text-orange-700 disabled:opacity-40"
                              disabled={
                                busy ||
                                !selectedExcluded.length ||
                                snapshot.settings.state === "published"
                              }
                              hidden={!selectedExcluded.length}
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: "除外を取り消しますか？",
                                    description: `${selectedExcluded.length}組を当選に戻します。`,
                                    label: "当選に戻す",
                                  })
                                )
                                  void execute(
                                    () =>
                                      undoExclusions(
                                        selectedExcluded.map(
                                          (entry) => entry.id,
                                        ),
                                      ),
                                    "除外を取り消しました",
                                  );
                              }}
                              type="button"
                            >
                              選択した除外を取り消す
                            </button>
                          </div>
                          <EntryTable
                            entries={excluded}
                            onSelect={(id, checked) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (checked) next.add(id);
                                else next.delete(id);
                                return next;
                              })
                            }
                            selectable
                            selected={selected}
                          />
                        </section>
                      ) : null}
                      {cancelled.length ? (
                        <section className="mt-6">
                          <h2 className="mb-4 text-xl font-bold">
                            当選取り消し
                          </h2>
                          <EntryTable
                            entries={cancelled}
                            onSelect={() => undefined}
                            selected={new Set()}
                          />
                        </section>
                      ) : null}
                      <section className="grid gap-4 border-t border-slate-200 pt-6 lg:grid-cols-3">
                        <div className="operation-action">
                          <h3 className="font-bold">空き枠を再抽選</h3>
                          <p className="mt-2 text-sm text-slate-600">
                            カウンター {snapshot.settings.vacantCounterSlots}組
                            / 個室 {snapshot.settings.vacantPrivateSlots}組 /
                            テーブル席 {snapshot.settings.vacantTableSlots}組
                          </p>
                          <button
                            className="button-secondary mt-4 disabled:opacity-40"
                            disabled={
                              busy ||
                              !(
                                snapshot.settings.vacantCounterSlots +
                                snapshot.settings.vacantPrivateSlots +
                                snapshot.settings.vacantTableSlots
                              )
                            }
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: "空き枠を再抽選しますか？",
                                  description:
                                    "既存の当選者は維持し、空き枠の対象者を抽選します。",
                                  label: "再抽選する",
                                })
                              )
                                void execute(
                                  redrawVacancies,
                                  "空き枠を再抽選しました",
                                );
                            }}
                            type="button"
                          >
                            空き枠を再抽選
                          </button>
                        </div>
                        <div className="operation-action publish-action">
                          <h3 className="font-bold">結果を公開</h3>
                          <p className="mt-2 text-sm text-slate-600">
                            公開後、お客様はキャストコインを選び、ガチャで確定済みの結果を開封します。
                          </p>
                          <button
                            className="button-primary mt-4 disabled:opacity-40"
                            disabled={
                              busy || snapshot.settings.state !== "drawn"
                            }
                            onClick={async () => {
                              if (
                                await confirm(
                                  "抽選結果を公開します。お客様はコインガチャで確定済みの結果を開封します。よろしいですか？",
                                )
                              )
                                void execute(
                                  publishLotteryResults,
                                  "結果を公開しました",
                                );
                            }}
                            type="button"
                          >
                            抽選結果を公開
                          </button>
                        </div>
                      </section>
                      <section className="danger-zone">
                        <div>
                          <p className="eyebrow">DANGER ZONE</p>
                          <h3>抽選をリセット</h3>
                          <p>
                            すべての応募・結果・コードを無効化します。操作履歴は残ります。
                          </p>
                        </div>
                        <button
                          className="button-secondary"
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await confirm({
                                title: "抽選をリセットしますか？",
                                description:
                                  "すべての応募情報・抽選結果・当選コードが無効になります。この操作は取り消せません。",
                                label: "リセットを実行",
                                danger: true,
                                keyword: "リセット",
                              })
                            )
                              void execute(
                                () => resetLottery("リセット"),
                                "抽選をリセットしました",
                              );
                          }}
                        >
                          抽選をリセット
                        </button>
                      </section>
                    </>
                  )}
                </div>
              ) : null}
              {activeTab === "history" ? (
                <div>
                  <h2 className="mb-4 text-xl font-bold">操作履歴</h2>
                  <div className="space-y-2">
                    {snapshot.audits.map((audit) => (
                      <article
                        className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4"
                        key={audit.id}
                      >
                        <div>
                          <strong>{audit.action}</strong>
                          <p className="mt-1 text-sm text-slate-600">
                            {audit.details}
                          </p>
                          <span className="mt-2 block text-xs text-slate-400">
                            操作者: {audit.actor} / 対象: {audit.target}
                          </span>
                        </div>
                        <time className="text-xs text-slate-500">
                          {formatDate(audit.createdAt)}
                        </time>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
      {confirmation}
      <Toast message={error || message} error={Boolean(error)} />
    </main>
  );
};
