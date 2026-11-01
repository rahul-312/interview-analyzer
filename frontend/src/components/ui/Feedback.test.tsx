import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import Button from "./Button";
import { JobFailed } from "./Feedback";

afterEach(cleanup);

describe("JobFailed", () => {
  it("says what failed, that it was given back, and retries", async () => {
    const onRetry = vi.fn();
    render(<JobFailed title="We couldn't build this plan." reason="The AI is busy." refundedWhat="one of your prep plans" onRetry={onRetry} />);
    expect(screen.getByText("We couldn't build this plan.")).toBeTruthy();
    expect(screen.getByText("The AI is busy.")).toBeTruthy();
    expect(screen.getByText("This didn't use up one of your prep plans.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("leaves out the refund line when it counted, and can't retry when out of runs", () => {
    render(<JobFailed title="Failed." refundedWhat={false} onRetry={() => {}} retryDisabled retryTitle="None left" />);
    expect(screen.queryByText(/didn't use up/)).toBeNull();
    const retry = screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement;
    expect(retry.disabled).toBe(true);
    expect(retry.title).toBe("None left");
  });
});

describe("Button loading", () => {
  it("disables the button while loading, even if disabled={false} is passed", async () => {
    const onClick = vi.fn();
    render(<Button loading disabled={false} onClick={onClick}>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-busy")).toBe("true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("behaves as before without loading", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-busy")).toBeNull();
  });
});
