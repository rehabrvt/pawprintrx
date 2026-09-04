// Canonical categories for the weekly training-split calendar (mainly used for
// sport/performance dog patients). The "guidance" text is shown to clinicians
// as a reference while building a schedule — it is not enforced.
export const WEEKLY_CATEGORIES = [
  { name: "Strength", guidance: "2-4x/week" },
  { name: "Endurance", guidance: "5x/week" },
  { name: "Balance & Proprioception", guidance: "3-7x/week" },
  { name: "Mobility & Stretching", guidance: "Daily" },
];

// Returns a fresh 7-day schedule with no categories assigned and no rest days set.
export function makeEmptyWeeklySchedule() {
  return Array.from({ length: 7 }, (_, i) => ({ day_number: i + 1, categories: [], rest: false }));
}

// Merges a (possibly partial or missing) saved schedule into a full 7-day array,
// so the builder UI always has all 7 days to render regardless of what was saved.
export function normalizeWeeklySchedule(saved) {
  const base = makeEmptyWeeklySchedule();
  (saved || []).forEach((d) => {
    const idx = base.findIndex((b) => b.day_number === d.day_number);
    if (idx !== -1) base[idx] = { day_number: d.day_number, categories: d.categories || [], rest: !!d.rest };
  });
  return base;
}

// True if a schedule has any actual content worth displaying/saving.
export function weeklyScheduleHasContent(schedule) {
  return (schedule || []).some((d) => d.rest || (d.categories || []).length > 0);
}
