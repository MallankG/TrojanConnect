import type { Metadata } from "next";
import { PipelineApp } from "@/components/pipeline/PipelineApp";

export const metadata: Metadata = {
  title: "Event Pipeline · TrojanConnect",
  description: "Track club event planning and the annual USC RSO recognition process in one workflow.",
};

export default function PipelinePage() {
  return <PipelineApp />;
}
