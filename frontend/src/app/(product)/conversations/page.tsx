import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { Conversations } from "@/components/screens/common";

export const metadata: Metadata = { title: "Chats" };

export default function Page() {
  return (
    <Only roles={["club_rep", "student", "gov_rep"]}>
      <Conversations />
    </Only>
  );
}
