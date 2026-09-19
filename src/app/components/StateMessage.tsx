import type { ReactNode } from "react";

export type StateKind = "loading" | "empty" | "error";

export function StateMessage({
  kind,
  title,
  children,
}: {
  kind: StateKind;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`state state-${kind}`}
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-busy={kind === "loading" ? true : undefined}
    >
      {kind === "loading" && <span className="spinner" aria-hidden="true" />}
      <h2>{title}</h2>
      {children && <div className="state-body">{children}</div>}
    </div>
  );
}
