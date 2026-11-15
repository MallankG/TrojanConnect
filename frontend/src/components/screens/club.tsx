"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";

// Club representative screens live in ./clubLive (on the backend). This module keeps the shared Section.

export function Section({
  title,
  count,
  href,
  children,
}: {
  title: string;
  count?: number;
  href?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-[-0.01em]">
          {title}
          {count !== undefined && count > 0 && <span className="tabular ml-2 font-normal text-gray-70">{count}</span>}
        </h2>
        {href && (
          <Link href={href} className="inline-flex items-center text-sm text-gray-70 hover:text-ink">
            View all
            <ChevronRight aria-hidden className="size-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}
