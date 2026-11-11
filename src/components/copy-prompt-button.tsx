"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

export function CopyPromptButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const label = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy prompt";

  return (
    <button
      type="button"
      className="button secondary small"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(
          () => {
            setState("copied");
            window.setTimeout(() => setState("idle"), 2000);
          },
          () => {
            setState("failed");
            window.setTimeout(() => setState("idle"), 2000);
          },
        );
      }}
    >
      {state === "copied" ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      {label}
    </button>
  );
}
