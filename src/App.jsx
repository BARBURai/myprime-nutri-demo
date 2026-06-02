import React, { useState, useMemo, useRef } from "react";
import {
  Home, BookOpen, TrendingDown, ChefHat, User, Plus, Check, Search,
  Barcode, Camera, ChevronRight, ChevronLeft, Pencil, Trash2, Minus, X,
  Footprints, Dumbbell, ArrowDownRight, Info, Zap, Target, Sparkles, Droplet,
  MessageCircle, Loader, Copy, Mic, Send, Lock,
} from "lucide-react";
import { XAxis, YAxis, ResponsiveContainer, Tooltip, Area, AreaChart } from "recharts";

// AI requests go through a server proxy that holds the API key (see /api/ai.js).
const AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT || "/api/ai";

/* ============================================================
   DOMAIN — pure logic, zero UI dependency (mirrors src/domain)
   ============================================================ */
const ACTIVITY_FACTORS = { "יושבני": 1.2, "קלה": 1.375, "בינונית": 1.55, "גבוהה": 1.725 };
const KCAL_PER_KG = 7700;
const KCAL_FLOOR = 1200;
const PROTEIN_PER_KG = 1.6;        // טווח מומלץ 1.5–1.7
const FAT_PER_KG = 0.9;
const RATE_OPTIONS = [0, 250, 500, 750];
const WATER_TARGET_GLASSES = 8;    // 8 כוסות = 2 ליטר
const WATER_MIN_GLASSES = 6;       // 6 כוסות = 1.5 ליטר

const rateLabel = (g) => (g === 0 ? "שמירה על המשקל" : `ירידה ${g} ג׳ בשבוע`);
const rateShort = (g) => (g === 0 ? "שמירה" : `${g} ג׳/שבוע`);

function bmrMifflinWoman(weightKg, heightCm, age) {
  return 10 * weightKg + 6.25 * heightCm - 5 * age - 161;
}
function dailyDeficit(weeklyRateG) {
  return Math.round((weeklyRateG / 1000) * KCAL_PER_KG / 7);
}
function computeTargets(profile) {
  const bmr = bmrMifflinWoman(profile.weightKg, profile.heightCm, profile.age);
  const tdee = bmr * (ACTIVITY_FACTORS[profile.activity] ?? 1.55);
  const deficit = dailyDeficit(profile.weeklyRateG);
  const raw = Math.round(tdee - deficit);
  const targetKcal = Math.max(KCAL_FLOOR, raw);
  const floored = raw < KCAL_FLOOR;
  const protein = Math.round(PROTEIN_PER_KG * profile.weightKg);
  const fat = Math.round(FAT_PER_KG * profile.weightKg);
  const carbKcal = Math.max(0, targetKcal - protein * 4 - fat * 9);
  const carbs = Math.round(carbKcal / 4);
  return { bmr: Math.round(bmr), tdee: Math.round(tdee), deficit, targetKcal, floored, protein, fat, carbs };
}
function projection(currentKg, goalKg, weeklyRateG) {
  const rateKg = weeklyRateG / 1000;
  if (rateKg <= 0 || goalKg >= currentKg) {
    return { maintain: true, weeks: 0, data: [{ w: 0, kg: currentKg }, { w: 8, kg: currentKg }] };
  }
  const totalLoss = currentKg - goalKg;
  const weeks = Math.ceil(totalLoss / rateKg);
  const stepW = Math.max(1, Math.ceil(weeks / 14));
  const ease = (t) => 1 - Math.pow(1 - t, 1.8); // ירידה מהירה בהתחלה, מתמתנת
  const data = [];
  for (let w = 0; w <= weeks; w += stepW) {
    const kg = currentKg - totalLoss * ease(w / weeks);
    data.push({ w, kg: Math.round(kg * 10) / 10 });
  }
  if (data[data.length - 1].w !== weeks) data.push({ w: weeks, kg: goalKg });
  return { maintain: false, weeks, data };
}
function nutritionFor(food, grams) {
  const k = grams / 100;
  return {
    kcal: Math.round(food.per100.kcal * k),
    p: Math.round(food.per100.p * k),
    f: Math.round(food.per100.f * k),
    c: Math.round(food.per100.c * k),
  };
}
function activityBonus(stepsKcal, workoutKcal, returnPct) {
  return Math.round((stepsKcal + workoutKcal) * (returnPct / 100));
}

/* ============================================================
   SEED DATA
   ============================================================ */
