import React, { useState, useRef, useEffect } from "react";
import { X } from "lucide-react";
import { MINUTES, phaseAt, swapCycleFor } from "./breathPlan";

// תרגול הנשימה של משימת "מיינדפולנס - נשימה מודעת", שבוע 4 יום 4.
//
// **שום דבר כאן לא הומצא.** המחזור, הזמנים, וההיפוך באמצע הם בדיוק מה שענת כתבה
// בדף המשימה שלה (`public/pdf/W04D04-task-2.jpg`): שאיפה בספירה של 4, החזקה של 2,
// נשיפה של 6, **ואחרי מחצית הזמן אותם מספרים בסדר הפוך**, כלומר ההחזקה עוברת לסוף
// כשהריאות ריקות. גם טווח הזמן, 5 עד 10 דקות, הוא שלה.
//
// הקובץ נטען בטעינה מושהית ואינו נכנס לקובץ הראשי, ולכן מי שלא נוגעת בתרגול לא
// מורידה ממנו דבר. אין בו קריאות רשת, אין ספריות חדשות, ואין מפתח חדש באחסון.


// ענת כתבה "עצמי עיניים", ועיגול דורש מסך פתוח. הצליל הוא מה שמיישב את זה: היא
// רואה מחזור או שניים, תופסת את הקצב, ואז ממשיכה לפי האוזן. ויש מתג לכבות אותו.
function useTone(on) {
  const ctx = useRef(null);
  return (freq) => {
    if (!on) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!ctx.current) ctx.current = new AC();
      const c = ctx.current;
      if (c.state === "suspended") c.resume();
      const o = c.createOscillator(), g = c.createGain();
      o.type = "sine"; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.09, c.currentTime + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 0.45);
      o.connect(g); g.connect(c.destination);
      o.start(); o.stop(c.currentTime + 0.5);
    } catch (e) {}
  };
}

