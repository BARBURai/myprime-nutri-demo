import React, { useState, useEffect, useRef } from "react";
import { Play, Maximize2, Film, Dumbbell, ClipboardCheck, FileText, Info, Download, ExternalLink, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, X, Loader, Check, Heart, Search } from "lucide-react";
import { CONTENT_DAYS, PDF_BASE, contentForDay } from "./data";
import { GLOW_DAY, GLOW_TITLE, GLOW_CHIP, hasGlow } from "./glow";
export { contentForDay } from "./data";


/* ============================================================
   MyPrime course content module.
   Views: "היום" / "כל התוכנית" (browse opened days) / מועדפים / חיפוש /
   מסך שיעור / תצוגת דף מינימלית. Per-lesson completed + favorites (local),
   search, type filter chips, drip. A "דף" (task page) = a lesson with
   pageImages (page images shown one under the other) + a download file.
   Completion/favorites are on-device only, NOT wired to the daily ring.
   Video lessons auto-mark complete after 80% real (cumulative) watch time
   via Bunny player.js timeupdate; manual mark stays available in parallel.
   Week 1 days 1-2 (intro) have no progress tracking. No em or en dashes.
   ============================================================ */

const DONE_KEY = "mp_content_done_v1";
const FAV_KEY = "mp_content_fav_v1";
// How many times each lesson's video reached the watch threshold. Separate from DONE_KEY,
// which only ever records that it happened once: re-watching keeps a lesson done, so a
// counter is the only way to see that she went back to something.
const VIEWS_KEY = "mp_content_views_v1";
function loadStore(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; } }
function saveStore(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {} }
function lessonKey(week, day, i) { return `W${week}D${day}-${i}`; }
function tracksProgress(day) { return !!day; }
// iPhone/iPad: Safari ignores the download attribute, so a plain link NAVIGATES to the PDF.
// Inside an installed PWA there is no toolbar and no back button, so the woman gets stuck on the
// PDF with no way out and no share button. On iOS we open the native share sheet instead
// (Save to Files / WhatsApp / print), which is a system sheet, not a navigation, so the app stays put.
// Android and desktop keep the plain download link, which already works there.
function isIOS() {
  if (typeof navigator === "undefined") return false;
  const ua = (navigator.userAgent || "").toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return true;
  return /macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1; // iPadOS reports as Mac
}
const DL_HINT = isIOS() ? "לחצי לשמירה או שליחה" : "לחצי להורדה";
function hasTaskWord(l) { return /משימ/.test((l && l.title) || ""); }
function hasPages(l) { return !!(l && l.pageImages && l.pageImages.length); }
function matchesChip(l, chip) {
  if (chip === "all") return true;
  if (chip === "task") return hasTaskWord(l);
  if (chip === "workout") return l.type === "workout";
  if (chip === "video") return l.type === "video" && !hasTaskWord(l);
  return false; // "pdf" (דפים) is handled as its own flat list
}

const TYPE_META = {
  video: { label: "סרטון", Icon: Play },
  workout: { label: "אימון", Icon: Dumbbell },
  task: { label: "משימה", Icon: ClipboardCheck },
  pdf: { label: "דף", Icon: FileText },
  info: { label: "מידע", Icon: Info },
};
function typeMeta(t) { return TYPE_META[t] || TYPE_META.video; }
const FILTER_CHIPS = [["all", "הכל"], ["workout", "אימונים"], ["task", "משימות"], ["video", "סרטונים"], ["pdf", "דפים"]];

// Load Bunny's player.js once (hosted on Bunny CDN). Resolves when playerjs is ready.
const PLAYERJS_SRC = "https://assets.mediadelivery.net/playerjs/player-0.1.0.min.js";
let playerjsPromise = null;
function loadPlayerJs() {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.playerjs) return Promise.resolve(window.playerjs);
  if (playerjsPromise) return playerjsPromise;
  playerjsPromise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = PLAYERJS_SRC; s.async = true;
    s.onload = () => setTimeout(() => (window.playerjs ? resolve(window.playerjs) : reject(new Error("playerjs missing"))), 0);
    s.onerror = () => reject(new Error("playerjs load failed"));
    document.head.appendChild(s);
  });
  return playerjsPromise;
}

const WATCH_THRESHOLD = 0.8; // mark complete after 80% real watch time
const SEEK_GAP = 3;          // seconds: a jump larger than this between timeupdates is a seek, not playback

