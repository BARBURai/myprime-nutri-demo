import React, { useState, useEffect, useRef } from "react";
import { Play, Film, Dumbbell, ClipboardCheck, FileText, Info, Download, ExternalLink, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, X, Loader, Check, Heart, Search } from "lucide-react";
import { CONTENT_DAYS, PDF_BASE, contentForDay } from "./data";
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
function loadStore(key) { try { return JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) { return {}; } }
function saveStore(key, obj) { try { localStorage.setItem(key, JSON.stringify(obj)); } catch (e) {} }
function lessonKey(week, day, i) { return `W${week}D${day}-${i}`; }
function tracksProgress(day) { return !!day; }
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
  // watch-tracking refs (do not trigger re-render)
  const durationRef = useRef(0);
  const watchedRef = useRef(0);     // cumulative real seconds watched
  const lastTimeRef = useRef(null); // previous currentTime seen
  const firedRef = useRef(false);   // 80% already reported
  const reachCbRef = useRef(onReach80);
  useEffect(() => { reachCbRef.current = onReach80; }, [onReach80]);

  useEffect(() => {
    liveRef.current = true;
    setUrl(null); setErr(false);
    fetch(`/api/bunny-token?videoId=${encodeURIComponent(videoId)}`)
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
  return (<div style={box}><iframe ref={iframeRef} src={url} loading="lazy" allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture" allowFullScreen style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "none" }} title="סרטון" /></div>);
}

export function ContentDayCard({ week, dow, C, font, onOpen }) {
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
      </div>
      <ChevronLeft size={20} color={C.brand} style={{ flexShrink: 0 }} />
    </div>
  );
}

export function ContentModule({ week, dow, todayWeek, todayDow, C, font, onClose, onTourEvent }) {
  const allDays = CONTENT_DAYS;
  const isOpenDay = (w, d) => (w < todayWeek) || (w === todayWeek && d <= todayDow);
  const openDaysList = allDays.filter((dd) => isOpenDay(dd.week, dd.day)).slice().sort((a, b) => a.week - b.week || a.day - b.day);
  const openWeeks = [...new Set(openDaysList.map((dd) => dd.week))].sort((a, b) => a - b);
  const todayDay = contentForDay(week, dow);

  const [done, setDone] = useState({});
  const [fav, setFav] = useState({});
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
      setDayOpen({ [`${todayWeek}-${todayDow}`]: true });
    }
  }, [view]);

  const dayByWD = (w, d) => allDays.find((dd) => dd.week === w && dd.day === d);
  const isDone = (w, d, i) => !!done[lessonKey(w, d, i)];
  const isFav = (w, d, i) => !!fav[lessonKey(w, d, i)];
  const toggleDone = (w, d, i) => setDone((s) => { const n = { ...s }; const k = lessonKey(w, d, i); if (n[k]) delete n[k]; else n[k] = 1; saveStore(DONE_KEY, n); return n; });
  // Auto-complete: mark done without ever un-marking (re-watching keeps it done).
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
  const scroll = { flex: 1, overflowY: "auto", padding: "14px 16px 28px" };
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
        {l.pageImages.map((img, i) => (
          <img key={i} src={PDF_BASE + img} alt={`עמוד ${i + 1}`} style={{ width: "100%", display: "block", borderRadius: 12, marginBottom: 10 }} />
        ))}
      </div>
    );
  }

  function DownloadBtn({ l }) {
    const items = (l.downloads && l.downloads.length) ? l.downloads : (l.pdf ? [{ label: "הורדת הדף", file: l.pdf }] : []);
    if (!items.length) return null;
    return (
      <div>
        {items.map((it, i) => (
          <a key={i} href={PDF_BASE + it.file} target="_blank" rel="noreferrer"
            style={{ display: "flex", alignItems: "center", gap: 12, textDecoration: "none", border: `1.5px solid ${C.brand}`, background: C.brandBg, borderRadius: 14, padding: "13px 14px", marginTop: i === 0 ? 4 : 10 }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: C.brand, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><FileText size={20} color="#fff" /></div>
            <div style={{ flex: 1, textAlign: "right" }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: C.brandD }}>{it.label}</div>
              <div style={{ fontSize: 15, color: C.brandD }}>נפתח בלחיצה</div>
            </div>
            <Download size={20} color={C.brand} style={{ flexShrink: 0 }} />
          </a>
        ))}
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

            {l.videoId && <div data-tut="lessonplayer"><div style={{ fontSize: 14, fontWeight: 700, color: C.brandD, marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}><Play size={15} /> לחצי לצפייה</div><BunnyPlayer videoId={l.videoId} C={C} font={font} onReach80={track ? () => markDone(openL.week, openL.day, openL.i) : undefined} /></div>}
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
    const visibleDays = isPdf ? [] : weekDays.filter((dd) => dd.lessons.some((l) => matchesChip(l, typeF)));
    return (
      <div style={overlay}>
        <div style={head}><button onClick={onClose} style={backBtn}><ChevronRight size={18} /> חזרה ליומן</button><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
        <div style={scroll}>
          <Segmented />
          <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
            <button onClick={() => setView("search")} style={{ flex: 1, border: `1.5px solid ${C.line}`, background: C.panel, color: C.brandD, borderRadius: 12, padding: "11px 8px", fontFamily: font, fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Search size={18} /> חיפוש</button>
            <button onClick={() => setView("fav")} style={{ flex: 1, border: `1.5px solid ${C.line}`, background: C.panel, color: C.brandD, borderRadius: 12, padding: "11px 8px", fontFamily: font, fontSize: 16, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}><Heart size={18} /> המועדפים שלי</button>
          </div>

          {!isPdf && (
            <div style={{ display: "flex", gap: 8, overflowX: "auto", paddingBottom: 4, marginBottom: 14 }}>
              {openWeeks.map((w) => (<button key={w} onClick={() => setSelWeek(w)} style={{ flexShrink: 0, border: "none", cursor: "pointer", borderRadius: 999, padding: "8px 16px", fontFamily: font, fontSize: 16, fontWeight: 700, background: w === wk ? C.brand : C.bg, color: w === wk ? "#fff" : C.ink }}>שבוע {w}</button>))}
            </div>
          )}

          <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginBottom: 16 }}>
            {FILTER_CHIPS.map(([id, lbl]) => (<button key={id} onClick={() => setTypeF(id)} style={{ border: `1.5px solid ${typeF === id ? C.brand : C.line}`, cursor: "pointer", borderRadius: 999, padding: "6px 13px", fontFamily: font, fontSize: 15, fontWeight: 600, background: typeF === id ? C.brandBg : C.panel, color: typeF === id ? C.brandD : C.ink }}>{lbl}</button>))}
          </div>

          {isPdf ? (
            pageEntries.length === 0
              ? <div style={{ fontSize: 16, color: C.sub, textAlign: "center", padding: "22px 14px" }}>אין דפים זמינים עדיין.</div>
              : pageEntries.map((x) => <ResultRow key={lessonKey(x.week, x.day, x.i)} w={x.week} d={x.day} l={x.l} i={x.i} from="all" pagesOnly subtitle={`שבוע ${x.week} יום ${x.day} · ${x.l.pageImages.length} עמודים`} />)
          ) : (
            visibleDays.length === 0
              ? <div style={{ fontSize: 16, color: C.sub, textAlign: "center", padding: "22px 14px" }}>אין תוכן מסוג זה בשבוע {wk}.</div>
              : visibleDays.map((dd) => {
                const dk = `${dd.week}-${dd.day}`;
                const isCurrent = dd.week === todayWeek && dd.day === todayDow;
                const opened = dayOpen[dk] != null ? dayOpen[dk] : isCurrent;
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
      <div style={head}><button onClick={onClose} style={backBtn}><ChevronRight size={18} /> חזרה ליומן</button><button onClick={onClose} aria-label="סגירה" style={closeBtn}><X size={22} /></button></div>
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
      </div>
    </div>
  );
}
