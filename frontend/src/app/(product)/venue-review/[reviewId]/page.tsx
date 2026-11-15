import { Suspense } from "react";
import type { Metadata } from "next";
import { Only, Page as Column } from "@/components/layout/AppShell";
import { ListSkeleton } from "@/components/ui/kit";
import { ReviewDetail } from "@/components/screens/review";

export const metadata: Metadata = { title: "Review request" };

// The id in the URL is only known at request time, so the screen that reads it
// sits inside Suspense (required with cacheComponents).
export default function Page() {
  return (
    <Only roles={["venue_reviewer"]}>
      <Suspense fallback={<Column><ListSkeleton /></Column>}>
        <ReviewDetail />
      </Suspense>
    </Only>
  );
}