const FOODS = [
  { id: "yog", name: "יוגורט יווני 5%", per100: { kcal: 90, p: 9, f: 5, c: 4 }, measures: [{ label: "כף", g: 20 }, { label: "מיכל", g: 150 }, { label: "כוס", g: 245 }, { label: "100 ג׳", g: 100 }], def: 1 },
  { id: "ban", name: "בננה בינונית", per100: { kcal: 89, p: 1.1, f: 0.3, c: 23 }, measures: [{ label: "יחידה", g: 118 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "chk", name: "חזה עוף בגריל", per100: { kcal: 165, p: 31, f: 3.6, c: 0 }, measures: [{ label: "מנה", g: 120 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "rice", name: "אורז לבן מבושל", per100: { kcal: 130, p: 2.7, f: 0.3, c: 28 }, measures: [{ label: "כוס", g: 158 }, { label: "100 ג׳", g: 100 }], def: 1 },
  { id: "sal", name: "סלט ירקות", per100: { kcal: 30, p: 1.3, f: 0.2, c: 6 }, measures: [{ label: "מנה", g: 150 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "cot", name: "קוטג׳ 5%", per100: { kcal: 98, p: 11, f: 5, c: 3 }, measures: [{ label: "מנה", g: 100 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "oat", name: "דייסת שיבולת שועל", per100: { kcal: 380, p: 13, f: 7, c: 67 }, measures: [{ label: "מנה", g: 60 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "cof", name: "קפה עם חלב", per100: { kcal: 40, p: 2, f: 1.5, c: 4 }, measures: [{ label: "כוס", g: 150 }, { label: "100 ג׳", g: 100 }], def: 0 },
];
const FOOD_BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f]));
const RECENT = [
  { foodId: "yog", g: 150 }, { foodId: "ban", g: 118 }, { foodId: "cof", g: 150 },
  { foodId: "chk", g: 120 }, { foodId: "oat", g: 60 }, { foodId: "cot", g: 100 },
];
const RECIPES = [
  { id: "r1", name: "קערת קינואה וירקות", kcal: 380, p: 22, f: 12, c: 48, mins: 20, tag: "עתיר חלבון" },
  { id: "r2", name: "חביתת ירק וגבינה", kcal: 290, p: 24, f: 19, c: 6, mins: 12, tag: "דל פחמ׳" },
  { id: "r3", name: "סלט עדשים וטחינה", kcal: 410, p: 18, f: 17, c: 44, mins: 25, tag: "עתיר חלבון" },
];
const MEALS = ["בוקר", "ביניים בוקר", "צהריים", "ביניים אחה״צ", "ערב", "נשנושים"];
const HE_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const HE_MONTHS = ["ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני", "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"];

function ymd(d) { return d.toISOString().slice(0, 10); }
function addDays(dateStr, n) { const d = new Date(dateStr); d.setDate(d.getDate() + n); return ymd(d); }
function relLabel(dateStr) {
  const today = ymd(new Date());
  if (dateStr === today) return "היום";
  if (dateStr === addDays(today, -1)) return "אתמול";
  return null;
}
function prettyDate(dateStr) {
  const d = new Date(dateStr);
  return `${HE_DAYS[d.getDay()]}, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}`;
}
const TODAY = ymd(new Date());
const PROTEIN_UNLOCK_WEEK = 2;
function sundayOf(dateStr) { const d = new Date(dateStr); d.setDate(d.getDate() - d.getDay()); return ymd(d); }
function listSundays() {
  const base = sundayOf(TODAY);
  const out = [];
  for (let i = -8; i <= 2; i++) {
    const v = addDays(base, i * 7);
    const d = new Date(v);
    out.push({ value: v, label: `יום ראשון, ${d.getDate()} ב${HE_MONTHS[d.getMonth()]}` });
  }
  return out;
}
function programWeekFor(startDate, onDate) {
  if (!startDate) return 1;
  const diff = Math.floor((new Date(onDate) - new Date(startDate)) / 86400000);
  if (diff < 0) return 0;
  return Math.floor(diff / 7) + 1;
}
const seedEntry = (id, date, meal, foodId, g, source = "verified") => {
  const f = FOOD_BY_ID[foodId];
  return { id, date, meal, name: f.name, g, source, ...nutritionFor(f, g) };
};
const INITIAL_LOG = [
  seedEntry("e1", TODAY, "בוקר", "oat", 60),
  seedEntry("e2", TODAY, "בוקר", "cof", 150),
  seedEntry("e3", TODAY, "ביניים בוקר", "ban", 118),
  seedEntry("e4", TODAY, "צהריים", "chk", 120),
  seedEntry("e5", TODAY, "צהריים", "rice", 158),
  seedEntry("e6", addDays(TODAY, -1), "בוקר", "oat", 60),
  seedEntry("e7", addDays(TODAY, -1), "צהריים", "chk", 140),
  seedEntry("e8", addDays(TODAY, -1), "ערב", "cot", 100),
];
function makeWeightSeed(currentKg) {
  const off = [2.2, 2.0, 1.6, 1.5, 1.1, 0.8, 0];
  return off.map((o, i) => ({ date: addDays(TODAY, -((off.length - 1 - i) * 4)), kg: Math.round((currentKg + o) * 10) / 10 }));
}

/* ============================================================
   THEME — feminine rose palette
   ============================================================ */
const C = {
  bg: "#FAF3F4", panel: "#FFFFFF", ink: "#3A2B30", sub: "#8B737A", faint: "#BBA7AC",
  line: "#F1E4E7",
  brand: "#D45D79", brandD: "#A8425C", brandBg: "#FBE9EE",
  macroP: "#D45D79", macroF: "#E0986A", macroC: "#A87BB5",
  amber: "#C77A3C", amberBg: "#FBEEDF",
  info: "#9C6BA6", infoBg: "#F2E7F3",
  water: "#7E8DD6", waterBg: "#EBEDF8",
};
const fontStack = "'Rubik', system-ui, sans-serif";
const VERSION = "0.8";

/* ============================================================
   PRIMITIVES
   ============================================================ */
function Ring({ consumed, budget, size = 132 }) {
  const r = 54, circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, budget > 0 ? consumed / budget : 0));
  const remaining = Math.round(budget - consumed);
  const over = remaining < 0;
  return (
    <svg width={size} height={size} viewBox="0 0 132 132">
      <circle cx="66" cy="66" r={r} fill="none" stroke={C.line} strokeWidth="10" />
      <circle cx="66" cy="66" r={r} fill="none" stroke={over ? C.amber : C.brand} strokeWidth="10"
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)}
        transform="rotate(-90 66 66)" style={{ transition: "stroke-dashoffset .5s ease" }} />
      <text x="66" y="62" textAnchor="middle" style={{ fontSize: 26, fontWeight: 600, fill: C.ink }}>{Math.abs(remaining).toLocaleString()}</text>
      <text x="66" y="82" textAnchor="middle" style={{ fontSize: 11, fill: C.sub }}>{over ? "מעל היעד" : `נותרו מ־${Math.round(budget).toLocaleString()}`}</text>
    </svg>
  );
}
function MacroCard({ label, value, target, color, emphasized, headline, locked, lockedText }) {
  if (locked) return (
    <div style={{ flex: 1, background: C.bg, borderRadius: 12, padding: "10px 9px", opacity: 0.8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: C.sub }}>{label}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, color: C.faint, fontSize: 11 }}><Lock size={12} /> {lockedText}</div>
    </div>
  );
  const pct = target ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
  return (
    <div style={{ flex: 1, background: emphasized ? C.brandBg : C.bg, border: `1px solid ${emphasized ? C.brand : "transparent"}`, borderRadius: 12, padding: "10px 9px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11.5, color: emphasized ? C.brandD : C.sub, fontWeight: emphasized ? 600 : 400 }}>{label}</span>
      </div>
      {headline ? (
        <div style={{ fontSize: 18, fontWeight: 600, color: C.ink }}>{target}<span style={{ fontSize: 11, color: C.sub, fontWeight: 400 }}> ג׳</span></div>
      ) : (
        <>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{value}<span style={{ fontSize: 10.5, color: C.faint, fontWeight: 400 }}> / {target} ג׳</span></div>
          <div style={{ height: 5, background: C.line, borderRadius: 3, marginTop: 7 }}><div style={{ width: `${pct}%`, height: 5, background: color, borderRadius: 3, transition: "width .4s" }} /></div>
        </>
      )}
    </div>
  );
}
function MacroRow({ p, f, c, tp, tf, tc, headline, proteinLocked }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <MacroCard label="חלבון" value={p} target={tp} color={C.macroP} emphasized headline={headline} locked={proteinLocked} lockedText={`ייפתח בשבוע ${PROTEIN_UNLOCK_WEEK}`} />
      <MacroCard label="שומן" value={f} target={tf} color={C.macroF} headline={headline} />
      <MacroCard label="פחמימות" value={c} target={tc} color={C.macroC} headline={headline} />
    </div>
  );
}
function WaterCard({ glasses, setGlasses }) {
  const liters = (glasses * 0.25).toString();
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.ink, fontWeight: 500 }}><Droplet size={16} color={C.water} /> מים</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.ink }}>{liters} / 2 ליטר</span>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        {Array.from({ length: WATER_TARGET_GLASSES }).map((_, i) => {
          const filled = i < glasses;
          return (
            <button key={i} onClick={() => setGlasses(filled && i === glasses - 1 ? i : i + 1)}
              style={{ flex: 1, height: 32, borderRadius: 8, border: `1px solid ${filled ? C.water : C.line}`, background: filled ? C.waterBg : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Droplet size={15} color={filled ? C.water : C.faint} fill={filled ? C.water : "none"} />
            </button>
          );
        })}
      </div>
      <div style={{ fontSize: 10, color: C.faint, marginTop: 8 }}>מומלץ {WATER_MIN_GLASSES}–{WATER_TARGET_GLASSES} כוסות ביום (1.5–2 ליטר)</div>
    </div>
  );
}
function Btn({ children, onClick, variant = "solid", disabled, style = {} }) {
  const base = { width: "100%", border: "none", borderRadius: 12, padding: "12px", fontSize: 14, fontWeight: 500, cursor: disabled ? "default" : "pointer", fontFamily: fontStack, transition: "transform .08s, opacity .15s" };
  const variants = { solid: { background: C.brand, color: "#fff" }, ghost: { background: "transparent", color: C.ink, border: `1px solid ${C.line}` } };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], opacity: disabled ? 0.45 : 1, ...style }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(0.98)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}>{children}</button>
  );
}
function SrcBadge({ source }) {
  if (source === "estimated") return <span style={{ fontSize: 10, background: C.amberBg, color: C.amber, padding: "2px 7px", borderRadius: 5 }}>מוערך</span>;
  return null;
}
function Header({ title, onBack }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {onBack && <button onClick={onBack} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4, color: C.sub }}><ChevronRight size={22} /></button>}
      <span style={{ fontSize: 17, fontWeight: 600, color: C.ink }}>{title}</span>
    </div>
  );
}
function Stepper({ value, set, step = 1, min = 0, suffix }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={() => set(Math.max(min, Math.round((value - step) * 10) / 10))} style={{ width: 34, height: 34, border: `1px solid ${C.line}`, borderRadius: 9, background: C.panel, cursor: "pointer", color: C.ink }}><Minus size={15} /></button>
      <span style={{ minWidth: 78, textAlign: "center", fontSize: 18, fontWeight: 600, color: C.ink }}>{value}{suffix ? <span style={{ fontSize: 12, color: C.sub, fontWeight: 400 }}> {suffix}</span> : null}</span>
      <button onClick={() => set(Math.round((value + step) * 10) / 10)} style={{ width: 34, height: 34, border: `1px solid ${C.line}`, borderRadius: 9, background: C.panel, cursor: "pointer", color: C.ink }}><Plus size={15} /></button>
    </span>
  );
}

/* ============================================================
   ONBOARDING
   ============================================================ */
