# איסוף משוב מהבטא ל-Google Sheet (סקריפט עצמאי)

מסך "הערות לדמו" (כפתור הבועה) אוסף הערות לפי מסך. כדי שמה שכל אחת כותבת יישלח לגיליון אחד שלך — חבר Google Apps Script Web App. כאן ההוראות לסקריפט **עצמאי** (script.google.com), לא צמוד לגיליון.

## הקמה (פעם אחת)

1. ודא שהגיליון קיים (זה ה-ID שכבר מוגדר בקוד):
   `18sKeB5KMsO9TnQO5iJXmBcAigzgzl7spcOmpwop1aT8`
2. כנס ל-**script.google.com → New project**.
3. מחק את `function myFunction() {}`, הדבק את כל `feedback/Code.gs`, ושמור (אייקון הדיסקט). תן שם לפרויקט, למשל "MyPrime Feedback".
   - ה-`SHEET_ID` כבר ממולא. אם תחליף גיליון בעתיד — עדכן את הקבוע בראש הקובץ.
4. **Deploy → New deployment** → גלגל השיניים → בחר **Web app**:
   - **Execute as:** Me
   - **Who has access:** **Anyone**
   - **Deploy**.
5. **אישור הרשאות** (קורה פעם אחת בסקריפט עצמאי): בחר את חשבון Google שלך → יופיע "Google hasn't verified this app" → **Advanced → Go to <שם הפרויקט> (unsafe)** → **Allow** (זה מאשר לסקריפט לכתוב לגיליונות שלך — תקין, זה הסקריפט שלך).
6. העתק את ה-**Web app URL** (נגמר ב-`/exec`).
7. ב-**Vercel → Settings → Environment Variables**: הוסף `VITE_FEEDBACK_URL` = ה-URL, ועשה **Redeploy**.

## בדיקה
- פתח בדפדפן את ה-URL (ה-`/exec`) — אמור להופיע "MyPrime feedback endpoint is live." (זה `doGet`).
- באפליקציה: כתוב הערה → "שלחי משוב לצוות MyPrime" → בתוך כמה שניות תופיע שורה בלשונית **Feedback** בגיליון.

## כל שורה
התקבל · נשלח · שם · מזהה מכשיר · גרסה · מסך · הערה. (הערה אחת = שורה אחת.)

## הערות
- חובה **Who has access: Anyone** — האפליקציה שולחת בלי התחברות.
- שליחה היא fire-and-forget (no-cors): האפליקציה לא קוראת תשובה, רק מציגה "נשלח, תודה!".
- עדכון קוד בעתיד: ערוך → **Deploy → Manage deployments → Edit (עיפרון) → Version: New version → Deploy**. ה-URL נשאר זהה.
- אם לא הוגדר `VITE_FEEDBACK_URL` — כפתור השליחה לא מופיע, וההעתקה ללוח עדיין עובדת.


## v2 — התראות מייל
מהגרסה הזו, כל משוב נשלח גם למייל שב-`NOTIFY_EMAIL` (כברירת מחדל ron@myprime.co.il), בנוסף לשמירה בגיליון.

**אחרי שמדביקים את Code.gs המעודכן צריך:**
1. Deploy → Manage deployments → ערוך את ה-deployment הקיים (או New deployment) ושמור.
2. בפעם הראשונה Google תבקש הרשאה נוספת לשליחת מייל — מאשרים (Advanced → Go to → Allow).
3. אם לא מאשרים: המשוב עדיין נשמר בגיליון, פשוט לא יישלח מייל.

לשינוי כתובת הנמען: ערכו את השורה `var NOTIFY_EMAIL = "..."` בראש הסקריפט.
