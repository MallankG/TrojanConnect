import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { ReviewQueue } from "@/components/screens/review";

export const metadata: Metadata = { title: "Review queue" };

export default function Page() {
  return (
    <Only roles={["venue_reviewer"]}>
      <ReviewQueue />
    </Only>
  );
}
