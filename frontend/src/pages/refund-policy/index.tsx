import type { GetStaticProps } from "next";
import RefundPolicy, { type BillingDays } from "@/components/Legal/RefundPolicy";
import { billingDays } from "@/utils/legal";

// The refund and grace days come from the server, so the policy says what billing does.
export const getStaticProps: GetStaticProps<BillingDays> = async () => ({ props: await billingDays(), revalidate: 60 });

export default function RefundPolicyPage(props: BillingDays) {
  return <RefundPolicy {...props} />;
}
