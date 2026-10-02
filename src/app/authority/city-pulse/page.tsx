"use client";

import { AuthorityGate } from "@/components/auth/AuthoritySession";
import { CityPulse } from "@/components/authority/citypulse/CityPulse";

export default function CityPulsePage() {
  return (
    <div className="page-wrap">
      <AuthorityGate>
        <CityPulse />
      </AuthorityGate>
    </div>
  );
}
