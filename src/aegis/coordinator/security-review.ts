import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface SecurityReviewResult {
  status: "pass" | "fail" | "unknown";
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  content: string;
}

function countIssuesInSection(lines: string[], sectionHeader: string): number {
  let inSection = false;
  let count = 0;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      inSection = line.trim() === sectionHeader;
      continue;
    }
    if (inSection && line.startsWith("- [")) {
      count++;
    }
  }
  return count;
}

export function parseSecurityReview(workspacePath: string): SecurityReviewResult {
  const reviewPath = join(workspacePath, "SECURITY-REVIEW.md");

  if (!existsSync(reviewPath)) {
    return {
      status: "unknown",
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      content: "",
    };
  }

  const content = readFileSync(reviewPath, "utf-8");
  const lines = content.split("\n");

  let status: "pass" | "fail" | "unknown" = "unknown";
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "## status: fail") {
      status = "fail";
    } else if (trimmed === "## status: pass") {
      status = "pass";
    }
  }

  return {
    status,
    criticalCount: countIssuesInSection(lines, "## Critical"),
    warningCount: countIssuesInSection(lines, "## Warning"),
    infoCount: countIssuesInSection(lines, "## Info"),
    content,
  };
}
