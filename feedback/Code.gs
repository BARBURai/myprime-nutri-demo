/* ============================================================================
   MyPrime - beta feedback collector (STANDALONE Google Apps Script Web App)
   v3 - adds testEmail() to FORCE email authorization, and logs mail errors to
        a "Log" tab so silent failures become visible.

   WHY EMAILS WEREN'T ARRIVING:
   The web app was deployed/authorized before the email code (MailApp) existed,
   so the "send email" permission was never granted. doPost saves the row to the
   sheet and then tries to email inside a try/catch that swallows errors - so a
   missing-permission error was eaten silently (row saved, no email).

   HOW TO FIX (one time):
   1. Paste this whole file, Save.
   2. In the editor, pick the function "testEmail" from the dropdown and click Run.
      Google will show a permissions screen asking to "send email as you" - approve it.
   3. Check that the test email arrived at NOTIFY_EMAIL (also check Spam / Promotions).
   4. Re-deploy: Deploy > Manage deployments > Edit (pencil) > Version: New version > Deploy.
      (This keeps the same /exec URL.)
   After that, every feedback submission will also email. If an email ever fails,
   the exact error is recorded in the "Log" tab of the sheet.
   ========================================================================== */

// The target Google Sheet (from its URL: /spreadsheets/d/<THIS_ID>/edit).
var SHEET_ID = "18sKeB5KMsO9TnQO5iJXmBcAigzgzl7spcOmpwop1aT8";
var TAB_NAME = "Feedback";
var LOG_TAB = "Log";

// Where feedback notifications are sent.
var NOTIFY_EMAIL = "ron@myprime.co.il";

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB_NAME) || ss.insertSheet(TAB_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["התקבל", "נשלח", "שם", "מכשיר", "גרסה", "מסך", "הערה"]);
      sheet.setFrozenRows(1);
    }
    var data = JSON.parse(e.postData.contents);
    var now = new Date();
    var notes = (data.notes && data.notes.length) ? data.notes : [{ screen: "", text: data.text || "" }];
    notes.forEach(function (n) {
      sheet.appendRow([now, data.ts || "", data.name || "", data.device || "", data.version || "", n.screen || "", n.text || ""]);
    });

    // Send an email with the feedback (best-effort - never blocks saving).
    // On failure we record the error to the Log tab so it is no longer invisible.
    var mailStatus = "ok";
    try {
      sendNotification(data, notes, now);
    } catch (mailErr) {
      mailStatus = String(mailErr);
      logError_(ss, "doPost sendNotification", mailErr);
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, added: notes.length, mail: mailStatus }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function sendNotification(data, notes, now) {
  var name = data.name || "ללא שם";
  var subject = "משוב חדש מ-MyPrime" + (data.name ? " - " + data.name : "");

  var lines = [];
  lines.push("התקבל משוב חדש מהאפליקציה MyPrime.");
  lines.push("");
  lines.push("שם: " + name);
  lines.push("מכשיר: " + (data.device || "-"));
  lines.push("גרסה: " + (data.version || "-"));
  lines.push("זמן (מהאפליקציה): " + (data.ts || ""));
  lines.push("התקבל בשרת: " + now.toLocaleString("he-IL"));
  lines.push("");
  lines.push("ההערות:");
  notes.forEach(function (n, i) {
    var screen = n.screen ? " [מסך: " + n.screen + "]" : "";
    lines.push((i + 1) + "." + screen + " " + (n.text || ""));
  });
  var body = lines.join("\n");

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: subject,
    body: body,
    name: "MyPrime Feedback",
  });
}

function logError_(ss, context, err) {
  try {
    var log = ss.getSheetByName(LOG_TAB) || ss.insertSheet(LOG_TAB);
    if (log.getLastRow() === 0) {
      log.appendRow(["זמן", "הקשר", "שגיאה"]);
      log.setFrozenRows(1);
    }
    log.appendRow([new Date(), context, String(err)]);
  } catch (e) { /* nothing else we can do */ }
}

/* RUN THIS ONCE from the editor (Run > testEmail) to authorize "send email"
   and confirm delivery end to end. */
function testEmail() {
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: "בדיקת מייל - MyPrime Feedback",
    body: "אם קיבלת את המייל הזה, שליחת המייל מהסקריפט עובדת. אפשר להמשיך לפריסה מחדש.",
    name: "MyPrime Feedback",
  });
  Logger.log("Sent test email to " + NOTIFY_EMAIL);
}

// Open this deployment's /exec URL in a browser to confirm it's live.
function doGet() {
  return ContentService.createTextOutput("MyPrime feedback endpoint is live.");
}
