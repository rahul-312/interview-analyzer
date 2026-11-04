import Pricing from "@/components/Billing/Pricing";
import PublicPricing from "@/components/Billing/PublicPricing";
import { useAuth } from "@/context/AuthContext";

export default function PricingPage() {
  const { user } = useAuth();
  return user ? <Pricing /> : <PublicPricing />;
}
