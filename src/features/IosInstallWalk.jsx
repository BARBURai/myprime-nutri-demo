// הדרכת ההתקנה לאייפון, כאנימציה בתוך המסך ולא כסרטון מבאני.
//
// הסיבה היחידה שזה לא סרטון: בשלב 2 יש שתי צורות לסרגל של ספארי, ואצל כל אישה רק אחת
// מהן קיימת. סרטון מראה את שתיהן ברצף, ומי שיש לה אחת מתחילה לחפש את השנייה. רון:
// "מי שעשתה ויש לה את שלב אחד היא מתחילה לחפש את האופציה השניה לא מבינה מה קורה".
// כאן האנימציה עוצרת בשלב 2, היא מקישה על הסרגל שהיא רואה, וממשיך רק המסלול שלה.
//
// הקצב בכל צילום, לאט ובכוונה: קודם המסך כמו שהיא רואה אותו, אחר כך כל השאר מתעמעם
// וחץ מצביע על המקום, ורק אז התקרבות, סימון, ואצבע שמקישה.
//
// הכיתובים מועתקים מילה במילה מההנחיות הכתובות שמעל (InstallGate ו-IosBarOptions
// ב-src/App.jsx). שלוש המחרוזות של הבחירה ושל "לצפות שוב" אושרו על ידי רון.
import { useEffect, useRef, useState } from "react";

const DIR = "/guides/ios-walk/";
const PH = { w: 1170, h: 2532 };
const S2 = "גללי לתחתית המסך, לסרגל של ספארי. מה שאת רואה שם קובע:";
const B2 = "ואם את רואה רק שלוש נקודות, הקישי עליהן ואז בחרי \"שיתוף\" (Share).";
const S5 = "הקישי \"הוספה\" (Add) - והאייקון יופיע במסך הבית.";

// tap הוא מיקום הכפתור בפיקסלים של הצילום המקורי. box הוא שורה בתפריט, שמסומנת
// במסגרת מעוגלת סביב כל המילים. ring:false כשהעיגול כבר צרוב בצילום, noTap כשמסמנים
// בלי להקיש. safari-share הוא הצילום של ספארי עם תמונת הסרגל הפרוש מודבקת בתחתיתו,
// כי אין לנו צילום מלא של הצורה הזאת.
const SHOTS = {
  s1: { num: 1, big: "ודאי שאת בדפדפן Safari.", src: "safari-dots.jpg", ...PH, tap: [585, 2355], box: [560, 110], zoom: 1.6, noTap: true, dur: 6 },
  share: { num: 2, small: S2, big: "אם את רואה את הסרגל הזה, הקישי על הכפתור המסומן.", src: "safari-share.jpg", ...PH, tap: [584, 2441], r: 70, zoom: 2.0, ring: false, dur: 8.6 },
  dots: { num: 2, small: S2, big: B2, src: "safari-dots.jpg", ...PH, tap: [174, 2355], r: 75, zoom: 2.0, dur: 8.6 },
  dotsMenu: { num: 2, small: S2, big: B2, src: "dots-menu.jpg", ...PH, tap: [495, 1572], box: [560, 120], zoom: 1.7, dur: 8.2 },
  sheet: { num: 3, big: "הקישי על החץ שבפינה השמאלית התחתונה, \"הצגת עוד\", כדי לפתוח את כל הרשימה.", src: "share-sheet.jpg", ...PH, tap: [201, 2256], r: 110, zoom: 1.9, dur: 8.6 },
  more: { num: 4, big: "בחרי \"הוספה למסך הבית\" (Add to Home Screen).", src: "share-more.jpg", ...PH, tap: [818, 1827], box: [560, 120], zoom: 1.7, dur: 8.6 },
  add: { num: 5, big: S5, src: "add-screen.jpg", ...PH, tap: [168, 285], r: 100, zoom: 1.9, dur: 8.6 },
  home: { num: 5, big: S5, src: "home.jpg", ...PH, tap: [990, 1200], r: 150, zoom: 1.6, noTap: true, dur: 6.5 },
};
const KEYS = Object.keys(SHOTS);
const TAIL = ["sheet", "more", "add", "home"];
const PATHS = { share: ["share", ...TAIL], dots: ["dots", "dotsMenu", ...TAIL] };

