import { legal } from "@/config/legal";
import { billingService } from "@/services/BillingService";

/** The server's money-back and grace days, for the policies; legal.ts's defaults if the API can't be reached. */
export async function billingDays(): Promise<{ refundDays: number; graceDays: number }> {
  let plans = null;
  try {
    plans = await billingService.publicPlans();
  } catch {
    // The build goes on with the defaults; the page is rebuilt within a minute once the API answers.
  }
  return {
    refundDays: plans?.refund_days ?? legal.refundDays,
    graceDays: plans?.grace_days ?? legal.graceDays,
  };
}
