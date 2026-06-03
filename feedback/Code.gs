/* ============================================================================
   MyPrime — beta feedback collector (STANDALONE Google Apps Script Web App)

   For a standalone script (created at script.google.com, NOT bound to the
   sheet) we must open the spreadsheet by ID — getActiveSpreadsheet() won't work.

   Setup: see feedback/README.md
   ========================================================================== */

// The target Google Sheet (from its URL: /spreadsheets/d/<THIS_ID>/edit).
var SHEET_ID = "18sKeB5KMsO9TnQO5iJXmBcAigzgzl7spcOmpwop1aT8";
var TAB_NAME = "Feedback";

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
    return ContentService.createTextOutput(JSON.stringify({ ok: true, added: notes.length }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

// Open this deployment's /exec URL in a browser to confirm it's live.
function doGet() {
  return ContentService.createTextOutput("MyPrime feedback endpoint is live.");
}