function Onboarding({ onFinish }) {
  const [step, setStep] = useState(0);
  const [age, setAge] = useState(50);
  const [heightCm, setHeightCm] = useState(165);
  const [weightKg, setWeightKg] = useState(72);
  const [rate, setRate] = useState(250);
  const [goalKg, setGoalKg] = useState(66);
  const [agree, setAgree] = useState(false);
  const [startDate, setStartDate] = useState(sundayOf(TODAY));

  const draft = { age, heightCm, weightKg, activity: "בינונית", weeklyRateG: rate, goalWeightKg: rate === 0 ? weightKg : goalKg, returnPct: 50, startDate };
  const targets = computeTargets(draft);
  const proj = projection(weightKg, rate === 0 ? weightKg : goalKg, rate);
  const projData = proj.data.map((d) => ({ ...d, label: `${d.w}` }));

  const Field = ({ label, children }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderTop: `1px solid ${C.line}` }}>
      <span style={{ fontSize: 14, color: C.ink }}>{label}</span>{children}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px 16px" }}>
        <div style={{ display: "flex", gap: 6, margin: "6px 0 8px" }}>
          {[0, 1, 2].map((i) => (<div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? C.brand : C.line, transition: "background .3s" }} />))}
        </div>
        <div style={{ textAlign: "center", fontSize: 10, color: C.faint, marginBottom: 12 }}>v{VERSION}</div>

        {step === 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Sparkles size={20} color={C.brand} /><span style={{ fontSize: 20, fontWeight: 600, color: C.ink }}>נעים להכיר</span></div>
            <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, marginTop: 0, marginBottom: 10 }}>כמה פרטים קצרים כדי שנחשב עבורך תוכנית מדויקת ובת-קיימא.</p>
            <Field label="גיל"><Stepper value={age} set={(v) => setAge(Math.max(18, v))} min={18} /></Field>
            <Field label="גובה"><Stepper value={heightCm} set={setHeightCm} suffix="ס״מ" /></Field>
            <Field label="משקל נוכחי"><Stepper value={weightKg} set={setWeightKg} step={0.5} suffix="ק״ג" /></Field>
            <div style={{ padding: "14px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 14, color: C.ink, marginBottom: 8 }}>תאריך תחילת התוכנית</div>
              <select value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", fontSize: 14, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none" }}>
                {listSundays().map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
              </select>
              <div style={{ fontSize: 11, color: C.faint, marginTop: 6 }}>התוכנית מתחילה בימי ראשון בלבד.</div>
            </div>
            <p style={{ fontSize: 11, color: C.faint, marginTop: 14, lineHeight: 1.6 }}>התוכנית מותאמת לנשים, ולכן אין צורך בשאלת מין.</p>
          </>
        )}

        {step === 1 && (
          <>
            <span style={{ fontSize: 20, fontWeight: 600, color: C.ink }}>מה המטרה שלך?</span>
            <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, marginTop: 6, marginBottom: 14 }}>בחרי קצב ירידה שבועי. קצב מתון נשמר לאורך זמן וטוב יותר לשמירה על מסת שריר.</p>
            {RATE_OPTIONS.map((g) => {
              const sel = rate === g;
              return (
                <div key={g} onClick={() => setRate(g)} style={{ display: "flex", alignItems: "center", gap: 10, border: `1px solid ${sel ? C.brand : C.line}`, background: sel ? C.brandBg : "transparent", borderRadius: 14, padding: 14, marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${sel ? C.brand : C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{sel && <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.brand }} />}</div>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500, color: C.ink }}>{rateLabel(g)}</span>
                  {g === 250 && <span style={{ fontSize: 10, background: C.brand, color: "#fff", padding: "3px 9px", borderRadius: 7 }}>מומלץ</span>}
                </div>
              );
            })}
            {rate !== 0 && (<div style={{ marginTop: 6 }}><Field label="משקל רצוי"><Stepper value={goalKg} set={(v) => setGoalKg(Math.min(weightKg - 0.5, v))} step={0.5} suffix="ק״ג" /></Field></div>)}
          </>
        )}

        {step === 2 && (
          <>
            <span style={{ fontSize: 20, fontWeight: 600, color: C.ink }}>התוכנית שלך</span>
            <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.6, marginTop: 6, marginBottom: 12 }}>
              {proj.maintain ? "תוכנית לשמירה על המשקל הנוכחי." : `בקצב של ${rate} ג׳ בשבוע, תגיעי ל־${goalKg} ק״ג בעוד כ־${proj.weeks} שבועות.`}
            </p>

            <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 10px 6px", marginBottom: 12 }}>
              <div style={{ height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={projData} margin={{ top: 6, right: 10, left: 10, bottom: 0 }}>
                    <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.brand} stopOpacity={0.2} /><stop offset="100%" stopColor={C.brand} stopOpacity={0} /></linearGradient></defs>
                    <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} />
                    <YAxis domain={["dataMin - 1", "dataMax + 1"]} hide />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontStack }} formatter={(v) => [`${v} ק״ג`, "משקל צפוי"]} labelFormatter={(l) => `שבוע ${l}`} />
                    <Area type="monotone" dataKey="kg" stroke={C.brand} strokeWidth={2.5} fill="url(#pg)" dot={{ r: 2.5, fill: C.brand }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ textAlign: "center", fontSize: 10, color: C.faint, paddingBottom: 6 }}>תחזית לפי שבועות</div>
            </div>

            <div style={{ background: C.brandBg, borderRadius: 14, padding: 14, marginBottom: 12, textAlign: "center" }}>
              <div style={{ fontSize: 11, color: C.brandD, marginBottom: 4 }}>יעד קלורי יומי מומלץ</div>
              <div style={{ fontSize: 30, fontWeight: 600, color: C.brandD }}>{targets.targetKcal.toLocaleString()} <span style={{ fontSize: 14 }}>קק״ל</span></div>
            </div>

            <div style={{ marginBottom: 10 }}><MacroRow p={targets.protein} f={targets.fat} c={targets.carbs} tp={targets.protein} tf={targets.fat} tc={targets.carbs} headline /></div>

            <div style={{ fontSize: 11, color: C.sub, background: C.bg, padding: 11, borderRadius: 10, lineHeight: 1.7, marginBottom: 12 }}>
              <div style={{ display: "flex", gap: 6 }}><Target size={14} color={C.brand} style={{ flexShrink: 0, marginTop: 2 }} /><span><b style={{ color: C.ink }}>חלבון</b> — יעד מודגש של {PROTEIN_PER_KG} גרם לכל ק״ג משקל גוף (טווח מומלץ 1.5–1.7), חשוב לשמירה על מסת שריר. נפתח למעקב בשבוע {PROTEIN_UNLOCK_WEEK} של התוכנית.</span></div>
              <div style={{ display: "flex", gap: 6, marginTop: 7 }}><Droplet size={14} color={C.water} style={{ flexShrink: 0, marginTop: 2 }} /><span><b style={{ color: C.ink }}>מים</b> — יעד שתייה של 1.5–2 ליטר ביום.</span></div>
            </div>

            {targets.floored && (
              <div style={{ fontSize: 11, color: C.amber, background: C.amberBg, padding: 10, borderRadius: 10, lineHeight: 1.6, marginBottom: 12, display: "flex", gap: 6 }}>
                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>הקצב שבחרת מהיר מהמומלץ עבור הנתונים שלך. היעד הוגבל ל־{KCAL_FLOOR} קק״ל לשמירה על בריאותך — שקלי קצב מתון יותר.</span>
              </div>
            )}

            <div onClick={() => setAgree(!agree)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "4px 0 8px" }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${agree ? C.brand : C.line}`, background: agree ? C.brand : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{agree && <Check size={14} color="#fff" />}</div>
              <span style={{ fontSize: 12, color: C.sub, lineHeight: 1.5 }}>קראתי ואני מאשרת את <span style={{ color: C.brandD, textDecoration: "underline" }}>תנאי השימוש ומדיניות הפרטיות</span></span>
            </div>
          </>
        )}
      </div>

      <div style={{ padding: "10px 20px 18px", borderTop: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center" }}>
        {step > 0 && (<button onClick={() => setStep(step - 1)} style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: 12, width: 46, height: 46, cursor: "pointer", color: C.ink, flexShrink: 0 }}><ChevronRight size={20} /></button>)}
        {step < 2 ? (<Btn onClick={() => setStep(step + 1)}>המשך</Btn>) : (<Btn disabled={!agree} onClick={() => onFinish(draft)}>בואי נתחיל</Btn>)}
      </div>
    </div>
  );
}

/* ============================================================
   SCREENS
   ============================================================ */
function HomeScreen({ targets, todayLog, activity, profile, openAdd, water, setWater }) {
  const consumed = todayLog.reduce((s, e) => s + e.kcal, 0);
  const week = programWeekFor(profile.startDate, TODAY);
  const proteinLocked = week < PROTEIN_UNLOCK_WEEK;
  const bonus = activityBonus(activity.stepsKcal, activity.workoutKcal, profile.returnPct);
  const budget = targets.targetKcal + bonus;
  const macros = todayLog.reduce((s, e) => ({ p: s.p + e.p, f: s.f + e.f, c: s.c + e.c }), { p: 0, f: 0, c: 0 });
  const byMeal = (m) => todayLog.filter((e) => e.meal === m);
  return (
    <div style={{ padding: "8px 16px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 18, fontWeight: 600, color: C.ink }}>היום</span>
        <span style={{ fontSize: 11, background: C.brandBg, color: C.brandD, padding: "4px 10px", borderRadius: 20 }}>{week >= 1 ? `שבוע ${week} בתוכנית` : "התוכנית טרם החלה"}</span>
      </div>
      <div style={{ fontSize: 12, color: C.faint, marginBottom: 8 }}>{prettyDate(TODAY)}</div>
      <div style={{ display: "flex", justifyContent: "center" }}><Ring consumed={consumed} budget={budget} /></div>
      <div style={{ display: "flex", justifyContent: "center", gap: 12, fontSize: 11, color: C.sub, margin: "4px 0 14px" }}>
        <span>בסיס {targets.targetKcal.toLocaleString()}</span>
        <span style={{ color: C.brandD }}>פעילות +{bonus}</span>
        <span>נאכל {consumed.toLocaleString()}</span>
      </div>

      <div style={{ fontSize: 11, color: C.faint, marginBottom: 8 }}>תזונה</div>
      <div style={{ marginBottom: 16 }}><MacroRow p={macros.p} f={macros.f} c={macros.c} tp={targets.protein} tf={targets.fat} tc={targets.carbs} proteinLocked={proteinLocked} /></div>

      <WaterCard glasses={water} setGlasses={setWater} />

      <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, marginBottom: 8 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.ink }}><Footprints size={16} color={C.info} /> {activity.steps.toLocaleString()} צעדים</span>
          <span style={{ color: C.brandD, fontWeight: 500 }}>+{Math.round(activity.stepsKcal * profile.returnPct / 100)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6, color: C.ink }}><Dumbbell size={16} color={C.info} /> אימון כוח · 30 דק׳</span>
          <span style={{ color: C.brandD, fontWeight: 500 }}>+{Math.round(activity.workoutKcal * profile.returnPct / 100)}</span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: C.faint, margin: "2px 0 4px" }}>ארוחות</div>
      {MEALS.map((m) => {
        const items = byMeal(m);
        const kcal = items.reduce((s, e) => s + e.kcal, 0);
        return (
          <div key={m} onClick={() => openAdd(m)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "10px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, color: items.length ? C.ink : C.faint }}>{items.length ? <Check size={15} color={C.brand} /> : <Plus size={15} />}{m}</span>
            <span style={{ color: C.faint }}>{kcal || ""}</span>
          </div>
        );
      })}
      <div style={{ marginTop: 14 }}><Btn onClick={() => openAdd(null)}>+ הוסף מזון</Btn></div>
    </div>
  );
}

function DiaryScreen({ log, date, setDate, targets, openAdd, editEntry, deleteEntry, startDate }) {
  const dayLog = log.filter((e) => e.date === date);
  const total = dayLog.reduce((s, e) => s + e.kcal, 0);
  const diff = targets.targetKcal - total;
  const weekDots = Array.from({ length: 5 }, (_, i) => addDays(date, i - 2));
  return (
    <div style={{ padding: "8px 16px 16px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <button onClick={() => setDate(addDays(date, -1))} style={{ border: "none", background: C.panel, boxShadow: `inset 0 0 0 1px ${C.line}`, borderRadius: 9, width: 32, height: 32, cursor: "pointer", color: C.ink }}><ChevronRight size={18} /></button>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: C.ink }}>{prettyDate(date)}</div>
          {relLabel(date) && <div style={{ fontSize: 11, color: C.faint }}>{relLabel(date)}</div>}
          {programWeekFor(startDate, date) >= 1 && <div style={{ fontSize: 10, color: C.brandD }}>שבוע {programWeekFor(startDate, date)} בתוכנית</div>}
        </div>
        <button onClick={() => setDate(addDays(date, 1))} disabled={date >= TODAY} style={{ border: "none", background: C.panel, boxShadow: `inset 0 0 0 1px ${C.line}`, borderRadius: 9, width: 32, height: 32, cursor: date >= TODAY ? "default" : "pointer", color: date >= TODAY ? C.line : C.ink }}><ChevronLeft size={18} /></button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
        {weekDots.map((d) => {
          const has = log.some((e) => e.date === d);
          const sel = d === date;
          return (
            <div key={d} onClick={() => d <= TODAY && setDate(d)} style={{ textAlign: "center", flex: 1, cursor: d <= TODAY ? "pointer" : "default" }}>
              <div style={{ fontSize: 11, color: sel ? C.ink : C.faint, fontWeight: sel ? 500 : 400 }}>{HE_DAYS[new Date(d).getDay()]}</div>
              <div style={{ width: 9, height: 9, borderRadius: "50%", margin: "5px auto 0", background: has ? (sel ? C.brandD : C.brand) : "transparent", boxShadow: has ? "none" : `inset 0 0 0 1px ${C.line}` }} />
            </div>
          );
        })}
      </div>
      <div style={{ background: C.bg, borderRadius: 12, padding: 12, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 12, color: C.sub }}>סך היום</span>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{total.toLocaleString()} / {targets.targetKcal.toLocaleString()}</span>
        </div>
        <div style={{ height: 7, background: C.line, borderRadius: 4, marginTop: 8 }}><div style={{ width: `${Math.min(100, Math.round(total / targets.targetKcal * 100))}%`, height: 7, background: total > targets.targetKcal ? C.amber : C.brand, borderRadius: 4 }} /></div>
        <div style={{ fontSize: 10, color: diff >= 0 ? C.brandD : C.amber, marginTop: 6 }}>{diff >= 0 ? `${diff} קק״ל מתחת ליעד` : `${Math.abs(diff)} קק״ל מעל היעד`}</div>
      </div>
      <div style={{ fontSize: 11, color: C.faint, marginBottom: 2 }}>הקש על פריט לעריכה</div>
      {dayLog.length === 0 && <div style={{ fontSize: 13, color: C.faint, padding: "16px 0", textAlign: "center" }}>אין רישומים ביום זה</div>}
      {dayLog.map((e) => (
        <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
          <div onClick={() => editEntry(e)} style={{ flex: 1, cursor: "pointer" }}>
            <div style={{ fontSize: 13, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>{e.name} <SrcBadge source={e.source} /></div>
            <div style={{ fontSize: 11, color: C.faint }}>{e.meal} · {e.g} ג׳ · {e.kcal} קק״ל</div>
          </div>
          <button onClick={() => editEntry(e)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint, padding: 4 }}><Pencil size={15} /></button>
          <button onClick={() => deleteEntry(e.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint, padding: 4 }}><Trash2 size={15} /></button>
        </div>
      ))}
      <div style={{ marginTop: 14 }}><Btn variant="ghost" onClick={() => openAdd(null)}>+ הוסף לארוחה (גם בדיעבד)</Btn></div>
    </div>
  );
}

function ReportScreen({ weights, addWeight, log, targets, programWeek }) {
  const data = weights.map((w) => ({ ...w, label: `${new Date(w.date).getDate()}/${new Date(w.date).getMonth() + 1}` }));
  const change = Math.round((weights[weights.length - 1].kg - weights[0].kg) * 10) / 10;
  const current = weights[weights.length - 1].kg;
  const daysOnTarget = (() => {
    const byDate = {};
    log.forEach((e) => { byDate[e.date] = (byDate[e.date] || 0) + e.kcal; });
    const dates = Object.keys(byDate);
    return dates.filter((d) => byDate[d] <= targets.targetKcal).length + "/" + dates.length;
  })();
  const adaptive = Math.round(targets.tdee + (change < 0 ? -40 : 40));
  return (
    <div style={{ padding: "8px 16px 16px" }}>
      <Header title="דוח והתקדמות" />
      <div style={{ marginBottom: 12 }}><span style={{ fontSize: 11, background: C.brandBg, color: C.brandD, padding: "4px 10px", borderRadius: 20 }}>שבוע {programWeek} בתוכנית</span></div>
      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        {["שבוע", "חודש", "3 חודשים"].map((t, i) => (<span key={t} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, background: i === 1 ? C.ink : "transparent", color: i === 1 ? "#fff" : C.sub, boxShadow: i === 1 ? "none" : `inset 0 0 0 1px ${C.line}` }}>{t}</span>))}
      </div>
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div><div style={{ fontSize: 11, color: C.sub }}>משקל נוכחי</div><div style={{ fontSize: 24, fontWeight: 600, color: C.ink }}>{current} <span style={{ fontSize: 13, color: C.sub }}>ק״ג</span></div></div>
          <span style={{ fontSize: 12, background: C.brandBg, color: C.brandD, padding: "4px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 3 }}><ArrowDownRight size={14} /> {Math.abs(change)} ק״ג</span>
        </div>
        <div style={{ height: 150, margin: "6px -6px 0" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.brand} stopOpacity={0.2} /><stop offset="100%" stopColor={C.brand} stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: C.faint }} axisLine={false} tickLine={false} />
              <YAxis domain={["dataMin - 0.5", "dataMax + 0.5"]} hide />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontStack }} formatter={(v) => [`${v} ק״ג`, "משקל"]} labelFormatter={() => ""} />
              <Area type="monotone" dataKey="kg" stroke={C.brand} strokeWidth={2.5} fill="url(#wg)" dot={{ r: 3, fill: C.brand }} activeDot={{ r: 5, fill: C.brandD }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={addWeight} style={{ padding: "9px" }}>+ הזיני משקל היום</Btn></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <div style={{ flex: 1, background: C.bg, borderRadius: 10, padding: 10 }}><div style={{ fontSize: 10, color: C.sub }}>ימים ביעד</div><div style={{ fontSize: 17, fontWeight: 600, color: C.ink }}>{daysOnTarget}</div></div>
        <div style={{ flex: 1, background: C.bg, borderRadius: 10, padding: 10 }}><div style={{ fontSize: 10, color: C.sub }}>יעד חלבון</div><div style={{ fontSize: 17, fontWeight: 600, color: C.ink }}>{targets.protein} ג׳</div></div>
      </div>
      <div style={{ fontSize: 11, color: C.sub, background: C.bg, padding: 10, borderRadius: 10, lineHeight: 1.6, display: "flex", gap: 6 }}>
        <Target size={15} color={C.brandD} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>לפי המשקל בפועל, ההוצאה האמיתית שלך כוילה ל־{adaptive.toLocaleString()} קק״ל (Adaptive TDEE)</span>
      </div>
    </div>
  );
}

function RecipesScreen({ addRecipe }) {
  return (
    <div style={{ padding: "8px 16px 16px" }}>
      <Header title="מתכונים" />
      <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
        {["הכל", "דל פחמימות", "עתיר חלבון"].map((t, i) => (<span key={t} style={{ fontSize: 12, padding: "5px 12px", borderRadius: 20, background: i === 0 ? C.ink : "transparent", color: i === 0 ? "#fff" : C.sub, boxShadow: i === 0 ? "none" : `inset 0 0 0 1px ${C.line}` }}>{t}</span>))}
      </div>
      {RECIPES.map((r) => (
        <div key={r.id} style={{ border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ height: 84, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint }}><ChefHat size={26} /></div>
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: C.ink, marginBottom: 5 }}>{r.name}</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 11, color: C.sub }}>{r.kcal} קק״ל · חלבון {r.p} ג׳ · {r.mins} דק׳</span>
              <button onClick={() => addRecipe(r)} style={{ width: 28, height: 28, border: "none", borderRadius: 8, background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} /></button>
            </div>
          </div>
        </div>
      ))}
      <div style={{ fontSize: 11, color: C.faint, background: C.bg, padding: 10, borderRadius: 10, display: "flex", gap: 6, lineHeight: 1.6 }}><Info size={15} style={{ flexShrink: 0, marginTop: 1 }} /> <span>הערכים מחושבים מהמרכיבים. + מוסיף מנה ליומן</span></div>
    </div>
  );
}

function ProfileScreen({ profile, setProfile, targets, onReset }) {
  const Row = ({ label, children }) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
      <span style={{ color: C.sub }}>{label}</span>
      <span style={{ fontWeight: 500, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>{children}</span>
    </div>
  );
  const Mini = ({ value, set, step = 1, min = 0, suffix }) => (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button onClick={() => set(Math.max(min, Math.round((value - step) * 10) / 10))} style={{ width: 26, height: 26, border: `1px solid ${C.line}`, borderRadius: 7, background: C.panel, cursor: "pointer", color: C.ink }}><Minus size={13} /></button>
      <span style={{ minWidth: 56, textAlign: "center" }}>{value}{suffix ? ` ${suffix}` : ""}</span>
      <button onClick={() => set(Math.round((value + step) * 10) / 10)} style={{ width: 26, height: 26, border: `1px solid ${C.line}`, borderRadius: 7, background: C.panel, cursor: "pointer", color: C.ink }}><Plus size={13} /></button>
    </span>
  );
  const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length];
  return (
    <div style={{ padding: "8px 16px 16px" }}>
      <Header title="פרופיל" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.brandBg, color: C.brandD, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>דכ</div>
        <div><div style={{ fontSize: 14, fontWeight: 500, color: C.ink }}>דנה כהן</div><div style={{ fontSize: 11, color: C.faint }}>{rateLabel(profile.weeklyRateG)}</div></div>
      </div>
      <Row label="גיל"><Mini value={profile.age} set={(v) => setProfile({ ...profile, age: Math.max(18, v) })} /></Row>
      <Row label="גובה"><Mini value={profile.heightCm} set={(v) => setProfile({ ...profile, heightCm: v })} suffix="ס״מ" /></Row>
      <Row label="משקל"><Mini value={profile.weightKg} set={(v) => setProfile({ ...profile, weightKg: v })} step={0.5} suffix="ק״ג" /></Row>
      <Row label="משקל יעד"><Mini value={profile.goalWeightKg} set={(v) => setProfile({ ...profile, goalWeightKg: v })} step={0.5} suffix="ק״ג" /></Row>
      <Row label="קצב ירידה">
        <button onClick={() => setProfile({ ...profile, weeklyRateG: cycle(RATE_OPTIONS, profile.weeklyRateG) })} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.ink, fontFamily: fontStack, fontSize: 13, fontWeight: 500, display: "flex", alignItems: "center", gap: 4 }}>{rateShort(profile.weeklyRateG)} <Pencil size={13} color={C.faint} /></button>
      </Row>
      <Row label="תחילת התוכנית">
        <select value={profile.startDate} onChange={(e) => setProfile({ ...profile, startDate: e.target.value })} style={{ border: `1px solid ${C.line}`, borderRadius: 8, padding: "6px 8px", fontSize: 12, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none" }}>
          {listSundays().map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
        </select>
      </Row>
      <div style={{ fontSize: 11, color: C.faint, marginTop: 8 }}>את/ה כעת בשבוע {programWeekFor(profile.startDate, TODAY)} בתוכנית.</div>
      <div style={{ background: C.brandBg, borderRadius: 12, padding: 12, marginTop: 16, marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: C.brandD, marginBottom: 8 }}>יעד קלורי יומי</div>
        <div style={{ fontSize: 22, fontWeight: 600, color: C.brandD }}>{targets.targetKcal.toLocaleString()} <span style={{ fontSize: 13 }}>קק״ל</span></div>
      </div>
      <MacroRow p={targets.protein} f={targets.fat} c={targets.carbs} tp={targets.protein} tf={targets.fat} tc={targets.carbs} headline />
      <div style={{ marginTop: 16 }}><Btn>שמור שינויים</Btn></div>
      <div style={{ marginTop: 10 }}><Btn variant="ghost" onClick={onReset} style={{ color: C.sub }}>התחל דמו מחדש (חזרה לאונבורדינג)</Btn></div>
      <div style={{ textAlign: "center", fontSize: 10, color: C.faint, marginTop: 12 }}>גרסה v{VERSION}</div>
    </div>
  );
}

/* ============================================================
   AI MEAL ANALYSIS (demo) — sends photo to Claude for estimation
   ============================================================ */
async function analyzeMeal(base64, mediaType) {
  const prompt = "בתמונה מופיעה ארוחה. זהה את פריטי המזון, והערך לכל פריט כמות בגרמים וערכים תזונתיים סבירים. החזר JSON בלבד, ללא טקסט נוסף וללא סימוני קוד, במבנה: {\"items\":[{\"name\":\"שם בעברית\",\"grams\":0,\"kcal\":0,\"protein\":0,\"fat\":0,\"carbs\":0}]}";
  const res = await fetch(AI_ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: prompt }] }] }),
  });
  const data = await res.json();
  const text = (data.content || []).map((i) => i.text || "").join("");
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  const arr = parsed.items || parsed || [];
  return arr.map((it) => ({ name: it.name, grams: Math.round(it.grams || 0), kcal: Math.round(it.kcal || 0), p: Math.round(it.protein || 0), f: Math.round(it.fat || 0), c: Math.round(it.carbs || 0) }));
}

async function aiNutritionChat(messages) {
  const system = "את עוזרת תזונה ידידותית של MyPrime, מדברת עברית. המשתמשת מספרת מה אכלה. נהלי שיחה קצרה מאוד: אם חסר מידע קריטי לחישוב (כמות או גודל מנה), שאלי שאלה אחת קצרה וברורה. כשיש מספיק מידע — סכמי. החזירי בכל תור JSON בלבד, בלי טקסט נוסף ובלי סימוני קוד, במבנה: {\"reply\":\"טקסט קצר למשתמשת\",\"done\":false,\"items\":[]} . כאשר יש מספיק מידע החזירי done=true ובמערך items כל פריט במבנה {\"name\":\"שם בעברית\",\"grams\":מספר,\"kcal\":מספר,\"protein\":מספר,\"fat\":מספר,\"carbs\":מספר} עם הערכות סבירות.";
  const res = await fetch(AI_ENDPOINT, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, system, messages }),
  });
  const data = await res.json();
  const text = (data.content || []).map((i) => i.text || "").join("");
  let parsed;
  try { parsed = JSON.parse(text.replace(/```json|```/g, "").trim()); }
  catch (e) { parsed = { reply: text || "לא הבנתי, אפשר לנסות שוב?", done: false, items: [] }; }
  return {
    raw: text,
    reply: parsed.reply || "",
    done: !!parsed.done,
    items: (parsed.items || []).map((it) => ({ name: it.name, grams: Math.round(it.grams || 0), kcal: Math.round(it.kcal || 0), p: Math.round(it.protein || 0), f: Math.round(it.fat || 0), c: Math.round(it.carbs || 0) })),
  };
}

function IntroOverlay({ onClose }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22, zIndex: 40 }}>
      <div style={{ background: C.panel, borderRadius: 18, padding: 20, fontFamily: fontStack }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><Sparkles size={20} color={C.brand} /><span style={{ fontSize: 17, fontWeight: 600, color: C.ink }}>דמו MyPrime · v{VERSION}</span></div>
        <p style={{ fontSize: 13, color: C.sub, lineHeight: 1.7, margin: "0 0 12px" }}>שלום ענת 🙂 זו גרסת הדגמה לשחק איתה. כמה דברים:</p>
        <ul style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.8, margin: "0 0 14px", paddingInlineStart: 18 }}>
          <li>הנתונים לא נשמרים — רענון מתחיל מחדש.</li>
          <li>אפשר לצלם צלחת אמיתית ולקבל הערכת ערכים (ניתוח ע״י AI).</li>
          <li>סריקת ברקוד היא הדגמה בשלב זה.</li>
          <li>אפשר להשאיר הערות בכפתור ההערות, ולהעתיק אותן לשליחה.</li>
        </ul>
        <Btn onClick={onClose}>הבנתי, בואי נתחיל</Btn>
      </div>
    </div>
  );
}

function NotesFab({ notes, setNotes, screen }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const add = () => { if (!text.trim()) return; setNotes((n) => [...n, { text: text.trim(), screen, t: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) }]); setText(""); };
  const copyAll = () => { try { navigator.clipboard.writeText(notes.map((n) => `• [${n.screen}] ${n.text}`).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };
  return (
    <>
      <button onClick={() => setOpen(true)} style={{ position: "absolute", bottom: 70, insetInlineStart: 14, width: 46, height: 46, borderRadius: "50%", background: C.brand, color: "#fff", border: "none", boxShadow: "0 4px 14px rgba(168,66,92,0.4)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 15 }}>
        <MessageCircle size={20} />
        {notes.length > 0 && <span style={{ position: "absolute", top: -2, insetInlineEnd: -2, background: C.ink, color: "#fff", fontSize: 10, minWidth: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{notes.length}</span>}
      </button>
      {open && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.4)", display: "flex", alignItems: "flex-end", zIndex: 45 }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, width: "100%", maxHeight: "80%", borderRadius: "20px 20px 0 0", padding: "14px 16px 18px", overflowY: "auto", fontFamily: fontStack }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>הערות לדמו</span>
              <button onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><X size={20} /></button>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`הערה על מסך "${screen}"…`} rows={3} style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, fontSize: 13, fontFamily: fontStack, color: C.ink, outline: "none", resize: "none", marginBottom: 8, boxSizing: "border-box" }} />
            <Btn onClick={add}>הוסיפי הערה</Btn>
            {notes.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {notes.map((n, i) => (
                  <div key={i} style={{ borderTop: `1px solid ${C.line}`, padding: "9px 0", display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ flex: 1, fontSize: 13, color: C.ink }}>{n.text}<div style={{ fontSize: 10, color: C.faint, marginTop: 2 }}>{n.screen} · {n.t}</div></span>
                    <button onClick={() => setNotes((arr) => arr.filter((_, j) => j !== i))} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><Trash2 size={14} /></button>
                  </div>
                ))}
                <div style={{ marginTop: 12 }}><Btn variant="ghost" onClick={copyAll}><Copy size={14} style={{ verticalAlign: -2, marginLeft: 4 }} /> {copied ? "הועתק!" : "העתיקי הכל לשליחה"}</Btn></div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* ============================================================
   ADD / EDIT MODAL
   ============================================================ */
function AddModal({ state, close, commit, removeAndClose }) {
  const [step, setStep] = useState(state.editEntry ? "qty" : (state.preMeal ? "list" : "method"));
  const [meal, setMeal] = useState(state.editEntry?.meal || state.preMeal || "בוקר");
  const [food, setFood] = useState(state.editEntry ? FOODS.find((f) => f.name === state.editEntry.name) || FOODS[0] : null);
  const [grams, setGrams] = useState(state.editEntry?.g || 100);
  const [query, setQuery] = useState("");
  const fileRef = useRef(null);
  const [photoState, setPhotoState] = useState("capture");
  const [photoResult, setPhotoResult] = useState(null);
  const onPhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = String(reader.result).split(",")[1];
      setPhotoState("analyzing");
      try {
        const items = await analyzeMeal(base64, file.type || "image/jpeg");
        if (!items.length) throw new Error("empty");
        setPhotoResult(items); setPhotoState("result");
      } catch (err) {
        setPhotoResult(photoItems.map((it) => ({ name: it.f.name, grams: it.g, ...nutritionFor(it.f, it.g) }))); setPhotoState("error");
      }
    };
    reader.readAsDataURL(file);
  };
  const [aiMsgs, setAiMsgs] = useState([{ role: "assistant", text: "היי! ספרי לי מה אכלת ואעזור להעריך 🙂 אפשר לדבר או לכתוב." }]);
  const [aiApi, setAiApi] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDoneItems, setAiDoneItems] = useState(null);
  const recRef = useRef(null);
  const sendAi = async (textArg) => {
    const text = (textArg != null ? textArg : aiInput).trim();
    if (!text || aiLoading) return;
    setAiInput("");
    setAiMsgs((m) => [...m, { role: "user", text }]);
    const apiMsgs = [...aiApi, { role: "user", content: text }];
    setAiLoading(true);
    try {
      const r = await aiNutritionChat(apiMsgs);
      setAiApi([...apiMsgs, { role: "assistant", content: r.raw }]);
      setAiMsgs((m) => [...m, { role: "assistant", text: r.reply }]);
      if (r.done && r.items.length) setAiDoneItems(r.items);
    } catch (e) {
      setAiMsgs((m) => [...m, { role: "assistant", text: "יש תקלה זמנית בחיבור ל-AI. נסי שוב, או הוסיפי דרך חיפוש." }]);
    } finally { setAiLoading(false); }
  };
  const startMic = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("זיהוי דיבור לא נתמך בדפדפן הזה — נסי ב-Chrome או הקלידי."); return; }
    const rec = new SR(); rec.lang = "he-IL"; rec.interimResults = false; rec.maxAlternatives = 1;
    rec.onresult = (e) => setAiInput(e.results[0][0].transcript);
    rec.onerror = () => {};
    rec.start(); recRef.current = rec;
  };
  const pickFood = (f, g) => { setFood(f); setGrams(g ?? f.measures[f.def].g); setStep("qty"); };
  const photoItems = [{ f: FOOD_BY_ID["rice"], g: 158 }, { f: FOOD_BY_ID["chk"], g: 120 }, { f: FOOD_BY_ID["sal"], g: 80 }];
  const filtered = FOODS.filter((f) => f.name.includes(query));
  const nut = food ? nutritionFor(food, grams) : null;
  const title = step === "method" ? "הוספת מזון" : step === "list" ? `הוספה ל${meal}` : step === "photo" ? "זוהה בתמונה" : step === "ai" ? "ספרי לי מה אכלת" : (state.editEntry ? "עריכת פריט" : food?.name);
  const back = step === "qty" && !state.editEntry ? () => setStep("list") : (step === "list" || step === "photo" || step === "ai") ? () => setStep("method") : null;
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.4)", display: "flex", alignItems: "flex-end", zIndex: 20 }} onClick={close}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, width: "100%", maxHeight: "92%", borderRadius: "20px 20px 0 0", padding: "14px 16px 18px", overflowY: "auto", fontFamily: fontStack }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 600, color: C.ink }}>{back && <button onClick={back} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.sub, padding: 0 }}><ChevronRight size={20} /></button>}{title}</span>
          <button onClick={close} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><X size={20} /></button>
        </div>
        {step === "method" && (
          <>
            {[{ ic: Barcode, t: "סריקת ברקוד", s: "המדויק ביותר", tag: "מומלץ", tagBg: C.brandBg, tagC: C.brandD, go: () => pickFood(FOOD_BY_ID["cot"], 100) },
              { ic: Search, t: "חיפוש מזון", s: "מהמאגר ומההיסטוריה", go: () => setStep("list") },
              { ic: Camera, t: "צילום ארוחה", s: "המהיר ביותר", tag: "מהיר", tagBg: C.infoBg, tagC: C.info, go: () => setStep("photo") },
              { ic: Mic, t: "ספרי לי מה אכלת", s: "בדיבור או בכתיבה (AI)", tag: "חדש", tagBg: C.infoBg, tagC: C.info, go: () => setStep("ai") }].map((o) => (
              <div key={o.t} onClick={o.go} style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${C.line}`, borderRadius: 14, padding: 14, marginBottom: 10, cursor: "pointer" }}>
                <o.ic size={26} color={C.brand} />
                <div style={{ flex: 1 }}><div style={{ fontSize: 14, fontWeight: 500, color: C.ink }}>{o.t}</div><div style={{ fontSize: 11, color: C.sub }}>{o.s}</div></div>
                {o.tag && <span style={{ fontSize: 10, background: o.tagBg, color: o.tagC, padding: "3px 9px", borderRadius: 7 }}>{o.tag}</span>}
              </div>
            ))}
            <div style={{ fontSize: 11, color: C.faint, background: C.bg, padding: 10, borderRadius: 10, lineHeight: 1.6, display: "flex", gap: 6 }}><Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>ברקוד וחיפוש מדויקים יותר מצילום. בצילום נאשר את הכמות יחד.</span></div>
          </>
        )}
        {step === "list" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px", marginBottom: 12, color: C.faint }}>
              <Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש מזון…" style={{ border: "none", outline: "none", fontSize: 13, width: "100%", fontFamily: fontStack, color: C.ink, background: "transparent" }} />
            </div>
            <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
              {MEALS.map((m) => (<span key={m} onClick={() => setMeal(m)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 16, cursor: "pointer", background: m === meal ? C.ink : "transparent", color: m === meal ? "#fff" : C.sub, boxShadow: m === meal ? "none" : `inset 0 0 0 1px ${C.line}` }}>{m}</span>))}
            </div>
            {!query && <div style={{ fontSize: 11, color: C.faint, margin: "10px 0 2px" }}>אחרונים</div>}
            {(query ? filtered : RECENT.map((r) => ({ ...FOOD_BY_ID[r.foodId], lastG: r.g }))).map((f) => {
              const g = f.lastG ?? f.measures[f.def].g;
              const n = nutritionFor(f, g);
              return (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                  <div onClick={() => pickFood(f, g)} style={{ cursor: "pointer", flex: 1 }}><div style={{ fontSize: 13, fontWeight: 500, color: C.ink }}>{f.name}</div><div style={{ fontSize: 10, color: C.faint }}>{g} ג׳ · {n.kcal} קק״ל</div></div>
                  <button onClick={() => commit({ meal, name: f.name, g, source: "verified", ...n })} style={{ width: 30, height: 30, border: "none", borderRadius: 8, background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} /></button>
                </div>
              );
            })}
            <div style={{ fontSize: 10, color: C.faint, marginTop: 10, background: C.bg, padding: 9, borderRadius: 10, display: "flex", gap: 6 }}><Zap size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>הקשה אחת מוסיפה עם הכמות האחרונה — בלי להזין שוב</span></div>
          </>
        )}
        {step === "photo" && (
          <>
            {photoState === "capture" && (
              <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.brandBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}><Camera size={32} color={C.brand} /></div>
                <div style={{ fontSize: 14, fontWeight: 500, color: C.ink, marginBottom: 6 }}>צלמי את הצלחת</div>
                <p style={{ fontSize: 12, color: C.sub, lineHeight: 1.6, margin: "0 0 16px" }}>נזהה את הפריטים ונעריך עבורך ערכים תזונתיים. אפשר לאשר ולתקן אחר כך.</p>
                <label style={{ display: "block" }}>
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: "none" }} />
                  <span style={{ display: "block", background: C.brand, color: "#fff", borderRadius: 12, padding: 12, fontSize: 14, fontWeight: 500, cursor: "pointer" }}>פתחי מצלמה / בחרי תמונה</span>
                </label>
                <div style={{ fontSize: 10, color: C.faint, marginTop: 12, lineHeight: 1.6 }}>הניתוח מבוצע ע״י בינה מלאכותית — ייתכן שתתבקשי להתחבר ל-Claude.</div>
              </div>
            )}
            {photoState === "analyzing" && (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <Loader size={30} color={C.brand} className="spin" />
                <div style={{ fontSize: 14, color: C.ink, marginTop: 14 }}>מזהה את הארוחה…</div>
                <div style={{ fontSize: 11, color: C.faint, marginTop: 4 }}>רגע אחד</div>
              </div>
            )}
            {(photoState === "result" || photoState === "error") && photoResult && (
              <>
                {photoState === "error" && <div style={{ fontSize: 11, color: C.amber, background: C.amberBg, padding: 9, borderRadius: 9, marginBottom: 10, lineHeight: 1.6 }}>לא הצלחנו לנתח את התמונה כעת — מוצגת דוגמה לצורך ההדגמה.</div>}
                <div style={{ fontSize: 11, color: C.sub, marginBottom: 10 }}>זוהו הפריטים הבאים. בדקי ותקני במידת הצורך:</div>
                {photoResult.map((it, i) => (
                  <div key={i} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, marginBottom: 8 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: 13, fontWeight: 500, color: C.ink, display: "flex", gap: 6, alignItems: "center" }}>{it.name} <SrcBadge source="estimated" /></span><span style={{ fontSize: 12, color: C.sub }}>{it.grams} ג׳ · {it.kcal} קק״ל</span></div>
                  </div>
                ))}
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "10px 0", borderTop: `1px solid ${C.line}`, marginTop: 4 }}><span style={{ color: C.sub }}>סך הכל (הערכה)</span><span style={{ fontWeight: 600, color: C.ink }}>~{photoResult.reduce((s, it) => s + it.kcal, 0)} קק״ל</span></div>
                <div style={{ marginTop: 8 }}><Btn onClick={() => commit(photoResult.map((it) => ({ meal: "צהריים", name: it.name, g: it.grams, source: "estimated", kcal: it.kcal, p: it.p, f: it.f, c: it.c })))}><Check size={15} style={{ verticalAlign: -2, marginLeft: 4 }} /> אשרי והוסיפי ליומן</Btn></div>
              </>
            )}
          </>
        )}
        {step === "ai" && (
          <div style={{ display: "flex", flexDirection: "column", height: 380 }}>
            <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
              {aiMsgs.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-start" : "flex-end", marginBottom: 8 }}>
                  <div style={{ maxWidth: "82%", fontSize: 13, lineHeight: 1.5, padding: "9px 12px", borderRadius: 14, background: m.role === "user" ? C.brand : C.bg, color: m.role === "user" ? "#fff" : C.ink }}>{m.text}</div>
                </div>
              ))}
              {aiLoading && <div style={{ display: "flex", justifyContent: "flex-end" }}><div style={{ fontSize: 13, padding: "9px 12px", borderRadius: 14, background: C.bg, color: C.faint }}>כותבת…</div></div>}
              {aiDoneItems && (
                <div style={{ border: `1px solid ${C.brand}`, borderRadius: 12, padding: 10, marginTop: 6 }}>
                  {aiDoneItems.map((it, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                      <span style={{ fontSize: 13, color: C.ink, display: "flex", gap: 6, alignItems: "center" }}>{it.name} <SrcBadge source="estimated" /></span>
                      <span style={{ fontSize: 12, color: C.sub }}>{it.grams} ג׳ · {it.kcal} קק״ל</span>
                    </div>
                  ))}
                  <div style={{ marginTop: 10 }}><Btn onClick={() => commit(aiDoneItems.map((it) => ({ meal: "נשנושים", name: it.name, g: it.grams, source: "estimated", kcal: it.kcal, p: it.p, f: it.f, c: it.c })))}><Check size={15} style={{ verticalAlign: -2, marginLeft: 4 }} /> אשרי והוסיפי ליומן</Btn></div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
              <button onClick={startMic} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: C.brandBg, color: C.brand, cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}><Mic size={18} /></button>
              <input value={aiInput} onChange={(e) => setAiInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendAi()} placeholder="כתבי מה אכלת…" style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: 20, padding: "10px 14px", fontSize: 13, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box" }} />
              <button onClick={() => sendAi()} disabled={aiLoading} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: C.brand, color: "#fff", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: aiLoading ? 0.5 : 1 }}><Send size={18} /></button>
            </div>
            <div style={{ fontSize: 10, color: C.faint, marginTop: 8, textAlign: "center" }}>מיקרופון עובד בדפדפן תומך / בטלפון. כאן בתצוגה אפשר גם להקליד.</div>
          </div>
        )}
        {step === "qty" && food && (
          <>
            {!state.editEntry && (
              <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>{MEALS.map((m) => (<span key={m} onClick={() => setMeal(m)} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 16, cursor: "pointer", background: m === meal ? C.ink : "transparent", color: m === meal ? "#fff" : C.sub, boxShadow: m === meal ? "none" : `inset 0 0 0 1px ${C.line}` }}>{m}</span>))}</div>
            )}
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>מידת בית</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>{food.measures.map((ms) => (<span key={ms.label} onClick={() => setGrams(ms.g)} style={{ fontSize: 12, padding: "6px 11px", borderRadius: 8, cursor: "pointer", background: grams === ms.g ? C.brandBg : "transparent", color: grams === ms.g ? C.brandD : C.sub, boxShadow: grams === ms.g ? `inset 0 0 0 1px ${C.brand}` : `inset 0 0 0 1px ${C.line}` }}>{ms.label}{ms.label !== "100 ג׳" ? ` · ${ms.g} ג׳` : ""}</span>))}</div>
            <div style={{ fontSize: 11, color: C.sub, marginBottom: 6 }}>או כמות מדויקת</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}>
              <button onClick={() => setGrams(Math.max(5, grams - 10))} style={{ width: 36, height: 36, border: `1px solid ${C.line}`, borderRadius: 9, background: C.panel, cursor: "pointer", fontSize: 18, color: C.ink }}>−</button>
              <div style={{ minWidth: 70, textAlign: "center" }}><span style={{ fontSize: 22, fontWeight: 600, color: C.ink }}>{grams}</span> <span style={{ fontSize: 12, color: C.sub }}>ג׳</span></div>
              <button onClick={() => setGrams(grams + 10)} style={{ width: 36, height: 36, border: `1px solid ${C.line}`, borderRadius: 9, background: C.panel, cursor: "pointer", fontSize: 18, color: C.ink }}>+</button>
            </div>
            <div style={{ background: C.bg, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 8 }}><span style={{ color: C.sub }}>קלוריות</span><span style={{ fontWeight: 600, color: C.ink }}>{nut.kcal} קק״ל</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.sub }}><span>חלבון {nut.p} ג׳</span><span>שומן {nut.f} ג׳</span><span>פחמימות {nut.c} ג׳</span></div>
            </div>
            <Btn onClick={() => commit({ meal, name: food.name, g: grams, source: state.editEntry?.source || "verified", ...nut })}><Check size={15} style={{ verticalAlign: -2, marginLeft: 4 }} /> {state.editEntry ? "עדכן" : `הוסף ל${meal}`}</Btn>
            {state.editEntry && <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={removeAndClose} style={{ color: C.amber }}>מחק פריט</Btn></div>}
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================
   ROOT APP
   ============================================================ */
