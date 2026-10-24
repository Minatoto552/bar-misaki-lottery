import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  Armchair,
  Check,
  Crown,
  DoorOpen,
  LoaderCircle,
  Sparkles,
  Ticket,
  Trash2,
  Users,
} from "lucide-react";

import type {
  InstanceId,
  LotteryKind,
  PreferenceMode,
  PublicLotterySnapshot,
} from "../../shared/models";
import { submitLotterySchema } from "../../shared/validation";
import { Toast } from "../components/Feedback";
import { useConfirmation } from "../components/useConfirmation";
import { PublicHeader } from "../components/Brand";
import { GuestCoinGallery } from "../components/GuestCoinGallery";
import { usePollingWhileVisible } from "../lib/usePollingWhileVisible";
import { LotteryGacha } from "../components/LotteryGacha";
import {
  cancelLotteryEntry,
  cancelWinnerByCode,
  confirmWinnerByCode,
  ensureDeviceToken,
  getPublicLotterySnapshot,
  lookupWinnerCode,
  LOTTERY_UPDATED_EVENT,
  submitLotteryEntry,
} from "../lib/lottery-api";

const stateLabels = {
  accepting: "応募受付中",
  drawing: "抽選中",
  drawn: "結果公開待ち",
  published: "結果発表",
  closed: "受付終了",
};
const kindLabels: Record<LotteryKind, string> = {
  counter: "カウンター",
  private: "個室",
  table: "テーブル席",
};

