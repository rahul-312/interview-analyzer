import { describe, expect, it } from "vitest";
import type { Debrief, DebriefDraft } from "@/models/Interview";
import { mergeDraft } from "./debrief";

const blank = { question: "", answer: "", topic: "", confidence: null };

const form = (patch: Partial<Debrief> = {}): Debrief => ({
  questions: [{ ...blank }],
  went_well: "",
  went_badly: "",
  interviewer_cues: "",
  recruiter_feedback: "",
  overall_feeling: null,
  ...patch,
});

const draft: DebriefDraft = {
  questions: [{ question: "Design a URL shortener", answer: "Base62 ids", topic: "system design", confidence: 4 }],
  went_well: "Clear trade-offs.",
  went_badly: "",
  interviewer_cues: "Asked about caching.",
  recruiter_feedback: "",
  overall_feeling: 3,
};

describe("mergeDraft", () => {
  it("fills an empty form, replacing the blank question card", () => {
    const merged = mergeDraft(form(), draft);
    expect(merged.questions).toEqual(draft.questions);
    expect(merged.went_well).toBe("Clear trade-offs.");
    expect(merged.interviewer_cues).toBe("Asked about caching.");
    expect(merged.overall_feeling).toBe(3);
  });

  it("keeps what was typed and adds to it", () => {
    const typed = { question: "Reverse a list", answer: "", topic: "", confidence: 2 };
    const merged = mergeDraft(
      form({ questions: [typed, { ...blank }], went_well: "Good rapport.", overall_feeling: 5 }),
      draft
    );
    expect(merged.questions).toEqual([typed, ...draft.questions]);
    expect(merged.went_well).toBe("Good rapport.\n\nClear trade-offs.");
    expect(merged.went_badly).toBe("");
    expect(merged.overall_feeling).toBe(5);
  });

  it("leaves the questions alone when the recording had none", () => {
    const current = form();
    expect(mergeDraft(current, { ...draft, questions: [] }).questions).toBe(current.questions);
  });
});
