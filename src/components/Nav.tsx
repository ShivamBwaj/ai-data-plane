"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Ask" },
  { href: "/benchmark", label: "Benchmark" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-black/10 dark:border-white/10">
      <div className="mx-auto max-w-6xl px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold tracking-tight">AI Data Plane</span>
          <span className="hidden sm:inline text-xs text-black/50 dark:text-white/50 px-2 py-0.5 rounded-full border border-black/10 dark:border-white/15">
            semantic layer · permissions · query planner
          </span>
        </div>
        <nav className="flex gap-1">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                pathname === l.href
                  ? "bg-black text-white dark:bg-white dark:text-black"
                  : "hover:bg-black/5 dark:hover:bg-white/10"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
