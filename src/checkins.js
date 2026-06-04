// MyPrime - daily progress check-in content (schedule verified against the
// 10-week "מעקב ההתקדמות שלי" booklet, day by day).
//
// Each task has an exact start (startWeek + startDow) and a recurrence:
//   recur "daily"    -> every tracked day (Sun-Fri) from its start onward
//   recur "strength" -> only Sun/Tue/Thu (dow 1/3/5), and NOT on a mobility day
//   recur "mobility" -> only on the explicit MOBILITY_DAYS
// dow (day of week): 1=ראשון(Sun) .. 6=שישי(Fri). Saturday is a rest day (no tasks).
// auto: pulled from data the app already tracks (read-only): steps/water/protein/journal.
// optional: not required, never blocks finishing the day.

export const CHECKIN_GROUPS = [
  { id: "move", label: "תנועה" },
  { id: "food", label: "תזונה" },
  { id: "drink", label: "שתייה" },
  { id: "calm", label: "שינה ורוגע" },
  { id: "extra", label: "תוספות" },
];

// Mobility sessions (replace strength on these days): [week, dow]
export const MOBILITY_DAYS = [[9, 1], [10, 1], [10, 3]];

export const CHECKIN_TASKS = [
  { id: "steps", label: "צעדים היום", type: "number", group: "move", auto: "steps", startWeek: 1, startDow: 3, recur: "daily" },
  { id: "journal", label: "מילאתי יומן תזונה", type: "bool", group: "food", auto: "journal", startWeek: 1, startDow: 3, recur: "daily" },

  { id: "strength", label: "אימון כוח", type: "bool", group: "move", startWeek: 2, startDow: 3, recur: "strength" },
  { id: "veg", label: "צבעים של ירקות היום", type: "number", group: "food", startWeek: 2, startDow: 4, recur: "daily" },
  { id: "mealorder", label: "ארוחות בסדר אכילה", type: "number", group: "food", startWeek: 2, startDow: 4, recur: "daily" },

  { id: "water", label: "כוסות מים היום", type: "number", group: "drink", auto: "water", startWeek: 3, startDow: 2, recur: "daily" },
  { id: "drinkbefore", label: "שתיתי לפני כל ארוחה", type: "bool", group: "drink", startWeek: 3, startDow: 2, recur: "daily" },
  { id: "protein", label: "הגעתי ליעד החלבון", type: "bool", group: "food", auto: "protein", startWeek: 3, startDow: 4, recur: "daily" },

  { id: "sleephours", label: "שעות שינה", type: "number", group: "calm", startWeek: 4, startDow: 2, recur: "daily" },
  { id: "noscreens", label: "בלי מסכים לפני השינה", type: "bool", group: "calm", startWeek: 4, startDow: 2, recur: "daily" },
  { id: "stopeating", label: "הפסקתי לאכול שעתיים לפני השינה", type: "bool", group: "calm", startWeek: 4, startDow: 2, recur: "daily" },
  { id: "breathing", label: "תרגול נשימה", type: "bool", group: "calm", startWeek: 4, startDow: 4, recur: "daily" },

  { id: "gratitude", label: "יומן הכרת תודה בבוקר", type: "bool", group: "calm", startWeek: 5, startDow: 3, recur: "daily" },

  { id: "grains", label: "דגנים מלאים או קטניות", type: "bool", group: "food", startWeek: 6, startDow: 2, recur: "daily" },
  { id: "goodfat", label: "שומן בריא", type: "bool", group: "food", startWeek: 6, startDow: 2, recur: "daily" },

  { id: "pelvic", label: "תרגול שרירי רצפת אגן", type: "bool", group: "move", startWeek: 7, startDow: 2, recur: "daily" },
  { id: "probiotics", label: "פרוביוטיקה", type: "bool", group: "food", startWeek: 7, startDow: 4, recur: "daily" },

  { id: "antiinflam", label: "מזון אנטי-דלקתי", type: "bool", group: "food", startWeek: 8, startDow: 2, recur: "daily" },
  { id: "fasting", label: "חלון צום לסירוגין (שעות)", type: "number", group: "food", startWeek: 8, startDow: 5, recur: "daily", optional: true },

  { id: "calcium", label: "מזון עשיר בסידן", type: "bool", group: "food", startWeek: 9, startDow: 4, recur: "daily" },
  { id: "sun", label: "חשיפה בריאה לשמש", type: "bool", group: "extra", startWeek: 9, startDow: 4, recur: "daily" },

  { id: "mobility", label: "אימון מוביליטי", type: "bool", group: "move", startWeek: 9, startDow: 1, recur: "mobility" },
];

function isMobilityDay(week, dow) {
  return MOBILITY_DAYS.some((m) => m[0] === week && m[1] === dow);
}

// Tasks active on a given program week + day-of-week (1=Sun..6=Fri; 0/other = Saturday/rest = none).
export function activeTasks(week, dow) {
  if (!dow || dow < 1 || dow > 6) return [];
  return CHECKIN_TASKS.filter((t) => {
    if (t.recur === "mobility") return isMobilityDay(week, dow);
    const started = week > t.startWeek || (week === t.startWeek && dow >= t.startDow);
    if (!started) return false;
    if (t.recur === "strength") return (dow === 1 || dow === 3 || dow === 5) && !isMobilityDay(week, dow);
    return true;
  });
}
