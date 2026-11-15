import { Suspense } from "react";
import type { Metadata } from "next";
import { Only, Page as Column } from "@/components/layout/AppShell";
import { ListSkeleton } from "@/components/ui/kit";
import { ConversationDetail } from "@/components/screens/common";

export const metadata: Metadata = { title: "Chat" };

// The id in the URL is only known at request time, so the screen that reads it
// sits inside Suspense (required with cacheComponents).
export default function Page() {
  return (
    <Only roles={["club_rep", "student", "gov_rep"]}>
      <Suspense fallback={<Column><ListSkeleton /></Column>}>
        <ConversationDetail />
      </Suspense>
    </Only>
  );
}
