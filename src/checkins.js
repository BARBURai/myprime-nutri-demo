// MyPrime - daily progress check-in content.
// Tasks accumulate by week: each task turns on at its startWeek and stays
// active through the end of the program (no stopWeek). Built from the
// 10-week "מעקב ההתקדמות שלי" booklet.
//
// type:  "bool"   -> yes/no tap
//        "number" -> number field (steps, cups, hours...)
// auto:  pulls from data the app already tracks, so she is not asked twice
//        ("steps" | "water" | "protein" | "journal"). auto tasks are read-only.
// group: which section it shows under (see CHECKIN_GROUPS).

export const CHECKIN_GROUPS = [
  { id: "move", label: "תנועה" },
  { id: "food", label: "תזונה" },
  { id: "drink", label: "שתייה" },
  { id: "calm", label: "שינה ורוגע" },
  { id: "extra", label: "תוספות" },
];

export const CHECKIN_TASKS = [
  { id: "steps", label: "צעדים היום", type: "number", startWeek: 1, group: "move", auto: "steps" },
  { id: "journal", label: "מילאתי יומן תזונה", type: "bool", startWeek: 1, group: "food", auto: "journal" },

  { id: "veg", label: "צבעים של ירקות היום", type: "number", startWeek: 2, group: "food" },
  { id: "mealorder", label: "ארוחות בסדר אכילה נכון", type: "number", startWeek: 2, group: "food" },
  { id: "strength", label: "אימון כוח", type: "bool", startWeek: 2, group: "move" },

  { id: "water", label: "כוסות מים היום", type: "number", startWeek: 3, group: "drink", auto: "water" },
  { id: "drinkbefore", label: "שתיתי לפני כל ארוחה", type: "bool", startWeek: 3, group: "drink" },
  { id: "protein", label: "הגעתי ליעד החלבון", type: "bool", startWeek: 3, group: "food", auto: "protein" },

  { id: "sleephours", label: "שעות שינה", type: "number", startWeek: 4, group: "calm" },
  { id: "noscreens", label: "בלי מסכים לפני השינה", type: "bool", startWeek: 4, group: "calm" },
  { id: "stopeating", label: "הפסקתי לאכול שעתיים לפני השינה", type: "bool", startWeek: 4, group: "calm" },
  { id: "breathing", label: "תרגול נשימה", type: "bool", startWeek: 4, group: "calm" },

  { id: "gratitude", label: "יומן הכרת תודה בבוקר", type: "bool", startWeek: 5, group: "calm" },

  { id: "grains", label: "דגנים מלאים או קטניות", type: "bool", startWeek: 6, group: "food" },
  { id: "goodfat", label: "שומן בריא", type: "bool", startWeek: 6, group: "food" },

  { id: "pelvic", label: "תרגול שרירי רצפת אגן", type: "bool", startWeek: 7, group: "move" },
  { id: "probiotics", label: "פרוביוטיקה", type: "bool", startWeek: 7, group: "food" },

  { id: "antiinflam", label: "מזון אנטי-דלקתי", type: "bool", startWeek: 8, group: "food" },
  { id: "fasting", label: "חלון צום לסירוגין (שעות)", type: "number", startWeek: 8, group: "food", optional: true },

  { id: "mobility", label: "אימון מוביליטי", type: "bool", startWeek: 9, group: "move" },
  { id: "sun", label: "חשיפה בריאה לשמש", type: "bool", startWeek: 9, group: "extra" },
  { id: "calcium", label: "מזון עשיר בסידן", type: "bool", startWeek: 9, group: "food" },
];

// Active tasks for a given program week (cumulative).
export function activeTasks(week) {
  return CHECKIN_TASKS.filter((t) => week >= t.startWeek);
}
