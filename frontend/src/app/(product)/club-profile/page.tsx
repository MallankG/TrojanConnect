import type { Metadata } from "next";
import { Only } from "@/components/layout/AppShell";
import { ClubProfile } from "@/components/screens/club";

export const metadata: Metadata = { title: "Club profile" };

export default function Page() {
  return (
    <Only roles={["club_rep"]}>
      <ClubProfile />
    </Only>
  );
}
