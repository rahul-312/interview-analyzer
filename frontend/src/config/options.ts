import type { AppStatus, Source } from "@/models/Application";
import type { Option } from "@/models/Common";
import type { Outcome, RoundType } from "@/models/Interview";

export const statusOptions: Option<AppStatus>[] = [
  { value: "applied", label: "Applied" },
  { value: "screening", label: "Screening" },
  { value: "interview", label: "Interviewing" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

export const sourceOptions: Option<Source>[] = [
  { value: "", label: "Not set" },
  { value: "cold", label: "Cold apply" },
  { value: "referral", label: "Referral" },
  { value: "recruiter", label: "Recruiter" },
  { value: "job_board", label: "Job board" },
  { value: "other", label: "Other" },
];

export const roundTypeOptions: Option<RoundType>[] = [
  { value: "phone_screen", label: "Phone screen" },
  { value: "technical", label: "Technical" },
  { value: "system_design", label: "System design" },
  { value: "behavioral", label: "Behavioral" },
  { value: "hiring_manager", label: "Hiring manager" },
  { value: "take_home", label: "Take-home" },
  { value: "onsite", label: "Onsite" },
  { value: "other", label: "Other" },
];

export const outcomeOptions: Option<Outcome>[] = [
  { value: "pending", label: "Pending" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
];