export const LotteryPage = () => {
  const [kind, setKind] = useState<LotteryKind>("counter");
  const [instanceId, setInstanceId] = useState<InstanceId>("instance1");
  const [preferenceMode, setPreferenceMode] =
    useState<PreferenceMode>("specified");
  const [applicantCount, setApplicantCount] = useState<1 | 2>(1);
  const [editing, setEditing] = useState(false);
  const [representativeId, setRepresentativeId] = useState("");
  const [representativeVrcName, setRepresentativeVrcName] = useState("");
  const [companionVrcName, setCompanionVrcName] = useState("");
  const [snapshot, setSnapshot] = useState<PublicLotterySnapshot | null>(null);
  const [codeSnapshot, setCodeSnapshot] =
    useState<PublicLotterySnapshot | null>(null);
  const [winnerCodeInput, setWinnerCodeInput] = useState(
    () => localStorage.getItem("bar-misaki-winner-code") ?? "",
  );
  const [codeLoading, setCodeLoading] = useState(false);
  const { confirm, confirmation } = useConfirmation();
  const [activeCode, setActiveCode] = useState(
    () => localStorage.getItem("bar-misaki-winner-code") ?? "",
  );
  const [toast, setToast] = useState("");
  const [gachaStep, setGachaStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const token = ensureDeviceToken();

  const refresh = useCallback(async () => {
    try {
      const next = await getPublicLotterySnapshot(token);
      setSnapshot(next);
      if (activeCode && next.settings.state === "published") {
        try {
          setCodeSnapshot(await lookupWinnerCode(activeCode));
        } catch {
          setCodeSnapshot(null);
          setActiveCode("");
          localStorage.removeItem("bar-misaki-winner-code");
        }
      } else setCodeSnapshot(null);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通信に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [token, activeCode]);

  const lookupCode = async () => {
    setCodeLoading(true);
    setError("");
    try {
      const found = await lookupWinnerCode(winnerCodeInput);
      setCodeSnapshot(found);
      setActiveCode(winnerCodeInput.trim().toUpperCase());
      localStorage.setItem(
        "bar-misaki-winner-code",
        winnerCodeInput.trim().toUpperCase(),
      );
    } catch (caught) {
      setCodeSnapshot(null);
      setError(
        caught instanceof Error
          ? caught.message
          : "WINNER CODEの確認に失敗しました",
      );
    } finally {
      setCodeLoading(false);
    }
  };

  const cancelWinner = async (codeOverride = "") => {
    const code = codeOverride || winnerCodeInput;
    if (
      !code ||
      !(await confirm({
        title: "当選を取り消しますか？",
        description:
          "取り消し後は当選画面を表示できません。運営画面にも取り消しとして記録されます。",
        label: "当選を取り消す",
        danger: true,
      }))
    )
      return;
    setCodeLoading(true);
    setError("");
    try {
      await cancelWinnerByCode(code);
      setWinnerCodeInput(code);
      setCodeSnapshot(await lookupWinnerCode(code));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "当選の取り消しに失敗しました",
      );
    } finally {
      setCodeLoading(false);
    }
  };

  const confirmWinner = async (codeOverride = "") => {
    const code = codeOverride || winnerCodeInput;
    if (
      !code ||
      !(await confirm({
        title: "WINNER CODEを確認済みにしますか？",
        description: "確認すると、運営画面に確認済みとして記録されます。",
        label: "確認済みにする",
      }))
    )
      return;
    setCodeLoading(true);
    setError("");
    try {
      await confirmWinnerByCode(code);
      setCodeSnapshot(await lookupWinnerCode(code));
      setToast("確認済みとして記録しました");
      setSnapshot(await getPublicLotterySnapshot(token));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "コードの確認に失敗しました",
      );
    } finally {
      setCodeLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const onUpdate = () => void refresh();
    window.addEventListener(LOTTERY_UPDATED_EVENT, onUpdate);
    window.addEventListener("focus", onUpdate);
    return () => {
      window.removeEventListener(LOTTERY_UPDATED_EVENT, onUpdate);
      window.removeEventListener("focus", onUpdate);
    };
  }, [refresh]);
  // 非表示タブでは取得しない。表示に戻ったとき usePollingWhileVisible が即時に再取得する
  usePollingWhileVisible(refresh, 4000);

  useEffect(() => {
    const available = snapshot?.settings.availableKinds;
    if (available?.length && !available.includes(kind)) setKind(available[0]);
  }, [snapshot?.settings.availableKinds, kind]);

  useEffect(() => {
    const current = snapshot?.entry;
    if (!current) return;
    setKind(current.kind);
    setInstanceId(current.requestedInstanceId ?? "instance1");
    setPreferenceMode(current.preferenceMode);
    setRepresentativeId(current.representativeId);
    setRepresentativeVrcName(current.representativeVrcName);
    setCompanionVrcName(current.companionVrcName ?? "");
    setApplicantCount(current.peopleCount === 2 ? 2 : 1);
  }, [snapshot?.entry?.id]);

  const submit = async () => {
    if (applicantCount === 2 && !companionVrcName.trim()) {
      setError("同行者のVRC名を入力してください");
      return;
    }
    const fallbackSlot = activeSlots.find(
      (slot) =>
        applicantCount >= slot.minPeople &&
        applicantCount <= slot.maxPeople &&
        (!snapshot?.settings.featureSettings.showKindSelection ||
          slot.kind === kind) &&
        (!snapshot?.settings.featureSettings.showInstanceSelection ||
          slot.instanceId === instanceId),
    );
    const parsed = submitLotterySchema.safeParse({
      kind:
        snapshot?.settings.featureSettings.showKindSelection || !fallbackSlot
          ? kind
          : fallbackSlot.kind,
      instanceId:
        snapshot?.settings.featureSettings.showInstanceSelection || !fallbackSlot
          ? instanceId
          : fallbackSlot.instanceId,
      preferenceMode,
      representativeId,
      representativeVrcName,
      companionVrcName,
      token,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "入力内容を確認してください");
      return;
    }
    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      await submitLotteryEntry(parsed.data);
      setEditing(false);
      await refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "応募の送信に失敗しました",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    setSubmitting(true);
    setError("");
    try {
      await cancelLotteryEntry(token);
      setCodeSnapshot(null);
      setActiveCode("");
      setWinnerCodeInput("");
      localStorage.removeItem("bar-misaki-winner-code");
      setKind("counter");
      setRepresentativeId("");
      setRepresentativeVrcName("");
      setCompanionVrcName("");
      setNotice("応募をキャンセルしました。");
      await refresh();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "応募のキャンセルに失敗しました",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const activeSnapshot = codeSnapshot ?? snapshot;
  const entry = activeSnapshot?.entry;
  const isPublished = activeSnapshot?.settings.state === "published";
  const availableKinds = snapshot?.settings.availableKinds ?? [];
  const activeInstances =
    snapshot?.settings.instances.filter(
      (instance) => instance.visible && instance.enabled,
    ) ?? [];
  const activeSlots =
    snapshot?.settings.recruitmentSlots.filter(
      (slot) =>
        slot.enabled &&
        slot.capacity > 0 &&
        activeInstances.some((instance) => instance.id === slot.instanceId) &&
        snapshot.settings.featureSettings.kindVisibility[slot.kind],
    ) ?? [];
  const selectableKinds = availableKinds.filter((item) =>
    activeSlots.some(
      (slot) =>
        slot.kind === item &&
        applicantCount >= slot.minPeople &&
        applicantCount <= slot.maxPeople &&
        (!snapshot?.settings.featureSettings.showInstanceSelection ||
          slot.instanceId === instanceId),
    ),
  );
  const deadlinePassed = Boolean(
    snapshot?.settings.applicationDeadline &&
      Date.now() >= new Date(snapshot.settings.applicationDeadline).getTime(),
  );

  return (
    <main className="customer-page">
      <PublicHeader />
      <section className="customer-stage">
        <div className="customer-flow">
          <ol className="flow-steps" aria-label="応募から結果確認まで">
            {["APPLY", "SELECT COIN", "DRAW", "RESULT"].map((label, index) => (
              <li
                key={label}
                aria-current={
                  (entry && isPublished
                    ? codeSnapshot ||
                      entry.status === "excluded" ||
                      entry.status === "cancelled"
                      ? 3
                      : gachaStep
                    : 0) === index
                    ? "step"
                    : undefined
                }
              >
                <span>0{index + 1}</span>
                {label}
              </li>
            ))}
          </ol>
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="customer-panel"
            initial={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
          >
            {loading ? (
              <div className="grid min-h-72 place-items-center" role="status">
                <LoaderCircle className="animate-spin" size={32} />
              </div>
            ) : entry && !editing ? (
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-4">
                  <span className="rounded-full bg-white/65 px-4 py-2 text-xs font-bold tracking-wider">
                    {stateLabels[activeSnapshot!.settings.state]}
                  </span>
                  <span className="text-xs font-semibold opacity-55">
                    {entry.entryNumber}
                  </span>
                </div>
                {isPublished && entry.status !== "pending" ? (
                  <LotteryGacha
                    key={`${entry.id}:${entry.status}:${entry.winnerCode ?? "none"}`}
                    bypass={
                      Boolean(codeSnapshot) ||
                      entry.status === "excluded" ||
                      entry.status === "cancelled"
                    }
                    onStep={setGachaStep}
                    entryId={entry.id}
                    resultVersion={`${entry.status}:${entry.winnerCode ?? entry.drawnAt ?? ""}`}
                    roundId={activeSnapshot!.settings.roundId}
                  >
                    {entry.status === "winner" ? (
                      <div className="text-center">
                        <div className="mx-auto mb-4 grid h-20 w-20 place-items-center rounded-full bg-[var(--color-accent)] text-white shadow-[0_12px_36px_rgba(115,66,226,0.3)]">
                          <Crown size={38} />
                        </div>
                        <p className="mb-2 text-sm font-bold tracking-[0.18em] text-[var(--color-accent)]">
                          CONGRATULATIONS
                        </p>
                        <h1 className="hero-heading mb-3">当選しました！</h1>
                        <p className="opacity-75">
                          このコードを入力すると、別端末でも当選画面を表示できます。
                        </p>
                        <div className="winner-code">
                          <span className="mb-2 block text-xs font-semibold tracking-[0.2em] opacity-60">
                            WINNER CODE
                          </span>
                          <strong className="font-mono text-[clamp(1.8rem,8vw,2.8rem)] tracking-[0.12em]">
                            {entry.winnerCode}
                          </strong>
                          <button
                            className="copy-code"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  entry.winnerCode ?? "",
                                );
                                setToast("コピーしました");
                              } catch {
                                setError(
                                  "コピーできませんでした。コードを選択してコピーしてください。",
                                );
                              }
                            }}
                          >
                            コードをコピー
                          </button>
                        </div>
                        <div className="flex flex-wrap justify-center gap-3">
                          {!entry.confirmedAt ? (
                            <button
                              className="rounded-full bg-[var(--color-accent)] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
                              disabled={codeLoading}
                              onClick={() =>
                                void confirmWinner(entry.winnerCode ?? "")
                              }
                              type="button"
                            >
                              コードを確認
                            </button>
                          ) : (
                            <span className="rounded-full bg-emerald-100 px-5 py-3 text-sm font-semibold text-emerald-700">
                              確認済み
                            </span>
                          )}
                          <button
                            className="rounded-full border border-red-300 bg-white/60 px-5 py-3 text-sm font-semibold text-red-700 disabled:opacity-50"
                            disabled={codeLoading}
                            onClick={() =>
                              void cancelWinner(entry.winnerCode ?? "")
                            }
                            type="button"
                          >
                            当選を取り消す
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="py-4 text-center">
                        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-white/70">
                          <Sparkles size={30} />
                        </div>
                        <h1 className="hero-heading mb-4">
                          {entry.status === "cancelled"
                            ? "当選を取り消しました"
                            : "今回は落選となりました"}
                        </h1>
                        <p className="leading-relaxed opacity-75">
                          ご応募ありがとうございました。次回のBar
                          Misakiもぜひお楽しみに。
                        </p>
                      </div>
                    )}
                  </LotteryGacha>
                ) : isPublished ? (
                  <div className="py-4 text-center">
                    <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-full bg-white/70">
                      <Ticket size={30} />
                    </div>
                    <h1 className="hero-heading mb-4">
                      この項目は、抽選対象外です
                    </h1>
                    <p className="leading-relaxed opacity-75">
                      この応募項目は、今回抽選を実施しておりません。
                    </p>
                  </div>
                ) : (
                  <div className="py-2 text-center">
                    <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-[var(--color-accent)] text-white">
                      <Check size={30} />
                    </div>
                    <p className="mb-2 text-sm font-bold tracking-[0.16em] text-[var(--color-accent)]">
                      ENTRY COMPLETE
                    </p>
                    <h1 className="hero-heading mb-4">応募が完了しました</h1>
                    <p className="leading-relaxed opacity-75">
                      抽選結果が公開されるまで、このままお待ちください。ページを閉じても同じ端末から確認できます。
                    </p>
                  </div>
                )}
                <dl className="entry-summary">
                  <div className="flex justify-between gap-4">
                    <dt className="opacity-55">現在の応募設定</dt>
                    <dd className="font-bold">
                      {entry.preferenceMode === "omakase"
                        ? "おまかせ"
                        : `${activeSnapshot?.settings.instances.find((item) => item.id === entry.requestedInstanceId)?.label ?? "インスタンス未設定"}・${kindLabels[entry.kind]}`}
                    </dd>
                  </div>
                  {entry.status === "winner" && entry.assignedInstanceId ? (
                    <div className="flex justify-between gap-4">
                      <dt className="opacity-55">当選枠</dt>
                      <dd className="font-bold">
                        {activeSnapshot?.settings.instances.find((item) => item.id === entry.assignedInstanceId)?.label}・
                        {kindLabels[entry.assignedKind ?? entry.kind]}
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-4">
                    <dt className="opacity-55">応募項目</dt>
                    <dd className="font-bold">{kindLabels[entry.kind]}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="opacity-55">代表者X</dt>
                    <dd className="font-bold">{entry.representativeId}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="opacity-55">代表者VRC名</dt>
                    <dd className="font-bold">{entry.representativeVrcName}</dd>
                  </div>
                  {entry.companionVrcName ? (
                    <div className="flex justify-between gap-4">
                      <dt className="opacity-55">同行者VRC名</dt>
                      <dd className="font-bold">{entry.companionVrcName}</dd>
                    </div>
                  ) : null}
                </dl>
                {snapshot?.settings.state === "accepting" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <button
                      className="rounded-full bg-[var(--color-accent)] px-5 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                      disabled={submitting || deadlinePassed}
                      onClick={() => setEditing(true)}
                      type="button"
                    >
                      応募内容を変更
                    </button>
                    <button
                      className="flex items-center justify-center gap-2 rounded-full border border-red-300 bg-white/50 px-5 py-3.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                      disabled={submitting || deadlinePassed}
                      onClick={async () => {
                      if (
                        await confirm({
                          title: "応募をキャンセルしますか？",
                          description:
                            "応募を取り消してホームへ戻ります。受付中は再び応募できます。",
                          label: "応募をキャンセル",
                          danger: true,
                        })
                      )
                        void cancel();
                      }}
                      type="button"
                    >
                      <Trash2 size={17} />
                      応募をキャンセル
                    </button>
                  </div>
                ) : null}
                {entry.legacyAutoOmakase ? (
                  <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-800">
                    インスタンスが未設定だったため、おまかせに設定されています。応募締切までは、希望するインスタンスや席種に変更できます。
                  </p>
                ) : null}
              </div>
            ) : snapshot?.settings.state === "published" ? (
              <div>
                <h1 className="hero-heading mb-4">WINNER CODEを入力</h1>
                <p className="mb-6 text-sm leading-relaxed opacity-70">
                  当選者はWINNER
                  CODEを入力すると、別の端末でも当選画面を表示できます。
                </p>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void lookupCode();
                  }}
                >
                  <input
                    className="w-full rounded-2xl border border-white/70 bg-white/65 px-4 py-3.5 font-mono uppercase tracking-widest outline-none focus:border-[var(--color-accent)]"
                    aria-label="WINNER CODE"
                    autoComplete="off"
                    onChange={(event) =>
                      setWinnerCodeInput(
                        event.target.value.toUpperCase().trim(),
                      )
                    }
                    placeholder="MSK-XXXXXX"
                    value={winnerCodeInput}
                  />
                  <button
                    className="w-full rounded-full bg-[var(--color-accent)] px-6 py-4 font-semibold text-white disabled:opacity-50"
                    disabled={
                      codeLoading ||
                      !/^MSK-[A-Z0-9]{6}$/.test(winnerCodeInput.trim())
                    }
                    type="submit"
                  >
                    {codeLoading ? "確認中..." : "当選画面を表示"}
                  </button>
                </form>
              </div>
            ) : snapshot?.settings.state === "accepting" ? (
              <div>
                <p className="mb-3 flex items-center gap-2 text-sm font-bold tracking-[0.16em] text-[var(--color-accent)]">
                  <Ticket size={18} /> BAR MISAKI LOTTERY
                </p>
                <h1 className="hero-heading mb-4">
                  {editing ? "応募内容を変更する" : "BarMisakiの抽選に応募する"}
                </h1>
                <p className="mb-7 max-w-lg text-sm leading-relaxed opacity-70">
                  現在募集中の席を選び、代表者のX
                  IDと全員のVRC名をご登録ください。1件の応募を1組として抽選します。
                </p>
                {notice ? (
                  <p
                    className="mb-5 rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700"
                    role="status"
                  >
                    {notice}
                  </p>
                ) : null}
                {snapshot.settings.applicationDeadline ? (
                  <p className="mb-5 rounded-2xl bg-white/55 px-4 py-3 text-sm font-semibold">
                    応募締切：{new Date(snapshot.settings.applicationDeadline).toLocaleString("ja-JP")}
                  </p>
                ) : null}
                <div className="mb-5">
                  <p className="mb-2 text-sm font-semibold">申し込み人数</p>
                  <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="申し込み人数">
                    {([1, 2] as const).map((count) => (
                      <button
                        aria-checked={applicantCount === count}
                        className={`seat-option ${applicantCount === count ? "is-selected" : ""}`}
                        key={count}
                        onClick={() => {
                          setApplicantCount(count);
                          if (count === 1) setCompanionVrcName("");
                          if (count === 2) setPreferenceMode("specified");
                        }}
                        role="radio"
                        type="button"
                      >
                        <strong>{count}人</strong>
                      </button>
                    ))}
                  </div>
                </div>
                {snapshot.settings.featureSettings.showOmakase &&
                applicantCount === 1 ? (
                  <button
                    className={`mb-5 w-full rounded-2xl border p-4 text-left transition ${preferenceMode === "omakase" ? "border-violet-500 bg-violet-50" : "border-white/70 bg-white/50"}`}
                    onClick={() =>
                      setPreferenceMode((current) =>
                        current === "omakase" ? "specified" : "omakase",
                      )
                    }
                    type="button"
                  >
                    <strong>おまかせ</strong>
                    <span className="mt-1 block text-sm opacity-65">
                      1人応募限定。有効なすべての空き枠から抽選します。
                    </span>
                  </button>
                ) : null}
                {preferenceMode === "specified" &&
                snapshot.settings.featureSettings.showInstanceSelection ? (
                  <div className="mb-5 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="希望インスタンス">
                    {activeInstances.map((instance) => (
                      <button
                        aria-checked={instanceId === instance.id}
                        className={`seat-option ${instanceId === instance.id ? "is-selected" : ""}`}
                        key={instance.id}
                        onClick={() => {
                          setInstanceId(instance.id);
                          const first = activeSlots.find((slot) => slot.instanceId === instance.id)?.kind;
                          if (first) setKind(first);
                        }}
                        role="radio"
                        type="button"
                      >
                        <strong>{instance.label}</strong>
                      </button>
                    ))}
                  </div>
                ) : null}
                {preferenceMode === "specified" &&
                snapshot.settings.featureSettings.showKindSelection &&
                selectableKinds.length ? (
                  <div
                    className={`mb-6 grid gap-2 sm:gap-3 ${selectableKinds.length === 1 ? "grid-cols-1" : selectableKinds.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
                    role="radiogroup"
                    aria-label="応募先"
                  >
                    {selectableKinds.map((option) => {
                      const selected = kind === option;
                      const Icon =
                        option === "counter"
                          ? Users
                          : option === "private"
                            ? DoorOpen
                            : Armchair;
                      return (
                        <button
                          aria-checked={selected}
                          className={`seat-option ${selected ? "is-selected" : ""}`}
                          key={option}
                          onClick={() => setKind(option)}
                          role="radio"
                          type="button"
                        >
                          <Icon className="mb-2" size={20} />
                          <strong className="block text-sm sm:text-lg">
                            {kindLabels[option]}
                          </strong>
                          <span className="mt-1 block text-xs opacity-70">
                            {(() => {
                              const slot = activeSlots.find(
                                (item) =>
                                  item.kind === option &&
                                  (!snapshot.settings.featureSettings.showInstanceSelection || item.instanceId === instanceId),
                              );
                              return slot
                                ? `${slot.minPeople}〜${slot.maxPeople}人で応募可能`
                                : "現在応募できません";
                            })()}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : preferenceMode === "specified" ? (
                  <p className="mb-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    現在選択できる募集項目がありません。
                  </p>
                ) : null}
                <div className="space-y-4">
                  <label className="block text-sm font-semibold">
                    代表者のX ID
                    <span className="required-label">必須</span>
                    <input
                      className="mt-2 w-full rounded-2xl border border-white/70 bg-white/65 px-4 py-3.5 outline-none transition focus:border-[var(--color-accent)]"
                      maxLength={16}
                      onChange={(event) =>
                        setRepresentativeId(event.target.value)
                      }
                      placeholder="@misaki"
                      value={representativeId}
                    />
                  </label>
                  <label className="block text-sm font-semibold">
                    代表者のVRC名
                    <span className="required-label">必須</span>
                    <input
                      className="mt-2 w-full rounded-2xl border border-white/70 bg-white/65 px-4 py-3.5 outline-none transition focus:border-[var(--color-accent)]"
                      maxLength={32}
                      onChange={(event) =>
                        setRepresentativeVrcName(event.target.value)
                      }
                      placeholder="Misaki_VRC"
                      value={representativeVrcName}
                    />
                  </label>
                  {applicantCount === 2 ? <label className="block text-sm font-semibold">
                    同行者のVRC名
                    <span className="required-label">必須</span>
                    <input
                      className="mt-2 w-full rounded-2xl border border-white/70 bg-white/65 px-4 py-3.5 outline-none transition focus:border-[var(--color-accent)]"
                      maxLength={32}
                      onChange={(event) => {
                        setCompanionVrcName(event.target.value);
                        if (event.target.value) setPreferenceMode("specified");
                      }}
                      placeholder="Partner_VRC"
                      value={companionVrcName}
                    />
                  </label> : null}
                </div>
                {error ? (
                  <p
                    className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
                    role="alert"
                  >
                    {error}
                  </p>
                ) : null}
                <motion.button
                  className="mt-6 flex w-full items-center justify-between rounded-full bg-[var(--color-accent)] px-6 py-[17px] font-semibold text-white shadow-[0_4px_24px_rgba(115,66,226,0.28)] disabled:opacity-55"
                  disabled={submitting || deadlinePassed || !activeSlots.length}
                  onClick={() => void submit()}
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span>
                    {submitting
                      ? "保存中..."
                      : editing
                        ? "変更内容を保存する"
                        : "この内容で応募する"}
                  </span>
                  <Ticket size={20} />
                </motion.button>
              </div>
            ) : (
              <div className="py-12 text-center">
                <h1 className="hero-heading mb-4">
                  現在は応募受付を終了しています
                </h1>
                <p className="opacity-70">
                  次回の抽選受付開始までお待ちください。
                </p>
              </div>
            )}
            {!entry && error && snapshot?.settings.state !== "accepting" ? (
              <p className="mt-5 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
          </motion.div>
          {!entry && snapshot?.settings.state === "accepting" ? (
            <GuestCoinGallery />
          ) : null}
        </div>
      </section>
      {confirmation}
      <Toast message={toast || notice} />
      {entry && error ? <Toast message={error} error /> : null}
    </main>
  );
};
