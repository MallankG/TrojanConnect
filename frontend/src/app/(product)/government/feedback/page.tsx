import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { FeedbackInbox } from "@/components/screens/government";

export const metadata: Metadata = { title: "Feedback" };

export default function Page() {
  return (
    <Only roles={["gov_rep"]}>
      <FeedbackInbox />
    </Only>
  );
}
