// מיי פריים Glow - שיעורי בונוס
//
// Bonus lessons given to some women (the last webinars), on top of the 60 programme days.
// Vered Spivak teaches them, not Anat, so nothing here is signed "ענת".
//
// Three things about this file that are deliberate:
//
// 1. It is NOT part of CONTENT_DAYS. If these lessons were added to a programme day they
//    would join the denominator of "how much of the content she watched", and every woman
//    who received the bonus would suddenly read as behind everyone else in the office
//    screen. They are outside every count: the ring, the progress bar and admin:usage.
// 2. They belong to no day, so they carry week 0 / day 0. That keeps the existing lesson
//    viewer, the done marks and the favourites working without a second code path.
// 3. Only a woman marked in the `בונוס איפור` column of the registration sheet sees them.
//
// To add a lesson: upload to the SAME Bunny library (681869) and paste its id below.
// While the list is empty nothing is rendered anywhere, for anyone.
//
// The lesson numbers (3, 6, 8) are the ones they carry in the full course and are kept on
// purpose: they say without a word that there is more where these came from. The intro is
// not one of the three, which is why the heading still reads "שלושה שיעורים" above four rows.
export const GLOW_TITLE = "בונוס: שלושה שיעורי איפור וטיפוח מתוך תוכנית מיי פריים Glow";
export const GLOW_CHIP = "מיי פריים Glow";
// On the diary card, where space is tight and it is seen every day until she starts watching.
export const GLOW_CARD_LINE = "בונוס: 3 שיעורי Glow 💄";
// One compact row inside "התוכן שלי היום", instead of listing the lessons under every day.
export const GLOW_ROW = "שיעורי הבונוס שלך במיי פריים Glow";
// lucide has no lipstick, and a paintbrush would read as art. The emoji says makeup at a
// glance and needs no icon set.
export const GLOW_EMOJI = "💄";

// She has played at least one bonus lesson. Only used to stop nagging her on the diary card:
// the row inside the content screen stays, because it is her way back to them.
export const GLOW_STARTED_KEY = "mp_glow_started_v1";
export function glowStarted() {
  try { return localStorage.getItem(GLOW_STARTED_KEY) === "1"; } catch (e) { return false; }
}
export function markGlowStarted() {
  try { localStorage.setItem(GLOW_STARTED_KEY, "1"); } catch (e) {}
}

export const GLOW_DAY = {
  week: 0,
  day: 0,
  theme: "מיי פריים Glow",
  lessons: [
    { title: "מבוא", type: "video", videoId: "405fc049-0e7a-4447-9f1d-193845c0b4b9" },
    { title: "שיעור 3 - פריימר ובסיס (מייק אפ)", type: "video", videoId: "f7dc36be-25b6-45ef-bb9c-4315b94cddb4" },
    { title: "שיעור 6 - איפור עיניים בסיסי", type: "video", videoId: "81e96d03-c4a6-40e5-9442-432629fd8b33" },
    { title: "שיעור 8 - מראה עיניים מעושן", type: "video", videoId: "333ac741-4dba-41d5-bdce-946503c74660" },
  ],
};

export const hasGlow = () => GLOW_DAY.lessons.length > 0;

/* ============================================================
   הקורס המלא
   ============================================================
   רון, 9 בספטמבר 2026: וובינר שבו נשים מקבלות את קורס האיפור המלא במתנה. הן
   מסומנות בעמודה `GLOW-FULL` בגיליון, ורואות את כל הקורס באותו מסך שבו שלושת
   השיעורים החינמיים מוצגים היום.

   שלושה דברים שחשוב לשמור:

   1. **שלושת החינמיים הם חלק מהקורס ולא בלוק נפרד.** החלטת רון. מי שקיבלה את
      המלא רואה רשימה אחת, ולא את אותם שיעורים בשני מקומות.
   2. **מוצג בשמונה הסעיפים של הקורס** ולא ברשימה שטוחה של 28 שורות.
   3. **לא מופיע בכרטיס היומן.** החלטת רון: "לא הייתי שם את זה ביומן". הדרך
      אליו היא השורה במסך התוכן והצ'יפ ב"כל התוכנית".

   שיעור בלי מזהה אינו מרונדר בכלל, ולכן אפשר להוסיף אותם אחד אחד.
   וכמו הבונוס, גם זה יושב מחוץ לכל ספירה של התוכנית. */
export const GLOW_FULL_TITLE = "מיי פריים Glow - הקורס המלא";
export const GLOW_FULL_ROW = "קורס האיפור המלא שלך במיי פריים Glow";

