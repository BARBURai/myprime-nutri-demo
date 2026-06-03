/* ============================================================================
   MyPrime — beta feedback collector (STANDALONE Google Apps Script Web App)
   v2 — also emails each submission to NOTIFY_EMAIL (in addition to the sheet).

   For a standalone script (created at script.google.com, NOT bound to the
   sheet) we must open the spreadsheet by ID — getActiveSpreadsheet() won't work.

   Setup: see feedback/README.md
   NOTE: v2 adds sending email (MailApp). After pasting this, you must RE-DEPLOY
   and RE-AUTHORIZE the script — Google will ask for an extra "send email"
   permission the first time. Without authorizing, feedback still saves to the
   sheet but no email is sent.
   ========================================================================== */

// The target Google Sheet (from its URL: /spreadsheets/d/<THIS_ID>/edit).
var SHEET_ID = "18sKeB5KMsO9TnQO5iJXmBcAigzgzl7spcOmpwop1aT8";
var TAB_NAME = "Feedback";

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

    // Send an email with the feedback (best-effort — never blocks saving).
    try {
      sendNotification(data, notes, now);
    } catch (mailErr) {
      // swallow — the sheet row already saved; mail failure shouldn't fail the request
    }

    return ContentService.createTextOutput(JSON.stringify({ ok: true, added: notes.length }))
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
  var subject = "משוב חדש מ-MyPrime" + (data.name ? " — " + data.name : "");

  var lines = [];
  lines.push("התקבל משוב חדש מהאפליקציה MyPrime.");
  lines.push("");
  lines.push("שם: " + name);
  lines.push("מכשיר: " + (data.device || "—"));
  lines.push("גרסה: " + (data.version || "—"));
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

// Open this deployment's /exec URL in a browser to confirm it's live.
function doGet() {
  return ContentService.createTextOutput("MyPrime feedback endpoint is live.");
}
