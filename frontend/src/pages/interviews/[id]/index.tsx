import { useRouter } from "next/router";
import RoundAnalysis from "@/components/Interviews/RoundAnalysis";

export default function RoundAnalysisPage() {
  const router = useRouter();
  const { id } = router.query;

  if (typeof id !== "string") return null;
  return <RoundAnalysis key={id} id={id} />;
}
