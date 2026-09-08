// Jewish holidays and candle lighting, computed rather than tabulated.
//
// The push notifications used to know about exactly one quiet day, Saturday, found with
// getUTCDay() === 6. Every festival went out as a normal day: a 07:00 "new content" push on
// Yom Kippur morning, and an evening reminder that on 20 September 2026 would have landed
// almost exactly as the fast came in.
//
// A table of dates was the obvious fix and the wrong one, because somebody has to remember to
// extend it every year, and the year nobody does is the year it silently stops working. Node
// already carries the Hebrew calendar inside ICU, so the dates can be derived from the date
// itself and this file never needs touching again.
//
// Nothing here talks to the network and nothing here is a serverless function: the leading
// underscore keeps Vercel from counting the file against the 12 we are allowed, which is the
// trap that broke a whole deploy in v5.21. qa/vercel-limits-check.mjs guards that.

const HEB = new Intl.DateTimeFormat("en-u-ca-hebrew", {
  day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
});

// The Hebrew month and day for a Gregorian date. ICU names the months in English, which is
// steadier to match on than a number: a leap year inserts Adar I and shifts every index
// after it, while the names stay put.
export function hebrewDate(iso) {
  const parts = {};
  HEB.formatToParts(new Date(iso + "T12:00:00Z")).forEach((p) => { parts[p.type] = p.value; });
  return { month: parts.month, day: parseInt(parts.day, 10) };
}

// The days on which work is forbidden, as kept in Israel, where most festivals are one day
// rather than the two kept abroad. Chol hamoed is deliberately absent: those are working days,
// the app is in normal use, and silencing them would take a week of reminders away twice a year.
const YOM_TOV = {
  Tishri: [1, 2, 10, 15, 22],  // Rosh Hashanah (two days), Yom Kippur, Sukkot, Simchat Torah
  Nisan: [15, 21],             // first day of Pesach, seventh day of Pesach
  Sivan: [6],                  // Shavuot
};

export function isYomTov(iso) {
  const h = hebrewDate(iso);
  const days = YOM_TOV[h.month];
  return !!days && days.includes(h.day);
}

export function isSaturday(iso) {
  return new Date(iso + "T12:00:00Z").getUTCDay() === 6;
}

// A quiet day: nothing is sent, of either kind. Saturday was already this rule; the festivals
// join it. Note that the content still unlocks on these days exactly as before. Only the push
// is held back, and the morning after invites her to catch up on what she missed.
export function isQuietDay(iso) {
  return isSaturday(iso) || isYomTov(iso);
}

function addDays(iso, n) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Is tomorrow quiet? Every Friday is, and so is the day before a festival. This is what moves
// the evening reminder earlier, and it is deliberately phrased as "tomorrow is quiet" rather
// than "today is Friday" so that a festival needs no separate branch anywhere.
export function isErev(iso) {
  return !isQuietDay(iso) && isQuietDay(addDays(iso, 1));
}

// Only the eve of a festival carries the extra line about there being no reminders. Saying it
// every single Friday would turn a useful sentence into weekly noise, and the women already
// know Saturday is quiet.
export function isErevYomTov(iso) {
  return !isQuietDay(iso) && isYomTov(addDays(iso, 1));
}

// Was yesterday a festival? Drives the catch-up line the morning after.
export function wasYomTov(iso) {
  return isYomTov(addDays(iso, -1));
}

// Sunset, by the standard solar position calculation. Pure arithmetic, no library and no
// network call. Tel Aviv stands in for the whole country: sunset across Israel spans a few
// minutes end to end, and the reminder goes out two hours early, so those minutes cannot
// matter. Validated against published times: 19.06.2026 gives 19:50 against a real 19:49,
// 20.03.2026 gives 17:53 against 17:53, 18.12.2026 gives 16:40 against 16:44.
const LAT = 32.0853, LON = 34.7818, RAD = Math.PI / 180;

export function sunsetUTC(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const a = Math.floor(y / 100), b = 2 - a + Math.floor(a / 4);
  const jd = Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + b - 1524.5;
  const n = Math.round(jd - 2451545.0 + 0.0008);
  // Mean solar noon. East of Greenwich the sun crosses earlier, hence the subtraction.
  const jStar = 2451545.0 + 0.0009 - LON / 360 + n;
  const M = (357.5291 + 0.98560028 * (jStar - 2451545.0)) % 360;
  const C = 1.9148 * Math.sin(M * RAD) + 0.0200 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD);
  const lam = (M + C + 180 + 102.9372) % 360;
  const transit = jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lam * RAD);
  const dec = Math.asin(Math.sin(lam * RAD) * Math.sin(23.4397 * RAD));
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(LAT * RAD) * Math.sin(dec)) / (Math.cos(LAT * RAD) * Math.cos(dec));
  const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / RAD;
  return new Date((transit + w / 360 - 2440587.5) * 86400000);
}

// Candle lighting is taken as half an hour before sunset, the common practice outside
// Jerusalem. The exact minute does not matter here: it only feeds an hour that is two hours
// earlier still.
const CANDLE_BEFORE_SUNSET_MIN = 30;
const SEND_BEFORE_CANDLE_MIN = 120;
// A floor and a ceiling, so that a bad reading can never send at breakfast or after dark.
// The real range is 14:00 in midwinter to 17:00 in midsummer.
const EREV_MIN_HOUR = 12, EREV_MAX_HOUR = 18;

// The Jerusalem hour at which the reminder goes out on the eve of Shabbat or a festival.
// Rounded DOWN to a whole hour, because the scheduled job runs once an hour and arriving
// early is harmless while arriving late is the whole problem being fixed. In practice the
// push lands between two and three hours before candle lighting.
export function erevHour(iso) {
  if (!isErev(iso)) return null;
  const t = new Date(sunsetUTC(iso).getTime() - (CANDLE_BEFORE_SUNSET_MIN + SEND_BEFORE_CANDLE_MIN) * 60000);
  const h = parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", hour12: false }).format(t), 10);
  return Math.max(EREV_MIN_HOUR, Math.min(EREV_MAX_HOUR, h));
}