function BunnyPlayer({ videoId, C, font, onReach80 }) {
  const [url, setUrl] = useState(null);
  const [err, setErr] = useState(false);
  const liveRef = useRef(true);
  const iframeRef = useRef(null);
  const boxRef = useRef(null);
  // watch-tracking refs (do not trigger re-render)
  const durationRef = useRef(0);
  const watchedRef = useRef(0);     // cumulative real seconds watched
  const lastTimeRef = useRef(null); // previous currentTime seen
  const firedRef = useRef(false);   // 80% already reported
  const reachCbRef = useRef(onReach80);
  const playerRef = useRef(null);
  useEffect(() => { reachCbRef.current = onReach80; }, [onReach80]);

  useEffect(() => {
    liveRef.current = true;
    setUrl(null); setErr(false);
    // Her email rides along so the server can check entitlement for the bonus lessons. It is
    // ignored for the 60 programme days, which every participant may watch.
    let em = "";
    try { em = localStorage.getItem("myprime_access_email") || ""; } catch (e) {}
    fetch(`/api/bunny-token?videoId=${encodeURIComponent(videoId)}${em ? `&email=${encodeURIComponent(em)}` : ""}`)
      .then((r) => r.json())
      .then((d) => { if (!liveRef.current) return; if (d && d.url) setUrl(d.url); else setErr(true); })
      .catch(() => { if (liveRef.current) setErr(true); });
    return () => { liveRef.current = false; };
  }, [videoId]);

  // Reset tracking whenever the video changes.
  useEffect(() => {
    durationRef.current = 0; watchedRef.current = 0; lastTimeRef.current = null; firedRef.current = false;
  }, [videoId]);

  // Attach player.js and accumulate real watch time (seeks ignored).
  useEffect(() => {
    if (!url || !iframeRef.current) return;
    let player = null; let cancelled = false;
    loadPlayerJs().then((playerjs) => {
      if (cancelled || !iframeRef.current) return;
      try {
        player = new playerjs.Player(iframeRef.current);
        playerRef.current = player;
        player.on("ready", () => {
          try { player.getDuration((dur) => { if (dur && dur > 0) durationRef.current = dur; }); } catch (e) {}
        });
        player.on("timeupdate", (data) => {
          const t = data && typeof data.seconds === "number" ? data.seconds : (typeof data === "number" ? data : null);
          if (t == null) return;
          if (data && typeof data.duration === "number" && data.duration > 0) durationRef.current = data.duration;
          const prev = lastTimeRef.current;
          if (prev != null) {
            const delta = t - prev;
            // count only forward playback in small increments; ignore seeks/rewinds
            if (delta > 0 && delta <= SEEK_GAP) watchedRef.current += delta;
          }
          lastTimeRef.current = t;
          const dur = durationRef.current;
          if (!firedRef.current && dur > 0 && watchedRef.current >= dur * WATCH_THRESHOLD) {
            firedRef.current = true;
            if (reachCbRef.current) reachCbRef.current();
          }
        });
      } catch (e) {}
    }).catch(() => {});
    return () => { cancelled = true; try { if (player && player.off) { player.off("timeupdate"); player.off("ready"); } } catch (e) {} };
  }, [url]);

  const box = { position: "relative", width: "100%", paddingTop: "56.25%", borderRadius: 14, overflow: "hidden", background: "#000", marginBottom: 16 };
  if (err) return (<div style={{ ...box, paddingTop: 0, background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: "22px 16px", textAlign: "center" }}><span style={{ fontSize: 14.5, color: C.sub, fontFamily: font, lineHeight: 1.6 }}>לא הצלחנו לטעון את הסרטון כרגע. נסי לרענן את האפליקציה בעוד רגע.</span></div>);
  if (!url) return (<div style={{ ...box, display: "flex", alignItems: "center", justifyContent: "center" }}><span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}><Loader size={26} className="spin" /></span></div>);
  return (<>
    <div style={{ fontSize: 14, fontWeight: 700, color: C.brandD, marginBottom: 6, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", lineHeight: 1.6 }}>
      <span>לחצי</span><Play size={15} /><span>לצפייה, ולאחר מכן לחצי על</span><Maximize2 size={15} /><span>הגדלת המסך</span>
    </div>
    <div ref={boxRef} style={box}><iframe ref={iframeRef} src={url} loading="lazy" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} title="סרטון" /></div>
  </>);
}



