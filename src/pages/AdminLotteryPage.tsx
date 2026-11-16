import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  History,
  Home,
  LogOut,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Ticket,
  Users,
} from "lucide-react";
import { Link } from "react-router-dom";

import type {
  AdminLotterySnapshot,
  LotteryConfigurationInput,
  LotteryEntry,
  LotteryKind,
  RecruitmentSlot,
} from "../../shared/models";
import { Toast } from "../components/Feedback";
import { useConfirmation } from "../components/useConfirmation";
import { BrandMark } from "../components/Brand";
import {
  getDrawReadiness,
  getNextAction,
  getVacantTotal,
  type DrawReadiness,
} from "../lib/admin-operations";
import { usePollingWhileVisible } from "../lib/usePollingWhileVisible";
import {
  adminUpdateLotteryEntry,
  closeLottery,
  openLottery,
  excludeWinners,
  getAdminLotterySnapshot,
  getAdminLotterySnapshotIfChanged,
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

// 運営がやることの単位でまとめた画面。抽選の流れは「抽選・結果」1画面で上から順に進める
const tabs = ["home", "settings", "entries", "lottery", "history"] as const;
type Tab = (typeof tabs)[number];
const tabMeta: Record<Tab, { label: string; icon: typeof Home; hint: string }> = {
  home: { label: "ホーム", icon: Home, hint: "今やることを確認" },
  settings: { label: "募集設定", icon: Settings2, hint: "募集する席と人数" },
  entries: { label: "応募者", icon: Users, hint: "応募の確認・修正" },
  lottery: { label: "抽選・結果", icon: Ticket, hint: "締切→抽選→公開" },
  history: { label: "操作履歴", icon: History, hint: "誰が何をしたか" },
};

// 抽選の流れ。state ごとに「いまどこか」を示す
const flowSteps = [
  { key: "preparing", label: "抽選内容の設定" },
  { key: "accepting", label: "応募受付" },
  { key: "closed", label: "締切" },
  { key: "drawn", label: "抽選・確認" },
  { key: "published", label: "結果公開" },
] as const;
const stepIndex = (state: string) =>
  state === "preparing"
    ? 0
    : state === "accepting"
      ? 1
      : state === "closed"
        ? 2
        : state === "drawn" || state === "drawing"
          ? 3
          : 4;

const nextActionTones = {
  info: "border-violet-200 bg-violet-50 text-violet-950",
  action: "border-emerald-300 bg-emerald-50 text-emerald-950",
  done: "border-slate-200 bg-slate-50 text-slate-900",
  warning: "border-amber-300 bg-amber-50 text-amber-950",
};
const emptyReadiness: DrawReadiness = {
  blockers: [],
  warnings: [],
  usableSlots: [],
  maxWinners: 0,
};
const kindOrder = ["counter", "table", "private"] as const;
const kindLabels: Record<LotteryKind, string> = {
  counter: "カウンター",
  private: "個室",
  table: "テーブル席",
};
const kindTones: Record<LotteryKind, string> = {
  counter: "bg-violet-100 text-violet-800",
  private: "bg-blue-100 text-blue-800",
  table: "bg-fuchsia-100 text-fuchsia-800",
};
const winnerKindOrder: Record<LotteryKind, number> = {
  table: 0,
  counter: 1,
  private: 2,
};
const stateLabels = {
  preparing: "受付開始前（抽選内容の設定中）",
  accepting: "応募受付中",
  drawing: "抽選中",
  drawn: "抽選済み（お客様には未公開）",
  published: "結果公開中",
  closed: "受付締切済み（抽選前）",
};
const statusLabels = {
  pending: "抽選待ち",
  winner: "当選",
  loser: "落選",
  excluded: "除外",
  cancelled: "当選取り消し",
};
const peopleOptions = [
  { value: "1-2", label: "1人・2人どちらも", min: 1, max: 2 },
  { value: "1-1", label: "1人のみ", min: 1, max: 1 },
  { value: "2-2", label: "2人のみ", min: 2, max: 2 },
] as const;

const formatDate = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("ja-JP", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";

const toConfiguration = (
  snapshot: AdminLotterySnapshot,
): LotteryConfigurationInput => ({
  applicationDeadline: snapshot.settings.applicationDeadline,
  instances: snapshot.settings.instances,
  recruitmentSlots: snapshot.settings.recruitmentSlots,
  featureSettings: snapshot.settings.featureSettings,
});

const instanceLabel = (snapshot: AdminLotterySnapshot, id: string | null) =>
  snapshot.settings.instances.find((instance) => instance.id === id)?.label ??
  "—";

const Hint = ({ children }: { children: ReactNode }) => (
  <p className="admin-hint">
    <CircleHelp aria-hidden="true" size={16} />
    <span>{children}</span>
  </p>
);

const Switch = ({
  checked,
  label,
  description,
  onChange,
  disabled,
}: {
  checked: boolean;
  label: string;
  description?: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) => (
  <label className="admin-switch">
    <input
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      role="switch"
      type="checkbox"
    />
    <span aria-hidden="true" className="admin-switch-track" />
    <span>
      <strong>{label}</strong>
      {description ? <small>{description}</small> : null}
    </span>
  </label>
);

const Stepper = ({
  value,
  onChange,
  label,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  disabled?: boolean;
}) => (
  <div className="admin-stepper" role="group" aria-label={label}>
    <button
      aria-label={`${label}を1減らす`}
      disabled={disabled || value <= 0}
      onClick={() => onChange(Math.max(0, value - 1))}
      type="button"
    >
      <Minus size={16} />
    </button>
    <output aria-live="polite">{value}組</output>
    <button
      aria-label={`${label}を1増やす`}
      disabled={disabled || value >= 99}
      onClick={() => onChange(Math.min(99, value + 1))}
      type="button"
    >
      <Plus size={16} />
    </button>
  </div>
);

const StatusBadge = ({ entry }: { entry: LotteryEntry }) => (
  <span
    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${entry.status === "winner" && entry.confirmedAt ? "bg-violet-100 text-violet-800" : entry.status === "winner" ? "bg-emerald-100 text-emerald-800" : entry.status === "excluded" ? "bg-orange-100 text-orange-800" : entry.status === "cancelled" ? "bg-red-100 text-red-800" : entry.status === "loser" ? "bg-slate-200 text-slate-700" : "bg-blue-100 text-blue-800"}`}
  >
    {entry.status === "winner" && entry.confirmedAt
      ? "来店確認済み"
      : statusLabels[entry.status]}
  </span>
);

// 列は「誰が・何人で・どこを希望し・どうなったか」に絞る
const EntryTable = ({
  snapshot,
  entries,
  selected,
  onSelect,
  selectable = false,
  onEdit,
  emptyText = "該当する応募はありません。",
}: {
  snapshot: AdminLotterySnapshot;
  entries: LotteryEntry[];
  selected?: Set<string>;
  onSelect?: (id: string, checked: boolean) => void;
  selectable?: boolean;
  onEdit?: (entry: LotteryEntry) => void;
  emptyText?: string;
}) => {
  const showAssignment = entries.some((entry) => entry.assignedInstanceId);
  const showCode = entries.some((entry) => entry.winnerCode);
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="min-w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            {selectable ? <th className="px-4 py-3">選択</th> : null}
            <th className="px-4 py-3">応募番号</th>
            <th className="px-4 py-3">お名前（VRC名 / X）</th>
            <th className="px-4 py-3">人数</th>
            <th className="px-4 py-3">希望</th>
            {showAssignment ? <th className="px-4 py-3">当選した席</th> : null}
            <th className="px-4 py-3">状態</th>
            {showCode ? <th className="px-4 py-3">当選者コード</th> : null}
            {onEdit ? <th className="px-4 py-3"><span className="sr-only">操作</span></th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {entries.map((entry) => (
            <tr
              key={entry.id}
              className={`hover:bg-slate-50 ${selectable && selected?.has(entry.id) ? "bg-orange-50" : ""}`}
            >
              {selectable ? (
                <td className="px-4 py-3">
                  <input
                    aria-label={`${entry.entryNumber}（${entry.representativeVrcName}）を選択`}
                    checked={selected?.has(entry.id) ?? false}
                    onChange={(event) => onSelect?.(entry.id, event.target.checked)}
                    type="checkbox"
                  />
                </td>
              ) : null}
              <td className="whitespace-nowrap px-4 py-3 font-semibold">
                {entry.entryNumber}
              </td>
              <td className="px-4 py-3">
                <strong className="block whitespace-nowrap">
                  {entry.representativeVrcName}
                </strong>
                <span className="block text-xs text-slate-500">
                  {entry.representativeId}
                  {entry.companionVrcName ? ` ・同行：${entry.companionVrcName}` : ""}
                </span>
              </td>
              <td className="whitespace-nowrap px-4 py-3">{entry.peopleCount}名</td>
              <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold">
                {entry.preferenceMode === "omakase" ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-900">
                    おまかせ
                  </span>
                ) : (
                  <>
                    <span className={`rounded-full px-2.5 py-1 ${kindTones[entry.kind]}`}>
                      {kindLabels[entry.kind]}
                    </span>
                    <span className="ml-2 text-slate-500">
                      {instanceLabel(snapshot, entry.requestedInstanceId)}
                    </span>
                  </>
                )}
              </td>
              {showAssignment ? (
                <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold">
                  {entry.assignedInstanceId
                    ? `${instanceLabel(snapshot, entry.assignedInstanceId)}・${kindLabels[entry.assignedKind ?? entry.kind]}`
                    : "—"}
                </td>
              ) : null}
              <td className="px-4 py-3">
                <StatusBadge entry={entry} />
              </td>
              {showCode ? (
                <td className="whitespace-nowrap px-4 py-3 font-mono font-semibold">
                  {entry.winnerCode ?? "—"}
                </td>
              ) : null}
              {onEdit ? (
                <td className="px-4 py-3">
                  <button
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold hover:bg-white"
                    onClick={() => onEdit(entry)}
                    type="button"
                  >
                    希望を修正
                  </button>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      {!entries.length ? (
        <p className="bg-white px-5 py-10 text-center text-sm text-slate-500">
          {emptyText}
        </p>
      ) : null}
    </div>
  );
};

// 抽選・結果画面の1ステップ。完了済みは折りたたみ、先のステップは薄く表示する
const FlowStep = ({
  number,
  title,
  status,
  summary,
  children,
}: {
  number: number;
  title: string;
  status: "done" | "current" | "upcoming";
  summary?: string;
  children?: ReactNode;
}) => (
  <section className={`flow-step flow-step-${status}`} aria-current={status === "current" ? "step" : undefined}>
    <div className="flow-step-head">
      <span className="flow-step-number" aria-hidden="true">
        {status === "done" ? <Check size={16} /> : number}
      </span>
      <div>
        <h2>
          <span className="sr-only">ステップ{number}：</span>
          {title}
        </h2>
        {summary ? <p>{summary}</p> : null}
      </div>
      <span className="flow-step-state">
        {status === "done" ? "完了" : status === "current" ? "いまここ" : "あとで"}
      </span>
    </div>
    {status === "current" && children ? <div className="flow-step-body">{children}</div> : null}
  </section>
);

export const AdminLotteryPage = () => {
  const [signedIn, setSignedIn] = useState(isAdminSessionActive());
  const [password, setPassword] = useState("");
  const [snapshot, setSnapshot] = useState<AdminLotterySnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [search, setSearch] = useState("");
  const [entryFilter, setEntryFilter] = useState<LotteryKind | "omakase" | "all">("all");
  const [configuration, setConfiguration] =
    useState<LotteryConfigurationInput | null>(null);
  const [entryEditor, setEntryEditor] = useState<LotteryEntry | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lockedWinners, setLockedWinners] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const { confirm, confirmation } = useConfirmation();

  const lastUpdatedRef = useRef<string | null>(null);
  const refresh = useCallback(async (force = false) => {
    if (!signedIn) return;
    try {
      const next = force
        ? await getAdminLotterySnapshot()
        : await getAdminLotterySnapshotIfChanged(lastUpdatedRef.current);
      if (next) {
        lastUpdatedRef.current = next.settings.lastUpdatedAt;
        setSnapshot(next);
      }
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
  }, [refresh]);
  usePollingWhileVisible(refresh, 5000);
  useEffect(() => {
    if (!snapshot) return;
    setConfiguration(toConfiguration(snapshot));
    // 設定フォームは更新時刻が変わったときだけ同期する（編集中の入力を保つ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot?.settings.lastUpdatedAt]);
  useEffect(() => {
    sessionStorage.setItem(
      "bar-misaki-redraw-locks",
      JSON.stringify([...lockedWinners]),
    );
  }, [lockedWinners]);

  const settingsEditable =
    snapshot?.settings.state === "preparing" || snapshot?.settings.state === "accepting";
  const configurationDirty = Boolean(
    snapshot &&
      configuration &&
      JSON.stringify(configuration) !== JSON.stringify(toConfiguration(snapshot)),
  );

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
      await refresh(true);
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

  const goTo = async (tab: Tab) => {
    if (tab === activeTab) return;
    if (
      activeTab === "settings" &&
      configurationDirty &&
      !(await confirm({
        title: "保存していない変更があります",
        description: "このまま移動すると、募集設定の変更は失われます。",
        label: "変更を破棄して移動",
        danger: true,
      }))
    )
      return;
    if (activeTab === "settings" && snapshot) setConfiguration(toConfiguration(snapshot));
    setActiveTab(tab);
    setSelected(new Set());
    setSearch("");
    setEntryEditor(null);
    window.scrollTo({ top: 0 });
  };

  const entries = useMemo(() => snapshot?.entries ?? [], [snapshot?.entries]);
  const totals = useMemo(
    () => ({
      groups: entries.length,
      people: entries.reduce((sum, entry) => sum + entry.peopleCount, 0),
      byFilter: {
        all: entries.length,
        omakase: entries.filter((entry) => entry.preferenceMode === "omakase").length,
        counter: entries.filter((entry) => entry.preferenceMode !== "omakase" && entry.kind === "counter").length,
        table: entries.filter((entry) => entry.preferenceMode !== "omakase" && entry.kind === "table").length,
        private: entries.filter((entry) => entry.preferenceMode !== "omakase" && entry.kind === "private").length,
      },
    }),
    [entries],
  );
  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries
      .filter((entry) =>
        entryFilter === "all"
          ? true
          : entryFilter === "omakase"
            ? entry.preferenceMode === "omakase"
            : entry.preferenceMode !== "omakase" && entry.kind === entryFilter,
      )
      .filter(
        (entry) =>
          !needle ||
          entry.entryNumber.toLowerCase().includes(needle) ||
          entry.representativeId.toLowerCase().includes(needle) ||
          entry.representativeVrcName.toLowerCase().includes(needle) ||
          entry.companionVrcName?.toLowerCase().includes(needle),
      );
  }, [entryFilter, entries, search]);
  const winners = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === "winner")
        .sort(
          (left, right) =>
            winnerKindOrder[left.assignedKind ?? left.kind] -
            winnerKindOrder[right.assignedKind ?? right.kind],
        ),
    [entries],
  );
  const excluded = entries.filter((entry) => entry.status === "excluded");
  const cancelled = entries.filter((entry) => entry.status === "cancelled");
  const selectedWinners = winners.filter((entry) => selected.has(entry.id));
  const selectedExcluded = excluded.filter((entry) => selected.has(entry.id));
  const nextAction = snapshot
    ? getNextAction(snapshot.settings, entries)
    : null;
  const readiness = snapshot
    ? getDrawReadiness(snapshot.settings, entries)
    : emptyReadiness;
  const vacantTotal = snapshot ? getVacantTotal(snapshot.settings) : 0;
  const confirmedCount = winners.filter((entry) => entry.confirmedAt).length;

  const toggleSelected = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const updateSlot = (slotId: string, patch: Partial<RecruitmentSlot>) =>
    setConfiguration((current) =>
      current
        ? {
            ...current,
            recruitmentSlots: current.recruitmentSlots.map((slot) =>
              slot.id === slotId ? { ...slot, ...patch } : slot,
            ),
          }
        : current,
    );

  // ---- 操作（どの画面から呼んでも同じ確認を出す） ----
  const openFlow = async () => {
    if (!snapshot) return;
    const summary = readiness.usableSlots
      .map((slot) => `${instanceLabel(snapshot, slot.instanceId)}・${kindLabels[slot.kind]} ${slot.capacity}組`)
      .join("\n");
    const deadline = snapshot.settings.applicationDeadline
      ? `\n応募締切：${formatDate(snapshot.settings.applicationDeadline)}`
      : "";
    if (
      await confirm({
        title: "この内容で応募受付を開始しますか？",
        description: `${summary}\n（合計 ${readiness.maxWinners}組）${deadline}\nおまかせ応募：${snapshot.settings.featureSettings.showOmakase ? "受け付ける" : "受け付けない"}\n\n開始すると、お客様画面から応募できるようになります。`,
        label: "受付を開始する",
      })
    )
      void execute(openLottery, "応募受付を開始しました");
  };
  const closeFlow = async () => {
    if (
      await confirm({
        title: "応募受付を締め切りますか？",
        description: `現在 ${totals.groups}組（${totals.people}名）の応募があります。締め切ると、新しい応募と応募キャンセルができなくなります。抽選はまだ行われません。`,
        label: "受付を締め切る",
      })
    )
      void execute(closeLottery, "応募受付を締め切りました。次は「抽選する」です");
  };
  const runFlow = async () => {
    if (!snapshot) return;
    const summary = readiness.usableSlots
      .map((slot) => `${instanceLabel(snapshot, slot.instanceId)}・${kindLabels[slot.kind]} ${slot.capacity}組`)
      .join("\n");
    const notes = readiness.warnings.length
      ? `\n\n確認事項：\n${readiness.warnings.map((item) => `・${item}`).join("\n")}`
      : "";
    if (
      await confirm({
        title: "抽選しますか？",
        description: `次の枠で抽選します（最大${readiness.maxWinners}組が当選）。\n${summary}${notes}\n\nお客様には、結果を公開するまで表示されません。`,
        label: "抽選する",
      })
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
        "抽選しました。当選者を確認してから公開してください",
      );
  };
  const vacancyFlow = async () => {
    if (
      await confirm({
        title: "空いた枠を再抽選しますか？",
        description: `除外で空いた ${vacantTotal}組分を、落選予定の応募者から抽選します。今の当選者はそのままです。`,
        label: "空き枠を再抽選",
      })
    )
      void execute(redrawVacancies, "空いた枠を再抽選しました");
  };
  const publishFlow = async () => {
    if (
      await confirm({
        title: "結果をお客様に公開しますか？",
        description: `当選 ${winners.length}組の結果を公開します。公開後は除外の取り消しや抽選のやり直しができません。`,
        label: "結果を公開する",
      })
    )
      void execute(publishLotteryResults, "結果を公開しました");
  };

  // ホームの「今やること」で押すボタン。迷わないよう1つだけ出す
  const primaryAction: { label: string; run: () => void } | null = !snapshot
    ? null
    : snapshot.settings.state === "preparing"
      ? readiness.usableSlots.length
        ? { label: "抽選内容を確認する", run: () => void goTo("lottery") }
        : { label: "募集設定を開く", run: () => void goTo("settings") }
    : snapshot.settings.state === "accepting"
      ? readiness.usableSlots.length
        ? { label: "応募受付を締め切る", run: () => void closeFlow() }
        : { label: "募集設定を開く", run: () => void goTo("settings") }
      : snapshot.settings.state === "closed" && !readiness.blockers.length
        ? { label: "抽選する", run: () => void runFlow() }
        : snapshot.settings.state === "drawn" && vacantTotal > 0
          ? { label: "空き枠を再抽選する", run: () => void vacancyFlow() }
          : snapshot.settings.state === "drawn"
            ? { label: "当選者を確認して公開へ", run: () => void goTo("lottery") }
            : { label: "当選者を見る", run: () => void goTo("lottery") };

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
          <BrandMark size="lg" />
          <p className="mt-6 text-xs font-bold tracking-[0.18em] text-violet-600">
            STAFF ONLY
          </p>
          <h1 className="mt-2 text-3xl font-bold">従業員ログイン</h1>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            抽選の管理画面です。店長から共有された管理パスワードを入力してください。
          </p>
          <label className="mt-7 block text-sm font-semibold">
            管理パスワード
            <input
              autoComplete="current-password"
              autoFocus
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-violet-600"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          {error ? (
            <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="mt-5 w-full rounded-xl bg-slate-900 px-4 py-3 font-semibold text-white disabled:opacity-50"
            disabled={busy || !password}
            type="submit"
          >
            {busy ? "確認中…" : "ログイン"}
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

  const currentStep = snapshot ? stepIndex(snapshot.settings.state) : 0;
  const stepStatus = (index: number): "done" | "current" | "upcoming" =>
    index < currentStep ? "done" : index === currentStep ? "current" : "upcoming";

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <button
          className="admin-brand"
          onClick={() => void goTo("home")}
          type="button"
          aria-label="ホームへ"
        >
          <BrandMark size="sm" />
          <span>
            BAR MISAKI<small>STAFF CONSOLE</small>
          </span>
        </button>
        <nav aria-label="管理メニュー">
          {tabs.map((tab) => {
            const Icon = tabMeta[tab].icon;
            const needsAttention =
              tab === "lottery" && nextAction && (nextAction.tone === "action" || nextAction.tone === "warning") && nextAction.tab === "lottery";
            return (
              <button
                type="button"
                key={tab}
                aria-current={activeTab === tab ? "page" : undefined}
                onClick={() => void goTo(tab)}
              >
                <Icon aria-hidden="true" size={18} />
                <span className="admin-nav-text">
                  {tabMeta[tab].label}
                  <small>{tabMeta[tab].hint}</small>
                </span>
                {tab === "entries" ? <em>{totals.groups}</em> : null}
                {needsAttention ? <i className="admin-nav-dot" aria-label="操作が必要です" /> : null}
              </button>
            );
          })}
        </nav>
        <button
          className="admin-logout"
          onClick={() => void logoutAdmin().then(() => setSignedIn(false))}
          type="button"
        >
          <LogOut size={16} />
          ログアウト
        </button>
      </aside>
      <div className="admin-workspace">
        <header className="admin-location">
          <h1 className="text-xl font-bold text-slate-900">{tabMeta[activeTab].label}</h1>
          <div className="flex items-center gap-3">
            {snapshot ? (
              <span className="hidden text-xs text-slate-500 sm:inline">
                最終更新 {formatDate(snapshot.settings.lastUpdatedAt)}
              </span>
            ) : null}
            <button
              className="button-secondary"
              aria-label="最新の情報に更新"
              disabled={busy}
              onClick={() => void refresh(true)}
              type="button"
            >
              <RefreshCw size={16} />
              更新
            </button>
          </div>
        </header>

        {snapshot ? (
          <ol className="admin-progress" aria-label="抽選の進み具合">
            {flowSteps.map((step, index) => (
              <li
                key={step.key}
                className={`admin-progress-${stepStatus(index)}`}
                aria-current={index === currentStep ? "step" : undefined}
              >
                <span aria-hidden="true">{index < currentStep ? <Check size={14} /> : index + 1}</span>
                {step.label}
              </li>
            ))}
          </ol>
        ) : null}

        {error ? (
          <p
            className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}
        {!snapshot ? (
          <div className="rounded-2xl bg-white p-12 text-center" role="status">
            読み込み中…
          </div>
        ) : (
          <section className="rounded-2xl bg-white p-4 sm:p-6">
            {activeTab === "home" && nextAction ? (
              <div className="space-y-6">
                <section
                  className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-5 sm:p-6 ${nextActionTones[nextAction.tone]}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold tracking-[0.12em] opacity-70">
                      今やること
                    </p>
                    <h2 className="mt-1 text-2xl font-bold">{nextAction.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed">
                      {nextAction.description}
                    </p>
                  </div>
                  {primaryAction ? (
                    <button
                      className="button-primary admin-cta"
                      disabled={busy}
                      onClick={primaryAction.run}
                      type="button"
                    >
                      {busy ? "処理中…" : primaryAction.label}
                      <ArrowRight size={18} />
                    </button>
                  ) : null}
                </section>

                <section className="admin-kpis" aria-label="現在の数">
                  <div>
                    <span>応募</span>
                    <strong>{totals.groups}組 <small>{totals.people}名</small></strong>
                  </div>
                  <div>
                    <span>当選</span>
                    <strong>{winners.length}組</strong>
                  </div>
                  <div>
                    <span>来店確認済み</span>
                    <strong>{confirmedCount} / {winners.length}組</strong>
                  </div>
                  <div>
                    <span>募集枠</span>
                    <strong>{readiness.maxWinners}組</strong>
                  </div>
                </section>

                <div className="overview-grid">
                  <section>
                    <div className="section-heading">
                      <h2>新しい応募</h2>
                      <button className="text-sm font-semibold text-violet-700" onClick={() => void goTo("entries")} type="button">
                        すべて見る →
                      </button>
                    </div>
                    <EntryTable
                      snapshot={snapshot}
                      entries={[...entries]
                        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                        .slice(0, 5)}
                      emptyText="まだ応募はありません。お客様画面（/lottery）から応募が入るとここに表示されます。"
                    />
                  </section>
                  <aside className="operation-summary">
                    <h2>運営の流れ</h2>
                    <ol className="admin-guide">
                      <li><strong>募集設定</strong>で、使うインスタンスと席の数を決めて保存</li>
                      <li>「抽選・結果」で内容を確認して<strong>受付を開始</strong>。お客様が応募できるようになります</li>
                      <li>時間になったら<strong>受付を締め切る</strong></li>
                      <li><strong>抽選する</strong>（お客様にはまだ見えません）</li>
                      <li>当選者を確認し、来られない人は<strong>除外→空き枠を再抽選</strong></li>
                      <li><strong>結果を公開</strong>。来店時は当選者コードで確認</li>
                    </ol>
                  </aside>
                </div>
              </div>
            ) : null}

            {activeTab === "settings" && configuration ? (
              <div className="max-w-4xl space-y-6 pb-24">
                <Hint>
                  使うインスタンスをオンにして、席ごとに「募集する組数」を決めます。0組の席は募集しません。最後に画面下の「保存する」を押してください。
                </Hint>
                {!settingsEditable ? (
                  <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm font-semibold text-amber-900" role="alert">
                    いまは「{stateLabels[snapshot.settings.state]}」のため変更できません。募集設定は受付開始前か応募受付中のときだけ変更できます（新しい回は「抽選・結果」の一番下から始められます）。
                  </p>
                ) : snapshot.settings.state === "accepting" ? (
                  <p className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
                    受付中です。保存すると、お客様画面にすぐ反映されます。
                  </p>
                ) : null}

                <fieldset disabled={!settingsEditable} className="space-y-4">
                  <legend className="mb-3 text-lg font-bold">1. 募集する席と組数</legend>
                  {configuration.instances.map((instance) => {
                    const active = instance.visible && instance.enabled;
                    const slots = kindOrder.map(
                      (item) =>
                        configuration.recruitmentSlots.find(
                          (candidate) => candidate.instanceId === instance.id && candidate.kind === item,
                        )!,
                    );
                    const instanceTotal = slots.reduce(
                      (sum, slot) => sum + (slot.enabled ? slot.capacity : 0),
                      0,
                    );
                    return (
                      <section
                        className={`rounded-2xl border p-4 sm:p-5 ${active ? "border-violet-200 bg-white" : "border-slate-200 bg-slate-50"}`}
                        key={instance.id}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <Switch
                            checked={active}
                            label={`${instance.label}を使う`}
                            description={active ? `募集 ${instanceTotal}組` : "オフ：お客様には表示されません"}
                            onChange={(checked) =>
                              setConfiguration((current) =>
                                current
                                  ? {
                                      ...current,
                                      instances: current.instances.map((item) =>
                                        item.id === instance.id
                                          ? { ...item, visible: checked, enabled: checked }
                                          : item,
                                      ),
                                    }
                                  : current,
                              )
                            }
                          />
                          <label className="text-xs font-semibold text-slate-500">
                            お客様に見せる名前
                            <input
                              className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-900"
                              onChange={(event) =>
                                setConfiguration((current) =>
                                  current
                                    ? {
                                        ...current,
                                        instances: current.instances.map((item) =>
                                          item.id === instance.id ? { ...item, label: event.target.value } : item,
                                        ),
                                      }
                                    : current,
                                )
                              }
                              value={instance.label}
                            />
                          </label>
                        </div>
                        {active ? (
                          <div className="mt-4 grid gap-3 sm:grid-cols-3">
                            {slots.map((slot) => {
                              const capacity = slot.enabled ? slot.capacity : 0;
                              const applications = entries.filter(
                                (entry) =>
                                  entry.preferenceMode === "specified" &&
                                  entry.requestedInstanceId === instance.id &&
                                  entry.kind === slot.kind,
                              ).length;
                              const people =
                                peopleOptions.find((option) => option.min === slot.minPeople && option.max === slot.maxPeople)?.value ?? "1-2";
                              return (
                                <div
                                  className={`rounded-xl p-3 ${capacity ? "bg-violet-50" : "bg-slate-50"}`}
                                  key={slot.id}
                                >
                                  <div className="flex items-center justify-between">
                                    <strong>{kindLabels[slot.kind]}</strong>
                                    <span className="text-xs text-slate-500">応募 {applications}組</span>
                                  </div>
                                  <p className="mt-2 text-xs font-semibold text-slate-600">募集する組数</p>
                                  <Stepper
                                    label={`${instance.label}の${kindLabels[slot.kind]}の募集数`}
                                    value={capacity}
                                    onChange={(value) => updateSlot(slot.id, { capacity: value, enabled: value > 0 })}
                                  />
                                  {capacity ? (
                                    <label className="mt-2 block text-xs font-semibold text-slate-600">
                                      応募できる人数
                                      <select
                                        className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                                        onChange={(event) => {
                                          const option = peopleOptions.find((item) => item.value === event.target.value)!;
                                          updateSlot(slot.id, { minPeople: option.min, maxPeople: option.max });
                                        }}
                                        value={people}
                                      >
                                        {peopleOptions.map((option) => (
                                          <option key={option.value} value={option.value}>
                                            {option.label}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  ) : (
                                    <p className="mt-2 text-xs text-slate-500">募集しません</p>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        ) : null}
                      </section>
                    );
                  })}

                  <section className="rounded-2xl border border-slate-200 p-4 sm:p-5">
                    <h3 className="mb-3 text-lg font-bold">2. 応募締切（任意）</h3>
                    <label className="block text-sm font-semibold">
                      この時刻を過ぎると、お客様は応募できなくなります
                      <input
                        className="mt-2 w-full max-w-xs rounded-xl border border-slate-300 bg-white px-4 py-3"
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
                    <p className="mt-2 text-xs text-slate-500">
                      時刻を過ぎても抽選は自動では始まりません。「抽選・結果」で受付を締め切ってから抽選してください。
                    </p>
                  </section>

                  <details className="admin-details">
                    <summary>
                      <ChevronDown aria-hidden="true" size={16} />
                      3. お客様画面の表示（通常は変更不要）
                    </summary>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                      <Switch
                        checked={configuration.featureSettings.showOmakase}
                        label="おまかせ応募を受け付ける"
                        description="1人応募の方が、空いている席ならどこでもよいと選べます。指定応募の抽選後に残った枠へ入ります"
                        onChange={(checked) =>
                          setConfiguration((current) =>
                            current ? { ...current, featureSettings: { ...current.featureSettings, showOmakase: checked } } : current,
                          )
                        }
                      />
                      <Switch
                        checked={configuration.featureSettings.showInstanceSelection}
                        label="インスタンスを選ばせる"
                        description="オフにすると、お客様はインスタンスを選ばずに応募します"
                        onChange={(checked) =>
                          setConfiguration((current) =>
                            current ? { ...current, featureSettings: { ...current.featureSettings, showInstanceSelection: checked } } : current,
                          )
                        }
                      />
                      <Switch
                        checked={configuration.featureSettings.showKindSelection}
                        label="席の種類を選ばせる"
                        onChange={(checked) =>
                          setConfiguration((current) =>
                            current ? { ...current, featureSettings: { ...current.featureSettings, showKindSelection: checked } } : current,
                          )
                        }
                      />
                      {kindOrder.map((item) => (
                        <Switch
                          checked={configuration.featureSettings.kindVisibility[item]}
                          description="オフにすると、組数に関係なくこの席の募集を止めます"
                          key={item}
                          label={`${kindLabels[item]}を表示`}
                          onChange={(checked) =>
                            setConfiguration((current) =>
                              current
                                ? {
                                    ...current,
                                    featureSettings: {
                                      ...current.featureSettings,
                                      kindVisibility: { ...current.featureSettings.kindVisibility, [item]: checked },
                                    },
                                  }
                                : current,
                            )
                          }
                        />
                      ))}
                    </div>
                  </details>
                </fieldset>

                <div className={`admin-savebar ${configurationDirty ? "admin-savebar-dirty" : ""}`}>
                  <p>
                    {configurationDirty
                      ? "保存していない変更があります"
                      : "変更は保存されています"}
                    <span>
                      募集枠 合計{" "}
                      {configuration.recruitmentSlots
                        .filter(
                          (slot) =>
                            slot.enabled &&
                            slot.capacity > 0 &&
                            configuration.instances.some((instance) => instance.id === slot.instanceId && instance.visible && instance.enabled) &&
                            configuration.featureSettings.kindVisibility[slot.kind],
                        )
                        .reduce((sum, slot) => sum + slot.capacity, 0)}
                      組
                    </span>
                  </p>
                  <div className="flex gap-2">
                    <button
                      className="button-secondary"
                      disabled={busy || !configurationDirty}
                      onClick={() => setConfiguration(toConfiguration(snapshot))}
                      type="button"
                    >
                      元に戻す
                    </button>
                    <button
                      className="button-primary"
                      disabled={busy || !configurationDirty || !settingsEditable}
                      onClick={() =>
                        void execute(
                          () => updateLotteryConfiguration(configuration),
                          snapshot.settings.state === "preparing"
                            ? "保存しました。「抽選・結果」で内容を確認して受付を開始してください"
                            : "募集設定を保存しました",
                        )
                      }
                      type="button"
                    >
                      {busy ? "保存中…" : "保存する"}
                    </button>
                    {snapshot.settings.state === "preparing" && !configurationDirty ? (
                      <button className="button-primary" onClick={() => void goTo("lottery")} type="button">
                        受付開始へ進む →
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}

            {activeTab === "entries" ? (
              <div>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="admin-chips" role="group" aria-label="希望で絞り込む">
                    {(["all", "counter", "table", "private", "omakase"] as const).map((item) => (
                      <button
                        aria-pressed={entryFilter === item}
                        key={item}
                        onClick={() => setEntryFilter(item)}
                        type="button"
                      >
                        {item === "all" ? "すべて" : item === "omakase" ? "おまかせ" : kindLabels[item]}
                        <span>{totals.byFilter[item]}</span>
                      </button>
                    ))}
                  </div>
                  <label className="relative">
                    <span className="sr-only">応募者を検索</span>
                    <Search
                      aria-hidden="true"
                      className="absolute left-3 top-3 text-slate-400"
                      size={18}
                    />
                    <input
                      className="rounded-xl border border-slate-300 py-2.5 pl-10 pr-4 text-sm"
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="名前・X ID・応募番号"
                      type="search"
                      value={search}
                    />
                  </label>
                </div>
                <Hint>
                  お客様から「希望を間違えた」と連絡があったときは「希望を修正」で直せます。修正は操作履歴に残ります。
                </Hint>
                {entryEditor ? (
                  <div className="my-4 rounded-2xl border border-violet-300 bg-violet-50 p-4" role="region" aria-label="希望の修正">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-bold">
                          {entryEditor.entryNumber}（{entryEditor.representativeVrcName}）の希望を修正
                        </h3>
                        <p className="text-sm text-slate-600">変更内容は操作履歴に記録されます。</p>
                      </div>
                      <button className="button-secondary" onClick={() => setEntryEditor(null)} type="button">
                        やめる
                      </button>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-3">
                      <label className="text-sm font-semibold">
                        応募のしかた
                        <select
                          className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                          onChange={(event) =>
                            setEntryEditor((current) =>
                              current ? { ...current, preferenceMode: event.target.value as LotteryEntry["preferenceMode"] } : current,
                            )
                          }
                          value={entryEditor.preferenceMode}
                        >
                          <option value="specified">席を指定</option>
                          <option value="omakase">おまかせ</option>
                        </select>
                      </label>
                      {entryEditor.preferenceMode === "specified" ? (
                        <>
                          <label className="text-sm font-semibold">
                            インスタンス
                            <select
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                              onChange={(event) =>
                                setEntryEditor((current) =>
                                  current ? { ...current, requestedInstanceId: event.target.value as LotteryEntry["requestedInstanceId"] } : current,
                                )
                              }
                              value={entryEditor.requestedInstanceId ?? "instance1"}
                            >
                              {snapshot.settings.instances.map((instance) => (
                                <option key={instance.id} value={instance.id}>
                                  {instance.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="text-sm font-semibold">
                            席
                            <select
                              className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2"
                              onChange={(event) =>
                                setEntryEditor((current) => (current ? { ...current, kind: event.target.value as LotteryKind } : current))
                              }
                              value={entryEditor.kind}
                            >
                              {kindOrder.map((item) => (
                                <option key={item} value={item}>
                                  {kindLabels[item]}
                                </option>
                              ))}
                            </select>
                          </label>
                        </>
                      ) : (
                        <p className="self-end text-sm text-slate-600 sm:col-span-2">
                          おまかせは、指定応募の抽選後に残った枠へ割り当てられます。
                        </p>
                      )}
                    </div>
                    <button
                      className="button-primary mt-4"
                      disabled={busy}
                      onClick={() =>
                        void execute(async () => {
                          await adminUpdateLotteryEntry(entryEditor.id, {
                            kind: entryEditor.kind,
                            instanceId: entryEditor.requestedInstanceId ?? "instance1",
                            preferenceMode: entryEditor.preferenceMode,
                          });
                          setEntryEditor(null);
                        }, "希望を修正しました")
                      }
                      type="button"
                    >
                      {busy ? "保存中…" : "修正を保存"}
                    </button>
                  </div>
                ) : null}
                <div className="mt-4">
                  <EntryTable
                    snapshot={snapshot}
                    entries={filteredEntries}
                    onEdit={(entry) => setEntryEditor(entry)}
                    emptyText={entries.length ? "条件に合う応募はありません。" : "まだ応募はありません。"}
                  />
                </div>
              </div>
            ) : null}

            {activeTab === "lottery" ? (
              <div className="flow-steps-admin">
                <FlowStep
                  number={1}
                  title="抽選内容を確認して受付を開始する"
                  status={stepStatus(0)}
                  summary={
                    currentStep === 0
                      ? "下の内容でよければ受付を開始します。開始するまでお客様は応募できません。"
                      : `受付開始済みです（募集 合計${readiness.maxWinners}組）。`
                  }
                >
                  <div className="space-y-4">
                    {readiness.usableSlots.length ? (
                      <div className="overflow-x-auto rounded-2xl border border-slate-200">
                        <table className="min-w-full text-left text-sm">
                          <thead className="bg-slate-50 text-xs text-slate-500">
                            <tr>
                              <th className="px-4 py-3">インスタンス</th>
                              <th className="px-4 py-3">席</th>
                              <th className="px-4 py-3">募集</th>
                              <th className="px-4 py-3">応募できる人数</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 bg-white">
                            {readiness.usableSlots.map((slot) => (
                              <tr key={slot.id}>
                                <td className="px-4 py-3 font-semibold">{instanceLabel(snapshot, slot.instanceId)}</td>
                                <td className="px-4 py-3">{kindLabels[slot.kind]}</td>
                                <td className="px-4 py-3 font-semibold">{slot.capacity}組</td>
                                <td className="px-4 py-3">
                                  {peopleOptions.find((option) => option.min === slot.minPeople && option.max === slot.maxPeople)?.label ??
                                    `${slot.minPeople}〜${slot.maxPeople}人`}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">
                        ✕ 募集する枠がありません。募集設定で、使うインスタンスと組数を決めてください。
                      </p>
                    )}
                    <dl className="grid gap-3 text-sm sm:grid-cols-3">
                      <div className="rounded-xl bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">募集 合計</dt>
                        <dd className="mt-1 font-bold">{readiness.maxWinners}組</dd>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">応募締切</dt>
                        <dd className="mt-1 font-bold">
                          {snapshot.settings.applicationDeadline ? formatDate(snapshot.settings.applicationDeadline) : "なし（手動で締め切る）"}
                        </dd>
                      </div>
                      <div className="rounded-xl bg-slate-50 p-3">
                        <dt className="text-xs text-slate-500">おまかせ応募</dt>
                        <dd className="mt-1 font-bold">
                          {snapshot.settings.featureSettings.showOmakase ? "受け付ける" : "受け付けない"}
                        </dd>
                      </div>
                    </dl>
                    {snapshot.settings.featureSettings.showOmakase ? (
                      <Hint>
                        おまかせ応募は、席を指定した応募の抽選後に、使用中インスタンスの余った枠へ入ります。余りが複数のインスタンスにあるときは、人数ができるだけ均等になるように割り振ります。
                      </Hint>
                    ) : null}
                    <div className="flex flex-wrap gap-3">
                      <button
                        className="button-primary admin-cta"
                        disabled={busy || !readiness.usableSlots.length}
                        onClick={() => void openFlow()}
                        type="button"
                      >
                        {busy ? "処理中…" : "この内容で受付を開始する"}
                      </button>
                      <button className="button-secondary" onClick={() => void goTo("settings")} type="button">
                        募集設定を変更する
                      </button>
                    </div>
                  </div>
                </FlowStep>

                <FlowStep
                  number={2}
                  title="応募受付を締め切る"
                  status={stepStatus(1)}
                  summary={
                    currentStep < 1
                      ? undefined
                      : currentStep === 1
                        ? `いま ${totals.groups}組（${totals.people}名）が応募しています。`
                        : "受付は締め切り済みです。"
                  }
                >
                  <p className="text-sm leading-relaxed text-slate-600">
                    締め切ると、新しい応募と応募キャンセルが止まります。<strong>この操作だけでは抽選されません。</strong>
                  </p>
                  <button
                    className="button-primary mt-4"
                    disabled={busy}
                    onClick={() => void closeFlow()}
                    type="button"
                  >
                    {busy ? "処理中…" : "応募受付を締め切る"}
                  </button>
                </FlowStep>

                <FlowStep
                  number={3}
                  title="抽選する"
                  status={stepStatus(2)}
                  summary={currentStep > 2 ? "抽選済みです。" : `最大 ${readiness.maxWinners}組が当選します。`}
                >
                  <div className="space-y-4">
                    {readiness.blockers.length ? (
                      <ul className="space-y-1.5 rounded-xl bg-red-50 p-4 text-sm font-semibold text-red-700" role="alert">
                        {readiness.blockers.map((item) => (
                          <li key={item}>✕ {item}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rounded-xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
                        ✓ 抽選できます
                      </p>
                    )}
                    {readiness.warnings.length ? (
                      <ul className="space-y-1.5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">
                        {readiness.warnings.map((item) => (
                          <li key={item}>！ {item}</li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {readiness.usableSlots.map((slot) => (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4" key={slot.id}>
                          <strong className="block">
                            {instanceLabel(snapshot, slot.instanceId)}・{kindLabels[slot.kind]}
                          </strong>
                          <span className="text-sm text-slate-600">
                            募集 {slot.capacity}組 ／ 指定応募{" "}
                            {entries.filter((entry) => entry.preferenceMode === "specified" && entry.requestedInstanceId === slot.instanceId && entry.kind === slot.kind).length}組
                          </span>
                        </div>
                      ))}
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                        <strong className="block">おまかせ応募</strong>
                        <span className="text-sm text-amber-900">
                          {totals.byFilter.omakase}組（指定応募の後、残った枠に入ります）
                        </span>
                      </div>
                    </div>
                    <button
                      className="button-primary"
                      disabled={busy || readiness.blockers.length > 0}
                      onClick={() => void runFlow()}
                      type="button"
                    >
                      {busy ? "抽選中…" : "抽選する"}
                    </button>
                    <p className="text-xs text-slate-500">抽選しても、結果を公開するまでお客様には表示されません。</p>
                  </div>
                </FlowStep>

                <FlowStep
                  number={4}
                  title="当選者を確認する"
                  status={stepStatus(3)}
                  summary={
                    currentStep > 3
                      ? `当選 ${winners.length}組で確定しました。`
                      : currentStep === 3
                        ? `当選 ${winners.length}組。来られない人がいれば除外して、空いた枠を再抽選できます。`
                        : undefined
                  }
                >
                  <div className="space-y-5">
                    <div className="admin-actionbar" hidden={!selectedWinners.length}>
                      <span>{selectedWinners.length}組を選択中</span>
                      <button
                        className="rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
                        disabled={busy || !selectedWinners.length}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "選んだ当選者を除外しますか？",
                              description: `${selectedWinners.map((entry) => entry.representativeVrcName).join("、")} を当選から外します。外した数だけ空き枠ができ、再抽選できます。公開前なら取り消せます。`,
                              label: "当選から除外",
                              danger: true,
                            })
                          )
                            void execute(() => excludeWinners(selectedWinners.map((entry) => entry.id)), "当選者を除外しました。次は空き枠を再抽選してください");
                        }}
                        type="button"
                      >
                        当選から除外する
                      </button>
                      <button className="text-sm font-semibold" onClick={() => setSelected(new Set())} type="button">
                        選択を解除
                      </button>
                    </div>
                    <EntryTable
                      snapshot={snapshot}
                      entries={winners}
                      onSelect={toggleSelected}
                      selectable
                      selected={selected}
                      emptyText="当選者はいません。"
                    />

                    {vacantTotal > 0 ? (
                      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
                        <h3 className="font-bold text-amber-950">空いた枠が {vacantTotal}組 あります</h3>
                        <p className="mt-1 text-sm text-amber-900">
                          公開する前に、落選予定の応募者から再抽選してください。
                        </p>
                        <button className="button-primary mt-3" disabled={busy} onClick={() => void vacancyFlow()} type="button">
                          {busy ? "処理中…" : "空き枠を再抽選する"}
                        </button>
                      </div>
                    ) : null}

                    {excluded.length ? (
                      <div>
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <h3 className="font-bold">除外した応募（{excluded.length}組）</h3>
                          <button
                            className="rounded-xl border border-orange-400 px-4 py-2.5 text-sm font-semibold text-orange-700 disabled:opacity-40"
                            disabled={busy || !selectedExcluded.length}
                            hidden={!selectedExcluded.length}
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: "除外を取り消しますか？",
                                  description: `${selectedExcluded.length}組を当選に戻します。`,
                                  label: "当選に戻す",
                                })
                              )
                                void execute(() => undoExclusions(selectedExcluded.map((entry) => entry.id)), "除外を取り消しました");
                            }}
                            type="button"
                          >
                            選んだ{selectedExcluded.length}組を当選に戻す
                          </button>
                        </div>
                        <EntryTable snapshot={snapshot} entries={excluded} onSelect={toggleSelected} selectable selected={selected} />
                      </div>
                    ) : null}

                    <details className="admin-details">
                      <summary>
                        <ChevronDown aria-hidden="true" size={16} />
                        抽選を最初からやり直す（通常は不要）
                      </summary>
                      <p className="mt-3 text-sm text-slate-600">
                        当選のまま残したい組にチェックを入れてください。チェックしなかった枠をすべて抽選し直します。
                      </p>
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {winners.map((entry) => (
                          <label
                            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${lockedWinners.has(entry.id) ? "border-emerald-400 bg-emerald-50" : "border-slate-200 bg-white"}`}
                            key={entry.id}
                          >
                            <input
                              checked={lockedWinners.has(entry.id)}
                              onChange={(event) =>
                                setLockedWinners((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(entry.id);
                                  else next.delete(entry.id);
                                  return next;
                                })
                              }
                              type="checkbox"
                            />
                            <span>
                              <strong className="block">{entry.representativeVrcName}</strong>
                              <span className="text-xs text-slate-600">
                                {entry.entryNumber}・{kindLabels[entry.assignedKind ?? entry.kind]}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      <button
                        className="button-secondary mt-3"
                        disabled={busy}
                        onClick={async () => {
                          if (
                            await confirm({
                              title: "抽選をやり直しますか？",
                              description: `残す ${lockedWinners.size}組以外の当選結果を破棄して、同じ条件で抽選し直します。`,
                              label: "やり直す",
                              danger: true,
                            })
                          )
                            void execute(() => redrawLottery([...lockedWinners]), "抽選をやり直しました");
                        }}
                        type="button"
                      >
                        {lockedWinners.size ? `${lockedWinners.size}組を残してやり直す` : "すべてやり直す"}
                      </button>
                    </details>
                  </div>
                </FlowStep>

                <FlowStep
                  number={5}
                  title="結果を公開する"
                  status={
                    snapshot.settings.state === "published"
                      ? "done"
                      : snapshot.settings.state === "drawn" && vacantTotal === 0
                        ? "current"
                        : "upcoming"
                  }
                  summary={
                    snapshot.settings.state === "published"
                      ? `${formatDate(snapshot.settings.publishedAt)} に公開しました。来店確認済み ${confirmedCount} / ${winners.length}組`
                      : snapshot.settings.state === "drawn" && vacantTotal > 0
                        ? "空き枠の再抽選が終わると公開できます。"
                        : undefined
                  }
                >
                  <div className="flow-publish">
                    <p className="text-sm text-slate-700">
                      当選者に問題がなければ公開します。お客様はコインガチャで結果を開封します。
                      <strong className="block">公開後は除外の取り消しや抽選のやり直しはできません。</strong>
                    </p>
                    <button
                      className="button-primary admin-cta"
                      disabled={busy}
                      onClick={() => void publishFlow()}
                      type="button"
                    >
                      {busy ? "処理中…" : "結果を公開する"}
                    </button>
                  </div>
                </FlowStep>

                {snapshot.settings.state === "published" ? (
                  <div className="space-y-5">
                    <Hint>
                      来店したお客様の当選者コードを、お客様画面の「当選者コードで確認」に入力すると来店確認済みになります。
                    </Hint>
                    <EntryTable snapshot={snapshot} entries={winners} emptyText="当選者はいません。" />
                    {cancelled.length ? (
                      <div>
                        <h3 className="mb-3 font-bold">当選取り消し（{cancelled.length}組）</h3>
                        <EntryTable snapshot={snapshot} entries={cancelled} />
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <section className="danger-zone">
                  <div>
                    <h3>次の回を始める（リセット）</h3>
                    <p>
                      今回の応募・抽選結果・当選者コードをすべて無効にして、「抽選内容の設定」からやり直します。募集設定と操作履歴は残ります。
                    </p>
                  </div>
                  <button
                    className="button-secondary"
                    disabled={busy}
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "リセットして次の回を始めますか？",
                          description:
                            "今回の応募・抽選結果・当選者コードがすべて無効になります。この操作は取り消せません。",
                          label: "リセットする",
                          danger: true,
                          keyword: "リセット",
                        })
                      )
                        void execute(() => resetLottery("リセット"), "リセットしました。抽選内容を確認して受付を開始してください");
                    }}
                    type="button"
                  >
                    リセットする
                  </button>
                </section>
              </div>
            ) : null}

            {activeTab === "history" ? (
              <div>
                <Hint>抽選・公開・除外などの操作が新しい順に記録されています。記録は削除されません。</Hint>
                <ol className="mt-4 space-y-2">
                  {snapshot.audits.map((audit) => (
                    <li
                      className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 p-4"
                      key={audit.id}
                    >
                      <div>
                        <strong>{audit.action}</strong>
                        <p className="mt-1 text-sm text-slate-600">{audit.details}</p>
                      </div>
                      <time className="text-xs text-slate-500" dateTime={audit.createdAt}>
                        {formatDate(audit.createdAt)}
                      </time>
                    </li>
                  ))}
                  {!snapshot.audits.length ? (
                    <li className="rounded-xl border border-slate-200 p-8 text-center text-sm text-slate-500">
                      まだ操作履歴はありません。
                    </li>
                  ) : null}
                </ol>
              </div>
            ) : null}
          </section>
        )}
      </div>
      {confirmation}
      <Toast message={error || message} error={Boolean(error)} />
    </main>
  );
};
