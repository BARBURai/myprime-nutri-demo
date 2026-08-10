// Does a cut-off AI answer still yield the food items? The model's reply is JSON; when it
// runs past the length ceiling it stops mid-object and the strict parse fails. Before the
// salvage, that turn was thrown away and she was told "I could not analyse that" even
// though the item was already in the text.
//
// Run: node qa/salvage-check.mjs
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
const i = src.indexOf("function salvageNutritionJson");
const end = src.indexOf("\n// The recommender's answer", i);
const salvage = new Function(`${src.slice(i, end)}\nreturn salvageNutritionJson;`)();

const cases = [
  {
    name: "תווית גבינה, התשובה נחתכה אחרי הפריט",
    text: '{"reply":"קראתי את התווית: גבינה מלוחה, 275 קלוריות ל-100 גרם.","done":true,"items":[{"name":"גבינה מלוחה","en":"salty white cheese","unit":"g","grams":100,"kcal":275,"protein":14.8,"fat":24,"carbs":0},{"name":"עוד פרי',
    wantItems: 1, wantKcal: 275,
  },
  {
    name: "נחתך באמצע המשפט, בלי אף פריט שנסגר",
    text: '{"reply":"רגע, אני קוראת את התווית','wantItems': 0,
  },
  {
    name: "תשובה תקינה לגמרי",
    text: '{"reply":"רשמתי.","done":true,"items":[{"name":"קוטג׳","unit":"g","grams":100,"kcal":98}]}',
    wantItems: 1, wantKcal: 98,
  },
  { name: "טקסט חופשי בלי JSON בכלל", text: "שלום, לא הבנתי מה צילמת.", wantItems: 0, wantNull: true },
];

let failed = 0;
for (const t of cases) {
  const got = salvage(t.text);
  const items = (got && got.items) || [];
  let ok = items.length === t.wantItems;
  if (t.wantNull) ok = got === null;
  if (t.wantKcal != null) ok = ok && items[0] && items[0].kcal === t.wantKcal;
  if (!ok) failed++;
  console.log(`${ok ? "עובר " : "נכשל "} | ${t.name}`);
  console.log(`        חולצו ${items.length} פריטים${items[0] ? `, הראשון ${items[0].name} ${items[0].kcal} קק״ל` : ""}`);
}
console.log(`\n${cases.length - failed} מתוך ${cases.length} עברו.`);
process.exit(0);
