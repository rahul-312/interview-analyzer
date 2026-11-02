import type {
  CheckoutConfig,
  CheckoutResponse,
  CurrentSubscription,
  Payment,
  PlansResponse,
} from "@/models/Billing";
import type { Usage } from "@/models/Auth";
import ApiClient, { apiClient } from "./ApiClient";

export default class BillingService {
  private client: ApiClient;

  constructor(client: ApiClient) {
    this.client = client;
  }

  plans() {
    return this.client.get<PlansResponse>("/subscriptions/plans/");
  }

  current() {
    return this.client.get<CurrentSubscription>("/subscriptions/current/");
  }

  usage() {
    return this.client.get<Usage>("/subscriptions/usage/");
  }

  payments() {
    return this.client.get<Payment[]>("/subscriptions/payments/");
  }

  /** Creates the Razorpay subscription for a plan code; the price comes from the server. */
  checkout(plan: string) {
    return this.client.post<CheckoutConfig>("/subscriptions/checkout/", { plan });
  }

  verify(response: CheckoutResponse) {
    return this.client.post<CurrentSubscription>("/subscriptions/verify/", response);
  }

  changePlan(plan: string) {
    return this.client.post<CurrentSubscription>("/subscriptions/change-plan/", { plan });
  }

  /** `expectRefund`: the user was offered a refund, so the server refuses (409) rather than cancel without one. */
  cancel(atPeriodEnd: boolean, expectRefund = false) {
    return this.client.post<CurrentSubscription>("/subscriptions/cancel/", { at_period_end: atPeriodEnd, expect_refund: expectRefund });
  }

  /** Cancels the subscription bought to start when the current one ends. Nothing was charged for it yet. */
  cancelUpcoming() {
    return this.client.post<CurrentSubscription>("/subscriptions/cancel/", { upcoming: true });
  }

  resume() {
    return this.client.post<CurrentSubscription>("/subscriptions/resume/");
  }
}

export const billingService = new BillingService(apiClient);
