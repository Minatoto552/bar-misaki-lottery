import { useEffect, useRef } from "react";

// 表示中のタブだけ定期取得し、前回の取得が終わるまで次の取得を送らない
export const usePollingWhileVisible = (
  task: () => Promise<unknown> | void,
  intervalMs: number,
): void => {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    let inFlight = false;

    const run = async () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      try {
        await taskRef.current();
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => void run(), intervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);
};