export function ContentDayCard({ week, dow, C, font, onOpen, glow }) {
  const day = contentForDay(week, dow);
  if (!day) return null;
  const n = day.lessons.length;
  const track = tracksProgress(day);
  let doneCount = 0;
  if (track) {
    const done = loadStore(DONE_KEY);
    doneCount = day.lessons.reduce((s, _l, i) => s + (done[lessonKey(day.week, day.day, i)] ? 1 : 0), 0);
  }
  const pct = track && n > 0 ? Math.round(doneCount / n * 100) : 0;
  return (
    <div data-tut="contentcard" onClick={onOpen} role="button" aria-label="הסרטונים שלך היום"
      style={{ background: C.brandBg, border: `1.5px solid ${C.brand}`, borderRadius: 16, padding: "13px 14px", marginBottom: 14, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, fontFamily: font }}>
      <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
        <div style={{ width: 44, height: 44, borderRadius: 12, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 3px 9px ${C.brand}55` }}><Film size={22} color="#fff" /></div>
        {track && (
          <div data-tut="contentbar" style={{ width: 44, height: 5, borderRadius: 999, background: "#ffffff", overflow: "hidden", boxShadow: `inset 0 0 0 1px ${C.brand}22` }}>
            <div style={{ height: "100%", width: `${pct}%`, background: "#4E9E76", borderRadius: 999, transition: "width .3s" }} />
          </div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: C.brandD, lineHeight: 1.4 }}>הסרטונים שלך היום</div>
        <div style={{ fontSize: 15, color: C.brandD, marginTop: 3 }}>{day.theme ? day.theme + " · " : ""}{track ? `${doneCount}/${n}` : `${n} ${n === 1 ? "פריט" : "פריטים"}`}</div>
        {glow && hasGlow() && <div style={{ fontSize: 14, color: C.brandD, marginTop: 4, lineHeight: 1.45 }}>{GLOW_TITLE}</div>}
      </div>
      <ChevronLeft size={20} color={C.brand} style={{ flexShrink: 0 }} />
    </div>
  );
}

export function ContentModule({ week, dow, todayWeek, todayDow, C, font, onClose, onTourEvent, glow }) {
  const allDays = CONTENT_DAYS;
  const showGlow = !!glow && hasGlow();
  // Saturday carries day-of-week 0, and "everything up to today" then matches nothing, so the
  // whole current week vanished from "כל התוכנית" - on the Saturday of week 1 the screen was
  // empty. Shabbat reads as Friday here, the same way the tracker already treats it.
  const openDow = todayDow === 0 ? 6 : todayDow;
  const isOpenDay = (w, d) => (w < todayWeek) || (w === todayWeek && d <= openDow);
  const openDaysList = allDays.filter((dd) => isOpenDay(dd.week, dd.day)).slice().sort((a, b) => a.week - b.week || a.day - b.day);
  const openWeeks = [...new Set(openDaysList.map((dd) => dd.week))].sort((a, b) => a - b);
  const todayDay = contentForDay(week, dow);

  const [done, setDone] = useState({});
  const [fav, setFav] = useState({});
  const [zoomPage, setZoomPage] = useState(null); // page image opened full-screen
  // Zoom happens inside ZoomViewer (transform on the image), so the app-wide
  // pinch lock can stay on and the top/bottom bars are never scaled.
  useEffect(() => { setDone(loadStore(DONE_KEY)); setFav(loadStore(FAV_KEY)); }, []);

  const [view, setView] = useState("today");
  const [openL, setOpenL] = useState(null); // {week, day, i, pagesOnly}
  const [origin, setOrigin] = useState("today");
  const [selWeek, setSelWeek] = useState(null);
  const [dayOpen, setDayOpen] = useState({});
  const [query, setQuery] = useState("");
  const [typeF, setTypeF] = useState("all");

  useEffect(() => {
    if (view === "all" && selWeek == null) {
      const wk = openWeeks.includes(todayWeek) ? todayWeek : (openWeeks[openWeeks.length - 1] || 1);
      setSelWeek(wk);
      // Nothing is expanded on arrival. Today's day used to open by itself, and on any day
      // it failed to match it stayed shut, so it read as random. She opens what she wants.
    }
  }, [view]);

  // Week 0 is the bonus. Guarded by showGlow as well, so that even a stale open-lesson state
  // cannot render a bonus lesson for a woman who is not marked for it.
  const dayByWD = (w, d) => (w === 0 ? (showGlow ? GLOW_DAY : null) : allDays.find((dd) => dd.week === w && dd.day === d));
  const isDone = (w, d, i) => !!done[lessonKey(w, d, i)];
  const isFav = (w, d, i) => !!fav[lessonKey(w, d, i)];
  const toggleDone = (w, d, i) => setDone((s) => { const n = { ...s }; const k = lessonKey(w, d, i); if (n[k]) delete n[k]; else n[k] = 1; saveStore(DONE_KEY, n); return n; });
  // Auto-complete: mark done without ever un-marking (re-watching keeps it done).
  const bumpView = (w, d, i) => {
    const v = loadStore(VIEWS_KEY);
    const k = lessonKey(w, d, i);
    v[k] = (v[k] || 0) + 1;
    saveStore(VIEWS_KEY, v);
  };
  const markDone = (w, d, i) => setDone((s) => { const k = lessonKey(w, d, i); if (s[k]) return s; const n = { ...s, [k]: 1 }; saveStore(DONE_KEY, n); return n; });
  const toggleFav = (w, d, i) => setFav((s) => { const n = { ...s }; const k = lessonKey(w, d, i); if (n[k]) delete n[k]; else n[k] = 1; saveStore(FAV_KEY, n); return n; });
  const dayDoneCount = (dd) => dd.lessons.reduce((s, _l, i) => s + (isDone(dd.week, dd.day, i) ? 1 : 0), 0);

  const flatOpen = [];
  openDaysList.forEach((dd) => dd.lessons.forEach((l, i) => flatOpen.push({ week: dd.week, day: dd.day, i, l })));
  const pageEntries = flatOpen.filter((x) => hasPages(x.l));
  const locLabel = (w, d, l) => `שבוע ${w} יום ${d} · ${typeMeta(l.type).label}`;

  const nextUp = (w, d, i) => {
    const dd = dayByWD(w, d);
    if (dd && dd.lessons[i + 1]) return { week: w, day: d, i: i + 1 };
    if (w === 0) return null; // the bonus is its own set: it never spills into the programme
    const pos = openDaysList.findIndex((x) => x.week === w && x.day === d);
    for (let j = pos + 1; j < openDaysList.length; j++) { if (openDaysList[j].lessons.length) return { week: openDaysList[j].week, day: openDaysList[j].day, i: 0 }; }
    return null;
  };

  const goLesson = (w, d, i, from, pagesOnly) => { setOrigin(from); setOpenL({ week: w, day: d, i, pagesOnly: !!pagesOnly }); if (onTourEvent) onTourEvent("openlesson"); };

  // Report tour-relevant view changes so a guided tour can follow the user's taps.
  useEffect(() => { if (onTourEvent) onTourEvent("contentopen"); }, []);
  useEffect(() => { if (onTourEvent) onTourEvent(view === "all" ? "tab-all" : view === "today" ? "tab-today" : null); }, [view]);

  const overlay = { position: "absolute", inset: 0, zIndex: 36, background: C.panel, display: "flex", flexDirection: "column", fontFamily: font, direction: "rtl" };
  const head = { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", paddingTop: "max(14px, env(safe-area-inset-top, 0px) + 48px)", borderBottom: `1px solid ${C.line}`, flexShrink: 0 };
  const backBtn = { display: "flex", alignItems: "center", gap: 4, border: `1px solid ${C.line}`, background: C.panel, color: C.brandD, borderRadius: 999, padding: "7px 14px", fontSize: 15, fontWeight: 600, fontFamily: font, cursor: "pointer" };
  const closeBtn = { border: "none", background: "transparent", cursor: "pointer", color: C.faint, padding: 4 };
  const scroll = { flex: 1, overflowY: "auto", padding: "14px 16px calc(96px + env(safe-area-inset-bottom, 0px))" };
  const rowStyle = { display: "flex", alignItems: "center", gap: 10, border: `1px solid ${C.line}`, borderRadius: 14, padding: 13, marginBottom: 10, cursor: "pointer", background: C.panel };
  const iconWrap = { width: 44, height: 44, borderRadius: 12, background: C.brandBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 };

  function Segmented() {
    return (
      <div style={{ display: "flex", gap: 4, background: C.bg, borderRadius: 12, padding: 4, marginBottom: 14 }}>
        {[["today", "היום"], ["all", "כל התוכנית"]].map(([id, lbl]) => (
          <button key={id} data-tut={`content-tab-${id}`} onClick={() => setView(id)} style={{ flex: 1, border: "none", cursor: "pointer", borderRadius: 9, padding: "10px 6px", fontFamily: font, fontSize: 16, fontWeight: 700, background: view === id ? C.panel : "transparent", color: view === id ? C.brandD : C.sub, boxShadow: view === id ? "0 1px 4px rgba(0,0,0,0.10)" : "none" }}>{lbl}</button>
        ))}
      </div>
    );
  }

  function LessonRow({ w, d, l, i, from }) {
    const tm = typeMeta(l.type);
    const meta = tm.label + (l.pdf || hasPages(l) ? " · כולל דף" : "");
    const trackD = tracksProgress(dayByWD(w, d));
    return (
      <div onClick={() => goLesson(w, d, i, from)} role="button" style={rowStyle}>
        <div style={iconWrap}><tm.Icon size={21} color={C.brand} /></div>
        <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: C.ink, lineHeight: 1.35 }}>{l.title}</div>
          <div style={{ fontSize: 17, color: C.ink, marginTop: 4 }}>{meta}</div>
        </div>
        {trackD && isDone(w, d, i) && <Check size={20} color="#4E9E76" style={{ flexShrink: 0 }} />}
        <ChevronLeft size={18} color={C.faint} style={{ flexShrink: 0 }} />
      </div>
    );
  }

  function ResultRow({ w, d, l, i, from, pagesOnly, subtitle }) {
    const tm = typeMeta(l.type);
    return (
      <div onClick={() => goLesson(w, d, i, from, pagesOnly)} role="button" style={rowStyle}>
        <div style={iconWrap}><tm.Icon size={21} color={C.brand} /></div>
        <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
          <div style={{ fontSize: 19, fontWeight: 700, color: C.ink, lineHeight: 1.35 }}>{l.title}</div>
          <div style={{ fontSize: 16, color: C.ink, marginTop: 4 }}>{subtitle || locLabel(w, d, l)}</div>
        </div>
        <ChevronLeft size={18} color={C.faint} style={{ flexShrink: 0 }} />
      </div>
    );
  }

  function PageImages({ l }) {
    if (!hasPages(l)) return null;
    return (
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: C.faint, textAlign: "center", marginBottom: 7 }}>הקישי על הדף כדי להגדיל ולקרוא בנוחות</div>
        {l.pageImages.map((img, i) => (
          <div key={i} onClick={() => setZoomPage(PDF_BASE + img)} role="button" aria-label={`הגדלת עמוד ${i + 1}`} style={{ position: "relative", cursor: "pointer", marginBottom: 10 }}>
            <img src={PDF_BASE + img} alt={`עמוד ${i + 1}`} style={{ width: "100%", display: "block", borderRadius: 12 }} />
            <div style={{ position: "absolute", insetInlineEnd: 8, bottom: 8, background: "rgba(58,43,48,0.72)", color: "#fff", borderRadius: 999, padding: "5px 11px", fontSize: 12.5, fontWeight: 600, pointerEvents: "none" }}>להגדלה</div>
          </div>
        ))}
      </div>
    );
  }

  function ZoomViewer({ src, onClose }) {
    const [z, setZ] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const st = useRef(null);
    const clamp = (v) => Math.min(4, Math.max(1, v));
    const onStart = (e) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        st.current = { kind: "pinch", d: Math.hypot(dx, dy), z };
      } else if (e.touches.length === 1 && z > 1) {
        st.current = { kind: "pan", x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y };
      }
    };
    const onMove = (e) => {
      const c = st.current;
      if (!c) return;
      if (c.kind === "pinch" && e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const nz = clamp(c.z * (Math.hypot(dx, dy) / (c.d || 1)));
        setZ(nz);
        if (nz === 1) setPan({ x: 0, y: 0 });
      } else if (c.kind === "pan" && e.touches.length === 1) {
        setPan({ x: e.touches[0].clientX - c.x, y: e.touches[0].clientY - c.y });
      }
    };
    const onEnd = () => { st.current = null; };
    const reset = () => { setZ(1); setPan({ x: 0, y: 0 }); };
    return (
      <div style={{ position: "fixed", inset: 0, background: "#1E1518", zIndex: 90, display: "flex", flexDirection: "column", touchAction: "none" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", paddingTop: "max(12px, env(safe-area-inset-top, 0px) + 52px)", color: "#fff", flexShrink: 0, gap: 10 }}>
          <button onClick={onClose} style={{ border: "none", background: "#fff", color: "#1E1518", borderRadius: 999, padding: "9px 18px", fontSize: 15, fontWeight: 700, fontFamily: font, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}><X size={18} /> סגירה</button>
          {z > 1 && <button onClick={reset} style={{ border: "1px solid rgba(255,255,255,0.5)", background: "transparent", color: "#fff", borderRadius: 999, padding: "8px 14px", fontSize: 13.5, fontWeight: 600, fontFamily: font, cursor: "pointer", flexShrink: 0 }}>גודל רגיל</button>}
        </div>
        <div onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}
          style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
          <img src={src} alt="" draggable={false} style={{ width: "100%", display: "block", transform: `translate(${pan.x}px, ${pan.y}px) scale(${z})`, transformOrigin: "center center", transition: st.current ? "none" : "transform .18s ease-out", willChange: "transform" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "center", gap: 10, padding: "8px 14px max(12px, env(safe-area-inset-bottom, 0px))", flexShrink: 0 }}>
          <button onClick={() => setZ((v) => clamp(v - 0.5))} aria-label="הקטנה" style={{ border: "none", background: "rgba(255,255,255,0.16)", color: "#fff", borderRadius: 999, width: 46, height: 40, fontSize: 22, fontFamily: font, cursor: "pointer" }}>-</button>
          <button onClick={() => setZ((v) => clamp(v + 0.5))} aria-label="הגדלה" style={{ border: "none", background: "rgba(255,255,255,0.16)", color: "#fff", borderRadius: 999, width: 46, height: 40, fontSize: 22, fontFamily: font, cursor: "pointer" }}>+</button>
          <button onClick={onClose} style={{ border: "none", background: "rgba(255,255,255,0.16)", color: "#fff", borderRadius: 999, padding: "0 18px", height: 40, fontSize: 14.5, fontWeight: 600, fontFamily: font, cursor: "pointer" }}>חזרה לדף</button>
        </div>
      </div>
    );
  }

  function DeviceGuide({ g }) {
    // Three collapsible cards: her own phone opens first, the others are one tap away.
    const iosFirst = /iphone|ipad|ipod/i.test((typeof navigator !== "undefined" && navigator.userAgent) || "");
    const [open, setOpen] = useState(iosFirst ? "ios" : "android");
    const toggle = (k) => setOpen(open === k ? null : k);
    // A step's text is a string, a {b,t} pair, or a list of those - the list is what lets a
    // sentence bold something in the middle or at the end, not only its opening words.
    const rich = (t) => {
      if (typeof t === "string") return t;
      if (Array.isArray(t)) return t.map((x, i) => <React.Fragment key={i}>{rich(x)}</React.Fragment>);
      return (<>{t.b ? <b style={{ color: C.brandD }}>{t.b}</b> : null}{t.t}</>);
    };

    const Steps = ({ d }) => (
      <div style={{ paddingTop: 4 }}>
        {(d.steps || []).map((st, i) => (
          <div key={i} style={{ display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 16 }}>
            <div style={{ width: 30, height: 30, borderRadius: 999, background: C.brand, color: "#fff", fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>{i + 1}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 18, color: C.ink, lineHeight: 1.8, display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                {st.appIcon && <img src={PDF_BASE + st.appIcon} alt="" width={42} height={42} style={{ borderRadius: 10, display: "block", flexShrink: 0, boxShadow: "0 1px 4px rgba(0,0,0,0.16)" }} />}
                <span>{rich(st.text)}</span>
              </div>
              {st.tip && <div style={{ fontSize: 16, color: C.sub, lineHeight: 1.7, marginTop: 5 }}>{st.tip}</div>}
              {st.img && <img src={PDF_BASE + st.img} alt="" style={{ width: "100%", display: "block", borderRadius: 12, marginTop: 10, border: `1px solid ${C.line}`, background: "#fff" }} />}
            </div>
          </div>
        ))}
      </div>
    );

    const Card = ({ id, label, children }) => (
      <div style={{ background: C.bg, borderRadius: 14, padding: 14, marginBottom: 10 }}>
        <div onClick={() => toggle(id)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", gap: 10 }}>
          <span style={{ fontSize: 17.5, fontWeight: 700, color: C.brandD }}>{label}</span>
          <ChevronDown size={21} color={C.sub} style={{ flexShrink: 0, transform: open === id ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
        </div>
        {open === id && <div style={{ marginTop: 8 }}>{children}</div>}
      </div>
    );

    const AppList = ({ items, heading }) => (
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16.5, fontWeight: 700, color: C.ink, marginBottom: 7 }}>{heading}</div>
        {(items || []).map((a, i) => (
          <a key={i} href={a.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", border: `1px solid ${C.line}`, background: C.panel, borderRadius: 12, padding: "12px 13px", marginBottom: 8 }}>
            <div style={{ flex: 1, fontSize: 17, fontWeight: 600, color: C.brandD, textAlign: "right" }}>{a.label}</div>
            <ExternalLink size={17} color={C.brand} style={{ flexShrink: 0 }} />
          </a>
        ))}
      </div>
    );

    return (
      <div style={{ marginBottom: 18 }}>
        {g.title && <div style={{ fontSize: 21, fontWeight: 700, color: C.brandD, marginBottom: 8 }}>{g.title}</div>}
        {g.intro && g.intro.map((t, i) => (<div key={i} style={{ fontSize: 18, color: C.ink, lineHeight: 1.85, marginBottom: 10 }}>{rich(t)}</div>))}
        <div style={{ fontSize: 16.5, color: C.sub, lineHeight: 1.7, margin: "12px 0 10px" }}>בחרי את ההנחיות המתאימות לטלפון שלך:</div>

        {g.android && <Card id="android" label={g.android.label || "הנחיות לסמסונג / אנדרואיד"}><Steps d={g.android} /></Card>}
        {g.ios && <Card id="ios" label={g.ios.label || "הנחיות לאייפון"}><Steps d={g.ios} /></Card>}

        {((g.android && g.android.apps) || (g.ios && g.ios.apps)) && (
          <Card id="apps" label="אפליקציות חיצוניות מומלצות">
            <div style={{ fontSize: 17, color: C.ink, lineHeight: 1.8, marginBottom: 12 }}>אם תרצי, אפשר להוריד אפליקציה ייעודית למדידת צעדים:</div>
            {g.android && g.android.apps && <AppList items={g.android.apps} heading="למכשירי אנדרואיד" />}
            {g.ios && g.ios.apps && <AppList items={g.ios.apps} heading="לאייפון" />}
          </Card>
        )}
      </div>
    );
  }

  function DownloadBtn({ l }) {
    const items = (l.downloads && l.downloads.length) ? l.downloads : (l.pdf ? [{ label: "הורדת הדף", file: l.pdf }] : []);
    const [busy, setBusy] = useState("");
    const [dlErr, setDlErr] = useState("");
    if (!items.length) return null;
    const rowStyle = (i) => ({ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", border: `1.5px solid ${C.brand}`, background: C.brandBg, borderRadius: 14, padding: "13px 14px", marginTop: i === 0 ? 4 : 10, cursor: "pointer", width: "100%", boxSizing: "border-box", fontFamily: "inherit", textAlign: "right" });
    const rowInner = (it) => (
      <>
        <div style={{ width: 42, height: 42, borderRadius: 11, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><FileText size={20} color="#fff" /></div>
        <div style={{ flex: 1, textAlign: "right", minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.brandD }}>{it.label}</div>
          <div style={{ fontSize: 15, color: C.brandD }}>{busy === it.file ? "רגע, מכינה את הקובץ..." : DL_HINT}</div>
        </div>
        <Download size={20} color={C.brand} style={{ flexShrink: 0 }} />
      </>
    );
    // iOS: fetch the PDF and hand it to the native share sheet. Only the files array is passed,
    // because on iOS adding title/text makes file sharing fail.
    async function iosShare(it) {
      setDlErr(""); setBusy(it.file);
      try {
        const res = await fetch(PDF_BASE + it.file);
        if (!res.ok) throw new Error("fetch");
        const blob = await res.blob();
        const file = new File([blob], it.file, { type: "application/pdf" });
        if (!(navigator.canShare && navigator.canShare({ files: [file] }))) throw new Error("unsupported");
        await navigator.share({ files: [file] });
      } catch (e) {
        if (!(e && e.name === "AbortError")) setDlErr("לא הצלחנו לשמור את הקובץ. אפשר לצפות בדף כאן באפליקציה.");
      } finally {
        setBusy("");
        // The iOS share sheet shrinks the visual viewport like a keyboard, and iOS does not
        // reliably fire a resize when it closes - the app frame stayed at half height with the
        // bottom bar stranded in the middle. Ask App.jsx to measure the screen again.
        try { if (typeof window !== "undefined" && typeof window.__mpRemeasure === "function") window.__mpRemeasure(); } catch (e2) {}
      }
    }
    return (
      <div>
        {items.map((it, i) => (
          isIOS() ? (
            <button key={i} type="button" onClick={() => iosShare(it)} disabled={!!busy} style={rowStyle(i)}>{rowInner(it)}</button>
          ) : (
            <a key={i} href={PDF_BASE + it.file} download={it.file} rel="noreferrer" style={rowStyle(i)}>{rowInner(it)}</a>
          )
        ))}
        {dlErr && <div style={{ fontSize: 14, color: C.brandD, background: C.brandBg, borderRadius: 12, padding: "10px 12px", marginTop: 8 }}>{dlErr}</div>}
      </div>
    );
  }

  // ---------- LESSON DETAIL / PAGE VIEW ----------
  if (openL) {
    const dd = dayByWD(openL.week, openL.day);
    const l = dd && dd.lessons[openL.i];
    if (l) {
      const tm = typeMeta(l.type);
      const track = tracksProgress(dd);
      const nu = nextUp(openL.week, openL.day, openL.i);
      const nuLesson = nu ? dayByWD(nu.week, nu.day).lessons[nu.i] : null;
      const dOn = isDone(openL.week, openL.day, openL.i);
      const fOn = isFav(openL.week, openL.day, openL.i);
      const backLabel = openL.pagesOnly ? "חזרה לדפים" : origin === "today" ? "חזרה לסרטונים שלך היום" : origin === "all" ? "חזרה לכל התוכנית" : origin === "fav" ? "חזרה למועדפים" : "חזרה לחיפוש";

      if (openL.pagesOnly) {
        // Minimal page view: only the page images + download. No video, no rest.
        return (
          <div style={overlay}>
            <div style={head}><button onClick={() => { setOpenL(null); setView(origin); }} style={backBtn}><ChevronRight size={18} /> {backLabel}</button><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
            <div style={scroll}>
              <div style={{ fontSize: 24, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: 16 }}>{l.title}</div>
              <PageImages l={l} />
              <DownloadBtn l={l} />
            </div>
            {zoomPage && <ZoomViewer src={zoomPage} onClose={() => setZoomPage(null)} />}
          </div>
        );
      }

      const statusBtn = (on, onClick, onColor, offColor, icon, labelOn, labelOff) => (
        <button onClick={onClick} style={{ flex: 1, borderRadius: 12, padding: "11px 8px", fontSize: 15.5, fontWeight: 700, fontFamily: font, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7, border: on ? "none" : `1.5px solid ${offColor}`, background: on ? onColor : C.panel, color: on ? "#fff" : offColor }}>{icon}{on ? labelOn : labelOff}</button>
      );

      return (
        <div style={overlay}>
          <div style={head}><button onClick={() => { setOpenL(null); setView(origin); }} style={backBtn}><ChevronRight size={18} /> {backLabel}</button><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
          <div style={scroll}>
            <div style={{ fontSize: 26, fontWeight: 700, color: C.ink, lineHeight: 1.3, marginBottom: 6 }}>{l.title}</div>
            <div style={{ fontSize: 16, color: C.sub, marginBottom: 14 }}>שיעור {openL.i + 1} מתוך {dd.lessons.length} · {tm.label}</div>

            <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
              {track && <div data-tut="lesson-done" style={{ flex: 1, display: "flex" }}>{statusBtn(dOn, () => toggleDone(openL.week, openL.day, openL.i), "#4E9E76", C.brand, <Check size={18} />, "הושלם", "סמני כהושלם")}</div>}
              <div data-tut="lesson-fav" style={{ flex: 1, display: "flex" }}>{statusBtn(fOn, () => toggleFav(openL.week, openL.day, openL.i), "#D7263D", "#D7263D", <Heart size={18} fill={fOn ? "#fff" : "none"} />, "במועדפים", "סמני כמועדף")}</div>
            </div>

            {l.text && l.text.length > 0 && (
              <div style={{ fontSize: 18, color: C.ink, lineHeight: 1.85, marginBottom: 20 }}>
                {l.text.map((p, i) => (<div key={i} style={{ marginBottom: 10 }}>{p}</div>))}
              </div>
            )}

            {l.videoId && <div data-tut="lessonplayer"><BunnyPlayer videoId={l.videoId} C={C} font={font} onReach80={track ? () => { bumpView(openL.week, openL.day, openL.i); markDone(openL.week, openL.day, openL.i); } : undefined} /></div>}
            {l.sections && l.sections.map((sec, si) => (
              <div key={si} style={{ marginBottom: 20 }}>
                {sec.h && <div style={{ fontSize: 21, fontWeight: 700, color: C.brandD, marginBottom: 8 }}>{sec.h}</div>}
                {(sec.p || []).map((t, i) => (
                  <div key={i} style={{ fontSize: 18, color: C.ink, lineHeight: 1.85, marginBottom: 10 }}>
                    {typeof t === "string" ? t : (<><b style={{ color: C.brandD }}>{t.b}</b>{t.t}</>)}
                  </div>
                ))}
                {(sec.list || []).length > 0 && (
                  <div style={{ marginTop: 2 }}>
                    {sec.list.map((li, i) => (
                      <div key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", marginBottom: 8 }}>
                        <span style={{ color: C.brand, fontSize: 20, lineHeight: 1.4, flexShrink: 0 }}>•</span>
                        <span style={{ fontSize: 18, color: C.ink, lineHeight: 1.8 }}>{typeof li === "string" ? li : (<><b style={{ color: C.brandD }}>{li.b}</b> {li.t}</>)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {l.guide && <DeviceGuide g={l.guide} />}
            {l.image && (<div style={{ borderRadius: 14, overflow: "hidden", marginBottom: 16 }}><img src={l.image} alt={l.title} style={{ width: "100%", display: "block", borderRadius: 14 }} /></div>)}
            <PageImages l={l} />

            {l.links && l.links.length > 0 && (
              <div style={{ marginTop: 4, marginBottom: 8 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginBottom: 10 }}>לינקים לציוד:</div>
                {l.links.map((lk, i) => (
                  <a key={i} href={lk.url} target="_blank" rel="noreferrer" style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", border: `1.5px solid ${C.line}`, background: C.bg, borderRadius: 14, padding: "13px 14px", marginBottom: 10 }}>
                    <div style={{ width: 42, height: 42, borderRadius: 11, background: C.brandBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><ExternalLink size={20} color={C.brand} /></div>
                    <div style={{ flex: 1, textAlign: "right" }}><div style={{ fontSize: 16, fontWeight: 600, color: C.ink }}>{lk.label}</div><div style={{ fontSize: 15, color: C.sub }}>לחצי לפתיחה</div></div>
                    <ExternalLink size={18} color={C.faint} style={{ flexShrink: 0 }} />
                  </a>
                ))}
              </div>
            )}

            <DownloadBtn l={l} />

            {nu && nuLesson && (
              <div onClick={() => setOpenL({ week: nu.week, day: nu.day, i: nu.i, pagesOnly: false })} role="button" style={{ marginTop: 16, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, background: C.bg }}>
                <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}><div style={{ fontSize: 14, color: C.sub, marginBottom: 2 }}>הבא בתור</div><div style={{ fontSize: 17, fontWeight: 700, color: C.ink, lineHeight: 1.35 }}>{nuLesson.title}</div></div>
                <ChevronLeft size={20} color={C.brand} style={{ flexShrink: 0 }} />
              </div>
            )}
          </div>
          {zoomPage && <ZoomViewer src={zoomPage} onClose={() => setZoomPage(null)} />}
        </div>
      );
    }
  }

  // ---------- FAVORITES ----------
  if (view === "fav") {
    const favList = flatOpen.filter((x) => isFav(x.week, x.day, x.i));
    return (
      <div style={overlay}>
        <div style={head}><button onClick={() => setView("all")} style={backBtn}><ChevronRight size={18} /> חזרה לכל התוכנית</button><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
        <div style={scroll}>
          <div style={{ fontSize: 24, fontWeight: 800, color: C.ink, marginBottom: 14 }}>המועדפים שלי</div>
          {favList.length === 0 ? <div style={{ fontSize: 17, color: C.ink, textAlign: "center", padding: "26px 14px", lineHeight: 1.7 }}>עדיין אין מועדפים. סמני "מועדף" בתוך שיעור והם יופיעו כאן 💜</div> : favList.map((x) => <ResultRow key={lessonKey(x.week, x.day, x.i)} w={x.week} d={x.day} l={x.l} i={x.i} from="fav" />)}
        </div>
      </div>
    );
  }

  // ---------- SEARCH ----------
  if (view === "search") {
    const q = query.trim();
    const results = q ? flatOpen.filter((x) => (x.l.title || "").includes(q)) : [];
    return (
      <div style={overlay}>
        <div style={head}><button onClick={() => setView("all")} style={backBtn}><ChevronRight size={18} /> חזרה לכל התוכנית</button><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
        <div style={scroll}>
          <div style={{ position: "relative", marginBottom: 14 }}>
            <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש שיעור..." style={{ width: "100%", boxSizing: "border-box", fontFamily: font, fontSize: 17, color: C.ink, background: C.bg, border: `1.5px solid ${C.line}`, borderRadius: 12, padding: "12px 42px 12px 14px", direction: "rtl" }} />
            <Search size={19} color={C.faint} style={{ position: "absolute", right: 14, top: 13 }} />
          </div>
          {q && results.length === 0 && <div style={{ fontSize: 16, color: C.ink, textAlign: "center", padding: "22px 14px" }}>לא נמצאו שיעורים עבור "{q}".</div>}
          {results.map((x) => <ResultRow key={lessonKey(x.week, x.day, x.i)} w={x.week} d={x.day} l={x.l} i={x.i} from="search" />)}
        </div>
      </div>
    );
  }

  // ---------- ALL PROGRAM ----------
  if (view === "all") {
    const wk = selWeek == null ? (openWeeks[openWeeks.length - 1] || 1) : selWeek;
    const weekDays = openDaysList.filter((dd) => dd.week === wk);
    const isPdf = typeF === "pdf";
    // The bonus belongs to no week, so its chip hides the week row. Otherwise the same three
    // lessons would appear under every week and read as a bug.
    const isGlow = typeF === "glow";
    const visibleDays = isPdf || isGlow ? [] : weekDays.filter((dd) => dd.lessons.some((l) => matchesChip(l, typeF)));
    const chips = showGlow ? [...FILTER_CHIPS, ["glow", GLOW_CHIP]] : FILTER_CHIPS;
    return (
      <div style={overlay}>
        <div style={head}><span style={{ fontSize: 16.5, fontWeight: 700, color: C.brandD }}>התוכן שלי</span><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
        <div style={scroll}>
          <Segmented />
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <button onClick={() => setView("search")} style={{ flex: 1, border: `1.5px solid ${C.line}`, background: C.panel, color: C.brandD, borderRadius: 12, padding: "11px 8px", fontFamily: font, fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Search size={18} /> חיפוש</button>
            <button onClick={() => setView("fav")} style={{ flex: 1, border: `1.5px solid ${C.line}`, background: C.panel, color: C.brandD, borderRadius: 12, padding: "11px 8px", fontFamily: font, fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Heart size={18} /> המועדפים שלי</button>
          </div>

          {!isPdf && !isGlow && (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
              {openWeeks.map((w) => (<button key={w} onClick={() => setSelWeek(w)} style={{ flexShrink: 0, border: "none", cursor: "pointer", borderRadius: 999, padding: "8px 16px", fontFamily: font, fontSize: 16, fontWeight: 700, background: w === wk ? C.brand : C.bg, color: w === wk ? "#fff" : C.ink }}>שבוע {w}</button>))}
            </div>
          )}

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
            {chips.map(([id, lbl]) => (<button key={id} onClick={() => setTypeF(id)} style={{ border: `1.5px solid ${typeF === id ? C.brand : C.line}`, cursor: "pointer", borderRadius: 999, padding: "6px 13px", fontFamily: font, fontSize: 15, fontWeight: 600, background: typeF === id ? C.brandBg : C.panel, color: typeF === id ? C.brandD : C.ink }}>{lbl}</button>))}
          </div>

          {isGlow ? (
            <>
              <div style={{ fontSize: 17, fontWeight: 700, color: C.brandD, marginBottom: 10, lineHeight: 1.4 }}>{GLOW_TITLE}</div>
              {GLOW_DAY.lessons.map((l, i) => <LessonRow key={"g" + i} w={0} d={0} l={l} i={i} from="all" />)}
            </>
          ) : isPdf ? (
            pageEntries.length === 0
              ? <div style={{ fontSize: 16, color: C.sub, textAlign: "center", padding: "22px 14px" }}>אין דפים זמינים עדיין.</div>
              : pageEntries.map((x) => <ResultRow key={lessonKey(x.week, x.day, x.i)} w={x.week} d={x.day} l={x.l} i={x.i} from="all" pagesOnly subtitle={`שבוע ${x.week} יום ${x.day} · ${x.l.pageImages.length} עמודים`} />)
          ) : (
            visibleDays.length === 0
              ? <div style={{ fontSize: 16, color: C.sub, textAlign: "center", padding: "22px 14px" }}>אין תוכן מסוג זה בשבוע {wk}.</div>
              : visibleDays.map((dd) => {
                const dk = `${dd.week}-${dd.day}`;
                // Closed by default, today's day included. She opens what she wants to see.
                const opened = !!dayOpen[dk];
                const track = tracksProgress(dd);
                const shown = dd.lessons.map((l, i) => ({ l, i })).filter(({ l }) => matchesChip(l, typeF));
                return (
                  <div key={dk} style={{ border: `1px solid ${C.line}`, borderRadius: 16, marginBottom: 12, overflow: "hidden" }}>
                    <div onClick={() => setDayOpen((s) => ({ ...s, [dk]: !opened }))} role="button" style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 14px", cursor: "pointer", background: opened ? C.brandBg : C.panel }}>
                      <div style={{ flex: 1, minWidth: 0, textAlign: "right" }}>
                        <div style={{ fontSize: 19, fontWeight: 800, color: C.ink, display: "flex", alignItems: "center", gap: 8 }}>יום {dd.day}{isCurrent && <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: C.brand, borderRadius: 999, padding: "2px 9px" }}>היום</span>}</div>
                        <div style={{ fontSize: 16, color: C.ink, marginTop: 3 }}>{dd.theme ? dd.theme + " · " : ""}{track ? `${dayDoneCount(dd)}/${dd.lessons.length} הושלמו` : `${dd.lessons.length} פריטים`}</div>
                      </div>
                      {opened ? <ChevronUp size={20} color={C.brand} style={{ flexShrink: 0 }} /> : <ChevronDown size={20} color={C.faint} style={{ flexShrink: 0 }} />}
                    </div>
                    {opened && <div style={{ padding: "12px 12px 4px" }}>{shown.map(({ l, i }) => <LessonRow key={i} w={dd.week} d={dd.day} l={l} i={i} from="all" />)}</div>}
                  </div>
                );
              })
          )}
        </div>
      </div>
    );
  }

  // ---------- TODAY (default) ----------
  const track = tracksProgress(todayDay);
  const doneCount = todayDay ? todayDay.lessons.reduce((s, _l, i) => s + (isDone(todayDay.week, todayDay.day, i) ? 1 : 0), 0) : 0;
  return (
    <div style={overlay}>
      <div style={head}><span style={{ fontSize: 16.5, fontWeight: 700, color: C.brandD }}>התוכן שלי</span><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
      <div style={scroll}>
        <Segmented />
        {!todayDay ? (
          <div style={{ fontSize: 16, color: C.sub, textAlign: "center", padding: "26px 14px", lineHeight: 1.7 }}>אין תוכן ליום הזה.<br />אפשר לעבור ל"כל התוכנית" למעלה 💜</div>
        ) : (
          <>
            <div style={{ background: `linear-gradient(135deg, ${C.brand}, ${C.brandD})`, borderRadius: 18, padding: "16px 16px 18px", color: "#fff", marginBottom: 14 }}>
              <div style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.3 }}>הסרטונים שלך היום</div>
              <div style={{ fontSize: 17, opacity: 0.92, marginTop: 5 }}>שבוע {todayDay.week} יום {todayDay.day}{todayDay.theme ? " · " + todayDay.theme : ""}</div>
            </div>
            {track && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 15, color: C.sub, marginBottom: 6 }}>{doneCount} מתוך {todayDay.lessons.length} הושלמו</div>
                <div style={{ height: 8, borderRadius: 999, background: C.line, overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.round(doneCount / Math.max(1, todayDay.lessons.length) * 100)}%`, background: "#4E9E76", borderRadius: 999, transition: "width .3s" }} /></div>
              </div>
            )}
            {todayDay.lessons.map((l, i) => <LessonRow key={i} w={todayDay.week} d={todayDay.day} l={l} i={i} from="today" />)}
          </>
        )}
        {showGlow && (
          <>
            <div style={{ borderTop: `1px solid ${C.line}`, margin: "20px 0 14px" }} />
            <div style={{ fontSize: 17, fontWeight: 700, color: C.brandD, marginBottom: 10, lineHeight: 1.4 }}>{GLOW_TITLE}</div>
            {GLOW_DAY.lessons.map((l, i) => <LessonRow key={"g" + i} w={0} d={0} l={l} i={i} from="today" />)}
          </>
        )}
      </div>
      {zoomPage && <ZoomViewer src={zoomPage} onClose={() => setZoomPage(null)} />}
    </div>
  );
}

// Progress as plain numbers, for the office screen. Per programme day: how many lessons she
// finished out of how many exist. Plus video completions and repeat views. Nothing here says
// what she ate, what she weighs, or what she wrote.
export function usageSummary() {
  const done = loadStore(DONE_KEY);
  const views = loadStore(VIEWS_KEY);
  const days = {};
  let vDone = 0, vTotal = 0, vViews = 0;
  CONTENT_DAYS.forEach((d) => {
    const lessons = d.lessons || [];
    let n = 0;
    lessons.forEach((l, i) => {
      const k = lessonKey(d.week, d.day, i);
      if (done[k]) n++;
      if (l.videoId) { vTotal++; if (done[k]) vDone++; }
      vViews += views[k] || 0;
    });
    if (lessons.length) days[`${d.week}-${d.day}`] = [n, lessons.length];
  });
  return { days, videosDone: vDone, videosTotal: vTotal, views: vViews };
}
