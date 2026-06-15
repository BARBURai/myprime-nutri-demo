import React, { useState, useEffect, useRef } from "react";
import { Play, Film, Dumbbell, ClipboardCheck, FileText, Info, Download, ExternalLink, ChevronRight, ChevronLeft, X, Loader } from "lucide-react";
import { CONTENT_DAYS, PDF_BASE, contentForDay } from "./data";
export { contentForDay } from "./data";

/* ============================================================
   MyPrime course content module (core).
   Self-contained: receives the theme (C) and font as props, reads its own
   data from ./data, and signs Bunny embed URLs via /api/bunny-token.
   No favorites / no "completed" / no progress in this core slice.
   No em or en dashes anywhere.
   ============================================================ */

const TYPE_META = {
  video: { label: "סרטון", Icon: Play },
  workout: { label: "אימון", Icon: Dumbbell },
  task: { label: "משימה", Icon: ClipboardCheck },
  pdf: { label: "דף", Icon: FileText },
  info: { label: "מידע", Icon: Info },
};
function typeMeta(t) { return TYPE_META[t] || TYPE_META.video; }

// Bunny embedded player. Asks the server for a signed embed URL (token), then
// shows it in a responsive 16:9 iframe. Never exposes the signing key.
function BunnyPlayer({ videoId, C, font }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  const liveRef = useRef(true);
  useEffect(() => {
    liveRef.current = true;
    setUrl(null); setErr(false);
    fetch(`/api/bunny-token?videoId=${encodeURIComponent(videoId)}`)
      .then((r) => r.json())
      .then((d) => { if (!liveRef.current) return; if (d && d.url) setUrl(d.url); else setErr(true); })
      .catch(() => { if (liveRef.current) setErr(true); });
    return () => { liveRef.current = false; };
  }, [videoId]);
  const box = { position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", background: "#000", marginBottom: 16 };
  if (err) {
    return (
      <div style={{ ...box, paddingTop: 0, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "22px 16px", textAlign: "center" }}>
        <span style={{ fontSize: 14.5, color: C.sub, fontFamily: font, lineHeight: 1.6 }}>לא הצלחנו לטעון את הסרטון כרגע. נסי לרענן את האפליקציה בעוד רגע.</span>
      </div>
    );
  }
  if (!url) {
    return (
      <div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Loader size={26} className="spin" /></span>
      </div>
    );
  }
  return (
    <div style={box}>
      <iframe src={url} loading="lazy" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} title="סרטון" />
    </div>
  );
}

// Small card shown on the day screen: opens the day's videos. Returns null on
// days with no content (e.g. Saturday), so nothing shows.
export function ContentDayCard({ week, dow, C, font, onOpen }) {
  const day = contentForDay(week, dow);
  if (!day) return null;
  const n = day.lessons.length;
  return (
    <div onClick={onOpen} role="button" aria-label="הסרטונים שלך היום"
      style={{ background: C.brandBg, border: `1.5px solid ${C.brand}`, borderRadius: 16, padding: "13px 14px", marginBottom: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, fontFamily: font }}>
      <div style={{ width: 44, height: 44, borderRadius: 12, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: `0 3px 9px ${C.brand}55` }}>
        <Film size={22} color="#fff" />
      </div>
      <div style={{ flex: 1, textAlign: "right" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: C.brandD, lineHeight: 1.4 }}>הסרטונים שלך היום</div>
        <div style={{ fontSize: 15.5, color: C.brandD, marginTop: 3 }}>{day.theme ? day.theme + " · " : ""}{n} {n === 1 ? "פריט" : "פריטים"}</div>
      </div>
      <ChevronLeft size={20} color={C.brand} style={{ flexShrink: 0 }} />
    </div>
  );
}

