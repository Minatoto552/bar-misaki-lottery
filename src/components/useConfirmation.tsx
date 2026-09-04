import { useEffect, useRef, useState } from "react";
import { ConfirmModal, type Confirmation } from "./Feedback";
export function useConfirmation() {
  const [request, setRequest] = useState<Confirmation | null>(null);
  const resolver = useRef<((value: boolean) => void) | null>(null);
  useEffect(() => () => resolver.current?.(false), []);
  const confirm = (options: string | Confirmation) =>
    new Promise<boolean>((resolve) => {
      resolver.current?.(false);
      resolver.current = resolve;
      setRequest(
        typeof options === "string" ? { description: options } : options,
      );
    });
  const finish = (answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    setRequest(null);
  };
  return {
    confirm,
    confirmation: request ? (
      <ConfirmModal {...request} onClose={finish} />
    ) : null,
  };
}
