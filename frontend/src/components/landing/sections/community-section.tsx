"use client";

import Link from "next/link";

import { AuroraText } from "@/components/ui/aurora-text";
import { Button } from "@/components/ui/button";

import { Section } from "../section";

export function CommunitySection() {
  return (
    <Section
      title={
        <AuroraText colors={["#60A5FA", "#A5FA60", "#A560FA"]}>
          Legal Work, Organized
        </AuroraText>
      }
      subtitle="Keep case materials, legal research, and drafting work together in an authorized Matrix-Law workspace."
    >
      <div className="flex justify-center">
        <Button className="text-xl" size="lg" asChild>
          <Link href="/workspace/law">
            Open Matrix-Law
          </Link>
        </Button>
      </div>
    </Section>
  );
}
