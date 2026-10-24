import type {
  LotteryEntry,
  LotterySettings,
  RecruitmentSlot,
} from "../../shared/models";

export type NextActionTab =
  | "recruitment"
  | "draw"
  | "results"
  | "history";

export interface NextAction {
  title: string;
  description: string;
  tab: NextActionTab;
  tone: "info" | "action" | "done" | "warning";
}

export interface DrawReadiness {
  // 抽選を止める問題（抽選ボタンを無効化する）
  blockers: string[];
  // 抽選はできるが、確認したほうがよい点
  warnings: string[];
  usableSlots: RecruitmentSlot[];
  maxWinners: number;
}

// 抽選に使える枠。インスタンスが使用・表示のどちらかでも外れていれば対象外
export const getUsableSlots = (settings: LotterySettings): RecruitmentSlot[] => {
  const usableInstances = new Set(
    settings.instances
      .filter((instance) => instance.enabled && instance.visible)
      .map((instance) => instance.id),
  );
  return settings.recruitmentSlots.filter(
    (slot) =>
      slot.enabled &&
      slot.capacity > 0 &&
      usableInstances.has(slot.instanceId) &&
      settings.featureSettings.kindVisibility[slot.kind],
  );
};

export const getDrawReadiness = (
  settings: LotterySettings,
  entries: LotteryEntry[],
): DrawReadiness => {
  const usableSlots = getUsableSlots(settings);
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (settings.state !== "closed") {
    blockers.push("先に応募受付を締め切ってください");
  }
  if (!usableSlots.length) {
    blockers.push("有効な募集枠がありません。募集項目設定で枠を有効にしてください");
  }

  const disabledButEnabled = settings.recruitmentSlots.filter(
    (slot) =>
      slot.enabled &&
      slot.capacity > 0 &&
      !usableSlots.some((usable) => usable.id === slot.id),
  );
  if (disabledButEnabled.length) {
    warnings.push(
      `${disabledButEnabled.length}枠は、インスタンスまたは席種の表示がオフのため抽選対象外です`,
    );
  }

  const active = entries.filter((entry) => entry.status !== "excluded" && entry.status !== "cancelled");
  const unmatched = active.filter(
    (entry) =>
      entry.preferenceMode === "specified" &&
      !usableSlots.some(
        (slot) =>
          slot.instanceId === entry.requestedInstanceId &&
          slot.kind === entry.kind &&
          entry.peopleCount >= slot.minPeople &&
          entry.peopleCount <= slot.maxPeople,
      ),
  );
  if (unmatched.length) {
    warnings.push(
      `${unmatched.length}組は、現在の募集枠（インスタンス・席種・人数条件）に合わないため落選になります`,
    );
  }

  const maxWinners = usableSlots.reduce((sum, slot) => sum + slot.capacity, 0);
  if (active.length && maxWinners > active.length) {
    warnings.push("募集数が応募数を上回っています。全組が当選する可能性があります");
  }

  return { blockers, warnings, usableSlots, maxWinners };
};

export const getVacantTotal = (settings: LotterySettings): number =>
  settings.vacantCounterSlots +
  settings.vacantPrivateSlots +
  settings.vacantTableSlots;

// 管理者が次に行うべき操作を、現在の状態から1つだけ決める
export const getNextAction = (
  settings: LotterySettings,
  entries: LotteryEntry[],
): NextAction => {
  if (settings.state === "accepting") {
    const usable = getUsableSlots(settings);
    if (!usable.length) {
      return {
        title: "募集枠を設定してください",
        description: "有効な募集枠がないため、応募を受け付けられません。",
        tab: "recruitment",
        tone: "warning",
      };
    }
    return {
      title: "応募受付中です",
      description: "締切時刻になったら、または準備ができたら受付を締め切ってください。",
      tab: "draw",
      tone: "info",
    };
  }
  if (settings.state === "closed") {
    const readiness = getDrawReadiness(settings, entries);
    return readiness.blockers.length
      ? {
          title: "抽選前の確認が必要です",
          description: readiness.blockers[0],
          tab: "draw",
          tone: "warning",
        }
      : {
          title: "抽選を実行できます",
          description: "抽選前確認に問題はありません。内容を確認して実行してください。",
          tab: "draw",
          tone: "action",
        };
  }
  if (settings.state === "drawn") {
    return getVacantTotal(settings) > 0
      ? {
          title: "空き枠の再抽選が必要です",
          description: "除外や辞退で空いた枠があります。空き枠を再抽選してから公開できます。",
          tab: "results",
          tone: "warning",
        }
      : {
          title: "結果を公開できます",
          description: "当選者を確認し、問題がなければ結果を公開してください。",
          tab: "results",
          tone: "action",
        };
  }
  if (settings.state === "published") {
    return {
      title: "結果公開中です",
      description: "当選者の確認状況を確認できます。",
      tab: "results",
      tone: "done",
    };
  }
  return {
    title: "状態を確認してください",
    description: "想定外の状態です。操作履歴を確認してください。",
    tab: "history",
    tone: "warning",
  };
};
