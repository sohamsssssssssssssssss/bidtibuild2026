"use client";

import { AuthorityGate } from "@/components/auth/AuthoritySession";
import { Queue } from "@/components/authority/Queue";

export default function AuthorityQueuePage() {
  return (
    <div className="page-wrap">
      <AuthorityGate>
        <Queue />
      </AuthorityGate>
    </div>
  );
}
