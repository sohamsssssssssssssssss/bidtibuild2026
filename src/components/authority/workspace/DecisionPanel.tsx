"use client";
/* eslint-disable @next/next/no-img-element -- Preview uses a local object URL. */

import { useEffect, useState, type FormEvent } from "react";
import {
  LEVELS,
  LEVEL_META,
  PHOTO_CONFIG,
  PRIORITY_CONFIG,
  STORAGE_BUCKETS,
  TEXT_LIMITS,
  allowedTransitions,
  openStatuses,
  type IssueStatus,
  type Level,
} from "@/config/civic";
import { TESTIDS } from "@/config/testids";
import type { AuthorityQueueRow } from "@/contracts/authority";
import type { Department } from "@/contracts/departments";
import type { IssueDetail } from "@/contracts/issues";
import { LevelChip } from "@/components/authority/chips";
import { useAuthorityUser } from "@/components/auth/AuthoritySession";
import { authorityApi } from "@/lib/authority/api";
import { dateTime, slaState } from "@/lib/authority/format";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { prepareReportPhoto } from "@/app/(citizen)/report/photo";
import { InlineError, Photo, errorText } from "./shared";

export type DepartmentsState =
  | { kind: "ready"; list: Department[] }
  | { kind: "error"; message: string };

type Reload = () => Promise<void>;

function isPriorityEditable(status: IssueStatus): boolean {
  return (openStatuses() as IssueStatus[]).includes(status);
}

// ---------------------------------------------------------------------------
// a. Priority
// ---------------------------------------------------------------------------

