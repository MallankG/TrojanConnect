import type { Metadata } from "next";
import { AlumniPreview } from "@/components/screens/extras";

export const metadata: Metadata = { title: "Alumni mentorship" };

export default function Page() {
  return <AlumniPreview />;
}
