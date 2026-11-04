import type { GetStaticProps } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import Pricing from "@/components/Billing/Pricing";
import PublicPricing from "@/components/Billing/PublicPricing";
import { useAuth } from "@/context/AuthContext";
import type { PlansResponse } from "@/models/Billing";
import { billingService } from "@/services/BillingService";

interface PricingPageProps {
  plans: PlansResponse | null;
}

// The plans are in the page, so it's readable without JavaScript. If the API can't be reached, the browser loads them.
export const getStaticProps: GetStaticProps<PricingPageProps> = async () => {
  const plans = await billingService.publicPlans().catch(() => null);
  return { props: { plans }, revalidate: 60 };
};

export default function PricingPage({ plans }: PricingPageProps) {
  const { user } = useAuth();
  const { plan } = useRouter().query;

  return (
    <>
      <Head>
        <title>Pricing · Interview Analyzer</title>
        <meta name="description" content="Free, Pro and Pro Plus plans for tracking applications and analysing your interviews." />
      </Head>
      {user ? <Pricing chosenPlan={typeof plan === "string" ? plan : undefined} /> : <PublicPricing initialPlans={plans} />}
    </>
  );
}
