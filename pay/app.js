// הדף עצמו. אותה בדיקת פרטים שהשרת מריץ (lib/buyer.js), כדי שההודעה תופיע
// מיד ולא אחרי סבב לשרת. השרת בודק שוב בכל מקרה.
import { parseBuyer } from "/lib/buyer.js";

const $ = (id) => document.getElementById(id);
const GENERIC = "תקלה טכנית זמנית, נסי שוב בעוד רגע";

const slug = (new URLSearchParams(location.search).get("p") || location.pathname.split("/").filter(Boolean)[0] || "").toLowerCase();
let product = null;

function render(p) {
  document.title = `${p.name} - הרשמה ותשלום`;
  $("title").innerHTML = "";
  p.title.forEach((line, i) => { if (i) $("title").appendChild(document.createElement("br")); $("title").appendChild(document.createTextNode(line)); });
  $("subtitle").textContent = p.subtitle || "";
  $("lineName").textContent = p.name;
  $("linePrice").textContent = `${p.price} ₪`;
  $("total").textContent = `${p.price} ₪`;
  $("intro").textContent = p.intro || "";
  $("introBold").textContent = p.introBold || "";
  $("signoff").textContent = p.signoff || "";
  $("termsLink").href = p.termsUrl;
  const np = $("np");
  np.innerHTML = "";
  for (let n = 1; n <= (p.maxPayments || 1); n++) {
    const o = document.createElement("option"); o.value = n; o.textContent = n; np.appendChild(o);
  }
  updSum();
  const ul = $("bullets");
  ul.innerHTML = "";
  (p.bullets || []).forEach((b) => {
    const li = document.createElement("li"), span = document.createElement("span");
    if (b.b) { const s = document.createElement("b"); s.textContent = b.b; span.appendChild(s); }
    span.appendChild(document.createTextNode(b.t || ""));
    li.appendChild(span); ul.appendChild(li);
  });
}

async function load() {
  try {
    const r = await fetch(`/api/product?p=${encodeURIComponent(slug)}`);
    if (r.status === 404) { $("loading").hidden = true; $("nf").hidden = false; return; }
    if (!r.ok) throw new Error(r.status);
    product = await r.json();
    render(product);
    $("loading").hidden = true;
    $("page").hidden = false;
  } catch {
    $("loading").textContent = GENERIC;
  }
}

// כמו בדף 17: 2 תשלומים ללא ריבית, ומ-3 ומעלה תשלומי קרדיט.
const money = (v) => `${Math.round(v * 100) / 100} ₪`;
function updSum() {
  const n = Number($("np").value) || 1;
  $("sumTotal").textContent = money(product.price);
  $("cnt").textContent = n;
  $("per").textContent = money(product.price / n);
  $("kind").textContent = n >= 3 ? "(תשלומי קרדיט)" : "";
}
$("np").addEventListener("change", updSum);

function collect() {
  const biz = $("bizOn").checked ? { name: $("bn").value, id: $("bid").value } : null;
  return {
    p: slug,
    firstName: $("fn").value, lastName: $("ln").value, phone: $("phone").value,
    email: $("email").value, tz: $("tz").value,
    payments: Number($("np").value) || 1,
    mkt: $("mkt").checked, terms: $("terms").checked, biz,
  };
}

const FORM_IDS = ["fn", "ln", "phone", "email", "tz", "np", "mkt", "terms", "bizOn", "bn", "bid"];
function lockForm(on) {
  FORM_IDS.forEach((id) => { $(id).disabled = on; });
  $("go").hidden = on;
  $("edit").hidden = !on;
}

function showErr(el, msg) { el.textContent = msg; el.hidden = !msg; }

async function openPayment() {
  showErr($("payErr"), "");
  $("retry").hidden = true;
  $("go").disabled = true;
  try {
    const r = await fetch("/api/create", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(collect()) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 400 && j.missing) { showErr($("err"), "כדי להמשיך חסר: " + j.missing.join(", ")); return false; }
    if (!r.ok || !j.url) throw new Error(r.status);
    lockForm(true);
    $("s2").classList.remove("locked");
    $("lockNote").hidden = true;
    $("frame").src = j.url;
    $("frame").hidden = false;
    $("s2").scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  } catch {
    showErr($("err"), GENERIC);
    return false;
  } finally {
    $("go").disabled = false;
  }
}

$("bizOn").addEventListener("change", () => { $("biz").hidden = !$("bizOn").checked; });

$("f").addEventListener("submit", (e) => {
  e.preventDefault();
  const parsed = parseBuyer(collect(), product.maxPayments || 1);
  if (parsed.missing) { showErr($("err"), "כדי להמשיך חסר: " + parsed.missing.join(", ")); return; }
  showErr($("err"), "");
  openPayment();
});

$("edit").addEventListener("click", () => {
  lockForm(false);
  $("frame").hidden = true;
  $("frame").removeAttribute("src");
  $("s2").classList.add("locked");
  $("lockNote").hidden = false;
  showErr($("payErr"), "");
  $("retry").hidden = true;
  $("fn").focus();
});

// fail.html נטען בתוך המסגרת ומודיע לנו. כל ניסיון חוזר יוצר דף תשלום חדש,
// כי דף של קארדקום שנכשל אינו משמש שוב.
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin || !e.data || e.data.type !== "mp-pay-failed") return;
  $("frame").hidden = true;
  $("frame").removeAttribute("src");
  showErr($("payErr"), "התשלום לא עבר. אפשר לנסות שוב, גם עם אמצעי תשלום אחר.");
  $("retry").hidden = false;
});

$("retry").addEventListener("click", () => openPayment());

load();
