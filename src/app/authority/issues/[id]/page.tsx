"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { AuthorityGate } from "@/components/auth/AuthoritySession";
import { IssueWorkspace } from "@/components/authority/workspace/IssueWorkspace";
import { uuidSchema } from "@/contracts/primitives";
import "../../workspace.css";

export default function AuthorityIssuePage() {
  const { id } = useParams<{ id: string }>();
  const validId = uuidSchema.safeParse(id).success;

  if (!validId)
    return (
      <div className="page-wrap ws-page">
        <Link className="ws-back" href="/authority">
          ← Triage queue
        </Link>
        <section className="state-panel" role="alert">
          Invalid issue link.
        </section>
      </div>
    );

  return (
    <AuthorityGate>
      <IssueWorkspace key={id} id={id} />
    </AuthorityGate>
  );
}