const FULL_SECTIONS_RAW = [
  { title: "להתחיל מהבסיס", lessons: [
    { title: "שיעור 1א׳ - מבוא קורס", videoId: "405fc049-0e7a-4447-9f1d-193845c0b4b9" },
    { title: "שיעור 1 ב׳ - מה קורה לעור שלנו בגיל המעבר?", videoId: "82f8a94b-12ce-4280-b98c-b5eb5cec6824" },
    { title: "שיעור 2 - עבודה עם גוואשה", videoId: "c72cbeaa-cf87-411e-a78c-a9d9c72f5f6a" },
  ] },
  { title: "פנים", lessons: [
    { title: "שיעור 3 - הכנת העור פריימר ובסיס (המייקאפ)", videoId: "f7dc36be-25b6-45ef-bb9c-4315b94cddb4" },
    { title: "שיעור 4 - קונסילר וקורקטור", videoId: "6a7b153a-779a-4de9-8c74-8b23f1ff47cb" },
    { title: "שיעור 5 - שיטת 4 MUST - חלק א׳", videoId: "95b14af8-3cdf-4e18-9a6a-d43d06054586" },
    { title: "שיעור 5 - שיטת 4 MUST - חלק ב׳", videoId: "06281ff4-cdbe-4836-ae9a-962094c537de" },
    { title: "שיעור 5 - שיטת 4 MUST - חלק ג׳", videoId: "1f276a60-68d5-4130-9870-4e320970dff2" },
  ] },
  { title: "עיניים", lessons: [
    { title: "שיעור 6 - איפור עיניים בסיסי", videoId: "81e96d03-c4a6-40e5-9442-432629fd8b33" },
    { title: "שיעור 7 - אייליינר מעושן", videoId: "6c87da14-7747-472e-a68a-c7fefb2e0969" },
    { title: "שיעור 8 - מראה עיניים מעושן", videoId: "333ac741-4dba-41d5-bdce-946503c74660" },
    { title: "שיעור 9 - איפור עיניים עם צלליות קרם", videoId: "50d5ec30-4741-4a86-bbd8-ee5c6237c33b" },
    { title: "שיעור 10 - גבות", videoId: "4ffcb4d6-7f4b-4e4a-9322-f1165ecfbbe3" },
  ] },
  { title: "לחיים", lessons: [
    { title: "שיעור 11 - הצללות", videoId: "0bde2e6e-01ec-483d-bcbe-f8a700bdb0bf" },
    { title: "שיעור 12 - האדרות", videoId: "3ca16fc0-d817-4985-a421-d0ee98f34d8a" },
    { title: "שיעור 13 - סומק", videoId: "10ac207c-9b8f-4763-ab17-5f743beabb84" },
  ] },
  { title: "שפתיים", lessons: [
    { title: "שיעור 14 - עיצוב והגדלת שפתיים", videoId: "e70cd96a-829e-4c34-a0bb-5fe653337457" },
    { title: "שיעור 15 שפתון: איך לייצר וייב אחר?", videoId: "ab473fd9-60de-4421-b99a-ce43184b0e5e" },
  ] },
  { title: "שיער", lessons: [
    { title: "שיעור 16 - מתיחה להרמת העיניים והמורל", videoId: "8a3e3173-0150-4d8e-8080-f31f1661b06d" },
    { title: "שיעור 17 - עיצוב השיער עם מקלון סלסול", videoId: "70db58d5-33cb-40a6-9c25-f5c373da0c44" },
    { title: "שיעור 18 - נשירת שיער", videoId: "f21a9dd6-fe84-4223-9cd4-e82e240813a1" },
  ] },
  { title: "טאץ׳-אפ וסביבת האיפור", lessons: [
    { title: "שיעור 19 - טאצ׳ אפ", videoId: "3c9713fa-e937-4ddf-a97e-d365d81a7d72" },
    { title: "כל מה שאת צריכה בסביבת האיפור שלך", videoId: "3bb104f4-60e6-4dcd-b210-32eccff7620f" },
  ] },
  { title: "מפתחות לאהבה עצמית", lessons: [
    { title: "מבוא", videoId: "5ff04d74-935c-413f-a592-78fbae3c46d4" },
    { title: "מפתח 1 - דברי אליך יפה", videoId: "37122f6b-4b2c-46b0-9ca0-184e79fba464" },
    { title: "מפתח 2 - כוחה של נשימה", videoId: "c13d503f-ead8-452d-9c3b-8b6655f29111" },
    { title: "מפתח 3 - לנעוץ ביומן", videoId: "7d95e3e2-4c9e-4ac8-a13f-fdf4b4635d46" },
    { title: "מפתח 4 - תבחרי בך", videoId: "4870cb33-36b0-4a0d-9db4-f99020acfea5" },
  ] },
];

// רשימה שטוחה אחת של השיעורים שכבר יש להם סרטון, ולצידה הסעיפים שמצביעים
// עליה במספרים. **המספר הוא מה שמסמן "הושלם" ומה שנשמר במועדפים**, ולכן הוא
// נגזר מהרשימה השטוחה ולעולם לא מהמיקום בתוך הסעיף.
const FULL_FLAT = [];
export const GLOW_FULL_SECTIONS = FULL_SECTIONS_RAW.map((sec) => {
  const idx = [];
  for (const l of sec.lessons) {
    if (!l.videoId) continue;
    idx.push(FULL_FLAT.length);
    FULL_FLAT.push({ title: l.title, type: "video", videoId: l.videoId });
  }
  return { title: sec.title, idx };
}).filter((sec) => sec.idx.length > 0);

export const GLOW_FULL_DAY = { week: 0, day: 0, theme: "מיי פריים Glow", lessons: FULL_FLAT };
export const hasGlowFull = () => GLOW_FULL_DAY.lessons.length > 0;
// כמה שיעורים בקורס בסך הכל, כולל אלה שעוד לא הועלו. משמש את הכיתוב בלבד.
export const GLOW_FULL_PLANNED = FULL_SECTIONS_RAW.reduce((n, s) => n + s.lessons.length, 0);
