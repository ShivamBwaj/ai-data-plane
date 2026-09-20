// Closed parameter domains used to instantiate metric templates into concrete
// benchmark questions with a computable ground-truth answer.

function monthRange(startYear: number, startMonth: number, endYear: number, endMonth: number) {
  const out: string[] = [];
  let y = startYear;
  let m = startMonth;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

export const MONTHS = monthRange(2023, 2, 2025, 7); // Feb 2023 - Jul 2025, avoids partial edge months
export const SEGMENTS = ["SMB", "Mid-Market", "Enterprise"];
export const PLAN_TIERS = ["Starter", "Growth", "Scale", "Enterprise"];
export const REGIONS = ["NA", "EMEA", "APAC", "LATAM"];
export const TICKET_CATEGORIES = ["billing", "technical", "onboarding", "feature_request", "bug"];
export const PRODUCT_CATEGORIES = ["subscription", "addon"];

export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric" });
}
