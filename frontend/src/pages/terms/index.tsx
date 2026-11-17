import type { GetStaticProps } from "next";
import type { BillingDays } from "@/components/Legal/RefundPolicy";
import Terms from "@/components/Legal/Terms";
import { billingDays } from "@/utils/legal";

export const getStaticProps: GetStaticProps<BillingDays> = async () => ({ props: await billingDays(), revalidate: 60 });

export default function TermsPage({ refundDays }: BillingDays) {
  return <Terms refundDays={refundDays} />;
}
