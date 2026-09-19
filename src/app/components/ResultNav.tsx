import Link from "next/link";

export function ResultNav({ id, current }: { id: string; current: "dashboard" | "plan" }) {
  const e = encodeURIComponent(id);
  return (
    <nav aria-label="Results" className="tabs">
      <Link href={`/dashboard/${e}`} aria-current={current === "dashboard" ? "page" : undefined}>
        Patterns
      </Link>
      <Link href={`/plan/${e}`} aria-current={current === "plan" ? "page" : undefined}>
        Plan
      </Link>
    </nav>
  );
}
