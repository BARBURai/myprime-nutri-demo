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
export const GLOW_TITLE = "בונוס: שלושה שיעורי איפור וטיפוח מתוך תוכנית מיי פריים Glow";
export const GLOW_CHIP = "מיי פריים Glow";

export const GLOW_DAY = {
  week: 0,
  day: 0,
  theme: "מיי פריים Glow",
  lessons: [
    // { title: "שם השיעור", type: "video", videoId: "" },
  ],
};

export const hasGlow = () => GLOW_DAY.lessons.length > 0;
