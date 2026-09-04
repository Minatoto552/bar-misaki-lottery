import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { coinFaces } from "./coin-faces";

type SavedGacha = { selectedCoin: number; revealed: boolean };

const storageKey = (roundId: string, entryId: string, resultVersion: string) =>
  `bar-misaki-gacha-v1:${roundId}:${entryId}:${resultVersion}`;

const readSavedGacha = (
  roundId: string,
  entryId: string,
  resultVersion: string,
): SavedGacha | null => {
  try {
    const value = localStorage.getItem(
      storageKey(roundId, entryId, resultVersion),
    );
    if (!value) return null;
    const parsed = JSON.parse(value) as SavedGacha;
    return Number.isInteger(parsed.selectedCoin) &&
      parsed.selectedCoin >= 0 &&
      parsed.selectedCoin < coinFaces.length
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const CoinPortrait = ({
  index,
  className = "",
}: {
  index: number;
  className?: string;
}) => {
  const face = coinFaces[index];
  return (
    <span
      aria-hidden="true"
      className={`block rounded-full border-[4px] border-[#d9ad4d] bg-[#192837] bg-no-repeat shadow-[inset_0_0_0_2px_rgba(89,54,12,0.3),0_12px_28px_rgba(25,40,55,0.22)] ${className}`}
      style={{
        backgroundImage: `url(${face.src})`,
        backgroundPosition: face.backgroundPosition,
        backgroundSize: face.backgroundSize ?? "cover",
      }}
    />
  );
};

export const LotteryGacha = ({
  children,
  entryId,
  roundId,
  resultVersion,
  bypass = false,
  onStep,
}: {
  bypass?: boolean;
  onStep?: (step: number) => void;
  children: ReactNode;
  entryId: string;
  roundId: string;
  resultVersion: string;
}) => {
  const reduceMotion = useReducedMotion();
  const saved = readSavedGacha(roundId, entryId, resultVersion);
  const [selectedCoin, setSelectedCoin] = useState<number | null>(
    saved?.selectedCoin ?? null,
  );
  const [phase, setPhase] = useState<"selecting" | "spinning" | "revealed">(
    saved?.revealed ? "revealed" : "selecting",
  );

  useEffect(() => {
    onStep?.(bypass || phase === "revealed" ? 3 : phase === "spinning" ? 2 : 1);
  }, [phase, bypass, onStep]);
  useEffect(() => {
    if (phase !== "spinning" || selectedCoin === null) return;
    const timer = window.setTimeout(
      () => {
        localStorage.setItem(
          storageKey(roundId, entryId, resultVersion),
          JSON.stringify({ selectedCoin, revealed: true } satisfies SavedGacha),
        );
        setPhase("revealed");
      },
      reduceMotion ? 0 : 850,
    );
    return () => window.clearTimeout(timer);
  }, [entryId, phase, resultVersion, roundId, selectedCoin, reduceMotion]);

  if (bypass || phase === "revealed") return <>{children}</>;

  return (
    <AnimatePresence mode="wait">
      {phase === "selecting" ? (
        <motion.section
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
          exit={{ opacity: 0, y: -16 }}
          initial={{ opacity: 0, y: 16 }}
          key="select"
          transition={{ duration: 0.35 }}
        >
          <p className="mb-2 text-xs font-bold tracking-[0.18em] text-[var(--color-accent)]">
            CAST COIN GACHA
          </p>
          <h1 className="hero-heading mb-3">キャストコインを選ぶ</h1>
          <p className="mx-auto mb-6 max-w-md text-sm leading-relaxed opacity-70">
            好きなコインを1枚選んで、ガチャを行ってください。
          </p>
          <div
            aria-label="キャストコインを選択"
            className="grid grid-cols-3 gap-4 sm:grid-cols-4"
            role="radiogroup"
          >
            {coinFaces.map((face, index) => {
              const selected = selectedCoin === index;
              return (
                <button
                  aria-checked={selected}
                  aria-label={`キャストコイン ${index + 1}`}
                  className={`coin-choice ${selectedCoin !== null && !selected ? "is-dimmed" : ""} aspect-square rounded-full p-1 transition ${selected ? "scale-105 bg-[var(--color-accent)] shadow-[0_0_0_4px_rgba(115,66,226,0.2)]" : "bg-white/45 hover:scale-105 hover:bg-white/75"}`}
                  key={face.src}
                  onClick={() => setSelectedCoin(index)}
                  role="radio"
                  type="button"
                >
                  <CoinPortrait className="h-full w-full" index={index} />
                </button>
              );
            })}
          </div>
          <p className="selection-caption" aria-live="polite">
            {selectedCoin === null
              ? "コインを1枚選択してください"
              : `COIN ${String(selectedCoin + 1).padStart(2, "0")} を選択中`}
          </p>
          <motion.button
            className="mt-7 flex w-full items-center justify-center gap-3 rounded-full bg-[var(--color-accent)] px-6 py-[17px] font-semibold text-white shadow-[0_4px_24px_rgba(115,66,226,0.28)] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={selectedCoin === null}
            onClick={() => setPhase("spinning")}
            type="button"
            whileHover={selectedCoin === null ? undefined : { scale: 1.02 }}
            whileTap={selectedCoin === null ? undefined : { scale: 0.97 }}
          >
            <Sparkles size={20} />
            このコインで抽選する
          </motion.button>
        </motion.section>
      ) : (
        <motion.section
          animate={{ opacity: 1 }}
          className="grid min-h-[430px] place-items-center text-center"
          initial={{ opacity: 0 }}
          key="spin"
        >
          <div>
            <div className="relative mx-auto h-44 w-44">
              <div className="absolute inset-0 rounded-full border border-violet-200" />
              <motion.div
                animate={{
                  rotateY: reduceMotion ? 0 : 360,
                  rotateZ: [0, -8, 8, 0],
                  scale: [0.72, 1.08, 0.92, 1],
                }}
                className="absolute inset-2"
                transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
              >
                <CoinPortrait className="h-full w-full" index={selectedCoin!} />
              </motion.div>
            </div>
            <p className="mt-8 text-sm font-bold tracking-[0.16em] text-[var(--color-accent)]">
              抽選結果を確認中..
            </p>
          </div>
        </motion.section>
      )}
    </AnimatePresence>
  );
};