export default function BreathCircle({ C, font, onClose, onDone }) {
  const [step, setStep] = useState("setup");      // setup | run | done
  const [mins, setMins] = useState(5);
  const [sound, setSound] = useState(true);
  const [t, setT] = useState(0);                  // שניות מתחילת התרגול
  const startRef = useRef(0);
  const rafRef = useRef(null);
  const lastPhase = useRef("");
  const beep = useTone(sound);

  const total = mins * 60;
  const swapCycle = swapCycleFor(total);

  useEffect(() => {
    if (step !== "run") return;
    startRef.current = Date.now();
    const tick = () => {
      const e = (Date.now() - startRef.current) / 1000;
      if (e >= total) { setT(total); setStep("done"); return; }
      setT(e);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [step, total]);

  const { cycle, x, swapped, phase, left, scale } = phaseAt(t, swapCycle);

  useEffect(() => {
    if (step !== "run" || phase === lastPhase.current) return;
    lastPhase.current = phase;
    beep(phase === "in" ? 528 : phase === "out" ? 396 : 440);
  }, [phase, step]);

  const WORD = { in: "שאפי", hold: "החזיקי", out: "שחררי", empty: "החזיקי" };
  const remain = Math.max(0, Math.ceil(total - t));
  const mmss = `${Math.floor(remain / 60)}:${String(remain % 60).padStart(2, "0")}`;
  // השורה עולה לשתי שניות בדיוק בגבול שבו הסדר מתהפך, כדי שההיפוך לא יפתיע אותה
  const notice = swapped && cycle === swapCycle && x < 2;

  const wrap = { position: "absolute", inset: 0, zIndex: 48, background: C.bg, display: "flex",
    flexDirection: "column", fontFamily: font, direction: "rtl", color: C.ink };
  const head = { display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "max(14px, env(safe-area-inset-top, 0px) + 14px) 16px 10px", flexShrink: 0 };
  const body = { flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", padding: "0 24px", textAlign: "center" };
  const btn = { border: "none", borderRadius: 14, padding: "15px 34px", background: C.brand,
    color: "#fff", fontFamily: font, fontSize: 18, fontWeight: 700, cursor: "pointer" };
  const chip = (on) => ({ border: `1.5px solid ${on ? C.brand : C.line}`, background: on ? C.brand : C.panel,
    color: on ? "#fff" : C.ink, borderRadius: 999, padding: "9px 17px", fontFamily: font,
    fontSize: 15, fontWeight: 700, cursor: "pointer" });

  if (step === "setup") {
    return (
      <div style={wrap}>
        <div style={head}><span /><button onClick={onClose} aria-label="סגירה" style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", padding: 4 }}><X size={24} /></button></div>
        <div style={body}>
          <div style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>תרגול נשימה</div>
          <div style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 8 }}>שבי בנוחות, על כיסא או במיטה, והתמקדי בנשימה דרך האף בלבד.</div>
          <div style={{ fontSize: 17, lineHeight: 1.7, marginBottom: 26 }}>העיגול ינשום איתך. אפשר לעצום עיניים ולהמשיך לפי הצליל.</div>
          <div style={{ display: "flex", gap: 9, marginBottom: 22 }}>
            {MINUTES.map((m) => (
              <button key={m} onClick={() => setMins(m)} style={chip(mins === m)}>{m} דקות</button>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 15.5, color: C.sub, cursor: "pointer", marginBottom: 26 }}>
            <input type="checkbox" checked={sound} onChange={(e) => setSound(e.target.checked)} style={{ width: 18, height: 18, accentColor: C.brand }} />
            <span>צליל רך בכל מעבר</span>
          </label>
          <button onClick={() => { lastPhase.current = ""; setT(0); setStep("run"); }} style={btn}>התחלה</button>
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div style={wrap}>
        <div style={head}><span /><button onClick={onClose} aria-label="סגירה" style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", padding: 4 }}><X size={24} /></button></div>
        <div style={body}>
          <div style={{ fontSize: 23, fontWeight: 700, lineHeight: 1.5, marginBottom: 10 }}>סיימת {mins} דקות של נשימה.</div>
          <div style={{ fontSize: 16.5, color: C.sub, lineHeight: 1.65, marginBottom: 28 }}>אפשר לחזור לכאן בכל פעם שמתאים לך.</div>
          <button onClick={() => { if (onDone) onDone(); onClose(); }} style={btn}>סימון המשימה כבוצעה</button>
          <button onClick={onClose} style={{ ...btn, background: "transparent", color: C.brandD, border: `1.5px solid ${C.line}`, fontSize: 15.5, padding: "12px 26px", marginTop: 12 }}>סגירה</button>
        </div>
      </div>
    );
  }

  return (
    <div style={wrap} onClick={() => setStep("done")} role="button" aria-label="עצירת התרגול">
      <div style={head}>
        <span style={{ fontSize: 15.5, color: C.sub, fontVariantNumeric: "tabular-nums" }}>נשאר {mmss}</span>
        <button onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="סגירה" style={{ border: "none", background: "transparent", color: C.faint, cursor: "pointer", padding: 4 }}><X size={24} /></button>
      </div>
      <div style={body}>
        <div style={{ position: "relative", width: 250, height: 250, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ position: "absolute", width: 250, height: 250, borderRadius: "50%", border: `1.5px solid ${C.line}` }} />
          <div style={{ position: "absolute", width: 250, height: 250, borderRadius: "50%",
            background: `radial-gradient(circle, ${C.brand} 0%, ${C.brandD} 100%)`, opacity: 0.93,
            transform: `scale(${scale.toFixed(3)})` }} />
          <div style={{ position: "relative", color: "#fff", lineHeight: 1.15 }}>
            <div style={{ fontSize: 23, fontWeight: 700 }}>{WORD[phase]}</div>
            <div style={{ fontSize: 46, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{Math.ceil(left)}</div>
          </div>
        </div>
        <div style={{ height: 30, marginTop: 24, fontSize: 16.5, fontWeight: 700, color: C.brandD }}>
          {notice ? "עכשיו מחליפות את הסדר" : ""}
        </div>
        <div style={{ fontSize: 14, color: C.faint, marginTop: 2 }}>הקישי בכל מקום כדי לעצור</div>
      </div>
    </div>
  );
}
