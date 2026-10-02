import Link from "next/link";
import { CitizenEntry } from "@/components/entry/CitizenEntry";
import { EntryShell } from "@/components/entry/EntryShell";

const STEPS = [
  ["You report", "A photo, a pin and a category."],
  ["CivicPulse groups", "Reports of the same problem become one issue."],
  ["The city decides", "Staff set priority and assign a department."],
  ["You follow it", "My Reports shows each status change."],
] as const;

export default function CitizenLoginPage() {
  return (
    <EntryShell>
      <div className="page-wrap entry-page">
        <div className="entry-login">
          <div className="entry-hero">
            <p className="eyebrow">CivicPulse AI · Citizen</p>
            <h1>Report civic problems. Track what happens next.</h1>
            <p>
              No account or password needed. CivicPulse gives this device a
              private citizen identity so My Reports can follow your reports.
            </p>
            <p className="entry-staff">
              Municipal staff?{" "}
              <Link href="/authority/login">Authority sign in →</Link>
            </p>
          </div>
          <CitizenEntry />
        </div>
        <ol className="entry-steps" aria-label="How CivicPulse works">
          {STEPS.map(([title, body], index) => (
            <li key={title}>
              <span className="entry-step-number">{index + 1}</span>
              <strong>{title}</strong>
              <span>{body}</span>
            </li>
          ))}
        </ol>
      </div>
    </EntryShell>
  );
}