// Full overlay: day list -> lesson detail.
export function ContentModule({ week, dow, C, font, onClose }) {
  const day = contentForDay(week, dow);
  const [idx, setIdx] = useState(null); // null = list view, number = lesson detail

  const overlay = { position: "absolute", inset: 0, zIndex: 36, background: C.panel, display: "flex", flexDirection: "column", fontFamily: font, direction: "rtl" };
  const head = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", paddingTop: "max(14px, env(safe-area-inset-top, 0px) + 48px)", borderBottom: `1px solid ${C.line}`, flexShrink: 0 };
  const headTitle = { fontSize: 20, fontWeight: 700, color: C.ink };
  const backBtn = { display: "flex", alignItems: "center", gap: 4, border: `1px solid ${C.line}`, background: C.panel, color: C.brandD, borderRadius: 999, padding: "7px 14px", fontSize: 15, fontWeight: 600, fontFamily: font, cursor: "pointer" };
  const closeBtn = { border: "none", background: "transparent", cursor: "pointer", color: C.faint, padding: 4 };

  if (!day) {
    return (
      <div style={overlay}>
        <div style={head}><button onClick={onClose} style={backBtn}><ChevronRight size={18} /> חזרה ליומן</button><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 28, textAlign: "center", color: C.sub, fontSize: 16, lineHeight: 1.7 }}>
          אין תוכן ליום הזה.<br />נתראה ביום הבא 💜
        </div>
      </div>
    );
  }

  // ----- Lesson detail -----
  if (idx != null && day.lessons[idx]) {
    const l = day.lessons[idx];
    const tm = typeMeta(l.type);
    const showVideo = !!l.videoId;
    return (
      <div style={overlay}>
        <div style={head}>
          <button onClick={() => setIdx(null)} style={backBtn}><ChevronRight size={18} /> חזרה לסרטונים שלך היום</button>
          <button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 28px" }}>
          <div style={{ fontSize: 22, fontWeight: 700, color: C.ink, lineHeight: 1.35, marginBottom: 4 }}>{l.title}</div>
          <div style={{ fontSize: 13.5, color: C.faint, marginBottom: 16 }}>שיעור {idx + 1} מתוך {day.lessons.length} · {tm.label}</div>

          {l.text && l.text.length > 0 && (
            <div style={{ fontSize: 16, color: C.ink, lineHeight: 1.75, marginBottom: showVideo || l.pdf ? 18 : 4 }}>
              {l.text.map((p, i) => (<div key={i} style={{ marginBottom: 10 }}>{p}</div>))}
            </div>
          )}

          {showVideo && <BunnyPlayer videoId={l.videoId} C={C} font={font} />}

          {l.image && (
            <div style={{ borderRadius: 14, overflow: "hidden", marginBottom: 16 }}>
              <img src={l.image} alt={l.title} style={{ width: "100%", display: "block", borderRadius: 14 }} />
            </div>
          )}

          {l.links && l.links.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>לינקים לציוד:</div>
              {l.links.map((lk, i) => (
                <a key={i} href={lk.url} target="_blank" rel="noreferrer"
                  style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", border: `1.5px solid ${C.line}`, background: C.bg, borderRadius: 14, padding: "13px 14px", marginBottom: 10 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 11, background: C.brandBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ExternalLink size={20} color={C.brand} /></div>
                  <div style={{ flex: 1, textAlign: "right" }}>
                    <div style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{lk.label}</div>
                    <div style={{ fontSize: 13.5, color: C.sub }}>לחצי לפתיחה</div>
                  </div>
                  <ExternalLink size={18} color={C.faint} style={{ flexShrink: 0 }} />
                </a>
              ))}
            </div>
          )}

          {l.pdf && (
            <a href={PDF_BASE + l.pdf} target="_blank" rel="noreferrer"
              style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", border: `1.5px solid ${C.brand}`, background: C.brandBg, borderRadius: 14, padding: "13px 14px", marginTop: 4 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><FileText size={20} color="#fff" /></div>
              <div style={{ flex: 1, textAlign: "right" }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: C.brandD }}>דף להורדה</div>
                <div style={{ fontSize: 13.5, color: C.brandD }}>PDF · נפתח בלחיצה</div>
              </div>
              <Download size={20} color={C.brand} style={{ flexShrink: 0 }} />
            </a>
          )}
        </div>
      </div>
    );
  }

  // ----- Day list -----
  return (
    <div style={overlay}>
      <div style={head}><button onClick={onClose} style={backBtn}><ChevronRight size={18} /> חזרה ליומן</button><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 16px 28px" }}>
        <div style={{ background: `linear-gradient(135deg, ${C.brand}, ${C.brandD})`, borderRadius: 18, padding: "16px 16px 18px", color: "#fff", marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3 }}>הסרטונים שלך היום</div>
          <div style={{ fontSize: 14.5, opacity: 0.92, marginTop: 4 }}>שבוע {day.week} יום {day.day}{day.theme ? " · " + day.theme : ""}</div>
        </div>
        {day.lessons.map((l, i) => {
          const tm = typeMeta(l.type);
          const meta = tm.label + (l.pdf && l.type !== "pdf" ? " · כולל דף להורדה" : "");
          return (
            <div key={i} onClick={() => setIdx(i)} role="button"
              style={{ display: "flex", alignItems: "center", gap: 12, border: `1px solid ${C.line}`, borderRadius: 14, padding: 13, marginBottom: 10, cursor: "pointer", background: C.panel }}>
              <div style={{ width: 44, height: 44, borderRadius: 12, background: C.brandBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><tm.Icon size={21} color={C.brand} /></div>
              <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
                <div style={{ fontSize: 17, fontWeight: 600, color: C.ink, lineHeight: 1.35 }}>{l.title}</div>
                <div style={{ fontSize: 15, color: C.sub2 || C.ink, opacity: 0.7, marginTop: 3 }}>{meta}</div>
              </div>
              <ChevronLeft size={18} color={C.faint} style={{ flexShrink: 0 }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