export default function App() {
  const [onboarded, setOnboarded] = useState(false);
  const [tab, setTab] = useState("home");
  const [profile, setProfile] = useState({ age: 50, heightCm: 165, weightKg: 72, activity: "בינונית", weeklyRateG: 250, goalWeightKg: 66, returnPct: 50, startDate: sundayOf(TODAY) });
  const [log, setLog] = useState(INITIAL_LOG);
  const [weights, setWeights] = useState(makeWeightSeed(72));
  const [diaryDate, setDiaryDate] = useState(TODAY);
  const [water, setWater] = useState(5);
  const [modal, setModal] = useState(null);
  const [showIntro, setShowIntro] = useState(true);
  const [notes, setNotes] = useState([]);
  const activity = { steps: 8420, stepsKcal: 220, workoutKcal: 180 };

  const targets = useMemo(() => computeTargets(profile), [profile]);
  const todayLog = log.filter((e) => e.date === TODAY);
  const programWeek = programWeekFor(profile.startDate, TODAY);

  const finishOnboarding = (p) => { setProfile(p); setWeights(makeWeightSeed(p.weightKg)); setOnboarded(true); };
  const openAdd = (preMeal) => setModal({ preMeal, editEntry: null });
  const editEntry = (e) => setModal({ preMeal: null, editEntry: e });
  const deleteEntry = (id) => setLog((l) => l.filter((e) => e.id !== id));
  const commit = (payload) => {
    const date = modal?.editEntry ? modal.editEntry.date : (tab === "diary" ? diaryDate : TODAY);
    if (modal?.editEntry) setLog((l) => l.map((e) => e.id === modal.editEntry.id ? { ...e, ...payload, date } : e));
    else { const items = Array.isArray(payload) ? payload : [payload]; setLog((l) => [...l, ...items.map((p, i) => ({ id: "n" + Date.now() + i, date, ...p }))]); }
    setModal(null);
  };
  const addRecipe = (r) => { setLog((l) => [...l, { id: "n" + Date.now(), date: TODAY, meal: "צהריים", name: r.name, g: 1, source: "verified", kcal: r.kcal, p: r.p, f: r.f, c: r.c }]); setTab("home"); };
  const addWeight = () => { const last = weights[weights.length - 1].kg; const v = Math.round((last - 0.2) * 10) / 10; setWeights((w) => [...w.filter((x) => x.date !== TODAY), { date: TODAY, kg: v }]); };
  const resetDemo = () => {
    setOnboarded(false); setShowIntro(true); setTab("home");
    setLog(INITIAL_LOG); setWater(5); setWeights(makeWeightSeed(72)); setDiaryDate(TODAY); setModal(null);
    setProfile({ age: 50, heightCm: 165, weightKg: 72, activity: "בינונית", weeklyRateG: 250, goalWeightKg: 66, returnPct: 50, startDate: sundayOf(TODAY) });
  };

  const tabs = [
    { id: "home", ic: Home, label: "בית" },
    { id: "diary", ic: BookOpen, label: "יומן" },
    { id: "report", ic: TrendingDown, label: "דוח" },
    { id: "recipes", ic: ChefHat, label: "מתכונים" },
    { id: "profile", ic: User, label: "פרופיל" },
  ];

  return (
    <div dir="rtl" style={{ minHeight: "100vh", background: C.bg, display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "24px 12px", fontFamily: fontStack }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:0;height:0}
        button{font-family:'Rubik',sans-serif}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{animation:spin 1s linear infinite}`}</style>
      <div style={{ width: 390, maxWidth: "100%", height: 800, background: C.panel, borderRadius: 30, boxShadow: "0 12px 40px rgba(168,66,92,0.14)", border: `1px solid ${C.line}`, overflow: "hidden", display: "flex", flexDirection: "column", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 18px 4px", fontSize: 12, color: C.faint, flexShrink: 0 }}>
          <span>9:41</span><span style={{ fontSize: 11, color: C.brandD, fontWeight: 600 }}>MyPrime · v{VERSION}</span>
        </div>
        {!onboarded ? (
          <div style={{ flex: 1, overflow: "hidden" }}><Onboarding onFinish={finishOnboarding} /></div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {tab === "home" && <HomeScreen targets={targets} todayLog={todayLog} activity={activity} profile={profile} openAdd={openAdd} water={water} setWater={setWater} />}
              {tab === "diary" && <DiaryScreen log={log} date={diaryDate} setDate={setDiaryDate} targets={targets} openAdd={openAdd} editEntry={editEntry} deleteEntry={deleteEntry} startDate={profile.startDate} />}
              {tab === "report" && <ReportScreen weights={weights} addWeight={addWeight} log={log} targets={targets} programWeek={programWeek} />}
              {tab === "recipes" && <RecipesScreen addRecipe={addRecipe} />}
              {tab === "profile" && <ProfileScreen profile={profile} setProfile={setProfile} targets={targets} onReset={resetDemo} />}
            </div>
            <div style={{ display: "flex", justifyContent: "space-around", borderTop: `1px solid ${C.line}`, padding: "9px 4px max(9px, env(safe-area-inset-bottom))", background: C.panel, flexShrink: 0 }}>
              {tabs.map((t) => {
                const active = tab === t.id;
                return (<button key={t.id} onClick={() => setTab(t.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, border: "none", background: "transparent", cursor: "pointer", color: active ? C.brand : C.faint, fontWeight: active ? 500 : 400 }}><t.ic size={21} /><span style={{ fontSize: 11 }}>{t.label}</span></button>);
              })}
            </div>
            {modal && <AddModal state={modal} close={() => setModal(null)} commit={commit} removeAndClose={() => { deleteEntry(modal.editEntry.id); setModal(null); }} />}
          </>
        )}
        {!showIntro && <NotesFab notes={notes} setNotes={setNotes} screen={onboarded ? (tabs.find((t) => t.id === tab)?.label || "") : "אונבורדינג"} />}
        {showIntro && <IntroOverlay onClose={() => setShowIntro(false)} />}
      </div>
    </div>
  );
}