// גובה האזור נבחר כך שכל הבלוק, כרטיס וצילום, נכנס במסך אחד של אייפון בלי לגלול. רון:
// "נחתך לי או החלק העליון או החלק התחתון". ב-1440 הבלוק היה כ-760 פיקסלים.
const BOX = { w: 1000, h: 1080 };
// מאיץ לבדיקות בדפדפן בלבד, כדי שתרחיש לא יחכה דקה שלמה. אצל אישה אמיתית הוא תמיד 1.
const SPEED = (() => { try { return Number(localStorage.getItem("mp_walk_speed")) || 1; } catch { return 1; } })();
const XF = 0.8;
const T = { spot: [1.2, 2.0], arrow: [1.6, 4.6], zoom: [2.4, 4.8], ring: [4.8, 5.5], finger: [5.6, 6.5], press: 6.8 };
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const seg = (t, a, b) => ease((t - a) / (b - a));

KEYS.forEach((k) => {
  const s = SHOTS[k];
  s.f = Math.min(BOX.w / s.w, BOX.h / s.h);
  s.ox = (BOX.w - s.w * s.f) / 2; s.oy = (BOX.h - s.h * s.f) / 2;
});

function cam(s, lt) {
  const k = seg(lt, ...T.zoom);
  // בסוף ההתקרבות התמונה תמיד ממלאת את רוחב המסגרת, אחרת נשאר פס ריק בצד. במסגרת
  // הנמוכה צילום מסך שלם צר ממנה, ולכן ההתקרבות לעולם אינה קטנה מהיחס הזה.
  const zEnd = Math.max(s.zoom || 1, BOX.w / (s.w * s.f));
  const z = 1 + (zEnd - 1) * k;
  const L = [s.tap[0] * s.f, s.tap[1] * s.f];
  const P = [s.ox + L[0], s.oy + L[1]];
  const C = [BOX.w / 2, BOX.h * 0.45];
  const D = [P[0] + (C[0] - P[0]) * k, P[1] + (C[1] - P[1]) * k];
  // התמונה נשארת צמודה לשולי המסגרת. הטווח המותר משתנה ברציפות עם הגודל, ולכן אין
  // קפיצה ברגע שהתמונה נעשית רחבה מהמסגרת. זו הייתה הקפיצה שרון ראה בטיוטה 3.
  const Tt = [D[0] - L[0] * z, D[1] - L[1] * z], W = s.w * s.f * z, H = s.h * s.f * z;
  const lim = (v, size, full) => Math.min(Math.max(0, full - size), Math.max(Math.min(0, full - size), v));
  Tt[0] = lim(Tt[0], W, BOX.w); Tt[1] = lim(Tt[1], H, BOX.h);
  return { z, T: Tt, P: [L[0] * z + Tt[0], L[1] * z + Tt[1]] };
}
function hole(s, c) {
  if (s.box) { const w = s.box[0] * s.f * c.z + 36, h = s.box[1] * s.f * c.z + 28; return { w, h, r: h / 2 }; }
  const d = 2 * ((s.r || 60) * s.f * c.z + 18); return { w: d, h: d, r: d / 2 };
}
const rrPath = (x, y, w, h, r) =>
  `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;

const PINK = "#D45D79", PINK_D = "#A8425C", INK = "#3A2B30", RED = "#E01E26";

export default function IosInstallWalk({ font }) {
  // play1: שלב 1 · choice: עצירה ושאלה · play2: המסלול שבחרה · end: לצפות שוב
  const [phase, setPhase] = useState("play1");
  const [path, setPath] = useState(null);
  const [scale, setScale] = useState(0.32);
  const wrap = useRef(null), layers = useRef({}), ov = useRef({}), cap = useRef({});
  const clock = useRef({ t: 0, last: null, visible: false });

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const fit = () => setScale(el.clientWidth / BOX.w);
    fit();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(el);
    // היא מגיעה לכאן בגלילה, ולכן האנימציה מתחילה רק כשהיא על המסך ונעצרת כשהיא
    // יוצאת ממנו. אחרת היא הייתה רצה ונגמרת לפני שהיא בכלל רואה אותה.
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver(([e]) => { clock.current.visible = e.isIntersecting; clock.current.last = null; }, { threshold: 0.45 })
      : null;
    if (io) io.observe(el); else clock.current.visible = true;
    return () => { if (ro) ro.disconnect(); if (io) io.disconnect(); };
  }, []);

  useEffect(() => {
    if (phase !== "play1" && phase !== "play2") return;
    const seq = phase === "play1" ? ["s1"] : PATHS[path];
    const total = seq.reduce((a, k) => a + SHOTS[k].dur, 0);
    clock.current.t = 0; clock.current.last = null;
    let raf = 0, done = false;
    const tick = (now) => {
      const c = clock.current;
      if (c.visible && c.last != null) c.t += Math.min(0.1, (now - c.last) / 1000) * SPEED;
      c.last = c.visible ? now : null;
      draw(seq, Math.min(c.t, total - 0.001), phase === "play1");
      if (c.t >= total && !done) { done = true; setPhase(phase === "play1" ? "choice" : "end"); return; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase, path]);

  function setCaption(s, a, extra) {
    const c = cap.current;
    c.num.textContent = s.num;
    c.small.textContent = s.small || ""; c.small.style.display = s.small ? "" : "none";
    c.big.textContent = s.big;
    c.extra.textContent = extra || ""; c.extra.style.display = extra ? "" : "none";
    c.card.style.opacity = a;
    c.dots.forEach((d, i) => { if (d) d.style.background = i < s.num ? PINK : "#F1E4E7"; });
  }

  function draw(seq, t, first) {
    let i = 0, t0 = 0;
    while (i < seq.length - 1 && t >= t0 + SHOTS[seq[i]].dur) { t0 += SHOTS[seq[i]].dur; i++; }
    const key = seq[i], s = SHOTS[key], lt = t - t0;
    const prev = seq[i - 1] && SHOTS[seq[i - 1]], next = seq[i + 1] && SHOTS[seq[i + 1]];
    const last = !next;
    const capKey = (x) => x && x.num + "|" + x.small + "|" + x.big;
    const capIn = capKey(prev) === capKey(s) ? 1 : seg(lt, 0, 0.5);
    setCaption(s, capIn);
    KEYS.forEach((k) => { const el = layers.current[k]; if (el) el.style.opacity = 0; });
    const c = cam(s, lt);
    const L = layers.current[key];
    // בסוף שלב 1 ובסוף המסלול התמונה נשארת על המסך. שלב 1 נעצר לשאלה, והסוף מחכה
    // ל"לצפות שוב", ולכן אין שם דהייה לרקע ריק.
    L.style.opacity = prev ? seg(lt, 0, XF) : first ? seg(lt, 0, 0.5) : 1;
    L.style.transform = `translate(${c.T[0]}px,${c.T[1]}px) scale(${c.z})`;
    if (prev && lt < XF) {
      const pk = seq[i - 1], pc = cam(prev, prev.dur), PL = layers.current[pk];
      PL.style.opacity = 1 - seg(lt, 0, XF); PL.style.transform = `translate(${pc.T[0]}px,${pc.T[1]}px) scale(${pc.z})`;
    }
    const o = ov.current;
    ["ring", "pill", "ripple", "finger", "arrow", "dim"].forEach((id) => { o[id].style.opacity = 0; });
    const fade = last ? 1 : 1 - seg(lt, s.dur - 0.35, s.dur);
    const H = hole(s, c), x = c.P[0] - H.w / 2, y = c.P[1] - H.h / 2;
    o.dim.setAttribute("d", `M0 0H${BOX.w}V${BOX.h}H0Z ${rrPath(x - 10, y - 10, H.w + 20, H.h + 20, H.r + 10)}`);
    o.dim.style.opacity = 0.55 * seg(lt, ...T.spot) * fade;
    // חץ מקפץ שמצביע על המקום, מעליו, ואם אין מקום מעליו אז מתחתיו. הצד נקבע לפי
    // המיקום הסופי, כדי שהחץ לא יתהפך באמצע ההתקרבות.
    const cf = cam(s, s.dur), Hf = hole(s, cf), up = cf.P[1] - Hf.h / 2 < 260;
    const aIn = seg(lt, T.arrow[0], T.arrow[0] + 0.4) * (1 - seg(lt, T.arrow[1] - 0.4, T.arrow[1]));
    const bounce = Math.sin((lt - T.arrow[0]) * 6) * 16;
    const ay = up ? y + H.h + 24 + bounce : y - 24 - bounce;
    o.arrow.setAttribute("transform", `translate(${c.P[0]},${ay}) rotate(${up ? 180 : 0})`);
    o.arrow.style.opacity = aIn;
    const p = seg(lt, ...T.ring);
    if (s.ring !== false) {
      if (s.box) {
        const per = 2 * (H.w + H.h);
        Object.entries({ x, y, width: H.w, height: H.h, rx: H.r, "stroke-dasharray": per, "stroke-dashoffset": per * (1 - p) }).forEach(([a, v]) => o.pill.setAttribute(a, v));
        o.pill.style.opacity = p > 0 ? fade : 0;
      } else {
        const r = H.w / 2, circ = 2 * Math.PI * r;
        Object.entries({ cx: c.P[0], cy: c.P[1], r, "stroke-dasharray": circ, "stroke-dashoffset": circ * (1 - p), transform: `rotate(-90 ${c.P[0]} ${c.P[1]})` }).forEach(([a, v]) => o.ring.setAttribute(a, v));
        o.ring.style.opacity = p > 0 ? fade : 0;
      }
    }
    if (s.noTap) return;
    // האצבע נוגעת בשפה של הסימון ולא באמצעו, כדי שלא תסתיר את המילה. כפתור בתחתית
    // המסגרת: היא מגיעה מלמעלה, אחרת הייתה נחתכת מתחת לשוליים.
    const m = seg(lt, ...T.finger), press = lt > T.press && lt < T.press + 0.3 ? 0.9 : 1, rr = H.h / 2;
    const flip = c.P[1] > BOX.h - 340, sy = flip ? -1 : 1;
    const fx = c.P[0] + rr * 0.45 + (1 - m) * 420, fy = c.P[1] + sy * (rr * 0.8 + (1 - m) * 620);
    o.finger.setAttribute("transform", `translate(${fx},${fy}) rotate(${flip ? 180 : 0}) scale(${press})`);
    o.finger.style.opacity = m > 0 ? fade : 0;
    const rp = (lt - T.press - 0.05) / 0.7;
    if (rp > 0 && rp < 1) { Object.entries({ cx: c.P[0], cy: c.P[1], r: 30 + rp * 120 }).forEach(([a, v]) => o.ripple.setAttribute(a, v)); o.ripple.style.opacity = (1 - rp) * 0.9; }
  }

  const choose = (p) => { setPath(p); setPhase("play2"); };
  const replay = () => { setPath(null); setPhase("play1"); };

  // בזמן הבחירה הכרטיס מראה את השאלה, לא את אחת משתי האפשרויות
  useEffect(() => {
    if (phase !== "choice") return;
    setCaption({ num: 2, small: S2, big: "מה את רואה בתחתית המסך?" }, 1, "הקישי על התמונה שנראית כמו אצלך.");
    ["ring", "pill", "ripple", "finger", "arrow", "dim"].forEach((id) => { ov.current[id].style.opacity = 0; });
  }, [phase]);

  const card = { position: "relative", background: "#fff", border: `3px solid ${PINK}`, borderRadius: 18, padding: "24px 12px 12px", textAlign: "center", boxShadow: "0 6px 18px rgba(168,66,92,.18)", marginTop: 20 };
  const badge = { position: "absolute", top: -22, left: "50%", marginLeft: -22, width: 44, height: 44, borderRadius: "50%", background: PINK, color: "#fff", fontWeight: 700, fontSize: 26, display: "flex", alignItems: "center", justifyContent: "center", border: "3px solid #fff", boxSizing: "border-box" };
  const optBtn = { display: "block", width: "100%", border: `2.5px solid ${PINK}`, background: "#fff", borderRadius: 16, padding: 8, marginBottom: 12, cursor: "pointer", fontFamily: font, boxShadow: "0 4px 12px rgba(168,66,92,.2)" };

  return (
    <div data-walk="ios" style={{ maxWidth: 340, margin: "0 auto", fontFamily: font }}>
      <div style={{ display: "flex", justifyContent: "center", gap: 8, direction: "rtl" }}>
        {[0, 1, 2, 3, 4].map((i) => <div key={i} ref={(el) => { cap.current.dots = cap.current.dots || []; cap.current.dots[i] = el; }} style={{ width: 10, height: 10, borderRadius: "50%", background: "#F1E4E7" }} />)}
      </div>
      <div ref={(el) => { cap.current.card = el; }} style={card}>
        <div ref={(el) => { cap.current.num = el; }} style={badge}>1</div>
        <div ref={(el) => { cap.current.small = el; }} style={{ fontSize: 14.5, fontWeight: 500, lineHeight: 1.4, color: PINK_D, marginBottom: 4 }} />
        <div ref={(el) => { cap.current.big = el; }} style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.35, color: INK }}>{SHOTS.s1.big}</div>
        <div ref={(el) => { cap.current.extra = el; }} style={{ fontSize: 16, fontWeight: 500, lineHeight: 1.4, color: INK, marginTop: 4, display: "none" }} />
      </div>
      <div ref={wrap} style={{ position: "relative", width: "100%", height: BOX.h * scale, marginTop: 10, borderRadius: 16, overflow: "hidden", background: "#F7EEF0" }}>
        <div style={{ position: "absolute", top: 0, right: 0, width: BOX.w, height: BOX.h, transform: `scale(${scale})`, transformOrigin: "top right", direction: "ltr" }}>
          {KEYS.map((k) => (
            <div key={k} ref={(el) => { layers.current[k] = el; }} style={{ position: "absolute", left: 0, top: 0, transformOrigin: "0 0", opacity: k === "s1" ? 1 : 0, transform: `translate(${SHOTS[k].ox}px,${SHOTS[k].oy}px)` }}>
              <img src={DIR + SHOTS[k].src} alt="" draggable={false} style={{ display: "block", width: SHOTS[k].w * SHOTS[k].f, height: SHOTS[k].h * SHOTS[k].f, borderRadius: 22 }} />
            </div>
          ))}
          <svg viewBox={`0 0 ${BOX.w} ${BOX.h}`} width={BOX.w} height={BOX.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <path ref={(el) => { ov.current.dim = el; }} fill="#1d1418" fillRule="evenodd" opacity="0" />
            <circle ref={(el) => { ov.current.ring = el; }} fill="none" stroke={RED} strokeWidth="16" strokeLinecap="round" opacity="0" />
            <rect ref={(el) => { ov.current.pill = el; }} fill="none" stroke={RED} strokeWidth="16" strokeLinecap="round" opacity="0" />
            <circle ref={(el) => { ov.current.ripple = el; }} fill="none" stroke={PINK} strokeWidth="10" opacity="0" />
            <g ref={(el) => { ov.current.arrow = el; }} opacity="0"><path d="M0 0 L-46 -60 L-18 -60 L-18 -150 L18 -150 L18 -60 L46 -60 Z" fill={PINK} stroke="#fff" strokeWidth="6" strokeLinejoin="round" /></g>
            <g ref={(el) => { ov.current.finger = el; }} opacity="0">
              <g transform="rotate(-28)">
                <rect x="-46" y="-6" width="92" height="330" rx="46" fill="#000" opacity=".18" transform="translate(10,14)" />
                <rect x="-46" y="-6" width="92" height="330" rx="46" fill="#F2C7A9" stroke="#C98B6B" strokeWidth="5" />
                <rect x="-28" y="6" width="56" height="70" rx="26" fill="#FBE3D3" stroke="#D9A588" strokeWidth="3" />
                <path d="M-40 150 Q0 165 40 150" fill="none" stroke="#C98B6B" strokeWidth="5" strokeLinecap="round" />
              </g>
            </g>
          </svg>
        </div>
        {/* שני הכפתורים מתנפחים אחד אחרי השני, כדי שיהיה ברור שהם כפתורים ושצריך
            להקיש על אחד מהם. רון: "זה לא ברור שהיא צריכה ללחוץ על אחד מהכפתורים". */}
        <style>{`@keyframes mpWalkPulse{0%,50%,100%{transform:scale(1);box-shadow:0 4px 12px rgba(168,66,92,.2)}20%{transform:scale(1.06);box-shadow:0 8px 26px rgba(212,93,121,.55)}}
          .mp-walk-pulse{animation:mpWalkPulse 2.4s ease-in-out infinite}.mp-walk-pulse2{animation-delay:1.2s}`}</style>
        {phase === "choice" && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(250,243,244,.97)", padding: 12, display: "flex", flexDirection: "column", justifyContent: "center", direction: "rtl" }}>
            {[["share", "bar-share.png", "הסרגל התחתון של ספארי, עם כפתור השיתוף"], ["dots", "bar-dots.png", "הסרגל התחתון של ספארי במצב מכווץ, עם שלוש נקודות"]].map(([p, img, alt]) => (
              <button key={p} data-walk-choice={p} onClick={() => choose(p)} className={"mp-walk-pulse" + (p === "dots" ? " mp-walk-pulse2" : "")} style={optBtn}>
                <img src={DIR + img} alt={alt} style={{ display: "block", width: "100%", borderRadius: 10 }} />
                <div style={{ marginTop: 8, background: PINK, color: "#fff", borderRadius: 999, padding: "7px 12px", fontSize: 17, fontWeight: 700 }}>זה מה שאני רואה</div>
              </button>
            ))}
          </div>
        )}
      </div>
      {phase === "end" && (
        <button data-walk-replay onClick={replay} style={{ display: "block", margin: "10px auto 0", border: `2px solid ${PINK}`, background: "#fff", color: PINK_D, borderRadius: 12, padding: "10px 22px", fontSize: 16, fontWeight: 700, fontFamily: font, cursor: "pointer" }}>לצפות שוב</button>
      )}
    </div>
  );
}
