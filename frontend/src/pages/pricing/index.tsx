import { useRouter } from "next/router";
import Pricing from "@/components/Billing/Pricing";
import PublicPricing from "@/components/Billing/PublicPricing";
import { useAuth } from "@/context/AuthContext";

export default function PricingPage() {
  const { user } = useAuth();
  const { plan } = useRouter().query;
  return user ? <Pricing chosenPlan={typeof plan === "string" ? plan : undefined} /> : <PublicPricing />;
}
