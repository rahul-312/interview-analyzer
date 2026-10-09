import { useRouter } from "next/router";
import ApplicationDetail from "@/components/Applications/ApplicationDetail";

export default function ApplicationDetailPage() {
  const router = useRouter();
  const { id } = router.query;

  if (typeof id !== "string") return null;
  return <ApplicationDetail key={id} id={id} />;
}