function PriorityControl({
  issue,
  row,
  reload,
}: {
  issue: IssueDetail;
  row: AuthorityQueueRow | null;
  reload: Reload;
}) {
  const editable = isPriorityEditable(issue.status);
  const [priority, setPriority] = useState<Level>(
    issue.final_priority ??
      row?.label ??
      issue.citizen_severity ??
      PRIORITY_CONFIG.default_severity,
  );
  const [severity, setSeverity] = useState<Level>(
    issue.authority_severity ??
      row?.effective_severity ??
      issue.citizen_severity ??
      PRIORITY_CONFIG.default_severity,
  );
  const [busy, setBusy] = useState<"" | "priority" | "severity">("");
  const [priorityError, setPriorityError] = useState("");
  const [severityError, setSeverityError] = useState("");

  async function save(kind: "priority" | "severity") {
    const setError = kind === "priority" ? setPriorityError : setSeverityError;
    setBusy(kind);
    setError("");
    try {
      await authorityApi.setPriority(
        issue.id,
        kind === "priority"
          ? { final_priority: priority }
          : { authority_severity: severity },
      );
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="ws-block">
      <h3 className="ws-subhead">Operational priority</h3>
      <p className="ws-current">
        Current decision:{" "}
        <LevelChip level={issue.final_priority} kind="authority" />
      </p>
      {!editable ? (
        <p className="ap-muted ws-small">
          Confirmed severity:{" "}
          <LevelChip level={issue.authority_severity} kind="authority" /> ·
          Priority can only be changed while the issue is open.
        </p>
      ) : (
        <>
          <div className="ws-control-row">
            <label className="ws-label">
              Final priority
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Level)}
                disabled={!editable}
                data-testid={TESTIDS.finalPrioritySelect}
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_META[level].label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ap-button"
              disabled={!editable || busy !== ""}
              onClick={() => void save("priority")}
              data-testid={TESTIDS.finalPrioritySave}
            >
              {busy === "priority" ? "Saving…" : "Save priority"}
            </button>
          </div>
          <InlineError message={priorityError} />
          {!issue.final_priority && row?.label && editable && (
            <p className="ap-muted ws-small">
              Preselected from the recommendation; nothing is saved until you
              click Save.
            </p>
          )}

          <div className="ws-control-row">
            <label className="ws-label">
              Authority severity
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as Level)}
                disabled={!editable}
              >
                {LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {LEVEL_META[level].label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ap-button ap-button-secondary"
              disabled={!editable || busy !== ""}
              onClick={() => void save("severity")}
            >
              {busy === "severity" ? "Saving…" : "Confirm severity"}
            </button>
          </div>
          <p className="ap-muted ws-small">
            Confirmed severity:{" "}
            <LevelChip level={issue.authority_severity} kind="authority" /> — it
            replaces the citizen severity in the recommendation.
          </p>
          <InlineError message={severityError} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// b. Department
// ---------------------------------------------------------------------------

function DepartmentControl({
  issue,
  departments,
  reload,
}: {
  issue: IssueDetail;
  departments: DepartmentsState;
  reload: Reload;
}) {
  const list = departments.kind === "ready" ? departments.list : [];
  const suggested =
    list.find((d) => d.default_categories.includes(issue.category)) ?? null;
  const assignRows = allowedTransitions(issue.status, {
    actor: "AUTHORITY",
    action: "ASSIGN",
  });
  const canAssign = assignRows.length > 0;
  const current = issue.department;
  const isReassign = current !== null;
  const [selected, setSelected] = useState(current?.id ?? suggested?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sla = slaState(issue.sla_due_at);

  const disabled =
    !canAssign ||
    busy ||
    !selected ||
    (current !== null && selected === current.id);

  async function assign() {
    setBusy(true);
    setError("");
    try {
      await authorityApi.assign(issue.id, selected);
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ws-block">
      <h3 className="ws-subhead">Department</h3>
      {current ? (
        <p className="ws-current">
          Assigned to <strong>{current.name}</strong>
          {issue.assigned_at && (
            <span className="ap-muted">
              {" "}
              · since {dateTime(issue.assigned_at)}
            </span>
          )}
        </p>
      ) : (
        <p className="ws-current ap-muted">Not assigned yet.</p>
      )}
      {canAssign && sla && issue.sla_due_at && (
        <p className={`ws-sla ${sla.overdue ? "ws-sla-overdue" : ""}`}>
          {sla.label}{" "}
          <span className="ap-muted">(due {dateTime(issue.sla_due_at)})</span>
        </p>
      )}
      {!canAssign ? null : departments.kind === "error" ? (
        <p className="ap-error" role="alert">
          Departments unavailable: {departments.message}
        </p>
      ) : (
        <>
          <div className="ws-control-row">
            <label className="ws-label">
              {isReassign ? "Move to department" : "Assign to department"}
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={!canAssign}
                data-testid={TESTIDS.departmentSelect}
              >
                {!selected && <option value="">Choose a department</option>}
                {list.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="ap-button"
              disabled={disabled}
              onClick={() => void assign()}
              data-testid={TESTIDS.assignSubmit}
            >
              {busy
                ? isReassign
                  ? "Reassigning…"
                  : "Assigning…"
                : isReassign
                  ? "Reassign"
                  : "Assign"}
            </button>
          </div>
          <p className="ap-muted ws-small">
            {suggested
              ? `${suggested.name} (suggested) handles ${issue.category.toLowerCase().replaceAll("_", " ")} issues by default · SLA ${suggested.sla_hours} h.`
              : "No department handles this category by default — choose one."}
          </p>
          {isReassign && canAssign && issue.status === "IN_PROGRESS" && (
            <p className="ws-warning">
              Reassigning moves this issue back to Assigned and restarts the SLA
              for the new department.
            </p>
          )}
        </>
      )}
      <InlineError message={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// c. Workflow
// ---------------------------------------------------------------------------

function RejectControl({
  issue,
  reload,
}: {
  issue: IssueDetail;
  reload: Reload;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const trimmed = reason.trim();

  async function reject() {
    setBusy(true);
    setError("");
    try {
      await authorityApi.transition(issue.id, "REJECTED", trimmed);
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  if (!open)
    return (
      <button
        type="button"
        className="ap-button ap-button-danger"
        onClick={() => setOpen(true)}
      >
        Reject…
      </button>
    );
  return (
    <div className="ws-confirm" role="group" aria-label="Reject this issue">
      <label className="ws-label">
        Reason for rejection (required, shared with reporters)
        <textarea
          rows={3}
          maxLength={TEXT_LIMITS.note.max}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <div className="ws-control-row">
        <button
          type="button"
          className="ap-button ap-button-danger"
          disabled={busy || !trimmed}
          onClick={() => void reject()}
        >
          {busy ? "Rejecting…" : "Confirm rejection"}
        </button>
        <button
          type="button"
          className="ap-button ap-button-secondary"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Cancel
        </button>
      </div>
      <InlineError message={error} />
    </div>
  );
}

function StartWorkControl({
  issue,
  reload,
}: {
  issue: IssueDetail;
  reload: Reload;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function start() {
    setBusy(true);
    setError("");
    try {
      await authorityApi.transition(issue.id, "IN_PROGRESS");
      await reload();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        className="ap-button"
        disabled={busy}
        onClick={() => void start()}
        data-testid={TESTIDS.startWork}
      >
        {busy ? "Starting…" : "Start work"}
      </button>
      <InlineError message={error} />
    </div>
  );
}

function ResolveControl({
  issue,
  reload,
}: {
  issue: IssueDetail;
  reload: Reload;
}) {
  const { userId } = useAuthorityUser();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [note, setNote] = useState("");
  const [step, setStep] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);

  async function resolve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!file) {
      setError("Add an after-photo as resolution evidence.");
      return;
    }
    try {
      setStep("Preparing photo…");
      const blob = await prepareReportPhoto(file);
      const path = `${userId.toLowerCase()}/${crypto.randomUUID().toLowerCase()}${PHOTO_CONFIG.file_extension}`;
      setStep("Uploading photo…");
      const { error: uploadError } = await createSupabaseBrowserClient()
        .storage.from(STORAGE_BUCKETS.resolutionPhotos)
        .upload(path, blob, {
          contentType: PHOTO_CONFIG.output_mime_type,
          upsert: false,
        });
      if (uploadError)
        throw new Error(`Photo upload failed: ${uploadError.message}`);
      setStep("Recording resolution…");
      await authorityApi.resolve(issue.id, path, note.trim() || undefined);
      setStep("Refreshing…");
      await reload();
    } catch (cause) {
      setError(errorText(cause, "Could not resolve the issue. Please retry."));
    } finally {
      setStep("");
    }
  }

  const busy = step !== "";
  return (
    <form className="ws-resolve" onSubmit={(e) => void resolve(e)}>
      <h4>Resolve with evidence</h4>
      <label className="ws-label">
        After-photo (required)
        <input
          type="file"
          accept={PHOTO_CONFIG.accept}
          disabled={busy}
          onChange={(e) => {
            const chosen = e.target.files?.[0] ?? null;
            setFile(chosen);
            setPreview(chosen ? URL.createObjectURL(chosen) : "");
          }}
          data-testid={TESTIDS.resolvePhotoInput}
        />
      </label>
      {preview && (
        <img className="ws-preview" src={preview} alt="Selected after-photo" />
      )}
      <label className="ws-label">
        Resolution note (optional)
        <textarea
          rows={3}
          maxLength={TEXT_LIMITS.note.max}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          data-testid={TESTIDS.resolveNote}
        />
      </label>
      <button
        type="submit"
        className="ap-button"
        disabled={busy}
        data-testid={TESTIDS.resolveSubmit}
      >
        {busy ? step : "Mark resolved"}
      </button>
      {busy && (
        <p className="ap-muted ws-small" role="status">
          {step}
        </p>
      )}
      <InlineError message={error} />
    </form>
  );
}

function Workflow({ issue, reload }: { issue: IssueDetail; reload: Reload }) {
  const rows = allowedTransitions(issue.status, { actor: "AUTHORITY" });
  const start = rows.some(
    (t) => t.action === "STATUS" && t.to === "IN_PROGRESS",
  );
  const reject = rows.some((t) => t.action === "STATUS" && t.to === "REJECTED");
  const resolve = rows.some((t) => t.action === "RESOLVE");
  const merge = rows.some((t) => t.action === "MERGE");
  const assign = rows.some((t) => t.action === "ASSIGN");

  return (
    <div className="ws-block">
      <h3 className="ws-subhead">Workflow</h3>
      {rows.length === 0 ? (
        <p className="ws-current">No further actions — this issue is closed.</p>
      ) : (
        <>
          {issue.status === "REPORTED" && assign && (
            <p className="ap-muted ws-small">
              Assign a department above before work can start.
            </p>
          )}
          {(start || reject) && (
            <div className="ws-control-row">
              {start && <StartWorkControl issue={issue} reload={reload} />}
              {reject && <RejectControl issue={issue} reload={reload} />}
            </div>
          )}
          {resolve && <ResolveControl issue={issue} reload={reload} />}
          {merge && (
            <p className="ap-muted ws-small">
              To merge this issue into a duplicate, use Possible duplicates
              below.
            </p>
          )}
        </>
      )}

      {issue.resolution_evidence.length > 0 && (
        <div className="ws-evidence">
          <h4>Resolution evidence</h4>
          {issue.resolution_evidence.map((evidence) => (
            <figure key={evidence.id} className="ws-evidence-item">
              <Photo
                src={evidence.image_url}
                alt="Evidence of issue resolution"
                className="ws-gallery-img"
              />
              <figcaption>
                {evidence.note && <p className="ws-note">{evidence.note}</p>}
                <small className="ap-muted">
                  {dateTime(evidence.created_at)}
                </small>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}

export function DecisionPanel({
  issue,
  row,
  departments,
  reload,
}: {
  issue: IssueDetail;
  row: AuthorityQueueRow | null;
  departments: DepartmentsState;
  reload: Reload;
}) {
  const deptKey =
    departments.kind === "ready" ? departments.list.length : "err";
  return (
    <section
      className="ap-card ws-section ws-decision"
      aria-labelledby="ws-decision-title"
    >
      <p className="ap-kicker">Authority decision</p>
      <h2 id="ws-decision-title">Your decision</h2>
      <PriorityControl
        key={`${issue.status}-${issue.final_priority}-${issue.authority_severity}-${row?.label}`}
        issue={issue}
        row={row}
        reload={reload}
      />
      <DepartmentControl
        key={`${issue.status}-${issue.department?.id}-${deptKey}`}
        issue={issue}
        departments={departments}
        reload={reload}
      />
      <Workflow key={issue.status} issue={issue} reload={reload} />
    </section>
  );
}
