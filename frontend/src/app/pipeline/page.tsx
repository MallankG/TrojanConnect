import { redirect } from "next/navigation";

// The planner lives at /plan, behind the club-representative sign-in.
export default function PipelinePage() {
  redirect("/plan");
}
