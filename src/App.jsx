import React, { useState, useMemo, useRef, useEffect } from "react";
import {
  Home, BookOpen, TrendingDown, ChefHat, User, Plus, Check, Search,
  Barcode, Camera, ChevronRight, ChevronLeft, ChevronDown, Pencil, Trash2, Minus, X,
  Footprints, Dumbbell, ArrowDownRight, Info, Zap, Target, Sparkles, Droplet,
  MessageCircle, Loader, Copy, Mic, Send, Lock, Clock, Cookie, BarChart3,
} from "lucide-react";
import { XAxis, YAxis, ResponsiveContainer, Tooltip, Area, AreaChart, BarChart, Bar, Cell, ReferenceLine } from "recharts";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { DecodeHintType, BarcodeFormat } from "@zxing/library";
import { RECIPES } from "./recipes";
import { SWEETS } from "./sweets";
import { CHECKIN_GROUPS, CHECKIN_TASKS, activeTasks } from "./checkins";

// AI requests go through a server proxy that holds the API key (see /api/ai.js).
const AI_ENDPOINT = import.meta.env.VITE_AI_ENDPOINT || "/api/ai";
// Identify the user to the server so it can enforce a per-user rate limit (cost protection).
function aiHeaders() {
  let uid = "";
  try { uid = localStorage.getItem("myprime_access_email") || ""; } catch (e) {}
  const h = { "Content-Type": "application/json" };
  if (uid) h["x-user-id"] = uid;
  return h;
}
const ACCESS_ENDPOINT = import.meta.env.VITE_ACCESS_ENDPOINT || "/api/access";
const PRIVACY_URL = import.meta.env.VITE_PRIVACY_URL || "https://myprime.co.il/%d7%9e%d7%93%d7%99%d7%a0%d7%99%d7%95%d7%aa-%d7%a4%d7%a8%d7%98%d7%99%d7%95%d7%aa/";
const COOKIE_URL = import.meta.env.VITE_COOKIE_URL || "https://myprime.co.il/%d7%9e%d7%93%d7%99%d7%a0%d7%99%d7%95%d7%aa-%d7%a7%d7%95%d7%a7%d7%99%d7%96/";
const FEEDBACK_URL = import.meta.env.VITE_FEEDBACK_URL || "";
function getDeviceId() {
  try {
    let id = localStorage.getItem("myprime_device_id");
    if (!id) { id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(16).slice(2)); localStorage.setItem("myprime_device_id", id); }
    return id;
  } catch (e) { return "nodevice"; }
}

/* ============================================================
   DOMAIN - pure logic, zero UI dependency (mirrors src/domain)
   ============================================================ */
const ACTIVITY_FACTORS = { "יושבני": 1.2, "קלה": 1.375, "בינונית": 1.55, "גבוהה": 1.725 };
const KCAL_PER_KG = 7700;
const KCAL_FLOOR = 1200;
const PROTEIN_PER_KG = 1.6;        // טווח מומלץ 1.5-1.7
const FAT_PER_KG = 0.9;
const RATE_OPTIONS = [0, 250, 500];
const UNDERWEIGHT_BMI = 18.5; // WHO: BMI<18.5 = תת-משקל
function bmiOf(kg, heightCm) { const h = (heightCm || 0) / 100; return h > 0 ? kg / (h * h) : 0; }
function minHealthyKg(heightCm) { const h = (heightCm || 0) / 100; return h > 0 ? Math.ceil(UNDERWEIGHT_BMI * h * h * 2) / 2 : 0; } // משקל מינימלי שעדיין BMI>=18.5, מעוגל ל-0.5 כלפי מעלה
const WATER_TARGET_GLASSES = 8;    // 8 כוסות = 2 ליטר
const WATER_MIN_GLASSES = 6;       // 6 כוסות = 1.5 ליטר
const WATER_TARGET_ML = 2000;      // יעד מים קבוע: 2 ליטר
const DEFAULT_CUP_ML = 250;        // גודל כוס ברירת מחדל
// מים נשמרים במ"ל. ערכים ישנים נשמרו כספירת כוסות (<= ~8); ממירים בקריאה (כוס = 250 מ"ל).
function waterMlOf(v) { if (v == null) return 0; return v < 50 ? Math.round(v * 250) : v; }

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
  // Sedentary baseline for everyone: the app adds steps + logged activity to the
  // daily budget separately, so a higher multiplier would double-count movement.
  // (No activity selector is exposed; this intentionally ignores any stored
  // profile.activity, so legacy profiles update without needing a reset.)
  const tdee = bmr * ACTIVITY_FACTORS["יושבני"];
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
// Estimated calories burned from steps, scaled by body weight (~0.04 kcal/step at 70kg).
function stepsKcal(steps, weightKg) {
  return Math.round((steps || 0) * 0.00055 * (weightKg || 70));
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
  const k = (Number(grams) || 0) / 100;
  const p100 = (food && food.per100) || {};
  return {
    kcal: Math.round((Number(p100.kcal) || 0) * k),
    p: Math.round((Number(p100.p) || 0) * k),
    f: Math.round((Number(p100.f) || 0) * k),
    c: Math.round((Number(p100.c) || 0) * k),
  };
}
function unitLabelFor(unit) { return unit === "ml" ? "מ\"ל" : "ג׳"; }
function measuresForUnit(unit) {
  return unit === "ml"
    ? [{ label: "כוס", g: 250 }, { label: "כף", g: 15 }, { label: "כפית", g: 5 }, { label: "פחית", g: 330 }, { label: "חצי ליטר", g: 500 }, { label: "בקבוק גדול", g: 1500 }]
    : [{ label: "100 ג׳", g: 100 }, { label: "כף", g: 15 }, { label: "כפית", g: 5 }, { label: "מנה קטנה", g: 80 }, { label: "מנה בינונית", g: 150 }, { label: "מנה גדולה", g: 250 }];
}
function foodFromEntry(e) {
  const g = e.g || 100;
  const per100 = { kcal: (e.kcal || 0) / g * 100, p: (e.p || 0) / g * 100, f: (e.f || 0) / g * 100, c: (e.c || 0) / g * 100 };
  const unit = e.unit === "ml" ? "ml" : "g";
  return { name: e.name, per100, unit, measures: measuresForUnit(unit) };
}
function activityBonus(stepsKcal, workoutKcal, returnPct) {
  return Math.round((stepsKcal + workoutKcal) * (returnPct / 100));
}

/* ============================================================
   SEED DATA
   ============================================================ */
const FOODS = [
  { id: "yog", name: "יוגורט יווני 5%", search: "יוגורט", per100: { kcal: 90, p: 9, f: 5, c: 4 }, measures: [{ label: "כף", g: 20 }, { label: "מיכל", g: 150 }, { label: "כוס", g: 245 }, { label: "100 ג׳", g: 100 }], def: 1 },
  { id: "ban", name: "בננה בינונית", search: "בננה בננות פרי", per100: { kcal: 89, p: 1.1, f: 0.3, c: 23 }, measures: [{ label: "יחידה", g: 118 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "chk", name: "חזה עוף בגריל", search: "עוף חזה פרגית", per100: { kcal: 165, p: 31, f: 3.6, c: 0 }, measures: [{ label: "מנה", g: 120 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "rice", name: "אורז לבן מבושל", search: "אורז", per100: { kcal: 130, p: 2.7, f: 0.3, c: 28 }, measures: [{ label: "כוס", g: 158 }, { label: "100 ג׳", g: 100 }], def: 1 },
  { id: "sal", name: "סלט ירקות", search: "סלט ירקות", per100: { kcal: 30, p: 1.3, f: 0.2, c: 6 }, measures: [{ label: "מנה", g: 150 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "cot", name: "קוטג׳ 5%", search: "קוטג גבינה", per100: { kcal: 98, p: 11, f: 5, c: 3 }, measures: [{ label: "מנה", g: 100 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "oat", name: "שיבולת שועל", search: "שיבולת שועל קוואקר דייסה", per100: { kcal: 380, p: 13, f: 7, c: 67 }, measures: [{ label: "מנה", g: 60 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "cof", name: "קפה עם חלב", search: "קפה הפוך", per100: { kcal: 40, p: 2, f: 1.5, c: 4 }, measures: [{ label: "כוס", g: 150 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "egg", name: "ביצה גדולה", search: "ביצים ביצה חביתה", per100: { kcal: 143, p: 13, f: 10, c: 1 }, measures: [{ label: "יחידה", g: 50 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "bread", name: "לחם פרוס", search: "לחם פרוסה טוסט", per100: { kcal: 265, p: 9, f: 3.2, c: 49 }, measures: [{ label: "פרוסה", g: 28 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "pita", name: "פיתה", search: "פיתה לחם", per100: { kcal: 275, p: 9, f: 1.2, c: 55 }, measures: [{ label: "פיתה", g: 60 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "pasta", name: "פסטה מבושלת", search: "פסטה מקרוני ספגטי", per100: { kcal: 158, p: 5.8, f: 0.9, c: 31 }, measures: [{ label: "כוס", g: 140 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "beef", name: "בשר בקר רזה", search: "בקר בשר סטייק", per100: { kcal: 250, p: 26, f: 15, c: 0 }, measures: [{ label: "מנה", g: 120 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "salmon", name: "סלמון אפוי", search: "סלמון דג", per100: { kcal: 206, p: 22, f: 13, c: 0 }, measures: [{ label: "מנה", g: 140 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "tuna", name: "טונה במים", search: "טונה דג", per100: { kcal: 116, p: 26, f: 1, c: 0 }, measures: [{ label: "קופסה", g: 140 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "wcheese", name: "גבינה לבנה 5%", search: "גבינה לבנה", per100: { kcal: 90, p: 9, f: 5, c: 4 }, measures: [{ label: "כף", g: 30 }, { label: "100 ג׳", g: 100 }], def: 1 },
  { id: "ycheese", name: "גבינה צהובה 28%", search: "גבינה צהובה", per100: { kcal: 350, p: 25, f: 28, c: 1 }, measures: [{ label: "פרוסה", g: 25 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "milk", name: "חלב 3%", search: "חלב", per100: { kcal: 60, p: 3.3, f: 3, c: 4.7 }, measures: [{ label: "כוס", g: 240 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "apple", name: "תפוח עץ", search: "תפוח פרי", per100: { kcal: 52, p: 0.3, f: 0.2, c: 14 }, measures: [{ label: "יחידה", g: 180 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "cuke", name: "מלפפון", search: "מלפפון ירק", per100: { kcal: 15, p: 0.7, f: 0.1, c: 3.6 }, measures: [{ label: "יחידה", g: 120 }, { label: "100 ג׳", g: 100 }], def: 1 },
  { id: "tomato", name: "עגבניה", search: "עגבניה עגבניות ירק", per100: { kcal: 18, p: 0.9, f: 0.2, c: 3.9 }, measures: [{ label: "יחידה", g: 120 }, { label: "100 ג׳", g: 100 }], def: 1 },
  { id: "avocado", name: "אבוקדו", search: "אבוקדו", per100: { kcal: 160, p: 2, f: 15, c: 9 }, measures: [{ label: "חצי", g: 100 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "tahini", name: "טחינה גולמית", search: "טחינה", per100: { kcal: 595, p: 17, f: 53, c: 21 }, measures: [{ label: "כף", g: 15 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "hummus", name: "חומוס (ממרח)", search: "חומוס", per100: { kcal: 177, p: 8, f: 10, c: 14 }, measures: [{ label: "כף", g: 30 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "almond", name: "שקדים", search: "שקדים אגוזים", per100: { kcal: 579, p: 21, f: 50, c: 22 }, measures: [{ label: "חופן", g: 30 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "potato", name: "תפוח אדמה מבושל", search: "תפוח אדמה תפוד", per100: { kcal: 87, p: 2, f: 0.1, c: 20 }, measures: [{ label: "בינוני", g: 150 }, { label: "100 ג׳", g: 100 }], def: 0 },
  { id: "lentil", name: "עדשים מבושלות", search: "עדשים קטניות", per100: { kcal: 116, p: 9, f: 0.4, c: 20 }, measures: [{ label: "כוס", g: 198 }, { label: "100 ג׳", g: 100 }], def: 0 },
];
const FOOD_BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f]));
const RECENT = [
  { foodId: "yog", g: 150 }, { foodId: "ban", g: 118 }, { foodId: "cof", g: 150 },
  { foodId: "chk", g: 120 }, { foodId: "oat", g: 60 }, { foodId: "cot", g: 100 },
];
const MEALS = ["בוקר", "ביניים בוקר", "צהריים", "ביניים אחה״צ", "ערב", "נשנושים"];
const HE_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const HE_DAYS_FULL = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];
function lerpHex(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const r = pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.max(0, Math.min(1, t))));
  return "#" + r.map((v) => v.toString(16).padStart(2, "0")).join("");
}
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
const DEV = (() => { try { return new URLSearchParams(window.location.search).has("dev"); } catch (e) { return false; } })();
const TODAY = (() => {
  try {
    if (DEV) {
      const o = window.localStorage.getItem("myprime_dev_today");
      if (o && /^\d{4}-\d{2}-\d{2}$/.test(o)) return o; // dev-only simulated "today"
    }
  } catch (e) {}
  return ymd(new Date());
})();
function sundayOf(dateStr) { const d = new Date(dateStr); d.setDate(d.getDate() - d.getDay()); return ymd(d); }
function listSundays() {
  const base = sundayOf(TODAY);
  const out = [];
  for (let i = -8; i <= 0; i++) {
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
function programDayNumber(startDate, onDate) {
  if (!startDate) return 1;
  return Math.floor((new Date(onDate) - new Date(startDate)) / 86400000) + 1;
}
function unlockedOn(startDate, onDate, u) {
  return programDayNumber(startDate, onDate) >= (u.week - 1) * 7 + u.day;
}
const MACRO_UNLOCK = { week: 3, day: 4 };
const WATER_UNLOCK = { week: 3, day: 2 };
const SWEETS_UNLOCK = { week: 3, day: 5 };
const STEPS_UNLOCK = { week: 1, day: 2 };
const FIBER_TARGET = 25;
const DIET_OPTIONS = [
  { id: "הכל", emoji: "🍽️" },
  { id: "צמחוני", emoji: "🥗" },
  { id: "צמחוני + דגים", emoji: "🐟" },
  { id: "טבעוני", emoji: "🌱" },
  { id: "כשר", emoji: "✡️" },
  { id: "דל פחמימה", emoji: "🥑" },
  { id: "ים-תיכוני", emoji: "🫒" },
];
const SENSITIVITY_OPTIONS = ["גלוטן", "חלב / לקטוז", "ביצים", "אגוזים", "בוטנים", "סויה", "דגים", "שומשום"];
const WANT_OPTIONS = [{ id: "ארוחה מלאה", emoji: "🍽️" }, { id: "משהו קל", emoji: "🥗" }, { id: "חטיף", emoji: "🍎" }, { id: "משקה", emoji: "🥤" }];
// Day of week for a date: 1=ראשון(Sun) .. 6=שישי(Fri), 0=שבת(Sat, rest day).
function dowOf(dateStr) { const g = new Date(dateStr).getDay(); return g === 6 ? 0 : g + 1; }
// Baseline = her average daily steps over week 1 (measured from day 2 onward).
function stepBaseline(stepsByDate, startDate) {
  let sum = 0, n = 0;
  // Week-1 days 2..7 (Mon..Sat). Saturday (day 7) is included if she logged it - some fill it, some don't.
  for (let d = 2; d <= 7; d++) { const s = (stepsByDate && stepsByDate[addDays(startDate, d - 1)]) || 0; if (s > 0) { sum += s; n++; } }
  return n ? Math.ceil(sum / n / 100) * 100 : null;
}
// Cumulative step-goal offset above baseline: +2000 (w2-3), +4000 (w4-5), +5000 (w6-7), +6000 (w8+).
function stepGoalCumOffset(week) { return week >= 8 ? 6000 : week >= 6 ? 5000 : week >= 4 ? 4000 : week >= 2 ? 2000 : 0; }
// Single source of truth for the daily step goal shown everywhere (day ring, report, profile).
// null = still measuring (week 1, or no baseline data yet).
function effectiveStepGoal(stepGoal, week) {
  return week < 2 ? null : (stepGoal != null ? stepGoal : null);
}
// 7-day rolling average of daily steps ending at `date` (only days with data; week 1: from when she started).
function steps7avg(stepsByDate, date) {
  let sum = 0, n = 0;
  for (let i = 0; i < 7; i++) { const s = (stepsByDate && stepsByDate[addDays(date, -i)]) || 0; if (s > 0) { sum += s; n++; } }
  return n ? Math.round(sum / n) : 0;
}
// Same rolling window, but also returns how many days actually had data (for the "ממוצע N ימים" label, capped at 7).
function steps7stats(stepsByDate, date) {
  let sum = 0, n = 0;
  for (let i = 0; i < 7; i++) { const s = (stepsByDate && stepsByDate[addDays(date, -i)]) || 0; if (s > 0) { sum += s; n++; } }
  return { avg: n ? Math.round(sum / n) : 0, n };
}
// Detect the phone platform so we can show the matching health-app guide.
function detectPlatform() {
  if (typeof navigator === "undefined") return "other";
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  return "other";
}
// PDF guides for finding the step count in the phone's health app.
// OWNER: drop the two PDFs in /public/guides and fill the paths (or external URLs). Empty string = link hidden.
// In-app step guides: the two instruction images per platform (shown inside the app, no external link).
// OWNER: drop the 4 images in /public/guides. Empty images array = guide hidden for that platform.
const STEP_GUIDES = {
  ios: { app: "Apple Health", images: ["/guides/apple-1.png", "/guides/apple-2.png"] },
  android: { app: "Samsung Health", images: ["/guides/samsung-1.png", "/guides/samsung-2.png"] },
};
// The guide for the current device. No cross-platform fallback - an iPhone must never get the Samsung guide.
function currentStepGuide() {
  const g = STEP_GUIDES[detectPlatform()];
  return g && g.images && g.images.length ? g : null;
}
// Free pedometer apps for women who do not have the built-in health app (e.g. non-Samsung Android) or are on another device.
const STEP_APPS = {
  android: { name: "Pedometer - Step Counter", url: "https://play.google.com/store/apps/details?id=pedometer.steptracker.calorieburner.stepcounter" },
  ios: { name: "StepsApp", url: "https://apps.apple.com/il/app/stepsapp-pedometer/id1037595083" },
};
function stepAppFor(platform) { return STEP_APPS[platform] || null; }
// Sundays when the running goal goes up, and by how much.
const STEP_BUMP_WEEKS = { 2: 2000, 4: 2000, 6: 1000, 8: 1000 };
function highestBumpAtOrBelow(week) { let h = 0; for (const w of [2, 4, 6, 8]) if (w <= week) h = w; return h; }
// What step-goal action is pending for this week: set the baseline (first time), or accept an increase.
function pendingStepAction(profile, week, ackWeek) {
  if (week < 2) return null;
  if (profile.stepBaseline == null) return { kind: "baseline" };
  for (const w of [4, 6, 8]) if (w <= week && w > ackWeek) return { kind: "increase", week: w, inc: STEP_BUMP_WEEKS[w] };
  return null;
}

/* ============================================================
   DAILY PROGRESS TRACKER (check-in module)
   ============================================================ */
// Master switch - set to false to hide the whole tracker everywhere.
const TRACKER_ENABLED = true;
// Show the fat/carbs/fiber strip under the rings. Off for now (kept for future).
const SHOW_MACRO_STRIP = false;
const CHECKIN_UNLOCK = { week: 1, day: 3 };   // starts on day 3 of week 1
const CHECKIN_REVEAL_HOUR = 0;                // 0 = daily report available all day (set to 19 to lock until 19:00)
const MEDAL_SRC = "/medal.png";
function trophyForWeek(w) {
  if (w >= 10) return "/medals/trophy-champion.webp";
  return "/medals/trophy-" + Math.max(1, Math.min(9, w)) + ".webp";
}
// Pulls the values the app already tracks so she is not asked twice.
function autoStatusFor(date, stepsByDate, waterByDate, log, targets, cupMl) {
  const steps = (stepsByDate && stepsByDate[date]) || 0;
  const cups = Math.round((waterMlOf(waterByDate ? waterByDate[date] : 0) / (cupMl || DEFAULT_CUP_ML)) * 10) / 10;
  const dayLog = (log || []).filter((e) => e.date === date);
  const proteinHad = dayLog.reduce((s, e) => s + (e.p || 0), 0);
  return {
    steps: steps > 0 ? steps : null,
    water: cups > 0 ? cups : null,
    journal: dayLog.length > 0,
    protein: !!(targets && targets.protein && proteinHad >= targets.protein * 0.95),
  };
}
// A day is auto-marked complete (_done) by an effect in App the moment every
// active task is done - no button. _done also drives the medal/trophy counts.
// Whether a task reads as "done" (a positive, for the warm count).
function taskDone(task, answers, auto) {
  if (task.auto) {
    if (task.auto === "steps") return auto.steps != null;
    if (task.auto === "water") return auto.water != null;
    if (task.auto === "journal") return auto.journal;
    if (task.auto === "protein") return auto.protein;
  }
  const v = answers[task.id];
  if (task.type === "number") return v != null && v > 0;
  return v === true;
}
// Tasks shown for a given date. Saturday (dow 0): rest for Shabbat-keepers (none),
// otherwise the same daily tasks as the Friday before it (activeTasks for dow 6).
function tasksForDate(startDate, date, keepShabbat, fasting) {
  const wk = Math.min(programWeekFor(startDate, date), 10);
  const dw = dowOf(date);
  let list = dw === 0 ? (keepShabbat ? [] : activeTasks(wk, 6)) : activeTasks(wk, dw);
  if (!fasting) list = list.filter((t) => t.id !== "fasting"); // fasting shows only if she opted in
  return list;
}
// A day is complete (earns a medal) when every REQUIRED active task is done - automatically,
// no "I finished" button needed. Optional tasks (e.g. fasting) never block completion.
function dayComplete(startDate, date, keepShabbat, checkins, stepsByDate, waterByDate, log, targets, cupMl) {
  if (!TRACKER_ENABLED) return false;
  if (!unlockedOn(startDate, date, CHECKIN_UNLOCK)) return false;
  const ts = tasksForDate(startDate, date, keepShabbat).filter((t) => !t.optional);
  if (!ts.length) return false;
  const ans = (checkins && checkins[date]) || {};
  const au = autoStatusFor(date, stepsByDate, waterByDate, log, targets, cupMl);
  return ts.every((t) => taskDone(t, ans, au));
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
function initWeights(currentKg, startDate) {
  return [{ date: startDate, kg: Math.round(currentKg * 10) / 10 }];
}

/* ============================================================
   THEME - feminine rose palette
   ============================================================ */
const C = {
  bg: "#FAF3F4", panel: "#FFFFFF", ink: "#3A2B30", sub: "#8B737A", faint: "#BBA7AC",
  line: "#F1E4E7",
  brand: "#D45D79", brandD: "#A8425C", brandBg: "#FBE9EE",
  macroP: "#7E4FB5", proteinTrack: "#EBE1F7", macroF: "#E0986A", macroC: "#A87BB5",
  amber: "#C77A3C", amberBg: "#FBEEDF",
  info: "#9C6BA6", infoBg: "#F2E7F3",
  water: "#7E8DD6", waterBg: "#EBEDF8",
};
const fontStack = "'Rubik', system-ui, sans-serif";
const VERSION = "2.08";
const STORAGE_KEY = "myprime_demo_state_v1";

/* ============================================================
   ENCRYPTED CLOUD BACKUP (end-to-end)
   The user's data is encrypted IN THE BROWSER with a key derived from her
   personal backup code (PBKDF2 -> AES-GCM). The server (Upstash) stores ONLY
   ciphertext + salt + iv. The code never leaves the device, so no one - not
   even MyPrime - can read the data. The code is kept in its own localStorage
   key so it is NOT part of the (backed-up) app state blob.
   ============================================================ */
const BK_CODE_KEY = "myprime_bk_code";
const BK_LAST_KEY = "myprime_bk_last";
const bkSubtle = (typeof window !== "undefined" && window.crypto && window.crypto.subtle) ? window.crypto.subtle : null;
function bkGetCode() { try { return localStorage.getItem(BK_CODE_KEY) || ""; } catch (e) { return ""; } }
function bkSetCode(code) { try { if (code) localStorage.setItem(BK_CODE_KEY, code); else localStorage.removeItem(BK_CODE_KEY); } catch (e) {} }
function bkB64(buf) { let s = ""; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
function bkUnb64(str) { const s = atob(str); const b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b; }
async function bkDeriveKey(code, salt) {
  const base = await bkSubtle.importKey("raw", new TextEncoder().encode(code), { name: "PBKDF2" }, false, ["deriveKey"]);
  return bkSubtle.deriveKey({ name: "PBKDF2", salt, iterations: 150000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function bkEncrypt(code, plaintext) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await bkDeriveKey(code, salt);
  const ct = await bkSubtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext));
  return { ct: bkB64(ct), salt: bkB64(salt), iv: bkB64(iv), v: 1 };
}
async function bkDecrypt(code, blob) {
  const key = await bkDeriveKey(code, bkUnb64(blob.salt));
  const pt = await bkSubtle.decrypt({ name: "AES-GCM", iv: bkUnb64(blob.iv) }, key, bkUnb64(blob.ct));
  return new TextDecoder().decode(pt);
}
async function bkUpload(email, code, plaintext) {
  if (!bkSubtle) return false;
  const blob = await bkEncrypt(code, plaintext);
  const r = await fetch("/api/backup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, blob }) });
  if (!r.ok) return false;
  const d = await r.json().catch(() => ({}));
  return !!d.ok;
}
async function bkFetch(email) {
  try { const r = await fetch(`/api/backup?email=${encodeURIComponent(email)}`); if (!r.ok) return { exists: false }; return await r.json(); }
  catch (e) { return { exists: false }; }
}

/* ============================================================
   PRIMITIVES
   ============================================================ */
function Ring({ consumed, budget, size = 132, onPlus }) {
  const r = 54, circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, budget > 0 ? consumed / budget : 0));
  const remaining = Math.round(budget - consumed);
  const over = remaining < 0;
  const svg = (
    <svg width={size} height={size} viewBox="0 0 132 132">
      <circle cx="66" cy="66" r={r} fill="none" stroke={C.line} strokeWidth="10" />
      <circle cx="66" cy="66" r={r} fill="none" stroke={over ? C.amber : C.brand} strokeWidth="10"
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)}
        transform="rotate(-90 66 66)" style={{ transition: "stroke-dashoffset .5s ease" }} />
      <text x="66" y="40" textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 600, fill: C.sub }}>צרכת</text>
      <text x="66" y="64" textAnchor="middle" style={{ fontSize: 26, fontWeight: 700, fill: C.ink }}>{Math.round(consumed).toLocaleString()}</text>
      <text x="66" y="83" textAnchor="middle" style={{ fontSize: 14.5, fontWeight: 700, fill: over ? C.amber : C.brand }}>קלוריות</text>
      <text x="66" y="97" textAnchor="middle" style={{ fontSize: 11, fill: over ? C.amber : C.sub }}>{over ? `מעל היעד (${Math.round(budget).toLocaleString()})` : `מתוך ${Math.round(budget).toLocaleString()}`}</text>
    </svg>
  );
  if (!onPlus) return svg;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      {svg}
      <button onClick={onPlus} aria-label="הוספה לתקציב" style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 30, height: 30, borderRadius: "50%", background: C.brand, color: "#fff", border: `2px solid ${C.panel}`, boxShadow: "0 2px 6px rgba(0,0,0,0.18)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={17} /></button>
    </div>
  );
}
function ProteinRing({ consumed, target, size = 124 }) {
  const r = 54, circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, target > 0 ? consumed / target : 0));
  const eaten = Math.round(consumed);
  const done = target > 0 && consumed >= target;
  return (
    <svg width={size} height={size} viewBox="0 0 132 132">
      <circle cx="66" cy="66" r={r} fill="none" stroke={C.proteinTrack} strokeWidth="10" />
      <circle cx="66" cy="66" r={r} fill="none" stroke={C.macroP} strokeWidth="10"
        strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)}
        transform="rotate(-90 66 66)" style={{ transition: "stroke-dashoffset .5s ease" }} />
      <text x="66" y="40" textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 600, fill: C.sub }}>צרכת</text>
      <text x="66" y="64" textAnchor="middle" style={{ fontSize: 26, fontWeight: 700, fill: C.ink }}>{eaten}<tspan style={{ fontSize: 14, fill: C.sub }}> ג׳</tspan></text>
      <text x="66" y="83" textAnchor="middle" style={{ fontSize: 14.5, fontWeight: 700, fill: C.macroP }}>חלבון</text>
      <text x="66" y="97" textAnchor="middle" style={{ fontSize: 11, fill: C.sub }}>{done ? "הגעת ליעד!" : `מתוך ${Math.round(target)}`}</text>
    </svg>
  );
}
function MetricRing({ value, goal, color, track, label, sub, onPlus, size = 130, bigText, verb }) {
  const r = 54, circ = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, goal > 0 ? value / goal : 0));
  const done = goal > 0 && value >= goal;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 132 132">
        <circle cx="66" cy="66" r={r} fill="none" stroke={track} strokeWidth="10" />
        <circle cx="66" cy="66" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)}
          transform="rotate(-90 66 66)" style={{ transition: "stroke-dashoffset .5s ease" }} />
        {verb && <text x="66" y="40" textAnchor="middle" style={{ fontSize: 12.5, fontWeight: 600, fill: C.sub }}>{verb}</text>}
        <text x="66" y="64" textAnchor="middle" style={{ fontSize: 26, fontWeight: 700, fill: C.ink }}>{bigText != null ? bigText : value.toLocaleString()}</text>
        <text x="66" y="83" textAnchor="middle" style={{ fontSize: 14.5, fontWeight: 700, fill: color }}>{label}</text>
        <text x="66" y="97" textAnchor="middle" style={{ fontSize: 11, fill: C.sub }}>{done ? "הגעת ליעד!" : sub}</text>
      </svg>
      {onPlus && (
        <button onClick={onPlus} aria-label={`עדכון ${label}`} style={{ position: "absolute", bottom: 0, left: "50%", transform: "translateX(-50%)", width: 30, height: 30, borderRadius: "50%", background: color, color: "#fff", border: `2px solid ${C.panel}`, boxShadow: "0 2px 6px rgba(0,0,0,0.18)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={17} /></button>
      )}
    </div>
  );
}
function MacroCard({ label, value, target, color, emphasized, headline }) {
  const pct = target ? Math.max(0, Math.min(100, Math.round((value / target) * 100))) : 0;
  return (
    <div style={{ flex: 1, background: emphasized ? C.brandBg : C.bg, border: `1px solid ${emphasized ? C.brand : "transparent"}`, borderRadius: 12, padding: "10px 9px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 7 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 15, color: emphasized ? C.brandD : C.sub, fontWeight: emphasized ? 600 : 400 }}>{label}</span>
      </div>
      {headline ? (
        <div style={{ fontSize: 22, fontWeight: 600, color: C.ink }}>{target}<span style={{ fontSize: 14, color: C.sub, fontWeight: 400 }}> ג׳</span></div>
      ) : (
        <>
          <div style={{ fontSize: 18, fontWeight: 600, color: C.ink }}>{value}<span style={{ fontSize: 13, color: C.faint, fontWeight: 400 }}> / {target} ג׳</span></div>
          <div style={{ height: 5, background: C.line, borderRadius: 3, marginTop: 7 }}><div style={{ width: `${pct}%`, height: 5, background: color, borderRadius: 3, transition: "width .4s" }} /></div>
        </>
      )}
    </div>
  );
}
function MacroRow({ p, f, c, tp, tf, tc, headline }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      <MacroCard label="חלבון" value={p} target={tp} color={C.macroP} emphasized headline={headline} />
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
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, color: C.ink, fontWeight: 500 }}><Droplet size={16} color={C.water} /> מים</span>
        <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{liters} / 2 ליטר</span>
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
      <div style={{ fontSize: 13, color: C.faint, marginTop: 8 }}>מומלץ {WATER_MIN_GLASSES}-{WATER_TARGET_GLASSES} כוסות ביום (1.5-2 ליטר)</div>
    </div>
  );
}

function StepsCard({ steps, goal, kcal, onEdit }) {
  const frac = Math.max(0, Math.min(1, goal > 0 ? steps / goal : 0));
  return (
    <div onClick={onEdit} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginBottom: 16, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, color: C.ink, fontWeight: 500 }}><Footprints size={16} color={C.brand} /> צעדים</span>
        <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{steps.toLocaleString()} / {goal.toLocaleString()}</span>
      </div>
      <div style={{ height: 10, borderRadius: 6, background: C.brandBg, overflow: "hidden" }}>
        <div style={{ width: `${frac * 100}%`, height: "100%", background: C.brand, borderRadius: 6, transition: "width .4s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <span style={{ fontSize: 13, color: C.faint }}>הקישי לעדכון · נוסף לתקציב: +{kcal} קק״ל</span>
        <span style={{ fontSize: 13, color: C.brandD, display: "flex", alignItems: "center", gap: 4 }}><Pencil size={12} /> עדכון</span>
      </div>
    </div>
  );
}
function Btn({ children, onClick, variant = "solid", disabled, style = {} }) {
  const base = { width: "100%", border: "none", borderRadius: 12, padding: "12px", fontSize: 18, fontWeight: 500, cursor: disabled ? "default" : "pointer", fontFamily: fontStack, transition: "transform .08s, opacity .15s" };
  const variants = { solid: { background: C.brand, color: "#fff" }, ghost: { background: "transparent", color: C.ink, border: `1px solid ${C.line}` } };
  return (
    <button onClick={disabled ? undefined : onClick} style={{ ...base, ...variants[variant], opacity: disabled ? 0.45 : 1, ...style }}
      onMouseDown={(e) => !disabled && (e.currentTarget.style.transform = "scale(0.98)")}
      onMouseUp={(e) => (e.currentTarget.style.transform = "scale(1)")}
      onMouseLeave={(e) => (e.currentTarget.style.transform = "scale(1)")}>{children}</button>
  );
}
function SrcBadge({ source }) {
  if (source === "estimated") return <span style={{ fontSize: 13, background: C.amberBg, color: C.amber, padding: "2px 7px", borderRadius: 5 }}>מוערך</span>;
  if (source === "db") return <span style={{ fontSize: 13, background: "#E7F4EC", color: "#1E8449", padding: "2px 7px", borderRadius: 5 }}>מהמאגר</span>;
  if (source === "usda") return <span style={{ fontSize: 13, background: "#EEF4FB", color: "#2D6CB5", padding: "2px 7px", borderRadius: 5 }}>USDA</span>;
  return null;
}
function Header({ title, onBack }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
      {onBack && <button onClick={onBack} style={{ border: "none", background: "transparent", cursor: "pointer", padding: 4, color: C.sub }}><ChevronRight size={22} /></button>}
      <span style={{ fontSize: 21, fontWeight: 600, color: C.ink }}>{title}</span>
    </div>
  );
}
function Stepper({ value, set, step = 1, min = 0, suffix }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button onClick={() => set(Math.max(min, Math.round((value - step) * 10) / 10))} style={{ width: 34, height: 34, border: `1px solid ${C.line}`, borderRadius: 9, background: C.panel, cursor: "pointer", color: C.ink }}><Minus size={15} /></button>
      <span style={{ minWidth: 78, textAlign: "center", fontSize: 22, fontWeight: 600, color: C.ink }}>{value}{suffix ? <span style={{ fontSize: 15, color: C.sub, fontWeight: 400 }}> {suffix}</span> : null}</span>
      <button onClick={() => set(Math.round((value + step) * 10) / 10)} style={{ width: 34, height: 34, border: `1px solid ${C.line}`, borderRadius: 9, background: C.panel, cursor: "pointer", color: C.ink }}><Plus size={15} /></button>
    </span>
  );
}

/* ============================================================
   ONBOARDING
   ============================================================ */
function Field({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderTop: `1px solid ${C.line}` }}>
      <span style={{ fontSize: 18, color: C.ink }}>{label}</span>{children}
    </div>
  );
}

function OnboardNotify({ email }) {
  const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const isIOS = /iphone|ipad|ipod/i.test((typeof navigator !== "undefined" && navigator.userAgent) || "");
  const standalone = (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || (typeof navigator !== "undefined" && navigator.standalone === true);
  const needInstall = isIOS && !standalone;
  const [st, setSt] = useState(typeof Notification !== "undefined" && Notification.permission === "granted" ? "on" : "idle");
  const turnOn = async () => {
    setSt("busy");
    const r = await enableDailyReminder(email);
    if (r.ok) setSt("on");
    else if (r.reason === "denied") setSt("denied");
    else setSt("err");
  };
  const note = (txt) => <div style={{ background: C.brandBg, borderRadius: 12, padding: "12px 14px", fontSize: 14.5, color: C.brandD, lineHeight: 1.6 }}>{txt}</div>;
  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><span style={{ fontSize: 24 }}>🔔</span><span style={{ fontSize: 25, fontWeight: 600, color: C.ink }}>תזכורת יומית</span></div>
      <div style={{ fontSize: 15.5, color: C.sub, lineHeight: 1.6, marginBottom: 16 }}>נזכיר לך כל יום ב-19:00 להקדיש רגע ולמלא את דוח המעקב היומי. אפשר למלא אותו בכל שעה במהלך היום, ולכבות את התזכורת בכל רגע מהפרופיל.</div>
      {!supported ? note("הדפדפן הזה לא תומך בתזכורות. אפשר להמשיך בלי - זה לא משפיע על המעקב.")
        : needInstall ? note("כדי לקבל תזכורות באייפון, קודם הוסיפי את האפליקציה למסך הבית ופתחי אותה משם. אפשר להמשיך עכשיו ולהפעיל אחר כך מהפרופיל.")
        : st === "on" ? <div style={{ background: "#E8F3EC", borderRadius: 12, padding: "12px 14px", fontSize: 15, color: "#3B7A57", fontWeight: 600 }}>מצוין! נזכיר לך כל ערב ב-19:00 💜</div>
        : st === "denied" ? note("ההתראות חסומות במכשיר. אפשר לאפשר אותן בהגדרות, או להמשיך בלי.")
        : <Btn onClick={turnOn} disabled={st === "busy"}>{st === "busy" ? "רגע..." : "אפשרי תזכורת יומית"}</Btn>}
      {supported && isIOS && !needInstall && st !== "on" && st !== "denied" && <div style={{ fontSize: 13, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>כשיופיע חלון של הטלפון - בחרי "אישור".</div>}
      {st === "err" && <div style={{ fontSize: 13.5, color: C.sub, marginTop: 8 }}>לא הצלחנו להפעיל כרגע. אפשר לנסות שוב מהפרופיל.</div>}
    </>
  );
}

function Onboarding({ onFinish, name, email, fixedStart }) {
  const [step, setStep] = useState(0);
  const [age, setAge] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [rate, setRate] = useState(250);
  const [goalKg, setGoalKg] = useState(null);
  const [err0, setErr0] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const [startDate, setStartDate] = useState(fixedStart || sundayOf(TODAY));
  const [keepShabbat, setKeepShabbat] = useState(null);
  const [diet, setDiet] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [dislikes, setDislikes] = useState("");
  const [newSens, setNewSens] = useState("");
  const [confirmNoSens, setConfirmNoSens] = useState(false);
  const [confirmSens, setConfirmSens] = useState(false);
  const [ack, setAck] = useState(false);
  const [wantBackup, setWantBackup] = useState(null); // null = not chosen yet
  const [ackData, setAckData] = useState(false);
  const [bkEmail, setBkEmail] = useState((email || "").trim());
  const [bkCode, setBkCode] = useState("");
  const [bkCode2, setBkCode2] = useState("");
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(bkEmail.trim());
  const codeOk = bkCode.trim().length >= 4 && bkCode === bkCode2;
  const backupStepOk = ackData && (wantBackup === false || (wantBackup === true && emailOk && codeOk));
  const customSens = dislikes.split(",").map((s) => s.trim()).filter(Boolean);
  const addSens = () => { const t = newSens.trim(); if (!t) return; if (!customSens.includes(t)) setDislikes([...customSens, t].join(", ")); setNewSens(""); };
  const removeSens = (t) => setDislikes(customSens.filter((x) => x !== t).join(", "));
  const hasSens = allergies.length > 0 || customSens.length > 0;
  const ageN = +age, heightN = +heightCm, weightN = +weightKg;
  const goalEff = goalKg == null ? weightN : goalKg;
  const ageOk = ageN >= 33 && ageN <= 80;
  const heightOk = heightN >= 120 && heightN <= 210;
  const weightOk = weightN >= 50 && weightN <= 150;
  const step0Valid = ageOk && heightOk && weightOk && keepShabbat !== null;
  const next = () => {
    if (step === 0 && !step0Valid) { setErr0(true); return; }
    if (step === 2) { if (hasSens) setConfirmSens(true); else setConfirmNoSens(true); return; }
    setStep(step + 1);
  };

  const draft = { age: ageN, heightCm: heightN, weightKg: weightN, activity: "יושבני", weeklyRateG: rate, goalWeightKg: rate === 0 ? weightN : Math.max(minHealthyKg(heightN), goalEff), returnPct: 50, startDate, keepShabbat: keepShabbat === true, stepGoal: null, stepBaseline: null, cupMl: DEFAULT_CUP_ML, diet, allergies, dislikes, fasting: false };
  const targets = computeTargets(draft);
  const proj = projection(weightN, rate === 0 ? weightN : goalEff, rate);
  const projData = proj.data.map((d) => ({ ...d, label: `${d.w}` }));
  const backupSetup = wantBackup ? { enabled: true, email: bkEmail.trim().toLowerCase(), code: bkCode } : { enabled: false };

  const numStyle = (bad) => ({ width: 96, textAlign: "center", border: `1.5px solid ${bad ? "#D7263D" : C.line}`, borderRadius: 10, padding: "9px 10px", fontSize: 18, fontFamily: fontStack, color: C.ink, outline: "none" });
  const errNote = (txt) => <div style={{ fontSize: 14.5, fontWeight: 700, color: "#D7263D", marginTop: 5, lineHeight: 1.4 }}>{txt}</div>;
  const obIsIOS = /iphone|ipad|ipod/i.test((typeof navigator !== "undefined" && navigator.userAgent) || "");
  const obStandalone = (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || (typeof navigator !== "undefined" && navigator.standalone === true);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px 20px 16px" }}>
        <div style={{ display: "flex", gap: 6, margin: "6px 0 8px" }}>
          {[0, 1, 2, 3, 4, 5].map((i) => (<div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: i <= step ? C.brand : C.line, transition: "background .3s" }} />))}
        </div>
        <div style={{ textAlign: "center", fontSize: 13, color: C.faint, marginBottom: 8 }}>v{VERSION}</div>
        <div onClick={() => setShowInstall(true)} style={{ background: C.brandBg, border: `1.5px solid ${C.brand}`, borderRadius: 14, padding: "12px 14px", marginBottom: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>📲</span>
          <div style={{ flex: 1, textAlign: "right" }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: C.brandD, lineHeight: 1.4 }}>מומלץ מאוד להתקין את האפליקציה בטלפון</div>
            <div style={{ fontSize: 13.5, color: C.brandD, textDecoration: "underline", marginTop: 2 }}>תרצי הנחיות? הקישי כאן</div>
            {!obStandalone && <div style={{ fontSize: 12.5, color: C.brandD, fontWeight: 500, marginTop: 6, lineHeight: 1.5 }}>כדאי למלא את הפרטים רק אחרי ההתקנה, מתוך האפליקציה{obIsIOS ? " - אחרת תצטרכי למלא אותם שוב" : ""}.</div>}
          </div>
          <ChevronLeft size={20} color={C.brand} style={{ flexShrink: 0 }} />
        </div>
        {DEV && (
          <div style={{ textAlign: "center", marginBottom: 12 }}>
            <button onClick={() => onFinish(draft, { enabled: false })} style={{ border: "none", background: "transparent", color: C.brandD, fontSize: 15, textDecoration: "underline", cursor: "pointer" }}>דלג ישר לדמו ←</button>
          </div>
        )}

        {step === 0 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Sparkles size={20} color={C.brand} /><span style={{ fontSize: 25, fontWeight: 600, color: C.ink }}>{name && name.trim() ? `היי ${name.trim()}, נעים להכיר!` : "נעים להכיר"}</span></div>
            <p style={{ fontSize: 16, color: C.sub, lineHeight: 1.6, marginTop: 0, marginBottom: 10 }}>כמה פרטים קצרים כדי שנחשב עבורך תוכנית מדויקת ובת-קיימא.</p>
            <Field label="גיל"><input type="number" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value)} placeholder="" style={numStyle(err0 && !ageOk)} /></Field>
            {err0 && !ageOk && errNote(age === "" ? "יש למלא את הנתון" : "יש להזין גיל תקין")}
            <Field label="גובה"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="number" inputMode="numeric" value={heightCm} onChange={(e) => setHeightCm(e.target.value)} placeholder="" style={numStyle(err0 && !heightOk)} /><span style={{ fontSize: 15, color: C.sub }}>ס״מ</span></span></Field>
            {err0 && !heightOk && errNote(heightCm === "" ? "יש למלא את הנתון" : "יש להזין גובה תקין בסנטימטרים")}
            <Field label="משקל נוכחי"><span style={{ display: "flex", alignItems: "center", gap: 6 }}><input type="number" inputMode="decimal" value={weightKg} onChange={(e) => setWeightKg(e.target.value)} placeholder="" style={numStyle(err0 && !weightOk)} /><span style={{ fontSize: 15, color: C.sub }}>ק״ג</span></span></Field>
            {err0 && !weightOk && errNote(weightKg === "" ? "יש למלא את הנתון" : "יש להזין משקל תקין בק״ג")}
            <div style={{ padding: "14px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 18, color: C.ink, marginBottom: 8 }}>תאריך תחילת התוכנית</div>
              {fixedStart ? (
                <>
                  <div style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", fontSize: 18, color: C.ink, background: C.infoBg, display: "flex", alignItems: "center", gap: 8 }}><Lock size={16} color={C.sub} />{new Date(startDate).toLocaleDateString("he-IL")}</div>
                  <div style={{ fontSize: 14, color: C.faint, marginTop: 6 }}>התאריך נקבע לפי ההרשמה שלך לתוכנית.</div>
                </>
              ) : (
                <>
                  <select value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", fontSize: 18, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none" }}>
                    {listSundays().map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                  </select>
                  <div style={{ fontSize: 14, color: C.faint, marginTop: 6 }}>התוכנית מתחילה בימי ראשון בלבד.</div>
                </>
              )}
            </div>
            <div style={{ padding: "14px 0", borderTop: `1px solid ${C.line}` }}>
              <div style={{ fontSize: 18, color: C.ink, marginBottom: 8 }}>האם את מעוניינת להשתמש באפליקציה בכל ימות השבוע (כולל שבת)?</div>
              <div style={{ display: "flex", gap: 8 }}>
                {[{ v: false, label: "כן, כל השבוע" }, { v: true, label: "לא, שבת יום מנוחה" }].map((o) => {
                  const sel = keepShabbat === o.v;
                  return (<button key={String(o.v)} onClick={() => setKeepShabbat(o.v)} style={{ flex: 1, border: `2px solid ${sel ? C.brand : C.line}`, background: sel ? C.brandBg : C.panel, color: sel ? C.brandD : C.ink, borderRadius: 12, padding: "11px 8px", fontSize: 16, fontWeight: sel ? 600 : 400, cursor: "pointer", fontFamily: fontStack }}>{o.label}</button>);
                })}
              </div>
              {err0 && keepShabbat === null && errNote("יש לבחור תשובה")}
              <div style={{ fontSize: 14, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>אם תבחרי "יום מנוחה", שבת תופיע אפורה ובלי מעקב. תמיד אפשר לשנות בפרופיל.</div>
            </div>
            <p style={{ fontSize: 14, color: C.faint, marginTop: 14, lineHeight: 1.6 }}>התוכנית מותאמת לנשים, ולכן אין צורך בשאלת מין.</p>
          </>
        )}

        {step === 1 && (
          <>
            <span style={{ fontSize: 25, fontWeight: 600, color: C.ink }}>מה המטרה שלך?</span>
            <p style={{ fontSize: 16, color: C.sub, lineHeight: 1.6, marginTop: 6, marginBottom: 14 }}>בחרי קצב ירידה שבועי. קצב מתון נשמר לאורך זמן וטוב יותר לשמירה על מסת שריר.</p>
            {RATE_OPTIONS.map((g) => {
              const sel = rate === g;
              const rec = g === 250;
              return (
                <div key={g} onClick={() => setRate(g)} style={{ display: "flex", alignItems: "center", gap: 10, border: `${rec ? 2 : 1}px solid ${sel || rec ? C.brand : C.line}`, background: sel || rec ? C.brandBg : "transparent", borderRadius: 14, padding: 14, marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${sel ? C.brand : C.line}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{sel && <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.brand }} />}</div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 18, fontWeight: 500, color: C.ink }}>{rateLabel(g)}</span>
                    {rec && <div style={{ fontSize: 13.5, color: C.brandD, marginTop: 2, lineHeight: 1.4 }}>הקצב הבריא - נשמר לאורך זמן וטוב לשמירה על מסת השריר</div>}
                  </div>
                  {rec && <span style={{ fontSize: 13, fontWeight: 700, background: C.brand, color: "#fff", padding: "4px 11px", borderRadius: 8, flexShrink: 0 }}>מומלץ</span>}
                </div>
              );
            })}
            {rate !== 0 && (<div style={{ marginTop: 6 }}><Field label="משקל רצוי"><Stepper value={goalEff} set={(v) => setGoalKg(Math.max(minHealthyKg(heightN), Math.min(weightN - 0.5, v)))} step={0.5} suffix="ק״ג" /></Field><div style={{ fontSize: 13.5, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>לא ניתן לבחור יעד נמוך מ-{minHealthyKg(heightN)} ק״ג, הטווח הבריא לגובה שלך.</div></div>)}
          </>
        )}

        {step === 2 && (
          <>
            <span style={{ fontSize: 25, fontWeight: 600, color: C.ink }}>איך את אוכלת?</span>
            <p style={{ fontSize: 16, color: C.sub, lineHeight: 1.6, marginTop: 6, marginBottom: 16 }}>בחרי את סגנון התזונה שלך - אפשר לבחור יותר מאחד. זה יעזור לי להתאים לך המלצות.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, justifyContent: "center", marginBottom: 22 }}>
              {DIET_OPTIONS.map((d) => {
                const on = diet.includes(d.id);
                return (
                  <div key={d.id} onClick={() => setDiet(on ? diet.filter((x) => x !== d.id) : [...diet, d.id])} style={{ width: 92, textAlign: "center", cursor: "pointer" }}>
                    <div style={{ width: 72, height: 72, borderRadius: "50%", margin: "0 auto 6px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 31, background: on ? C.brandBg : C.bg, border: `2px solid ${on ? C.brand : C.line}`, transition: "all .15s" }}>{d.emoji}</div>
                    <span style={{ fontSize: 15, color: on ? C.brandD : C.sub, fontWeight: on ? 600 : 400 }}>{d.id}</span>
                  </div>
                );
              })}
            </div>

            <div style={{ fontSize: 19, fontWeight: 500, color: C.ink, marginBottom: 4 }}>רגישויות ואלרגיות</div>
            <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, marginTop: 0, marginBottom: 10 }}>סמני וכתבי מה שחשוב להימנע ממנו, ואדאג שההמלצות יתחשבו בזה.</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {SENSITIVITY_OPTIONS.map((s) => {
                const on = allergies.includes(s);
                return (<span key={s} onClick={() => setAllergies(on ? allergies.filter((x) => x !== s) : [...allergies, s])} style={{ fontSize: 15, padding: "7px 14px", borderRadius: 16, cursor: "pointer", background: on ? C.brand : "transparent", color: on ? "#fff" : C.sub, boxShadow: on ? "none" : `inset 0 0 0 1px ${C.line}` }}>{s}</span>);
              })}
            </div>

            <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.6, display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 12 }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>אשתדל להתאים את ההמלצות לרגישויות שלך, אבל תמיד כדאי לבדוק רכיבים בעצמך. האפליקציה היא כלי עזר ולא תחליף לייעוץ רפואי. אם יש לך אלרגיה ממשית, אל תסתמכי רק עליה.</span>
            </div>

            <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>רגישויות נוספות</div>
            <div style={{ display: "flex", gap: 6, marginBottom: customSens.length ? 10 : 0 }}>
              <input value={newSens} onChange={(e) => setNewSens(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSens(); } }} placeholder="הקלידי והוסיפי (למשל: בלי חריף)" style={{ flex: 1, border: `1.5px solid ${C.brand}`, borderRadius: 10, padding: "11px 12px", fontSize: 15, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", background: C.panel }} />
              <button onClick={addSens} aria-label="הוספה" style={{ flexShrink: 0, width: 46, borderRadius: 10, border: "none", background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={18} /></button>
            </div>
            {customSens.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {customSens.map((s) => (
                  <span key={s} style={{ fontSize: 15, padding: "6px 9px 6px 13px", borderRadius: 16, background: C.brand, color: "#fff", display: "inline-flex", alignItems: "center", gap: 6 }}>
                    {s}
                    <button onClick={() => removeSens(s)} aria-label="הסרה" style={{ border: "none", background: "transparent", color: "#fff", cursor: "pointer", display: "flex", padding: 0 }}><X size={14} /></button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}><Lock size={20} color={C.brand} /><span style={{ fontSize: 25, fontWeight: 600, color: C.ink }}>גיבוי מאובטח</span></div>
            <p style={{ fontSize: 15.5, color: C.ink, lineHeight: 1.65, marginTop: 0, marginBottom: 10 }}>
              מה שאת ממלאת פה באפליקציה נשמר במכשיר שלך בלבד ורק לך יש גישה לנתונים האלה. לחברת מיי פריים אין אפשרות לראות את הנתונים או להשתמש בהם.
            </p>
            <p style={{ fontSize: 15.5, color: C.ink, lineHeight: 1.65, marginTop: 0, marginBottom: 14 }}>
              אם תרצי, נשמור גיבוי <b>מוצפן</b> בענן - כך שאם תחליפי טלפון או יקרה משהו למכשיר, תוכלי לשחזר הכל. הגיבוי מוצפן כך ש<b>רק את</b> יכולה לפתוח אותו.
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
              {[{ v: true, label: "כן, רוצה גיבוי מוצפן" }, { v: false, label: "לא תודה, רק במכשיר הזה" }].map((o) => {
                const sel = wantBackup === o.v;
                return (<button key={String(o.v)} onClick={() => setWantBackup(o.v)} style={{ flex: 1, border: `2px solid ${sel ? C.brand : C.line}`, background: sel ? C.brandBg : C.panel, color: sel ? C.brandD : C.ink, borderRadius: 12, padding: "12px 8px", fontSize: 15, fontWeight: sel ? 600 : 400, cursor: "pointer", fontFamily: fontStack, lineHeight: 1.4 }}>{o.label}</button>);
              })}
            </div>
            {wantBackup === true && (
              <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
                <div style={{ fontSize: 14, color: C.ink, marginBottom: 6 }}>אימייל לגיבוי</div>
                <input value={bkEmail} onChange={(e) => setBkEmail(e.target.value)} inputMode="email" placeholder="name@example.com" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${emailOk || !bkEmail ? C.line : C.amber}`, borderRadius: 10, padding: "11px 12px", fontSize: 16, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none", direction: "ltr", textAlign: "left" }} />
                <div style={{ fontSize: 13, color: C.faint, marginTop: 4, marginBottom: 12 }}>הגיבוי ישויך לאימייל הזה. אפשר לאשר או לתקן.</div>
                <div style={{ fontSize: 14, color: C.ink, marginBottom: 6 }}>קוד גיבוי</div>
                <input value={bkCode} onChange={(e) => setBkCode(e.target.value)} type="password" placeholder="קוד אישי שתזכרי" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", fontSize: 16, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none" }} />
                <input value={bkCode2} onChange={(e) => setBkCode2(e.target.value)} type="password" placeholder="הקלדת הקוד שוב לאישור" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${bkCode2 && bkCode !== bkCode2 ? C.amber : C.line}`, borderRadius: 10, padding: "11px 12px", fontSize: 16, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none", marginTop: 8 }} />
                {bkCode2 && bkCode !== bkCode2 && <div style={{ fontSize: 13, color: C.amber, marginTop: 4 }}>הקודים אינם תואמים.</div>}
                <div style={{ fontSize: 13, color: C.amber, background: C.amberBg, padding: "10px 12px", borderRadius: 10, lineHeight: 1.55, marginTop: 10, display: "flex", gap: 6 }}>
                  <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>בחרי קוד פשוט שתזכרי. אי אפשר לשחזר אותו - אם תשכחי, לא נוכל לפתוח את הגיבוי בטלפון חדש. רשמי אותו במקום בטוח.</span>
                </div>
              </div>
            )}
            <div onClick={() => setAckData(!ackData)} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", padding: "12px 0 2px", marginTop: 14, borderTop: `1px solid ${C.line}` }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${ackData ? C.brand : C.line}`, background: ackData ? C.brand : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{ackData && <Check size={14} color="#fff" />}</div>
              <span style={{ fontSize: 14.5, color: C.sub, lineHeight: 1.55 }}>קראתי והבנתי את מדיניות שמירת הנתונים של מיי פריים.</span>
            </div>
          </>
        )}

        {step === 4 && (
          <>
            <span style={{ fontSize: 25, fontWeight: 600, color: C.ink }}>התוכנית שלך</span>
            <p style={{ fontSize: 16, color: C.sub, lineHeight: 1.6, marginTop: 6, marginBottom: 12 }}>
              {proj.maintain ? "תוכנית לשמירה על המשקל הנוכחי." : `בקצב של ${rate} ג׳ בשבוע, תגיעי ל־${goalEff} ק״ג בעוד כ־${proj.weeks} שבועות.`}
            </p>

            <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 10px 6px", marginBottom: 12 }}>
              <div style={{ height: 150 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={projData} margin={{ top: 6, right: 10, left: 10, bottom: 0 }}>
                    <defs><linearGradient id="pg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.brand} stopOpacity={0.2} /><stop offset="100%" stopColor={C.brand} stopOpacity={0} /></linearGradient></defs>
                    <XAxis dataKey="label" tick={{ fontSize: 13, fill: C.faint }} axisLine={false} tickLine={false} />
                    <YAxis domain={["dataMin - 1", "dataMax + 1"]} hide />
                    <Tooltip contentStyle={{ fontSize: 15, borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontStack }} formatter={(v) => [`${v} ק״ג`, "משקל צפוי"]} labelFormatter={(l) => `שבוע ${l}`} />
                    <Area type="monotone" dataKey="kg" stroke={C.brand} strokeWidth={2.5} fill="url(#pg)" dot={{ r: 2.5, fill: C.brand }} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div style={{ textAlign: "center", fontSize: 13, color: C.faint, paddingBottom: 6 }}>תחזית לפי שבועות</div>
            </div>

            <div style={{ background: C.brandBg, borderRadius: 14, padding: 14, marginBottom: 12, textAlign: "center" }}>
              <div style={{ fontSize: 14, color: C.brandD, marginBottom: 4 }}>יעד קלורי יומי מומלץ</div>
              <div style={{ fontSize: 36, fontWeight: 600, color: C.brandD }}>{targets.targetKcal.toLocaleString()} <span style={{ fontSize: 18 }}>קק״ל</span></div>
            </div>

            {targets.floored && (
              <div style={{ fontSize: 14, color: C.amber, background: C.amberBg, padding: 10, borderRadius: 10, lineHeight: 1.6, marginBottom: 12, display: "flex", gap: 6 }}>
                <Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>הקצב שבחרת מהיר מהמומלץ עבור הנתונים שלך. היעד הוגבל ל־{KCAL_FLOOR} קק״ל לשמירה על בריאותך - שקלי קצב מתון יותר.</span>
              </div>
            )}

            <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.7, textAlign: "right", display: "flex", alignItems: "flex-start", gap: 6 }}>
              <Info size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>ההמלצות בתוכנית מבוססות על הנתונים שהזנת, ובאחריותך להזין נתונים מדויקים ועדכניים. האפליקציה היא כלי עזר בלבד ואינה מהווה ייעוץ רפואי או תזונתי, ואינה תחליף להם.</span>
            </div>
          </>
        )}
        {step === 5 && (<OnboardNotify email={email} />)}
      </div>

      <div style={{ padding: "10px 20px 18px", borderTop: `1px solid ${C.line}`, display: "flex", gap: 10, alignItems: "center" }}>
        {step > 0 && (<button onClick={() => setStep(step - 1)} style={{ border: `1px solid ${C.line}`, background: C.panel, borderRadius: 12, width: 46, height: 46, cursor: "pointer", color: C.ink, flexShrink: 0 }}><ChevronRight size={20} /></button>)}
        {step < 5 ? (<Btn disabled={step === 3 && !backupStepOk} onClick={next}>המשך</Btn>) : (<Btn onClick={() => onFinish(draft, backupSetup)}>בואי נתחיל</Btn>)}
      </div>

      {confirmNoSens && (
        <div onClick={() => setConfirmNoSens(false)} style={{ position: "fixed", inset: 0, background: "rgba(58,43,48,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 16, padding: 20, maxWidth: 340, width: "100%", textAlign: "right" }}>
            <div style={{ fontSize: 19, fontWeight: 600, color: C.ink, marginBottom: 6 }}>לא סימנת שום רגישות או אלרגיה</div>
            <div style={{ fontSize: 16, color: C.ink, lineHeight: 1.6, marginBottom: 12 }}>האם את בטוחה?</div>
            <div style={{ fontSize: 14, color: C.ink, lineHeight: 1.6, display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 18 }}>
              <Info size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>אשתדל להתאים את ההמלצות לרגישויות שלך, אבל תמיד כדאי לבדוק רכיבים בעצמך. האפליקציה היא כלי עזר ולא תחליף לייעוץ רפואי. אם יש לך אלרגיה ממשית, אל תסתמכי רק עליה.</span>
            </div>
            <Btn onClick={() => { setConfirmNoSens(false); setStep(step + 1); }}>כן, אפשר להמשיך</Btn>
            <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={() => setConfirmNoSens(false)} style={{ color: C.sub }}>חזרה לסמן רגישויות</Btn></div>
          </div>
        </div>
      )}

      {confirmSens && (
        <div onClick={() => { setConfirmSens(false); setAck(false); }} style={{ position: "fixed", inset: 0, background: "rgba(58,43,48,0.45)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 16, padding: 20, maxWidth: 340, width: "100%", textAlign: "right" }}>
            <div style={{ fontSize: 19, fontWeight: 600, color: C.ink, marginBottom: 10 }}>רגע לפני שממשיכים</div>
            <div style={{ fontSize: 16, color: C.ink, lineHeight: 1.6, marginBottom: 10 }}>רשמתי לעצמי להימנע מ: <b>{[...allergies, ...customSens].join(", ")}</b></div>
            <div style={{ fontSize: 14, color: C.sub, lineHeight: 1.6, marginBottom: 14 }}>תמיד כדאי לבדוק את רשימת הרכיבים בעצמך - זה כלי עזר, לא תחליף לבדיקה. אם יש לך אלרגיה ממשית, אל תסתמכי רק על האפליקציה.</div>
            <div onClick={() => setAck(!ack)} style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", marginBottom: 16 }}>
              <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${ack ? C.brand : C.line}`, background: ack ? C.brand : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 }}>{ack && <Check size={14} color="#fff" />}</div>
              <span style={{ fontSize: 14.5, color: C.ink, lineHeight: 1.55 }}>קראתי והבנתי שהאפליקציה היא כלי עזר בלבד, ובאחריותי לבדוק תמיד את רשימת הרכיבים המלאה לפני אכילה.</span>
            </div>
            <Btn disabled={!ack} onClick={() => { setConfirmSens(false); setAck(false); setStep(step + 1); }}>המשך</Btn>
            <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={() => { setConfirmSens(false); setAck(false); }} style={{ color: C.sub }}>שינוי</Btn></div>
          </div>
        </div>
      )}
      {showInstall && (
        <div onClick={() => setShowInstall(false)} style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.5)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 16, padding: 20, maxWidth: 340, width: "100%", maxHeight: "82%", overflowY: "auto", textAlign: "right", fontFamily: fontStack }}>
            <div style={{ fontSize: 19, fontWeight: 700, color: C.ink, marginBottom: 4 }}>התקנה כאפליקציה במסך הבית</div>
            <p style={{ fontSize: 14, color: C.sub, lineHeight: 1.6, margin: "0 0 14px" }}>אפשר להוסיף את MyPrime למסך הבית כדי לפתוח אותה כמו אפליקציה רגילה, עם אייקון משלה.</p>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: C.brandD, marginBottom: 4 }}>אנדרואיד (Chrome)</div>
            <ol style={{ fontSize: 15, color: C.sub, lineHeight: 1.7, margin: "0 0 14px", paddingInlineStart: 20 }}>
              <li>פתחי את האפליקציה בדפדפן Chrome.</li>
              <li>הקישי על תפריט שלוש הנקודות (⋮) בפינה העליונה.</li>
              <li>בחרי "הוספה למסך הבית" (או "התקנת אפליקציה").</li>
              <li>אשרי - והאייקון יופיע במסך הבית.</li>
            </ol>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: C.brandD, marginBottom: 4 }}>אייפון (Safari)</div>
            <ol style={{ fontSize: 15, color: C.sub, lineHeight: 1.7, margin: "0 0 16px", paddingInlineStart: 20 }}>
              <li>פתחי את האפליקציה בדפדפן Safari.</li>
              <li>הקישי על כפתור השיתוף (ריבוע עם חץ כלפי מעלה).</li>
              <li>גללי ובחרי "הוספה למסך הבית".</li>
              <li>הקישי "הוספה" - והאייקון יופיע במסך הבית.</li>
            </ol>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: C.brandD, marginBottom: 4 }}>לרענון האפליקציה באייפון</div>
            <p style={{ fontSize: 14.5, color: C.sub, lineHeight: 1.7, margin: "0 0 16px" }}>באייפון משיכה למטה לא מרעננת את האפליקציה. כדי לרענן: סגרי אותה לגמרי (החליקי מלמטה למעלה ועצרי באמצע, ואז החליקי את הכרטיס של האפליקציה כלפי מעלה), ופתחי שוב מהאייקון.</p>
            <Btn onClick={() => setShowInstall(false)}>סגירה</Btn>
          </div>
        </div>
      )}
    </div>
  );
}
function DayScreen({ date, setDate, today = TODAY, log, targets, dailyTarget, profile, activityLog, waterByDate, setWaterForDate, onWater, stepsByDate, onEditSteps, editEntry, deleteEntry, onRecommend, onAddCalorie, checkins, onOpenCheckin, onOpenCollection, onOpenSummary, stepAction, onStepSetup, tipsSeen, onTipsSeen, onStartTour, introLock = false, overlayOpen = false }) {
  const dayLog = log.filter((e) => e.date === date);
  const consumed = dayLog.reduce((s, e) => s + (e.kcal || 0), 0);
  const dayAct = activityLog.filter((a) => a.date === date);
  const actKcal = dayAct.reduce((s, a) => s + (a.kcal || 0), 0);
  const stepsOpen = unlockedOn(profile.startDate, date, STEPS_UNLOCK);
  const steps = (stepsByDate && stepsByDate[date]) || 0;
  const stepKcal = stepsOpen ? stepsKcal(steps, profile.weightKg) : 0;
  const budget = dailyTarget + actKcal + stepKcal;
  const macros = dayLog.reduce((s, e) => ({ p: s.p + (e.p || 0), f: s.f + (e.f || 0), c: s.c + (e.c || 0), fib: s.fib + (e.fib || 0) }), { p: 0, f: 0, c: 0, fib: 0 });
  const week = programWeekFor(profile.startDate, date);
  const macroOpen = unlockedOn(profile.startDate, date, MACRO_UNLOCK);
  const waterOpen = unlockedOn(profile.startDate, date, WATER_UNLOCK);
  const cupMl = profile.cupMl || DEFAULT_CUP_ML;
  const waterMl = waterMlOf(waterByDate[date]);
  const waterCups = Math.round((waterMl / cupMl) * 10) / 10;
  const targetCups = Math.round(WATER_TARGET_ML / cupMl);
  const selRef = useRef(null);
  const cupMlD = profile.cupMl || DEFAULT_CUP_ML;
  const dow = dowOf(date);
  const progDay = programDayNumber(profile.startDate, date);
  const isShabbatRest = profile.keepShabbat && dow === 0;
  const isIntro = progDay >= 1 && progDay <= 2;
  const baseline = stepBaseline(stepsByDate, profile.startDate);
  // Running goal: stored value if set, else baseline + cumulative offset; null in week 1 (still measuring).
  const dayStepGoal = effectiveStepGoal(profile.stepGoal, week);
  const checkinOpen = TRACKER_ENABLED && unlockedOn(profile.startDate, date, CHECKIN_UNLOCK);
  const hasManualTask = checkinOpen && tasksForDate(profile.startDate, date, profile.keepShabbat, profile.fasting).some((t) => !t.auto);
  const stepBannerActive = !!(stepAction && stepAction.kind === "baseline");
  const [tipQueue, setTipQueue] = useState([]);
  const [tipIdx, setTipIdx] = useState(-1);
  useEffect(() => {
    if (tipIdx !== -1) return;
    if (isIntro || isShabbatRest) return;
    if (overlayOpen) return; // never start a tip over an open sheet/modal (no on-screen target -> no spotlight)
    const ctx = { progDay, stepsOpen, waterOpen, macroOpen, checkinOpen, manualTracker: hasManualTask, stepBanner: stepBannerActive, week, weeklySummaryShown: checkinOpen && (dow === 6 || dow === 0) };
    const due = TIPS.filter((t) => t.due(ctx) && !(tipsSeen || []).includes(t.key) && !["cal", "steps", "tracker", "cabinet"].includes(t.key));
    if (due.length) { setTipQueue(due); setTipIdx(0); }
  }, [progDay, stepsOpen, waterOpen, macroOpen, checkinOpen, hasManualTask, stepBannerActive, tipsSeen, tipIdx, isIntro, isShabbatRest, week, dow, overlayOpen]);
  const tipAdvance = () => setTipIdx((i) => { const n = i + 1; if (n >= tipQueue.length) { onTipsSeen && onTipsSeen(tipQueue.map((t) => t.key)); setTipQueue([]); return -1; } return n; });
  // First-bubble choice ("רוצה שאראה לך דוגמה?"). For now both continue to the next bubble;
  // the step-by-step food-example bubbles (the YES path) will be inserted here once their content is provided.
  const tipChoose = (yes) => { tipAdvance(); };
  const ciWeek = Math.min(week, 10);
  const ciTasks = checkinOpen ? tasksForDate(profile.startDate, date, profile.keepShabbat, profile.fasting) : [];
  const ciAnswers = (checkins && checkins[date]) || {};
  const ciAuto = autoStatusFor(date, stepsByDate, waterByDate, log, targets, cupMlD);
  const ciLocked = date === today && new Date().getHours() < CHECKIN_REVEAL_HOUR;
  useEffect(() => { if (selRef.current) selRef.current.scrollIntoView({ inline: "center", block: "nearest" }); }, [date]);
  const backN = Math.min(74, Math.max(0, programDayNumber(profile.startDate, today) - 1));
  const days = Array.from({ length: backN + 5 }, (_, i) => addDays(today, i - backN));
  const dayProgress = (d) => {
    if (!TRACKER_ENABLED) return 0;
    if (!unlockedOn(profile.startDate, d, CHECKIN_UNLOCK)) return 0;
    const ts = tasksForDate(profile.startDate, d, profile.keepShabbat).filter((t) => !t.optional);
    if (!ts.length) return 0;
    const ans = (checkins && checkins[d]) || {};
    const au = autoStatusFor(d, stepsByDate, waterByDate, log, targets, cupMlD);
    const dn = ts.filter((t) => taskDone(t, ans, au)).length;
    return dn / ts.length;
  };
  const swipe = useRef({ x: 0, y: 0 });
  const goDay = (delta) => {
    const minT = new Date(profile.startDate).getTime(), maxT = new Date(today).getTime();
    let d = addDays(date, delta);
    if (profile.keepShabbat && new Date(d).getDay() === 6) d = addDays(d, delta);
    const t = new Date(d).getTime();
    if (t < minT || t > maxT) return;
    setDate(d);
  };
  const onTouchStart = (e) => { const t = e.touches[0]; swipe.current = { x: t.clientX, y: t.clientY }; };
  const onTouchEnd = (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.current.x, dy = t.clientY - swipe.current.y;
    if (Math.abs(dx) > 55 && Math.abs(dx) > Math.abs(dy) * 1.5) goDay(dx > 0 ? 1 : -1);
  };
  return (
    <div style={{ padding: "8px 0 24px" }}>
      {tipIdx >= 0 && tipIdx < tipQueue.length && <TutorialOverlay steps={tipQueue} idx={tipIdx} onNext={tipAdvance} onChoice={tipChoose} />}
      <div style={{ position: "relative" }}>
      <div data-tut="daystrip" style={{ display: "flex", gap: 6, overflowX: "auto", padding: "8px 16px 4px", opacity: introLock ? 0.4 : 1, pointerEvents: introLock ? "none" : "auto" }}>
        {days.map((d) => {
          const sel = d === date; const isToday = d === today; const isFuture = d > today; const dd = new Date(d); const isRest = profile.keepShabbat && dd.getDay() === 6; const off = isFuture || isRest; const pct = dayProgress(d);
          return (
            <button key={d} ref={sel ? selRef : null} disabled={off} onClick={() => { if (!off) setDate(d); }} title={isRest ? "שבת - יום מנוחה" : (isFuture ? "יום עתידי - ייפתח בתאריך הזה" : undefined)} style={{ flex: "0 0 auto", width: 50, border: isToday && !sel ? `2px solid ${C.brand}` : "2px solid transparent", borderRadius: 12, overflow: "hidden", padding: 0, background: sel ? C.brand : (isToday ? C.brandBg : C.bg), color: off ? C.faint : (sel ? "#fff" : C.ink), cursor: off ? "default" : "pointer", opacity: off ? 0.4 : 1, textAlign: "center" }}>
              {isToday && <div style={{ background: sel ? C.brandD : C.brand, color: "#fff", fontSize: 11, fontWeight: 700, padding: "2px 0", lineHeight: 1.3 }}>היום</div>}
              <div style={{ padding: "7px 0" }}>
                <div style={{ fontSize: 14, opacity: 0.85 }}>{HE_DAYS[dd.getDay()]}</div>
                <div style={{ fontSize: 18, fontWeight: 700, margin: "2px 0" }}>{dd.getDate()}/{dd.getMonth() + 1}</div>
                <div style={{ height: 4, margin: "5px 6px 0", borderRadius: 3, position: "relative", background: sel ? "rgba(255,255,255,0.35)" : C.line, overflow: "hidden" }}>
                  {pct > 0 && <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: `${Math.round(pct * 100)}%`, borderRadius: 3, background: sel ? "#fff" : lerpHex("#F4B8D2", "#D81B7A", pct) }} />}
                </div>
              </div>
            </button>
          );
        })}
      </div>
      {introLock && <div style={{ position: "absolute", top: 10, left: 16, background: C.faint, color: "#fff", fontSize: 11, fontWeight: 700, padding: "3px 11px", borderRadius: 999, fontFamily: fontStack }}>בקרוב</div>}
      </div>
      {week === 1 && progDay >= 3 && (
      <div style={{ display: "flex", justifyContent: "center", padding: "6px 16px 0" }}>
        <button data-tut="tourbtn" onClick={onStartTour} style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, background: C.panel, color: C.brandD, borderRadius: 999, padding: "5px 14px", fontSize: 13, fontWeight: 600, fontFamily: fontStack, cursor: "pointer" }}><Sparkles size={15} /> סיור באפליקציה</button>
      </div>
      )}

      {stepAction && (
        <div data-tut="stepbanner" onClick={onStepSetup} role="button" aria-label="קביעת יעד צעדים" style={{ margin: "10px 16px 0", background: C.amberBg, border: `1.5px solid ${C.amber}`, borderRadius: 14, padding: "12px 14px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <span style={{ fontSize: 21 }}>⭐</span>
          <div style={{ flex: 1, textAlign: "right" }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{stepAction.kind === "baseline" ? "קביעת ממוצע צעדים יומי" : "היעד שלך עולה השבוע"}</div>
            <div style={{ fontSize: 13.5, color: C.sub }}>{stepAction.kind === "baseline" ? "הקישי כדי לקבוע את נקודת ההתחלה שלך" : "הקישי לעדכון היעד"}</div>
          </div>
          <ChevronLeft size={18} color={C.amber} />
        </div>
      )}
      {isIntro ? (
        <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ padding: "40px 24px 64px", textAlign: "center" }}>
          <img src={MEDAL_SRC} alt="" width={92} height={92} style={{ display: "block", margin: "0 auto 14px" }} />
          <div style={{ fontSize: 21, fontWeight: 700, color: C.ink, lineHeight: 1.4 }}>ברוכה הבאה לאפליקציית המעקב של מיי פריים 360</div>
          <div style={{ fontSize: 16, color: C.sub, marginTop: 12, lineHeight: 1.75 }}>ביומיים הראשונים עדיין אין מעקב. {progDay === 1 ? "מחרתיים" : "מחר"} מתחילות יחד, צעד אחרי צעד, ותקבלי כאן ביום שלישי את כל ההסברים על השימוש באפליקציה.</div>
        </div>
      ) : isShabbatRest ? (
        <div style={{ padding: "36px 24px 60px", textAlign: "center", color: C.faint }}>
          <div style={{ fontSize: 57, marginBottom: 12 }}>🤍</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: C.sub }}>שבת שלום</div>
          <div style={{ fontSize: 17, marginTop: 10, lineHeight: 1.7 }}>היום יום מנוחה - בלי מעקב ובלי מדידה.<br />נתראה במוצאי שבת 🌙</div>
        </div>
      ) : (
      <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} style={{ padding: "0 16px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", justifyItems: "center", alignItems: "start", rowGap: 10, columnGap: 6, marginTop: 2, marginBottom: 10 }}>
          <div data-tut="cal" style={{ gridColumn: 1, gridRow: 1 }}><Ring consumed={consumed} budget={budget} size={124} onPlus={onAddCalorie} /></div>
          {stepsOpen && <div data-tut="steps" style={{ gridColumn: 2, gridRow: 1 }}><MetricRing value={steps} goal={dayStepGoal || 0} verb="צעדת" color={C.amber} track={C.amberBg} label="צעדים" sub={dayStepGoal ? `מתוך ${dayStepGoal.toLocaleString()}` : ""} onPlus={onEditSteps} size={124} /></div>}
          {macroOpen && <div data-tut="protein" style={{ gridColumn: 1, gridRow: 2 }}><ProteinRing consumed={macros.p} target={targets.protein} size={124} /></div>}
          {waterOpen && <div data-tut="water" style={{ gridColumn: 2, gridRow: 2 }}><MetricRing value={waterMl} goal={WATER_TARGET_ML} bigText={String(waterCups)} verb="שתית" color={C.water} track={C.waterBg} label="כוסות מים" sub={`${waterMl.toLocaleString()} מ"ל מתוך ${targetCups} כוסות`} onPlus={onWater} size={124} /></div>}
        </div>
        {SHOW_MACRO_STRIP && macroOpen && (
          <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", margin: "0 0 16px" }}>
            {[{ label: "שומן", v: macros.f, t: targets.fat, color: C.macroF }, { label: "פחמימות", v: macros.c, t: targets.carbs, color: C.macroC }, { label: "סיבים", v: macros.fib, t: FIBER_TARGET, color: C.info }].map((m, i) => (
              <div key={m.label} style={{ flex: 1, textAlign: "center", padding: "5px 4px", borderInlineStart: i ? `1px solid ${C.line}` : "none" }}>
                <div style={{ fontSize: 12.5, color: C.sub, display: "inline-flex", alignItems: "center", gap: 4 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: m.color }} />{m.label}</div>
                <div style={{ fontSize: 14.5, fontWeight: 600, color: C.ink, marginTop: 1 }}>{m.v} / {m.t} ג׳</div>
              </div>
            ))}
          </div>
        )}

        {checkinOpen && ciTasks.length > 0 && <CheckinCard date={date} today={today} week={ciWeek} tasks={ciTasks} answers={ciAnswers} auto={ciAuto} locked={ciLocked} onOpen={onOpenCheckin} onOpenCollection={onOpenCollection} onOpenSummary={onOpenSummary} />}

        {dayAct.length > 0 && (
          <>
            <div style={{ fontSize: 14, color: C.faint, marginBottom: 2 }}>פעילות גופנית</div>
            {dayAct.map((a) => (
              <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 0", borderTop: `1px solid ${C.line}`, fontSize: 16 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 7, color: C.ink }}><Dumbbell size={15} color={C.info} /> {a.name}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 10 }}><span style={{ color: C.brandD, fontWeight: 500 }}>+{a.kcal}</span><button onClick={() => deleteEntry(a.id, "activity")} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><Trash2 size={14} /></button></span>
              </div>
            ))}
          </>
        )}

        <div data-tut="diarylist" style={{ fontSize: 14, fontWeight: 700, color: C.ink, margin: "16px 0 2px" }}>מה שהוזן היום</div>
        {dayLog.length === 0 && dayAct.length === 0 && <div style={{ fontSize: 16, color: C.faint, padding: "16px 0", textAlign: "center" }}>עדיין לא הוזן דבר ביום זה - הקישי על כפתור ה־+ להוספה</div>}
        {dayLog.map((e) => (
          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
            <div onClick={() => editEntry(e)} style={{ flex: 1, cursor: "pointer" }}>
              <div style={{ fontSize: 16, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}>{e.name} <SrcBadge source={e.source} /></div>
              <div style={{ fontSize: 14, color: C.faint }}>{e.meal} · {e.unit === "serving" ? `${e.servings} ${e.servings === 1 ? "מנה" : "מנות"}` : `${e.g} ${e.unit === "ml" ? "מ\"ל" : "ג׳"}`} · {e.kcal} קק״ל</div>
            </div>
            <button onClick={() => editEntry(e)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint, padding: 4 }}><Pencil size={15} /></button>
            <button onClick={() => deleteEntry(e.id)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint, padding: 4 }}><Trash2 size={15} /></button>
          </div>
        ))}
        <div style={{ textAlign: "center", fontSize: 12.5, color: C.faint, marginTop: 22 }}>MyPrime · v{VERSION}</div>
      </div>
      )}
    </div>
  );
}

function CardHeading({ icon: Icon, text, color = C.brand }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 9, marginBottom: 13, borderBottom: `1.5px solid ${C.line}` }}>
      {Icon && <Icon size={20} color={color} />}
      <span style={{ fontSize: 18.5, fontWeight: 700, color: C.ink }}>{text}</span>
    </div>
  );
}

function WeighInTips({ style }) {
  return (
    <div style={{ background: C.brandBg, borderRadius: 12, padding: "12px 14px", marginBottom: 14, ...style }}>
      <div style={{ fontSize: 14.5, fontWeight: 700, color: C.brandD, marginBottom: 8 }}>כדי לעקוב נכון אחרי השינויים במשקל, ההמלצה שלנו:</div>
      <div style={{ fontSize: 14.5, color: C.ink, lineHeight: 1.75 }}>
        <div>1. להישקל פעם אחת בשבוע בלבד</div>
        <div>2. תמיד באותו יום בשבוע</div>
        <div>3. דבר ראשון בבוקר, רצוי ללא בגדים</div>
      </div>
    </div>
  );
}

function ReportScreen({ weights, addWeight, log, targets, programWeek, stepsByDate = {}, startDate, stepGoalStored, stepsOpen, today = TODAY, onEditSteps }) {
  const data = weights.map((w) => ({ ...w, label: `${new Date(w.date).getDate()}/${new Date(w.date).getMonth() + 1}` }));
  const change = Math.round((weights[weights.length - 1].kg - weights[0].kg) * 10) / 10;
  const current = weights[weights.length - 1].kg;
  const lastWDate = new Date(weights[weights.length - 1].date);
  const lastWUpdate = `${lastWDate.getDate()}.${lastWDate.getMonth() + 1}.${lastWDate.getFullYear()}`;
  const calByDate = {};
  log.forEach((e) => { calByDate[e.date] = (calByDate[e.date] || 0) + e.kcal; });
  const goalKcal = targets.targetKcal;
  const calSeries = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(TODAY, i - 6);
    const dd = new Date(d);
    return { label: `${dd.getDate()}/${dd.getMonth() + 1}`, kcal: Math.round(calByDate[d] || 0) };
  });
  const loggedDays = calSeries.filter((x) => x.kcal > 0);
  // A day counts as "met the calorie goal" only if she ate CLOSE to the target. Trivial/partial logging
  // (e.g. a single item, far below target) or strong under-eating does not count as meeting the goal.
  const calMet = (kc) => goalKcal > 0 && kc >= goalKcal * 0.8 && kc <= goalKcal * 1.05;
  const metDays = loggedDays.filter((x) => calMet(x.kcal)).length;
  const daysOnTarget = `${metDays}/${loggedDays.length}`;
  const maxCal = Math.max(goalKcal, ...calSeries.map((x) => x.kcal));
  const proteinFocus = programWeek >= MACRO_UNLOCK.week;
  const cardBox = { border: `1.5px solid ${C.brand}`, borderRadius: 16, padding: 16, marginBottom: 16, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" };
  const jumpBtn = { flex: 1, border: `1.5px solid ${C.brand}`, background: C.panel, color: C.ink, borderRadius: 12, padding: "10px 6px", fontSize: 14, fontWeight: 600, fontFamily: fontStack, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 };
  const stepsRef = useRef(null), calRef = useRef(null), weightRef = useRef(null);
  const jump = (r) => r.current && r.current.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div style={{ padding: "8px 16px 16px" }}>
      <Header title="דוח התקדמות" />
      <div style={{ marginBottom: 12 }}><span style={{ fontSize: 14, background: C.brandBg, color: C.brandD, padding: "4px 10px", borderRadius: 20 }}>שבוע {programWeek} בתוכנית</span></div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {stepsOpen && <button onClick={() => jump(stepsRef)} style={jumpBtn}><Footprints size={15} color={C.brand} /> דוח צעדים</button>}
        <button onClick={() => jump(calRef)} style={jumpBtn}><Target size={15} color={C.brand} /> יעד קלורי</button>
        <button onClick={() => jump(weightRef)} style={jumpBtn}><TrendingDown size={15} color={C.brand} /> משקל</button>
      </div>
      {stepsOpen && (() => {
        const sData = Array.from({ length: 14 }, (_, i) => {
          const d = addDays(today, -13 + i);
          return { label: `${new Date(d).getDate()}/${new Date(d).getMonth() + 1}`, steps: stepsByDate[d] || 0 };
        });
        const stepsToday = stepsByDate[today] || 0;
        const baseline = stepBaseline(stepsByDate, startDate);
        const goal = effectiveStepGoal(stepGoalStored, programWeek);
        const avg7s = steps7stats(stepsByDate, today);
        const avg7 = avg7s.avg;
        const avg7Label = avg7s.n <= 0 ? "ממוצע 7 ימים" : avg7s.n === 1 ? "ממוצע יום אחד" : `ממוצע ${avg7s.n} ימים`;
        const maxStep = Math.max(goal || 0, ...sData.map((x) => x.steps), 1);
        const cells = [
          { label: "היעד היומי", val: goal ? goal.toLocaleString() : "במדידה", hl: true },
          { label: avg7Label, val: avg7.toLocaleString() },
        ];
        return (
          <div ref={stepsRef} style={cardBox}>
            <CardHeading icon={Footprints} text="דוח צעדים" />
            <div style={{ display: "flex", border: `1.5px solid ${C.brand}`, borderRadius: 12, overflow: "hidden", marginBottom: 12 }}>
              {cells.map((c, i) => (
                <div key={i} style={{ flex: 1, textAlign: "center", padding: "12px 6px", borderInlineStart: i === 0 ? "none" : `1px solid ${C.line}`, background: c.hl ? C.brandBg : "transparent" }}>
                  <div style={{ fontSize: 13.5, color: C.sub, marginBottom: 5 }}>{c.label}</div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: c.hl ? C.brandD : C.ink, lineHeight: 1.1 }}>{c.val}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12.5, color: C.faint, textAlign: "center", marginTop: -6, marginBottom: 12 }}>הממוצע מחושב לפי הימים שהזנת בהם צעדים, מתוך 7 הימים האחרונים</div>
            <div style={{ fontSize: 13, color: C.faint, marginBottom: 2 }}>צעדים יומיים - 14 הימים האחרונים</div>
            <div style={{ height: 150, margin: "6px -6px 0" }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sData} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
                  <XAxis dataKey="label" tick={{ fontSize: 12, fill: C.faint }} axisLine={false} tickLine={false} interval={1} />
                  <YAxis domain={[0, maxStep]} hide />
                  <Tooltip contentStyle={{ fontSize: 15, borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontStack }} formatter={(v) => [`${Number(v).toLocaleString()} צעדים`, ""]} labelFormatter={(l) => l} />
                  {goal && <ReferenceLine y={goal} stroke={C.brand} strokeDasharray="4 4" label={{ value: `יעד`, position: "insideTopRight", fontSize: 12, fill: C.brandD }} />}
                  <Bar dataKey="steps" radius={[4, 4, 0, 0]}>
                    {sData.map((d, i) => (<Cell key={i} fill={d.steps === 0 ? C.line : (goal && d.steps >= goal) ? C.brand : C.proteinTrack} />))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={onEditSteps} style={{ padding: "9px" }}>+ עדכון צעדים להיום</Btn></div>
            <StepGuideLink style={{ marginTop: 10 }} />
          </div>
        );
      })()}

      <div ref={calRef} style={cardBox}>
        <CardHeading icon={Target} text="עמידה ביעד הקלורי" />
        <div style={{ fontSize: 14, color: C.sub, marginBottom: 10 }}>
          {loggedDays.length > 0
            ? <>עמדת ביעד <b style={{ color: C.brandD }}>{metDays} מתוך {loggedDays.length}</b> הימים האחרונים 🎯</>
            : "עדיין אין נתוני אכילה לשבוע הזה"}
        </div>
        {loggedDays.length > 0 && (
          <div style={{ height: 140, margin: "0 -6px" }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={calSeries} margin={{ top: 12, right: 8, left: 8, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 13, fill: C.faint }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, Math.round(maxCal * 1.15)]} hide />
                <Tooltip contentStyle={{ fontSize: 15, borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontStack }} formatter={(v) => [`${v.toLocaleString()} קק״ל`, "נאכל"]} labelFormatter={() => ""} cursor={{ fill: "rgba(212,93,121,0.06)" }} />
                <ReferenceLine y={goalKcal} stroke={C.brand} strokeDasharray="4 4" label={{ value: `יעד ${goalKcal.toLocaleString()}`, position: "insideTopRight", fontSize: 12, fill: C.brandD }} />
                <Bar dataKey="kcal" radius={[6, 6, 0, 0]}>
                  {calSeries.map((d, i) => (<Cell key={i} fill={d.kcal === 0 ? C.line : calMet(d.kcal) ? C.brand : C.amber} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
      <div ref={weightRef} style={cardBox}>
        <CardHeading icon={TrendingDown} text="דוח משקל" />
        <WeighInTips />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
          <div><div style={{ fontSize: 14, color: C.sub }}>משקל <span style={{ fontSize: 12.5, color: C.faint }}>(עדכון אחרון: {lastWUpdate})</span></div><div style={{ fontSize: 29, fontWeight: 600, color: C.ink }}>{current} <span style={{ fontSize: 16, color: C.sub }}>ק״ג</span></div></div>
          <span style={{ fontSize: 15, background: C.brandBg, color: C.brandD, padding: "4px 10px", borderRadius: 8, display: "flex", alignItems: "center", gap: 3 }}><ArrowDownRight size={14} /> {Math.abs(change)} ק״ג</span>
        </div>
        <div style={{ fontSize: 13, color: C.faint, marginBottom: 2 }}>המשקל שהזנת בפועל לאורך זמן (לא תחזית)</div>
        <div style={{ height: 150, margin: "6px -6px 0" }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 6, right: 8, left: 8, bottom: 0 }}>
              <defs><linearGradient id="wg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.brand} stopOpacity={0.2} /><stop offset="100%" stopColor={C.brand} stopOpacity={0} /></linearGradient></defs>
              <XAxis dataKey="label" tick={{ fontSize: 13, fill: C.faint }} axisLine={false} tickLine={false} />
              <YAxis domain={["dataMin - 0.5", "dataMax + 0.5"]} hide />
              <Tooltip contentStyle={{ fontSize: 15, borderRadius: 8, border: `1px solid ${C.line}`, fontFamily: fontStack }} formatter={(v) => [`${v} ק״ג`, "משקל"]} labelFormatter={() => ""} />
              <Area type="monotone" dataKey="kg" stroke={C.brand} strokeWidth={2.5} fill="url(#wg)" dot={{ r: 3, fill: C.brand }} activeDot={{ r: 5, fill: C.brandD }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={addWeight} style={{ padding: "9px" }}>+ הזיני משקל</Btn></div>
      </div>
      {proteinFocus ? (
        <div style={cardBox}>
          <CardHeading icon={Dumbbell} text="יעד חלבון" color={C.macroP} />
          <div style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 29, fontWeight: 700, color: C.macroP }}>{targets.protein} <span style={{ fontSize: 16, color: C.sub }}>ג׳</span></div>
              <div style={{ fontSize: 13.5, color: C.sub, marginTop: 4 }}>היעד היומי שלך לחלבון</div>
            </div>
            <div style={{ flex: 1, borderInlineStart: `1px solid ${C.line}`, paddingInlineStart: 14 }}>
              <div style={{ fontSize: 29, fontWeight: 700, color: C.ink }}>{daysOnTarget}</div>
              <div style={{ fontSize: 13.5, color: C.sub, marginTop: 4 }}>ימים ביעד</div>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ background: C.bg, borderRadius: 10, padding: 10, marginBottom: 10 }}>
          <div style={{ fontSize: 13, color: C.sub }}>ימים ביעד</div>
          <div style={{ fontSize: 21, fontWeight: 600, color: C.ink }}>{daysOnTarget}</div>
        </div>
      )}
    </div>
  );
}

function RecipeDetail({ r, onBack, onAdd }) {
  const stat = (label, value, color) => (
    <div style={{ flex: 1, textAlign: "center", padding: "8px 4px" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || C.ink }}>{value}</div>
      <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{label}</div>
    </div>
  );
  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ position: "relative" }}>
        <img src={r.img} alt={r.name} style={{ width: "100%", height: 230, objectFit: "cover", display: "block" }} />
        <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0) 55%)" }} />
        <button onClick={onBack} style={{ position: "absolute", top: 12, insetInlineStart: 12, width: 38, height: 38, borderRadius: "50%", border: "none", background: "rgba(255,255,255,0.92)", color: C.ink, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.2)" }}><ChevronRight size={22} /></button>
        <div style={{ position: "absolute", bottom: 12, insetInlineStart: 16, insetInlineEnd: 16, color: "#fff", fontSize: 23, fontWeight: 700, lineHeight: 1.3, textShadow: "0 1px 6px rgba(0,0,0,0.5)" }}>{r.name}</div>
      </div>

      <div style={{ padding: "14px 16px 0" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <span style={{ fontSize: 14, color: C.brandD, background: C.brandBg, padding: "6px 12px", borderRadius: 16, display: "flex", alignItems: "center", gap: 5 }}><Clock size={14} /> {r.prep}</span>
          <span style={{ fontSize: 14, color: C.sub, background: C.bg, padding: "6px 12px", borderRadius: 16 }}>מנות: {r.servings}</span>
          <span style={{ fontSize: 14, color: C.sub, background: C.bg, padding: "6px 12px", borderRadius: 16 }}>קושי: {r.diff}</span>
        </div>

        <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 14 }}>
          {stat("קלוריות", r.kcal, C.brand)}
          <div style={{ width: 1, background: C.line }} />
          {stat("חלבון (ג׳)", r.p, C.macroP)}
          <div style={{ width: 1, background: C.line }} />
          {stat("שומן (ג׳)", r.f, C.macroF)}
          <div style={{ width: 1, background: C.line }} />
          {stat("פחמ׳ (ג׳)", r.c, C.macroC)}
        </div>

        <div style={{ marginBottom: 16 }}><Btn onClick={() => onAdd(r)}><Plus size={16} style={{ verticalAlign: -3, marginLeft: 4 }} /> הוסיפי מנה ליומן</Btn></div>

        <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, margin: "4px 0 8px" }}>מרכיבים</div>
        <div style={{ marginBottom: 18 }}>
          {r.ing.map((line, i) => {
            const isHeader = line.trim().endsWith(":");
            return isHeader
              ? <div key={i} style={{ fontSize: 15, fontWeight: 700, color: C.brandD, margin: i === 0 ? "0 0 6px" : "12px 0 6px" }}>{line.replace(/:$/, "")}</div>
              : <div key={i} style={{ display: "flex", gap: 9, fontSize: 15.5, color: C.ink, lineHeight: 1.5, marginBottom: 7 }}><span style={{ color: C.brand, marginTop: 7, width: 6, height: 6, borderRadius: "50%", background: C.brand, flexShrink: 0 }} /><span>{line}</span></div>;
          })}
        </div>

        <div style={{ fontSize: 17, fontWeight: 700, color: C.ink, margin: "4px 0 10px" }}>אופן ההכנה</div>
        <div style={{ marginBottom: r.tips && r.tips.length ? 18 : 4 }}>
          {r.steps.map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 10, marginBottom: 12 }}>
              <div style={{ flexShrink: 0, width: 26, height: 26, borderRadius: "50%", background: C.brandBg, color: C.brandD, fontSize: 14, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{i + 1}</div>
              <div style={{ fontSize: 15.5, color: C.ink, lineHeight: 1.6, paddingTop: 2 }}>{s}</div>
            </div>
          ))}
        </div>

        {r.tips && r.tips.length > 0 && (
          <div style={{ background: C.amberBg, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: C.amber, marginBottom: 7, display: "flex", alignItems: "center", gap: 6 }}><Sparkles size={15} /> טיפים ושדרוגים</div>
            {r.tips.map((t, i) => (
              <div key={i} style={{ fontSize: 14.5, color: C.ink, lineHeight: 1.55, marginBottom: 6, display: "flex", gap: 8 }}><span style={{ color: C.amber }}>•</span><span>{t}</span></div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RecipesScreen({ addRecipe, sweetsOpen }) {
  const [section, setSection] = useState("recipes");
  const [seenSweets, setSeenSweets] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filter, setFilter] = useState("הכל");
  const [query, setQuery] = useState("");

  if (selected) {
    return <RecipeDetail r={selected} onBack={() => setSelected(null)} onAdd={addRecipe} />;
  }

  const isSweets = section === "sweets";
  const items = isSweets ? SWEETS : RECIPES;
  const subtitle = isSweets
    ? "הפינה המתוקה של מיי פריים - פינוקים מתוקים עם כמה שפחות סוכר, ועם חלבון לערך מוסף. כדאי להגביל לכמות שנקבעה מראש."
    : "חוברת המתכונים של מיי פריים - עשירים בחלבון, דלים בפחמימות ומשולבים מזונות אנטי-דלקתיים.";
  const goSection = (s) => { setSection(s); setFilter("הכל"); setQuery(""); if (s === "sweets") setSeenSweets(true); };
  const segBtn = (s, label, icon) => (
    <button onClick={() => goSection(s)} style={{ position: "relative", flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, border: "none", cursor: "pointer", borderRadius: 11, padding: "9px 6px", fontFamily: fontStack, fontSize: 16, fontWeight: 600, background: section === s ? C.panel : "transparent", color: section === s ? C.brandD : C.sub, boxShadow: section === s ? "0 1px 4px rgba(168,66,92,0.14)" : "none" }}>
      {icon}{label}
      {s === "sweets" && !seenSweets && <span style={{ position: "absolute", top: 2, insetInlineEnd: 8, fontSize: 11, fontWeight: 600, background: C.brand, color: "#fff", padding: "1px 6px", borderRadius: 8 }}>חדש</span>}
    </button>
  );

  const cats = ["הכל", ...Array.from(new Set(items.map((r) => r.cat).filter(Boolean)))];
  const filtered = items.filter((r) => {
    if (query && !r.name.includes(query)) return false;
    if (filter !== "הכל") return r.cat === filter;
    return true;
  });
  const fchip = (t) => ({ fontSize: 15, padding: "6px 13px", borderRadius: 20, cursor: "pointer", whiteSpace: "nowrap", background: filter === t ? C.ink : "transparent", color: filter === t ? "#fff" : C.sub, boxShadow: filter === t ? "none" : `inset 0 0 0 1px ${C.line}` });

  return (
    <div style={{ padding: "8px 16px 16px", position: "relative" }}>
      <Header title={isSweets ? "מתוקים" : "מתכונים"} />

      {sweetsOpen && (
        <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 14, padding: 4, marginBottom: 12 }}>
          {segBtn("recipes", "מתכונים", <ChefHat size={17} />)}
          {segBtn("sweets", "מתוקים", <Cookie size={17} />)}
        </div>
      )}

      <div style={{ fontSize: 14.5, color: C.sub, marginBottom: 12, lineHeight: 1.5 }}>{subtitle}</div>

      <div style={{ position: "relative", marginBottom: 12 }}>
        <Search size={16} style={{ position: "absolute", insetInlineStart: 12, top: 12, color: C.faint }} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={isSweets ? "חיפוש מתוק…" : "חיפוש מתכון…"} style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 12, padding: "10px 36px", fontSize: 15.5, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", background: C.panel }} />
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", paddingBottom: 2 }}>
        {cats.map((t) => (<span key={t} onClick={() => setFilter(t)} style={fchip(t)}>{t}</span>))}
      </div>

      {filtered.map((r) => (
        <div key={r.id} onClick={() => setSelected(r)} style={{ border: `1px solid ${C.line}`, borderRadius: 16, overflow: "hidden", marginBottom: 14, cursor: "pointer", background: C.panel, boxShadow: "0 1px 6px rgba(168,66,92,0.05)" }}>
          <div style={{ position: "relative" }}>
            <img src={r.img} alt={r.name} loading="lazy" style={{ width: "100%", height: 158, objectFit: "cover", display: "block" }} />
            <button onClick={(e) => { e.stopPropagation(); addRecipe(r); }} style={{ position: "absolute", bottom: 10, insetInlineEnd: 10, width: 38, height: 38, borderRadius: "50%", border: "none", background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}><Plus size={20} /></button>
          </div>
          <div style={{ padding: "11px 13px 13px" }}>
            <div style={{ fontSize: 16.5, fontWeight: 600, color: C.ink, marginBottom: 7, lineHeight: 1.35 }}>{r.name}</div>
            <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: C.brandD, background: C.brandBg, padding: "3px 9px", borderRadius: 12 }}>{r.kcal} קק״ל</span>
              <span style={{ fontSize: 13, color: C.macroP, background: C.proteinTrack, padding: "3px 9px", borderRadius: 12 }}>חלבון {r.p} ג׳</span>
              <span style={{ fontSize: 13, color: C.sub, background: C.bg, padding: "3px 9px", borderRadius: 12, display: "flex", alignItems: "center", gap: 4 }}><Clock size={12} /> {r.prep}</span>
            </div>
          </div>
        </div>
      ))}
      {filtered.length === 0 && <div style={{ fontSize: 15, color: C.faint, textAlign: "center", padding: 24 }}>לא נמצאו מתכונים תואמים.</div>}
    </div>
  );
}

function RecipeAddModal({ recipe, editEntry, onSave, onClose, onDelete }) {
  const editing = !!editEntry;
  const name = editing ? editEntry.name : recipe.name;
  const base = editing ? (editEntry.base || { kcal: editEntry.kcal, p: editEntry.p, f: editEntry.f, c: editEntry.c }) : { kcal: recipe.kcal, p: recipe.p, f: recipe.f, c: recipe.c };
  const hour = new Date().getHours();
  const defMeal = hour < 11 ? "בוקר" : hour < 16 ? "צהריים" : hour < 21 ? "ערב" : "נשנושים";
  const [meal, setMeal] = useState(editing ? editEntry.meal : defMeal);
  const [servings, setServings] = useState(editing ? (editEntry.servings || 1) : 1);
  const n = { kcal: Math.round(base.kcal * servings), p: Math.round(base.p * servings), f: Math.round(base.f * servings), c: Math.round(base.c * servings) };
  const save = () => onSave({ meal, name, source: "verified", unit: "serving", servings, base, kcal: n.kcal, p: n.p, f: n.f, c: n.c }, editing ? editEntry.id : null);
  const stat = (label, value, color) => (
    <div style={{ flex: 1, textAlign: "center", padding: "8px 4px" }}>
      <div style={{ fontSize: 18, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 12, color: C.sub, marginTop: 2 }}>{label}</div>
    </div>
  );
  return (
    <SheetShell title={editing ? "עריכת מנה" : "הוספה ליומן"} onClose={onClose}>
      <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, marginBottom: 16, lineHeight: 1.35 }}>{name}</div>

      <div style={{ fontSize: 14, color: C.sub, marginBottom: 7 }}>שיוך לארוחה</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 18 }}>
        {MEALS.map((m) => (<span key={m} onClick={() => setMeal(m)} style={{ fontSize: 15, padding: "6px 13px", borderRadius: 16, cursor: "pointer", background: m === meal ? C.brand : "transparent", color: m === meal ? "#fff" : C.sub, boxShadow: m === meal ? "none" : `inset 0 0 0 1px ${C.line}` }}>{m}</span>))}
      </div>

      <div style={{ fontSize: 14, color: C.sub, marginBottom: 10 }}>כמות מנות</div>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
        <Stepper value={servings} set={setServings} step={0.5} min={0.5} suffix={servings === 1 ? "מנה" : "מנות"} />
      </div>

      <div style={{ display: "flex", border: `1px solid ${C.line}`, borderRadius: 14, overflow: "hidden", marginBottom: 18 }}>
        {stat("קלוריות", n.kcal, C.brand)}
        <div style={{ width: 1, background: C.line }} />
        {stat("חלבון (ג׳)", n.p, C.macroP)}
        <div style={{ width: 1, background: C.line }} />
        {stat("שומן (ג׳)", n.f, C.macroF)}
        <div style={{ width: 1, background: C.line }} />
        {stat("פחמ׳ (ג׳)", n.c, C.macroC)}
      </div>

      <div style={{ marginBottom: editing ? 10 : 0 }}><Btn onClick={save}><Check size={16} style={{ verticalAlign: -3, marginLeft: 4 }} /> {editing ? "עדכן" : "הוסף ליומן"}</Btn></div>
      {editing && <Btn variant="ghost" onClick={onDelete}>מחק פריט</Btn>}
    </SheetShell>
  );
}

function ProfileScreen({ profile, setProfile, targets, onReset, onLogout, userName, stepsByDate, programWeek, onOpenFaq, onOpenBackup, maxStart, gateEmail }) {
  const [edit, setEdit] = useState(null); // { key, label, type, value, step, min, suffix }
  const [pendingWeight, setPendingWeight] = useState(null); // { key, value } awaiting confirm
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const effStepGoal = effectiveStepGoal(profile.stepGoal, programWeek || 1);
  const [baseOpen, setBaseOpen] = useState(false);
  const [newSens, setNewSens] = useState("");
  const customSens = (profile.dislikes || "").split(",").map((s) => s.trim()).filter(Boolean);
  const addSens = () => { const t = newSens.trim(); if (!t) return; if (!customSens.includes(t)) setProfile({ ...profile, dislikes: [...customSens, t].join(", ") }); setNewSens(""); };
  const removeSens = (t) => setProfile({ ...profile, dislikes: customSens.filter((x) => x !== t).join(", ") });
  const open = (cfg) => setEdit({ ...cfg, value: cfg.init });
  const commit = () => { const k = edit.key; if (k === "weightKg" || k === "goalWeightKg") { setPendingWeight({ key: k, value: edit.value }); setEdit(null); return; } setProfile({ ...profile, [k]: edit.value }); setEdit(null); };
  const confirmWeight = () => { if (pendingWeight) setProfile({ ...profile, [pendingWeight.key]: pendingWeight.value }); setPendingWeight(null); };
  const cycle = (arr, cur) => arr[(arr.indexOf(cur) + 1) % arr.length];
  const startLabel = (listSundays().find((s) => s.value === profile.startDate) || {}).label || profile.startDate;
  const calNow = profile.calorieOverride || targets.targetKcal;

  const EditRow = ({ label, display, onClick }) => (
    <div onClick={onClick} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 16, padding: "12px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>
      <span style={{ color: C.sub }}>{label}</span>
      <span style={{ fontWeight: 600, color: C.brandD, display: "flex", alignItems: "center", gap: 6 }}>{display} <Pencil size={13} color={C.faint} /></span>
    </div>
  );

  return (
    <div style={{ padding: "8px 16px 16px" }}>
      <Header title="פרופיל" />
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ width: 44, height: 44, borderRadius: "50%", background: C.brandBg, color: C.brandD, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 600 }}>{((profile.name || userName || "").trim().charAt(0)) || "♥"}</div>
        <div><div style={{ fontSize: 18, fontWeight: 500, color: C.ink }}>{profile.name || userName || "משתמשת"}</div><div style={{ fontSize: 14, color: C.faint }}>{rateLabel(profile.weeklyRateG)}</div></div>
      </div>

      <div style={{ borderTop: `1px solid ${C.line}` }}>
        <div onClick={() => setBaseOpen(!baseOpen)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "13px 0", cursor: "pointer" }}>
          <span style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>נתוני בסיס</span>
          <ChevronDown size={20} color={C.sub} style={{ transform: baseOpen ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
        </div>
        {baseOpen && (
          <div style={{ paddingBottom: 4 }}>
            <EditRow label="גיל" display={profile.age} onClick={() => open({ key: "age", label: "גיל", type: "num", step: 1, min: 18, init: profile.age })} />
            <EditRow label="גובה" display={`${profile.heightCm} ס״מ`} onClick={() => open({ key: "heightCm", label: "גובה", type: "num", step: 1, min: 120, suffix: "ס״מ", init: profile.heightCm })} />
            <EditRow label="משקל התחלתי" display={`${profile.weightKg} ק״ג`} onClick={() => open({ key: "weightKg", label: "משקל התחלתי", type: "num", step: 0.5, min: minHealthyKg(profile.heightCm), suffix: "ק״ג", init: profile.weightKg, hint: `המינימום הבריא לגובה שלך הוא ${minHealthyKg(profile.heightCm)} ק״ג.` })} />
            <EditRow label="משקל יעד" display={`${profile.goalWeightKg} ק״ג`} onClick={() => open({ key: "goalWeightKg", label: "משקל יעד", type: "num", step: 0.5, min: minHealthyKg(profile.heightCm), suffix: "ק״ג", init: profile.goalWeightKg, hint: `המינימום הבריא לגובה שלך הוא ${minHealthyKg(profile.heightCm)} ק״ג.` })} />
            <EditRow label="קצב ירידה" display={rateShort(profile.weeklyRateG)} onClick={() => open({ key: "weeklyRateG", label: "קצב ירידה", type: "rate", init: profile.weeklyRateG })} />
            <EditRow label="תחילת התוכנית" display={startLabel} onClick={() => open({ key: "startDate", label: "תחילת התוכנית", type: "date", init: profile.startDate })} />
            <div onClick={() => setProfile({ ...profile, keepShabbat: !profile.keepShabbat })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 16, color: C.ink }}>שומרת שבת</div>
                <div style={{ fontSize: 13.5, color: C.sub, marginTop: 2 }}>שבת תופיע אפורה ובלי מעקב יומי</div>
              </div>
              <div style={{ width: 46, height: 27, borderRadius: 14, background: profile.keepShabbat ? C.brand : C.line, position: "relative", transition: "background .2s", flexShrink: 0 }}>
                <div style={{ position: "absolute", top: 3, left: profile.keepShabbat ? 22 : 3, width: 21, height: 21, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
              </div>
            </div>
            {programWeekFor(profile.startDate, TODAY) >= 8 && (
              <div onClick={() => setProfile({ ...profile, fasting: !profile.fasting })} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>
                <div>
                  <div style={{ fontSize: 16, color: C.ink }}>צום לסירוגין</div>
                  <div style={{ fontSize: 13.5, color: C.sub, marginTop: 2 }}>מבצעת צום לסירוגין (רשות) - יופיע בסיכום השבועי</div>
                </div>
                <div style={{ width: 46, height: 27, borderRadius: 14, background: profile.fasting ? C.brand : C.line, position: "relative", transition: "background .2s", flexShrink: 0 }}>
                  <div style={{ position: "absolute", top: 3, left: profile.fasting ? 22 : 3, width: 21, height: 21, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)" }} />
                </div>
              </div>
            )}
            <div onClick={onOpenBackup} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "11px 0", borderTop: `1px solid ${C.line}`, cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 16, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}><Lock size={15} color={C.sub} />גיבוי מוצפן: {profile.backup && profile.backup.enabled ? "מופעל" : "כבוי"}{profile.backup && profile.backup.enabled ? <Check size={15} color={C.brand} /> : null}</div>
                <div style={{ fontSize: 13.5, color: C.sub, marginTop: 2 }}>{profile.backup && profile.backup.enabled ? "מגובה אוטומטית, רק את יכולה לפתוח" : "הפעלת גיבוי מוצפן בענן"}</div>
              </div>
              <ChevronDown size={20} color={C.sub} style={{ transform: "rotate(-90deg)", flexShrink: 0 }} />
            </div>
            <div style={{ fontSize: 14, color: C.faint, marginTop: 8 }}>את כעת בשבוע {programWeekFor(profile.startDate, TODAY)} בתוכנית.</div>
          </div>
        )}
      </div>

      <div onClick={() => open({ key: "calorieOverride", label: "יעד קלורי יומי", type: "calorie", init: profile.calorieOverride || targets.targetKcal })} style={{ background: C.brandBg, borderRadius: 12, padding: 12, marginTop: 16, marginBottom: 12, cursor: "pointer" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", border: `2px solid ${C.brand}`, borderRadius: 10, padding: "9px 11px", background: "#fff" }}>
          <span style={{ fontSize: 14, color: C.brandD }}>יעד קלורי יומי</span>
          <span style={{ fontWeight: 600, color: C.brandD, display: "flex", alignItems: "center", gap: 6 }}>{calNow.toLocaleString()} קק״ל {profile.calorieOverride ? "" : <span style={{ fontSize: 12, color: C.sub }}>(מומלץ)</span>} <Pencil size={13} color={C.faint} /></span>
        </div>
        {programWeekFor(profile.startDate, TODAY) >= MACRO_UNLOCK.week && <div style={{ marginTop: 12 }} onClick={(e) => e.stopPropagation()}><MacroRow p={targets.protein} f={targets.fat} c={targets.carbs} tp={targets.protein} tf={targets.fat} tc={targets.carbs} headline /></div>}
      </div>

      <div onClick={() => open({ key: "stepGoal", label: "יעד צעדים יומי", type: "num", step: 500, min: 0, suffix: "צעדים", init: effStepGoal != null ? effStepGoal : 2000 })} style={{ background: C.amberBg, borderRadius: 12, padding: 12, marginBottom: 14, cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 14, color: C.amber, display: "flex", alignItems: "center", gap: 6 }}><Footprints size={15} color={C.amber} /> יעד צעדים יומי</span>
          {profile.stepBaseline != null && <span style={{ fontSize: 12.5, color: C.faint }}>התחלת ב-{profile.stepBaseline.toLocaleString()}</span>}
        </span>
        <span style={{ fontWeight: 600, color: C.amber, display: "flex", alignItems: "center", gap: 6 }}>{effStepGoal != null ? `${effStepGoal.toLocaleString()} צעדים` : "מודדת ממוצע"} <Pencil size={13} color={C.faint} /></span>
      </div>

      <div style={{ background: C.bg, borderRadius: 14, padding: 14, marginBottom: 4 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: C.ink, marginBottom: 10 }}>העדפות תזונה</div>
        <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>סגנון תזונה (משמש להמלצות)</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
          {DIET_OPTIONS.map((d) => {
            const on = (profile.diet || []).includes(d.id);
            return (<span key={d.id} onClick={() => setProfile({ ...profile, diet: on ? (profile.diet || []).filter((x) => x !== d.id) : [...(profile.diet || []), d.id] })} style={{ fontSize: 15, padding: "6px 13px", borderRadius: 16, cursor: "pointer", background: on ? C.brand : C.panel, color: on ? "#fff" : C.sub, boxShadow: on ? "none" : `inset 0 0 0 1px ${C.line}` }}>{d.emoji} {d.id}</span>);
          })}
        </div>
        <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>רגישויות ואלרגיות (להימנע)</div>
        <div style={{ fontSize: 13.5, color: C.ink, lineHeight: 1.6, marginBottom: 12 }}>מה שתסמני ותכתבי כאן נשמר ומוזן ל-AI כדי להתחשב בזה בהמלצות. עדיין כדאי לבדוק רכיבים בעצמך; זה כלי עזר ולא תחליף לייעוץ רפואי.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {SENSITIVITY_OPTIONS.map((s) => {
            const on = (profile.allergies || []).includes(s);
            return (<span key={s} onClick={() => setProfile({ ...profile, allergies: on ? (profile.allergies || []).filter((x) => x !== s) : [...(profile.allergies || []), s] })} style={{ fontSize: 15, padding: "6px 13px", borderRadius: 16, cursor: "pointer", background: on ? C.brand : C.panel, color: on ? "#fff" : C.sub, boxShadow: on ? "none" : `inset 0 0 0 1px ${C.line}` }}>{s}</span>);
          })}
        </div>
        <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>רגישויות נוספות</div>
        <div style={{ display: "flex", gap: 6, marginBottom: customSens.length ? 10 : 0 }}>
          <input value={newSens} onChange={(e) => setNewSens(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSens(); } }} placeholder="הקלידי והוסיפי (למשל: בלי חריף)" style={{ flex: 1, border: `1.5px solid ${C.brand}`, borderRadius: 10, padding: "11px 12px", fontSize: 15, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", background: C.panel }} />
          <button onClick={addSens} aria-label="הוספה" style={{ flexShrink: 0, width: 46, borderRadius: 10, border: "none", background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={18} /></button>
        </div>
        {customSens.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {customSens.map((s) => (
              <span key={s} style={{ fontSize: 15, padding: "6px 9px 6px 13px", borderRadius: 16, background: C.brand, color: "#fff", display: "inline-flex", alignItems: "center", gap: 6 }}>
                {s}
                <button onClick={() => removeSens(s)} aria-label="הסרה" style={{ border: "none", background: "transparent", color: "#fff", cursor: "pointer", display: "flex", padding: 0 }}><X size={14} /></button>
              </span>
            ))}
          </div>
        )}
      </div>

      <ReminderRow email={gateEmail} />

      <div onClick={onOpenFaq} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderTop: `1px solid ${C.line}`, marginTop: 8, cursor: "pointer" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 600, color: C.ink }}><Info size={18} color={C.brand} /> שאלות, תשובות ועזרה</span>
        <ChevronLeft size={18} color={C.faint} />
      </div>

      <div style={{ marginTop: 16 }}><Btn variant="ghost" onClick={() => setConfirmReset(true)} style={{ color: C.sub }}>מחיקת כל הנתונים והתחלה מחדש</Btn></div>
      <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={() => setConfirmLogout(true)} style={{ color: C.sub }}>התנתקות מהמכשיר הזה</Btn></div>
      <div style={{ fontSize: 13, color: C.faint, lineHeight: 1.55, marginTop: 6, textAlign: "center" }}>משחרר את המכשיר הזה ומחזיר למסך הכניסה. הנתונים שלך נשמרים, ותוכלי להיכנס שוב עם המייל.</div>
      <div style={{ textAlign: "center", fontSize: 13, color: C.faint, marginTop: 12 }}>גרסה v{VERSION}</div>

      {edit && (
        <div onClick={() => setEdit(null)} style={{ position: "fixed", inset: 0, background: "rgba(58,43,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 18, padding: "18px 18px 20px", width: "100%", maxWidth: 340, fontFamily: fontStack }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <span style={{ fontSize: 19, fontWeight: 600, color: C.ink }}>{edit.label}</span>
              <button onClick={() => setEdit(null)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><X size={20} /></button>
            </div>

            {(edit.type === "num") && (
              <>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: edit.hint ? 8 : 18 }}>
                  <Stepper value={edit.value} set={(v) => setEdit({ ...edit, value: Math.max(edit.min || 0, v) })} step={edit.step} min={edit.min} suffix={edit.suffix} />
                </div>
                {edit.hint && <div style={{ fontSize: 13.5, color: C.faint, textAlign: "center", marginBottom: 18, lineHeight: 1.5 }}>{edit.hint}</div>}
              </>
            )}

            {edit.type === "calorie" && (
              <>
                <div style={{ display: "flex", justifyContent: "center", marginBottom: 10 }}>
                  <Stepper value={edit.value} set={(v) => setEdit({ ...edit, value: Math.max(KCAL_FLOOR, v) })} step={10} min={KCAL_FLOOR} suffix="קק״ל" />
                </div>
                <div onClick={() => { setProfile({ ...profile, calorieOverride: null }); setEdit(null); }} style={{ textAlign: "center", fontSize: 14, color: C.brandD, textDecoration: "underline", cursor: "pointer", marginBottom: 18 }}>אפסי למומלץ ({targets.targetKcal.toLocaleString()})</div>
              </>
            )}

            {edit.type === "rate" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
                {RATE_OPTIONS.map((r) => {
                  const sel = edit.value === r; const rec = r === 250;
                  return (
                    <button key={r} onClick={() => setEdit({ ...edit, value: r })} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: `${rec ? 2 : 1.5}px solid ${sel || rec ? C.brand : C.line}`, background: sel || rec ? C.brandBg : C.panel, color: sel || rec ? C.brandD : C.ink, borderRadius: 12, padding: "11px", fontSize: 16, fontFamily: fontStack, fontWeight: sel || rec ? 600 : 400, cursor: "pointer" }}>
                      <span>{rateLabel(r)}</span>
                      {rec && <span style={{ fontSize: 12, fontWeight: 700, background: C.brand, color: "#fff", padding: "3px 8px", borderRadius: 7 }}>מומלץ</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {edit.type === "date" && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: 18 }}>
                <select value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", fontSize: 16, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none", width: "100%" }}>
                  {listSundays().filter((s) => !maxStart || s.value <= maxStart).map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
                </select>
              </div>
            )}

            <Btn onClick={commit}><Check size={16} style={{ verticalAlign: -3, marginLeft: 4 }} /> שמור</Btn>
          </div>
        </div>
      )}
      {pendingWeight && (
        <div onClick={() => setPendingWeight(null)} style={{ position: "fixed", inset: 0, background: "rgba(58,43,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 18, padding: "20px 18px", width: "100%", maxWidth: 340, fontFamily: fontStack, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 10 }}>רק לוודא 💜</div>
            <div style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, marginBottom: 18 }}>את עדכון המשקל השוטף עושים בדוח, לא כאן. השדה הזה הוא הנתון שאיתו התחלת או היעד שלך. למעקב אחרי המשקל בפועל - היכנסי לדוח ולחצי "הזיני משקל".</div>
            <Btn onClick={confirmWeight}>אני רוצה לשנות בכל זאת</Btn>
            <Btn variant="ghost" onClick={() => setPendingWeight(null)} style={{ marginTop: 8 }}>צאי בלי לשנות</Btn>
          </div>
        </div>
      )}
      {confirmReset && (
        <div onClick={() => setConfirmReset(false)} style={{ position: "fixed", inset: 0, background: "rgba(58,43,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 18, padding: "20px 18px", width: "100%", maxWidth: 340, fontFamily: fontStack, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 10 }}>למחוק הכל ולהתחיל מחדש?</div>
            <div style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, marginBottom: 18 }}>פעולה זו תמחק את כל מה שהזנת במכשיר הזה - יומן האוכל, המשקל, הצעדים והכל - ותחזיר אותך למסך ההתחלה. אי אפשר לבטל את זה.{profile.backup?.enabled ? " אם הפעלת גיבוי, הנתונים שמורים אצלנו ותוכלי לשחזר עם הקוד שלך." : ""}</div>
            <Btn onClick={() => { setConfirmReset(false); onReset(); }} style={{ background: "#D7263D" }}>כן, מחקי והתחילי מחדש</Btn>
            <Btn variant="ghost" onClick={() => setConfirmReset(false)} style={{ marginTop: 8 }}>ביטול</Btn>
          </div>
        </div>
      )}
      {confirmLogout && (
        <div onClick={() => setConfirmLogout(false)} style={{ position: "fixed", inset: 0, background: "rgba(58,43,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60, padding: 24 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 18, padding: "20px 18px", width: "100%", maxWidth: 340, fontFamily: fontStack, textAlign: "center" }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: C.ink, marginBottom: 10 }}>להתנתק מהמכשיר?</div>
            <div style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, marginBottom: 18 }}>תתנתקי מהמכשיר הזה ותחזרי למסך הכניסה. הנתונים שלך נשמרים, ותוכלי להיכנס שוב בכל רגע עם המייל שלך.</div>
            <Btn onClick={() => { setConfirmLogout(false); onLogout(); }}>כן, התנתקי</Btn>
            <Btn variant="ghost" onClick={() => setConfirmLogout(false)} style={{ marginTop: 8 }}>ביטול</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   AI MEAL ANALYSIS (demo) - sends photo to Claude for estimation
   ============================================================ */
// Downscale a captured photo before sending to the AI, to cut image input-token cost.
// Longest side capped at maxDim; re-encoded as JPEG. Falls back handled by caller.
function downscaleImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      } catch (e) { reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img load failed")); };
    img.src = url;
  });
}

async function analyzeMeal(base64, mediaType) {
  const prompt = "בתמונה מופיעה ארוחה או מוצר מזון. אם מופיעה תווית ערכים תזונתיים על האריזה - קרא את הערכים מהתווית (לפי הכמות שבאריזה, או ל-100 גרם) במקום לנחש. אחרת, זהה את פריטי המזון והערך לכל פריט כמות בגרמים וערכים תזונתיים סבירים. החזר JSON בלבד, ללא טקסט נוסף וללא סימוני קוד, במבנה: {\"items\":[{\"name\":\"שם בעברית\",\"grams\":0,\"kcal\":0,\"protein\":0,\"fat\":0,\"carbs\":0}]}";
  const res = await fetch(AI_ENDPOINT, {
    method: "POST", headers: aiHeaders(),
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: prompt }] }] }),
  });
  const data = await res.json();
  if (res.status === 429) throw new Error(data.message || "limit");
  if (!res.ok || data.error || !Array.isArray(data.content)) throw new Error("ai_unavailable");
  const text = (data.content || []).map((i) => i.text || "").join("");
  const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
  const arr = parsed.items || parsed || [];
  return arr.map((it) => ({ name: it.name, grams: Math.round(it.grams || 0), kcal: Math.round(it.kcal || 0), p: Math.round(it.protein || 0), f: Math.round(it.fat || 0), c: Math.round(it.carbs || 0) }));
}

function extractAiJson(text) {
  const cleaned = (text || "").replace(/```json|```/g, "").trim();
  try { return JSON.parse(cleaned); } catch (e) {}
  const s = cleaned.indexOf("{"), e2 = cleaned.lastIndexOf("}");
  if (s !== -1 && e2 > s) { try { return JSON.parse(cleaned.slice(s, e2 + 1)); } catch (e3) {} }
  return null;
}

// Gentle photo-budget nudges (the HARD 70 cap is enforced server-side in api/ai.js).
const PHOTO_HEADSUP_MSG = "הערה קטנה ממני אלייך 💜 שימי לב שכמות התמונות שניתן להעלות במהלך תוכנית הליווי מוגבלת ל-70 תמונות. לאחר מכן תמיד אפשר לתאר לי בטקסט מה אכלת.";
const PHOTO_END_MSG = "סיימת את צילומי הארוחה לתקופת הליווי 💜 מכאן תמיד אפשר לתאר לי בטקסט מה אכלת ואני אעריך עבורך את הערכים.";
function bumpPhotosToday() {
  try {
    let o = {};
    try { o = JSON.parse(localStorage.getItem("myprime_photos_today") || "{}"); } catch (e) {}
    if (o.date !== TODAY) o = { date: TODAY, n: 0 };
    o.n = (o.n || 0) + 1;
    localStorage.setItem("myprime_photos_today", JSON.stringify(o));
    return o.n;
  } catch (e) { return 0; }
}
function photoHeadsup35Seen() { try { return localStorage.getItem("myprime_photo_hs35") === "1"; } catch (e) { return false; } }
function markPhotoHeadsup35() { try { localStorage.setItem("myprime_photo_hs35", "1"); } catch (e) {} }

async function aiNutritionChat(messages) {
  const system = "את עוזרת תזונה ידידותית של MyPrime, מדברת עברית, ותפקידך אך ורק לעזור לתעד אוכל ולהעריך ערכים תזונתיים באפליקציה. אם המשתמשת כותבת משהו שאינו קשור לאוכל, ארוחות או תזונה (למשל שאלות כלליות, מזג אוויר, חדשות, מתמטיקה, קוד וכו') - אל תעני לגופו של עניין, והחזירי reply בנוסח: \"אני מצטערת, אני יכולה לעזור רק בדברים שקשורים לתיעוד האוכל והתזונה באפליקציה הזו 🙂\", עם done=false ו-items ריק. כשהמשתמשת מספרת מה אכלה או מצרפת תמונה - אם יש תמונה זהי את הפריטים שבה. המטרה: הערכה קלורית מדויקת ככל האפשר. לכן לפני סיכום בררי את מה שמשפיע על הקלוריות: אופן ההכנה (מטוגן / אפוי / מבושל / על הגריל / חי), תוספות שמן או חמאה או רוטב, וגודל מנה או כמות. אם המשתמשת ציינה כמות מפורשת (למשל \"200 גרם\" או \"כוס\") - קחי אותה בדיוק כפי שנמסרה, אל תשני אותה ואל תחליפי אותה בגודל מנה אופייני. במשקאות ממותקים (קולה, מיץ, משקה קל וכו') שאלי תמיד אם זה רגיל או דיאט/זירו, כי ההבדל בקלוריות עצום. אם המאכל נאכל בדרך כלל יחד עם מאכל נוסף (למשל דייסת שיבולת שועל / גרנולה / קורנפלקס עם חלב או יוגורט; קפה עם חלב או סוכר) - שאלי אם הוסיפה משהו ועם מה, ואם רלוונטי גם איזה סוג (למשל איזה יוגורט). אם כן, הוסיפי כל רכיב כפריט נפרד ב-items כדי שהכול יתועד יחד בבת אחת. (מים אינם משנים קלוריות, אז אין צורך לשאול עליהם.) שאלי שאלה אחת בכל פעם, ורק על מה שבאמת חסר וחשוב - אל תשאלי על מה שכבר נאמר ואל תציפי בשאלות. כשיש מספיק מידע סכמי את הפריטים, החזירי done=true עם items, ובשדה reply הציגי סיכום קצר. אם מבקשים שינוי או תוספת - החזירי שוב done=true עם items מעודכן. חשוב מאוד: החזירי בכל תור JSON תקין בלבד, בלי שום טקסט מחוץ ל-JSON ובלי סימוני קוד, במבנה: {\"reply\":\"טקסט קצר למשתמשת\",\"done\":false,\"items\":[]} . כל פריט במבנה {\"name\":\"שם בעברית\",\"en\":\"short english name for nutrition-DB lookup\",\"unit\":\"g\",\"grams\":מספר,\"kcal\":מספר,\"protein\":מספר,\"fat\":מספר,\"carbs\":מספר} . שדה en הוא שם קצר באנגלית של המאכל לחיפוש במאגר תזונה (כולל אופן הכנה אם רלוונטי, למשל \"grilled ribeye steak\", \"white rice cooked\", \"hummus\"). עבור מוצקים unit=\"g\" ו-grams בגרמים; עבור נוזלים ומשקאות unit=\"ml\" ו-grams הוא הכמות במ\"ל. הערכות סבירות בלבד.";
  const res = await fetch(AI_ENDPOINT, {
    method: "POST", headers: aiHeaders(),
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 800, system, messages }),
  });
  const data = await res.json();
  const photoCount = Number(res.headers.get("x-photo-count")) || null;
  if (res.status === 429 || data.error === "limit") {
    return { raw: "", reply: data.message || "הגעת למכסת הפעולות להיום. נתראה מחר 💜", done: false, items: [], limited: true, photoCount };
  }
  if (!res.ok || data.error || !Array.isArray(data.content)) {
    return { raw: "", reply: "אופס - החיבור ל-AI לא עבד. ודאי שמפתח ה-API מוגדר ב-Vercel (Environment Variables) ושנעשה Redeploy, ושיש קרדיט בחשבון Anthropic.", done: false, items: [], limited: false, photoCount };
  }
  const text = (data.content || []).map((i) => i.text || "").join("");
  const obj = extractAiJson(text);
  const parsed = obj || { reply: (text || "").replace(/\{[\s\S]*\}/g, "").trim() || "לא הבנתי, אפשר לנסות שוב?", done: false, items: [] };
  return {
    raw: text,
    limited: false,
    photoCount,
    reply: parsed.reply || "",
    done: !!parsed.done,
    items: (parsed.items || []).map((it) => ({ name: it.name, en: it.en || "", grams: Math.round(it.grams || 0), unit: it.unit === "ml" ? "ml" : "g", kcal: Math.round(it.kcal || 0), p: Math.round(it.protein || 0), f: Math.round(it.fat || 0), c: Math.round(it.carbs || 0) })),
  };
}

async function aiMealChat(messages, ctx) {
  const proteinRule = ctx.proteinFocus
    ? "אם רלוונטי אפשר להזכיר חלבון בעדינות."
    : "חשוב מאוד: בשלב הזה של התוכנית אל תדגישי חלבון, מאקרו או גרמים - דברי על ארוחות מאוזנות, משביעות וקלות להכנה.";
  const estimateRule = ctx.proteinFocus
    ? "לכל רעיון הוסיפי בסוף השורה הערכה קצרה בסוגריים: קלוריות וגרמים של חלבון/שומן/פחמימה. למשל: (~350 קק״ל · חלבון 30 / שומן 12 / פחמ׳ 20). הדגישי שאלו הערכות מקורבות."
    : "לכל רעיון אפשר להוסיף הערכת קלוריות מקורבת בלבד בסוגריים (למשל: ~350 קק״ל), בלי לפרט חלבון/שומן/פחמימה או גרמים.";
  const system =
    "את היועצת של MyPrime, מדברת עברית בגוף שני נקבה. הטון: חברה חמה ואכפתית שמדברת, לא משווקת שמוכרת - אישי, פשוט ומעודד. " +
    "המטרה: לעזור לה להחליט מה לאכול עכשיו, לפי מה שנשאר לה היום ומה שיש לה בבית. " +
    proteinRule + " " +
    "הציעי 2-3 רעיונות מעשיים, ים-תיכוניים וזמינים בישראל, שמתאימים לקלוריות שנותרו. שמרי על תשובות קצרות (2-4 משפטים). " +
    estimateRule + " " +
    "בסיס הערכים: התבססי ככל האפשר על ערכי מאגר התזונה הלאומי של משרד הבריאות (\"צמרת\") עבור מזונות ישראליים, כדי שההערכות יהיו עקביות ומדויקות. " +
    "תמיד סיימי בשאלה עדינה - מה היא חושבת, או אם יש לה את המצרכים. אם חסר לה מצרך (למשל אין סלמון) - הציעי מיד חלופה זמינה ופשוטה. " +
    "אל תפני אותה לדבר עם אדם, מאמנת או צוות, ואל תציעי ליצור קשר או להעביר פנייה לאף אחד - את כאן כדי לעזור עם האוכל והתזונה בלבד. " +
    "אל תיתני ייעוץ רפואי. החזירי טקסט רגיל בלבד (לא JSON, בלי סימוני קוד).";
  const res = await fetch(AI_ENDPOINT, {
    method: "POST", headers: aiHeaders(),
    body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 700, system, messages }),
  });
  const data = await res.json();
  if (res.status === 429 || data.error === "limit") return { error: true, text: "", limit: true, message: data.message || "" };
  if (!res.ok || data.error || !Array.isArray(data.content)) return { error: true, text: "" };
  const text = (data.content || []).map((i) => i.text || "").join("").trim();
  return { text };
}

/* Detect NEW dietary preferences / dislikes / sensitivities the user states mid-chat,
   so we can offer to save them to her profile (with confirmation). */
async function extractPreferences(userText, existing) {
  try {
    const sys = "המשתמשת כותבת לעוזרת תזונה. חלצי אך ורק העדפות תזונה חדשות, מאכלים שהיא לא אוהבת/לא רוצה, או רגישויות/אלרגיות שהיא מזכירה - שעדיין לא קיימים ברשימה הקיימת: "
      + ((existing && existing.length) ? existing.join(", ") : "(ריק)")
      + ". החזירי JSON בלבד, בלי טקסט נוסף ובלי סימוני קוד: {\"diet\":[],\"avoid\":[]}. diet = סגנונות תזונה בלבד (צמחוני/טבעוני/כשר/דל פחמימה/ים-תיכוני). avoid = מאכלים או רכיבים להימנע מהם (כולל רגישויות, אלרגיות, ולא-אוהבת). אם אין שום דבר חדש, החזירי {\"diet\":[],\"avoid\":[]}.";
    const res = await fetch(AI_ENDPOINT, {
      method: "POST", headers: aiHeaders(),
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 200, system: sys, messages: [{ role: "user", content: userText }] }),
    });
    const data = await res.json();
    if (!res.ok || !Array.isArray(data.content)) return { diet: [], avoid: [] };
    const raw = (data.content || []).map((i) => i.text || "").join("");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { diet: [], avoid: [] };
    const obj = JSON.parse(m[0]);
    return { diet: Array.isArray(obj.diet) ? obj.diet : [], avoid: Array.isArray(obj.avoid) ? obj.avoid : [] };
  } catch (e) { return { diet: [], avoid: [] }; }
}

// Immediate, offline detection of diet/sensitivity keywords so the "save to profile"
// offer always appears even if the AI extraction is slow or fails.
function localPrefs(text, existing) {
  const t = text || "";
  const ex = (existing || []).map((x) => String(x));
  const diet = [];
  const dietMap = [
    ["צמחוני", /צמחונ/],
    ["טבעוני", /טבעונ/],
    ["כשר", /כשר/],
    ["דל פחמימה", /דל[ת]? ?פחמימ|לואו ?קארב|low ?carb/i],
    ["ים-תיכוני", /ים[- ]?תיכונ/],
  ];
  for (const [id, re] of dietMap) if (re.test(t) && !ex.includes(id)) diet.push(id);
  const avoid = [];
  const avoidMap = [
    ["גלוטן", /גלוטן/],
    ["חלב / לקטוז", /לקטוז|בלי חלב|ללא חלב|רגיש\S* לחלב/],
    ["ביצים", /בלי ביצים|ללא ביצים|רגיש\S* לביצים/],
    ["אגוזים", /אגוזים/],
    ["בוטנים", /בוטנים/],
    ["סויה", /סויה/],
    ["דגים", /בלי דגים|ללא דגים|רגיש\S* לדג/],
    ["שומשום", /שומשום/],
  ];
  for (const [id, re] of avoidMap) if (re.test(t) && !ex.includes(id)) avoid.push(id);
  return { diet, avoid };
}

async function searchIsraeliDB(q) {
  const res = await fetch(`/api/il-food?q=${encodeURIComponent(q)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).map((it, i) => ({
    id: "il_" + i,
    name: it.name,
    per100: { kcal: it.kcal, p: it.p, f: it.f, c: it.c },
    measures: [{ label: "100 ג׳", g: 100 }, { label: "כף", g: 15 }, { label: "כפית", g: 5 }],
    def: 0,
  }));
}

async function searchOpenFoodFacts(q) {
  const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=20&fields=code,product_name,product_name_he,brands,nutriments`;
  const res = await fetch(url);
  const data = await res.json();
  const out = [];
  for (const p of data.products || []) {
    const n = p.nutriments || {};
    const kcal = n["energy-kcal_100g"];
    if (kcal == null) continue;
    const name = (p.product_name_he || p.product_name || p.brands || "").trim();
    if (!name) continue;
    out.push({
      id: "off_" + (p.code || out.length),
      name,
      per100: { kcal: Math.round(kcal), p: Math.round(n.proteins_100g || 0), f: Math.round(n.fat_100g || 0), c: Math.round(n.carbohydrates_100g || 0) },
      measures: [{ label: "100 ג׳", g: 100 }, { label: "כף", g: 15 }, { label: "כפית", g: 5 }],
      def: 0,
    });
    if (out.length >= 12) break;
  }
  return out;
}

async function searchUSDA(q) {
  try {
    const res = await fetch(`/api/usda?q=${encodeURIComponent(q)}`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.items || []).map((it, i) => ({
      id: "usda_" + i,
      name: it.name + (it.brand ? ` · ${it.brand}` : ""),
      per100: { kcal: it.kcal, p: it.p, f: it.f, c: it.c },
      measures: [{ label: "100 ג׳", g: 100 }, { label: "כף", g: 15 }, { label: "כפית", g: 5 }],
      def: 0,
    }));
  } catch (e) { return []; }
}

// Short Hebrew→English food query for USDA lookups (used only when the
// Hebrew DBs return nothing, and for the AI logging path via item.en).
async function translateFoodToEnglish(q) {
  try {
    const res = await fetch(AI_ENDPOINT, {
      method: "POST", headers: aiHeaders(),
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 40,
        system: "Translate the Hebrew food name to a short English food-search query (2-4 words, common USDA-style naming, include cooking method if implied, e.g. 'grilled ribeye steak', 'white rice cooked'). Reply with ONLY the English term - no quotes, no punctuation, no extra words.",
        messages: [{ role: "user", content: String(q || "") }],
      }),
    });
    const data = await res.json();
    const t = (data.content || []).map((i) => i.text || "").join("").trim();
    return t.replace(/^["']|["']$/g, "").slice(0, 60);
  } catch (e) { return ""; }
}

/* Reconcile AI-identified items against the product databases (by name).
   Name search is fuzzier than a barcode (no unique id), so we only accept a
   STRONG match; otherwise the AI estimate is kept. */
function normName(s) { return String(s || "").replace(/["'.,()\[\]/-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase(); }
function strongMatch(aiName, dbName) {
  const a = normName(aiName), b = normName(dbName);
  if (!a || !b) return false;
  if (b.includes(a) || a.includes(b)) return true;
  const at = new Set(a.split(" ").filter((w) => w.length >= 2));
  const bt = b.split(" ").filter((w) => w.length >= 2);
  let hit = 0; for (const w of bt) if (at.has(w)) hit++;
  return at.size > 0 && hit >= Math.min(2, at.size);
}
async function lookupProduct(name, en) {
  // 1. Israeli national DB (Hebrew name) - best for Israeli foods.
  try { const il = await searchIsraeliDB(name); for (const r of il) if (r.per100 && r.per100.kcal && strongMatch(name, r.name)) return { ...r, source: "db" }; } catch (e) {}
  // 2. USDA FoodData Central (English query) - best for generic cooked foods.
  if (en) { try { const us = await searchUSDA(en); for (const r of us) if (r.per100 && r.per100.kcal && strongMatch(en, r.name)) return { ...r, source: "usda" }; } catch (e) {} }
  // 3. Open Food Facts (Hebrew/brand) - packaged products.
  try { const off = await searchOpenFoodFacts(name); for (const r of off) if (r.per100 && r.per100.kcal && strongMatch(name, r.name)) return { ...r, source: "db" }; } catch (e) {}
  return null;
}
async function reconcileWithDb(items) {
  return Promise.all((items || []).map(async (it) => {
    try {
      const m = await lookupProduct(it.name, it.en);
      if (m) {
        const scale = (it.grams || 100) / 100;
        return { ...it, source: m.source || "db", matched: m.name,
          kcal: Math.round(m.per100.kcal * scale), p: Math.round((m.per100.p || 0) * scale),
          f: Math.round((m.per100.f || 0) * scale), c: Math.round((m.per100.c || 0) * scale) };
      }
    } catch (e) {}
    return { ...it, source: "estimated" };
  }));
}

function SplashScreen() {
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 200, background: C.panel, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 28, textAlign: "center", fontFamily: fontStack, animation: "splashFade 2s ease forwards" }}>
      <div style={{ position: "absolute", top: 14, left: 14, background: C.brandBg, color: C.brandD, fontSize: 13, fontWeight: 700, padding: "4px 12px", borderRadius: 999 }}>בטה</div>
      <img src={MEDAL_SRC} alt="" width={150} height={150} style={{ display: "block", marginBottom: 20 }} />
      <div style={{ fontSize: 23, fontWeight: 700, color: C.ink, lineHeight: 1.45, maxWidth: 320 }}>ברוכה הבאה לאפליקציית המעקב היומי של מיי פריים</div>
    </div>
  );
}

function IntroOverlay({ onClose, name }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 22, zIndex: 40 }}>
      <div style={{ background: C.panel, borderRadius: 18, padding: 20, fontFamily: fontStack }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><Sparkles size={20} color={C.brand} /><span style={{ fontSize: 21, fontWeight: 600, color: C.ink }}>אפליקציית MyPrime · v{VERSION}</span></div>
        <p style={{ fontSize: 16, color: C.ink, lineHeight: 1.7, margin: "0 0 12px" }}>שלום {name ? name + " " : ""}🙂 זו גרסת בטה להתנסות.</p>
        <p style={{ fontSize: 16, color: C.ink, lineHeight: 1.7, margin: "0 0 16px" }}>ייתכן ויתבצעו עדכוני גרסה לאפליקציה, ומומלץ לרענן מדי פעם כדי שתהיה לך הגרסה המעודכנת ביותר. באנדרואיד אפשר למשוך את המסך למטה, ובאייפון צריך לסגור את האפליקציה לגמרי ולפתוח שוב (משיכה למטה לא עובדת באייפון).</p>
        <div style={{ background: C.brandBg, border: `1px solid ${C.brand}`, borderRadius: 12, padding: "11px 13px", margin: "0 0 16px", fontSize: 15, color: C.brandD, fontWeight: 600, lineHeight: 1.6, display: "flex", alignItems: "flex-start", gap: 8 }}>
          <MessageCircle size={20} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>זו גרסת בטה - נשמח מאוד לקבל כל הערה לתיקון! בכל מקום באפליקציה את יכולה להשאיר הערה בלחיצה על כפתור הבועה <MessageCircle size={15} style={{ display: "inline", verticalAlign: "-2px" }} /> בצד שמאל, ואנחנו נקבל את ההערות ונטפל בהן בהקדם האפשרי.</span>
        </div>
        <Btn onClick={onClose}>הבנתי, בואי נתחיל</Btn>
      </div>
    </div>
  );
}

function NotesFab({ notes, setNotes, screen, userName }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const add = () => { if (!text.trim()) return; setNotes((n) => [...n, { text: text.trim(), screen, t: new Date().toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" }) }]); setText(""); };
  const copyAll = () => { try { navigator.clipboard.writeText(notes.map((n) => `• [${n.screen}] ${n.text}`).join("\n")); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {} };
  const sendFeedback = async () => {
    if (!notes.length || sending) return;
    setSending(true);
    let device = ""; try { device = localStorage.getItem("myprime_device_id") || ""; } catch (e) {}
    try {
      await fetch(FEEDBACK_URL, {
        method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ device, name: userName || "", version: VERSION, ts: new Date().toISOString(), notes: notes.map((n) => ({ screen: n.screen, text: n.text, t: n.t })) }),
      });
      setSent(true); setTimeout(() => setSent(false), 2500); setNotes([]);
    } catch (e) { alert("השליחה נכשלה - בדקי חיבור לאינטרנט ונסי שוב."); }
    finally { setSending(false); }
  };
  return (
    <>
      <button data-tut="notesfab" onClick={() => setOpen(true)} style={{ position: "absolute", bottom: 420, insetInlineEnd: 14, width: 40, height: 40, borderRadius: "50%", background: C.panel, color: C.brand, border: `1px solid ${C.line}`, boxShadow: "0 2px 8px rgba(168,66,92,0.2)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 13 }}>
        <MessageCircle size={20} />
        {notes.length > 0 && <span style={{ position: "absolute", top: -2, insetInlineEnd: -2, background: C.ink, color: "#fff", fontSize: 13, minWidth: 18, height: 18, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>{notes.length}</span>}
      </button>
      {open && (
        <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.4)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, zIndex: 45 }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, width: "100%", maxWidth: 460, maxHeight: "82%", borderRadius: 20, padding: "20px 22px 24px", overflowY: "auto", fontFamily: fontStack, border: `2.5px solid ${C.brand}`, boxShadow: "0 14px 44px rgba(0,0,0,0.34)", boxSizing: "border-box" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 20, fontWeight: 600, color: C.ink }}>הערות לאפליקציה</span>
              <button onClick={() => setOpen(false)} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><X size={20} /></button>
            </div>
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={`הערה על מסך "${screen}"…`} rows={4} style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, padding: 10, fontSize: 16, fontFamily: fontStack, color: C.ink, outline: "none", resize: "none", marginBottom: 8, boxSizing: "border-box" }} />
            <Btn onClick={add}>הוסיפי הערה</Btn>
            {notes.length > 0 && (
              <div style={{ marginTop: 14 }}>
                {notes.map((n, i) => (
                  <div key={i} style={{ borderTop: `1px solid ${C.line}`, padding: "9px 0", display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ flex: 1, fontSize: 16, color: C.ink }}>{n.text}<div style={{ fontSize: 13, color: C.faint, marginTop: 2 }}>{n.screen} · {n.t}</div></span>
                    <button onClick={() => setNotes((arr) => arr.filter((_, j) => j !== i))} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><Trash2 size={14} /></button>
                  </div>
                ))}
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  {FEEDBACK_URL && <Btn onClick={sendFeedback} disabled={sending}><Send size={14} style={{ verticalAlign: -2, marginLeft: 4 }} /> {sent ? "נשלח, תודה!" : sending ? "שולחת…" : "שלחי משוב לצוות MyPrime"}</Btn>}
                  <Btn variant="ghost" onClick={copyAll}><Copy size={14} style={{ verticalAlign: -2, marginLeft: 4 }} /> {copied ? "הועתק!" : "העתיקי הכל"}</Btn>
                </div>
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
function AddModal({ state, close, commit, removeAndClose, favorites, onTourEvent, startDate }) {
  const [step, setStep] = useState(state.editEntry ? "qty" : state.kind === "ai" ? "ai" : (state.preMeal ? "list" : "method"));
  const [meal, setMeal] = useState(state.editEntry?.meal || state.preMeal || "בוקר");
  const [food, setFood] = useState(state.editEntry ? (FOODS.find((f) => f.name === state.editEntry.name) || foodFromEntry(state.editEntry)) : null);
  const [grams, setGrams] = useState(state.editEntry?.g || 100);
  const [query, setQuery] = useState("");
  const [dbResults, setDbResults] = useState([]);
  const [dbSource, setDbSource] = useState("il");
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (!q || step !== "list") { setDbResults([]); setSearching(false); return; }
    setSearching(true);
    const id = setTimeout(async () => {
      try {
        let items = await searchIsraeliDB(q);
        let src = "il";
        if (!items.length) { items = await searchOpenFoodFacts(q); src = "off"; }
        if (!items.length) { const en = await translateFoodToEnglish(q); if (en) { items = await searchUSDA(en); src = "usda"; } }
        setDbResults(items); setDbSource(src);
      } catch (e) { setDbResults([]); }
      finally { setSearching(false); }
    }, 450);
    return () => clearTimeout(id);
  }, [query, step]);
  const fileRef = useRef(null);
  const [photoState, setPhotoState] = useState("capture");
  const [photoResult, setPhotoResult] = useState(null);
  const onPhoto = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    downscaleImage(file, 1024, 0.82)
      .then(({ base64, mediaType }) => sendAiImage(base64, mediaType))
      .catch(() => {
        const reader = new FileReader();
        reader.onload = () => sendAiImage(String(reader.result).split(",")[1], file.type || "image/jpeg");
        reader.readAsDataURL(file);
      });
  };
  const [aiMsgs, setAiMsgs] = useState([{ role: "assistant", text: "היי! ספרי לי מה אכלת ואעזור להעריך את הקלוריות 😋\nכדי שאוכל לדייק כבר מההתחלה, נסי לפרט כמה שיותר: איך האוכל הוכן (מטוגן / אפוי / מבושל / על הגריל), אם הוספת שמן / חמאה / רוטב, מה שתית, וכמות משוערת (גרמים, כוסות או כפות).\nככל שתפרטי יותר, ההערכה תהיה מדויקת יותר. אפשר לדבר או לכתוב." }]);
  const [aiApi, setAiApi] = useState([]);
  const [aiInput, setAiInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiDoneItems, setAiDoneItems] = useState(null);
  const [reconciling, setReconciling] = useState(false);
  const finishItems = (items) => {
    setReconciling(true);
    setAiDoneItems(null);
    reconcileWithDb(items)
      .then((enriched) => setAiDoneItems(enriched))
      .catch(() => setAiDoneItems(items.map((it) => ({ ...it, source: "estimated" }))))
      .finally(() => setReconciling(false));
  };
  const recRef = useRef(null);
  const [aiListening, setAiListening] = useState(false);
  const aiInputRef = useRef(null);
  const aiEndRef = useRef(null);
  useEffect(() => { const el = aiInputRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 96) + "px"; } }, [aiInput, step]);
  useEffect(() => { aiEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [aiMsgs, aiLoading, aiDoneItems]);
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
      if (r.done && r.items.length) finishItems(r.items);
    } catch (e) {
      setAiMsgs((m) => [...m, { role: "assistant", text: "יש תקלה זמנית בחיבור ל-AI. נסי שוב, או הוסיפי דרך חיפוש." }]);
    } finally { setAiLoading(false); }
  };
  const sendAiImage = async (base64, mediaType) => {
    if (aiLoading) return;
    // Meal photos are available only during the 10-week program (days 1-70). After that: text only.
    if (programDayNumber(startDate, TODAY) > 70) {
      setStep("ai");
      setAiMsgs((m) => [...m, { role: "assistant", text: PHOTO_END_MSG }]);
      return;
    }
    setStep("ai");
    setAiMsgs((m) => [...m, { role: "user", text: "📷 תמונת הארוחה", img: `data:${mediaType};base64,${base64}` }]);
    const apiMsgs = [...aiApi, { role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
      { type: "text", text: "זוהי תמונת הארוחה שלי. זהי מה יש בה ועזרי לי להעריך כמויות וערכים. אם זו אריזת מוצר עם תווית ערכים תזונתיים - קראי את הערכים מהתווית במקום לנחש." },
    ] }];
    setAiLoading(true);
    try {
      const r = await aiNutritionChat(apiMsgs);
      setAiApi([...apiMsgs, { role: "assistant", content: r.raw }]);
      setAiMsgs((m) => [...m, { role: "assistant", text: r.reply }]);
      if (r.done && r.items.length) finishItems(r.items);
      // Gentle nudges only on a real (non-limited) photo analysis.
      if (!r.limited) {
        const todayN = bumpPhotosToday();
        let nudge = todayN === 3;
        if (r.photoCount && r.photoCount >= 35 && !photoHeadsup35Seen()) { nudge = true; markPhotoHeadsup35(); }
        if (nudge) setAiMsgs((m) => [...m, { role: "assistant", text: PHOTO_HEADSUP_MSG }]);
      }
    } catch (e) {
      setAiMsgs((m) => [...m, { role: "assistant", text: "יש תקלה זמנית בחיבור ל-AI. נסי שוב." }]);
    } finally { setAiLoading(false); }
  };
  const startMic = () => {
    if (aiListening && recRef.current) { recRef.current.stop(); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert("זיהוי דיבור לא נתמך בדפדפן הזה - נסי ב-Chrome/Safari עדכני, או הקלידי."); return; }
    const rec = new SR();
    rec.lang = "he-IL";
    rec.interimResults = true;   // מציג טקסט תוך כדי דיבור
    rec.continuous = false;
    rec.maxAlternatives = 1;
    rec.onstart = () => setAiListening(true);
    rec.onresult = (e) => {
      let t = "";
      for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
      setAiInput(t);
    };
    rec.onerror = () => setAiListening(false);
    rec.onend = () => setAiListening(false);
    try { rec.start(); recRef.current = rec; } catch (e) { setAiListening(false); }
  };
  const [qtyOrigin, setQtyOrigin] = useState("list");
  const pickFood = (f, g) => { setQtyOrigin(step === "history" ? "history" : "list"); setFood(f); setGrams(g ?? f.measures[f.def].g); setStep("qty"); };
  const videoRef = useRef(null);
  const scanControlsRef = useRef(null);
  const [scanState, setScanState] = useState("idle");
  const [manualCode, setManualCode] = useState("");
  const stopScan = () => { try { scanControlsRef.current && scanControlsRef.current(); } catch (e) {} scanControlsRef.current = null; };
  const lookupBarcode = async (code) => {
    setScanState("looking");
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_he,generic_name,generic_name_he,brands,nutriments`);
      const d = await r.json();
      if (d.status !== 1 || !d.product) { setScanState("notfound"); return; }
      const p = d.product, n = p.nutriments || {};
      const name = (p.product_name_he || p.generic_name_he || p.product_name || p.generic_name || p.brands || "מוצר").trim();
      const food = { id: "bc_" + code, name, per100: { kcal: Math.round(n["energy-kcal_100g"] || 0), p: Math.round(n.proteins_100g || 0), f: Math.round(n.fat_100g || 0), c: Math.round(n.carbohydrates_100g || 0) }, measures: [{ label: "100 ג׳", g: 100 }, { label: "כף", g: 15 }, { label: "כפית", g: 5 }], def: 0 };
      pickFood(food, 100);
    } catch (e) { setScanState("error"); }
  };
  const startScan = () => setScanState("scanning");
  useEffect(() => {
    if (scanState !== "scanning") return;
    let cancelled = false, raf = null, stream = null, zx = null;
    const cleanup = () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      try { zx && zx.stop(); } catch (e) {}
      try { stream && stream.getTracks().forEach((t) => t.stop()); } catch (e) {}
      try { if (videoRef.current) videoRef.current.srcObject = null; } catch (e) {}
    };
    const onCode = (code) => { if (cancelled || !code) return; cleanup(); lookupBarcode(String(code)); };
    (async () => {
      try {
        const video = videoRef.current;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (cancelled) { cleanup(); return; }
        video.srcObject = stream;
        await video.play().catch(() => {});
        try { await stream.getVideoTracks()[0].applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch (e) {}

        // Engine 1: native BarcodeDetector - only if actually supported. Some devices
        // expose the class but support no formats, so verify via getSupportedFormats.
        let nativeOk = false;
        if ("BarcodeDetector" in window) {
          try { const f = await window.BarcodeDetector.getSupportedFormats(); nativeOk = Array.isArray(f) && f.length > 0; } catch (e) { nativeOk = false; }
        }
        if (nativeOk) {
          let det;
          try { det = new window.BarcodeDetector({ formats: ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "itf"] }); }
          catch (e) { det = new window.BarcodeDetector(); }
          const tick = async () => {
            if (cancelled) return;
            try { const codes = await det.detect(video); if (codes && codes.length) return onCode(codes[0].rawValue); } catch (e) {}
            raf = requestAnimationFrame(tick);
          };
          raf = requestAnimationFrame(tick);
        }
        // Engine 2: ZXing on the SAME video element, in parallel - covers devices where
        // BarcodeDetector is missing or broken. First engine to read a code wins.
        try {
          const hints = new Map();
          hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E, BarcodeFormat.CODE_128, BarcodeFormat.ITF]);
          hints.set(DecodeHintType.TRY_HARDER, true);
          const reader = new BrowserMultiFormatReader(hints);
          zx = await reader.decodeFromVideoElement(video, (result) => { if (result) onCode(result.getText()); });
          if (cancelled) { try { zx.stop(); } catch (e) {} }
        } catch (e) {}
      } catch (e) { if (!cancelled) setScanState("error"); }
    })();
    scanControlsRef.current = cleanup;
    return () => cleanup();
  }, [scanState]);
  const photoItems = [{ f: FOOD_BY_ID["rice"], g: 158 }, { f: FOOD_BY_ID["chk"], g: 120 }, { f: FOOD_BY_ID["sal"], g: 80 }];
  const filtered = query.trim() ? FOODS.filter((f) => (f.name + " " + (f.search || "")).includes(query.trim())) : [];
  const nut = food ? nutritionFor(food, grams) : null;
  const unitLabel = unitLabelFor(food?.unit);
  const title = step === "method" ? "הוספת מזון" : step === "list" ? `הוספה ל${meal}` : step === "history" ? "האחרונים והמועדפים שלי" : step === "photo" ? "זוהה בתמונה" : step === "ai" ? "ספרי לי מה אכלת" : step === "barcode" ? "סריקת ברקוד" : (state.editEntry ? "עריכת פריט" : food?.name);
  const back = step === "qty" && !state.editEntry ? () => setStep(qtyOrigin) : (step === "list" || step === "history" || step === "photo" || step === "ai" || step === "barcode") ? () => { stopScan(); setStep("method"); } : null;
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.4)", display: "flex", alignItems: "flex-end", zIndex: 20 }} onClick={close}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, width: "100%", maxHeight: "92%", borderRadius: "20px 20px 0 0", padding: "14px 16px 18px", overflowY: "auto", fontFamily: fontStack }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 20, fontWeight: 600, color: C.ink }}>{back && <button onClick={back} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.sub, padding: 0 }}><ChevronRight size={20} /></button>}{title}</span>
          <button onClick={close} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><X size={20} /></button>
        </div>
        {step === "method" && (
          <>
            {[{ ic: Mic, t: "ספרי לי מה אכלת", s: "בדיבור או בכתיבה (AI)", bg: C.infoBg, color: C.info, tut: "method-ai", go: () => { setStep("ai"); onTourEvent && onTourEvent("pickai"); } },
              { ic: Camera, t: "צילום ארוחה", s: "זיהוי אוטומטי (AI)", bg: C.amberBg, color: C.amber, go: () => { if (programDayNumber(startDate, TODAY) > 70) { setStep("ai"); setAiMsgs((m) => [...m, { role: "assistant", text: PHOTO_END_MSG }]); } else setStep("photo"); } },
              { ic: Barcode, t: "סריקת ברקוד", s: "המדויק ביותר", bg: C.brandBg, color: C.brand, go: () => setStep("barcode") },
              { ic: Clock, t: "האחרונים והמועדפים שלי", s: "מוצרים שכבר הוספת - בהקשה אחת", bg: C.waterBg, color: C.water, tut: "method-history", go: () => setStep("history") },
              { ic: Search, t: "חיפוש מזון", s: "מהמאגר הישראלי ו-Open Food Facts", bg: "#E8F3EC", color: "#4E9E76", go: () => setStep("list") }].map((o) => (
              <div key={o.t} data-tut={o.tut} onClick={o.go} style={{ display: "flex", alignItems: "center", gap: 13, background: o.bg, border: "none", borderRadius: 16, padding: 13, marginBottom: 10, cursor: "pointer" }}>
                <div style={{ width: 46, height: 46, borderRadius: 13, background: o.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 3px 9px ${o.color}55` }}><o.ic size={23} color="#fff" strokeWidth={2.2} /></div>
                <div style={{ flex: 1 }}><div style={{ fontSize: 18, fontWeight: 600, color: C.ink }}>{o.t}</div><div style={{ fontSize: 14, color: C.sub }}>{o.s}</div></div>
                {o.tag && <span style={{ fontSize: 13, background: C.panel, color: o.color, padding: "3px 10px", borderRadius: 8, fontWeight: 500 }}>{o.tag}</span>}
              </div>
            ))}
            <div style={{ fontSize: 14, color: C.faint, background: C.bg, padding: 10, borderRadius: 10, lineHeight: 1.6, display: "flex", gap: 6 }}><Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /> <span>ברקוד וחיפוש מדויקים יותר מצילום. בצילום נאשר את הכמות יחד.</span></div>
          </>
        )}
        {step === "list" && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {MEALS.map((m) => (<span key={m} onClick={() => setMeal(m)} style={{ fontSize: 14, padding: "4px 10px", borderRadius: 16, cursor: "pointer", background: m === meal ? C.ink : "transparent", color: m === meal ? "#fff" : C.sub, boxShadow: m === meal ? "none" : `inset 0 0 0 1px ${C.line}` }}>{m}</span>))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 11px", marginBottom: 4, color: C.faint }}>
              <Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש מזון…" autoFocus style={{ border: "none", outline: "none", fontSize: 16, width: "100%", fontFamily: fontStack, color: C.ink, background: "transparent" }} />
            </div>
            {query && filtered.length > 0 && <div style={{ fontSize: 14, color: C.faint, margin: "10px 0 2px" }}>מהמאגר המקומי</div>}
            {query && filtered.map((f) => {
              const g = f.measures[f.def].g; const n = nutritionFor(f, g);
              return (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                  <div onClick={() => pickFood(f, g)} style={{ cursor: "pointer", flex: 1 }}><div style={{ fontSize: 16, fontWeight: 500, color: C.ink }}>{f.name}</div><div style={{ fontSize: 13, color: C.faint }}>{g} ג׳ · {n.kcal} קק״ל</div></div>
                  <button onClick={() => commit({ meal, name: f.name, g, source: "verified", ...n })} style={{ width: 30, height: 30, border: "none", borderRadius: 8, background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} /></button>
                </div>
              );
            })}
            {query && <div style={{ fontSize: 14, color: C.faint, margin: "12px 0 2px", display: "flex", alignItems: "center", gap: 6 }}>{dbSource === "il" ? "מאגר התזונה הלאומי · משרד הבריאות" : dbSource === "usda" ? "USDA FoodData Central · ערכים גנריים" : "תוצאות מ-Open Food Facts"} {searching && <Loader size={12} className="spin" />}</div>}
            {query && dbResults.map((f) => {
              const g = f.measures[f.def].g; const n = nutritionFor(f, g);
              return (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                  <div onClick={() => pickFood(f, g)} style={{ cursor: "pointer", flex: 1 }}><div style={{ fontSize: 16, fontWeight: 500, color: C.ink }}>{f.name}</div><div style={{ fontSize: 13, color: C.faint }}>{g} ג׳ · {n.kcal} קק״ל</div></div>
                  <button onClick={() => commit({ meal, name: f.name, g, source: "verified", ...n })} style={{ width: 30, height: 30, border: "none", borderRadius: 8, background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} /></button>
                </div>
              );
            })}
            {query && !searching && filtered.length === 0 && dbResults.length === 0 && <div style={{ fontSize: 15, color: C.faint, padding: "14px 0", textAlign: "center" }}>לא נמצאו תוצאות ל"{query}"</div>}
            {!query && <div style={{ fontSize: 14, color: C.faint, marginTop: 12, background: C.bg, padding: 11, borderRadius: 10, lineHeight: 1.6, textAlign: "center" }}>הקלידי שם מזון כדי לחפש במאגר התזונה הישראלי וב-Open Food Facts</div>}
          </>
        )}
        {step === "history" && (
          <>
            <div style={{ display: "flex", gap: 6, marginBottom: 10, flexWrap: "wrap" }}>
              {MEALS.map((m) => (<span key={m} onClick={() => setMeal(m)} style={{ fontSize: 14, padding: "4px 10px", borderRadius: 16, cursor: "pointer", background: m === meal ? C.ink : "transparent", color: m === meal ? "#fff" : C.sub, boxShadow: m === meal ? "none" : `inset 0 0 0 1px ${C.line}` }}>{m}</span>))}
            </div>
            {(favorites && favorites.length ? favorites : RECENT.map((r) => ({ ...FOOD_BY_ID[r.foodId], lastG: r.g }))).map((f) => {
              const g = f.lastG ?? f.measures[f.def].g; const n = nutritionFor(f, g);
              return (
                <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                  <div onClick={() => pickFood(f, g)} style={{ cursor: "pointer", flex: 1 }}><div style={{ fontSize: 16, fontWeight: 500, color: C.ink }}>{f.name}</div><div style={{ fontSize: 13, color: C.faint }}>{g} ג׳ · {n.kcal} קק״ל</div></div>
                  <button onClick={() => commit({ meal, name: f.name, g, source: "verified", ...n })} style={{ width: 30, height: 30, border: "none", borderRadius: 8, background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={16} /></button>
                </div>
              );
            })}
            <div style={{ fontSize: 13, color: C.faint, marginTop: 12, background: C.bg, padding: 9, borderRadius: 10, display: "flex", gap: 6 }}><Zap size={13} style={{ flexShrink: 0, marginTop: 1 }} /> <span>הקשה אחת על + מוסיפה עם הכמות האחרונה - בלי להזין שוב</span></div>
          </>
        )}
        {step === "barcode" && (
          <div>
            {scanState === "idle" && (
              <div style={{ textAlign: "center", padding: "4px 0" }}>
                <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.brandBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}><Barcode size={32} color={C.brand} /></div>
                <div style={{ fontSize: 18, fontWeight: 500, color: C.ink, marginBottom: 6 }}>סריקת ברקוד</div>
                <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, margin: "0 0 14px" }}>כווני את המצלמה לברקוד של המוצר - הערכים יישלפו אוטומטית מ-Open Food Facts.</p>
                <Btn onClick={startScan}>פתחי מצלמה לסריקה</Btn>
                <div style={{ fontSize: 14, color: C.faint, margin: "16px 0 6px" }}>או הקלידי את מספר הברקוד</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={manualCode} onChange={(e) => setManualCode(e.target.value)} inputMode="numeric" placeholder="מספר ברקוד" style={{ flex: 1, minWidth: 0, border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", fontSize: 16, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box" }} />
                  <button onClick={() => manualCode.trim() && lookupBarcode(manualCode.trim())} style={{ border: "none", background: C.brand, color: "#fff", borderRadius: 10, padding: "0 18px", cursor: "pointer", fontSize: 16, fontWeight: 500 }}>חפשי</button>
                </div>
              </div>
            )}
            {scanState === "scanning" && (
              <div style={{ textAlign: "center" }}>
                <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "#000" }}>
                  <video ref={videoRef} style={{ width: "100%", display: "block", maxHeight: 320, objectFit: "cover" }} muted playsInline />
                  <div style={{ position: "absolute", inset: 0, pointerEvents: "none", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ width: "80%", height: 92, border: "2px solid rgba(255,255,255,0.9)", borderRadius: 10, boxShadow: "0 0 0 9999px rgba(0,0,0,0.28)", position: "relative" }}>
                      <div style={{ position: "absolute", top: "50%", left: 8, right: 8, height: 2, background: C.brand, transform: "translateY(-1px)" }} />
                    </div>
                  </div>
                </div>
                <div style={{ fontSize: 15, color: C.sub, marginTop: 10, lineHeight: 1.5 }}>מקמי את הברקוד בתוך המסגרת - ישר, ממלא את הרוחב, והחזיקי יציב לרגע</div>
                <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 10 }}>
                  <Btn variant="ghost" onClick={() => { stopScan(); setScanState("idle"); }}>ביטול</Btn>
                  <Btn variant="ghost" onClick={() => { stopScan(); setScanState("idle"); }}>להקליד מספר ידנית</Btn>
                </div>
              </div>
            )}
            {scanState === "looking" && (
              <div style={{ textAlign: "center", padding: "32px 0" }}><Loader size={28} color={C.brand} className="spin" /><div style={{ fontSize: 16, color: C.ink, marginTop: 12 }}>מחפש את המוצר…</div></div>
            )}
            {scanState === "notfound" && (
              <div style={{ textAlign: "center", padding: "16px 0" }}>
                <div style={{ fontSize: 16, color: C.ink, marginBottom: 14, lineHeight: 1.6 }}>המוצר לא נמצא במאגר. אפשר לצלם את <b>התווית התזונתית</b> ואני אזהה את הערכים, או לנסות שוב.</div>
                <label style={{ display: "block", marginBottom: 10 }}>
                  <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: "none" }} />
                  <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.brand, color: "#fff", borderRadius: 12, padding: 12, fontSize: 17, fontWeight: 500, cursor: "pointer" }}><Camera size={18} /> צלמי את התווית התזונתית</span>
                </label>
                <Btn variant="ghost" onClick={() => setScanState("idle")}>נסי שוב לסרוק</Btn>
              </div>
            )}
            {scanState === "error" && (
              <div style={{ textAlign: "center", padding: "20px 0" }}>
                <div style={{ fontSize: 16, color: C.amber, marginBottom: 12, lineHeight: 1.6 }}>לא ניתן לפתוח את המצלמה. ודאי שאישרת גישה למצלמה בדפדפן, או הקלידי את הברקוד ידנית.</div>
                <Btn variant="ghost" onClick={() => setScanState("idle")}>חזרה</Btn>
              </div>
            )}
          </div>
        )}
        {step === "photo" && (
          <div style={{ textAlign: "center", padding: "8px 0 4px" }}>
            <div style={{ width: 72, height: 72, borderRadius: "50%", background: C.brandBg, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px" }}><Camera size={32} color={C.brand} /></div>
            <div style={{ fontSize: 18, fontWeight: 500, color: C.ink, marginBottom: 6 }}>צלמי או העלי תמונה</div>
            <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, margin: "0 0 16px" }}>נפתח שיחה קצרה עם ה-AI - נזהה את הפריטים ונוכל לתקן כמויות יחד.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <label style={{ display: "block" }}>
                <input type="file" accept="image/*" capture="environment" onChange={onPhoto} style={{ display: "none" }} />
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, background: C.brand, color: "#fff", borderRadius: 12, padding: 12, fontSize: 17, fontWeight: 500, cursor: "pointer" }}><Camera size={18} /> צלמי עכשיו</span>
              </label>
              <label style={{ display: "block" }}>
                <input ref={fileRef} type="file" accept="image/*" onChange={onPhoto} style={{ display: "none" }} />
                <span style={{ display: "block", background: "transparent", color: C.brandD, borderRadius: 12, padding: 12, fontSize: 17, fontWeight: 500, cursor: "pointer", boxShadow: `inset 0 0 0 1px ${C.line}` }}>העלי תמונה מהגלריה</span>
              </label>
            </div>
            <div style={{ fontSize: 13, color: C.faint, marginTop: 12, lineHeight: 1.6 }}>הניתוח מבוצע ע״י בינה מלאכותית - ייתכן שתתבקשי להתחבר ל-Claude.</div>
          </div>
        )}
        {step === "ai" && (
          <div data-tut="ai-chat" style={{ display: "flex", flexDirection: "column", height: 380 }}>
            <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
              {aiMsgs.map((m, i) => (
                <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-start" : "flex-end", marginBottom: 8 }}>
                  <div style={{ maxWidth: "82%", fontSize: 16, lineHeight: 1.5, padding: m.img ? 6 : "9px 12px", borderRadius: 14, whiteSpace: "pre-wrap", background: m.role === "user" ? C.brand : C.bg, color: m.role === "user" ? "#fff" : C.ink }}>
                    {m.img && <img src={m.img} alt="" style={{ width: "100%", maxWidth: 180, borderRadius: 10, display: "block", marginBottom: m.text ? 6 : 0 }} />}
                    {m.text && <div style={{ padding: m.img ? "0 6px 4px" : 0 }}>{m.text}</div>}
                  </div>
                </div>
              ))}
              {aiLoading && <div style={{ display: "flex", justifyContent: "flex-end" }}><div style={{ fontSize: 16, padding: "9px 12px", borderRadius: 14, background: C.bg, color: C.faint }}>כותבת…</div></div>}
              {reconciling && !aiDoneItems && (
                <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 14, marginTop: 6, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, color: C.sub, fontSize: 15 }}>
                  <Search size={15} /> בודקת ערכים במאגרי המזון…
                </div>
              )}
              {aiDoneItems && (
                <div style={{ border: `1px solid ${C.brand}`, borderRadius: 12, padding: 10, marginTop: 6 }}>
                  {aiDoneItems.map((it, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                      <span style={{ fontSize: 16, color: C.ink, display: "flex", gap: 6, alignItems: "center" }}>{it.name} <SrcBadge source={it.source || "estimated"} /></span>
                      <span style={{ fontSize: 15, color: C.sub }}>{it.grams} {it.unit === "ml" ? "מ\"ל" : "ג׳"} · {it.kcal} קק״ל</span>
                    </div>
                  ))}
                  <div style={{ fontSize: 12, color: C.faint, padding: "4px 0", lineHeight: 1.5 }}>"מהמאגר" = ערכים אמיתיים ממאגר מוצרים · "מוערך" = הערכת AI. למוצר ארוז - סריקת ברקוד היא המדויקת ביותר.</div>
                  <div style={{ fontSize: 13, color: C.sub, margin: "10px 0 6px" }}>שיוך לארוחה</div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>{MEALS.map((m) => (<span key={m} onClick={() => setMeal(m)} style={{ fontSize: 14, padding: "5px 11px", borderRadius: 16, cursor: "pointer", background: m === meal ? C.ink : "transparent", color: m === meal ? "#fff" : C.sub, boxShadow: m === meal ? "none" : `inset 0 0 0 1px ${C.line}` }}>{m}</span>))}</div>
                  <Btn onClick={() => commit(aiDoneItems.map((it) => ({ meal, name: it.name, g: it.grams, unit: it.unit || "g", source: it.source || "estimated", kcal: it.kcal, p: it.p, f: it.f, c: it.c })))}><Check size={15} style={{ verticalAlign: -2, marginLeft: 4 }} /> הוסיפי ליומן</Btn>
                  <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={() => setAiDoneItems(null)}>אני רוצה לשנות</Btn></div>
                </div>
              )}
              <div ref={aiEndRef} />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
              <button onClick={startMic} disabled={aiLoading} className={aiListening ? "spin-pulse" : ""} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: aiListening ? C.brand : C.brandBg, color: aiListening ? "#fff" : C.brand, cursor: aiLoading ? "default" : "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: aiLoading ? 0.5 : 1 }}><Mic size={18} /></button>
              <textarea ref={aiInputRef} value={aiInput} onChange={(e) => setAiInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendAi(); } }} disabled={aiLoading} rows={1} placeholder={aiLoading ? "רגע, מנתחת…" : aiListening ? "מקשיב… דברי עכשיו" : "כתבי מה אכלת…"} style={{ flex: 1, minWidth: 0, border: `1px solid ${aiListening ? C.brand : C.line}`, borderRadius: 20, padding: "10px 14px", fontSize: 16, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", background: aiLoading ? C.bg : C.panel, resize: "none", maxHeight: 96, overflowY: "auto", lineHeight: 1.4 }} />
              <button onClick={() => sendAi()} disabled={aiLoading} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: C.brand, color: "#fff", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: aiLoading ? 0.5 : 1 }}><Send size={18} /></button>
            </div>
            <div style={{ fontSize: 13, color: C.faint, marginTop: 8, textAlign: "center" }}>הקישי על המיקרופון, דברי, והקישי שוב כדי לעצור. אפשר גם להקליד.</div>
          </div>
        )}
        {step === "qty" && food && (
          <>
            {String(food.id || "").startsWith("bc_") && (
              <>
                <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>שם המוצר (אפשר לערוך)</div>
                <input value={food.name} onChange={(e) => setFood({ ...food, name: e.target.value })} placeholder="שם המוצר" style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", fontSize: 16, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", marginBottom: 14 }} />
              </>
            )}
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>שיוך לארוחה</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>{MEALS.map((m) => (<span key={m} onClick={() => setMeal(m)} style={{ fontSize: 14, padding: "5px 11px", borderRadius: 16, cursor: "pointer", background: m === meal ? C.ink : "transparent", color: m === meal ? "#fff" : C.sub, boxShadow: m === meal ? "none" : `inset 0 0 0 1px ${C.line}` }}>{m}</span>))}</div>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>מידת בית</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>{food.measures.map((ms) => (<span key={ms.label} onClick={() => setGrams(ms.g)} style={{ fontSize: 15, padding: "6px 11px", borderRadius: 8, cursor: "pointer", background: grams === ms.g ? C.brandBg : "transparent", color: grams === ms.g ? C.brandD : C.sub, boxShadow: grams === ms.g ? `inset 0 0 0 1px ${C.brand}` : `inset 0 0 0 1px ${C.line}` }}>{ms.label}{ms.label.includes(String(ms.g)) ? "" : ` · ${ms.g} ${unitLabel}`}</span>))}</div>
            <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>או כמות מדויקת</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginBottom: 16 }}>
              <button onClick={() => setGrams(Math.max(5, grams - 10))} style={{ width: 36, height: 36, border: `1px solid ${C.line}`, borderRadius: 9, background: C.panel, cursor: "pointer", fontSize: 22, color: C.ink }}>−</button>
              <div style={{ minWidth: 70, textAlign: "center" }}><span style={{ fontSize: 27, fontWeight: 600, color: C.ink }}>{grams}</span> <span style={{ fontSize: 15, color: C.sub }}>{unitLabel}</span></div>
              <button onClick={() => setGrams(grams + 10)} style={{ width: 36, height: 36, border: `1px solid ${C.line}`, borderRadius: 9, background: C.panel, cursor: "pointer", fontSize: 22, color: C.ink }}>+</button>
            </div>
            <div style={{ background: C.bg, borderRadius: 12, padding: 12, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, marginBottom: 8 }}><span style={{ color: C.sub }}>קלוריות</span><span style={{ fontWeight: 600, color: C.ink }}>{nut.kcal} קק״ל</span></div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, color: C.sub }}><span>חלבון {nut.p} ג׳</span><span>שומן {nut.f} ג׳</span><span>פחמימות {nut.c} ג׳</span></div>
            </div>
            <Btn onClick={() => commit({ meal, name: food.name, g: grams, unit: food.unit || "g", source: state.editEntry?.source || "verified", ...nut })}><Check size={15} style={{ verticalAlign: -2, marginLeft: 4 }} /> {state.editEntry ? "עדכן" : `הוסף ל${meal}`}</Btn>
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
function EntryMenu({ onClose, onPick, mode }) {
  const FOOD = { bg: C.brandBg, fg: C.brand };
  const ACT = { bg: C.infoBg, fg: C.info };
  const items = mode === "calorie" ? [
    { id: "food", ic: Search, t: "הוספת מזון", s: "חיפוש, ברקוד, צילום או ספרי לי מה אכלת", tint: FOOD },
    { id: "activity", ic: Dumbbell, t: "פעילות גופנית", s: "מתווסף לתקציב הקלורי", tint: ACT },
  ] : [
    { id: "food", ic: Search, t: "הוספת מזון", s: "חיפוש, ברקוד, צילום או ספרי לי מה אכלת", tint: FOOD },
    { id: "recommend", ic: Sparkles, t: "מה כדאי לאכול?", s: "הצעות חכמות לפי היעדים שלך", tint: FOOD },
    { id: "activity", ic: Dumbbell, t: "פעילות גופנית", s: "מתווסף לתקציב הקלורי", tint: ACT },
  ];
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.4)", display: "flex", alignItems: "flex-end", zIndex: 26 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, width: "100%", borderRadius: "20px 20px 0 0", padding: "14px 16px 22px", fontFamily: fontStack }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: C.ink }}>מה תרצי להזין?</span>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><X size={20} /></button>
        </div>
        {items.map((o) => (
          <div key={o.id} data-tut={o.id === "food" ? "entry-food" : o.id === "activity" ? "entry-activity" : undefined} onClick={() => onPick(o.id)} style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${o.tint.bg}`, borderInlineStart: `4px solid ${o.tint.fg}`, background: o.tint.bg, borderRadius: 14, padding: 13, marginBottom: 8, cursor: "pointer" }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, background: C.panel, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><o.ic size={19} color={o.tint.fg} /></div>
            <div style={{ flex: 1 }}><div style={{ fontSize: 18, fontWeight: 600, color: C.ink }}>{o.t}</div>{o.s && <div style={{ fontSize: 14, color: C.sub }}>{o.s}</div>}</div>
            <ChevronLeft size={18} color={o.tint.fg} />
          </div>
        ))}
      </div>
    </div>
  );
}

function SheetShell({ title, onClose, children }) {
  return (
    <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.4)", display: "flex", alignItems: "flex-end", zIndex: 27 }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, width: "100%", maxHeight: "88%", boxSizing: "border-box", borderRadius: "20px 20px 0 0", padding: "14px 16px 22px", fontFamily: fontStack, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexShrink: 0 }}>
          <span style={{ fontSize: 20, fontWeight: 600, color: C.ink }}>{title}</span>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.faint }}><X size={20} /></button>
        </div>
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>{children}</div>
      </div>
    </div>
  );
}

function ActivityModal({ onClose, onAdd, weightKg }) {
  const acts = [
    { name: "ריצה", met: 9.8 },
    { name: "אימון כוח", met: 5 },
    { name: "יוגה / פילאטיס", met: 3 },
    { name: "אופניים", met: 7 },
    { name: "שחייה", met: 7 },
    { name: "אירובי / ריקוד", met: 6.5 },
  ];
  const INT = { "קלה": 3, "בינונית": 5, "גבוהה": 8 };
  const [sel, setSel] = useState(0); // index, or -1 for custom
  const [minutes, setMinutes] = useState(30);
  const [customName, setCustomName] = useState("");
  const [intensity, setIntensity] = useState("בינונית");
  const met = sel >= 0 ? acts[sel].met : INT[intensity];
  const baseName = sel >= 0 ? acts[sel].name : (customName.trim() || "פעילות");
  const kcal = Math.round(met * 3.5 * (weightKg || 70) / 200 * minutes);
  const chip = (on) => ({ fontSize: 15, padding: "7px 13px", borderRadius: 16, cursor: "pointer", background: on ? C.brand : "transparent", color: on ? "#fff" : C.sub, boxShadow: on ? "none" : `inset 0 0 0 1px ${C.line}`, display: "flex", alignItems: "center", gap: 6 });
  return (
    <SheetShell title="פעילות גופנית" onClose={onClose}>
      <div style={{ background: C.infoBg, borderRadius: 12, padding: "11px 13px", marginBottom: 14, fontSize: 14, color: C.ink, lineHeight: 1.6 }}>
        הקלוריות שאת שורפת באימון <b>מתווספות לתקציב הקלורי היומי שלך</b> - כלומר מגדילות את הכמות שמותר לך לאכול היום. <b>הליכה לא נמצאת כאן</b> - היא נספרת אוטומטית דרך הצעדים.
      </div>
      <div style={{ fontSize: 14, color: C.sub, marginBottom: 8 }}>בחרי פעילות</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
        {acts.map((a, i) => (<span key={a.name} onClick={() => setSel(i)} style={chip(sel === i)}><Dumbbell size={14} /> {a.name}</span>))}
        <span onClick={() => setSel(-1)} style={chip(sel === -1)}>אחר</span>
      </div>
      {sel === -1 && (
        <>
          <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="שם הפעילות" style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 10, padding: "10px 12px", fontSize: 16, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", marginBottom: 10 }} />
          <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>עצימות</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>{Object.keys(INT).map((k) => (<span key={k} onClick={() => setIntensity(k)} style={chip(intensity === k)}>{k}</span>))}</div>
        </>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 16, color: C.sub }}>כמה דקות?</span>
        <Stepper value={minutes} set={(v) => setMinutes(Math.max(1, v))} step={5} suffix="דק׳" />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bg, borderRadius: 10, padding: "10px 12px", marginBottom: 12 }}>
        <span style={{ fontSize: 15, color: C.sub }}>נשרף בערך</span>
        <span style={{ fontSize: 18, fontWeight: 600, color: C.brandD }}>{kcal} קק״ל</span>
      </div>
      <Btn onClick={() => onAdd({ name: `${baseName} ${minutes} דק׳`, kcal })}>הוסף פעילות</Btn>
      <div style={{ fontSize: 12, color: C.faint, textAlign: "center", marginTop: 8 }}>הערכה לפי סוג הפעילות, המשקל שלך ({weightKg || 70} ק״ג) ומשך הזמן</div>
    </SheetShell>
  );
}

function WeightModal({ weights, today, minDate, heightCm, onClose, onAdd }) {
  const find = (d) => { const w = (weights || []).find((x) => x.date === d); return w ? w.kg : null; };
  const [date, setDate] = useState(today);
  const [kg, setKg] = useState(() => { const k = find(today); return k != null ? String(k) : ""; });
  const onDate = (d) => { setDate(d); const k = find(d); setKg(k != null ? String(k) : ""); };
  const num = parseFloat(kg);
  const valid = isFinite(num) && num >= 30 && num <= 400 && !!date;
  const low = valid && bmiOf(num, heightCm) < UNDERWEIGHT_BMI;
  return (
    <SheetShell title="הזנת משקל" onClose={onClose}>
      <WeighInTips style={{ marginTop: 2 }} />
      <div style={{ margin: "2px 0 12px" }}>
        <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>תאריך</div>
        <input type="date" value={date} min={minDate} max={today} onChange={(e) => onDate(e.target.value)} style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px", fontSize: 17, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", textAlign: "center" }} />
      </div>
      <div style={{ margin: "4px 0 8px" }}>
        <input type="text" inputMode="decimal" value={kg} autoFocus onChange={(e) => setKg(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="לדוגמה 71.5" style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 12px", fontSize: 25, fontWeight: 600, textAlign: "center", fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box" }} />
        <div style={{ textAlign: "center", fontSize: 14, color: C.sub, marginTop: 6 }}>ק״ג</div>
      </div>
      {low && <div style={{ fontSize: 14, color: C.amber, background: C.amberBg, borderRadius: 10, padding: 10, lineHeight: 1.6, marginBottom: 10, display: "flex", gap: 6 }}><Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>המשקל שהזנת נמוך מהטווח התקין (BMI מתחת ל-18.5). שווה להתייעץ עם איש מקצוע. אפשר כמובן לשמור את הערך.</span></div>}
      <Btn onClick={() => { if (valid) onAdd(Math.round(num * 10) / 10, date); }} style={{ opacity: valid ? 1 : 0.5 }}><Check size={16} style={{ verticalAlign: -3, marginLeft: 4 }} /> שמור</Btn>
      <div style={{ fontSize: 13, color: C.faint, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>אפשר לבחור גם תאריך קודם. הזנה חוזרת לאותו תאריך מעדכנת את הערך.</div>
    </SheetShell>
  );
}

// Deeper steps explanation + per-platform health-app guide link (link appears once STEP_GUIDES is filled).
function StepGuideLink({ style, linkOnly }) {
  const [view, setView] = useState(null); // null | "menu" | "ios" | "android"
  const [idx, setIdx] = useState(0);
  const guideKeys = Object.keys(STEP_GUIDES).filter((k) => STEP_GUIDES[k].images && STEP_GUIDES[k].images.length); // ios, android
  const og = (view === "ios" || view === "android") ? STEP_GUIDES[view] : null;
  const imgs = og ? og.images : [];
  const last = idx >= imgs.length - 1;
  const navBtn = (on) => ({ border: "none", borderRadius: 10, padding: "10px 18px", fontFamily: fontStack, fontSize: 15, fontWeight: 700, cursor: on ? "pointer" : "default", background: on ? C.brand : C.line, color: on ? "#fff" : C.faint });
  const box = { width: "100%", boxSizing: "border-box", border: `1px solid ${C.amber}`, background: C.amberBg, color: C.amber, borderRadius: 12, padding: "12px", fontFamily: fontStack, fontSize: 15, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, textAlign: "center", lineHeight: 1.4 };
  const storeBtn = { flex: 1, textAlign: "center", border: `1px solid ${C.amber}`, background: C.panel, color: C.amber, borderRadius: 10, padding: "9px", fontFamily: fontStack, fontSize: 14.5, fontWeight: 700, textDecoration: "none" };
  const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.72)", zIndex: 100001, display: "flex", alignItems: "center", justifyContent: "center", padding: 16, fontFamily: fontStack, direction: "rtl" };
  const card = { background: C.panel, borderRadius: 18, padding: 16, maxWidth: 460, width: "100%", maxHeight: "92vh", display: "flex", flexDirection: "column" };
  const closeBtn = { border: "none", background: "transparent", cursor: "pointer", color: C.faint };
  return (
    <div style={style}>
      {!linkOnly && (
        <div style={{ fontSize: 13, color: C.sub, textAlign: "center", lineHeight: 1.55, marginBottom: 8 }}>
          כדי לראות כמה צעדים עשית היום: פתחי את אפליקציית הבריאות בטלפון, מצאי את מספר הצעדים של היום, והזיני אותו כאן.
        </div>
      )}
      <button onClick={() => setView("menu")} style={box}><Info size={16} /> זקוקה להנחיות שימוש באפליקציית הצעדים? לחצי</button>
      {view === "menu" && (
        <div onClick={() => setView(null)} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>הנחיות לאפליקציית הצעדים</span>
              <button onClick={() => setView(null)} aria-label="סגירה" style={closeBtn}><X size={20} /></button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {guideKeys.map((k) => (
                <button key={k} onClick={() => { setView(k); setIdx(0); }} style={box}><Info size={15} /> מדריך: איך מוצאים את הצעדים ב{STEP_GUIDES[k].app}</button>
              ))}
              <div style={{ border: `1px solid ${C.amber}`, background: C.amberBg, borderRadius: 12, padding: "12px" }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.amber, textAlign: "center", marginBottom: 9, lineHeight: 1.45 }}>אין לך אפליקציית בריאות בטלפון?<br />הורידי אפליקציית צעדים חינמית:</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <a href={STEP_APPS.android.url} target="_blank" rel="noreferrer" style={storeBtn}>Android</a>
                  <a href={STEP_APPS.ios.url} target="_blank" rel="noreferrer" style={storeBtn}>אייפון</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {og && (
        <div onClick={() => setView("menu")} style={overlay}>
          <div onClick={(e) => e.stopPropagation()} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>איך מוצאים את הצעדים ב{og.app}</span>
              <button onClick={() => setView("menu")} aria-label="חזרה" style={closeBtn}><X size={20} /></button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto", background: C.bg, borderRadius: 12, padding: 8 }}>
              <img src={imgs[idx]} alt="" style={{ maxWidth: "100%", maxHeight: "64vh", objectFit: "contain", borderRadius: 8 }} />
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12, gap: 10 }}>
              <button onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0} style={navBtn(idx > 0)}>הקודם</button>
              <span style={{ color: C.faint, fontSize: 14 }}>{idx + 1}/{imgs.length}</span>
              <button onClick={() => (last ? setView("menu") : setIdx((i) => i + 1))} style={navBtn(true)}>{last ? "חזרה" : "הבא"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StepsModal({ current, goal, weightKg, onClose, onAdd, autoFocusInput = true }) {
  const [val, setVal] = useState(current ? String(current) : "");
  const steps = Math.max(0, parseInt(val, 10) || 0);
  const kcal = stepsKcal(steps, weightKg);
  const frac = Math.max(0, Math.min(1, goal > 0 ? steps / goal : 0));
  return (
    <SheetShell title="עדכון צעדים" onClose={onClose}>
      <div data-tut="steps-input" style={{ margin: "4px 0 10px" }}>
        <input type="text" inputMode="numeric" value={val} autoFocus={autoFocusInput} onChange={(e) => setVal(e.target.value.replace(/[^0-9]/g, ""))} placeholder="לדוגמה 6500" style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 12, padding: "14px 12px", fontSize: 25, fontWeight: 600, textAlign: "center", fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box" }} />
        <div style={{ textAlign: "center", fontSize: 14, color: C.sub, marginTop: 6 }}>צעדים</div>
      </div>
      <div style={{ height: 10, borderRadius: 6, background: C.amberBg, overflow: "hidden", marginBottom: 8 }}>
        <div style={{ width: `${frac * 100}%`, height: "100%", background: C.amber, borderRadius: 6 }} />
      </div>
      <div style={{ textAlign: "center", fontSize: 14, color: C.sub, marginBottom: 16 }}>{steps.toLocaleString()} מתוך יעד {goal.toLocaleString()} · מוסיף ~{kcal} קק״ל לתקציב</div>
      <Btn onClick={() => onAdd(steps)}><Check size={16} style={{ verticalAlign: -3, marginLeft: 4 }} /> שמור</Btn>
      <div style={{ fontSize: 13, color: C.faint, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>לשינוי יעד הצעדים - אפשר בפרופיל. הזנה חוזרת היום מעדכנת את הערך.</div>
      <StepGuideLink style={{ marginTop: 10 }} />
    </SheetShell>
  );
}

function WaterModal({ currentMl, cupMl, onSetMl, onSetCup, onClose }) {
  const [cup, setCup] = useState(cupMl || DEFAULT_CUP_ML);
  const [free, setFree] = useState("");
  const safeCup = Math.max(100, cup || DEFAULT_CUP_ML);
  const ml = currentMl || 0;
  const cups = Math.round((ml / safeCup) * 10) / 10;
  const targetCups = Math.round(WATER_TARGET_ML / safeCup);
  const frac = Math.max(0, Math.min(1, ml / WATER_TARGET_ML));
  const add = (n) => onSetMl(Math.max(0, ml + n));
  const setCupLive = (v) => { const c = Math.max(100, Math.min(1000, v)); setCup(c); onSetCup(c); };
  const addFree = () => { const n = parseInt(free, 10) || 0; if (n >= 50) { add(n); setFree(""); } };
  return (
    <SheetShell title="עדכון מים" onClose={onClose}>
      <div style={{ textAlign: "center", margin: "2px 0 10px" }}>
        <div style={{ fontSize: 35, fontWeight: 700, color: C.ink }}>{cups} <span style={{ fontSize: 17, color: C.sub }}>כוסות</span></div>
        <div style={{ fontSize: 14, color: C.sub, marginTop: 2 }}>{ml.toLocaleString()} מ"ל מתוך {targetCups} כוסות (2 ליטר)</div>
      </div>
      <div style={{ height: 10, borderRadius: 6, background: C.waterBg, overflow: "hidden", marginBottom: 14 }}>
        <div style={{ width: `${frac * 100}%`, height: "100%", background: C.water, borderRadius: 6, transition: "width .3s" }} />
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => add(safeCup)} style={{ flex: 1, border: `1.5px solid ${C.water}`, background: C.waterBg, color: C.water, borderRadius: 12, padding: "12px 8px", fontFamily: fontStack, fontSize: 16, fontWeight: 600, cursor: "pointer" }}>+ כוס ({safeCup} מ"ל)</button>
        <button onClick={() => add(500)} style={{ flex: 1, border: `1.5px solid ${C.water}`, background: C.waterBg, color: C.water, borderRadius: 12, padding: "12px 8px", fontFamily: fontStack, fontSize: 16, fontWeight: 600, cursor: "pointer" }}>+ חצי ליטר</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
        <button onClick={() => add(-safeCup)} disabled={ml <= 0} style={{ flex: 1, border: `1.5px solid ${ml <= 0 ? C.line : C.water}`, background: C.panel, color: ml <= 0 ? C.faint : C.water, borderRadius: 12, padding: "10px 8px", fontFamily: fontStack, fontSize: 15, fontWeight: 600, cursor: ml <= 0 ? "default" : "pointer", opacity: ml <= 0 ? 0.6 : 1 }}>- כוס (תיקון)</button>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
        <input type="text" inputMode="numeric" value={free} onChange={(e) => setFree(e.target.value.replace(/[^0-9]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addFree(); } }} placeholder={'הוספת מ"ל חופשי (לפחות 50)'} style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", fontSize: 15, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box" }} />
        <button onClick={addFree} aria-label="הוספה" style={{ flexShrink: 0, width: 46, borderRadius: 10, border: "none", background: C.water, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={18} /></button>
      </div>
      <div style={{ textAlign: "center", marginBottom: 14 }}>
        <button onClick={() => onSetMl(0)} style={{ border: "none", background: "transparent", color: C.faint, fontSize: 14, textDecoration: "underline", cursor: "pointer", fontFamily: fontStack }}>איפוס היום</button>
      </div>
      <div style={{ background: C.bg, borderRadius: 12, padding: 12, marginBottom: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 15, color: C.ink }}>גודל כוס</span>
          <Stepper value={safeCup} set={setCupLive} step={10} suffix={'מ"ל'} />
        </div>
        <div style={{ fontSize: 13, color: C.faint, marginTop: 6 }}>היעד תמיד 2 ליטר; מספר הכוסות מתעדכן לפי גודל הכוס.</div>
      </div>
      <div style={{ fontSize: 13, color: C.faint, textAlign: "center", marginTop: 10 }}>כל שינוי נשמר מיד. אפשר לסגור בכל רגע.</div>
    </SheetShell>
  );
}

function CalorieGoalModal({ current, onClose, onAdd }) {
  const [kcal, setKcal] = useState(current);
  return (
    <SheetShell title="עדכון יעד קלורי ליום" onClose={onClose}>
      <div style={{ fontSize: 14, color: C.sub, marginBottom: 10, textAlign: "center", lineHeight: 1.6 }}>היעד היומי שלך לקלוריות. שינוי כאן דורס את הערך המחושב.</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", margin: "4px 0 18px" }}>
        <Stepper value={kcal} set={(v) => setKcal(Math.max(KCAL_FLOOR, v))} step={10} min={KCAL_FLOOR} suffix="קק״ל" />
      </div>
      <Btn onClick={() => onAdd(kcal)}>שמור יעד</Btn>
    </SheetShell>
  );
}

function AccessGate({ status, reason, email, setEmail, name, setName, onSubmit, onRetry, msg, attempts = 0, agree, setAgree }) {
  const deniedText = reason === "fetch_failed"
    ? "תקלה טכנית זמנית, נסי שוב בעוד רגע."
    : reason === "device_limit"
    ? "המייל שלך כבר מחובר בשני מכשירים. ניתן להשתמש ב-MyPrime בו-זמנית בשני מכשירים בלבד. התנתקי במכשיר אחר ונסי שוב, או פני למנהלת התוכנית."
    : reason === "expired"
    ? "תקופת השימוש באפליקציה הסתיימה. תודה שהיית חלק מהמסע שלנו 💜"
    : reason === "cancelled"
    ? "המנוי שלך בתוכנית אינו פעיל. אם לדעתך מדובר בטעות, פני בבקשה לצוות הטכני בווטסאפ 0547304177 או במייל support@myprime.co.il."
    : "המייל הזה לא נמצא ברשימת המשתתפות בתוכנית. אם את רשומה לתוכנית, או שיש בעיה - פני בבקשה לצוות הטכני בווטסאפ 0547304177 או במייל support@myprime.co.il.";
  const locked = reason === "not_registered" && attempts >= 5;
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "24px 28px", textAlign: "center", fontFamily: fontStack }}>
      <div style={{ width: 64, height: 64, borderRadius: "50%", background: C.brandBg, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 16 }}><Sparkles size={28} color={C.brand} /></div>
      <div style={{ fontSize: 23, fontWeight: 600, color: C.ink, marginBottom: 6 }}>{name.trim() ? `היי ${name.trim()}!` : "ברוכה הבאה ל-MyPrime"}</div>
      {status === "checking" && (
        <><Loader size={26} color={C.brand} className="spin" style={{ marginTop: 18 }} /><div style={{ fontSize: 15, color: C.sub, marginTop: 12 }}>מאמתת את ההרשמה לתוכנית…</div></>
      )}
      {status === "form" && (
        <>
          <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, margin: "0 0 16px" }}>הזיני שם פרטי והמייל שאיתו נרשמת לתוכנית.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="שם פרטי" style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", fontSize: 17, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", textAlign: "center", marginBottom: 10 }} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onSubmit()} type="email" inputMode="email" placeholder="המייל איתו נרשמת לתוכנית" style={{ width: "100%", border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", fontSize: 17, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", textAlign: "center", marginBottom: 12, direction: "ltr" }} />
          <div style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.7, textAlign: "right", marginBottom: 4 }}>
            <Lock size={13} style={{ display: "inline", verticalAlign: "-2px", marginInlineEnd: 5 }} />
            מיי פריים ה.ד.ס בע"מ ("החברה") אינה אוספת מידע אישי אודות המשתמשות באפליקציה והמידע אינו נשמר במאגרי החברה. החברה עושה שימוש באפליקציה בהתאם להוראות מדיניות העוגיות. ככל שמשתמשת תמסור לחברה מידע אישי, החברה תאסוף ותעבד מידע אישי אודותיה בהתאם להוראות מדיניות הפרטיות של החברה, כפי שמופיעה באתר.
          </div>
          <div onClick={() => setAgree(!agree)} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "10px 0 12px", textAlign: "right" }}>
            <div style={{ width: 22, height: 22, borderRadius: 6, border: `2px solid ${agree ? C.brand : C.line}`, background: agree ? C.brand : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{agree && <Check size={14} color="#fff" />}</div>
            <span style={{ fontSize: 14.5, color: C.ink, lineHeight: 1.5 }}>קראתי ואני מאשרת את <a href={PRIVACY_URL} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: C.brandD, textDecoration: "underline" }}>מדיניות הפרטיות</a> ו<a href={COOKIE_URL} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} style={{ color: C.brandD, textDecoration: "underline" }}>מדיניות העוגיות</a></span>
          </div>
          <div style={{ width: "100%" }}><Btn onClick={onSubmit}>כניסה</Btn></div>
          {msg && <div style={{ fontSize: 14, color: C.amber, marginTop: 12, lineHeight: 1.5 }}>{msg}</div>}
        </>
      )}
      {status === "denied" && (
        <>
          <div style={{ fontSize: 15, lineHeight: 1.7, margin: "12px 0 18px", background: C.amberBg, color: C.amber, padding: 12, borderRadius: 12 }}>{deniedText}</div>
          {reason !== "expired" && reason !== "cancelled" && !locked && <div style={{ width: "100%" }}><Btn variant="ghost" onClick={onRetry}>נסי שוב / כתובת אחרת</Btn></div>}
        </>
      )}
    </div>
  );
}

function RecommendModal({ remainingKcal, remainingProtein, profile, setProfile, mealsHad, proteinFocus, onLog, onClose }) {
  const [stage, setStage] = useState("confirm");
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(false);
  const [pending, setPending] = useState(null);
  const [logMsgs, setLogMsgs] = useState([]);
  const [logInput, setLogInput] = useState("");
  const [logLoading, setLogLoading] = useState(false);
  const [logErr, setLogErr] = useState(false);
  const [logItems, setLogItems] = useState(null);
  const [logMeal, setLogMeal] = useState("בוקר");
  const [logged, setLogged] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);
  useEffect(() => { const el = inputRef.current; if (el) { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 96) + "px"; } }, [input]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, loading, logMsgs, logLoading, logItems, logged]);
  const ctx = { proteinFocus };

  const diet = profile.diet || [];
  const allergies = profile.allergies || [];
  const dislikes = (profile.dislikes || "").trim();
  const toggle = (key, val) => setProfile({ ...profile, [key]: (profile[key] || []).includes(val) ? (profile[key] || []).filter((x) => x !== val) : [...(profile[key] || []), val] });
  const chip = (on) => ({ fontSize: 15, padding: "6px 13px", borderRadius: 16, cursor: "pointer", background: on ? C.brand : "transparent", color: on ? "#fff" : C.sub, boxShadow: on ? "none" : `inset 0 0 0 1px ${C.line}` });
  const [newSens, setNewSens] = useState("");
  const [want, setWant] = useState(null);
  const customSens = (profile.dislikes || "").split(",").map((s) => s.trim()).filter(Boolean);
  const addSens = () => { const t = newSens.trim(); if (!t) return; if (!customSens.includes(t)) setProfile({ ...profile, dislikes: [...customSens, t].join(", ") }); setNewSens(""); };
  const removeSens = (t) => setProfile({ ...profile, dislikes: customSens.filter((x) => x !== t).join(", ") });

  const run = async (history) => {
    setLoading(true); setErr(false);
    const r = await aiMealChat(history, ctx);
    setLoading(false);
    if (r.error || !r.text) { setErr(true); return; }
    setMsgs([...history, { role: "assistant", content: r.text }]);
  };
  const startChat = () => {
    const avoidList = [...allergies, ...(dislikes ? [dislikes] : [])].filter(Boolean);
    const seed = `הקשר: נשארו לי כ-${Math.max(0, Math.round(remainingKcal))} קלוריות להיום`
      + (proteinFocus && remainingProtein > 0 ? `, ונותרו כ-${Math.round(remainingProtein)} ג׳ חלבון ליעד` : "")
      + (diet.length ? `. סגנון תזונה: ${diet.join(", ")}` : "")
      + (avoidList.length ? `. חשוב מאוד - יש לי רגישות/אלרגיה, ואסור בשום אופן להציע לי מאכלים שמכילים: ${avoidList.join(", ")}. אם רעיון כולל אחד מהם, אל תציעי אותו בכלל, ותמיד הזכירי לי בעדינות לבדוק את רשימת הרכיבים המלאה לפני האכילה - כי לפעמים גם AI טועה.` : "")
      + (mealsHad ? `. כבר אכלתי היום: ${mealsHad}` : "")
      + (want ? `. אני מחפשת עכשיו: ${want}` : "")
      + ". מה כדאי לי לאכול עכשיו? תני לי כמה רעיונות ושאלי מה דעתי.";
    const h = [{ role: "user", content: seed }];
    setMsgs(h); setStage("chat"); run(h);
  };

  const sendText = (t) => {
    const text = (t || "").trim();
    if (!text || loading) return;
    const next = [...msgs, { role: "user", content: text }];
    setMsgs(next); setInput(""); run(next);
    const existing = [...diet, ...allergies, ...(dislikes ? dislikes.split(/[,،]/).map((s) => s.trim()).filter(Boolean) : [])];
    const local = localPrefs(text, existing);
    if (local.diet.length || local.avoid.length) setPending(local);
    extractPreferences(text, existing).then((p) => {
      const mDiet = [...new Set([...local.diet, ...((p.diet || []).filter((d) => !existing.includes(d)))])];
      const mAvoid = [...new Set([...local.avoid, ...((p.avoid || []).filter((a) => !existing.includes(a)))])];
      if (mDiet.length || mAvoid.length) setPending({ diet: mDiet, avoid: mAvoid });
    });
  };
  const savePending = () => {
    if (!pending) return;
    const dietIds = DIET_OPTIONS.map((d) => d.id);
    const newDiet = (pending.diet || []).filter((d) => dietIds.includes(d) && !diet.includes(d));
    const newAllerg = (pending.avoid || []).filter((a) => SENSITIVITY_OPTIONS.includes(a) && !allergies.includes(a));
    const restAvoid = (pending.avoid || []).filter((a) => !SENSITIVITY_OPTIONS.includes(a));
    const newDislikes = [dislikes, ...restAvoid].filter(Boolean).join(", ");
    setProfile({ ...profile, diet: [...diet, ...newDiet], allergies: [...allergies, ...newAllerg], dislikes: newDislikes });
    setPending(null);
  };

  const defaultMeal = () => { const h = new Date().getHours(); if (h < 11) return "בוקר"; if (h < 16) return "צהריים"; if (h < 21) return "ערב"; return "נשנושים"; };
  const runLog = async (history) => {
    setLogLoading(true); setLogErr(false);
    const r = await aiNutritionChat(history.map((m) => ({ role: m.role, content: m.content })));
    setLogLoading(false);
    if (!r.reply && (!r.items || !r.items.length)) { setLogErr(true); return; }
    setLogMsgs([...history, { role: "assistant", content: r.reply }]);
    setLogItems(r.done && r.items && r.items.length ? r.items : null);
  };
  const startLog = () => {
    const last = [...msgs].reverse().find((m) => m.role === "assistant");
    const ctxText = last ? last.content : "";
    const seed = "אני רוצה להוסיף ליומן משהו מתוך מה שהצעת לי. "
      + (ctxText ? "ההצעות שלך היו: " + ctxText + " " : "")
      + "אם לא ברור מה בדיוק אכלתי או באיזו כמות - שאלי אותי שאלה אחת בכל פעם, ואז סכמי לרישום.";
    const h = [{ role: "user", content: seed }];
    setLogMsgs(h); setLogItems(null); setLogged(false); setLogMeal(defaultMeal()); setStage("log"); runLog(h);
  };
  const sendLog = (t) => {
    const text = (t || "").trim();
    if (!text || logLoading) return;
    const next = [...logMsgs, { role: "user", content: text }];
    setLogMsgs(next); setLogInput(""); setLogItems(null); runLog(next);
  };
  const doLog = () => {
    if (!logItems || !logItems.length) return;
    onLog(logItems.map((it) => ({ meal: logMeal, name: it.name, g: it.grams, unit: it.unit || "g", source: it.source || "estimated", kcal: it.kcal, p: it.p, f: it.f, c: it.c })));
    setLogged(true);
  };

  const visible = msgs.slice(1); // hide the synthetic opening prompt
  const hasAvoid = allergies.length > 0 || dislikes.length > 0;

  return (
    <SheetShell title="מה כדאי לאכול?" onClose={onClose}>
      {stage === "confirm" ? (
        <div>
          <div style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, marginBottom: 14 }}>רגע לפני שאמליץ - בואי נוודא שאני עובדת עם המידע הנכון. ככה ההמלצות יהיו מדויקות ובטוחות יותר.</div>
          <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>מה את מחפשת עכשיו?</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
            {WANT_OPTIONS.map((w) => (<span key={w.id} onClick={() => setWant(want === w.id ? null : w.id)} style={chip(want === w.id)}>{w.emoji} {w.id}</span>))}
          </div>
          <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>סגנון תזונה</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 14 }}>
            {DIET_OPTIONS.map((d) => (<span key={d.id} onClick={() => toggle("diet", d.id)} style={chip(diet.includes(d.id))}>{d.emoji} {d.id}</span>))}
          </div>
          <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>רגישויות / אלרגיות</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBottom: 10 }}>
            {SENSITIVITY_OPTIONS.map((s) => (<span key={s} onClick={() => toggle("allergies", s)} style={chip(allergies.includes(s))}>{s}</span>))}
          </div>
          <div style={{ fontSize: 14, color: C.sub, marginBottom: 6 }}>רגישויות נוספות</div>
          <div style={{ display: "flex", gap: 6, marginBottom: customSens.length ? 10 : 0 }}>
            <input value={newSens} onChange={(e) => setNewSens(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSens(); } }} placeholder="הקלידי והוסיפי (למשל: בלי חריף)" style={{ flex: 1, border: `1.5px solid ${C.brand}`, borderRadius: 10, padding: "11px 12px", fontSize: 15, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", background: C.panel }} />
            <button onClick={addSens} aria-label="הוספה" style={{ flexShrink: 0, width: 46, borderRadius: 10, border: "none", background: C.brand, color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}><Plus size={18} /></button>
          </div>
          {customSens.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {customSens.map((s) => (
                <span key={s} style={{ fontSize: 15, padding: "6px 9px 6px 13px", borderRadius: 16, background: C.brand, color: "#fff", display: "inline-flex", alignItems: "center", gap: 6 }}>
                  {s}
                  <button onClick={() => removeSens(s)} aria-label="הסרה" style={{ border: "none", background: "transparent", color: "#fff", cursor: "pointer", display: "flex", padding: 0 }}><X size={14} /></button>
                </span>
              ))}
            </div>
          )}
          {!diet.length && !hasAvoid && <div style={{ fontSize: 14, color: C.faint, margin: "10px 0 0" }}>לא רשמת עדיין העדפות או רגישויות. אפשר לבחור עכשיו, או פשוט להמשיך.</div>}
          {hasAvoid && <div style={{ fontSize: 13, color: C.amber, background: C.amberBg, padding: 10, borderRadius: 10, margin: "12px 0 0", lineHeight: 1.5 }}>שימי לב: גם כשאתאים לפי הרגישויות שלך, תמיד כדאי לבדוק בעצמך את רשימת הרכיבים המלאה. זה כלי עזר, לא תחליף לבדיקה.</div>}
          <div style={{ marginTop: 16 }}><Btn onClick={startChat}>קבלי המלצות ←</Btn></div>
        </div>
      ) : stage === "log" ? (
      <div style={{ display: "flex", flexDirection: "column", height: 400 }}>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
          {visible.map((m, i) => (
            <div key={"sug" + i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-start" : "flex-end", marginBottom: 8, opacity: 0.5 }}>
              <div style={{ maxWidth: "84%", fontSize: 15, lineHeight: 1.5, padding: "9px 12px", borderRadius: 14, whiteSpace: "pre-wrap", background: m.role === "user" ? C.brand : C.bg, color: m.role === "user" ? "#fff" : C.ink }}>{m.content}</div>
            </div>
          ))}
          {visible.length > 0 && <div style={{ textAlign: "center", fontSize: 13, color: C.faint, margin: "2px 0 12px" }}>- מוסיפים ליומן -</div>}
          {logMsgs.slice(1).map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-start" : "flex-end", marginBottom: 8 }}>
              <div style={{ maxWidth: "84%", fontSize: 16, lineHeight: 1.55, padding: "10px 13px", borderRadius: 14, whiteSpace: "pre-wrap", background: m.role === "user" ? C.brand : C.bg, color: m.role === "user" ? "#fff" : C.ink }}>{m.content}</div>
            </div>
          ))}
          {logLoading && <div style={{ display: "flex", justifyContent: "flex-end" }}><div style={{ fontSize: 16, padding: "9px 12px", borderRadius: 14, background: C.bg, color: C.faint }}>רושמת…</div></div>}
          {logErr && <div style={{ fontSize: 14, color: C.amber, background: C.amberBg, padding: 12, borderRadius: 10, lineHeight: 1.6 }}>החיבור ל-AI לא עבד כרגע. נסי שוב.</div>}
          {logItems && !logged && (
            <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: 12, marginTop: 4 }}>
              {logItems.map((it, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 15, padding: "4px 0", color: C.ink }}>
                  <span>{it.name} · {it.grams} {it.unit === "ml" ? "מ\"ל" : "ג׳"}</span>
                  <span style={{ color: C.sub }}>{it.kcal} קק״ל</span>
                </div>
              ))}
              <div style={{ fontSize: 14, color: C.sub, margin: "10px 0 6px" }}>לאיזו ארוחה?</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {MEALS.map((m) => (<span key={m} onClick={() => setLogMeal(m)} style={{ fontSize: 14, padding: "5px 11px", borderRadius: 16, cursor: "pointer", background: m === logMeal ? C.brand : "transparent", color: m === logMeal ? "#fff" : C.sub, boxShadow: m === logMeal ? "none" : `inset 0 0 0 1px ${C.line}` }}>{m}</span>))}
              </div>
            </div>
          )}
          {logged && <div style={{ background: "#E7F4EC", color: "#1E8449", borderRadius: 12, padding: 14, marginTop: 6, fontSize: 16, fontWeight: 600, textAlign: "center" }}>✓ נוסף ליומן (וגם למועדפים והאחרונים)</div>}
          <div ref={endRef} />
        </div>
        {logItems && !logged && <div style={{ marginBottom: 8 }}><Btn onClick={doLog}><Check size={15} style={{ verticalAlign: -2, marginLeft: 4 }} /> הוסיפי ל{logMeal}</Btn></div>}
        {logged ? (
          <Btn variant="ghost" onClick={onClose}>סגירה</Btn>
        ) : (
          <div style={{ display: "flex", alignItems: "flex-end", gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
            <textarea value={logInput} onChange={(e) => setLogInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendLog(logInput); } }} disabled={logLoading} rows={1} placeholder={logLoading ? "רגע…" : "תשובה / מה אכלת…"} style={{ flex: 1, minWidth: 0, border: `1px solid ${C.line}`, borderRadius: 20, padding: "10px 14px", fontSize: 16, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", background: logLoading ? C.bg : C.panel, resize: "none", maxHeight: 96, overflowY: "auto", lineHeight: 1.4 }} />
            <button onClick={() => sendLog(logInput)} disabled={logLoading} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: C.brand, color: "#fff", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: logLoading ? 0.5 : 1 }}><Send size={18} /></button>
          </div>
        )}
      </div>
      ) : (
      <div style={{ display: "flex", flexDirection: "column", height: 400 }}>
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 8 }}>
          {visible.map((m, i) => (
            <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-start" : "flex-end", marginBottom: 8 }}>
              <div style={{ maxWidth: "84%", fontSize: 16, lineHeight: 1.55, padding: "10px 13px", borderRadius: 14, whiteSpace: "pre-wrap", background: m.role === "user" ? C.brand : C.bg, color: m.role === "user" ? "#fff" : C.ink }}>{m.content}</div>
            </div>
          ))}
          {loading && <div style={{ display: "flex", justifyContent: "flex-end" }}><div style={{ fontSize: 16, padding: "9px 12px", borderRadius: 14, background: C.bg, color: C.faint }}>חושבת על רעיונות…</div></div>}
          {err && <div style={{ fontSize: 14, color: C.amber, background: C.amberBg, padding: 12, borderRadius: 10, lineHeight: 1.6 }}>החיבור ל-AI לא עבד כרגע. ודאי שמפתח ה-API מוגדר ב-Vercel ושיש קרדיט בחשבון, ונסי שוב.</div>}
          <div ref={endRef} />
        </div>

        {visible.length > 0 && !loading && (
          <button onClick={startLog} style={{ width: "100%", marginBottom: 8, border: `1px solid ${C.brand}`, background: C.brandBg, color: C.brandD, borderRadius: 12, padding: 11, fontSize: 16, fontWeight: 600, fontFamily: fontStack, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}><Check size={17} /> אכלתי - הוסיפי ליומן</button>
        )}

        {!loading && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <span onClick={() => sendText("תני לי בבקשה רעיון אחר")} style={{ fontSize: 14, padding: "6px 12px", borderRadius: 16, cursor: "pointer", color: C.brandD, boxShadow: `inset 0 0 0 1px ${C.line}` }}>רעיון אחר</span>
            <span onClick={() => sendText("אין לי את המצרכים האלה בבית")} style={{ fontSize: 14, padding: "6px 12px", borderRadius: 16, cursor: "pointer", color: C.brandD, boxShadow: `inset 0 0 0 1px ${C.line}` }}>אין לי את זה</span>
          </div>
        )}

        {pending && (
          <div style={{ background: C.brandBg, border: `1px solid ${C.brand}`, borderRadius: 12, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ fontSize: 14, color: C.ink, marginBottom: 8, lineHeight: 1.5 }}>לשמור את זה להעדפות שלך לפעמים הבאות? <b>{[...(pending.diet || []), ...(pending.avoid || [])].join(", ")}</b></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={savePending} style={{ border: "none", background: C.brand, color: "#fff", fontFamily: fontStack, fontSize: 14, padding: "7px 16px", borderRadius: 16, cursor: "pointer" }}>שמרי</button>
              <button onClick={() => setPending(null)} style={{ border: `1px solid ${C.line}`, background: "transparent", color: C.sub, fontFamily: fontStack, fontSize: 14, padding: "7px 16px", borderRadius: 16, cursor: "pointer" }}>לא עכשיו</button>
            </div>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "flex-end", gap: 8, borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
          <textarea ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendText(input); } }} disabled={loading} rows={1} placeholder={loading ? "רגע, חושבת…" : "כתבי מה בא לך…"} style={{ flex: 1, minWidth: 0, border: `1px solid ${C.line}`, borderRadius: 20, padding: "10px 14px", fontSize: 16, fontFamily: fontStack, color: C.ink, outline: "none", boxSizing: "border-box", background: loading ? C.bg : C.panel, resize: "none", maxHeight: 96, overflowY: "auto", lineHeight: 1.4 }} />
          <button onClick={() => sendText(input)} disabled={loading} style={{ width: 40, height: 40, borderRadius: "50%", border: "none", background: C.brand, color: "#fff", cursor: "pointer", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: loading ? 0.5 : 1 }}><Send size={18} /></button>
        </div>
      </div>
      )}
    </SheetShell>
  );
}

function CheckinCard({ date, today, week, tasks, answers, auto, locked, onOpen, onOpenCollection, onOpenSummary }) {
  const done = tasks.filter((t) => taskDone(t, answers, auto)).length;
  const hasManual = tasks.some((t) => !t.auto);
  const total = tasks.length;
  const r = 54, circ = 2 * Math.PI * r;
  const frac = total ? done / total : 0;
  const allDone = total > 0 && done >= total;
  const dn = dowOf(date);
  const dd = new Date(date);
  const rel = relLabel(date);
  const dateLine = `${rel ? rel + " · " : ""}${HE_DAYS_FULL[dd.getDay()]}, ${dd.getDate()} ב${HE_MONTHS[dd.getMonth()]} · שבוע ${week}${dn >= 1 ? `, יום ${dn}` : ""}`;
  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 14, margin: "0 0 16px", background: C.panel, overflow: "hidden", display: "flex", alignItems: "stretch" }}>
      <div data-tut="tracker" onClick={locked ? undefined : onOpen} style={{ flex: 1, minWidth: 0, padding: 14, cursor: locked ? "default" : "pointer" }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 6 }}><Sparkles size={16} color={C.brand} /> יומן המעקב שלי</div>
        <div style={{ fontSize: 13.5, fontWeight: 500, color: C.sub, marginTop: 3 }}>{dateLine}</div>
        {locked ? (
          <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 10, fontSize: 15, color: C.sub }}><Clock size={15} color={C.faint} /> הדוח של היום ייפתח ב-19:00. אפשר להשלים בכל שעה אחרי זה.</div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 10 }}>
            <div style={{ position: "relative", width: 120, height: 120, flexShrink: 0 }}>
              <svg width={120} height={120} viewBox="0 0 132 132">
                <circle cx="66" cy="66" r={r} fill="none" stroke="#FBE0EE" strokeWidth="10" />
                <circle cx="66" cy="66" r={r} fill="none" stroke="#E8589B" strokeWidth="10" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ * (1 - frac)} transform="rotate(-90 66 66)" style={{ transition: "stroke-dashoffset .5s ease" }} />
              </svg>
              <img src={MEDAL_SRC} alt="" width={92} height={92} style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", filter: done === 0 ? "grayscale(1) opacity(0.55)" : "none" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: C.ink }}>{done} <span style={{ fontSize: 15, fontWeight: 400, color: C.sub }}>מתוך {total}</span></div>
              <div style={{ fontSize: 14.5, color: C.sub, marginTop: 2 }}>{allDone ? "סיימת את כל המשימות להיום!" : "המשימות של היום"}</div>
              <button onClick={(e) => { e.stopPropagation(); onOpen && onOpen(); }} style={{ marginTop: 10, border: "none", borderRadius: 10, padding: "10px 12px", background: C.brand, color: "#fff", fontSize: 14.5, fontWeight: 700, fontFamily: fontStack, cursor: "pointer", width: "100%" }}>{hasManual ? "הקישי למילוי המעקב" : "הקישי לצפייה במעקב"}</button>
            </div>
          </div>
        )}
        {(dn === 6 || dn === 0) && (
          <div onClick={(e) => { e.stopPropagation(); onOpenSummary && onOpenSummary(); }} data-tut="weeklysummary" role="button" aria-label="סיכום שבועי" style={{ marginTop: 12, background: C.brandBg, border: `1px solid ${C.brand}`, borderRadius: 12, padding: "11px 12px", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, color: C.brandD, fontWeight: 700, fontSize: 15, cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={C.brandD} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="M7 16v-5" /><path d="M12 16V8" /><path d="M17 16v-9" /></svg>
            סיכום שבועי
            <ChevronLeft size={16} color={C.brandD} />
          </div>
        )}
      </div>
      <div onClick={(e) => { e.stopPropagation(); onOpenCollection && onOpenCollection(); }} data-tut="cabinet" role="button" aria-label="ארון הגביעים" style={{ width: 84, flexShrink: 0, background: C.brand, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4, cursor: "pointer", color: "#fff", padding: "8px 4px" }}>
        <img src="/medals/trophy-icon.webp" alt="" width={72} height={58} style={{ display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.25))" }} />
        <div style={{ fontSize: 13.5, fontWeight: 700, textAlign: "center", lineHeight: 1.25 }}>ארון<br />הגביעים</div>
        <ChevronLeft size={16} color="#fff" />
      </div>
    </div>
  );
}

function CheckinModal({ tasks, answers, auto, setValue, onClose, date, startDate, tipsSeen, onTipsSeen }) {
  const hasAuto = tasks.some((t) => t.auto);
  const showAutoNote = hasAuto && !(tipsSeen || []).includes("autotasks");
  const dd = new Date(date);
  const rel = relLabel(date);
  const wk = Math.min(programWeekFor(startDate, date), 10);
  const dn = dowOf(date);
  const dateLine = `${rel ? rel + " · " : ""}${HE_DAYS_FULL[dd.getDay()]}, ${dd.getDate()} ב${HE_MONTHS[dd.getMonth()]} · שבוע ${wk}${dn >= 1 ? `, יום ${dn}` : ""}`;
  return (
    <SheetShell title="המעקב היומי שלי" onClose={onClose}>
      <div style={{ fontSize: 14, fontWeight: 500, color: C.sub, marginBottom: 8, textAlign: "right" }}>{dateLine}</div>
      {showAutoNote && (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 12, padding: "10px 12px", marginBottom: 8, fontSize: 13.5, color: C.ink, lineHeight: 1.55, textAlign: "right" }}>
          חלק מהמשימות מסומנות "אוטומטי" - הן מתעדכנות לבד לפי מה שמילאת בפלוס של הקלוריות והצעדים, בלי שתצטרכי למלא שוב.
          <div style={{ textAlign: "left", marginTop: 6 }}><button onClick={() => onTipsSeen && onTipsSeen(["autotasks"])} style={{ border: "none", background: "transparent", color: C.brandD, fontSize: 13.5, fontWeight: 700, fontFamily: fontStack, cursor: "pointer", padding: 0 }}>הבנתי</button></div>
        </div>
      )}
      <div style={{ maxHeight: "58vh", overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
        {CHECKIN_GROUPS.map((g) => {
          const items = tasks.filter((t) => t.group === g.id);
          if (!items.length) return null;
          return (
            <div key={g.id}>
              <div style={{ fontSize: 13.5, color: C.faint, margin: "12px 0 2px" }}>{g.label}</div>
              {items.map((t) => {
                const done = taskDone(t, answers, auto);
                const autoNote = t.auto === "steps" ? "יש למלא בעיגול הצעדים" : t.auto === "water" ? "יש לעדכן בעיגול המים" : "יש למלא בעיגול הקלוריות";
                return (
                  <div key={t.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
                    <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ fontSize: 16, color: C.ink }}>{t.label}{t.optional ? <span style={{ color: C.faint, fontSize: 13 }}> (רשות)</span> : null}</span>
                      {t.auto && !done && <span style={{ fontSize: 12.5, color: C.amber, marginTop: 2 }}>{autoNote}</span>}
                    </div>
                    {t.auto ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 14, color: done ? C.brandD : C.faint, background: done ? C.brandBg : "transparent", padding: "5px 9px", borderRadius: 9, whiteSpace: "nowrap" }}>{done ? <Check size={14} /> : null}{t.auto === "steps" && auto.steps != null ? `${auto.steps.toLocaleString()} · ` : ""}{t.auto === "water" && auto.water != null ? `${auto.water} · ` : ""}אוטומטי</span>
                    ) : t.type === "number" ? (
                      <Stepper value={answers[t.id] || 0} set={(v) => setValue(t.id, v)} step={1} min={0} />
                    ) : (
                      <button onClick={() => setValue(t.id, answers[t.id] === true ? null : true)} aria-label={t.label} style={{ width: 30, height: 30, borderRadius: 9, border: `1.5px solid ${answers[t.id] === true ? C.brand : C.line}`, background: answers[t.id] === true ? C.brand : C.panel, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>{answers[t.id] === true ? <Check size={16} /> : null}</button>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <button onClick={onClose} style={{ marginTop: 14, width: "100%", border: "none", borderRadius: 12, padding: "13px", background: C.brand, color: "#fff", fontSize: 17, fontWeight: 600, fontFamily: fontStack, cursor: "pointer" }}>סגירה</button>
    </SheetShell>
  );
}

function CheckinCheer({ name, onClose }) {
  const colors = [C.brand, C.amber, C.info, "#F4C04A", C.macroC];
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 46 }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {Array.from({ length: 26 }).map((_, i) => (
          <span key={i} style={{ position: "absolute", top: -12, left: `${(i * 3.9) % 100}%`, width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], animation: `confettiFall ${1 + (i % 5) * 0.15}s ease-out ${(i % 7) * 0.08}s forwards` }} />
        ))}
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 24, padding: "26px 22px", textAlign: "center", maxWidth: 300, width: "100%", animation: "cheerPop 0.4s ease both", boxShadow: "0 18px 50px rgba(168,66,92,0.3)" }}>
        <img src={MEDAL_SRC} alt="" width={100} height={100} style={{ display: "block", margin: "0 auto", animation: "medalIn 0.6s cubic-bezier(.2,1.3,.5,1) both" }} />
        <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, marginTop: 10 }}>מדליה נכנסה לאוסף!</div>
        <div style={{ fontSize: 15.5, color: C.sub, marginTop: 8, lineHeight: 1.55 }}>כל הכבוד{name && name.trim() ? `, ${name.trim()}` : ""}. עוד יום שהשלמת, אני איתך 💜<div style={{ marginTop: 2, color: C.faint, fontSize: 14 }}>ענת</div></div>
        <div style={{ marginTop: 18 }}><Btn onClick={onClose}>יאללה, ממשיכות 💜</Btn></div>
      </div>
    </div>
  );
}

function TrophyCheer({ week, name, onClose }) {
  const colors = ["#F4C04A", C.brand, C.amber, C.info, C.macroC];
  const src = week >= 10 ? "/medals/trophy-champion.webp" : `/medals/trophy-${Math.max(1, Math.min(9, week))}.webp`;
  const champ = week >= 10;
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 47 }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {Array.from({ length: 36 }).map((_, i) => (
          <span key={i} style={{ position: "absolute", top: -12, left: `${(i * 2.8) % 100}%`, width: 9, height: 9, borderRadius: 2, background: colors[i % colors.length], animation: `confettiFall ${1.1 + (i % 5) * 0.16}s ease-out ${(i % 9) * 0.07}s forwards` }} />
        ))}
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 24, padding: "28px 24px", textAlign: "center", maxWidth: 320, width: "100%", animation: "cheerPop 0.4s ease both", boxShadow: "0 18px 50px rgba(168,66,92,0.35)" }}>
        <img src={src} alt="" width={120} height={120} style={{ display: "block", margin: "0 auto", animation: "medalIn 0.7s cubic-bezier(.2,1.3,.5,1) both" }} />
        <div style={{ fontSize: 23, fontWeight: 700, color: C.ink, marginTop: 12 }}>{champ ? "סיימת את כל המסע!" : "גביע השבוע נכנס לארון!"}</div>
        <div style={{ fontSize: 15.5, color: C.sub, marginTop: 8, lineHeight: 1.55 }}>{champ ? `את אלופה${name && name.trim() ? `, ${name.trim()}` : ""}. עברת את כל עשרת השבועות.` : `השלמת שבוע ${week} שלם${name && name.trim() ? `, ${name.trim()}` : ""}. גאה בך.`}<div style={{ marginTop: 2, color: C.faint, fontSize: 14 }}>ענת</div></div>
        <div style={{ marginTop: 18 }}><Btn onClick={onClose}>{champ ? "סגירה 💜" : "ממשיכות חזק 💜"}</Btn></div>
      </div>
    </div>
  );
}

function FastingIntroModal({ onOptIn, onDismiss }) {
  return (
    <div onClick={onDismiss} style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 48, fontFamily: fontStack, direction: "rtl" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 24, padding: "26px 22px", textAlign: "center", maxWidth: 330, width: "100%", animation: "cheerPop 0.4s ease both", boxShadow: "0 18px 50px rgba(168,66,92,0.3)" }}>
        <div style={{ fontSize: 40, lineHeight: 1 }}>🕘</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, marginTop: 10 }}>משימה חדשה: צום לסירוגין</div>
        <div style={{ fontSize: 15.5, color: C.sub, marginTop: 10, lineHeight: 1.65, textAlign: "right" }}>
          היום העליתי לך סרטון על משימת הצום לסירוגין.<br />
          אם את מעוניינת לנסות את המשימה - אשרי זאת בכפתור.<br />
          תמיד אפשר לשנות את הבחירה בפרופיל.
          <div style={{ marginTop: 8, color: C.faint, fontSize: 14 }}>ענת</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 18 }}>
          <Btn onClick={onOptIn}>כן, אשמח לנסות 💜</Btn>
          <button onClick={onDismiss} style={{ border: "none", background: "transparent", color: C.sub, fontFamily: fontStack, fontSize: 15, fontWeight: 600, cursor: "pointer", padding: "6px" }}>לא עכשיו</button>
        </div>
      </div>
    </div>
  );
}

function trackerStats(checkins) {
  let days = 0;
  for (const d in checkins) if (checkins[d] && checkins[d]._done) days++;
  return { days };
}

// A weekly trophy is earned once the week's weekdays have passed (Friday <= today)
// and every eligible non-Saturday day of that program week (from day 3) is completed.
function weekTrophyEarned(checkins, startDate, w, today) {
  const fri = addDays(startDate, (w - 1) * 7 + 5);
  if (fri > today) return false;
  let any = false;
  for (let dnum = Math.max((w - 1) * 7 + 1, 3); dnum <= w * 7; dnum++) {
    const date = addDays(startDate, dnum - 1);
    if (date > today) break;
    if (new Date(date).getDay() === 6) continue;
    any = true;
    if (!(checkins[date] && checkins[date]._done)) return false;
  }
  return any;
}

function CollectionModal({ checkins, startDate, today, onClose }) {
  const { days } = trackerStats(checkins);
  return (
    <SheetShell title="ארון המדליות והגביעים" onClose={onClose}>
      <div style={{ textAlign: "center", padding: "2px 0 8px" }}>
        {days > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, maxHeight: 176, overflowY: "auto", padding: "4px 2px" }}>
            {Array.from({ length: days }).map((_, i) => <img key={i} src={MEDAL_SRC} alt="" width={40} height={40} style={{ display: "block" }} />)}
          </div>
        ) : (
          <img src={MEDAL_SRC} alt="" width={64} height={64} style={{ filter: "grayscale(1) opacity(0.5)" }} />
        )}
        <div style={{ fontSize: 19, fontWeight: 700, color: C.ink, marginTop: 8 }}>{days} {days === 1 ? "מדליה" : "מדליות"}</div>
        <div style={{ fontSize: 14, color: C.sub, marginTop: 2 }}>כל יום שהשלמת שווה מדליה</div>
      </div>
      <div style={{ fontSize: 14, color: C.faint, margin: "8px 0 8px" }}>הגביעים שלך</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {Array.from({ length: 10 }).map((_, i) => {
          const w = i + 1; const earned = weekTrophyEarned(checkins, startDate, w, today);
          const src = w >= 10 ? "/medals/trophy-champion.webp" : `/medals/trophy-${w}.webp`;
          return (
            <div key={w} style={{ textAlign: "center", opacity: earned ? 1 : 0.32 }}>
              <img src={src} alt="" width={58} height={58} style={{ filter: earned ? "none" : "grayscale(1)" }} />
              <div style={{ fontSize: 12, color: earned ? C.brandD : C.faint, marginTop: 2 }}>{w >= 10 ? "אלופה" : `שבוע ${w}`}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 13, color: C.faint, marginTop: 14, textAlign: "center", lineHeight: 1.5 }}>גביע נכנס לארון כשמשלימים את ימי השבוע (ראשון עד שישי). שבת לא חובה.</div>
    </SheetShell>
  );
}

// Weekly-summary motivation, indexed by week-1 (1..10). DRAFT copy - owner will refine.
const WEEKLY_MOTIVATION = [
  "כל צעד קטן השבוע הוא הבסיס לשבוע הבא. אני איתך.",
  "הגוף שלך כבר מרגיש את השינוי, גם אם המספרים עוד לא צועקים אותו.",
  "את לא צריכה להיות מושלמת. את צריכה להמשיך - ואת ממשיכה.",
  "השבוע הזה הוכיח שאת מסוגלת. תזכרי את זה כשיהיה קשה.",
  "חצי הדרך מאחורייך. תראי כמה כבר השתנה.",
  "ההרגלים שבנית הופכים לחלק ממך. זה כבר לא מאמץ, זה את.",
  "כל בוקר שבחרת בעצמך השבוע - ניצחון. תספרי אותם.",
  "הגוף בגיל הזה צריך סבלנות ואהבה, ואת נותנת לו בדיוק את זה.",
  "עוד מעט הסיום, ואת נכנסת אליו חזקה יותר משהתחלת.",
  "השבוע התוכנית מסתיימת, אבל העבודה שלך לא. כל מה שבנית בעשרת השבועות האלה - ההרגלים, המודעות, הדרך שבה את מתייחסת לעצמך - זה בדיוק מה שישמור על התוצאות הלאה. הסוד הוא להתמיד: להמשיך לזוז, לאכול נכון, לישון ולשתות, גם בלי המעקב היומי. את כבר יודעת איך. מכאן זה פשוט להמשיך להיות הגרסה הזאת של עצמך, יום אחרי יום. גאה בך, ובוטחת בך. 💜",
];

const SUMMARY_COUNT_PHRASE = {
  journal: (c) => `מילאת יומן תזונה ב-${c} ימים`,
  drinkbefore: (c) => `שתית לפני הארוחות ב-${c} ימים`,
  protein: (c) => `הגעת ליעד החלבון ב-${c} ימים`,
  noscreens: (c) => `בלי מסכים לפני השינה ב-${c} ימים`,
  stopeating: (c) => `הפסקת לאכול שעתיים לפני השינה ב-${c} ימים`,
  breathing: (c) => `תרגלת נשימות ב-${c} ימים`,
  gratitude: (c) => `כתבת הכרת תודה ב-${c} ימים`,
  grains: (c) => `דגנים מלאים או קטניות ב-${c} ימים`,
  goodfat: (c) => `שומן בריא ב-${c} ימים`,
  pelvic: (c) => `תרגלת רצפת אגן ב-${c} ימים`,
  probiotics: (c) => `פרוביוטיקה ב-${c} ימים`,
  antiinflam: (c) => `מזון אנטי-דלקתי ב-${c} ימים`,
  calcium: (c) => `מזון עשיר בסידן ב-${c} ימים`,
  sun: (c) => `חשיפה לשמש ב-${c} ימים`,
  strength: (c) => `עשית ${c} אימוני כוח`,
  mobility: (c) => `עשית ${c} אימוני מוביליטי`,
};
const SUMMARY_AVG_PHRASE = {
  veg: (a) => `בממוצע ${a.avg} צבעי ירקות ביום`,
  mealorder: (a) => `בממוצע ${a.avg} ארוחות בסדר אכילה ביום`,
  water: (a) => `שתית בממוצע ${a.avg} כוסות מים ביום`,
  sleephours: (a) => `ישנת בממוצע ${a.avg} שעות, ב-${a.n} לילות שדיווחת`,
  fasting: (a) => `חלון צום בממוצע ${a.avg} שעות`,
};

function summaryWeekDates(week, startDate, today, keepShabbat) {
  const out = []; const maxT = new Date(today).getTime();
  for (let dnum = (week - 1) * 7 + 1; dnum <= week * 7; dnum++) {
    const d = addDays(startDate, dnum - 1);
    if (new Date(d).getTime() > maxT) break;
    if (!unlockedOn(startDate, d, CHECKIN_UNLOCK)) continue;
    if (!tasksForDate(startDate, d, keepShabbat).length) continue;
    out.push(d);
  }
  return out;
}
function summaryStepsAvg(week, startDate, today, stepsByDate) {
  if (week < 1) return null;
  let sum = 0, n = 0; const maxT = new Date(today).getTime();
  for (let dnum = (week - 1) * 7 + 1; dnum <= week * 7; dnum++) {
    const d = addDays(startDate, dnum - 1);
    if (new Date(d).getTime() > maxT) break;
    const v = stepsByDate[d];
    if (v != null && v > 0) { sum += v; n++; }
  }
  return n ? Math.round(sum / n) : null;
}
function weeklySummaryData(week, startDate, today, checkins, log, stepsByDate, waterByDate, targets, cupMl, keepShabbat, dailyTarget, fasting) {
  const dates = summaryWeekDates(week, startDate, today, keepShabbat);
  const counts = {}, sums = {}, ns = {};
  let calSum = 0, calN = 0, protSum = 0, protN = 0, calOnGoal = 0, sleepDays = 0, grainsDays = 0;
  for (const d of dates) {
    const ans = checkins[d] || {};
    const au = autoStatusFor(d, stepsByDate, waterByDate, log, targets, cupMl);
    let sleepDay = false, grainDay = false;
    for (const t of tasksForDate(startDate, d, keepShabbat, fasting)) {
      if (t.type === "number") {
        let v = null;
        if (t.auto === "steps") v = stepsByDate[d];
        else if (t.auto === "water") v = waterByDate[d];
        else v = ans[t.id];
        if (v != null && v > 0) { sums[t.id] = (sums[t.id] || 0) + v; ns[t.id] = (ns[t.id] || 0) + 1; }
      } else if (taskDone(t, ans, au)) {
        counts[t.id] = (counts[t.id] || 0) + 1;
        if (t.id === "noscreens" || t.id === "stopeating") sleepDay = true; // at least one sleep-improvement task that day
        if (t.id === "grains" || t.id === "goodfat") grainDay = true; // at least one of whole-grains / healthy-fat that day
      }
    }
    if (sleepDay) sleepDays++;
    if (grainDay) grainsDays++;
    const dl = log.filter((e) => e.date === d);
    if (dl.length) {
      const kc = dl.reduce((s, e) => s + (e.kcal || 0), 0);
      const pr = dl.reduce((s, e) => s + (e.p || 0), 0);
      calSum += kc; calN++; protSum += pr; protN++;
      if (dailyTarget > 0 && kc >= dailyTarget * 0.95 && kc <= dailyTarget * 1.05) calOnGoal++;
    }
  }
  const avgs = {};
  for (const id in sums) avgs[id] = { avg: Math.round(sums[id] / ns[id]), n: ns[id] };
  return {
    days: dates.length, counts, avgs,
    journalDays: calN, sleepDays, grainsDays,
    cal: calN ? { avg: Math.round(calSum / calN), target: Math.round(dailyTarget), onGoal: calOnGoal } : null,
    protein: protN ? { avg: Math.round(protSum / protN), target: targets.protein } : null,
    stepsPrev: summaryStepsAvg(week - 1, startDate, today, stepsByDate),
  };
}

// ---- Weeks 2-10 weekly summary: curated per-week narrative (Anat voice). ----
// Each week shows a CURATED subset of tasks (not every active task), matching the WhatsApp summaries.
const WK_INTRO = {
  2: ["שבועיים של תנועה קדימה - וכל פעולה שעשית בהם נחשבת! 🌱", "לא תמיד הכל נכנס בול לשגרה, וזה בסדר גמור. כל משימה שביצעת היא הוכחה שאת בוחרת בעצמך, וזה מה שבאמת חשוב.", "יש פה התקדמות, ויש רצון - וזה כל מה שצריך כדי לבנות יסודות חזקים לאורך זמן.", "בואי נעבור על המשימות:"],
  3: ["השבוע הזה הוכחת לעצמך שאת מחויבת לתהליך ולשיפור באיכות החיים שלך, וכל משימה שביצעת היא הצלחה בפני עצמה.", "שימי לב למה כן עבד, תני מקום למה שפחות, ותזכרי: שינוי אמיתי נבנה עם גמישות וסבלנות 🙏", "בואי נעבור על המשימות ונראה איך את מעלה הילוך מכאן:"],
  4: ["כבר חודש שלם של בחירה בעצמך - זה הישג ענק! 🎉", "ההתמדה שלך לאורך 4 שבועות מוכיחה שאת ממש בונה הרגלים שמחזיקים לאורך זמן. מה שעשית עד עכשיו הוא בסיס מצוין - זה הזמן להקשיב לעצמך, להתכוונן ולדייק את ההמשך. גם תהליך עמוק לוקח זמן להתייצב, ואת בתנועה הנכונה.", "בואי נעבור על המשימות ונראה איך את מעלה הילוך מכאן:"],
  5: ["חמישה שבועות של עשייה, עקביות ובחירה מודעת בעצמך - זה הישג מרגש! 🌟", "כשאת מתמידה, את לא רק בונה תוצאות - את בונה אמון בעצמך. כל שבוע מחזק את הבסיס שלך, וכל צעד מעיד על עוצמה פנימית אמיתית. מה שביצעת חשוב, ומה שלא - לא מבטל שום דבר.", "בואי נעבור על המשימות:"],
  6: ["שישה שבועות של התקדמות - זה כבר לא הרגל, זו דרך חיים 💪", "ההתמדה שלך מוכיחה שוב שאת מחויבת לעצמך ולבריאות שלך, וזה ניכר בכל רמה - בגוף, בנפש ובמחשבה. וזכרי, כל פעולה שעשית היא בחירה בעצמך, וכל בחירה כזו שווה המון. המסע הזה הוא לא מבחן - אלא תהליך שמתקדם בדיוק בקצב שלך 💛", "בואי נעבור על המשימות:"],
  7: ["איזו דרך מרשימה עברת - 7 שבועות של מחויבות לעצמך! 👏", "את כבר לא בתחילת הדרך - את עמוק בתוך תהליך של שינוי אמיתי. ההתמדה שלך מוכיחה שוב ושוב שכשאת בוחרת בעצמך, את פורחת 🌸", "בואי נעבור על המשימות:"],
  8: ["שמונה שבועות של בחירה מודעת בעצמך - זה מרשים ומעורר השראה ✨", "ההתמדה שלך היא לא רק עדות למחויבות - היא הדרך שבה את בונה שגרה חדשה ובריאה יותר. אולי לא הכל יצא לפי התכנון, אבל כל דבר שבחרת לעשות היה משמעותי. היופי בתהליך הזה הוא שהוא גמיש, נושם ומתאים את עצמו אלייך, לא להפך.", "בואי נעבור על המשימות:"],
  9: ["כמעט 10 שבועות של התמדה - זה לא מובן מאליו, זה מרשים! 👏", "מהשבוע הראשון ועד עכשיו את מראה יציבות, נחישות והקשבה אמיתית לעצמך, והדרך שעשית עד כה היא כבר הישג בפני עצמו. וגם אם השבוע היה פחות מדויק - את עדיין ממשיכה בדרך שלך. החוכמה היא לא דווקא להספיק הכול, אלא לדעת לחזור לדברים שפספסת, ויש לך מספיק זמן לשם כך (עוד 3 חודשים שהאפליקציה פתוחה לך).", "בואי נעבור על המשימות:"],
  10: ["10 שבועות של בחירה יומיומית בעצמך - וזה ניכר בכל צעד שלך 💪", "ההתמדה, המחויבות והנוכחות שלך הפכו את התהליך הזה למשהו עמוק ואמיתי. את יוצאת מהתוכנית לא רק עם תוצאות - אלא עם הרגלים, הבנה חדשה וכלים שילוו אותך קדימה. וזכרי, אין איחורים - יש לך עוד 3 חודשים לחזור למשימות, להשלים ולעבור שוב על התכנים, בזמן שלך.", "בואי נעבור על המשימות:"],
};
const WK_OUTRO = {
  2: { lines: ["🌿 שבוע חדש = הזדמנות חדשה לזרוח!", "בחרי בעצמך גם השבוע, בצעד אחד בכל פעם - וזה כל מה שצריך 💫", "נמשיך ביום א' הקרוב, בינתיים מאחלת לך סוף שבוע מקסים ואל תשכחי את המשימות החדשות שלך 🙏"], ps: "כשאת עושה את הדברים בהדרגה - אין שום דבר שגדול עליך!" },
  3: { lines: ["השבוע החדש שלפניך הוא הזדמנות לבחור שוב בעצמך - ולהוכיח לעצמך כמה את יכולה. המשיכי כך, את לגמרי בכיוון הנכון 🚀", "נמשיך ביום א' הקרוב, בינתיים תעשי כיף בסוף השבוע ואל תשכחי את המשימות החדשות שלך 🙏"], ps: "זכרי, הרגע שבו תתחילי להתייחס לכל קושי בדרך כעוד מדרגה שמאפשרת לך לצמוח - יהיה רגע שיכול לשנות את חייך!" },
  4: { lines: ["השבוע הבא? הזדמנות לחגוג את הדרך ולהמשיך לעלות שלב 💪 דף חדש, אנרגיה חדשה - ממשיכים קדימה, עם חיוך ואמונה בך ✨", "נמשיך ביום א' הקרוב, בינתיים תעשי כיף בסוף השבוע ואל תשכחי את המשימות החדשות שלך 🙏"] },
  5: { lines: ["השבוע הבא? הזדמנות להרגיש אפילו יותר קלילה, חזקה ומדויקת 💪 השבוע החדש הוא לא תיקון - הוא המשך.", "אני איתך - והדרך שלך פשוט מעוררת השראה ✨", "נמשיך ביום א' הקרוב, בינתיים תעשי כיף בסוף השבוע ואל תשכחי את המשימות החדשות שלך 🙏"] },
  6: { lines: ["🌟 השבוע החדש מביא איתו הזדמנות לרענן, להתחזק, ולהתקרב עוד צעד למה שמדויק לך. אין צורך להיות מושלמת - רק להמשיך לבחור בעצמך, בכל יום מחדש 💖", "אני איתך - והדרך שלך פשוט מעוררת השראה ✨", "נמשיך ביום א' הקרוב..."] },
  7: { lines: ["בשבוע הבא מזמינה אותך להמשיך ללטש, ליהנות מההישגים - ולהתאהב בתהליך עוד יותר 💪", "נמשיך ביום א' הקרוב...", "סופ\"ש נעים ✨"] },
  8: { lines: ["השבוע הבא מחכה לך עם עוד שלב בהתפתחות - תני לעצמך ליהנות מהדרך 🌷", "נמשיך ביום א' הקרוב...", "סופ\"ש נעים ✨"] },
  9: { lines: ["הזדמנות ליהנות מהפירות של כל מה שבנית עד עכשיו, ולהמשיך את התהליך בקצב שלך, בלי לחץ ועם הרבה אמונה 💛", "נמשיך ביום א' הקרוב...", "סופ\"ש נעים ✨"] },
  10: { lines: ["זה אולי השבוע האחרון בתוכנית - אבל זו רק ההתחלה שלך 💫", "תזכרי: את יודעת להוביל את עצמך. כל מה שאת צריכה כבר נמצא בתוכך - יש לך את הזמן, יש לך את הכלים, ובעיקר יש לך את עצמך.", "אני גאה בך, ונרגשת לראות איך תמשיכי לפרוח גם בהמשך 🌸", "אני איתך 💜"] },
};
const WK_TASKS = {
  2: ["steps", "journal", "strength", "veg_order"],
  3: ["steps", "journal", "strength", "veg_order", "water_full", "protein"],
  4: ["steps", "strength", "veg_order", "water_full", "protein", "sleep_full", "breathing"],
  5: ["steps", "strength", "water_full", "protein", "sleep_full", "breathing", "gratitude"],
  6: ["steps", "strength", "water_full", "grains_split", "sleep_full", "gratitude", "protein"],
  7: ["steps", "strength", "pelvic", "water_full", "grains_combined", "sleep_full", "gratitude", "protein", "probiotics"],
  8: ["steps", "strength", "pelvic", "water_simple", "grains_combined", "sleep_simple", "protein", "probiotics", "antiinflam", "fasting"],
  9: ["steps", "strength_mobility", "pelvic", "water_simple", "grains_combined", "sleep_simple", "protein", "probiotics", "antiinflam", "bonedensity", "fasting"],
  10: ["steps", "strength_mobility", "pelvic", "water_simple", "grains_combined", "sleep_simple", "protein", "probiotics", "antiinflam", "bonedensity", "fasting"],
};
// Build one summary line {t:title, e:emoji, d:detail, isNew?} from app data. Returns null to skip (e.g. fasting when off).
// Hebrew dual-aware count phrases for the weekly summary (0 and 1 are handled inline below; these add the dual form for exactly 2).
function sumDays(n) { return n === 1 ? "יום אחד" : n === 2 ? "יומיים" : `${n} ימים`; }
function sumBDays(n) { return n === 1 ? "ביום אחד" : n === 2 ? "ביומיים" : `ב-${n} ימים`; }
function sumTimes(n) { return n === 1 ? "פעם אחת" : n === 2 ? "פעמיים" : `${n} פעמים`; }

function summaryTaskLine(key, week, data, fasting) {
  const A = data.avgs || {}, K = data.counts || {};
  const avg = (id) => (A[id] ? A[id].avg : 0);
  const navg = (id) => (A[id] ? A[id].n : 0);
  const cnt = (id) => (K[id] || 0);
  const amt = (v, one, many) => (v === 1 ? one : `${typeof v === "number" ? v.toLocaleString() : v} ${many}`); // singular-aware amount
  switch (key) {
    case "steps": {
      const n = navg("steps"), a = avg("steps").toLocaleString();
      const d = n === 0 ? "השבוע עוד לא דיווחת על הצעדים."
        : n === 1 ? `השבוע דיווחת פעם אחת על הצעדים - ${a} צעדים ביום.`
        : <>השבוע דיווחת {sumTimes(n)} על הצעדים. ממוצע הצעדים לימים שדיווחת <b>השבוע</b> - {a} צעדים ביום בממוצע.</>;
      return { e: "💃", t: "משימת הצעדים", d };
    }
    case "journal": {
      const c = cnt("journal") || data.journalDays || 0;
      const d = c === 0 ? "השבוע עוד לא מילאת יומן מעקב תזונה."
        : c === 1 ? "מילאת יומן מעקב תזונה ביום אחד."
        : `במהלך ${sumDays(c)} מילאת יומן מעקב תזונה.`;
      return { e: "✍️", t: "משימת יומן תזונה", d };
    }
    case "strength": {
      const c = cnt("strength");
      const d = c === 0 ? "השבוע עוד לא ביצעת אימוני כוח."
        : c === 1 ? "ביצעת השבוע אימון כוח אחד."
        : `ביצעת השבוע ${c} אימוני כוח.`;
      return { e: "🦾", t: "משימת אימוני כוח", d };
    }
    case "strength_mobility": {
      const s = cnt("strength"), m = cnt("mobility");
      const sTxt = s === 0 ? "לא ביצעת אימוני כוח" : s === 1 ? "ביצעת אימון כוח אחד" : `ביצעת ${s} אימוני כוח`;
      const mTxt = m === 0 ? "ולא אימוני מוביליטי" : m === 1 ? "ואימון מוביליטי אחד" : `ו-${m} אימוני מוביליטי`;
      const d = (s === 0 && m === 0) ? "השבוע עוד לא ביצעת אימוני כוח או מוביליטי." : `השבוע ${sTxt} ${mTxt} 🤸‍♀️`;
      return { e: "🦾", t: "משימת אימוני כוח ומוביליטי", d };
    }
    case "veg_order": {
      const v = avg("veg"), mo = avg("mealorder");
      const d = (v === 0 && mo === 0) ? "השבוע עוד לא דיווחת על שילוב ירקות וסדר אכילה."
        : `שילבת בממוצע ${amt(v, "צבע אחד", "צבעים")} של ירקות בכל יום, וגם שילבת סדר אכילה ב${mo === 1 ? "ארוחה אחת" : `-${mo} ארוחות`} בממוצע!`;
      return { e: "🥦", t: "משימות תזונה - שילוב ירקות וסדר אכילה", d };
    }
    case "water_full": {
      const db = cnt("drinkbefore"), cups = avg("water");
      const cupsTxt = `בממוצע שתית ${amt(cups, "כוס אחת", "כוסות")} מים`;
      const d = db === 0 ? `בשבוע האחרון עדיין לא דיווחת על מים לפני הארוחה. ${cupsTxt}.`
        : db === 1 ? `בשבוע האחרון, ביום אחד שתית מים לפני הארוחה, ובסך הכל ${cupsTxt}.`
        : `בשבוע האחרון, ${sumBDays(db)} שתית מים לפני הארוחה, ובסך הכל ${cupsTxt}.`;
      return { e: "🥛", t: "משימת שתיית מים", d };
    }
    case "water_simple": {
      const cups = avg("water");
      const d = cups === 0 ? "השבוע עוד לא דיווחת על שתיית מים." : `בממוצע שתית ${amt(cups, "כוס אחת", "כוסות")} מים.`;
      return { e: "🥛", t: "משימת שתיית מים", d };
    }
    case "protein": {
      const c = cnt("protein");
      const d = c === 0 ? "השבוע עוד לא עמדת ביעד החלבון."
        : c === 1 ? "ביום אחד עמדת ביעד החלבון שלך."
        : `במהלך ${sumDays(c)} עמדת ביעד החלבון שלך.`;
      return { e: "🍶", t: "משימת יעד חלבון", d };
    }
    case "sleep_full": {
      const sd = data.sleepDays || 0, h = avg("sleephours");
      const base = sd === 0 ? "השבוע עוד לא ביצעת את משימות שיפור השינה" : sd === 1 ? "ביום אחד ביצעת את משימות שיפור השינה" : `במהלך ${sumDays(sd)} ביצעת את משימות שיפור השינה`;
      const hTxt = h > 0 ? ` וישנת בממוצע ${amt(h, "שעה אחת", "שעות")} בימים שדיווחת` : "";
      const d = (sd === 0 && h === 0) ? "השבוע עוד לא דיווחת על השינה." : `${base}${hTxt}.`;
      return { e: "😴", t: "משימת שיפור השינה", d };
    }
    case "sleep_simple": {
      const h = avg("sleephours");
      const d = h === 0 ? "השבוע עוד לא דיווחת על שעות שינה." : `ישנת בממוצע ${amt(h, "שעה אחת", "שעות")} בימים שדיווחת.`;
      return { e: "😴", t: "משימת שיפור השינה", d };
    }
    case "breathing": {
      const c = cnt("breathing");
      const d = c === 0 ? "השבוע עוד לא ביצעת תרגילי נשימה."
        : c === 1 ? "ביום אחד ביצעת תרגילי נשימה."
        : `במהלך ${sumDays(c)} ביצעת תרגילי נשימה.`;
      return { e: "😮‍💨", t: "משימת תרגול נשימה", d };
    }
    case "gratitude": {
      const c = cnt("gratitude");
      const d = c === 0 ? "השבוע עוד לא ביצעת את משימת הכרת התודה."
        : c === 1 ? "ביום אחד ביצעת את משימת הכרת התודה."
        : `במהלך ${sumDays(c)} ביצעת את משימת הכרת התודה.`;
      return { e: "🙏", t: "משימת הכרת התודה", d };
    }
    case "grains_split": {
      const gf = cnt("goodfat"), gr = cnt("grains");
      const part = (n, label) => n === 0 ? `עדיין לא הוספת ${label}` : n === 1 ? `ביום אחד הוספת ${label}` : `${sumBDays(n)} הוספת ${label}`;
      const d = (gf === 0 && gr === 0) ? "השבוע עוד לא הוספת שומן בריא או דגנים מלאים." : `${part(gf, "שומן בריא")}, ו${part(gr, "דגנים מלאים ו/או קטניות")}.`;
      return { e: "🌱", t: "משימת תזונה - שילוב דגנים מלאים ושומנים בריאים", d };
    }
    case "grains_combined": {
      const c = data.grainsDays || 0;
      const d = c === 0 ? "השבוע עוד לא הוספת דגנים מלאים, קטניות או שומן בריא."
        : c === 1 ? "ביום אחד הוספת דגנים מלאים ו/או קטניות ו/או שומן בריא."
        : `במהלך ${sumDays(c)} הוספת דגנים מלאים ו/או קטניות ו/או שומן בריא.`;
      return { e: "🌱", t: "משימת תזונה - שילוב דגנים מלאים ושומנים בריאים", d };
    }
    case "pelvic": {
      const c = cnt("pelvic");
      const d = c === 0 ? "השבוע עוד לא תרגלת את משימת רצפת האגן."
        : c === 1 ? "תרגלת את משימת רצפת האגן פעם אחת."
        : `תרגלת את משימת רצפת האגן ${sumTimes(c)}.`;
      return { e: "🧘‍♀️", t: "משימת רצפת האגן", d, isNew: week === 7 };
    }
    case "probiotics": {
      const c = cnt("probiotics");
      const d = c === 0 ? "השבוע עוד לא הוספת פרוביוטיקה לתזונה."
        : c === 1 ? "הוספת פרוביוטיקה לתזונה ביום אחד."
        : `הוספת פרוביוטיקה לתזונה במשך ${sumDays(c)}.`;
      return { e: "🪄", t: "משימת פרוביוטיקה", d, isNew: week === 7 };
    }
    case "antiinflam": {
      const c = cnt("antiinflam");
      const d = c === 0 ? "השבוע עוד לא עשית את משימת המזון האנטי-דלקתי."
        : c === 1 ? "עשית את משימת המזון האנטי-דלקתי ביום אחד."
        : `עשית את משימת המזון האנטי-דלקתי במשך ${sumDays(c)}.`;
      return { e: "🙅‍♀️", t: "משימת מזון אנטי-דלקתי", d };
    }
    case "bonedensity": {
      const ca = cnt("calcium"), su = cnt("sun");
      const part = (n, verb) => n === 0 ? `עדיין לא ${verb}` : n === 1 ? `ביום אחד ${verb}` : `במשך ${sumDays(n)} ${verb}`;
      const d = (ca === 0 && su === 0) ? "השבוע עוד לא דיווחת על סידן וחשיפה לשמש." : `${part(ca, "הוספת לתזונה מזון עשיר בסידן")}, ו${part(su, "דאגת לחשיפה בריאה לשמש")}.`;
      return { e: "🦴", t: "משימת צפיפות העצם", d };
    }
    case "fasting": return fasting ? { e: "🕘", t: "משימת צום לסירוגין (רשות)", d: avg("fasting") === 0 ? "השבוע עוד אין נתוני צום לסירוגין." : `חלון הצום שלך נמשך ${amt(avg("fasting"), "שעה אחת", "שעות")} בממוצע.` } : null;
    default: return null;
  }
}

function WeeklySummaryModal({ date, startDate, today, checkins, log, stepsByDate, waterByDate, targets, cupMl, keepShabbat, name, dailyTarget, stepGoal, fasting, onClose }) {
  const week = Math.min(programWeekFor(startDate, date), 10);
  const data = weeklySummaryData(week, startDate, today, checkins, log, stepsByDate, waterByDate, targets, cupMl, keepShabbat, dailyTarget, fasting);
  // One-time baseline sanity note: Friday of week 2 only. If she is tracking well BELOW her goal,
  // gently suggest a more realistic baseline (set in the profile). Anat's gradual increases continue from it.
  const wkStepAvg = data.avgs.steps ? data.avgs.steps.avg : null;
  const stepRecheckDir = (week === 2 && stepGoal != null && wkStepAvg != null)
    ? (wkStepAvg < stepGoal * 0.8 ? "low" : wkStepAvg > stepGoal * 1.2 ? "high" : null)
    : null;
  const wk1 = week === 1;
  const WK_ORD = ["", "הראשון", "השני", "השלישי", "הרביעי", "החמישי", "השישי", "השביעי", "השמיני", "התשיעי", "העשירי"];
  const titleEl = <div style={{ fontWeight: 800, color: C.brandD, textAlign: "center", fontSize: 17.5, lineHeight: 1.4, marginBottom: 12 }}>{`סיכום שבועי של משימות השבוע ${WK_ORD[week] || ""} שלך במיי פריים!`}</div>;
  // Achievements earned THIS week: daily medals (completed days) + the weekly trophy.
  let wkMedals = 0;
  for (let dnum = (week - 1) * 7 + 1; dnum <= week * 7; dnum++) {
    const d = addDays(startDate, dnum - 1);
    if (d > today) break;
    if (checkins[d] && checkins[d]._done) wkMedals++;
  }
  const wkTrophy = weekTrophyEarned(checkins, startDate, week, today);
  const achievementsEl = (wkMedals > 0 || wkTrophy) ? (
    <div style={{ background: C.panel, border: `1.5px solid ${C.brand}`, borderRadius: 16, marginTop: 16, padding: "18px 14px", textAlign: "center", boxShadow: "0 2px 10px rgba(168,66,92,0.10)" }}>
      <div style={{ fontSize: 18.5, fontWeight: 800, color: C.brandD, marginBottom: 14 }}>ההישגים שלך השבוע 🏆</div>
      {wkMedals > 0 && (
        <div style={{ marginBottom: wkTrophy ? 18 : 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 6, marginBottom: 8 }}>
            {Array.from({ length: wkMedals }).map((_, i) => (<img key={i} src={MEDAL_SRC} alt="" width={48} height={48} style={{ display: "block" }} />))}
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>{wkMedals} {wkMedals === 1 ? "מדליה יומית" : "מדליות יומיות"} השבוע</div>
          <div style={{ fontSize: 14, color: C.sub, marginTop: 2 }}>כל יום שהשלמת 💜</div>
        </div>
      )}
      {wkTrophy && (
        <div>
          <img src={trophyForWeek(week)} alt="" width={92} height={92} style={{ display: "block", margin: "0 auto", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.2))" }} />
          <div style={{ fontSize: 16, color: C.brandD, fontWeight: 800, marginTop: 6 }}>{week >= 10 ? "גביע האלופה נכנס לארון! 🎉" : "גביע השבוע נכנס לארון! 🎉"}</div>
        </div>
      )}
    </div>
  ) : null;
  const stepsDays = data.avgs.steps ? data.avgs.steps.n : 0;
  const stepsAvg = data.avgs.steps ? data.avgs.steps.avg : 0;
  const journalDays = data.journalDays || 0;
  const wk1HasData = stepsDays > 0 || journalDays > 0;
  const wk1StepsLine = stepsDays === 0
    ? "השבוע עוד לא דיווחת על הצעדים."
    : stepsDays === 1
    ? `השבוע דיווחת פעם אחת על הצעדים - ${stepsAvg.toLocaleString()} צעדים ביום.`
    : <>השבוע דיווחת {sumTimes(stepsDays)} על הצעדים. ממוצע הצעדים לימים שדיווחת <b>השבוע</b> - {stepsAvg.toLocaleString()} צעדים ביום בממוצע.</>;
  const wk1JournalLine = journalDays === 0
    ? "השבוע עוד לא מילאת יומן מעקב תזונה."
    : journalDays === 1
    ? "מילאת יומן מעקב תזונה ביום אחד."
    : `במהלך ${sumDays(journalDays)} מילאת יומן מעקב תזונה.`;
  const wk1Lines = [
    "סיימת את השבוע הראשון שלך - וזה לגמרי שווה חגיגה! 🎉",
    "כל פעולה שביצעת השבוע היא משמעותית, ועוד צעד בכיוון הנכון 🌱",
    "ההתחלה הזו מראה שיש לך את כל מה שצריך בשביל להצליח.",
    wk1StepsLine,
    wk1JournalLine,
    "אני גאה בך - תמשיכי להוביל את עצמך קדימה 💖",
    "נמשיך ביום א' הקרוב, בינתיים תעשי כיף בסוף השבוע ואל תשכחי את המשימות החדשות שלך 🙏",
    "אני איתך,",
  ];
  const emptyState = <div style={{ textAlign: "center", color: C.sub, padding: "24px 12px", lineHeight: 1.7 }}>עוד אין נתונים לשבוע הזה.<br />ברגע שתתחילי למלא, הסיכום יופיע כאן.</div>;
  const hasData = (data.avgs && Object.keys(data.avgs).length > 0) || (data.counts && Object.keys(data.counts).length > 0) || !!data.journalDays;
  const intro = WK_INTRO[week] || [];
  const outro = WK_OUTRO[week] || { lines: [] };
  const taskLines = (WK_TASKS[week] || []).map((k) => summaryTaskLine(k, week, data, fasting)).filter(Boolean);
  const recheckBox = stepRecheckDir && (
    <div style={{ background: C.amberBg, border: `1.5px solid ${C.amber}`, borderRadius: 14, padding: "14px", margin: "4px 0 14px", fontSize: 15.5, color: C.ink, lineHeight: 1.65, textAlign: "right" }}>
      {stepRecheckDir === "low"
        ? <>שמנו לב שהשבוע הלכת בממוצע <b>{wkStepAvg.toLocaleString()}</b> צעדים ביום, מתחת ליעד הנוכחי ({stepGoal.toLocaleString()}). אם היעד מרגיש גבוה - אפשר לכוון בפרופיל בסיס ריאלי יותר שתנצחי אותו, וממנו נמשיך לעלות בהדרגה יחד 💜</>
        : <>כל הכבוד - השבוע הלכת בממוצע <b>{wkStepAvg.toLocaleString()}</b> צעדים ביום, הרבה מעל היעד ({stepGoal.toLocaleString()}). את עוברת אותו שוב ושוב - אם בא לך אתגר, אפשר לכוון בפרופיל בסיס גבוה יותר, וממנו נמשיך לעלות בהדרגה יחד 💜</>}
    </div>
  );
  return (
    <SheetShell title={`סיכום שבוע ${week}`} onClose={onClose}>
      {wk1 ? (
        !wk1HasData ? emptyState : (
          <div style={{ background: C.brandBg, borderRadius: 14, padding: "16px", color: C.ink, fontSize: 16, lineHeight: 1.7 }}>
            {titleEl}
            {wk1Lines.map((ln, i) => (<div key={i} style={{ marginBottom: 8 }}>{ln}</div>))}
            <div style={{ fontWeight: 800, color: C.ink, marginBottom: 10 }}>ענת</div>
            <div style={{ fontSize: 16, color: C.ink, lineHeight: 1.7, marginTop: 8 }}><b>נ.ב.</b> אל תחששי לצאת מאזור הנוחות שלך - זה פתח לדברים מדהימים שמחכים לך בהמשך הדרך!</div>
            {achievementsEl}
          </div>
        )
      ) : !hasData ? emptyState : (
        <div style={{ background: C.brandBg, borderRadius: 14, padding: "16px", color: C.ink, fontSize: 16, lineHeight: 1.7 }}>
          {titleEl}
          {intro.map((p, i) => (<div key={`i${i}`} style={{ marginBottom: 8 }}>{p}</div>))}
          <div style={{ display: "flex", flexDirection: "column", gap: 12, margin: "12px 0" }}>
            {taskLines.map((l, i) => (
              <div key={`t${i}`}>
                <div style={{ fontWeight: 700, color: C.ink, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  {l.isNew && <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", background: C.brand, borderRadius: 8, padding: "1px 8px" }}>חדש</span>}
                  <span>{l.t} {l.e}</span>
                </div>
                <div style={{ color: C.sub, marginTop: 2 }}>{l.d}</div>
              </div>
            ))}
          </div>
          {recheckBox}
          {outro.lines.map((p, i) => (<div key={`o${i}`} style={{ marginBottom: 8 }}>{p}</div>))}
          <div style={{ fontWeight: 800, color: C.ink, marginTop: 4 }}>ענת</div>
          {outro.ps && <div style={{ fontSize: 16, color: C.ink, lineHeight: 1.7, marginTop: 8 }}><b>נ.ב.</b> {outro.ps}</div>}
          {achievementsEl}
        </div>
      )}
    </SheetShell>
  );
}

function StepSetupModal({ action, profile, stepsByDate, startDate, programWeek, onBaseline, onIncrease, onClose }) {
  const isBaseline = action.kind === "baseline";
  const measured = stepBaseline(stepsByDate, startDate);
  const suggested = isBaseline
    ? (measured != null ? measured : 3000)
    : ((profile.stepGoal != null ? profile.stepGoal : (profile.stepBaseline || 0)) + action.inc);
  const [val, setVal] = useState(Math.max(500, Math.round(suggested / 250) * 250));
  const offset = stepGoalCumOffset(programWeek); // how much we add above the average to set the goal (e.g. +2,000 in week 2)
  const goalVal = val + offset;
  const stepBtn = { width: 46, height: 46, borderRadius: 12, border: `1px solid ${C.line}`, background: C.panel, color: C.brand, fontSize: 25, fontWeight: 700, cursor: "pointer", fontFamily: fontStack };
  return (
    <SheetShell title={isBaseline ? "יעד הצעדים שלך" : "היעד שלך עולה"} onClose={onClose}>
      <div style={{ textAlign: "right", fontSize: 15.5, color: C.sub, lineHeight: 1.7, marginBottom: 14 }}>
        {isBaseline
          ? (measured != null
            ? <>לפי הצעדים שמדדנו עד כה, הממוצע שלך הוא בערך <b style={{ color: C.ink }}>{val.toLocaleString()}</b> צעדים ביום. המשימה לשבוע הקרוב: להוסיף עוד <b style={{ color: C.ink }}>{offset.toLocaleString()}</b> צעדים. אפשר לשנות את הממוצע למטה אם הוא לא מדויק.</>
            : <>בואי נקבע מאיפה מתחילים. כמה צעדים בערך את עושה ביום רגיל? למספר הזה נוסיף <b style={{ color: C.ink }}>{offset.toLocaleString()}</b> צעדים, וזה יהיה היעד שלך לשבוע הקרוב.<div style={{ fontSize: 13.5, color: C.faint, marginTop: 6 }}>לא בטוחה? בתחילת הדרך רוב הנשים נעות בין 2,000 ל-4,000. תמיד אפשר לעדכן.</div></>)
          : <>כל הכבוד על ההתמדה. השבוע מוסיפים לקצב - היעד עולה ב-<b style={{ color: C.ink }}>{action.inc.toLocaleString()}</b>. אפשר לאשר או לשנות. ממשיכות לעלות 💜</>}
      </div>
      <div style={{ fontSize: 13.5, color: C.faint, textAlign: "center", marginBottom: 4 }}>{isBaseline ? "הממוצע שלך" : "היעד החדש"}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 16, marginBottom: isBaseline ? 12 : 18 }}>
        <button onClick={() => setVal((v) => v + 250)} style={stepBtn}>+</button>
        <div style={{ textAlign: "center", minWidth: 110 }}>
          <div style={{ fontSize: 31, fontWeight: 800, color: C.ink }}>{val.toLocaleString()}</div>
          <div style={{ fontSize: 13.5, color: C.faint }}>צעדים ביום</div>
        </div>
        <button onClick={() => setVal((v) => Math.max(500, v - 250))} style={stepBtn}>-</button>
      </div>
      {isBaseline && offset > 0 && (
        <div style={{ background: C.amberBg, border: `1px solid ${C.amber}`, borderRadius: 12, padding: "11px 13px", marginBottom: 16, textAlign: "center", fontSize: 15.5, color: C.ink }}>
          היעד שלך לשבוע הקרוב: <b style={{ color: C.amber }}>{goalVal.toLocaleString()} צעדים</b> <span style={{ color: C.sub, fontSize: 14 }}>({val.toLocaleString()} + {offset.toLocaleString()})</span>
        </div>
      )}
      <button onClick={() => (isBaseline ? onBaseline(val) : onIncrease(action.week, val))} style={{ width: "100%", border: "none", borderRadius: 12, padding: "13px", background: C.brand, color: "#fff", fontSize: 17, fontWeight: 700, fontFamily: fontStack, cursor: "pointer" }}>
        {isBaseline ? (offset > 0 ? `מאשרת - היעד שלי ${goalVal.toLocaleString()}` : `מאשרת, נתחיל מ-${val.toLocaleString()}`) : `מאשרת - ${val.toLocaleString()} צעדים`}
      </button>
    </SheetShell>
  );
}

function GoalBumpModal({ info, name, onClose }) {
  const colors = [C.brand, C.amber, C.info, "#F4C04A", C.macroC];
  const newGoal = info ? info.newGoal : 0;
  const inc = info ? info.inc : 0;
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 46 }}>
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {Array.from({ length: 26 }).map((_, i) => (
          <span key={i} style={{ position: "absolute", top: -12, left: `${(i * 3.9) % 100}%`, width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], animation: `confettiFall ${1 + (i % 5) * 0.15}s ease-out ${(i % 7) * 0.08}s forwards` }} />
        ))}
      </div>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 24, padding: "28px 24px", textAlign: "center", maxWidth: 320, width: "100%", animation: "cheerPop 0.4s ease both", boxShadow: "0 18px 50px rgba(168,66,92,0.3)" }}>
        <div style={{ fontSize: 51 }}>👟</div>
        <div style={{ fontSize: 23, fontWeight: 700, color: C.ink, marginTop: 6 }}>כל הכבוד{name && name.trim() ? `, ${name.trim()}` : ""} 🤍</div>
        <div style={{ fontSize: 17, color: C.ink, marginTop: 10, lineHeight: 1.55 }}>היעד היומי שלך עלה היום ל-<b style={{ color: C.brandD }}>{newGoal.toLocaleString()} צעדים</b> (+{inc.toLocaleString()}).</div>
        <div style={{ fontSize: 15, color: C.sub, marginTop: 8 }}>ממשיכות צעד אחרי צעד!</div>
        <div style={{ marginTop: 18 }}><Btn onClick={onClose}>יאללה, ממשיכה</Btn></div>
      </div>
    </div>
  );
}

function DevDateBar({ onAnchor }) {
  const setDay = (d) => { try { window.localStorage.setItem("myprime_dev_today", d); } catch (e) {} window.location.reload(); };
  const reset = () => { try { window.localStorage.removeItem("myprime_dev_today"); } catch (e) {} window.location.reload(); };
  const btn = { background: "#444", color: "#fff", border: "none", borderRadius: 6, padding: "3px 9px", fontSize: 13, fontWeight: 700, fontFamily: fontStack, cursor: "pointer" };
  return (
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 99999, background: "#222", color: "#fff", display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8, padding: "5px 8px", fontSize: 12, fontFamily: fontStack, direction: "rtl" }}>
      <span style={{ opacity: 0.7 }}>DEV - יום מדומה</span>
      <button onClick={() => setDay(addDays(TODAY, -1))} style={btn}>-1</button>
      <input type="date" value={TODAY} onChange={(e) => { if (e.target.value) setDay(e.target.value); }} style={{ fontSize: 13, padding: "2px 5px", borderRadius: 6, border: "none", fontFamily: fontStack }} />
      <button onClick={() => setDay(addDays(TODAY, 1))} style={btn}>+1</button>
      <button onClick={reset} style={btn}>איפוס</button>
      <button onClick={() => onAnchor && onAnchor()} style={{ ...btn, background: "#0a7" }}>קבע יום 1</button>
    </div>
  );
}

const TIPS = [
  { key: "cal", sel: "cal", title: "הוספת מזון ופעילות (כפתור +)", due: (c) => c.progDay >= 3, text: "בלחיצה על הפלוס את ממלאת את המזון שאכלת ואת הפעילות הגופנית שעשית (חוץ מהצעדים). יש כמה דרכים: לספר במילים או בדיבור מה אכלת, לצלם את הארוחה, לסרוק ברקוד, או לחפש מזון ברשימה. אפשר לעדכן בכל פעם שאת מוסיפה משהו, לאורך כל היום.", prompt: "רוצה שאראה לך דוגמה?", choice: { yes: "כן, בבקשה", no: "אין צורך, נמשיך" } },
  { key: "steps", sel: "steps", title: "מילוי הצעדים", guide: true, due: (c) => c.stepsOpen, text: "כאן את ממלאת את הצעדים שלך. כדי לדעת כמה צעדים עשית, פתחי את אפליקציית הבריאות בטלפון (Apple Health באייפון, Samsung Health בסמסונג), מצאי את מספר הצעדים של היום, והזיני אותו כאן. עדיף למלא מאוחר ככל האפשר במהלך היום, ותמיד אפשר לעדכן - אל דאגה." },
  { key: "tracker", sel: "tracker", title: "המשימות היומיות", due: (c) => c.checkinOpen, text: "כאן ממלאים את המשימות היומיות. בכל יום מחכות לך המשימות שלך בשלב הזה - הקישי כדי לסמן מה השלמת, וכל יום שתסיימי מזכה אותך במדליה 💜" },
  { key: "cabinet", sel: "cabinet", title: "ארון ההישגים", due: (c) => c.checkinOpen, text: "כאן נאספים ההישגים שלך - המדליות היומיות והגביעים השבועיים. כיף לחזור ולראות כמה התקדמת לאורך הדרך." },
  { key: "trackerfill", sel: "tracker", due: (c) => c.manualTracker, text: "מהיום אנחנו מתחילות למלא את יומן המעקב במשימות שלא נכנסות באופן אוטומטי. היום לדוגמה נוספה משימת אימון כוח, ולאחר שתבצעי אימון כוח את יכולה לסמן וי במעקב." },
  { key: "stepbaseline", sel: "stepbanner", title: "קביעת בסיס הצעדים", due: (c) => c.stepBanner, text: "הגיע הזמן לקבוע את נקודת ההתחלה שלך במשימת הצעדים. זו נקודת הבסיס שממנה נעלה יחד בהדרגה - ותמיד אפשר לשנות אותה בהמשך." },
  { key: "water", sel: "water", title: "טבעת המים", due: (c) => c.waterOpen, text: "נוספה טבעת המים 💧 היעד הוא 2 ליטר ביום. בכל לחיצה על הפלוס מוסיפים כוס, ושם גם אפשר לקבוע את גודל הכוס שלך - כדי שהספירה תתאים בדיוק לכוס שאת שותה ממנה." },
  { key: "protein", sel: "protein", title: "טבעת החלבון", due: (c) => c.macroOpen, text: "נוספה טבעת החלבון. אותה את לא ממלאת - היא מתעדכנת לבד מתוך המזון שאת מזינה ביומן, כך שתמיד רואות כמה חלבון אכלת מול היעד היומי." },
  { key: "weeklysummary", sel: "weeklysummary", title: "הסיכום השבועי", due: (c) => c.week === 1 && c.weeklySummaryShown, text: "זה השבוע הראשון שלך בתוכנית! כאן מחכה לך סיכום שבועי קצר. ואם שכחת למלא משהו בימים שעברו - אפשר להשלים ולפתוח שוב את הסיכום, והוא יתעדכן." },
];

// ===== Day-3 guided app tour ("סיור באפליקציה") =====
// view = the screen the bubble belongs to (gates rendering): "day" | "caloriemenu" | "addfood" | "steps".
// open = the screen the tour itself opens when this step becomes active (demo-driven nav). undefined = leave as-is.
// tap:true = no screen-blocking backdrop; advances when the real action fires (event). Otherwise a button advances.
const TOUR_YES = [
  { view: "day", open: "day", sel: "cal", tap: true, event: "addcalorie", text: "בואי ננסה יחד 🙂 לחצי על כפתור ה-➕ של הקלוריות." },
  { view: "caloriemenu", open: "caloriemenu", sel: "entry-food", text: "בוחרים 'הוספת מזון'." },
  { view: "addfood", open: "addfood", sel: "method-history", text: "הדרך הכי מהירה - מוצרים שכבר הוספת נשמרים כאן וחוזרים בהקשה אחת. מושלם לדברים שחוזרים על עצמם 💜" },
  { view: "addfood", open: "addfood", sel: "method-ai", text: "ובשביל משהו חדש - הכי פשוט לספר לי. בהקשה על 'ספרי לי מה אכלת' אפשר לכתוב או לדבר בחופשיות, למשל 'חביתה משתי ביצים וכוס קפה'. אני אעריך את הקלוריות ואוסיף ליומן - וככל שתפרטי יותר, ההערכה מדויקת יותר." },
  { view: "day", open: "day", sel: "diarylist", text: "כל פריט שתוסיפי מופיע כאן ביומן שלך - ובלחיצה עליו תמיד אפשר לערוך או למחוק אותו." },
  { view: "caloriemenu", open: "caloriemenu", sel: "entry-activity", text: "ובאותו כפתור אפשר גם להוסיף פעילות גופנית. כל אימון או פעילות שתזיני מתווספים לתקציב הקלוריות היומי שלך, כלומר מגדילים את הכמות שמותר לך לאכול באותו יום. הליכה לא נספרת כאן - היא נמדדת לבד דרך הצעדים 💜" },
  { view: "day", open: "day", sel: "steps", tap: true, event: "opensteps", text: "עכשיו הצעדים 👟 לחצי על הפלוס של הצעדים." },
  { view: "steps", open: "steps", sel: "steps-input", text: <>כאן מזינים את מספר הצעדים. פותחים את אפליקציית הבריאות בטלפון, רואים כמה צעדים נצברו היום, ומזינים את המספר כאן. <b>אפשר לעדכן את הצעדים כמה פעמים שתרצי במהלך היום (וגם לימים קודמים) - אל דאגה.</b></> },
  { view: "day", open: "day", sel: "tracker", text: "וכאן המשימות היומיות. שתי המשימות הראשונות מסומנות אוטומטית כשאת ממלאת בפלוס את הצעדים והקלוריות 💜" },
];
const TOUR_NO = [
  { view: "day", open: "day", sel: "steps", text: "כאן את ממלאת את הצעדים שלך. כדי לדעת כמה צעדים עשית, פתחי את אפליקציית הבריאות בטלפון, מצאי את מספר הצעדים של היום, והזיני אותו כאן. תמיד אפשר לעדכן." },
  { view: "day", open: "day", sel: "tracker", text: "כאן ממלאים את המשימות היומיות. בכל יום מחכות לך המשימות שלך - הקישי כדי לסמן מה השלמת, וכל יום שתסיימי מזכה אותך במדליה 💜" },
];
const TOUR_TAIL = [
  { view: "day", open: "day", sel: "cabinet", text: "כאן נאספים ההישגים שלך - המדליות היומיות והגביעים השבועיים. כיף לחזור ולראות כמה התקדמת לאורך הדרך." },
  { view: "day", open: "day", sel: "nav-day", text: "כפתור 'היומן' תמיד יחזיר אותך לכאן - למסך מילוי המשימות היומיות." },
  { view: "day", open: "day", sel: "nav-report", text: "ב'דוח' תוכלי לעקוב אחרי ההתקדמות שלך לאורך זמן, במגוון מדדים." },
  { view: "day", open: "day", sel: "nav-fab", text: "ה-➕ שבמרכז הוא קיצור דרך מהיר לכל הפעולות החשובות, מכל מסך באפליקציה." },
  { view: "day", open: "day", sel: "nav-recipes", text: "ב'מתכונים' מחכים לך כל המתכונים של התוכנית - ואם תרצי, אפשר להוסיף אותם ליומן בלחיצה." },
  { view: "day", open: "day", sel: "nav-profile", text: "ב'פרופיל' נמצאות ההעדפות התזונתיות שלך ונתונים נוספים, כמו היעד הקלורי המומלץ ויעד הצעדים היומי. ניתן לעדכן את נתוני הפרופיל בכל זמן שתרצי :)" },
  { view: "day", open: "day", sel: "notesfab", text: "יש לך הערה? נשמח מאוד לשמוע כדי לשפר 💜 כפתור הבועה כאן בצד שמאל זמין לך בכל מסך - אפשר להשאיר לנו הערה מכל מקום באפליקציה." },
  { view: "day", open: "day", sel: "daystrip", text: "את יכולה תמיד לחזור לימים קודמים דרך סרגל הזמן שלמעלה, או בהחלקה ימינה ושמאלה על המסך (סוויפ)." },
  { view: "day", open: "day", sel: "tourbtn", btn: "סיימנו", last: true, text: "ואם לא הספקת לקלוט הכל - אל דאגה 💜 תמיד אפשר להתחיל את הסיור מחדש דרך כפתור 'סיור באפליקציה' כאן במסך, או למצוא תשובות ב'שאלות ותשובות' שבפרופיל." },
];
function buildTour(path) {
  const intro = { view: "day", open: "day", sel: "cal", prompt: "רוצה שאראה לך דוגמה?", choice: { yes: "כן, בבקשה", no: "אין צורך, נמשיך" }, text: "בלחיצה על הפלוס את ממלאת את המזון שאכלת ואת הפעילות הגופנית שעשית (חוץ מהצעדים). יש כמה דרכים: לספר במילים או בדיבור מה אכלת, לצלם את הארוחה, לסרוק ברקוד, או לחפש מזון ברשימה." };
  if (!path) return [intro];
  return [intro, ...(path === "yes" ? TOUR_YES : TOUR_NO), ...TOUR_TAIL];
}

// Entries below restate copy already in the app (no new claims).
const FAQ_ITEMS = [
  { q: "איך מתקינים את האפליקציה בטלפון (כמו אפליקציה רגילה)?", a: "באנדרואיד פותחים בדפדפן Chrome, נכנסים לתפריט שלוש הנקודות ובוחרים 'הוספה למסך הבית'. באייפון פותחים ב-Safari, מקישים על כפתור השיתוף ובוחרים 'הוספה למסך הבית'. כך נוצר אייקון של האפליקציה במסך הבית, ואפשר לפתוח אותה בלחיצה אחת כמו אפליקציה רגילה." },
  { q: "האפליקציה נראית ישנה או לא מתעדכנת - איך מרעננים?", a: "באנדרואיד אפשר למשוך את המסך כלפי מטה כדי לרענן, או לסגור את האפליקציה ולפתוח שוב. באייפון משיכה למטה לא עובדת - צריך לסגור את האפליקציה לגמרי (להחליק מלמטה למעלה, לעצור באמצע, ולהחליק את הכרטיס של האפליקציה כלפי מעלה), ואז לפתוח שוב מהאייקון. אם גם אחרי זה היא עדיין נראית ישנה, אפשר להסיר אותה ממסך הבית ולהוסיף מחדש - אבל שימי לב שזה מאפס את הנתונים במכשיר, אז כדאי לעשות קודם גיבוי במסך הפרופיל." },
  { q: "איך אני יודעת כמה צעדים עשיתי?", a: "פותחים את אפליקציית הבריאות בטלפון, בודקים את מספר הצעדים של היום ומזינים אותו במסך הצעדים. עדיף למלא מאוחר ככל האפשר במהלך היום, ותמיד אפשר לעדכן.", guide: true },
  { q: "מה קורה לקלוריות שאני שורפת בפעילות גופנית?", a: "כל פעילות גופנית שתזיני מתווספת לתקציב הקלורי היומי שלך - כלומר מגדילה את הכמות שמותר לך לאכול באותו יום. הליכה לא מוזנת כפעילות כי היא נספרת אוטומטית דרך הצעדים." },
  { q: "למה אני לא ממלאת את החלבון בעצמי?", a: "טבעת החלבון מתעדכנת לבד מתוך המזון שאת מזינה ביומן, כך שתמיד רואות כמה חלבון אכלת מול היעד היומי - בלי צורך למלא ידנית." },
  { q: "כמה קלוריות מותר לי לאכול היום?", a: "היעד הקלורי היומי מחושב לפי הגיל, המשקל, הגובה ורמת הפעילות שלך, ומופיע בעיגול הקלוריות ('מתוך ...'). אפשר לראות אותו גם במסך הפרופיל." },
  { q: "שכחתי להזין יום שלם - מה עושים?", a: "אפשר לחזור לימים קודמים דרך סרגל הזמן שלמעלה, או בהחלקה ימינה ושמאלה על המסך, ולמלא בדיעבד." },
  { q: "איך עורכים או מוחקים פריט שהוספתי?", a: "בהקשה על הפריט ברשימת 'מה שהוזן היום' ביומן אפשר לערוך אותו או למחוק אותו." },
  { q: "מה זה המדליות והגביעים?", a: "על כל יום שבו תשלימי את כל המשימות מקבלים מדליה, ועל שבוע שלם - גביע. הכל נאסף בארון ההישגים." },
  { q: "למה משימות חדשות מופיעות לאורך התוכנית?", a: "המשימות נפתחות בהדרגה כדי לא להעמיס בבת אחת. כל כמה ימים מצטרפת משימה חדשה, צעד אחרי צעד." },
];

function FaqModal({ onClose, onStartTour }) {
  const [open, setOpen] = useState(-1);
  const topics = TIPS.filter((t) => t.key === "cal");
  const Item = ({ q, a, guide, i }) => (
    <div onClick={() => setOpen(open === i ? -1 : i)} style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 13px", marginBottom: 8, cursor: "pointer" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 15.5, fontWeight: 600, color: C.ink }}>{q}</span>
        <ChevronDown size={18} color={C.sub} style={{ flexShrink: 0, transform: open === i ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
      </div>
      {open === i && <div style={{ fontSize: 14.5, color: C.sub, lineHeight: 1.6, marginTop: 8 }} onClick={(e) => e.stopPropagation()}>{a}{guide && <StepGuideLink style={{ marginTop: 10 }} />}</div>}
    </div>
  );
  return (
    <SheetShell title="שאלות ותשובות" onClose={onClose}>
      <div style={{ maxHeight: "62vh", overflowY: "auto", margin: "0 -4px", padding: "0 4px" }}>
        <div style={{ fontSize: 14, color: C.sub, marginBottom: 10, lineHeight: 1.6 }}>כל מה שכדאי לדעת על השימוש באפליקציה, במקום אחד. הקישי על שאלה כדי לפתוח.</div>
        <div style={{ background: C.infoBg, borderRadius: 12, padding: "11px 13px", marginBottom: 12, fontSize: 13.5, color: C.ink, lineHeight: 1.55 }}>יש לך שאלה נוספת שלא מופיעה כאן? אפשר לשלוח אותה בקבוצה ולקבל מענה.</div>
        {onStartTour && <button onClick={onStartTour} style={{ width: "100%", boxSizing: "border-box", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: "none", borderRadius: 12, padding: "13px", marginBottom: 14, background: C.brand, color: "#fff", fontSize: 15.5, fontWeight: 700, fontFamily: fontStack, cursor: "pointer" }}><Sparkles size={17} /> סיור באפליקציה <span style={{ fontWeight: 400, fontSize: 13, opacity: 0.9 }}>(מעבר לשבוע ראשון, יום שלישי)</span></button>}
        {FAQ_ITEMS.map((f, i) => <Item key={`f${i}`} q={f.q} a={f.a} guide={f.guide} i={i} />)}
        <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, margin: "16px 0 8px" }}>מסכים באפליקציה</div>
        {topics.map((t, j) => <Item key={`t${j}`} q={t.title} a={t.text} i={100 + j} />)}
      </div>
    </SheetShell>
  );
}

function TutorialOverlay({ steps, idx, onNext, onChoice, onEnd, onBack }) {
  const [rect, setRect] = useState(null);
  const cur = steps[idx];
  useEffect(() => {
    let cancelled = false;
    setRect(null);
    if (!cur.sel) return;
    const el = document.querySelector(`[data-tut="${cur.sel}"]`);
    if (!el) return;
    try { el.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) {}
    const t = setTimeout(() => { if (!cancelled) { try { setRect(el.getBoundingClientRect()); } catch (e) {} } }, 380);
    return () => { cancelled = true; clearTimeout(t); };
  }, [idx, cur.sel]);
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const tap = !!cur.tap;
  const stop = (e) => e.stopPropagation();
  // Bubble position: nav-bar steps sit just above the bottom bar; element high -> below it; element low -> pinned to top.
  const isNav = cur.sel && (cur.sel.indexOf("nav-") === 0);
  const bubblePos = !rect ? { bottom: 28 } : (isNav ? { bottom: vh - rect.top + 12 } : (rect.top < vh * 0.5 ? { top: rect.bottom + 12 } : { top: 12 }));
  const pad = 8;
  const hT = rect ? Math.max(0, rect.top - pad) : 0, hB = rect ? rect.bottom + pad : 0, hL = rect ? Math.max(0, rect.left - pad) : 0, hR = rect ? rect.right + pad : 0;
  return (
    <>
      {tap && rect ? (
        // Tap steps: dim everything EXCEPT the highlighted element (4 strips), so only that element (and the bubble) are tappable.
        <>
          <div onClick={stop} style={{ position: "fixed", top: 0, left: 0, right: 0, height: hT, background: "rgba(0,0,0,0.6)", zIndex: 99996 }} />
          <div onClick={stop} style={{ position: "fixed", top: hB, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.6)", zIndex: 99996 }} />
          <div onClick={stop} style={{ position: "fixed", top: hT, left: 0, width: hL, height: hB - hT, background: "rgba(0,0,0,0.6)", zIndex: 99996 }} />
          <div onClick={stop} style={{ position: "fixed", top: hT, left: hR, right: 0, height: hB - hT, background: "rgba(0,0,0,0.6)", zIndex: 99996 }} />
          <div style={{ position: "fixed", top: hT, left: hL, width: hR - hL, height: hB - hT, borderRadius: 16, border: "2px solid #fff", zIndex: 99997, pointerEvents: "none" }} />
        </>
      ) : (
        <>
          {!tap && <div onClick={stop} style={{ position: "fixed", inset: 0, zIndex: 99996 }} />}
          {rect && <div style={{ position: "fixed", top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, borderRadius: 16, boxShadow: "0 0 0 9999px rgba(0,0,0,0.62)", border: "2px solid #fff", zIndex: 99997, pointerEvents: "none", transition: "all .2s" }} />}
          {!rect && !tap && <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.62)", zIndex: 99997 }} />}
        </>
      )}
      <div style={{ position: "fixed", left: 16, right: 16, ...bubblePos, zIndex: 99999, background: "#fff", borderRadius: 16, padding: 16, boxShadow: "0 10px 34px rgba(0,0,0,0.32)", direction: "rtl", textAlign: "right" }}>
        <div style={{ fontSize: 15.5, color: C.ink, lineHeight: 1.6, marginBottom: 12 }}>{cur.text}</div>
        {cur.guide && <StepGuideLink linkOnly style={{ marginBottom: 12 }} />}
        {cur.prompt && <div style={{ fontSize: 15.5, fontWeight: 700, color: C.brandD, marginBottom: 10 }}>{cur.prompt}</div>}
        {cur.choice ? (
          <>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => onChoice && onChoice(true)} style={{ flex: 1, border: "none", borderRadius: 10, padding: "11px", background: C.brand, color: "#fff", fontSize: 15, fontWeight: 700, fontFamily: fontStack, cursor: "pointer" }}>{cur.choice.yes}</button>
              <button onClick={() => onChoice && onChoice(false)} style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px", background: "transparent", color: C.sub, fontSize: 15, fontWeight: 700, fontFamily: fontStack, cursor: "pointer" }}>{cur.choice.no}</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
              {onEnd ? <button onClick={onEnd} style={{ border: "none", background: "transparent", color: C.faint, fontSize: 13, fontFamily: fontStack, cursor: "pointer", textDecoration: "underline", padding: 0 }}>סיים את הסיור</button> : <span />}
              {steps.length > 1 && <span style={{ fontSize: 12.5, color: C.faint }}>{idx + 1}/{steps.length}</span>}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12.5, color: C.faint }}>{steps.length > 1 ? `${idx + 1}/${steps.length}` : ""}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {idx > 0 && onBack && <button onClick={onBack} style={{ border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 16px", background: "transparent", color: C.sub, fontSize: 15, fontWeight: 700, fontFamily: fontStack, cursor: "pointer" }}>הקודם</button>}
                {!tap && <button onClick={onNext} style={{ border: "none", borderRadius: 10, padding: "9px 22px", background: C.brand, color: "#fff", fontSize: 15.5, fontWeight: 700, fontFamily: fontStack, cursor: "pointer" }}>{cur.btn || "המשך"}</button>}
              </div>
            </div>
            {onEnd && !cur.last && <div style={{ marginTop: 10, textAlign: "center" }}><button onClick={onEnd} style={{ border: "none", background: "transparent", color: C.faint, fontSize: 13, fontFamily: fontStack, cursor: "pointer", textDecoration: "underline", padding: 0 }}>סיים את הסיור</button></div>}
          </>
        )}
      </div>
    </>
  );
}

function RestoreScreen({ email, busy, onRestore, onSkip }) {
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const submit = async () => { setErr(""); const r = await onRestore(code); if (!r.ok) setErr(r.msg || "שגיאה."); };
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", fontFamily: fontStack }}>
      <div style={{ flex: 1, overflowY: "auto", padding: "26px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}><Lock size={22} color={C.brand} /><span style={{ fontSize: 24, fontWeight: 600, color: C.ink }}>מצאנו גיבוי מוצפן</span></div>
        <p style={{ fontSize: 16, color: C.sub, lineHeight: 1.65, marginTop: 0, marginBottom: 16 }}>קיים גיבוי מוצפן עבור <span style={{ direction: "ltr", unicodeBidi: "isolate" }}>{email}</span>. הזיני את קוד הגיבוי כדי לשחזר את כל הנתונים שלך למכשיר הזה.</p>
        <div style={{ fontSize: 14, color: C.ink, marginBottom: 6 }}>קוד גיבוי</div>
        <input value={code} onChange={(e) => { setCode(e.target.value); setErr(""); }} type="password" placeholder="הקוד שבחרת" style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${err ? C.amber : C.line}`, borderRadius: 10, padding: "12px", fontSize: 16, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none" }} />
        {err && <div style={{ fontSize: 14, color: C.amber, marginTop: 6 }}>{err}</div>}
      </div>
      <div style={{ padding: "10px 20px 18px", borderTop: `1px solid ${C.line}`, display: "flex", flexDirection: "column", gap: 8 }}>
        <Btn disabled={busy || !code.trim()} onClick={submit}>{busy ? "משחזר..." : "שחזרי את הנתונים"}</Btn>
        <Btn variant="ghost" onClick={onSkip} style={{ color: C.sub }}>התחלה מחדש (בלי שחזור)</Btn>
      </div>
    </div>
  );
}

function BackupModal({ backup, gateEmail, busy, onEnable, onBackupNow, onResetCode, onClose }) {
  const enabled = !!(backup && backup.enabled);
  const [mode, setMode] = useState(enabled ? "view" : "enable"); // view | enable | reset
  const [email, setEmail] = useState(((backup && backup.email) || gateEmail || "").trim());
  const [code, setCode] = useState("");
  const [code2, setCode2] = useState("");
  const [msg, setMsg] = useState(null);
  const run = async (fn) => { setMsg(null); const r = await fn(); setMsg({ ok: r.ok, text: r.msg }); return r; };
  const codeOk = code.trim().length >= 4 && code === code2;
  const inputS = { width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 12px", fontSize: 16, fontFamily: fontStack, color: C.ink, background: C.panel, outline: "none", marginBottom: 8 };
  return (
    <SheetShell title="גיבוי מוצפן" onClose={onClose}>
      <p style={{ fontSize: 14.5, color: C.sub, lineHeight: 1.65, marginTop: 0, marginBottom: 14 }}>הנתונים שלך נשמרים במכשיר. גיבוי מוצפן שומר עותק בענן שרק את יכולה לפתוח - אף אחד, גם לא מיי פריים, לא רואה את התוכן.</p>
      {enabled && mode === "view" && (
        <>
          <div style={{ background: C.brandBg, borderRadius: 12, padding: "12px 14px", marginBottom: 14, fontSize: 14.5, color: C.brandD, lineHeight: 1.6 }}>הגיבוי המוצפן מופעל ומגובה אוטומטית פעם ביום. משויך ל-<span style={{ direction: "ltr", unicodeBidi: "isolate" }}>{(backup && backup.email) || gateEmail}</span>.</div>
          <Btn disabled={busy} onClick={() => run(onBackupNow)}>{busy ? "מגבה..." : "גבה עכשיו"}</Btn>
          <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={() => { setMsg(null); setCode(""); setCode2(""); setMode("reset"); }} style={{ color: C.sub }}>איפוס קוד</Btn></div>
        </>
      )}
      {mode === "reset" && (
        <>
          <div style={{ fontSize: 14.5, color: C.ink, lineHeight: 1.6, marginBottom: 10 }}>בחרי קוד חדש. הנתונים שבמכשיר יגובו מחדש עם הקוד החדש.</div>
          <input value={code} onChange={(e) => setCode(e.target.value)} type="password" placeholder="קוד חדש" style={inputS} />
          <input value={code2} onChange={(e) => setCode2(e.target.value)} type="password" placeholder="הקלדת הקוד שוב" style={inputS} />
          <Btn disabled={busy || !codeOk} onClick={async () => { const r = await run(() => onResetCode(code)); if (r.ok) { setCode(""); setCode2(""); setMode("view"); } }}>{busy ? "מעדכן..." : "עדכון קוד"}</Btn>
          <div style={{ marginTop: 8 }}><Btn variant="ghost" onClick={() => { setMsg(null); setMode("view"); }} style={{ color: C.sub }}>ביטול</Btn></div>
        </>
      )}
      {!enabled && mode === "enable" && (
        <>
          <div style={{ fontSize: 14, color: C.ink, marginBottom: 6 }}>אימייל לגיבוי</div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="name@example.com" style={{ ...inputS, direction: "ltr", textAlign: "left" }} />
          <div style={{ fontSize: 14, color: C.ink, marginBottom: 6 }}>קוד גיבוי</div>
          <input value={code} onChange={(e) => setCode(e.target.value)} type="password" placeholder="קוד אישי שתזכרי" style={inputS} />
          <input value={code2} onChange={(e) => setCode2(e.target.value)} type="password" placeholder="הקלדת הקוד שוב" style={inputS} />
          <div style={{ fontSize: 13, color: C.amber, background: C.amberBg, padding: "10px 12px", borderRadius: 10, lineHeight: 1.55, marginBottom: 12, display: "flex", gap: 6 }}><Info size={14} style={{ flexShrink: 0, marginTop: 1 }} /><span>אי אפשר לשחזר את הקוד. אם תשכחי אותו, לא נוכל לפתוח את הגיבוי בטלפון חדש. רשמי אותו במקום בטוח.</span></div>
          <Btn disabled={busy || !codeOk} onClick={async () => { const r = await run(() => onEnable(email, code)); if (r.ok) { setCode(""); setCode2(""); setMode("view"); } }}>{busy ? "מפעיל..." : "הפעלת גיבוי מוצפן"}</Btn>
        </>
      )}
      {msg && <div style={{ fontSize: 14, color: msg.ok ? C.brandD : C.amber, marginTop: 10, textAlign: "center" }}>{msg.text}</div>}
    </SheetShell>
  );
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Subscribes the device to the daily 19:00 reminder. Requests permission (must be
// from a user gesture on iOS), then registers a push subscription and stores it server-side.
async function enableDailyReminder(email) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { ok: false, reason: "unsupported" };
  }
  let perm = Notification.permission;
  if (perm === "default") {
    try { perm = await Notification.requestPermission(); } catch (e) { return { ok: false, reason: "error" }; }
  }
  if (perm !== "granted") return { ok: false, reason: perm === "denied" ? "denied" : "dismissed" };
  try {
    const reg = await navigator.serviceWorker.ready;
    const r = await fetch("/api/subscribe");
    const j = await r.json();
    if (!j || !j.publicKey) return { ok: false, reason: "not_configured" };
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(j.publicKey) });
    }
    await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: email || "", subscription: sub }) });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "error" };
  }
}

async function disableDailyReminder() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch (e) {}
}

function ReminderRow({ email }) {
  const supported = typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const [status, setStatus] = useState("loading"); // on | off | denied | unsupported | loading
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!supported) { if (alive) setStatus("unsupported"); return; }
      if (Notification.permission === "denied") { if (alive) setStatus("denied"); return; }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (alive) setStatus(sub && Notification.permission === "granted" ? "on" : "off");
      } catch (e) { if (alive) setStatus("off"); }
    })();
    return () => { alive = false; };
  }, [supported]);
  const turnOn = async () => {
    setBusy(true);
    const r = await enableDailyReminder(email);
    setBusy(false);
    if (r.ok) setStatus("on");
    else if (r.reason === "denied") setStatus("denied");
    else if (r.reason === "unsupported") setStatus("unsupported");
  };
  const turnOff = async () => { setBusy(true); await disableDailyReminder(); setBusy(false); setStatus("off"); };
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 0", borderTop: `1px solid ${C.line}`, marginTop: 8, gap: 10 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 16, fontWeight: 600, color: C.ink }}><Clock size={18} color={C.brand} /> תזכורת יומית ב-19:00</span>
      {status === "on" && <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 14, color: C.brand, fontWeight: 600 }}>מופעלת</span><span onClick={busy ? undefined : turnOff} style={{ fontSize: 13.5, color: C.faint, cursor: "pointer", textDecoration: "underline" }}>כיבוי</span></span>}
      {status === "off" && <button onClick={busy ? undefined : turnOn} style={{ flexShrink: 0, border: "none", background: C.brand, color: "#fff", borderRadius: 10, padding: "8px 16px", fontSize: 14, fontWeight: 600, fontFamily: fontStack, cursor: "pointer", opacity: busy ? 0.6 : 1 }}>הפעלה</button>}
      {status === "denied" && <span style={{ fontSize: 12.5, color: C.faint, maxWidth: 180, textAlign: "end" }}>ההתראות חסומות. אפשר לאפשר אותן בהגדרות הדפדפן או המכשיר.</span>}
      {status === "unsupported" && <span style={{ fontSize: 12.5, color: C.faint, maxWidth: 180, textAlign: "end" }}>באייפון צריך קודם להוסיף את האפליקציה למסך הבית.</span>}
      {status === "loading" && <span style={{ fontSize: 13, color: C.faint }}>...</span>}
    </div>
  );
}

export default function App() {
  const DEFAULT_PROFILE = { age: 50, heightCm: 165, weightKg: 72, activity: "יושבני", weeklyRateG: 250, goalWeightKg: 66, returnPct: 50, startDate: sundayOf(TODAY), calorieOverride: null, stepGoal: null, stepBaseline: null, tipsSeen: [], keepShabbat: false, fasting: false, cupMl: DEFAULT_CUP_ML, diet: [], allergies: [], dislikes: "", name: "" };
  const saved = useMemo(() => { try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; } catch (e) { return null; } }, []);
  const [onboarded, setOnboarded] = useState(saved ? !!saved.onboarded : false);
  const [tab, setTab] = useState("day");
  const [profile, setProfile] = useState(saved?.profile || DEFAULT_PROFILE);
  const [log, setLog] = useState(saved?.log || (DEV ? INITIAL_LOG : []));
  const [weights, setWeights] = useState(saved?.weights || initWeights(DEFAULT_PROFILE.weightKg, DEFAULT_PROFILE.startDate));
  const [activityLog, setActivityLog] = useState(saved?.activityLog || []);
  const [waterByDate, setWaterByDate] = useState(saved?.waterByDate || {});
  const [stepsByDate, setStepsByDate] = useState(saved?.stepsByDate || {});
  const [checkins, setCheckins] = useState(saved?.checkins || {});
  const celebRef = useRef({ mounted: false, trophies: 0 });
  const [cheerTrophyWeek, setCheerTrophyWeek] = useState(1);
  const [goalAckWeek, setGoalAckWeek] = useState(saved?.goalAckWeek || 0);
  const [goalBump, setGoalBump] = useState(null);
  const [favorites, setFavorites] = useState(saved?.favorites || []);
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [today, setToday] = useState(TODAY);
  useEffect(() => {
    if (DEV) return; // dev "today" is simulated/fixed; the DevDateBar reloads to change it. Never clobber it with the real date.
    const id = setInterval(() => {
      const now = ymd(new Date());
      if (now !== today) { setToday(now); setSelectedDate((sd) => (sd === today ? now : sd)); }
    }, 60000);
    return () => clearInterval(id);
  }, [today]);
  const [modal, setModal] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [tour, setTour] = useState(null);
  const [showIntro, setShowIntro] = useState(saved ? false : true);
  const [notes, setNotes] = useState([]);
  const [bkRestore, setBkRestore] = useState("idle"); // idle | checking | offer | none
  const [bkBusy, setBkBusy] = useState(false);
  const [gate, setGate] = useState("checking");
  const [gateReason, setGateReason] = useState("");
  const [gateEmail, setGateEmail] = useState("");
  const [gateName, setGateName] = useState("");
  const [gateMsg, setGateMsg] = useState("");
  const [gateStartDate, setGateStartDate] = useState(() => { try { return localStorage.getItem("myprime_start_date") || ""; } catch (e) { return ""; } });
  const [gateAttempts, setGateAttempts] = useState(0);
  const [gateAgree, setGateAgree] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  useEffect(() => { const t = setTimeout(() => setShowSplash(false), 2000); return () => clearTimeout(t); }, []);

  // Android/Samsung hardware "back": intercept so the app doesn't close instantly.
  // Back first closes an open sheet/modal; otherwise it asks whether to leave.
  const [showExit, setShowExit] = useState(false);
  const modalRef = useRef(modal); modalRef.current = modal;
  const sheetRef = useRef(sheet); sheetRef.current = sheet;
  const exitRef = useRef(showExit); exitRef.current = showExit;
  const leavingRef = useRef(false);
  useEffect(() => {
    try { window.history.pushState({ mp: 1 }, ""); } catch (e) {}
    const onPop = () => {
      if (leavingRef.current) return;
      if (modalRef.current) setModal(null);
      else if (sheetRef.current) setSheet(null);
      else if (exitRef.current) setShowExit(false);
      else setShowExit(true);
      try { window.history.pushState({ mp: 1 }, ""); } catch (e) {}
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const confirmExit = () => { leavingRef.current = true; setShowExit(false); try { window.history.go(-2); } catch (e) {} };

  const checkAccess = async (em, nm) => {
    setGate("checking"); setGateMsg("");
    try {
      const r = await fetch(`${ACCESS_ENDPOINT}?email=${encodeURIComponent(em)}&device=${encodeURIComponent(getDeviceId())}`);
      const d = await r.json();
      if (d.allowed) {
        try { localStorage.setItem("myprime_access_email", em); if (nm) localStorage.setItem("myprime_access_name", nm); } catch (e) {}
        if (d.startDate) { setGateStartDate(d.startDate); try { localStorage.setItem("myprime_start_date", d.startDate); } catch (e) {} }
        setGateReason(""); setGate("ok");
      } else {
        const rsn = d.reason || "not_registered";
        if (rsn === "not_registered") setGateAttempts((n) => n + 1);
        setGateReason(rsn); setGate("denied");
      }
    } catch (e) { setGateMsg("תקלת תקשורת. נסי שוב."); setGate("form"); }
  };
  useEffect(() => {
    let em = "", nm = "";
    try { em = localStorage.getItem("myprime_access_email") || ""; nm = localStorage.getItem("myprime_access_name") || ""; } catch (e) {}
    if (nm) setGateName(nm);
    if (em) { setGateEmail(em); checkAccess(em, nm); } else { setGate("form"); }
  }, []);
  // Keep the program start date aligned with the registration sheet for returning users.
  useEffect(() => {
    if (DEV) return; // in DEV the start date is simulated for testing - never cap it to the sheet date
    if (gate !== "ok" || !onboarded || !gateStartDate) return;
    if (profile.startDate && profile.startDate <= gateStartDate) return;
    setProfile((p) => ({ ...p, startDate: gateStartDate }));
  }, [gate, onboarded, gateStartDate]);
  const submitGate = () => {
    const e = gateEmail.trim().toLowerCase(); const n = gateName.trim();
    if (!n) { setGateMsg("נא להזין שם פרטי."); return; }
    if (!e || !e.includes("@")) { setGateMsg("נא להזין כתובת מייל תקינה."); return; }
    if (!gateAgree) { setGateMsg("יש לאשר את מדיניות הפרטיות כדי להמשיך."); return; }
    checkAccess(e, n);
  };
  const retryGate = () => { try { localStorage.removeItem("myprime_access_email"); localStorage.removeItem("myprime_start_date"); } catch (e) {} setGateEmail(""); setGateMsg(""); setGateReason(""); setGateStartDate(""); setGate("form"); };

  const targets = useMemo(() => computeTargets(profile), [profile]);
  const dailyTarget = profile.calorieOverride || targets.targetKcal;
  const programWeek = programWeekFor(profile.startDate, TODAY);
  // ===== App tour controller (day-3 guided "סיור באפליקציה") =====
  const introLock = programWeekFor(profile.startDate, TODAY) === 1 && programDayNumber(profile.startDate, TODAY) <= 2;
  const tourView = sheet === "caloriemenu" ? "caloriemenu" : sheet === "steps" ? "steps" : (modal && modal.kind && modal.kind !== "recipe") ? "addfood" : "day";
  const markTourSeen = () => setProfile((p) => (p.tipsSeen || []).includes("appTour") ? p : { ...p, tipsSeen: [...(p.tipsSeen || []), "appTour"] });
  const startTour = () => setTour({ steps: buildTour(null), i: 0 });
  const tourChoice = (yes) => setTour({ steps: buildTour(yes ? "yes" : "no"), i: 1 });
  const tourAdvance = () => {
    if (!tour) return;
    const ni = tour.i + 1;
    if (ni >= tour.steps.length) { setTour(null); markTourSeen(); setSheet(null); setModal(null); } else setTour({ ...tour, i: ni });
  };
  const tourEnd = () => {
    const steps = (tour && tour.steps.length > 1) ? tour.steps : buildTour("no");
    setTour({ steps, i: steps.length - 1 });
  };
  const tourBack = () => { if (tour && tour.i > 0) setTour({ ...tour, i: tour.i - 1 }); };
  const tourEvent = (key) => {
    if (!tour) return;
    const cur = tour.steps[tour.i];
    if (!cur || !cur.tap || cur.event !== key) return;
    const ni = tour.i + 1;
    if (ni >= tour.steps.length) { setTour(null); markTourSeen(); } else setTour({ ...tour, i: ni });
  };
  // Demo-driven navigation: the tour opens each step's screen itself (so the user doesn't have to fill anything in).
  useEffect(() => {
    if (!tour) return;
    const cur = tour.steps[tour.i];
    if (!cur || !cur.open) return;
    if (cur.open === "caloriemenu") { if (modal) setModal(null); if (sheet !== "caloriemenu") setSheet("caloriemenu"); }
    else if (cur.open === "steps") { if (modal) setModal(null); if (sheet !== "steps") setSheet("steps"); }
    else if (cur.open === "addfood") { if (sheet) setSheet(null); if (!modal || modal.kind === "recipe") setModal({ kind: "food", preMeal: null, editEntry: null }); }
    else if (cur.open === "day") { if (sheet) setSheet(null); if (modal) setModal(null); }
  }, [tour]);
  useEffect(() => {
    if (gate !== "ok" || !onboarded || showIntro || tab !== "day" || tour) return;
    const pd = programDayNumber(profile.startDate, TODAY);
    const wk = programWeekFor(profile.startDate, TODAY);
    if (wk === 1 && pd >= 3 && !(profile.tipsSeen || []).includes("appTour")) {
      const t = setTimeout(() => setTour({ steps: buildTour(null), i: 0 }), 700);
      return () => clearTimeout(t);
    }
  }, [gate, onboarded, showIntro, tab, tour, profile.tipsSeen, profile.startDate]);
  // ===== Daily 19:00 reminder (web push) =====
  const [notifyPrompt, setNotifyPrompt] = useState(false);
  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  useEffect(() => {
    if (gate !== "ok" || !gateEmail) return;
    if ("Notification" in window && Notification.permission === "granted") enableDailyReminder(gateEmail).catch(() => {});
  }, [gate, gateEmail]);
  useEffect(() => {
    if (gate !== "ok" || !onboarded || showIntro || tour || tab !== "day") return;
    const supported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
    if (!supported || Notification.permission !== "default") return;
    if ((profile.tipsSeen || []).includes("notifyAsked")) return;
    const t = setTimeout(() => setNotifyPrompt(true), 1400);
    return () => clearTimeout(t);
  }, [gate, onboarded, showIntro, tour, tab, profile.tipsSeen]);
  const markNotifyAsked = () => setProfile((p) => (p.tipsSeen || []).includes("notifyAsked") ? p : { ...p, tipsSeen: [...(p.tipsSeen || []), "notifyAsked"] });
  const acceptNotify = async () => { setNotifyPrompt(false); markNotifyAsked(); await enableDailyReminder(gateEmail); };
  const dismissNotify = () => { setNotifyPrompt(false); markNotifyAsked(); };
  const waterOpenToday = unlockedOn(profile.startDate, selectedDate, WATER_UNLOCK);
  const stepsOpenToday = unlockedOn(profile.startDate, selectedDate, STEPS_UNLOCK);
  // Step goal: she sets the baseline once, then accepts increases via a prominent banner (never silent).
  const stepAction = pendingStepAction(profile, programWeek, goalAckWeek);
  const confirmBaseline = (val) => { setProfile((p) => ({ ...p, stepBaseline: val, stepGoal: val + stepGoalCumOffset(programWeek) })); setGoalAckWeek(highestBumpAtOrBelow(programWeek)); setSheet(null); };
  const confirmIncrease = (week, val) => { setProfile((p) => ({ ...p, stepGoal: val })); setGoalAckWeek(week); setSheet(null); };
  const recDayLog = log.filter((e) => e.date === selectedDate);
  const recRemainingKcal = (dailyTarget + activityLog.filter((a) => a.date === selectedDate).reduce((s, a) => s + (a.kcal || 0), 0)) - recDayLog.reduce((s, e) => s + (e.kcal || 0), 0);
  const recRemainingProtein = Math.max(0, targets.protein - recDayLog.reduce((s, e) => s + (e.p || 0), 0));
  const recMealsHad = recDayLog.map((e) => e.name).join(", ");

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ onboarded, profile, log, weights, activityLog, waterByDate, stepsByDate, favorites, checkins, goalAckWeek })); } catch (e) {}
  }, [onboarded, profile, log, weights, activityLog, waterByDate, stepsByDate, favorites, checkins, goalAckWeek]);

  // New device: if there is no local data yet but a cloud backup exists for this email, offer restore.
  useEffect(() => {
    if (gate !== "ok" || onboarded || saved) return;
    if (bkRestore !== "idle") return;
    const email = (gateEmail || "").trim().toLowerCase();
    if (!email || !bkSubtle) { setBkRestore("none"); return; }
    setBkRestore("checking");
    (async () => { const r = await bkFetch(email); setBkRestore(r && r.exists ? "offer" : "none"); })();
  }, [gate, onboarded, saved, gateEmail, bkRestore]);

  // Auto-backup: once a day, a few seconds after the first load/change of the day.
  useEffect(() => {
    if (gate !== "ok" || !onboarded) return;
    if (!(profile.backup && profile.backup.enabled)) return;
    const code = bkGetCode();
    const email = ((profile.backup && profile.backup.email) || gateEmail || "").trim().toLowerCase();
    if (!code || !email || !bkSubtle) return;
    let last = ""; try { last = localStorage.getItem(BK_LAST_KEY) || ""; } catch (e) {}
    if (last === today) return;
    const t = setTimeout(async () => {
      try {
        const plaintext = localStorage.getItem(STORAGE_KEY);
        if (!plaintext) return;
        const ok = await bkUpload(email, code, plaintext);
        if (ok) { try { localStorage.setItem(BK_LAST_KEY, today); } catch (e) {} }
      } catch (e) {}
    }, 4000);
    return () => clearTimeout(t);
  }, [gate, onboarded, profile, log, checkins, stepsByDate, waterByDate, weights, today]);

  const doRestore = async (code) => {
    const email = (gateEmail || "").trim().toLowerCase();
    if (!code.trim()) return { ok: false, msg: "יש להזין קוד." };
    setBkBusy(true);
    try {
      const r = await bkFetch(email);
      if (!r || !r.exists) { setBkBusy(false); return { ok: false, msg: "לא נמצא גיבוי לאימייל הזה." }; }
      const plaintext = await bkDecrypt(code, r.blob);
      JSON.parse(plaintext); // sanity
      localStorage.setItem(STORAGE_KEY, plaintext);
      bkSetCode(code);
      try { localStorage.setItem(BK_LAST_KEY, today); } catch (e) {}
      window.location.reload();
      return { ok: true };
    } catch (e) { setBkBusy(false); return { ok: false, msg: "קוד שגוי, נסי שוב." }; }
  };
  const backupNow = async () => {
    const code = bkGetCode();
    const email = ((profile.backup && profile.backup.email) || gateEmail || "").trim().toLowerCase();
    if (!code || !email || !bkSubtle) return { ok: false, msg: "הגיבוי אינו פעיל." };
    setBkBusy(true);
    try {
      const ok = await bkUpload(email, code, localStorage.getItem(STORAGE_KEY) || "");
      setBkBusy(false);
      if (ok) { try { localStorage.setItem(BK_LAST_KEY, today); } catch (e) {} return { ok: true, msg: "גובה בהצלחה." }; }
      return { ok: false, msg: "הגיבוי נכשל, נסי שוב." };
    } catch (e) { setBkBusy(false); return { ok: false, msg: "הגיבוי נכשל, נסי שוב." }; }
  };
  const enableBackup = async (email, code) => {
    const em = (email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return { ok: false, msg: "אימייל לא תקין." };
    if (code.trim().length < 4) return { ok: false, msg: "קוד קצר מדי." };
    if (!bkSubtle) return { ok: false, msg: "הדפדפן אינו תומך בהצפנה." };
    bkSetCode(code);
    setBkBusy(true);
    try {
      const ok = await bkUpload(em, code, localStorage.getItem(STORAGE_KEY) || "");
      setBkBusy(false);
      if (!ok) { bkSetCode(""); return { ok: false, msg: "ההפעלה נכשלה, נסי שוב." }; }
      setProfile((p) => ({ ...p, backup: { enabled: true, email: em } }));
      try { localStorage.setItem(BK_LAST_KEY, today); } catch (e) {}
      return { ok: true, msg: "הגיבוי המוצפן הופעל." };
    } catch (e) { setBkBusy(false); bkSetCode(""); return { ok: false, msg: "ההפעלה נכשלה, נסי שוב." }; }
  };
  const resetBackupCode = async (newCode) => {
    if (newCode.trim().length < 4) return { ok: false, msg: "קוד קצר מדי." };
    const email = ((profile.backup && profile.backup.email) || gateEmail || "").trim().toLowerCase();
    if (!email || !bkSubtle) return { ok: false, msg: "הגיבוי אינו פעיל." };
    setBkBusy(true);
    try {
      const ok = await bkUpload(email, newCode, localStorage.getItem(STORAGE_KEY) || "");
      setBkBusy(false);
      if (!ok) return { ok: false, msg: "האיפוס נכשל, נסי שוב." };
      bkSetCode(newCode);
      try { localStorage.setItem(BK_LAST_KEY, today); } catch (e) {}
      return { ok: true, msg: "הקוד עודכן והנתונים גובו מחדש." };
    } catch (e) { setBkBusy(false); return { ok: false, msg: "האיפוס נכשל, נסי שוב." }; }
  };

  const finishOnboarding = (p, bk) => {
    const backup = { enabled: !!(bk && bk.enabled), email: (bk && bk.email) || (gateEmail || "").trim().toLowerCase() };
    if (bk && bk.enabled && bk.code) { bkSetCode(bk.code); try { localStorage.removeItem(BK_LAST_KEY); } catch (e) {} }
    setProfile({ ...p, calorieOverride: null, name: gateName || p.name || "", backup });
    setWeights(initWeights(p.weightKg, p.startDate)); setOnboarded(true);
  };
  const openAdd = (kind, preMeal) => { setSheet(null); setModal({ kind, preMeal: preMeal || null, editEntry: null }); };
  const editEntry = (e) => setModal(e.unit === "serving" ? { kind: "recipe", recipe: null, editEntry: e } : { kind: "food", preMeal: null, editEntry: e });
  const deleteEntry = (id, type) => { if (type === "activity") setActivityLog((l) => l.filter((a) => a.id !== id)); else setLog((l) => l.filter((e) => e.id !== id)); };
  const commit = (payload) => {
    const date = modal?.editEntry ? modal.editEntry.date : selectedDate;
    if (modal?.editEntry) setLog((l) => l.map((e) => e.id === modal.editEntry.id ? { ...e, ...payload, date } : e));
    else {
      const items = Array.isArray(payload) ? payload : [payload];
      setLog((l) => [...l, ...items.map((p, i) => ({ id: "n" + Date.now() + i, date, ...p }))]);
      setFavorites((fs) => {
        let next = fs.slice();
        items.forEach((p) => {
          const name = (p.name || "").trim();
          const g = p.g;
          if (!name || !g) return;
          const per100 = { kcal: Math.round((p.kcal || 0) / g * 100), p: Math.round((p.p || 0) / g * 100), f: Math.round((p.f || 0) / g * 100), c: Math.round((p.c || 0) / g * 100) };
          const fav = { id: "fav_" + name, name, per100, measures: [{ label: "100 ג׳", g: 100 }, { label: "כף", g: 15 }, { label: "כפית", g: 5 }], def: 0, unit: p.unit || "g", lastG: g };
          next = next.filter((x) => x.name !== name);
          next.unshift(fav);
        });
        return next.slice(0, 20);
      });
    }
    setModal(null);
  };
  const addRecipe = (r) => setModal({ kind: "recipe", recipe: r, editEntry: null });
  const saveRecipe = (payload, editId) => {
    if (editId) setLog((l) => l.map((x) => x.id === editId ? { ...x, ...payload } : x));
    else setLog((l) => [...l, { id: "n" + Date.now(), date: selectedDate, ...payload }]);
    setModal(null);
  };
  const addActivity = (a) => { setActivityLog((l) => [...l, { id: "a" + Date.now(), date: selectedDate, name: a.name, kcal: Math.round(a.kcal) }]); setSheet(null); };
  const setWaterForDate = (date, n) => setWaterByDate((w) => ({ ...w, [date]: Math.max(0, n) }));
  const setStepsForDate = (date, n) => setStepsByDate((s) => ({ ...s, [date]: Math.max(0, Math.round(n || 0)) }));
  const setCheckinValue = (date, taskId, value) => setCheckins((c) => { const day = { ...(c[date] || {}) }; if (value === null || value === undefined || value === "") delete day[taskId]; else day[taskId] = value; return { ...c, [date]: day }; });
  useEffect(() => {
    const cupMl = profile.cupMl || DEFAULT_CUP_ML;
    const total = programDayNumber(profile.startDate, today);
    let changed = false, celebrate = false;
    const next = { ...checkins };
    for (let n = 1; n <= total; n++) {
      const d = addDays(profile.startDate, n - 1);
      if (dayComplete(profile.startDate, d, profile.keepShabbat, checkins, stepsByDate, waterByDate, log, targets, cupMl) && !(checkins[d] && checkins[d]._done)) {
        next[d] = { ...(next[d] || {}), _done: true }; changed = true; celebrate = true;
      }
    }
    if (changed) setCheckins(next);
    let tcount = 0, maxW = 0;
    for (let w = 1; w <= 10; w++) if (weekTrophyEarned(next, profile.startDate, w, today)) { tcount++; maxW = w; }
    if (!celebRef.current.mounted) { celebRef.current = { mounted: true, trophies: tcount }; return; }
    if (tcount > celebRef.current.trophies) { celebRef.current.trophies = tcount; setCheerTrophyWeek(maxW); setSheet("trophyCheer"); }
    else if (celebrate) setSheet("checkinCheer");
  }, [checkins, log, stepsByDate, waterByDate, targets, profile.startDate, profile.keepShabbat, today]);
  // Intermittent-fasting intro bubble: once, on the day screen, from week 8 day 4 (Wednesday) onward.
  useEffect(() => {
    if (!onboarded || showIntro || tab !== "day") return;
    if (sheet || modal || showExit) return;
    if (profile.fasting) return; // already opted in (e.g. via the profile toggle)
    if ((profile.tipsSeen || []).includes("fastingintro")) return;
    const wd = dowOf(today); // 0=Sat, 1=Sun .. 6=Fri
    const eligible = (programWeek === 8 && wd >= 4) || programWeek > 8;
    if (eligible) setSheet("fastingIntro");
  }, [programWeek, today, tab, sheet, modal, showExit, onboarded, showIntro, profile.fasting, profile.tipsSeen]);
  const addWaterGlass = () => { setWaterForDate(selectedDate, (waterByDate[selectedDate] || 0) + 1); setSheet(null); };
  const setWeightForDate = (date, kg) => { setWeights((w) => [...w.filter((x) => x.date !== date), { date, kg }].sort((a, b) => a.date < b.date ? -1 : 1)); setSheet(null); };
  const reportAddWeight = () => setSheet("weight");
  const setCalorieGoal = (kcal) => { setProfile((p) => ({ ...p, calorieOverride: kcal })); setSheet(null); };
  const devAnchorDay1 = () => {
    const sun = sundayOf(TODAY);
    try {
      const blob = { onboarded: true, profile: { ...profile, startDate: sun, tipsSeen: [], stepBaseline: null, stepGoal: null, calorieOverride: null }, log: [], weights: initWeights(profile.weightKg, sun), activityLog: [], waterByDate: {}, stepsByDate: {}, favorites, checkins: {}, goalAckWeek: 0 };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
      localStorage.setItem("myprime_dev_today", sun);
    } catch (e) {}
    window.location.reload();
  };
  const logoutDevice = async () => {
    const em = (gateEmail || (() => { try { return localStorage.getItem("myprime_access_email") || ""; } catch (e) { return ""; } })()).trim().toLowerCase();
    try { if (em) await fetch(`${ACCESS_ENDPOINT}?email=${encodeURIComponent(em)}&device=${encodeURIComponent(getDeviceId())}&logout=1`); } catch (e) {}
    try { localStorage.removeItem("myprime_access_email"); localStorage.removeItem("myprime_start_date"); } catch (e) {}
    setGate("form"); setGateEmail(""); setGateName(""); setGateReason(""); setGateMsg(""); setGateStartDate(""); setGateAttempts(0); setGateAgree(false); setSheet(null);
  };
  const resetDemo = () => {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    try { localStorage.removeItem("myprime_access_email"); } catch (e) {}
    try { localStorage.removeItem("myprime_start_date"); } catch (e) {}
    setGate("form"); setGateEmail(""); setGateName(""); setGateReason(""); setGateMsg(""); setGateStartDate(""); setGateAttempts(0);
    setOnboarded(false); setShowIntro(true); setTab("day"); setModal(null); setSheet(null);
    setLog([]); setWaterByDate({}); setStepsByDate({}); setActivityLog([]); setWeights(initWeights(DEFAULT_PROFILE.weightKg, DEFAULT_PROFILE.startDate)); setSelectedDate(TODAY);
    setCheckins({});
    setProfile(DEFAULT_PROFILE);
  };
  const onPickEntry = (id) => {
    if (id === "food") { openAdd("food", null); tourEvent("pickfood"); }
    else if (id === "ai") openAdd("ai", null);
    else if (id === "activity") setSheet("activity");
    else if (id === "recommend") setSheet("recommend");
    else if (id === "steps") setSheet("steps");
    else if (id === "water") addWaterGlass();
    else if (id === "weight") setSheet("weight");
    else if (id === "calorie") setSheet("calorie");
  };

  const sweetsOpen = unlockedOn(profile.startDate, TODAY, SWEETS_UNLOCK);
  const tabs = [
    { id: "day", ic: Home, label: "יומן" },
    { id: "report", ic: BarChart3, label: "דוח" },
    { id: "recipes", ic: ChefHat, label: "מתכונים" },
    { id: "profile", ic: User, label: "פרופיל" },
  ];

  return (
    <div dir="rtl" className="app-outer">
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
        ::-webkit-scrollbar{width:0;height:0}
        button{font-family:'Rubik',sans-serif}
        @keyframes spin{to{transform:rotate(360deg)}}
        .spin{animation:spin 1s linear infinite}
        @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(212,93,121,0.5)}50%{box-shadow:0 0 0 8px rgba(212,93,121,0)}}
        .spin-pulse{animation:pulse 1.2s ease-in-out infinite}
        @keyframes flameFlicker{0%,100%{transform:rotate(-6deg) scale(1)}50%{transform:rotate(6deg) scale(1.18)}}
        @keyframes fabFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}
        @keyframes fabGlow{0%,100%{box-shadow:0 8px 22px rgba(168,66,92,0.45),0 0 0 0 rgba(212,93,121,0.45)}50%{box-shadow:0 8px 22px rgba(168,66,92,0.45),0 0 0 12px rgba(212,93,121,0)}}
        .fab-center{animation:fabFloat 3.2s ease-in-out infinite, fabGlow 2.2s ease-in-out infinite}
        .streak-pill:active{transform:scale(0.96)}
        @keyframes cheerPop{0%{transform:scale(0.6);opacity:0}60%{transform:scale(1.06)}100%{transform:scale(1);opacity:1}}
        @keyframes medalIn{0%{transform:scale(0) rotate(-25deg);opacity:0}55%{transform:scale(1.2) rotate(8deg)}75%{transform:scale(0.95) rotate(-3deg)}100%{transform:scale(1) rotate(0);opacity:1}}
        @keyframes confettiFall{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(150px) rotate(360deg);opacity:0}}
        @keyframes splashFade{0%{opacity:0}12%{opacity:1}82%{opacity:1}100%{opacity:0}}
        .app-outer{min-height:100vh;min-height:100dvh;background:${C.bg};display:flex;justify-content:center;align-items:flex-start;padding:24px 12px;font-family:${fontStack}}
        .phone-frame{width:390px;max-width:100%;height:800px;background:${C.panel};border-radius:30px;box-shadow:0 12px 40px rgba(168,66,92,0.14);border:1px solid ${C.line};overflow:hidden;display:flex;flex-direction:column;position:relative}
        @media (max-width:440px){.app-outer{padding:0;align-items:stretch}.phone-frame{width:100%;height:100vh;height:100dvh;border-radius:0;box-shadow:none;border:none}}`}</style>
      <div className="phone-frame">
        {showSplash && <SplashScreen />}
        {DEV && <DevDateBar onAnchor={devAnchorDay1} />}
        {gate !== "ok" ? (
          <AccessGate status={gate} reason={gateReason} email={gateEmail} setEmail={setGateEmail} name={gateName} setName={setGateName} onSubmit={submitGate} onRetry={retryGate} msg={gateMsg} attempts={gateAttempts} agree={gateAgree} setAgree={setGateAgree} />
        ) : !onboarded ? (
          bkRestore === "offer" ? (
            <RestoreScreen email={gateEmail} busy={bkBusy} onRestore={doRestore} onSkip={() => setBkRestore("none")} />
          ) : bkRestore === "checking" ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.faint, fontFamily: fontStack }}>טוען...</div>
          ) : (
            <div style={{ flex: 1, overflow: "hidden" }}><Onboarding onFinish={finishOnboarding} name={gateName} email={gateEmail} fixedStart={gateStartDate} /></div>
          )
        ) : (
          <>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {tab === "day" && <DayScreen date={selectedDate} setDate={setSelectedDate} today={today} log={log} targets={targets} dailyTarget={dailyTarget} profile={profile} activityLog={activityLog} waterByDate={waterByDate} setWaterForDate={setWaterForDate} onWater={() => setSheet("water")} stepsByDate={stepsByDate} onEditSteps={() => { setSheet("steps"); tourEvent("opensteps"); }} editEntry={editEntry} deleteEntry={deleteEntry} onRecommend={() => setSheet("recommend")} onAddCalorie={() => { setSheet("caloriemenu"); tourEvent("addcalorie"); }} checkins={checkins} onOpenCheckin={() => setSheet("checkin")} onOpenCollection={() => setSheet("collection")} onOpenSummary={() => setSheet("weeklySummary")} stepAction={stepAction} onStepSetup={() => setSheet("stepSetup")} onStartTour={startTour} tipsSeen={profile.tipsSeen} onTipsSeen={(keys) => setProfile({ ...profile, tipsSeen: [...(profile.tipsSeen || []), ...keys] })} introLock={introLock} overlayOpen={!!(sheet || modal || showExit || showIntro)} />}
              {tab === "report" && <ReportScreen weights={weights} addWeight={reportAddWeight} log={log} targets={targets} programWeek={programWeek} stepsByDate={stepsByDate} startDate={profile.startDate} stepGoalStored={profile.stepGoal} stepsOpen={stepsOpenToday} today={today} onEditSteps={() => setSheet("steps")} />}
              {tab === "recipes" && <RecipesScreen addRecipe={addRecipe} sweetsOpen={sweetsOpen} />}
              {tab === "profile" && <ProfileScreen profile={profile} setProfile={setProfile} targets={targets} onReset={resetDemo} onLogout={logoutDevice} userName={profile.name || gateName} stepsByDate={stepsByDate} programWeek={programWeek} onOpenFaq={() => setSheet("faq")} onOpenBackup={() => setSheet("backup")} maxStart={DEV ? null : gateStartDate} gateEmail={gateEmail} />}
            </div>
            <div style={{ position: "relative", flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-around", borderTop: `1px solid ${C.line}`, padding: "9px 4px max(9px, env(safe-area-inset-bottom))", background: C.brandBg, boxShadow: "0 -2px 12px rgba(168,66,92,0.10)", opacity: introLock ? 0.4 : 1, pointerEvents: introLock ? "none" : "auto" }}>
              {tabs.slice(0, 2).map((t) => {
                const active = tab === t.id;
                return (<button key={t.id} data-tut={`nav-${t.id}`} onClick={() => setTab(t.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, border: "none", cursor: "pointer", padding: "5px 12px", borderRadius: 14, background: active ? C.brand : "transparent", color: active ? "#fff" : C.sub, fontWeight: active ? 600 : 400, boxShadow: active ? "0 2px 8px rgba(168,66,92,0.35)" : "none", transition: "background .15s, color .15s" }}><t.ic size={20} strokeWidth={active ? 2.6 : 2} /><span style={{ fontSize: 13 }}>{t.label}</span></button>);
              })}
              <button data-tut="nav-fab" onClick={() => setSheet("menu")} className="fab-center" aria-label="הוספה" style={{ flexShrink: 0, marginTop: -30, width: 60, height: 60, borderRadius: "50%", background: `linear-gradient(135deg, ${C.brand}, ${C.brandD})`, color: "#fff", border: "3px solid #fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 14 }}><Plus size={28} strokeWidth={2.6} /></button>
              {tabs.slice(2).map((t) => {
                const active = tab === t.id;
                return (<button key={t.id} data-tut={`nav-${t.id}`} onClick={() => setTab(t.id)} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 3, border: "none", cursor: "pointer", padding: "5px 12px", borderRadius: 14, background: active ? C.brand : "transparent", color: active ? "#fff" : C.sub, fontWeight: active ? 600 : 400, boxShadow: active ? "0 2px 8px rgba(168,66,92,0.35)" : "none", transition: "background .15s, color .15s" }}><t.ic size={20} strokeWidth={active ? 2.6 : 2} /><span style={{ fontSize: 13 }}>{t.label}</span></button>);
              })}
            </div>
            {introLock && <div style={{ position: "absolute", top: 2, right: 14, background: C.faint, color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "3px 12px", borderRadius: 999, zIndex: 20, fontFamily: fontStack }}>בקרוב</div>}
            </div>

            {sheet === "menu" && <EntryMenu onClose={() => setSheet(null)} onPick={onPickEntry} />}
            {sheet === "faq" && <FaqModal onClose={() => setSheet(null)} onStartTour={() => { setSelectedDate(addDays(profile.startDate, 2)); setTab("day"); setSheet(null); startTour(); }} />}
            {sheet === "backup" && <BackupModal backup={profile.backup} gateEmail={gateEmail} busy={bkBusy} onEnable={enableBackup} onBackupNow={backupNow} onResetCode={resetBackupCode} onClose={() => setSheet(null)} />}
            {sheet === "caloriemenu" && <EntryMenu mode="calorie" onClose={() => setSheet(null)} onPick={onPickEntry} />}
            {sheet === "steps" && <StepsModal current={stepsByDate[selectedDate] || 0} goal={effectiveStepGoal(profile.stepGoal, programWeek) || 0} weightKg={profile.weightKg} autoFocusInput={!tour} onClose={() => setSheet(null)} onAdd={(n) => { setStepsForDate(selectedDate, n); setSheet(null); tourEvent("addsteps"); }} />}
            {sheet === "water" && <WaterModal currentMl={waterMlOf(waterByDate[selectedDate])} cupMl={profile.cupMl || DEFAULT_CUP_ML} onSetMl={(ml) => setWaterForDate(selectedDate, ml)} onSetCup={(cup) => setProfile({ ...profile, cupMl: cup })} onClose={() => setSheet(null)} />}
            {sheet === "activity" && <ActivityModal onClose={() => setSheet(null)} onAdd={addActivity} weightKg={profile.weightKg} />}
            {sheet === "weight" && <WeightModal weights={weights} today={today} minDate={profile.startDate} heightCm={profile.heightCm} onClose={() => setSheet(null)} onAdd={(kg, date) => setWeightForDate(date, kg)} />}
            {sheet === "calorie" && <CalorieGoalModal current={dailyTarget} onClose={() => setSheet(null)} onAdd={setCalorieGoal} />}
            {sheet === "recommend" && <RecommendModal remainingKcal={recRemainingKcal} remainingProtein={recRemainingProtein} profile={profile} setProfile={setProfile} mealsHad={recMealsHad} proteinFocus={programWeek >= MACRO_UNLOCK.week} onLog={commit} onClose={() => setSheet(null)} />}
            {sheet === "stepSetup" && stepAction && <StepSetupModal action={stepAction} profile={profile} stepsByDate={stepsByDate} startDate={profile.startDate} programWeek={programWeek} onBaseline={confirmBaseline} onIncrease={confirmIncrease} onClose={() => setSheet(null)} />}
            {sheet === "checkin" && <CheckinModal tasks={tasksForDate(profile.startDate, selectedDate, profile.keepShabbat, profile.fasting)} answers={checkins[selectedDate] || {}} auto={autoStatusFor(selectedDate, stepsByDate, waterByDate, log, targets, profile.cupMl || DEFAULT_CUP_ML)} setValue={(id, v) => setCheckinValue(selectedDate, id, v)} onClose={() => setSheet(null)} date={selectedDate} startDate={profile.startDate} tipsSeen={profile.tipsSeen} onTipsSeen={(keys) => setProfile({ ...profile, tipsSeen: [...(profile.tipsSeen || []), ...keys] })} />}
            {sheet === "checkinCheer" && <CheckinCheer name={profile.name || gateName} onClose={() => setSheet(null)} />}
            {sheet === "trophyCheer" && <TrophyCheer week={cheerTrophyWeek} name={profile.name || gateName} onClose={() => setSheet(null)} />}
            {sheet === "fastingIntro" && <FastingIntroModal onOptIn={() => { setProfile((p) => ({ ...p, fasting: true, tipsSeen: [...(p.tipsSeen || []), "fastingintro"] })); setSheet(null); }} onDismiss={() => { setProfile((p) => ({ ...p, tipsSeen: [...(p.tipsSeen || []), "fastingintro"] })); setSheet(null); }} />}
            {sheet === "weeklySummary" && <WeeklySummaryModal date={selectedDate} startDate={profile.startDate} today={today} checkins={checkins} log={log} stepsByDate={stepsByDate} waterByDate={waterByDate} targets={targets} cupMl={profile.cupMl || DEFAULT_CUP_ML} keepShabbat={profile.keepShabbat} name={profile.name || gateName} dailyTarget={dailyTarget} stepGoal={profile.stepGoal} fasting={!!profile.fasting} onClose={() => setSheet(null)} />}
            {sheet === "collection" && <CollectionModal checkins={checkins} startDate={profile.startDate} today={today} onClose={() => setSheet(null)} />}
            {modal && (modal.kind === "recipe"
              ? <RecipeAddModal recipe={modal.recipe} editEntry={modal.editEntry} onSave={saveRecipe} onClose={() => setModal(null)} onDelete={() => { deleteEntry(modal.editEntry.id); setModal(null); }} />
              : <AddModal state={modal} close={() => setModal(null)} commit={commit} favorites={favorites} removeAndClose={() => { deleteEntry(modal.editEntry.id); setModal(null); }} onTourEvent={tourEvent} startDate={profile.startDate} />)}
            {tour && tour.steps[tour.i] && tour.steps[tour.i].view === tourView && <TutorialOverlay steps={tour.steps} idx={tour.i} onNext={tourAdvance} onChoice={tourChoice} onEnd={tourEnd} onBack={tourBack} />}
          </>
        )}
        {gate === "ok" && !showIntro && <NotesFab notes={notes} setNotes={setNotes} userName={profile.name || gateName} screen={onboarded ? (tabs.find((t) => t.id === tab)?.label || "") : "אונבורדינג"} />}
        {gate === "ok" && showIntro && <IntroOverlay name={profile.name || gateName} onClose={() => setShowIntro(false)} />}
        {gate === "ok" && notifyPrompt && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 55 }}>
            <div style={{ background: C.panel, borderRadius: 18, padding: "22px 20px", width: "100%", maxWidth: 340, textAlign: "center", fontFamily: fontStack }}>
              <div style={{ fontSize: 34, marginBottom: 6 }}>🔔</div>
              <div style={{ fontSize: 19, fontWeight: 700, color: C.ink, marginBottom: 8 }}>שנזכיר לך כל ערב?</div>
              <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, margin: "0 0 18px" }}>נשמח לשלוח לך תזכורת קטנה כל יום ב-19:00 למלא את דוח המעקב היומי. אפשר למלא אותו בכל שעה, ולכבות בכל רגע בפרופיל.</p>
              {/iphone|ipad|ipod/i.test(navigator.userAgent || "") && <p style={{ fontSize: 13, color: C.faint, lineHeight: 1.5, margin: "0 0 14px" }}>כשיופיע חלון של הטלפון - בחרי "אישור".</p>}
              <Btn onClick={acceptNotify}>כן, הזכירו לי</Btn>
              <Btn variant="ghost" onClick={dismissNotify} style={{ marginTop: 8 }}>לא עכשיו</Btn>
            </div>
          </div>
        )}
        {showExit && (
          <div onClick={() => setShowExit(false)} style={{ position: "absolute", inset: 0, background: "rgba(58,43,48,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, zIndex: 50 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: C.panel, borderRadius: 18, padding: "22px 20px", width: "100%", maxWidth: 320, textAlign: "center", fontFamily: fontStack }}>
              <div style={{ fontSize: 20, fontWeight: 600, color: C.ink, marginBottom: 6 }}>לצאת מ-MyPrime?</div>
              <p style={{ fontSize: 15, color: C.sub, lineHeight: 1.6, margin: "0 0 18px" }}>אפשר להישאר ולהמשיך בדיוק מאיפה שעצרת.</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <Btn onClick={() => setShowExit(false)}>להישאר</Btn>
                <Btn variant="ghost" onClick={confirmExit}>לצאת</Btn>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
