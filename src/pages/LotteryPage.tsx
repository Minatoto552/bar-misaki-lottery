import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
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
  const [confirmedNotice, setConfirmedNotice] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const token = ensureDeviceToken();

  const refresh = useCallback(async () => {
    try {
      const next = await getPublicLotterySnapshot(token);
      setSnapshot(next);
      if (
        next.entry?.status === "winner" &&
        next.entry.winnerCode &&
        !winnerCodeInput.trim()
      ) {
        setWinnerCodeInput(next.entry.winnerCode);
        setCodeSnapshot(next);
      }
      if (winnerCodeInput.trim())
        setCodeSnapshot(await lookupWinnerCode(winnerCodeInput));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "通信に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [token, winnerCodeInput]);

  const lookupCode = async () => {
    setCodeLoading(true);
    setError("");
    try {
      const found = await lookupWinnerCode(winnerCodeInput);
      setCodeSnapshot(found);
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
    const code = winnerCodeInput || codeOverride;
    if (
      !code ||
      !window.confirm(
        "当選を取り消します。取り消し後は当選画面を表示できません。よろしいですか？",
      )
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
    const code = winnerCodeInput || codeOverride;
    if (
      !code ||
      !window.confirm(
        "WINNER CODEを確認済みにします。管理画面に確認済みとして記録します。よろしいですか？",
      )
    )
      return;
    setCodeLoading(true);
    setError("");
    try {
      await confirmWinnerByCode(code);
      setConfirmedNotice(true);
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
      setShowCancelConfirm(false);
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
    <main className="relative min-h-screen w-full overflow-hidden text-[var(--color-text)]">
      <video
        aria-hidden="true"
        autoPlay
        className="fixed inset-0 h-full w-full object-cover"
        loop
        muted
        playsInline
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260518_003132_8b7edcb6-c64d-4a52-a9ca-879942e122ad.mp4"
      />
      <div className="fixed inset-0 bg-white/12" />
      <PublicHeader />
      <section className="relative z-[1] mx-auto max-w-7xl px-5 pb-12 pt-[clamp(28px,6vw,64px)] sm:px-8">
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className="max-w-[590px] rounded-[32px] border border-white/45 bg-[rgba(242,242,238,0.68)] p-5 shadow-[0_24px_80px_rgba(25,40,55,0.13)] backdrop-blur-xl sm:p-8"
          initial={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        >
          {loading ? (
            <div className="grid min-h-72 place-items-center" role="status">
              <LoaderCircle className="animate-spin" size={32} />
            </div>
          ) : entry ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between gap-4">
                <span className="rounded-full bg-white/65 px-4 py-2 text-xs font-bold tracking-wider">
                  {stateLabels[snapshot!.settings.state]}
                </span>
                <span className="text-xs font-semibold opacity-55">
                  {entry.entryNumber}
                </span>
              </div>
              {isPublished && entry.status !== "pending" ? (
                <LotteryGacha
                  entryId={entry.id}
                  resultVersion={entry.updatedAt}
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
                        WINNER
                        CODEを使えば、別の端末でもこの当選画面を表示できます。
                      </p>
                      <div className="my-7 rounded-3xl bg-[#192837] px-5 py-7 text-white">
                        <span className="mb-2 block text-xs font-semibold tracking-[0.2em] opacity-60">
                          WINNER CODE
                        </span>
                        <strong className="font-mono text-[clamp(1.8rem,8vw,2.8rem)] tracking-[0.12em]">
                          {entry.winnerCode}
                        </strong>
                      </div>
                      <div className="flex flex-wrap justify-center gap-3">
                        {!confirmedNotice ? (
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
                        今回は落選となりました
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
              <dl className="grid gap-3 rounded-3xl bg-white/50 p-5 text-sm">
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
                  onClick={() => {
                    setError("");
                    setShowCancelConfirm(true);
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
                  onChange={(event) => setWinnerCodeInput(event.target.value)}
                  placeholder="MSK-XXXXXX"
                  value={winnerCodeInput}
                />
                <button
                  className="w-full rounded-full bg-[var(--color-accent)] px-6 py-4 font-semibold text-white disabled:opacity-50"
                  disabled={codeLoading || !winnerCodeInput.trim()}
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
                        className={`rounded-3xl border p-3 text-left transition sm:p-4 ${selected ? "border-[var(--color-accent)] bg-[var(--color-accent)] text-white shadow-lg" : "border-white/50 bg-white/45 hover:bg-white/65"}`}
                        key={option}
                        onClick={() => setKind(option)}
                        role="radio"
                        type="button"
                      >
                        <Icon className="mb-5" size={24} />
                        <strong className="block text-sm sm:text-lg">
                          {kindLabels[option]}
                        </strong>
                        <span className="mt-1 block text-[10px] opacity-70 sm:text-xs">
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
                  <span className="ml-1 text-[var(--color-accent)]">*</span>
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
                  <span className="ml-1 text-[var(--color-accent)]">*</span>
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
                    <span className="ml-1 text-[var(--color-accent)]">*</span>
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
      </section>
      <AnimatePresence>
        {showCancelConfirm ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 grid place-items-center bg-[rgba(25,40,55,0.42)] p-5 backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            onClick={() => {
              if (!submitting) setShowCancelConfirm(false);
            }}
          >
            <motion.section
              animate={{ opacity: 1, scale: 1, y: 0 }}
              aria-labelledby="cancel-title"
              aria-modal="true"
              className="w-full max-w-md rounded-[28px] bg-[#F2F2EE] p-6 shadow-[0_24px_80px_rgba(25,40,55,0.28)] sm:p-7"
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mb-5 grid h-12 w-12 place-items-center rounded-full bg-red-100 text-red-700">
                <Trash2 size={22} />
              </div>
              <h2 className="text-2xl font-bold" id="cancel-title">
                応募をキャンセルしますか？
              </h2>
              <p className="mt-3 text-sm leading-relaxed opacity-70">
                現在の応募を取り消します。キャンセル後は応募ホームへ戻り、同じXのIDでもう一度応募できます。
              </p>
              {error ? (
                <p
                  className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-700"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <div className="mt-6 grid grid-cols-2 gap-3">
                <button
                  className="rounded-full bg-white px-4 py-3.5 text-sm font-semibold disabled:opacity-50"
                  disabled={submitting}
                  onClick={() => setShowCancelConfirm(false)}
                  type="button"
                >
                  戻る
                </button>
                <button
                  className="rounded-full bg-red-600 px-4 py-3.5 text-sm font-semibold text-white disabled:opacity-50"
                  disabled={submitting}
                  onClick={() => void cancel()}
                  type="button"
                >
                  {submitting ? "処理中..." : "キャンセルを確定"}
                </button>
              </div>
            </motion.section>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </main>
  );
};
