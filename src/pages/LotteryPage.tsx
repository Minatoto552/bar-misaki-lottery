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

import type { LotteryKind, PublicLotterySnapshot } from "../../shared/models";
import { submitLotterySchema } from "../../shared/validation";
import { Toast } from "../components/Feedback";
import { useConfirmation } from "../components/useConfirmation";
import { PublicHeader } from "../components/Brand";
import { GuestCoinGallery } from "../components/GuestCoinGallery";
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
    const interval = window.setInterval(() => void refresh(), 4000);
    const onUpdate = () => void refresh();
    window.addEventListener(LOTTERY_UPDATED_EVENT, onUpdate);
    window.addEventListener("focus", onUpdate);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener(LOTTERY_UPDATED_EVENT, onUpdate);
      window.removeEventListener("focus", onUpdate);
    };
  }, [refresh]);

  useEffect(() => {
    const available = snapshot?.settings.availableKinds;
    if (available?.length && !available.includes(kind)) setKind(available[0]);
  }, [snapshot?.settings.availableKinds, kind]);

  const submit = async () => {
    const parsed = submitLotterySchema.safeParse({
      kind,
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
            ) : entry ? (
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
                  <button
                    className="flex w-full items-center justify-center gap-2 rounded-full border border-red-300 bg-white/50 px-5 py-3.5 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                    disabled={submitting}
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
                  BarMisaki
                  <br />
                  の抽選に応募する
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
                {availableKinds.length ? (
                  <div
                    className={`mb-6 grid gap-2 sm:gap-3 ${availableKinds.length === 1 ? "grid-cols-1" : availableKinds.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}
                    role="radiogroup"
                    aria-label="応募先"
                  >
                    {availableKinds.map((option) => {
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
                            {option === "counter" ? "2名1組" : "1〜2名1組"}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="mb-6 rounded-2xl bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
                    現在選択できる募集項目がありません。
                  </p>
                )}
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
                  <label className="block text-sm font-semibold">
                    同行者のVRC名
                    {kind === "counter" ? (
                      <span className="required-label">必須</span>
                    ) : (
                      <span className="ml-2 text-xs font-normal opacity-50">
                        1名で応募する場合は空欄
                      </span>
                    )}
                    <input
                      className="mt-2 w-full rounded-2xl border border-white/70 bg-white/65 px-4 py-3.5 outline-none transition focus:border-[var(--color-accent)]"
                      maxLength={32}
                      onChange={(event) =>
                        setCompanionVrcName(event.target.value)
                      }
                      placeholder="Partner_VRC"
                      value={companionVrcName}
                    />
                  </label>
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
                  disabled={submitting || !availableKinds.length}
                  onClick={() => void submit()}
                  type="button"
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span>
                    {submitting ? "応募を送信中..." : "この内容で応募する"}
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
