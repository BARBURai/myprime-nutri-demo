// קארדקום, ממשק גרסה 11. לפי שני המדריכים ששלחה התמיכה שלהם:
//   שלב 1: LowProfile/Create  יוצר דף תשלום ומחזיר Url
//   שלב 2: LowProfile/GetLpResult  שואל את קארדקום מה באמת קרה בעסקה
//
// CARDCOM_TERMINAL ו-CARDCOM_API_NAME בוורסל, מסומנים Sensitive.
// מסוף הבדיקות של קארדקום הוא 1000, ושם לא מחויב שום כרטיס אמיתי.

const BASE = "https://secure.cardcom.solutions/api/v11";

export function creds() {
  const TerminalNumber = Number(process.env.CARDCOM_TERMINAL);
  const ApiName = process.env.CARDCOM_API_NAME;
  if (!TerminalNumber || !ApiName) return null;
  return { TerminalNumber, ApiName };
}

async function post(path, body, ms = 20000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(`${BASE}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    if (!json) throw new Error(`cardcom ${path} ${r.status} not json`);
    return json;
  } finally {
    clearTimeout(t);
  }
}

// בונה את הבקשה לשלב 1. פונקציה טהורה, כדי שהבדיקות יוכלו לקרוא אותה בלי רשת.
export function buildCreate({ c, product, order, buyer, origin }) {
  const fullName = `${buyer.firstName} ${buyer.lastName}`.trim();
  const biz = buyer.biz && buyer.biz.name && buyer.biz.id ? buyer.biz : null;
  const body = {
    TerminalNumber: c.TerminalNumber,
    ApiName: c.ApiName,
    Operation: "ChargeOnly",
    ReturnValue: order,
    Amount: product.price,
    ISOCoinId: 1,
    Language: "he",
    ProductName: product.name.slice(0, 50),
    SuccessRedirectUrl: `${origin}/done?p=${encodeURIComponent(product.slug)}`,
    FailedRedirectUrl: `${origin}/fail?p=${encodeURIComponent(product.slug)}`,
    WebHookUrl: `${origin}/api/webhook`,
    UIDefinition: {
      CardOwnerNameValue: fullName,
      CardOwnerIdValue: buyer.tz,
      CardOwnerPhoneValue: buyer.phone,
      CardOwnerEmailValue: buyer.email,
      // הטלפון והמייל כבר נמסרו בדף שלנו. השם והת"ז נשארים גלויים, כי בעל
      // הכרטיס יכול להיות מישהו אחר ממי שנרשמת.
      IsHideCardOwnerPhone: true,
      IsHideCardOwnerEmail: true,
    },
    // מספר התשלומים נבחר בדף שלנו, כדי שהיא תראה כמה תשלם בכל חודש לפני
    // שהיא מקלידה כרטיס. הטופס של קארדקום נפתח נעול על המספר הזה.
    AdvancedDefinition: {
      MinNumOfPayments: buyer.payments,
      MaxNumOfPayments: buyer.payments,
      SelectedNumOfPayments: buyer.payments,
    },
    Document: {
      DocumentTypeToCreate: "Auto",
      Name: biz ? biz.name : fullName,
      TaxId: biz ? biz.id : buyer.tz,
      Email: buyer.email,
      Mobile: buyer.phone,
      IsSendByEmail: true,
      Language: "he",
      AdvancedDefinition: { IsAutoCreateUpdateAccount: true },
      Products: [{ Description: product.name, Quantity: 1, UnitCost: product.price }],
    },
  };
  // השדה "אישור קבלת דיוור" של דף 17. המספר שלו בקארדקום עוד לא ידוע, ובלעדיו
  // לא שולחים כלום במקום לשלוח למספר שגוי.
  const fid = Number(process.env.CARDCOM_MKT_FIELD_ID);
  if (fid && buyer.mkt) body.UIDefinition.CustomFields = [{ Id: fid, Value: "מאשרת" }];
  return body;
}

export async function createPage(body) {
  return post("LowProfile/Create", body);
}

export async function getResult(c, LowProfileId) {
  return post("LowProfile/GetLpResult", { ...c, LowProfileId });
}

// העסקה נחשבת שולמה רק אם קארדקום עצמה אומרת את זה, על המסוף שלנו ועל הסכום
// הנכון. דיווח שמגיע לכתובת הדיווח אינו ראיה, כל אחד יכול לשלוח אליה.
export function isPaid(res, c, product) {
  if (!res || res.ResponseCode !== 0) return false;
  if (Number(res.TerminalNumber) !== c.TerminalNumber) return false;
  const t = res.TranzactionInfo;
  if (!t || t.ResponseCode !== 0) return false;
  if (Math.abs(Number(t.Amount) - product.price) > 0.009) return false;
  return true;
}
