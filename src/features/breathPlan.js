// לוח הזמנים של תרגול הנשימה, לבדו ובלי שום קשר למסך.
//
// **הוא יושב בקובץ נפרד כדי שהבדיקה תריץ אותו ולא העתק שלו**, בדיוק מאותה סיבה
// ש-`qa/streak-check.mjs` מושכת את הפונקציות מתוך `App.jsx`: העתק נסחף בעריכה
// הראשונה, והבדיקה ממשיכה לאשר קוד שאינו קיים.
//
// **המספרים כאן הם של ענת**, מדף המשימה של שבוע 4 יום 4: שאיפה בספירה של 4,
// החזקה של 2, נשיפה של 6, ואחרי מחצית הזמן אותו מחזור בסדר הפוך.

export const IN = 4, HOLD = 2, OUT = 6;
export const CYCLE = IN + HOLD + OUT;   // 12 שניות
export const MINUTES = [5, 7, 10];      // הטווח שענת כתבה, 5 עד 10 דקות
export const SMALL = 0.42;              // הקוטר בסוף הנשיפה, ביחס למלא

// ההחלפה נופלת על גבול מחזור ולא באמצעו, אחרת היא הייתה חותכת נשימה באמצע.
export function swapCycleFor(totalSeconds) {
  return Math.round(totalSeconds / 2 / CYCLE);
}

// t הוא שניות מתחילת התרגול. מחזיר את השלב, כמה נשאר בו, וכמה העיגול מלא.
export function phaseAt(t, swapCycle) {
  const cycle = Math.floor(t / CYCLE);
  const x = t % CYCLE;
  const swapped = cycle >= swapCycle;
  let phase, left, scale;
  if (!swapped) {
    if (x < IN)             { phase = "in";   left = IN - x;         scale = SMALL + (1 - SMALL) * (x / IN); }
    else if (x < IN + HOLD) { phase = "hold"; left = IN + HOLD - x;  scale = 1; }
    else                    { phase = "out";  left = CYCLE - x;      scale = 1 - (1 - SMALL) * ((x - IN - HOLD) / OUT); }
  } else {
    if (x < IN)             { phase = "in";    left = IN - x;        scale = SMALL + (1 - SMALL) * (x / IN); }
    else if (x < IN + OUT)  { phase = "out";   left = IN + OUT - x;  scale = 1 - (1 - SMALL) * ((x - IN) / OUT); }
    else                    { phase = "empty"; left = CYCLE - x;     scale = SMALL; }
  }
  return { cycle, x, swapped, phase, left, scale };
}
