# CLAUDE.md

This file provides guidance to Claude (Claude Code and chat) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm run dev        # Start dev server at http://localhost:5173
npm run build      # Build for production (outputs to dist/)
npm run preview    # Preview the production build
```

No test runner is configured.

## Architecture

**Stack:** React 18 + Vite, deployed to Vercel (frontend + serverless functions). UI is Hebrew, right-to-left (`dir="rtl"` in `index.html`), styled entirely with inline styles + a small injected `<style>` block. **Responsive layout:** on desktop it renders as a centered phone mockup (~390×800 card, the `.phone-frame` class); on phones (`max-width: 440px`) it goes full-screen — the frame fills the viewport (`100dvh`, no border/shadow/radius) so the bottom nav bar stays pinned to the bottom of the screen, like a native app. The responsive switch is done with a CSS media query inside the injected `<style>` block (the `.app-outer` / `.phone-frame` classes), since inline styles can't hold media queries.

### Frontend
Nearly all frontend logic lives in a single file: `src/App.jsx` (~1,570 lines). It is a **monolithic** component file — no component library, no state-management framework; everything uses React `useState` / `useEffect` / `useMemo`. `src/main.jsx` just mounts it.

Key sections inside `src/App.jsx` (top to bottom):
- **DOMAIN** — pure nutrition logic: `computeTargets` (Mifflin-St Jeor BMR for women, TDEE, deficit, protein/fat/carb targets), `projection`, `nutritionFor`, `programWeekFor`, `programDayNumber`, `unlockedOn`, `streakDays`.
- **SEED DATA** — `FOODS` (Israeli staples, per-100g macros), `RECIPES`, `MEALS`, `INITIAL_LOG`, `makeWeightSeed`.
- **THEME** — the `C` color object (feminine rose palette) and `fontStack` (Rubik). `VERSION` constant lives here.
- **PRIMITIVES** — `Ring`, `MacroCard`, `MacroRow`, `WaterCard`, `Btn`, `Header`, `Stepper`.
- **ONBOARDING** — `Onboarding`.
- **SCREENS** — `DayScreen` (the "today" home screen), `ReportScreen` (weight + calorie-adherence charts), `RecipesScreen`, `ProfileScreen`.
- **AI FUNCTIONS** — `analyzeMeal` (photo → items), `aiNutritionChat` (logging-by-chat), `aiMealChat` ("what should I eat?" conversational helper), `searchIsraeliDB`.
- **MODALS / SHEETS** — `EntryMenu`, `SheetShell`, `ActivityModal`, `WeightModal`, `CalorieGoalModal`, `AccessGate`, `AddModal`, `RecommendModal`, `StreakCheer`, `IntroOverlay`, `NotesFab`.
- **ROOT** — `export default function App()` (near the bottom): all state, persistence, and wiring of screens + modals.

### Navigation (bottom bar)
The bottom nav bar holds four tabs (`tabs` array: היום / דוח / מתכונים / פרופיל) split two-and-two around a **raised circular "+" action button** in the center. The "+" is the brand-gradient circle (class `fab-center`, a gentle float + glow animation) and opens the entry menu (`setSheet("menu")`). It is part of the bar and persistent across all tabs. All sheets/modals render as full-screen overlays (`position: absolute; inset: 0`) above the bar, so the "+" never collides with them.

### Persistence
State is saved to `localStorage` under the key `myprime_demo_state_v1` (profile, log, weights, activityLog, waterByDate). A device id is stored separately as `myprime_device_id`.

### Feature unlock system (time-gated)
Trackers are gated by program week, computed from `profile.startDate`:
- `MACRO_UNLOCK = { week: 3, day: 4 }` — nutrition macros (protein/fat/carbs/fiber).
- `WATER_UNLOCK = { week: 3, day: 2 }` — water tracker.
- `unlockedOn(startDate, onDate, u)` decides whether a tracker is open on a given date.

**Product rule:** before a tracker's week, it must **not appear at all** — not shown as "locked", just absent from the screen. Protein focus / macros are only relevant **from week 3**. The whole codebase follows this single rule (hidden before week 3, never "locked"). The previous leftover `PROTEIN_UNLOCK_WEEK = 2` constant and the "locked" mode in `MacroCard` (text "ייפתח בשבוע 2") were removed in v0.23. This rule also applies in `ProfileScreen`: the macro row (protein/fat/carbs) is gated by `programWeekFor(startDate, TODAY) >= MACRO_UNLOCK.week` (v0.28) — only the daily calorie target shows before week 3. The day strip marks the current day with a different-shade top band labeled "היום" (so the header no longer prefixes "היום"). `ProfileScreen` shows the real name via a `userName` prop (`profile.name || gateName`), not the "משתמשת" placeholder.

### Android back button
The root `App` intercepts the hardware/gesture back button (Samsung/Android) via the History API: on mount it pushes a synthetic history state and listens for `popstate`. A back press first closes an open sheet/modal; if none is open it shows an exit-confirm overlay (`showExit`) with "להישאר" / "לצאת". "להישאר" dismisses it; "לצאת" sets a guard and calls `history.go(-2)` to leave (a browser tab/PWA can't be force-closed by JS, so on a standalone PWA the OS performs the actual close at the history root). Sheets/modals are tracked through refs (`modalRef` / `sheetRef` / `exitRef`) so the single mount-time listener always reads current state.

### Chat inputs
Both AI chats — the meal-logging chat in `AddModal` (step `"ai"`) and `RecommendModal` ("מה כדאי לאכול") — use an auto-growing `<textarea>` (not a single-line input) so long dictated/typed text stays visible (grows up to ~96px, then scrolls). Enter sends, Shift+Enter inserts a newline. Both message lists auto-scroll to the latest message via an end-anchor ref + `scrollIntoView`.

### Diet style & sensitivities
Collected during onboarding (step 2, "איך את אוכלת?") and editable later in `ProfileScreen`. Two **separate** concepts, intentionally not mixed:
- `profile.diet` (array of ids from `DIET_OPTIONS`, objects `{id, emoji}`: הכל / צמחוני / טבעוני / כשר / דל פחמימה / ים-תיכוני) — a *style* preference, shown as selectable emoji circles in onboarding.
- `profile.allergies` (array from `SENSITIVITY_OPTIONS`: גלוטן / חלב-לקטוז / ביצים / אגוזים / בוטנים / סויה / דגים / שומשום) plus `profile.dislikes` (free text "other") — things to *avoid*.

These feed the AI suggestion chat (`RecommendModal`): the seed prompt lists the diet style and, critically, injects allergies+dislikes as a **hard "never suggest" rule** (not a soft preference). **Safety stance:** this is best-effort risk reduction, never a guarantee — an onboarding + profile disclaimer makes clear the app is a coaching aid, not a medical allergy-safety tool, and the user must verify ingredients herself. Do not position the app as "safe for allergies." Existing stored profiles may predate `allergies`, so always read it defensively (`profile.allergies || []`). As of v0.33, `RecommendModal` opens with a **confirm stage**: it shows the diet style + sensitivities (editable inline, persisted to the profile via `setProfile`; "none recorded" hint when empty), and only on "קבלי המלצות" builds the seed and starts the chat — a double-check that reduces wrong-context errors. When sensitivities exist, the seed instructs the assistant to always end with a gentle reminder to verify the full ingredient list, and the confirm stage shows the same caution. As of v0.35 there is **no human-handoff path anywhere** in the app (testers use their program group, not the app): the "talk to someone" quick-reply was removed and the `aiMealChat` prompt now explicitly instructs the assistant not to offer human contact or forward requests; the QA harness verifies that offering human contact is a failure. `ActivityModal` (v0.34) computes burned calories with the MET formula `MET × 3.5 × weightKg ÷ 200 × minutes` — a chosen activity's MET (or a custom "אחר" intensity) × a minutes stepper × the user's body weight, instead of fixed presets. As of v0.36: (1) each meal suggestion includes an inline estimate — kcal + protein/fat/carbs from week 3, kcal-only before week 3 (`estimateRule`, gated by `proteinFocus`, synced in the QA harness); (2) when the user states a new preference/dislike/sensitivity mid-chat, `extractPreferences()` (a small AI call to `/api/ai`) detects it and `RecommendModal` shows a "save to your preferences?" banner — on confirm, diet styles → `profile.diet`, known sensitivities → `profile.allergies`, the rest → appended to `profile.dislikes` (persisted). **Persistence note:** the profile lives in `localStorage` (per device/browser); chat history is ephemeral and is *not* persisted, which is why only saved-to-profile preferences survive across sessions, and why a new device starts fresh (gate + onboarding) — true cross-device sync would require server-side profile storage. As of v0.41, committing food entries upserts them into a persisted `favorites` list (per-100g derived from the logged item, deduped by name, newest first, capped 20); the AddModal search step's "אחרונים/האחרונים שלך" section renders real favorites (falling back to the demo `RECENT` only when empty) for one-tap re-adding at the last-used quantity. As of v0.42, when macros unlock (week 3), the day view shows the calorie `Ring` and a matching `ProteinRing` (same style, `C.macroP` color, positive "reached goal" semantics) side by side, with a small one-line fat/carbs/fiber summary beneath — replacing the previous four `MacroCard`s. As of v0.43, future days in the day strip (`d > TODAY`) are disabled and dimmed (opacity 0.4, not clickable); each day becomes fillable once its date arrives. As of v0.44 the root keeps a reactive `today` (a 60s interval re-checks `ymd(new Date())`), passed to `DayScreen`, so the next day unlocks automatically at midnight without a reload (and the view advances if it was on the old today). As of v0.45: `macroP` is a distinct teal (`#2F9E8F`) so the protein ring no longer matches the pink calorie ring; each ring carries a **bold macro name inside it** (`קלוריות` in brand color / `חלבון` in teal) plus the remaining number and a small `מתוך {target}` line; the redundant "יעד/נאכל" sub-line was removed; and fat/carbs/fiber now render as a **compact 2-row table** (label row / value row, thin column dividers) directly beneath the rings, kept short so it doesn't push content down. As of v0.46, `PRIVACY_URL`/`COOKIE_URL` default to the real MyPrime policy pages and both are linked in the onboarding consent and the AccessGate note; `resetDemo` now also resets the access gate (`setGate("form")`, clears name/email, removes `myprime_access_email`) so "restart demo" returns to the name+email screen instead of skipping straight to onboarding. As of v0.47, the AddModal search step (`step === "list"`) is split into two tabs — **"חיפוש"** (the search box + local/`il`/OFF results) and **"אחרונים"** (the favorites/recents history) — with the meal-target chips shared above both; `listTab` defaults to history when favorites exist, else search. Note: search still queries the Israeli national DB first (`/api/il-food`) and only falls back to OFF when it returns nothing; that dataset (data.gov.il `nutrition-database` = the MoH "צמרת" DB, ~4,500 foods) is published as downloadable CSV (last updated 2022), not a live datastore, so `datastore_search` returns empty. As of v0.48, `api/il-food.js` was rewritten to **download the CSV resource(s) directly, decode (utf-8/windows-1255), parse, and cache them in module scope**, then substring-search the Hebrew names (the existing `normalize()` already targets the real צמרת column codes `shmmitzrach`/`food_energy`/`protein`/`total_fat`/`carbohydrates`, with Hebrew-substring fallback). It still tries `datastore_search` first. This runs on Vercel's open network (the sandbox can't reach data.gov.il, so it was NOT testable here). **Open task: verify on the deployed site** — hit `/api/il-food?q=חומוס&debug=1`, which returns the resource list + CSV headers + parsed count; if the field mapping is off, adjust `normalize()` keys from those headers. Also v0.48: the onboarding final step shows MyPrime's legal disclosure ("מיי פריים ה.ד.ס בע"מ … אינה אוספת מידע אישי …", cookie-policy + privacy-policy usage clauses) with both policy links. As of v0.49, the v0.47 in-search tabs were removed: the **"חיפוש מזון" method screen is search-only**, and recents/favorites became their **own bottom entry in the method chooser** ("האחרונים והמועדפים שלי", `Clock` icon → `step === "history"`), positioned last as the lowest-priority option; the qty screen's back button returns to its origin step (`qtyOrigin`). Also v0.49: the meal-suggestion prompt (`aiMealChat`, mirrored in the QA harness) now instructs the assistant to base nutrition estimates on the Israeli national DB ("צמרת") values for Israeli foods — prompt-level grounding (the *logging* path already reconciles named items against `/api/il-food` via `reconcileWithDb`, so logged foods use real Israeli DB values now that the endpoint works). As of v0.50: the bottom nav bar is tinted (`C.brandBg` as of v0.51, up from a too-faint `C.bg`) with a soft top shadow so it reads as a bar; and `RecommendModal` ("מה כדאי לאכול?") gained an always-available **"אכלתי — הוסיפי ליומן"** button on each suggestion — it opens a `"log"` sub-stage that runs `aiNutritionChat` (asks clarifying questions if needed, e.g. which idea / how much), and once it returns items shows them + meal chips + a confirm that calls `onLog` (= root `commit`, which logs **and** upserts favorites/recents). `RecommendModal` now takes an `onLog` prop.

### Backend (Vercel serverless functions in `api/`)
- `api/ai.js` — proxy to the Anthropic Messages API. Requires env var `ANTHROPIC_API_KEY`; optional `AI_MODEL` (defaults to a current Sonnet model). The frontend calls it via `AI_ENDPOINT` (`/api/ai`, overridable with `VITE_AI_ENDPOINT`). The proxy overrides the model server-side, so the model string sent from the client is not authoritative.
- `api/access.js` — access gate: checks an email against the program participant list (`ACCESS_ENDPOINT` / `/api/access`).
- `api/il-food.js` — Israeli food database lookup (`/api/il-food?q=...`); downloads + caches the MoH "צמרת" CSV from data.gov.il and substring-searches names (datastore fast-path + `?debug=1` diagnostic). See the v0.48 note above.

Barcode scanning (in `AddModal`) — as of v0.38 — opens the rear camera once (`getUserMedia`, ideal 1920×1080, best-effort `focusMode: continuous`) and runs **two decoders in parallel on the same `<video>`**: native `BarcodeDetector` (only if `getSupportedFormats()` returns a non-empty list — some devices expose the class but support nothing) via a `requestAnimationFrame` `detect()` loop, **and** `@zxing/browser`'s `decodeFromVideoElement` with retail format hints + `TRY_HARDER`. First engine to read a code wins (`onCode` is guarded + idempotent). A dimmed aiming frame with a center line overlays the video. `stopScan` runs a stored cleanup (rAF loop, ZXing controls, camera tracks). A successful scan looks the code up on Open Food Facts; manual numeric entry is available both before scanning and via "להקליד מספר ידנית" during scanning. **Open Food Facts is a global, crowd-sourced DB** — many Israeli products have English/partial names or aren't listed, so (v0.39) `lookupBarcode` prefers Hebrew fields (`product_name_he` → `generic_name_he` → `product_name` → …) and the qty step shows an **editable name field for barcode items** (`food.id` starting `bc_`) so the user can correct an English/wrong name before adding. There is no good free Israeli barcode→nutrition API; the Israeli DB (`/api/il-food`) is name-search only. **FoodsDictionary was contacted and confirmed they do not offer an API** — so the interim stack (Open Food Facts barcode + editable name + label-photo fallback + `/api/il-food` name search) stands; do not re-propose FoodsDictionary as a data source. As of v0.40, when a scanned barcode isn't found, the "notfound" state offers a **"צלמי את התווית התזונתית"** button (camera `capture`) that routes the photo through `onPhoto → sendAiImage` so the AI reads the values straight off the nutrition label — the accurate fallback for products missing from Open Food Facts. (v0.29 `decodeFromConstraints` then v0.31 single-engine BarcodeDetector failed to detect on the target Samsung device — hence the parallel rewrite; coverage/detection still varies with camera focus and product listing.) Note: photo analysis (`analyzeMeal`) only *estimates* nutrition from appearance and is unreliable for packaged products — the barcode is the accurate path for those. As of v0.29 the photo prompt also reads an on-package nutrition label when one is visible. **Photo flow internals:** the live path is `onPhoto → sendAiImage → aiNutritionChat` (image sent into the logging chat); the standalone `analyzeMeal()` function exists but is **unused** (dead code). The photo step (v0.37) offers two explicit inputs — "צלמי עכשיו" (`capture="environment"`, opens the camera) and "העלי תמונה מהגלריה" (no `capture`), both calling `onPhoto`. v0.30 adds a **hybrid reconciliation**: after the AI identifies items (photo or text logging), `reconcileWithDb()` searches the product DBs (`searchIsraeliDB` + `searchOpenFoodFacts`) by item name and, only on a **strong** name match (`strongMatch`), replaces the AI's estimated values with the DB's real per-100g values scaled to the item's grams, tagging the item `source:"db"` (badge "מהמאגר") vs `source:"estimated"` (badge "מוערך", via `SrcBadge`). Name search is fuzzier than a barcode (no unique id), so unmatched items keep the estimate; the barcode remains the accurate path for packaged products. As of v0.31 the logging prompt (`aiNutritionChat`) also asks about typical accompaniments (e.g. oats/cereal → milk/yogurt + which kind; coffee → milk/sugar) and returns each component as a separate item, so the whole thing is logged at once.

The AI features only work when deployed (or with the functions running), since they depend on `/api/*`. In a plain local `npm run dev` they may not respond — that is expected.

### Beta feedback (`feedback/`)The notes panel (`NotesFab`, "הערות לדמו") lets testers jot screen-tagged notes. As of v0.32, when `VITE_FEEDBACK_URL` is set it shows a "שלחי משוב לצוות MyPrime" button that POSTs all notes (with device id, app version, tester name, timestamp, per-note screen) to a Google Apps Script web app, which appends one row per note to a "Feedback" sheet. The POST uses `mode:"no-cors"` + `text/plain` (fire-and-forget, avoids CORS preflight). `feedback/Code.gs` is the Apps Script; `feedback/README.md` has the one-time setup (create Sheet → Apps Script → deploy as web app "Anyone" → set `VITE_FEEDBACK_URL` in Vercel → redeploy). Clipboard copy remains as a fallback when no URL is configured.

### Testing / QA (`qa/`)
`qa/run-qa.mjs` is a standalone Node (18+) harness that evaluates the **AI layer only**. It generates a broad scenario matrix (adversarial allergy/diet baits, neutral suggestion-with-allergy, suggestions across profiles, the week-3 protein-gating rule, safety/extreme + medical-condition requests, brand-voice/no-shaming probes, verifying NO human-handoff is offered, off-topic, and meal-logging format/accuracy — ~83 text scenarios) plus optional meal-photo tests driven by `qa/images/manifest.json` (user supplies real plate photos + ground truth; analyzed via the verbatim `analyzeMeal` prompt, checked for expected items + plausible total kcal), runs each through the **same prompts the app uses** (the `aiMealChat`/`aiNutritionChat`/`analyzeMeal` strings and the RecommendModal seed are copied verbatim — `KEEP IN SYNC` if those change in `App.jsx`), then grades each answer with an LLM rubric plus an independent allergen keyword heuristic and rule-based logging/photo-JSON checks. It writes `qa/report.html` + `qa/results.json`. Run with `QA_BASE_URL="https://<app>.vercel.app" node qa/run-qa.mjs` (hits the deployed `/api/ai`, no key needed) or `ANTHROPIC_API_KEY=... node qa/run-qa.mjs`. See `qa/README.md`. This does **not** cover product-data accuracy (FOODS vs ground truth) or functional/device testing, and LLM grading is fallible — human-review all critical fails. There is still no automated test runner for the app itself.

## Working rules (owner preferences — important)

- **Never hand back patches or code snippets.** For every change, deliver a complete, ready-to-paste `src/App.jsx` **and** a zip. Never "replace this line" or partial diffs. The owner does not edit code by hand.
- **ZIP FILENAME (owner request, v1.30): name the zip `nutri-v<version-without-dots>.zip`** - e.g. v1.30 -> `nutri-v130.zip`, v1.31 -> `nutri-v131.zip`. Do NOT name it "handoff" (that name is reserved for the full-project snapshot the owner builds to start a new chat; our delivery zip is changed-files-only).
- **ALWAYS deliver BOTH a zip AND the individual changed files, every time (owner request, v1.01).** The owner uploads from both computer (zip is convenient there) and phone (zip downloads/extracts poorly on mobile, so the standalone files are needed). So every delivery `present_files` must include: the zip, plus each changed file on its own (e.g. `App.jsx`, `CLAUDE.md`). Do not send only the zip.
- **ZIP = CHANGED FILES ONLY, PATHS RELATIVE TO THE REPO ROOT (owner request, from v0.76; path fix v0.79).** The zip must contain ONLY the files/folders that changed since the previously delivered version, and their paths must be **relative to the repo root** - i.e. `src/App.jsx`, `CLAUDE.md`, `api/usda.js` - **NOT** wrapped in a `myprime-nutrition-demo/` top folder. The repo IS that folder, so a wrapper makes GitHub double-nest (`myprime-nutrition-demo/src/App.jsx` inside the repo) and the folder-drag fails. Build it by `cd` into the project dir and zipping the relative paths (e.g. `cd .../myprime-nutrition-demo && zip out.zip src/App.jsx CLAUDE.md`). Do NOT include unchanged heavy folders - especially `public/` (~2MB). Most turns this is just `src/App.jsx` (+ `CLAUDE.md`; `api/*.js`/`feedback/Code.gs` only when they change). Still deliver the standalone `src/App.jsx` alongside the zip, state the version, and say which files to re-upload.
- **Bump `VERSION` by 0.01 on every change**, and **state the new version number in the chat reply** (the owner tracks versions; it also shows in the UI). Current version: `2.05`.
- **Preserve the existing structure**, variable/component names, and writing style. Change only what the request needs.
- **Brand voice (Anat Harel):** warm, personal, conversational — "a friend talking, not a marketer selling." No marketing-speak. Applies to all user-facing Hebrew copy.
- **Program logic:** protein and trackers (nutrition/water) are relevant only **from week 3**. Before that they do not appear at all (not locked, not "opens in week X").
- **QA is MANDATORY, not optional (owner directive).** The owner is the ONLY tester (no QA team), tests by hand in the browser on the live site. Keep the test list simple and doable solo - it lives in `qa/QA-CHECKLIST.md` (plain Hebrew, click-through). Rule: any change touching user input, a safety guardrail (weight blocks, calorie floor, sensitivities/allergies), or an AI prompt must be checked. Two moments: (1) after delivering such a change - the owner re-checks just the part that changed; (2) one full pass through the whole list before letting any real user in (incl. sending the link to dietitians) and especially before turning it into the native app, on a phone and on a computer. The `qa/run-qa.mjs` AI harness exists but requires Node/terminal, so it is OPTIONAL for the owner - do not present it as a required step; offer to walk through it only before a big release if asked. **Automatic logic check:** `qa/check-logic.mjs` is a no-network/no-browser Node script that asserts the guardrail RULES (weight blocks keep BMI>=18.5, calorie floor 1200, no 750 rate, water never negative, water legacy migration). Claude RUNS THIS ITSELF every version that touches a guardrail and reports pass/fail - the owner does nothing. It mirrors the rule fns/consts from App.jsx (keep in sync). It checks logic/math, NOT visual rendering - the only thing left for the owner is a short eyeball on the live site before sharing.

## How we work (process - agreed with owner v0.94, IMPORTANT)
Learned the hard way: running to code before locking the spec caused back-and-forth, wrong builds, and patch-on-patch. Default to clarify-first.
- **New feature, or any change with more than one reasonable way to do it:** do NOT code yet. First send a short plan in chat - what it does exactly, the rules (what counts as done, what triggers what), the edge cases (e.g. backfill, Saturday, week boundaries), and where it lives. If it is visual, include a mockup. Wait for the owner's explicit "go" before touching code.
- **Multi-point feedback in one message:** reflect it back as a numbered list with the proposed approach per item, flag the items that need an owner decision, get confirmation, THEN build them all in ONE clean version. No partial patches across several replies.
- **Tiny, unambiguous fixes** (a color, a text string, a size, a label): just do them, no need to ask.
- **One clean version per agreed round.** Batch decisions; avoid a long tail of micro-versions.
- **Lock data/logic rules in words before coding them** (definitions of "completed", what earns a reward, how past-day edits behave). Most churn came from coding a rule before agreeing on it.
- **Periodic cleanup:** remove dead/unused code left from iterations (no leftover patches) so the app stays clean.

## v0.53 — Recipe booklet (29 real MyPrime recipes)
The "מתכונים" tab now renders the real MyPrime recipe booklet instead of placeholder data.
- Recipe data lives in `src/recipes.js` (`export const RECIPES`), imported by `App.jsx`. Each recipe: `{id,page,name,img,prep,diff,servings,kcal,p,f,c,ing[],steps[],tips[]}`. Ingredient lines ending with ":" render as sub-headers. kcal/p/f/c are per serving (range midpoints) for logging. Hebrew copy is transcribed faithfully from the official PDF — do not alter without instruction.
- Photos: `public/recipes/<page>.jpg` (4..32), extracted from the booklet PDF with `pdfimages` (largest portrait image per page), resized to max width 900 / JPEG q82 (~2.1MB total). Vite serves them at `/recipes/<page>.jpg`.
- `RecipesScreen`: search box + filter chips (הכל / עתיר חלבון [p>=25] / דל פחמימות [c<=12]) + photo cards; tapping a card opens `RecipeDetail` (hero photo, prep/servings/difficulty chips, 4-stat nutrition strip, "הוסיפי מנה ליומן", ingredients with sub-headers, numbered steps, tips). Card "+" and detail button call `addRecipe`.
- `addRecipe(r)` logs a serving (g:1, source "verified", explicit kcal/p/f/c) to `selectedDate` with a time-based meal; no longer force-switches to the day tab (screen shows a "נוסף ליומן" toast/confirmation instead).
- To add/replace recipe images later: drop files in `public/recipes/` (GitHub), Vercel serves them.

## v0.55 — Sweets tab + protein color
- Protein color changed from teal (#2F9E8F) to strong purple `macroP:#7E4FB5`; added `proteinTrack:#EBE1F7` (soft purple) used as the ProteinRing track (was C.line). Recipe-card protein badge updated to the purple palette. Carbs stays mauve #A87BB5 (distinct).
- New desserts feature "הפינה המתוקה": data in `src/sweets.js` (`export const SWEETS`, 12 items, same shape as recipes), photos in `public/sweets/<page>.jpg` (pages 3..14, extracted from the desserts PDF via pdfimages, largest portrait per page; page 9 grabbed manually — its photo is 1.44 ratio). Hebrew copy transcribed faithfully.
- `RecipesScreen` generalized: now takes `items`/`title`/`subtitle` (default = RECIPES / "מתכונים"). Reused for sweets via `<RecipesScreen items={SWEETS} title="מתוקים" ... />`. `RecipeDetail` reused as-is.
- Gating: `SWEETS_UNLOCK = { week: 3, day: 5 }` (program day 19). The "מתוקים" tab is conditionally added to `tabs` only when `unlockedOn(startDate, TODAY, SWEETS_UNLOCK)` — i.e. it does NOT appear at all before week 3 day 5 (no locked teaser), per Ron's request. Tab icon: Cookie. With 5 tabs the nav splits 2 (day, report) + FAB + 3 (recipes, sweets, profile).
- To add/replace sweet images: drop files in `public/sweets/` (GitHub) → Vercel serves at `/sweets/<page>.jpg`.

## v0.56 — Recipe logging fix + category filters
- BUG FIX: recipes/sweets were logged as `g:1` with per-serving kcal, so the gram-based edit modal recomputed per100 = kcal*100 → astronomical values at 100 g. Recipe/sweet entries are now SERVING-based: `{ unit:"serving", servings, base:{kcal,p,f,c}, kcal/p/f/c = base*servings }`. Day totals already sum `e.kcal` (correct); editing now scales by servings, not grams. (Old g:1 recipe entries in localStorage still mis-edit — reset/delete them.)
- New `RecipeAddModal` (SheetShell): opens on recipe "+" / "הוסיפי מנה ליומן" (add) and when tapping a serving entry in the journal (edit). Shows recipe name, meal chips, a servings stepper (step 0.5, min 0.5, default 1), a live 4-stat nutrition strip (base×servings), and "הוסף ליומן"/"עדכן" (+ "מחק פריט" when editing). PDF nutrition is per serving; the modal multiplies by the chosen number of servings.
- Root wiring: `addRecipe(r) → setModal({kind:"recipe", recipe:r})`; `editEntry(e) → kind "recipe" if e.unit==="serving" else "food"`; `saveRecipe(payload, editId)` updates or appends (does NOT touch favorites). Modal render branches recipe vs AddModal. Day entry row shows "{servings} מנה/מנות" for serving entries.
- Recipe/sweet filter chips changed from עתיר חלבון/דל פחמימות to NUTRITION CATEGORIES, derived dynamically from each item's new `cat` field (horizontal-scroll chips). Recipe cats: שייקים, ארוחות בוקר, מנות ראשונות, סלטים, מרקים, מנות עיקריות. Sweet cats: פנקייקים, מוסים ופודינג, עוגות, חטיפים, עוגיות וכדורים. `cat` lives in recipes.js/sweets.js.

## v0.57 — + menu / method chooser / onboarding consent
- The "+" menu (EntryMenu) already contains only מזון/פעילות/מים (no weight/calorie items); weight + daily-calorie editing live in ProfileScreen (משקל row + יעד קלורי block). Confirmed — no change needed there. (Dead WeightModal/CalorieGoalModal + onPickEntry weight/calorie cases remain, harmless.)
- AddModal method chooser ("הוספת מזון") reordered: 1) ספרי לי מה אכלת (AI), 2) צילום ארוחה, 3) סריקת ברקוד (removed "מומלץ" tag), 4) האחרונים והמועדפים שלי, 5) חיפוש מזון (last). Restyled: each row a soft tinted background with a prominent 46px colored icon chip (white icon). Tints: AI=info, photo=amber, barcode=brand, recent=water, search=green(#E8F3EC/#4E9E76). Kept "חדש"/"מהיר" tags (now white chip w/ row color). NOTE: first-item assumption was AI — easy to swap if Ron meant another.
- Onboarding consent: moved the "קראתי ואני מאשרת…" line + checkbox to the END (below the legal paragraph, above "בואי נתחיל", with a top divider). De-duplicated policy links — they now appear ONLY in the consent line; the long legal paragraph is plain text (no <a> links). (The separate privacy/cookie link pair in the food-add footer is unrelated and left as-is.)

## v0.58 — Sweets as a top toggle inside Recipes (not a bottom-nav tab)
- Reverted the bottom-nav "מתוקים" tab from v0.55. The bottom nav is back to 4 tabs (day, report, recipes, profile).
- Sweets now live INSIDE the Recipes screen as a top segmented toggle: "מתכונים | מתוקים" (pill segmented control, panel bg on active). RecipesScreen takes `sweetsOpen` and manages an internal `section` state ("recipes"/"sweets") switching dataset (RECIPES/SWEETS), subtitle, search placeholder, and category chips.
- The "מתוקים" segment only renders when `sweetsOpen` (week 3 day 5 / program day 19). When it appears it shows a small "חדש" badge; the badge disappears once the user taps the מתוקים segment (local `seenSweets` state). Icons: ChefHat / Cookie.
- RecipesScreen no longer takes items/title/subtitle props; it is self-contained. Rendered once: `<RecipesScreen addRecipe={addRecipe} sweetsOpen={sweetsOpen} />`.

## v0.59 — Profile as a draft form + feminine wording + report graph clarity
- All copy now feminine-only ("את כעת בשבוע X בתוכנית" — removed "את/ה"). App audience is women only.
- ProfileScreen is now a DRAFT form: a local `draft` mirrors profile; every field/chip/dislikes/calorie edit updates `draft`, NOT the live profile. `dirty = JSON.stringify(draft)!==JSON.stringify(profile)`. A prominent "שמור שינויים" button appears ONLY when dirty — placed high (right under the "שבוע X" line) AND again above the reset button — and only on click does `setProfile(draft)` commit. The old always-present (dead, no-onClick) bottom save button was removed.
- Moved the daily-calorie target + macros (protein/fat/carbs) block UP to directly under the "את כעת בשבוע X" line. MacroRow now lives inside that brandBg card (shown from week 3).
- Report weight graph: added caption "המשקל שהזנת בפועל לאורך זמן (לא תחזית)" to make explicit it is ACTUAL logged weight, not a projection/target.
- NOTE (answered, no code change): editing weight in Profile sets the baseline used for targets/projection only; it does NOT add a dated point to the report's actual-weight graph (that graph reflects weights logged via "+ הזיני משקל היום"). If Ron wants a Profile weight-save to also drop a dated measurement on the report graph, that's a separate wiring change (ProfileScreen would need an addWeight callback).

## OPEN — to work on next session (saved, not yet implemented)
### 1. Weight model rework (analysis done v0.59 turn)
Two unsynced sources: `profile.weightKg` (baseline → computeTargets) vs `weights[]` (report graph). Problems: editing profile weight doesn't touch the graph & vice-versa (two different "current weight"); graph is SEEDED with fabricated 24-day loss history (makeWeightSeed); "+ הזיני משקל היום" auto-logs `last-0.2` instead of asking (the real WeightModal is now orphaned — sheet "weight" no longer reachable); addWeightValue logs to selectedDate not necessarily today; report "Adaptive TDEE" is derived (tdee±40). Direction to decide: single source of truth (weights[] = log; current = last; profile.weightKg derived/synced); profile weight-save = log a dated measurement + update baseline; drop fabricated seed (start from one onboarding point); make "הזיני משקל היום" open WeightModal (ask a value).

### 2. Food-data accuracy — web-grounded nutrition (NEW, Ron flagged)
Symptom: AI-estimated values are unrealistically low (e.g. grilled entrecote kcal/100g too low; Google AI overview shows ~260–350 kcal/100g, citing fuder.co.il / FoodsDictionary). Root cause: `api/ai.js` is a bare proxy to Anthropic Messages with NO tools — nutrition estimates come purely from model priors (no grounding); the "חיפוש מזון" path uses צמרת CSV (2022) + Open Food Facts, where a cut like "אנטריקוט" may be a lean/raw entry → reads low. Fix direction (feasible): enable Anthropic server-side `web_search` tool in the AI-estimation path (aiNutritionChat) so the model grounds values in the web like Gemini does; prompt it to prefer authoritative sources (USDA FoodData Central, משרד הבריאות/צמרת, FoodsDictionary, fuder), return per-100g + range + note cut/prep. Considerations: latency+cost (only on the AI path, add caching per food); don't hard-scrape one site (ToS) — let the model search & weigh sources; keep the exact barcode/DB path for packaged items, use web grounding mainly for cooked/restaurant dishes.

## v0.60 — Steps tracking (manual now, auto-ready for the app stage)
- New metric: daily steps with a goal. Data: `profile.stepGoal` (default 8000, in DEFAULT_PROFILE + onboarding draft, read defensively `|| 8000`) and `stepsByDate{date:count}` (persisted in localStorage, reset in resetDemo). Single source/getter pattern: UI reads `stepsByDate[date]`; `setStepsForDate(date,n)` writes. Future auto-sync (HealthKit/Health Connect) will write to the same store — UI unchanged. A disabled "התחברות לאפליקציית הבריאות · זמין באפליקציה" button sits in StepsModal as the placeholder slot.
- Gating: `STEPS_UNLOCK = { week: 1, day: 2 }` (program day 2). Card/menu/graph appear from then.
- Calories: steps ADD to the daily calorie budget like activity. `stepsKcal(steps, weightKg) = round(steps * 0.00055 * weightKg)` (~0.04 kcal/step at 70kg; ~317 kcal for 8000 @72kg). DayScreen `budget = dailyTarget + actKcal + stepKcal`. Double-count handling: steps cover everyday walking; "פעילות גופנית" is for dedicated workouts (StepsCard notes the budget bump). Coefficient 0.00055 easy to tune.
- UI: `StepsCard` (progress bar, steps/goal, +kcal, tap-to-edit) on the Day screen (before WaterCard); a steps BarChart (14 days, goal ReferenceLine, bars colored brand when ≥goal else proteinTrack) on the Report screen with "+ עדכון צעדים להיום"; `StepsModal` sheet (Stepper step 250, live kcal preview) opened from the card, the report button, and a new "עדכון צעדים" item in the "+" menu (EntryMenu gated by `stepsOpen`). Goal set in Profile (Footprints row, Mini stepper step 500, in the draft form — saved with "שמור שינויים").
- Icons: Footprints. Components are self-contained (StepsCard/StepsModal); no patches.

## v0.61 — USDA FoodData Central as a generic-food data layer
- New serverless proxy `api/usda.js` → FDC `foods/search`. Reads per-100g nutrients 208(kcal)/203(protein)/204(fat)/205(carbs), prefers generic data types (Foundation > SR Legacy > Survey FNDDS > Branded), returns `{items:[{name,brand,dataType,kcal,p,f,c}]}`. Supports `?debug=1`. **Needs a free `USDA_API_KEY` in Vercel env** (https://fdc.nal.usda.gov/api-key-signup.html); falls back to DEMO_KEY (rate-limited).
- Client: `searchUSDA(q)` (English query) + `translateFoodToEnglish(q)` (tiny AI call, Hebrew→short English term).
- AI logging path (the main accuracy win): `aiNutritionChat` prompt now asks for an English `en` query per item; parsed items carry `en`. `lookupProduct(name, en)` priority = Israeli DB (Hebrew) → USDA (en) → Open Food Facts; `reconcileWithDb` tags source `"db"`/`"usda"` and scales per-100g by grams. So generic cooked foods ("steak", "rice", …) now get real USDA values instead of the model's guess.
- Manual search ("חיפוש מזון"): USDA added as a fallback — if צמרת and OFF both return nothing, translate the Hebrew query to English and query USDA (source label "USDA FoodData Central · ערכים גנריים").
- SrcBadge: added a blue "USDA" badge (#EEF4FB / #2D6CB5) alongside "מהמאגר"/"מוערך".
- **CANNOT be tested in the sandbox** (api.nal.usda.gov is outside the allowlist) — verify on the live site via `/api/usda?q=grilled%20ribeye%20steak&debug=1`; expect one tuning round (coefficient/field mapping) after deploy.
- **QA harness note:** `aiNutritionChat` prompt changed (added `en`) — `qa/run-qa.mjs` mirrors prompts verbatim; KEEP IN SYNC before relying on QA.

## v0.61 — USDA FoodData Central grounding (generic foods)
- Full USDA integration is now in place (most client wiring already existed from a prior in-progress pass): `api/usda.js` proxy to FDC `foods/search` (reads nutrient numbers 208 kcal / 203 protein / 204 fat / 205 carb per-100g, prefers Foundation > SR Legacy > Survey > Branded, `?debug=1` supported, key from `USDA_API_KEY` env, DEMO_KEY fallback). Client: `searchUSDA()`, `translateFoodToEnglish()` (tiny AI call, Hebrew→English), `lookupProduct(name,en)` layered Israeli→USDA→OFF, `reconcileWithDb` passes `it.en`, `SrcBadge` "usda" (blue), `aiNutritionChat` prompt emits per-item `en`, manual-search effect falls back to translate+USDA when צמרת & OFF are empty (source label "USDA FoodData Central · ערכים גנריים").
- Layering: barcode/צמרת/OFF for packaged & Israeli; USDA for generic cooked foods (English-normalized); AI estimate only when nothing matches.
- **Deploy requirement (IMPORTANT):** this is the first change that needs files BEYOND `src/App.jsx`. Ron must upload **`api/usda.js`** to the repo's `api/` folder and add a free **`USDA_API_KEY`** env var in Vercel (api.data.gov / fdc.nal.usda.gov/api-key-signup) then redeploy. Verify on the live site: `/api/usda?q=grilled%20ribeye%20steak&debug=1` (should return items with realistic kcal). NOT testable in the sandbox (network blocked to api.nal.usda.gov) — expect one tuning round after deploy.
- KEEP qa harness prompts in sync — `aiNutritionChat` now includes the `en` field instruction.

## v0.61 — USDA FoodData Central as the generic-food data layer
- New serverless proxy `api/usda.js` → FDC `foods/search`. Reads per-100g nutrients (208 kcal / 203 protein / 204 fat / 205 carb), prefers generic data types (Foundation > SR Legacy > Survey FNDDS > Branded), returns `{items:[{name,brand,dataType,kcal,p,f,c}]}`. Key from env `USDA_API_KEY` (free at fdc.nal.usda.gov/api-key-signup.html), falls back to DEMO_KEY. Debug: `/api/usda?q=grilled%20ribeye%20steak&debug=1`.
- Client: `searchUSDA(q)` (same {per100,measures} shape as IL/OFF). `translateFoodToEnglish(q)` = tiny AI call (Hebrew→short English query) used for the manual-search fallback. AI logging path gets English directly: `aiNutritionChat` prompt now asks for a per-item `en` field, parsed items carry `it.en`.
- Layered lookup `lookupProduct(name, en)`: (1) Israeli צמרת by Hebrew name → source "db"; (2) USDA by English `en` → source "usda"; (3) Open Food Facts → source "db". `reconcileWithDb` passes `it.en`, scales per-100g by grams, tags source. Manual search (`step==="list"`): Israeli → OFF → (translate) USDA fallback.
- `SrcBadge` has a "usda" case (blue "USDA"). Barcode/צמרת/OFF stay the exact path for packaged/Israeli; USDA covers generic cooked foods; AI estimate only when nothing matches.
- **Deploy:** add `USDA_API_KEY` to Vercel env; upload the new `api/usda.js` + `src/App.jsx`. **Not testable in this sandbox** (api.nal.usda.gov is outside the allowlist) — verify on the live site with the debug URL; expect maybe one tuning round (nutrient-number/dataType mapping) after first deploy.
- **KEEP QA HARNESS IN SYNC:** `aiNutritionChat` system prompt changed (added the `en` field) — mirror it in `qa/run-qa.mjs` if/when the harness covers the logging prompt.

## v0.62 — Profile = per-field tap-to-edit (no global save); step default 2000
- Step-goal default changed 8000 → 2000 (DEFAULT_PROFILE, onboarding draft, fallbacks, ReportScreen default).
- ProfileScreen reworked per Ron's clarification (example screenshots were functionality-only, not design): removed the global draft + "שמור שינויים" button. Each value field (גיל / גובה / משקל / משקל יעד / קצב ירידה / תחילת התוכנית / יעד קלורי / יעד צעדים) is now a tappable EditRow showing its value; tapping opens a small centered edit modal (our theme, not the example's look) with the right control (Stepper for numbers, option buttons for rate, select for start date, Stepper + "אפסי למומלץ" for calorie) and its own "שמור" — only on save does `setProfile` commit that one field. Modal is a self-contained `position:fixed` centered overlay (zIndex 60) inside ProfileScreen.
- Diet/sensitivities chips + dislikes text now apply immediately (no draft), so no resync conflict.
- Calorie card + step-goal row open their editors on tap; MacroRow still shown in the calorie card from week 3 (its tap is stopPropagation so it doesn't open the editor).

## v0.63 — USDA ranking tweak (demote raw on cooked queries)
- `api/usda.js`: added `rankScore(f, q)` used for sorting. Primary key still data type (Foundation>SR Legacy>Survey>Branded); additionally, when the query contains a cooking word (grill/cook/roast/bake/fry/boil/broil/steam/saute/sear/poach) any result whose name matches `\braw\b` is pushed down (+5). So a "grilled X" query no longer surfaces raw X.
- Deliberately did NOT penalize "separable lean only": simulation showed it crosses between different foods and can promote a wrong unpenalized cut (e.g. a sirloin) above the correct ribeye; lean values are accurate anyway, and client `strongMatch` guards the final pick. Verified on the real "grilled ribeye steak" result set — cooked ribeye stays #1, raw entries sink.
- App VERSION bumped 0.62→0.63 (UI label only; the functional change is api/usda.js — re-upload both api/usda.js and src/App.jsx).

## v0.64 — AI logging: wait for DB before showing values; respect exact quantity
- The "ספרי לי מה אכלת" summary no longer shows the AI's estimated values first and then swaps them. `finishItems` now sets `aiDoneItems=null` + `reconciling=true`, runs `reconcileWithDb`, and only sets the items AFTER the DB lookup (Israeli/USDA/OFF) completes. While checking, a loader card "בודקת ערכים במאגרי המזון…" shows; values/badges appear once, final. On reconcile error, falls back to estimated items.
- `aiNutritionChat` prompt: added an explicit instruction to use the user's stated quantity EXACTLY (e.g. "200 גרם") and not substitute a typical portion — addresses a report where "200 גרם" was logged as 400g (the gram value comes straight from the model; reconcile/commit never alter `grams`, confirmed). If it recurs, capture the exact chat to confirm it's model output vs. anything else.
- VERSION 0.63→0.64 (App.jsx changed; re-upload src/App.jsx). KEEP qa harness prompt in sync (aiNutritionChat prompt changed again).

## v0.65 — Day-screen rings (2x2), + menu rework, weight model, profile sections
- **Day screen — 4 rings (2x2, responsive flex-wrap):** calories (always), protein (macroOpen/wk3), water (waterOpen), steps (stepsOpen). New generic `MetricRing` (value/goal/color/track/label/sub + optional `onPlus` overlay button in the ring color). Water ring `+` adds a glass (min(8,glasses+1), no decrement — resets daily); steps ring `+` opens StepsModal. Colors: calories brand pink, protein purple, water blue (#7E8DD6/#EBEDF8), steps amber (#C77A3C/#FBEEDF). Removed the "מה כדאי לאכול?" button and the old StepsCard/WaterCard renders from the day screen (component defs left in file, now unused — harmless).
- **+ menu (EntryMenu):** now הוספת מזון · פעילות גופנית · מה כדאי לאכול (id "recommend") · הזיני משקל היום (id "weight"). Removed steps/water items (now on the rings). onPickEntry: added `recommend` → setSheet("recommend"). EntryMenu call no longer passes waterOpen/stepsOpen.
- **Weight model:** profile "משקל" → **"משקל התחלתי"** (baseline for targets). New `logWeightToday(kg)` upserts TODAY (filters existing today entry, re-adds) so re-entry overwrites. WeightModal is now **typed only** (text input, inputMode decimal, validates 30–400, no +/-), title "הזיני משקל היום", note about overwrite. Report's weight button (`reportAddWeight`) now opens the weight sheet instead of auto −0.2. Weight sheet current = today's value or last.
- **Steps modal:** typed only (text input, inputMode numeric, no 250 jumps), amber progress bar, note "לשינוי יעד הצעדים — אפשר בפרופיל. הזנה חוזרת היום מעדכנת את הערך." (stepsByDate setStepsForDate already overwrites per date.)
- **Profile:** base data (גיל/גובה/משקל התחלתי/משקל יעד/קצב ירידה/תחילת התוכנית + week line) wrapped in a collapsible "נתוני בסיס" dropdown (ChevronDown, default CLOSED via `baseOpen`). Calorie goal stays a brandBg card. Step goal converted from EditRow to its own amberBg section card. Nutrition prefs (diet+sensitivities+dislikes+note) wrapped in a C.bg section card titled "העדפות תזונה" (chip unselected bg transparent→C.panel for contrast). Per-field edit modal unchanged.
- VERSION 0.64→0.65 (App.jsx changed — re-upload src/App.jsx; usda.js unchanged since 0.63). KEEP qa harness in sync (aiNutritionChat prompt unchanged this version).

## v0.66 — "+" on the calories ring (food + activity shortcut)
- `Ring` now accepts an optional `onPlus` → renders the same bottom-center "+" badge (brand color) as MetricRing. Backward compatible (callers without onPlus get the plain svg).
- Day screen: calories ring `onPlus={onAddCalorie}` (new DayScreen prop) → root `setSheet("caloriemenu")`.
- `EntryMenu` gained a `mode` prop; `mode="calorie"` shows only [הוספת מזון (first), פעילות גופנית]. New sheet render `caloriemenu` uses it. onPickEntry already routes food/activity. The bottom FAB still opens the full menu (food/activity/recommend/weight).
- VERSION 0.65→0.66 (App.jsx only).

## v0.67 — sensitivities save/placement, intro update, start-date cap, no long dashes
- **Free-text sensitivity input** moved to immediately after the "רגישויות ואלרגיות" heading (before the preset chips) in BOTH the profile prefs section and the onboarding allergies step, restyled prominent (1.5px C.brand border, not faint). Confirmed it persists to `profile.dislikes` (controlled input) and is ALREADY fed into the RecommendModal seed via `avoidList` (allergies + dislikes) with a strict no-suggest instruction. The bottom disclaimer note changed from C.faint to C.sub.
- **Intro/welcome modal:** barcode no longer described as a demo-only mock (it works) - bullet now "אפשר לסרוק ברקוד של מוצר ולקבל ערכים מהמאגר"; added a bullet that steps/water/weight tracking appears by program progress.
- **Program start date:** `listSundays()` loop capped at `i <= 0` (was `<= 2`) so the latest selectable start is the CURRENT week's Sunday - no future start dates.
- **Long dashes removed:** all em-dashes and en-dashes in displayed text replaced with a short hyphen across App.jsx, recipes.js, sweets.js (standing rule: short dashes only). recipes.js/sweets.js changed only for this - re-upload all three this version.
- VERSION 0.66->0.67.

## v0.68 — consent text tidy, pescatarian diet option
- Onboarding consent privacy block: merged the 3 separate paragraphs (one had a Lock icon in a flex column that caused a hanging indent) into ONE flowing right-aligned paragraph (textAlign right) with the Lock icon inline at the start (display inline, vertical-align). No more icon-induced indentation / ragged wrap.
- DIET_OPTIONS: added "צמחוני + דגים" 🐟 (pescatarian) between צמחוני and טבעוני.
- VERSION 0.67->0.68 (App.jsx only).
- OPEN QUESTION raised with Ron: the report's "Adaptive TDEE" line (`adaptive = targets.tdee + (change<0 ? -40 : +40)`, line ~691) is a crude placeholder - it nudges the formula TDEE by a flat ±40 by weight-change SIGN only; it does NOT use logged intake or the magnitude of change, so "ההוצאה האמיתית שלך כוילה" overstates it. Pending Ron's choice: implement a real adaptive calc (expenditure = intake - weightChangeKg×7700, /days), reword honestly, or hide until enough data.

## v0.69 — removed Adaptive TDEE line (kept as future task)
- Per Ron: removed the report's "Adaptive TDEE" note + the unused `adaptive` const. Kept as a FUTURE TASK: implement a real adaptive-TDEE (expenditure = intake - weightChangeKg*7700, /days) once there's enough logged data, or revisit wording. (Target icon import may now be unused - harmless.)
- VERSION 0.68->0.69 (App.jsx only).
- DISCUSSION (calorie targets higher than other apps): root cause is the activity multiplier default `activity:"בינונית"` (×1.55 in ACTIVITY_FACTORS) in DEFAULT_PROFILE + onboarding draft. computeTargets = bmrMifflinWoman × factor - deficit. Most consumer apps default to sedentary (×1.2) and ADD exercise. Our app ALSO adds steps+activity to the daily budget, so ×1.55 DOUBLE-COUNTS activity. Proposed (pending Ron): default activity to "יושבני" (1.2). For demo profile 55kg/165/50yo/250g-wk: 1.55→1539 vs 1.2→~1129. NOT yet changed.

## v0.70 — default activity to sedentary (calorie targets aligned with familiar apps)
- Decision (Ron): keep the Mifflin-St Jeor formula, but change the DEFAULT activity level from "בינונית" (×1.55) to "יושבני" (×1.2). Rationale: the app already adds steps + logged activity to the daily budget, so a moderate baseline double-counted movement and pushed targets well above what users see in familiar apps. Changed in DEFAULT_PROFILE (line ~2214) and the onboarding draft (line ~427); computeTargets fallback `?? 1.55` -> `?? 1.2`. For the demo profile this drops the target by ~400 kcal into the expected range. (Harris-Benedict was considered and rejected - less accurate, and would have raised the number.)
- VERSION 0.69->0.70 (App.jsx only).

## v0.71 — HOTFIX: build break from v0.67 dash cleanup
- The v0.67 global em/en-dash -> hyphen replacement hit a regex character class inside `normName` (line ~1288). The original class `["'.,()\[\]/–-]` contained an en-dash; replacing it produced `["'.,()\[\]/--]`, and the adjacent `/--` was parsed as an out-of-order range (`/` to `-`), breaking `vite build` (rollup: "Range out of order in character class"). Fixed to a single trailing hyphen: `["'.,()\[\]/-]`. Verified: no other regex char-classes contain non-edge hyphens (only valid `0-9` digit classes remain), no `--` sequences anywhere.
- LESSON for future bulk text edits: never blanket-replace characters that may appear inside regex literals; exclude/inspect regexes first.
- VERSION 0.70->0.71 (App.jsx only).

## v0.72 — force sedentary for ALL profiles (fix: legacy profiles still showed high target)
- v0.70 only changed the DEFAULT activity for new profiles/onboarding; existing profiles in localStorage kept activity="בינונית" (×1.55) and still showed ~1,500. computeTargets now uses ACTIVITY_FACTORS["יושבני"] (1.2) directly, ignoring stored profile.activity, so legacy profiles recompute to the lower target without a reset. (If a user-facing activity selector is added later, revert to reading profile.activity.)
- VERSION 0.71->0.72 (App.jsx only).

## v0.73 — profile sensitivities section reordered + custom-sensitivity chips
- ProfileScreen "רגישויות ואלרגיות" subsection reordered to: (1) heading "רגישויות ואלרגיות (להימנע)"; (2) the explanatory note moved to right after the heading and made readable (C.ink, was faint gray); (3) preset sensitivity chips; (4) new "רגישויות נוספות" labelled free-text input WITH an add mechanism - Enter key and a "+" button (Plus icon) - that commits each entry as a removable brand-colored chip (X icon to remove).
- Custom sensitivities are stored in profile.dislikes as a comma-separated list (state newSens + helpers customSens/addSens/removeSens). This is the SAME field RecommendModal already feeds into avoidList (line ~2042), so custom entries flow into "מה כדאי לאכול" with the strict "never suggest foods containing these" instruction. Confirmed wired.
- Removed the old single free-text dislikes input from the profile (replaced by the chip-add input). Onboarding allergies step left unchanged (not in scope).
- VERSION 0.72->0.73 (App.jsx only).

## v0.74 — brand border around the profile calorie-goal card
- ProfileScreen calorie-goal card (line ~1018) gained `border: 1.5px solid C.brand` (matching the emphasized protein MacroCard's brand outline) so the whole "יעד קלורי יומי" card now has a surrounding pink frame like the protein card. Background stays C.brandBg.
- VERSION 0.73->0.74 (App.jsx only).

## v0.75 - RecommendModal: custom-sensitivity chips + add button + brand frame
- The "מה כדאי לאכול?" confirm stage previously had only a PLAIN single free-text input bound directly to `profile.dislikes` (faint C.line border) - it did NOT render existing custom sensitivities as chips and had no add button. So a "בלי חריף" saved in the profile showed as raw text only, and there was no way to add+sync a new one from this screen.
- Ported the exact v0.73 profile chip-add pattern into `RecommendModal`: new local `newSens` state + `customSens` (profile.dislikes comma-split) + `addSens`/`removeSens` (same helpers as ProfileScreen, writing back to `profile.dislikes` via `setProfile`). Replaced the plain input with: label "רגישויות נוספות" -> brand-bordered input (Enter to add) + a "+" (Plus) button -> existing customSens rendered as removable brand chips (X to remove). Because it persists to `profile.dislikes`, entries now (a) show as chips here AND in the profile, (b) flow into `avoidList`/the seed prompt, and (c) survive across sessions/future chats. `avoidList`/`hasAvoid`/`startChat` unchanged (still read the same comma-separated `profile.dislikes` string).
- Added a `1.5px solid C.brand` rounded frame (radius 14, padding 14) around the ENTIRE confirm-stage content (the part Ron screenshotted). NOTE: v0.74 had put the brand border on the PROFILE calorie-goal card; that border is LEFT in place (matches the protein card, not removed). If Ron meant the frame should sit only around the sensitivities block, or around the whole sheet incl. the title bar, it is a one-line move.
- VERSION 0.74->0.75 (App.jsx only). qa harness unaffected (no prompt change).

## v0.76 - red frame moved to the PROFILE calorie headline (where Ron actually meant); steps "0" fixed; reverted the v0.75 RecommendModal frame
- FRAME (settled at last): the red/brand frame Ron wanted was NEVER in RecommendModal and NOT the whole calorie card - it is around the calorie-TARGET HEADLINE row inside the ProfileScreen calorie card (he sent a hand-marked screenshot looping just the "יעד קלורי יומי / 1,200 קק"ל (מומלץ)" line, excluding the macro row below). Implemented: the calorie card (line ~1018) lost its faint full-card `1.5px C.brand` border (added in v0.74, too low-contrast to notice and wrong scope); the headline row now has its own prominent box: `2px solid C.brand`, radius 10, padding 9/11, white background - clearly visible against the brandBg card, matching his drawing. MacroRow stays below, outside the frame.
- Reverted the v0.75 RecommendModal confirm-stage frame (that was based on a misread of which screenshot he meant). The v0.75 custom-sensitivity CHIPS + add button in RecommendModal STAY - those were correct and unrelated to the frame.
- STEPS "0": `StepsModal` init was `useState(current != null ? String(current) : "")`; since `current` is passed as `stepsByDate[date] || 0` it was always a number, so the field always showed "0" that had to be deleted before typing. Changed to `useState(current ? String(current) : "")` - 0/empty now shows the placeholder "לדוגמה 6500", a real saved value still pre-fills.
- VERSION 0.75->0.76 (App.jsx only). qa harness unaffected.
- PENDING (agreed plan, not yet coded): water entry rework - tapping the water "+" should open a small modal to add either a כוס or מ"ל, with a configurable cup size. Today the water ring `+` just increments glass count by 1 (capped 8); `waterByDate[date]` stores a GLASS COUNT. Plan to discuss/confirm: store water in ML per date (migrate existing glass counts x cupMl on read), add `profile.cupMl` (default 250), target = 2000 ml; the ring shows ml as glasses = round(ml/cupMl) of round(2000/cupMl); the "+" opens WaterModal (add chip: כוס / חצי ליטר / מ"ל typed) + a "גודל כוס" field saved to profile. WATER_UNLOCK gating unchanged.

## v0.77 - onboarding sensitivities rework (chip-add + safety confirm) + weight chart shows only entered points
- ONBOARDING step 2 ("איך את אוכלת?" / רגישויות) reworked to match profile + RecommendModal:
  - Order is now: heading -> sub-note -> preset SENSITIVITY_OPTIONS chips -> the disclaimer note (MOVED UP from the bottom, now C.ink black/clear, no tinted box) -> "רגישויות נוספות" label -> chip-add input + "+" (Plus) button (Enter or "+" commits) -> removable brand chips. Previously this step had only a PLAIN single free-text `dislikes` input with NO add button (so custom sensitivities could not really be committed/seen as chips here), and the disclaimer sat at the bottom in a faint C.bg box.
  - Local helpers added to `Onboarding`: `newSens` state, `customSens` (dislikes comma-split), `addSens`/`removeSens` (write the local `dislikes` string, which already flows into the created profile via `draft`). Same pattern as ProfileScreen, but operating on onboarding-local state since the profile does not exist yet.
  - SAFETY CONFIRM: new `hasSens` (allergies or customSens) + `confirmNoSens` state + `next()` handler. The step-2 "המשך" now goes through `next()`; if NO sensitivity/allergy is marked it opens a centered confirm overlay "לא סימנת שום רגישות או אלרגיה / האם את בטוחה?" that repeats the same check-ingredients-yourself disclaimer, with "כן, אפשר להמשיך" (advances) and "חזרה לסמן רגישויות" (dismiss). The "דלג ישר לדמו" skip link still bypasses (deliberate). Steps 0/1/other still advance normally.
- WEIGHT CHART (report) now shows ONLY weights the user actually entered. Removed `makeWeightSeed` (the fabricated 7-point/24-day loss history) and replaced with `initWeights(currentKg, startDate)` = a SINGLE starting point `[{date: startDate, kg}]`. Used in the weights initial state, `finishOnboarding` (p.weightKg @ p.startDate), and `resetDemo`. The report weight Area chart now starts at that one point and grows only as she logs weights via "הזיני משקל היום"; the change badge reads 0 until a second weight exists. ReportScreen already reads weights[0]/weights[last] defensively so a 1-point array is fine.
  - **Existing testers:** old fabricated points persist in their `localStorage` `weights` (loaded via `saved?.weights`); they must RESET THE DEMO once to clear them. New onboarding/reset start clean.
- VERSION 0.76->0.77 (App.jsx only). qa harness unaffected.
- STILL PENDING owner approval (not coded): the water entry rework (כוס/מ"ל + configurable cup size) proposed before v0.76.

## v0.78 - water tracking reworked: ml-based, configurable cup size, fixed 2L target, modal entry
- Decision (Ron): water target is ALWAYS 2,000 ml (2 ליטר), fixed. Cup size is user-configurable; the cups number shown is derived = ml / cupMl.
- Storage change: `waterByDate[date]` now holds **ML** (was a glass count). Read everywhere via `waterMlOf(v)` = `v < 50 ? Math.round(v*250) : v` so legacy glass-count data (<= ~8) auto-migrates on read (old fixed cup = 250 ml). New writes are always >= 50 ml (free-ml input min 50, cup size min 100, quick-adds 250/500), so the threshold never collides.
- New constants: `WATER_TARGET_ML = 2000`, `DEFAULT_CUP_ML = 250`. `profile.cupMl` added to DEFAULT_PROFILE + onboarding draft (read defensively `profile.cupMl || DEFAULT_CUP_ML`).
- Water RING (DayScreen): center now shows the CUPS number (`bigText`), label "כוסות", sub `"{ml} מ"ל מתוך {targetCups} כוסות"` where targetCups = round(2000/cupMl). Ring fill = ml/2000 (passed value=ml, goal=2000; new optional `MetricRing` `bigText` prop overrides only the displayed central number so the fraction stays exact). The "+" no longer instant-adds a glass - it opens the new WaterModal (`onWater` prop -> `setSheet("water")`).
- New `WaterModal` (sheet "water", placed before CalorieGoalModal): shows current cups + ml + target; blue progress bar; quick-add buttons "+ כוס ({cupMl} מ"ל)" and "+ חצי ליטר"; a free-ml typed input (Enter or "+", min 50); "איפוס היום" (set 0); and a "גודל כוס" Stepper (step 10, clamped 100-1000) saved to the profile. Save -> `setWaterForDate(date, ml)` + `setProfile({...profile, cupMl})`.
- `WaterCard` (the old per-glass day card) remains dead/unused code (not rendered since v0.65) and still references the old glass model - harmless, left as-is.
- VERSION 0.77->0.78 (App.jsx only). qa harness unaffected.

## v0.79 - weight entry: pick any date (fixes back-dated entries not landing on the graph)
- BUG: the weight sheet was wired to `logWeightToday` which ALWAYS wrote to `today`, ignoring the date - so a "back-dated" weight just overwrote today's point and never appeared at its real date on the graph. Also the modal was titled "משקל היום" with no way to choose a date.
- `WeightModal` reworked: now takes `weights`, `today`, `minDate` (= profile.startDate). Adds a native `<input type="date">` (default today, `min`=startDate, `max`=today). Changing the date prefills the weight field with that date's existing value if one exists. On save it calls `onAdd(kg, date)`.
- Root: replaced the two old single-purpose helpers (`logWeightToday` -> today only; `addWeightValue` -> selectedDate, was already dead) with ONE `setWeightForDate(date, kg)` upsert (filter that date + re-add + sort). Weight sheet now: `onAdd={(kg, date) => setWeightForDate(date, kg)}`. Removed the two dead helpers so a future session can't re-wire the today-only one by mistake.
- Labels "+ הזיני משקל היום" (report) and the "+" menu item "הזיני משקל היום" -> "הזיני משקל" (a date is now selectable).
- ON THE ONBOARDING/START-DATE COMPLAINT: the initial weight is ALREADY dated at the program start date (`initWeights(p.weightKg, p.startDate)`, since v0.77). Ron saw it on a pre-0.77 build where `makeWeightSeed` dated the current-weight point at TODAY. Resolution: deploy 0.79 + reset the demo once to clear stale localStorage weights; OR just use the new date picker to set the starting weight to the start date. No further code change needed for that part.
- VERSION 0.78->0.79 (App.jsx only). qa harness unaffected.

## v0.80 - onboarding: readback confirm when sensitivities WERE marked
- Per Ron: the step-2 "המשך" now ALWAYS goes through a confirm (kept light). Added `confirmSens` state; `next()` on step 2 -> `hasSens ? setConfirmSens(true) : setConfirmNoSens(true)`.
- New `confirmSens` overlay (marked case): title "רגע לפני שממשיכים", a readback "רשמתי לעצמי להימנע מ: <bold list>" (allergies + customSens joined), ONE short reminder line ("תמיד כדאי לבדוק את רשימת הרכיבים בעצמך - זה כלי עזר, לא תחליף לבדיקה."), buttons "המשך" / "שינוי". Deliberately NOT the full disclaimer (that already sits on the step screen; full version is only in the no-mark `confirmNoSens` overlay). Decision: readback is worth it for allergy safety + catches mis-taps, but kept short to avoid nagging.
- VERSION 0.79->0.80 (App.jsx only). qa harness unaffected.

## v0.81 - onboarding marked-sensitivities confirm: add allergy line + required acknowledgement checkbox
- In the `confirmSens` overlay (step 2, when she DID mark sensitivities): appended the real-allergy sentence so it now reads "...לא תחליף לבדיקה. אם יש לך אלרגיה ממשית, אל תסתמכי רק על האפליקציה." (previously only the no-mark overlay had the allergy line).
- Added a REQUIRED acknowledgement checkbox (`ack` state): "קראתי והבנתי שהאפליקציה היא כלי עזר בלבד, ובאחריותי לבדוק תמיד את רשימת הרכיבים המלאה לפני אכילה." "המשך" is `disabled` until it is ticked. `ack` resets on continue / "שינוי" / overlay dismiss. Checkbox styled like the consent checkbox (22px box + Check).
- The no-mark `confirmNoSens` overlay is unchanged (no checkbox there - she has nothing to take responsibility for; it keeps the full disclaimer + "כן, אפשר להמשיך"/"חזרה לסמן").
- VERSION 0.80->0.81 (App.jsx only). qa harness unaffected.

## v0.82 - "מה כדאי לאכול?" asks direction before recommending
- Per Ron: before generating ideas, ask what she is in the mood for. Added module const `WANT_OPTIONS` = ארוחה מלאה / משהו קל / חטיף / משקה (id+emoji). New `want` state in `RecommendModal` (single-select, optional - tapping again clears).
- Confirm stage: added a "מה את מחפשת עכשיו?" chip row right under the intro (above סגנון תזונה), using the same `chip()` style. The recommendations already factor in what she logged today (the seed includes `mealsHad` + remainingKcal), so the only addition is the direction.
- `startChat` seed: appends `. אני מחפשת עכשיו: {want}` when one is chosen. If none chosen, behavior is unchanged (general ideas).
- VERSION 0.81->0.82 (App.jsx only). qa harness: the RecommendModal seed changed (added the optional "אני מחפשת עכשיו" clause) - mirror in qa/run-qa.mjs if/when that seed is covered.

## v0.83 - protein ring shows protein EATEN (counts up), not remaining
- Ron reported the day-screen protein ring "changing protein to ~101 instead of 14" and then "going down" when he added another recipe. Not a value/scaling bug: `ProteinRing` was displaying `remaining = target - consumed` (target ~115 for 72kg at PROTEIN_PER_KG 1.6, so after a 14g recipe it showed 101, and dropped as more was eaten). With the "מתוך {target}" subtitle this read as "101 of 115 eaten" and counted the wrong direction.
- Fix: the ring big number now shows `eaten = Math.round(consumed)` (counts UP toward the goal). Subtitle stays "מתוך {target}", fill stays consumed/target, "הגעת ליעד!" still at consumed>=target. So protein now reads "14 ג׳ חלבון מתוך 115" and grows as she eats.
- Intentional asymmetry left as-is: the CALORIE ring still shows `remaining = budget - consumed` (counts DOWN - it is a budget to stay under), while protein counts UP (it is a goal to reach). Different metric types, different framing.
- VERSION 0.82->0.83 (App.jsx only). qa harness unaffected.

## v0.84 - safer weight-loss options + low-value warnings (underweight goal / floor calories)
- RATE_OPTIONS: removed 750 g/week (too aggressive per Ron). Now [0, 250, 500].
- 250 g/week emphasized as the recommended option in BOTH the onboarding rate step and the profile rate editor: always brand-bordered (2px) + brandBg even when unselected, a prominent "מומלץ" badge, and (onboarding) a subtitle "הקצב הבריא - נשמר לאורך זמן וטוב לשמירה על מסת השריר".
- New safety warnings (verified threshold WHO BMI<18.5 = underweight). Reusable `LowValueWarning` overlay (zIndex 70) with "הבנתי, להמשיך" / "לשנות"; module consts `bmiOf(kg,heightCm)`, `UNDERWEIGHT_BMI=18.5`, `GOAL_LOW_MSG`, `KCAL_LOW_MSG`. The warnings inform + point to a professional + let her proceed at her own responsibility (company not taking responsibility), per Ron.
  - Triggers: (a) goal weight whose BMI < 18.5 - checked in onboarding `next()` when leaving step 1 (rate!=0), and in ProfileScreen `commit` when saving `goalWeightKg`; (b) manual calorie override at/below the 1,200 floor - checked in ProfileScreen `commit` when saving `calorieOverride` (the calorie editor Stepper min stays 1000 so she CAN go low but gets warned). ProfileScreen `commit` now routes through `doCommit`; `warn` state holds the message.
  - NOT added: a popup for the onboarding "floored target" case - that already shows the amber note. Calorie target is otherwise floored at 1,200 in computeTargets.
  - NOTE for older users: WHO underweight line is 18.5, but in the elderly BMI<21 may already indicate undernutrition; left the trigger at 18.5 (universal underweight) - could be raised for older ages later if wanted.
- VERSION 0.83->0.84 (App.jsx only). qa harness unaffected.

## v0.85 - underweight protection extended to actual + starting weight
- WeightModal (logging real weight) now takes a `heightCm` prop and shows an inline amber note (Info icon) whenever the entered value's BMI < 18.5. Non-blocking (a real measurement can always be saved) and REPEATED - it shows every time an underweight value is entered, not one-time (per Ron). Render passes `profile.heightCm`.
- Starting / baseline weight protection (Ron: "is there protection if she sets a low starting weight?"):
  - Onboarding: `next()` now warns on leaving step 0 if current weight BMI < 18.5 (LowValueWarning, message `STARTW_LOW_MSG`). Refactored the onboarding warning to a single `obWarn` (message string|null) state replacing the prior `goalWarn` boolean - both the step-0 (start weight) and step-1 (goal) warnings flow through it; onContinue advances the step, onCancel dismisses.
  - ProfileScreen `commit`: added `weightKg` (baseline) underweight check -> `setWarn(STARTW_LOW_MSG)`.
- New module const `STARTW_LOW_MSG` (sits with GOAL_LOW_MSG / KCAL_LOW_MSG). Note framing: actual/starting weight in underweight range is informational + points to a professional + lets her proceed (company not taking responsibility) - distinct from the goal case which discourages targeting an unhealthy weight.
- Summary of all underweight triggers now: goal weight (onboarding step1 + profile), starting weight (onboarding step0 + profile baseline), actual logged weight (inline note, repeated), manual calorie override at/below 1,200 floor (profile).
- Still open / discussed but NOT built: auto-switch from deficit to maintenance when actual weight reaches goal or enters underweight (Ron leaned toward the gentle-note path; the maintenance auto-switch was offered, not yet chosen). For older users the underweight line could be raised above 18.5 (elderly undernutrition ~BMI 21) - left at 18.5.
- VERSION 0.84->0.85 (App.jsx only).

## v0.86 - hard blocks for everything she SETS (weight/calorie) + live water update
Ron's decision: things she SETS/CHOOSES (goal weight, starting weight, calorie target) must be HARD-BLOCKED from unhealthy values - she literally cannot enter them, like the 1,200 calorie floor. But the ACTUAL ongoing weigh-in stays a (repeated) note, never a block - blocking a real measurement would force a false number / lose the data. Underweight threshold verified WHO BMI<18.5 (also AHA/NIH); for the elderly BMI<21 can indicate undernutrition but the universal underweight line 18.5 is kept.

Hard blocks (replaced the v0.84/0.85 LowValueWarning popups, which were removed entirely):
- Helper `minHealthyKg(heightCm)` = lowest weight still giving BMI >= 18.5, rounded UP to 0.5.
- Goal weight: onboarding Stepper clamps `Math.max(minHealthyKg(heightCm), Math.min(weightKg-0.5, v))` + faint hint; profile EditRow `min: minHealthyKg(profile.heightCm)` + `hint`.
- Starting weight: onboarding "משקל נוכחי" Stepper clamps `Math.max(minHealthyKg(heightCm), v)` + caption; profile "משקל התחלתי" EditRow `min: minHealthyKg` + hint. Draft also clamps saved `weightKg` and `goalWeightKg` to `minHealthyKg` (covers the height-changed-after-weight edge).
- Calorie: profile calorie editor Stepper min raised 1000 -> KCAL_FLOOR (1200); CalorieGoalModal already floored at 1200. So calorie is a true hard floor everywhere now (it was NOT before - the profile editor allowed down to 1000).
- num-type edit modal renders an optional `edit.hint` line.
- REMOVED: `LowValueWarning` component, `GOAL_LOW_MSG`/`KCAL_LOW_MSG`/`STARTW_LOW_MSG` consts, onboarding `obWarn` state+overlay+next() bmi checks, ProfileScreen `warn`/`doCommit`+commit checks+overlay. (They contradicted "can't enter": a popup that lets her continue.)
- KEPT: WeightModal actual-weigh-in inline amber note (repeated, non-blocking) from v0.85 - this is the one place that stays a note.

Live water update (WaterModal, sheet "water"):
- Now LIVE: every action commits immediately (no "שמור"). Props changed `onSave(ml,cup)` -> `onSetMl(ml)` + `onSetCup(cup)`; removed local `ml` staging (uses `currentMl` prop directly, controlled); `cup` stays local but commits live via `onSetCup`. Close via the SheetShell X.
- + כוס / + חצי ליטר / free-ml input (kept, Ron chose to keep it) all add immediately; new "- כוס (תיקון)" subtracts a cup (disabled at 0); "איפוס היום" zeroes immediately. Caption "כל שינוי נשמר מיד. אפשר לסגור בכל רגע."
- Day-screen water ring label "כוסות" -> "כוסות מים".
- VERSION 0.85->0.86 (App.jsx only). qa harness unaffected.


## v0.87 - Daily progress tracker (check-in module, owner's medals/trophies)
NEW module ported from the ManyChat 10-week WhatsApp tracker. Built as an opt-in component behind a master switch.
- **Master switch:** `const TRACKER_ENABLED` (top of App.jsx, in the tracker section after `streakDays`). false = the whole tracker is hidden everywhere; true = live. Owner toggles only this.
- **Content:** `src/checkins.js` exports `CHECKIN_GROUPS`, `CHECKIN_TASKS` (~22 habit tasks, each with `startWeek`/`type`(bool|number)/`group`/optional `auto`), and `activeTasks(week)`. Tasks are CUMULATIVE: a task turns on at its `startWeek` and stays active through week 10 (no stopWeek). Built from the 10-week booklet PDF. The PDF/WhatsApp drop some tasks later only due to message length; the app keeps them and groups them instead.
- **Gating:** card shows from program day 3 (`CHECKIN_UNLOCK={week:1,day:3}`) via `unlockedOn`. TODAY's report is locked until 19:00 local (`CHECKIN_REVEAL_HOUR=19`) - before that the card shows a "ייפתח ב-19:00" note and no fill button; past days are always fillable (backfill via existing day nav); the rest of the app is unaffected by the time lock.
- **Auto-fill:** `autoStatusFor(date, stepsByDate, waterByDate, log, targets, cupMl)` derives steps/water/protein-goal/nutrition-journal from data the app already tracks; those tasks render read-only ("אוטומטי", pre-marked) so she is not asked twice. Manual tasks: bool tap-toggle + number `Stepper`.
- **Storage:** answers live ONLY on her device - added `checkins` to the `STORAGE_KEY` state object (localStorage). Owner directive: store nothing server-side, no coach visibility, no sync. `setCheckinValue(date,taskId,value)` upserts/deletes per task; deleting empties the key.
- **Streak + reward:** `checkinStreak(checkins, today)` = consecutive days with >=1 saved answer (rewards showing up, not perfection - misses just reset gently, no scolding). `CheckinCard` (on DayScreen) shows warm count "X מתוך Y" (positive count of what she did, NO percentages - owner: percentages feel like a traffic-cop report) + streak medals. `CheckinModal` (SheetShell) is the grouped fill UI; "סיימתי להיום" -> `finishCheckin` -> `CheckinCheer` celebration (owner's medal `/medals/medal.webp` shown x streak (cap 6) + animated confetti + a warm note "from ענת"). Tone: warm, "Anat in your phone", gamified but kind.
- **Assets (owner-supplied, optimised to transparent webp ~20KB each, total ~230KB):** `public/medals/medal.webp` (single daily/streak medal, shown N times), `public/medals/trophy-1..9.webp` (weekly trophies, week number baked in), `public/medals/trophy-champion.webp` ("אלופה!", week 10). `trophyForWeek(w)` maps week->file (10+ = champion). Trophies are NOT used yet (weekly summary is the next version).
- **Compare-to-self:** weekly steps will compare to HER previous week (owner chose this over a fixed target) - to be built with the weekly summary.
- VERSION 0.86->0.87. New files: `src/checkins.js`, `public/medals/*.webp`. qa harness unaffected; `qa/check-logic.mjs` still 7/7 (no guardrail change). Zip includes the new medal assets (the only public/ files included; recipes/ still excluded).

## OPEN TASKS (tracked, not yet built)
- **Weekly summary + trophies (NEXT, v0.88):** a warm end-of-week summary card (per-task counts for the week, avg steps vs HER last week, NO percentages), using `trophyForWeek(week)` (champion for week 10), celebration in Anat's voice. Trophy assets already in `public/medals/`.
- **Daily 19:00 notification:** native-app phase only (web/PWA push unreliable, esp iOS; needs notification permission). The in-app card already gates today's report to 19:00.
- **Onboarding required-field validation (owner-flagged; build AFTER owner finishes current testing):** the profile-setup / onboarding flow must verify ALL required fields are filled before the user can proceed past "המשך". If she taps "המשך" with anything missing, do NOT advance - instead show a small inline note at each missing field (e.g. "יש למלא את הנתון"). So: per-step required-field check; block/disable advance until complete; on attempted advance, mark the empty fields with the small note. (Lives in `Onboarding` - the "מסך פרופיל"/base-data steps where the המשך buttons are. Confirm exact required set per step when building.)
- **QA automation (owner-flagged, important):** connect the two automatic checks (logic `qa/check-logic.mjs` + AI `qa/run-qa.mjs`) into one simple command, or have Claude run them before a release. Keep it solo-friendly (owner is the only tester).
- **API cost controls (owner-flagged, MUST do before scale; real-app/server phase):** the AI is used two ways per customer - meal-photo analysis (vision) and nutrition-advice chat - so token cost scales with active users. Estimated cost/customer/month (May 2026 pricing: Haiku 4.5 $1/$5, Sonnet 4.6 $3/$15, Opus 4.8 $5/$25 per MTok): ~$0.5 on Haiku, ~$1.4 on Sonnet, assuming ~75 photos (~2,000 in incl ~1,500 image + 500 out) + ~30 chats (~1,500 in + 500 out). Negligible per customer vs a subscription; the real risks are scale, heavy/abusive users, and accidentally using an expensive model or full-res images. Implement ALL of these when wiring the live API (currently the demo calls `/api/ai`):
  1. **Default model = Haiku 4.5 for photo analysis** (food ID + estimates); escalate to Sonnet only for genuinely complex advice. Do not use Opus for routine calls.
  2. **Downsize images client-side to ~768px long side before upload** - image tokens scale with resolution (~w*h/750); this roughly halves the image cost, which is the biggest single input chunk. Calculator deliverable: `docs/myprime-api-cost-calculator.html` (in the handoff zip).
  3. **Prompt caching on the system prompt** (Anat's voice + instructions + grounding rules) - it repeats on every call (chat AND photo), 90% off the cached input portion. Highest-leverage lever given she both chats and sends photos.
  4. **Cap output** - small `max_tokens` + ask for concise/structured output.
  5. **Per-user daily usage cap** - DONE (v1.15): enforced server-side in `api/ai.js` via the same Upstash Redis as the access gate. Per-user daily cap (`AI_DAILY_LIMIT`, default 25) + per-minute burst cap (`AI_BURST_LIMIT`, default 10), keyed by the access email (sent as `x-user-id` header; falls back to IP). Daily quota resets at Israel-time midnight. Returns 429 `{error:'limit', message}`; the client shows a gentle Hebrew message. Limit is OFF until the Upstash env vars are set (app still works). The remaining cost levers (1-4, 6) are still open.
  6. **(Optional) Batch API (-50%)** only for non-real-time work; NOT for live photo/chat (it's async and the user waits).
- **Cross-device backup / restore (owner-flagged; architecture decision, build as a separate feature):** all data is in `localStorage` today, so a lost/wiped/replaced phone = data gone. An on-device backup (even automatic) does NOT survive phone loss - the backup must leave the device. Constraint: restore must work WITHOUT the owner holding readable personal health data (Israel privacy/consent sensitivity). Options:
  - (A) Manual export/import JSON file - zero infra, fully private, but manual and only survives phone loss if SHE moves the file off-device.
  - (B) **E2E-encrypted backup keyed by email + passphrase [RECOMMENDED for this constraint]** - client encrypts the state blob (WebCrypto: PBKDF2 from her passphrase to AES-GCM), uploads ciphertext to a new Vercel `/api` route storing it in the EXISTING Upstash Redis keyed by hash(email). Restore on a new device = email + passphrase, GET, decrypt. Owner stores only unreadable bytes. Automatic after a one-time setup. TRADEOFF: forgotten passphrase = unrecoverable by design (no readable copy on the server). Offer manual export as a backup-to-the-backup.
  - (C) User's own Google Drive (appDataFolder) - data lives in HER cloud, owner stores nothing ($0 storage), auto-sync after one-time Google sign-in; downside: OAuth complexity + Google dependency.
  - AVOID: plain server storage keyed by email - simplest but then the owner DOES hold readable health data (privacy/consent obligations).
  - **Cost (option B, Upstash, checked June 2026):** negligible at beta scale. Storage ~100-150 KB/user (one overwritten blob); 1,000 users ~150 MB = within the free 1 GB ~ $0 (10k users ~ $0.13/mo). Commands $0.20/100K, 500K/mo free; with debounced writes (~few per user/day) 1,000 active users ~ $0-2/mo. Switch to the $10/mo fixed plan (unlimited commands) once above ~10M commands/mo. Keep cheap: debounce writes (on app close / every few min), one blob per user overwritten.
  - **UX:** offer as a one-time choice in onboarding ("בלי גיבוי" vs "גיבוי עם מייל + סיסמה") with a clear explanation ("מוצפן, גם אנחנו לא רואים את הנתונים, ושכחת סיסמה = אין שחזור").
  - STATUS: pending owner go-ahead on which option; then full spec + build. Connects to the previously-deferred "localStorage to server-side by email/ID" architectural note.
- **DEV-only test-fidelity bug (RESOLVED v1.30):** during `?dev=1` simulation the tracker card showed the REAL date instead of the simulated `TODAY` (owner saw "שבת 6 ביוני" while simulating 2/6). Root cause was the v0.44 midnight-rollover interval clobbering the simulated `today` after ~60s; fixed by skipping that interval in DEV (see v1.30). This also fixed the weekly-summary tip misfiring on day 3.


## v0.88 - Tracker clarity (week label, 10-week cap, reward hint)
Small fixes after owner testing (he saw tasks that "had not started" and asked when rewards arrive).
- `CheckinCard` header now shows a `שבוע {week}` pill so it is obvious which program week the app computed (driven by `profile.startDate`). Helps diagnose "too many tasks" - the active list is cumulative from week 1 up to that week.
- Tracker week capped at 10: `ciWeek = Math.min(week, 10)` in DayScreen (card + tasks) and `Math.min(programWeekFor(...), 10)` in the modal, so it never shows beyond the defined schedule even if the start date is far in the past.
- Added a one-line reward hint under the card button: "כל יום שתמלאי, נכנסת עוד מדליה לאוסף" (clarifies when medals are earned - one per filled day, streak builds 1..6).
- No change to the task schedule itself (startWeeks). Open: owner to confirm the encoded startWeek per task matches the real program rollout (the schedule was read from the booklet PDF and may need per-task correction in `src/checkins.js`).
- VERSION 0.87->0.88 (App.jsx only; re-upload src/App.jsx). qa unaffected.


## v0.89 - Day strip reaches the program start (backfill any past day)
Owner test: started 6 weeks ago, scrolled back to view "week 1" but the day strip only went 10 days back, so the leftmost reachable day was ~week 5 (showing ~13 cumulative tasks) - looked like "all of week 6's tasks on week 1". Root cause was navigation, not the task gating (each day already shows its own week via `programWeekFor(startDate, date)`).
- Day strip range now spans from the program start to today (+4 future as before): `backN = Math.min(74, Math.max(10, programDayNumber(startDate, today) - 1))`, `days = length backN+5 from today-backN`. New users keep the old 10-back behavior; mid-program users can scroll to any past day to view/backfill (matches the WhatsApp "update past days"). Future days stay disabled/dimmed; strip still auto-scrolls to today.
- Now navigating to a real week-1 day shows only week-1 tasks (2), confirming the per-day gating is correct.
- VERSION 0.88->0.89 (App.jsx only; re-upload src/App.jsx). qa unaffected.


## v0.90 - Tracker ring (medal in center) + macro strip hidden
- `SHOW_MACRO_STRIP` flag (next to TRACKER_ENABLED) gates the day-screen fat/carbs/fiber strip. Set to false for now per owner (kept for future). With it hidden the daily tracker card sits higher. Protein/calorie/steps/water rings are unaffected.
- `CheckinCard` redesigned: the flat progress bar is replaced by a circular ring (same style as the calorie/protein/steps rings: r=54, C.brand on C.brandBg track, fills by done/total) with the OWNER'S medal (`/medals/medal.webp`) centered inside it. Medal is greyscale until she has >=1 done. The whole card is tappable to open the check-in (the explicit button was removed). Keeps title + week pill + streak medals row + lock state + reward hint.
- VERSION 0.89->0.90 (App.jsx only; re-upload src/App.jsx). qa unaffected.


## v0.91 - Tracker ring polish + collection cabinet replaces the streak flame
- Tracker ring fill is now a distinct pink (`#E8589B` on `#FBE0EE` track) so it differs from the calorie rose / protein purple / steps amber / water blue rings.
- Medal inside the ring enlarged (ring 104->112, medal 54->78).
- Version number moved OFF the top header (top now just "MyPrime") to the BOTTOM of the day screen ("MyPrime · v{VERSION}", small, faint) so the top layout reads cleaner.
- Celebration trigger made predictable: `finishCheckin` now opens `CheckinCheer` (medal + animated confetti + Anat note) whenever "סיימתי להיום" is tapped and the day has >=1 answer (previously only for today). So the confetti appears right after finishing the day's check-in.
- The top-left flame "X ימים ברצף" pill is REPLACED by a "ארון המדליות והגביעים" button (medal icon + current check-in streak, opens the collection). DayScreen prop `onStreakTap` -> `onOpenCollection`; the old StreakCheer "streak" sheet is now unused (left in place, harmless).
- NEW `CollectionModal` (sheet "collection") = the cabinet: medal count (`trackerStats` = days with >=1 answer) + current streak, and a 4-col grid of the 10 weekly trophies (`trophy-1..9`, champion for week 10) - earned (full colour) when she filled >=1 day that program week, else greyed. Trophy "earned" = any filled day in that week (lenient v1; refine to "week completed" when the weekly summary lands).
- VERSION 0.90->0.91 (App.jsx only; re-upload src/App.jsx). qa unaffected; check-logic 7/7.


## v0.92 - Medal/streak/trophy actually register; header redesign; bug fixes
Owner filled all of week 1 but got no medal, no confetti, no trophy. ROOT CAUSE: week 1 has only AUTO tasks (steps + journal); the code only counted MANUAL answers in `checkins`, so `checkins[date]` stayed empty -> nothing registered.
- **Completion marker:** finishing the check-in ("סיימתי להיום") now sets `checkins[date]._done = true` and ALWAYS opens `CheckinCheer` (medal + confetti + Anat note). Works on all-auto weeks. A medal = a completed day, intentional (she tapped done).
- `checkinStreak` now counts consecutive `_done` days and SKIPS Saturday (optional rest day) so a skipped Saturday does not break the streak.
- `trackerStats` medals = number of `_done` days (the cabinet count now rises).
- **Trophy logic** = `weekTrophyEarned(checkins, startDate, w, today)`: earned once the week's Friday has passed AND every eligible non-Saturday day (program day >=3, date <= today) of that program week is `_done`. Matches owner: "Sunday to Friday is enough, Saturday not required". CollectionModal uses this (was the lenient any-filled-day rule).
- Cabinet answer to owner: medals accumulate across the WHOLE program (one per completed day, no cap on total); trophies are one per completed week (1-9) + champion (week 10).
- **Medal in the ring enlarged** again (ring 112->120, medal 78->92).
- **Top header redesigned** (day screen): removed the global "MyPrime" top bar. Header row now = name/היי + date/week (right corner), "האוסף שלי" button in the middle (small medal icon removed - text only), and an APP-ICON on the left (~60px, ~2x the pill height). Icon loads `/app-icon.webp` with an onError fallback to the medal until the real asset arrives.
- Saturday is fillable (owner is fine with it); only the trophy ignores Saturday.
- VERSION 0.91->0.92 (App.jsx only; re-upload src/App.jsx). qa unaffected; check-logic 7/7.

## OPEN (owner to provide / next)
- **App icon + favicon asset:** owner to send the logo-in-medal as a square transparent PNG. Drop it at `public/app-icon.webp` (header auto-picks it up) and add `<link rel="icon" href="/app-icon.webp">` to index.html for the browser/Chrome favicon. Deferred until the asset arrives.
- **Weekly summary (still next):** warm end-of-week recap with the week's trophy + champion for week 10.


## v0.93 - App icon uses the existing medal (left corner)
- Header app icon now uses the existing medal (`MEDAL_SRC`) directly instead of waiting for a separate `/app-icon.webp` (owner: just use the medal we have). Removed the onError fallback.
- Nudged it into the left corner: header padding "2px 16px 0" -> "2px 16px 0 6px".
- Favicon still open (would point at the medal too if/when wired in index.html).
- Open design question raised by owner: what the streak ("ימים ברצף") means as a reward and how backfilling past days affects it. No code change yet - awaiting his decision (keep streak as a motivator vs simplify to medal-per-day + trophy-per-week only).
- VERSION 0.92->0.93 (App.jsx only).


## v2.05 - Device limit disabled for beta (api/access.js)
- The 2-concurrent-device cap caused real problems during onboarding: one woman fumbling install (iOS Safari vs installed PWA = separate storage; every remove+re-add = new device id) racks up 2+ device ids and hits "device_limit" without actually having 2 phones. Disabled the cap for the beta: added module const MAX_DEVICES (0 = no limit) in api/access.js and gated the count check on `MAX_DEVICES > 0`. Device tracking (ZADD/EXPIRE/prune of `devices:<email>`) STILL runs, so Ron can still inspect multi-device usage in Upstash and re-enable later by setting MAX_DEVICES = 2. Redis untouched (push + backup unaffected). Email gate still blocks non-registered emails.
- App VERSION 2.04->2.05 (api change shipped as a release; App.jsx only the VERSION const). esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: api/access.js, src/App.jsx, CLAUDE.md.

## v2.04 - Oat item renamed (drop "דייסה")
- FOODS "oat": name "דייסת שיבולת שועל" -> "שיבולת שועל". The 380kcal/100g value is for dry oats; "דייסה" (porridge) implied the cooked dish (~70kcal) and could mislead. Search field keeps "דייסה" as an alias so it's still findable. (Resolves the L1 food-audit flag.)
- VERSION 2.03->2.04. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v2.03 - Gate fetch_failed message (was wrongly showing "email not found")
- AccessGate: when access-sheet fetch fails (api/access.js already returns reason "fetch_failed"), the gate fell through to the default "המייל לא נמצא" denial. Added a distinct branch: "תקלה טכנית זמנית, נסי שוב בעוד רגע." The "נסי שוב" retry button already shows for this reason, and fetch_failed already does NOT count as a failed attempt (only not_registered increments). No api change needed.
- VERSION 2.02->2.03. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v2.02 - Report tab icon BarChart3 (was TrendingDown)
- Bottom-nav "דוח" tab icon changed from TrendingDown (downward arrow - read as decline/negative and clashed with the weight-card arrow) to BarChart3, a clearer "report/stats" symbol. Imported BarChart3 from lucide-react. TrendingDown still used by the weight card + report jump button.
- VERSION 2.01->2.02. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v2.01 - Report frames in brand rose (was gray)
- ReportScreen: changed the gray borders to the brand rose (C.brand #D45D79) for more prominence, per Ron. Affected: cardBox (the report cards - steps/calorie/weight/protein), jumpBtn (the 3 top jump buttons), and the inner 7-day-average box frame (bumped 1px->1.5px). Left untouched: internal cell dividers (kept C.line), chart tooltips/zero-value bar fills (data viz), and the global Btn ghost variant (used app-wide, incl. the in-card "+ עדכון צעדים" button). First look; easy to dial back if too strong.
- VERSION 2.00->2.01. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v2.00 - Remove user-facing "דמו", platform-correct refresh copy
- Replaced user-facing "דמו"/"הדגמה" with "אפליקציה" (naming) or "בטה" (status): SplashScreen badge "דמו"->"בטה"; IntroOverlay header "דמו MyPrime"->"אפליקציית MyPrime"; intro body "גרסת הדגמה (בטה)"->"גרסת בטה"; feedback-bubble title "הערות לדמו"->"הערות לאפליקציה". (DEV-only "דלג ישר לדמו" skip button left; not user-facing.)
- Fixed IntroOverlay refresh copy that wrongly told everyone to pull down to refresh: now platform-correct (Android pull-down; iPhone close fully + reopen, pull-down doesn't work on iOS).
- VERSION 1.99->2.00. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.99 - Rename misleading reset button
- "התחל דמו מחדש (חזרה לאונבורדינג)" -> "מחיקת כל הנתונים והתחלה מחדש" (the old name sounded harmless but the action wipes everything; also dropped "דמו" since it's a real app now). Reset confirm title -> "למחוק הכל ולהתחיל מחדש?".
- Note: "דמו" still appears in the feedback-bubble panel (badge, "דמו MyPrime · v..", "הערות לדמו") and a DEV-only onboarding skip button (not user-facing). Left as-is pending owner decision.
- VERSION 1.98->1.99. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.98 - Confirmation dialogs for reset / logout
- Profile "התחל דמו מחדש" (resetDemo - WIPES all local data: log/weights/steps/water/checkins, back to onboarding) and "התנתקות מהמכשיר" (logoutDevice - does NOT delete data, frees device slot, re-login with email) now each open a confirmation modal before running.
- Reset confirm: clear warning that everything is erased and irreversible, red confirm button ("כן, מחקי והתחילי מחדש"), + ביטול; if backup enabled, adds a line that data can be restored with the code. Logout confirm: reassures data is kept + re-login with email.
- VERSION 1.97->1.98. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.97 - Demo seed log no longer shown to real users (IMPORTANT pre-launch fix)
- BUG: log state initialized to INITIAL_LOG (demo meals for today + yesterday) for EVERY fresh user, not just dev. Real women would see fake logged meals (oat/coffee/banana/chicken/rice) on day 1 + yesterday. Fixed line: `useState(saved?.log || (DEV ? INITIAL_LOG : []))` - real (non-?dev=1) users now start with an EMPTY diary; the seed only loads in dev mode for demos/screenshots.
- Note: devices that already ran the old code have the seed persisted in localStorage; they need a data reset (reinstall) or manual delete to clear. New installs are clean.
- VERSION 1.96->1.97. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.96 - Tour button stays visible through week 1
- v1.91 hid the on-screen "סיור באפליקציה" button once the tour was completed (appTour in tipsSeen). That made it vanish after the owner did the tour. Removed the appTour condition: button now shows whenever week===1 && progDay>=3, regardless of whether the tour was done, so it's a stable re-entry point all of week 1 (day 3+). (Still week-1-scoped; naturally gone in week 2+.)
- VERSION 1.95->1.96. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.95 - Refresh/update FAQ (reachable by existing users)
- The iOS refresh instructions added in v1.94 live only in the onboarding install-popup, which already-onboarded users can't reach. Added a FAQ item ("האפליקציה נראית ישנה או לא מתעדכנת - איך מרעננים?") so it's reachable for everyone from profile -> "שאלות, תשובות ועזרה". Android: pull-to-refresh / reopen. iOS: close fully + reopen; last resort remove+re-add WITH a backup-first caveat (re-add resets device data).
- VERSION 1.94->1.95. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.94 - iOS notification guidance
- iOS-only hint "כשיופיע חלון של הטלפון - בחרי אישור" added near the enable button in the onboarding notify step (OnboardNotify, shown when isIOS && !needInstall && not on/denied) and in the day-screen opt-in prompt (gated by iOS UA test). Android shows nothing extra (its prompt is just Allow/Block). Reason: iOS permission dialog offers Allow / Allow in Scheduled Summary / Don't Allow; only "אישור" gives timely 19:00 delivery.
- Install-instructions modal: added an iOS "לרענון האפליקציה באייפון" section (pull-to-refresh doesn't work in an installed iOS PWA; close fully and reopen).
- VERSION 1.93->1.94. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.93 - Notification opt-in step in onboarding
- Added a 6th onboarding step (step 5, "תזכורת יומית"): value framing + "אפשרי תזכורת יומית" button (the tap satisfies the iOS user-gesture requirement) -> enableDailyReminder(email). New OnboardNotify component. Progress bar 5->6 segments; footer now finishes at step 5 (step 4 -> "המשך").
- iOS branch: if iOS and NOT installed to home screen (Safari), shows install-first guidance instead of a button that can't work; supported/denied/error states handled. Fixed 19:00 (custom time deferred - free, needs hourly cron).
- Day-screen one-time prompt (v1.92) kept: granted users never see it (gated on permission "default"); only nudges those who skipped / existing users.
- VERSION 1.92->1.93. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.92 - Daily 19:00 reminder (Web Push)
- NEW FEATURE: native Web Push (VAPID) on the existing Vercel + Upstash stack (no Firebase). Reminds each subscribed woman at 19:00 Israel that the diary is open.
- NEW FILES: public/sw.js (service worker: push + notificationclick), api/subscribe.js (GET returns VAPID public key, POST stores subscription in Redis HASH `push:subs`), api/notify.js (cron target: sends to all subs, prunes 404/410, gated to hour===19 Asia/Jerusalem unless ?force=1), vercel.json (crons 16:00 & 17:00 UTC -> code gates to 19:00 Israel, DST-safe). package.json: added web-push.
- App.jsx client: registers /sw.js; silent re-subscribe on every open if permission already granted; ReminderRow in profile (enable/off/denied/unsupported states, uses Clock icon); one-time opt-in prompt card on the day screen (after intro/tour, gated by tipsSeen "notifyAsked"); helpers enableDailyReminder/disableDailyReminder/urlBase64ToUint8Array. Passes gateEmail to ProfileScreen.
- iOS caveats (documented): push only on iOS 16.4+, app installed to home screen, permission from a user gesture. Android/desktop work in-browser. Reused lessons from the owner's barbur-poker FCM knowledge (notificationclick handler, gesture-triggered permission, re-register on open).
- REQUIRES OWNER VERCEL SETUP (feature is inert until done): env VAPID_PUBLIC, VAPID_PRIVATE (generated), VAPID_SUBJECT (mailto:), CRON_SECRET (for Vercel cron auth) and/or NOTIFY_SECRET (for external cron). Deploy with vercel.json for crons (or hit /api/notify?secret=... from an external cron at 19:00 Israel). Test send: /api/notify?secret=...&force=1.
- VERSION 1.91->1.92. esbuild clean, check-logic 7/7, 0 em/en dashes, api+sw node --check ok, JSON valid. CHANGED/NEW FILES: src/App.jsx, CLAUDE.md, public/sw.js, api/subscribe.js, api/notify.js, vercel.json, package.json.

## v1.91 - Tour button shows day 3+ (not only day 3)
- The on-screen "סיור באפליקציה" pill was gated to progDay===3 && week===1 (exact day 3). Changed to week===1 && progDay>=3 && tour-not-completed, so a woman entering on day 4+ (within week 1) still sees a way to open the tour from the main screen; it hides once she finishes the tour (appTour in tipsSeen). Auto-tour already covered pd>=3; this is the manual entry point. Context: week-1 group entering on day 4 tomorrow (week-2 group not invited yet).
- VERSION 1.90->1.91. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.90 - Weight confirm modal: choice before changing
- Profile weight modal was post-save (only "הבנתי", number already changed). Now it confirms BEFORE applying: saving "משקל התחלתי"/"משקל יעד" stashes the value (pendingWeight) and opens "רק לוודא" with two buttons: "אני רוצה לשנות בכל זאת" (applies) and "צאי בלי לשנות" (ghost, cancels). Backdrop tap = cancel. The number is NOT changed unless she confirms.
- VERSION 1.89->1.90. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.89 - Report header + jump buttons + protein card stats
- Report title "דוח והתקדמות" -> "דוח התקדמות".
- Added 3 quick-jump buttons under the title that smooth-scroll to the matching card: "דוח צעדים" (only when stepsOpen), "יעד קלורי", "משקל". Implemented with refs + scrollIntoView.
- Protein card: "ימים ביעד" moved INTO the "יעד חלבון" card (two-column: protein goal | days-on-target). The separate "ירידה מתחילת המעקב" box removed entirely. The old bottom two-box row is gone. Before week 3 (no protein card) "ימים ביעד" still shows as a standalone box so the stat isn't lost.
- VERSION 1.88->1.89. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.88 - Report restructure (titled cards) + weight flow
- ReportScreen: every card now has a big bold heading with an underline divider + stronger card frame (1.5px border, radius 16, more spacing, light shadow) for clearer separation. New CardHeading component. Headings: "דוח צעדים" (Footprints), "עמידה ביעד הקלורי" (Target, kept wording, now big), "דוח משקל" (TrendingDown).
- Protein goal promoted from a tiny gray footer box to its own titled card "יעד חלבון" (Dumbbell, macroP color), shown from week 3 (proteinFocus). Bottom mini-row now always shows ימים-ביעד + ירידה-מתחילת-המעקב.
- WEIGHT DECISION (Ron): weight tracking is in the report only. New WeighInTips box (3 rules: once a week / same day / morning, no clothes) shown under "דוח משקל" AND inside the "הזנת משקל" modal.
- Profile: saving "משקל התחלתי" or "משקל יעד" now shows a non-blocking ack modal ("רק לוודא גג") clarifying ongoing weight updates are done in the report. Change is still saved; she taps "הבנתי". Fires on every such save.
- VERSION 1.87->1.88. esbuild clean, check-logic 7/7, 0 em/en dashes. CHANGED FILES: src/App.jsx, CLAUDE.md.

## v1.87 - App (home-screen) name + two small text fixes
- PWA home-screen name was just "MyPrime" (confusing). Changed to "MyPrime מעקב": manifest.webmanifest short_name "MyPrime" -> "MyPrime מעקב" and name "MyPrime - מעקב יומי" -> "MyPrime מעקב"; index.html apple-mobile-web-app-title "MyPrime" -> "MyPrime מעקב" and <title> -> "MyPrime מעקב" (also removed an em-dash that was in the old title).
- Profile FAQ row label: "שאלות ותשובות ועזרה" -> "שאלות, תשובות ועזרה" (comma instead of first vav).
- Tour feedback step: dropped the leading vav -> "יש לך הערה? ...".
- CHANGED FILES THIS ZIP: src/App.jsx, CLAUDE.md, public/manifest.webmanifest, index.html. (Note: manifest+index are NEW files in the zip vs recent App.jsx-only zips - both must be deployed for the home-screen name to update.)
- VERSION 1.86->1.87. esbuild clean, check-logic 7/7, 0 em/en dashes.

## v1.86 - Feedback coachmark moved from onboarding to the TOUR
- Owner clarified: the feedback-bubble coachmark belongs in the guided TOUR (סיור), not the onboarding. Reverted ALL the v1.84 onboarding bits (coach/coachSeen state, next() routing, the in-onboarding TutorialOverlay render, and the forceBack prop on TutorialOverlay).
- Added it as a normal TOUR step in TOUR_TAIL, right AFTER the nav-profile step (i.e. after the whole bottom bar incl. the profile explanation), before the daystrip step: { sel: "notesfab", text: "ויש לך הערה? נשמח מאוד לשמוע ..." }. Uses the existing tour mechanism exactly. data-tut="notesfab" on the NotesFab button is kept.
- VERSION 1.85->1.86. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes.

## v1.85 - Feedback bubble raised again
- Bubble button bottom 230 -> 420 (was sitting on the trophy in the collection; owner wants it just below the calorie ring + steps ring). Still a best-guess pixel value; fine-tune on device.
- NOTE re: the onboarding feedback coachmark "not showing / skipped" - it was added in v1.84; if testing on <=1.83 (the 230-px bubble) the coachmark does not exist yet. Code verified intact (coach/coachSeen state, next() routes step0 through it, data-tut="notesfab", forceBack). Should appear once v1.84+ is deployed.
- VERSION 1.84->1.85. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes.

## v1.84 - Add-method button labels + onboarding feedback coachmark
- AddModal method buttons: removed "חדש" tag from "ספרי לי מה אכלת" (keeps "(AI)" subtitle). On "צילום ארוחה": removed "מהיר" tag and changed subtitle "המהיר ביותר" -> "זיהוי אוטומטי (AI)" to mark it AI-powered like the other.
- Onboarding feedback coachmark: after the profile step (step 0), a one-step TutorialOverlay spotlights the feedback bubble (added data-tut="notesfab" to the NotesFab button) with text "יש לך הערה? נשמח לשמוע כדי לשפר ..." + המשך/הקודם. Reuses the existing coachmark mechanism exactly. Added a forceBack prop to TutorialOverlay so the back button shows on a single-step coachmark (idx 0). State: coach + coachSeen (shows once; next() on step 0 routes through it before advancing to step 1). NotesFab renders above onboarding (zIndex 13) so the spotlight finds it.
- VERSION 1.83->1.84. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes.

## v1.83 - Feedback bubble (NotesFab): position + panel restyle
- Bubble button raised from bottom:78 to bottom:230 (still left side / insetInlineEnd:14). NOTE: target was "height of the filling circles" - 230 is a best-guess, may need a nudge once owner sees it on-device.
- Notes panel changed from a bottom-sheet (alignItems flex-end, top-only radius, full width) to a CENTERED card: alignItems/justifyContent center + overlay padding 16; borderRadius 20 (all corners); maxWidth 460; bigger padding (20/22/24); textarea rows 3->4. Added highlighting brand ring (border 2.5px solid C.brand) + stronger shadow.
- VERSION 1.82->1.83. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes.

## v1.82 - Onboarding validation clarity + gate email label
- errNote (onboarding step 0 validation) is now bold + red (#D7263D) + larger (was faint amber 13px), so it is clear WHERE the missing/invalid field is. numStyle error border also switched amber -> red.
- The "האם את מעוניינת להשתמש ... בכל ימות השבוע" unanswered error note moved ABOVE the gray helper text (right under the buttons) so it is tied to the question and not buried; it inherits the new bold-red style.
- AccessGate email field placeholder "המייל שלך" -> "המייל איתו נרשמת לתוכנית" (clarifies which email to enter).
- VERSION 1.81->1.82. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes.

## v1.81 - Household measures: כף / כפית on external products
- Anat approved the proposal: add כף (15g) + כפית (5g) universally; כוס stays liquids-only (avoids big calorie errors on powders, e.g. a cup of PB2 powder != 240g).
- External products (IL-food il_, Open Food Facts off_, USDA usda_, barcode bc_, favorites fav_) previously offered ONLY "100 ג׳"; this is the PB2 case. Appended כף(15)/כפית(5) to all 5 builders (def stays 0 -> 100ג׳ default). Also added כף/כפית to measuresForUnit (both unit branches; כוס already only on the ml branch).
- Local FOODS were left as-is (curated per-product measures; relevant items already carry כף/כוס). Did NOT force כף/כפית onto items like banana/steak. Can extend specific local items (e.g. add כפית to tahini) if wanted.
- Measure pills auto-append " · {g} ג׳" when the label has no number, so כף shows as "כף · 15 ג׳". User can still fine-tune exact grams.
- VERSION 1.80->1.81. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes.

## v1.80 - Weekly summary steps: bold "השבוע"
- Per owner, instead of changing the report's averaging window, the weekly SUMMARY steps line now says "ממוצע הצעדים לימים שדיווחת **השבוע**" with "השבוע" in bold, clarifying the summary average is for THIS program week (vs the report's rolling 7-day). Applied to summaryTaskLine steps (n>=2) and the week-1 steps line; both detail fields became JSX fragments (the modal renders {l.d} and {ln}, so JSX is fine).
- OPEN/parked: the report card itself still uses the rolling last-7-days window; owner chose the wording route over re-aligning the report. Can revisit if still confusing.
- VERSION 1.79->1.80. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes.

## v1.79 - Weekly summary: Hebrew dual form (פעמיים / יומיים)
- Bug: counts of exactly 2 read as "2 פעמים" / "2 ימים" instead of the Hebrew dual "פעמיים" / "יומיים". Code handled 1 (singular) and 3+ (plural) but not 2 (dual).
- Fix: added module-scope helpers sumDays(n) / sumBDays(n) / sumTimes(n) (1 -> יום אחד/ביום אחד/פעם אחת, 2 -> יומיים/ביומיים/פעמיים, 3+ -> N ימים/ב-N ימים/N פעמים) and applied them across all summaryTaskLine cases (steps, journal, water, protein, sleep, breathing, gratitude, grains split+combined, pelvic, probiotics, antiinflam, bonedensity) and the week-1 lines. 15 call sites in total.
- Scope: only days/times per owner request. Counts like "2 אימוני כוח" / "2 ארוחות" (averages) were left as-is; can extend to "שני/שתי" forms if wanted.
- OPEN (discussed, not yet resolved): the report steps card ("ממוצע X ימים", rolling last-7-days) can disagree with the weekly summary ("this program week"), because the rolling window spills into the previous week. Need to decide whether to (a) keep both as different clearly-labeled metrics, or (b) make the report average week-aligned.
- VERSION 1.78->1.79. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes. (Bracket counter ( -1 = the ":)" smiley in the profile coachmark.)

## v1.78 - Report steps-average clarification + diary "מה שהוזן היום"
- **Report (steps card):** added a small gray clarification under the goal/average card: "הממוצע מחושב לפי הימים שהזנת בהם צעדים, מתוך 7 הימים האחרונים". (The "ממוצע X ימים" card uses steps7stats = rolling last-7-days average over days that have data; the X is the count of days-with-data in that window, which confused testing.)
- **Diary:** the "מה שהוזן" section header is now BLACK + BOLD (was C.faint/gray) and renamed to "מה שהוזן היום". FAQ reference updated to match.
- VERSION 1.77->1.78. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes. (Bracket counter ( -1 = the ":)" smiley in the profile coachmark.)

## v1.77 - Week-1 summary singular/plural fix
- Bug: the WEEK 1 summary lines used raw interpolation (`${stepsDays} פעמים`, `ב-${journalDays} ימים`), so a value of 1 read as "1 פעמים" / "1 ימים". The singular handling existed for weeks 2-10 (summaryTaskLine) but week 1 (wk1Lines) was missed.
- Fix: added wk1StepsLine / wk1JournalLine with 0 / 1 / many variants matching the week 2+ phrasing ("פעם אחת" / "ביום אחד" / "X פעמים"|"X ימים").
- Note: SUMMARY_COUNT_PHRASE / SUMMARY_AVG_PHRASE (top of summary section) also lack singular handling but are DEAD CODE (defined, never used) - not rendered, left as-is.
- VERSION 1.76->1.77. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes. (Bracket counter ( -1 = the ":)" smiley in the profile coachmark.)

## v1.76 - DEV: don't cap the simulated start date
- Bug: in DEV mode, "קבע יום 1" (devAnchorDay1) sets profile.startDate to the Sunday of the simulated TODAY, but the startDate-cap effect immediately forced it back to gateStartDate (the sheet date), making it impossible to simulate "I just started this week" - broke testing of early weeks.
- Fix (both DEV-only, zero effect on real users): (1) the cap effect now `if (DEV) return;` before aligning startDate to the sheet date; (2) ProfileScreen receives `maxStart={DEV ? null : gateStartDate}` so the start-date editor offers all Sundays in DEV.
- VERSION 1.75->1.76. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes. (Bracket counter ( -1 = the ":)" smiley in the profile coachmark string.)

## v1.75 - Photo UX: program-window gate + gentle nudges (client side of v1.73)
- **Photos only during the 10-week program (days 1-70).** `sendAiImage` and the "צילום ארוחה" entry button both check `programDayNumber(startDate, TODAY) > 70`; if the window is closed they show the Anat end-message in chat instead of opening the camera / calling AI. (AddModal now receives a `startDate` prop, passed from `profile.startDate`.)
- **Gentle in-chat nudges (Anat voice), on a real photo analysis only (`!r.limited`):**
  - EVERY time she reaches 3 photos in one day (`bumpPhotosToday()` -> localStorage `myprime_photos_today` {date,n}; fires when n===3).
  - ONCE at 35 total photos (`r.photoCount` from the server `x-photo-count` header; flag `myprime_photo_hs35`).
  - Both show: "הערה קטנה ממני אלייך 💜 ... מוגבלת ל-70 תמונות. לאחר מכן תמיד אפשר לתאר לי בטקסט מה אכלת." (single note even if both triggers coincide).
- `aiNutritionChat` now returns `limited` (true on 429) and `photoCount` (parsed from the `x-photo-count` response header) so the client can drive nudges without double-counting on limit hits.
- The HARD 70 cap + the end/daily messages live server-side (v1.73); this version is the soft pacing UX so she doesn't binge to the wall.
- VERSION 1.74->1.75. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes. (Bracket counter ( -1 is the ":)" smiley in the v1.74 profile string; esbuild confirms a clean parse.)


- **Steps coachmark**: reworded to "כאן מזינים את מספר הצעדים. פותחים את אפליקציית הבריאות בטלפון, רואים כמה צעדים נצברו היום, ומזינים את המספר כאן." + a BOLD reassurance line "אפשר לעדכן את הצעדים כמה פעמים שתרצי במהלך היום (וגם לימים קודמים) - אל דאגה." (tip `text` is rendered as `{cur.text}` so it accepts a JSX fragment with `<b>`).
- **Profile coachmark**: appended "ניתן לעדכן את נתוני הפרופיל בכל זמן שתרצי :)".
- OPEN (owner to raise with Anat): how weight is referred to / where it's updated. The profile coachmark's "update profile data anytime" could confuse a user into thinking weight is updated in the profile rather than in the report (דוח). Wording to be finalized with Anat.
- VERSION 1.73->1.74. App.jsx only. esbuild clean, check-logic 7/7, 0 em/en dashes. (Bracket counter shows ( -1 purely from the intentional ":)" smiley inside the profile string - not a code issue; esbuild confirms a clean parse.)


- **api/ai.js: 70-photo hard cap per user** (`AI_PHOTO_LIMIT`, default 70). A "photo" call is detected by an image block in `body.messages`. Counted server-side in Upstash (`ai:photos:<email>` INCR, EXPIRE ~210d) so it CANNOT be reset by clearing the browser - this is the real cost guarantee on the expensive (image) calls. On the call past the budget, returns 429 `scope:photos` with the Anat end-message ("סיימת את צילומי הארוחה לתקופת הליווי 💜 ... אפשר לתאר לי בטקסט..."), which the existing `aiNutritionChat` 429 handler shows in chat. Also sets `x-photo-count` response header (for the upcoming client nudges).
- **Daily cap lowered 25 -> 10** (`AI_DAILY_LIMIT` default). Caps the theoretical worst-case bill (~$10.7k -> ~$4.3k/mo at full scale) with negligible impact on a normal user. New daily-cap message: "הגעת למכסת ניתוחי ה-AI להיום 💜 אפשר להמשיך לתעד ארוחות דרך חיפוש או ברקוד, ומחר המכסה מתאפסת."
- Body is now parsed once at the top of the handler (needed for photo detection); the final API-call block reuses it.
- The matching CLIENT photo-UX (program-window gate + the 3/day and 35 nudges) ships separately in v1.75 (see below). v1.73 here is the SERVER hard cap only. Even before v1.75 is deployed, the server still caps cost (70 photos) and the end/daily messages still surface via the existing aiNutritionChat 429 handler - the client just lacks the pre-emptive camera gate and the gentle nudges. (An earlier draft of this entry wrongly claimed the client UX was already present in the delivered App.jsx - it was not; it landed in v1.75.)
- VERSION 1.72->1.73. Changed: api/ai.js (real change), src/App.jsx (VERSION bump only). esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7, ai.js node --check ok.


- **Client-side image downscale before AI photo analysis** (biggest cost lever). New module helper `downscaleImage(file, maxDim, quality)` draws the photo onto a canvas capped at 1024px longest side and re-encodes JPEG q=0.82; `onPhoto` now downscales (1024 / 0.82) before `sendAiImage`, with a fallback to the original file if the canvas path errors. Full-resolution phone photos were being sent as-is (huge image input-token cost); this cuts it several-fold with negligible food-recognition impact. (Meal photo has a single entry path: the `<input type=file capture>`; the getUserMedia video is only the barcode scanner.)
- **max_tokens trimmed 1000 -> 800** on `aiNutritionChat` (the shared photo+chat call). 800 (not 700) to avoid truncating multi-item meal JSON.
- Deferred per owner: switching `AI_MODEL` to Haiku (env, owner to A/B test accuracy). Prompt caching discussed separately.
- VERSION 1.71->1.72. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.71 - Device logout (free the slot)
- Added a "התנתקות מהמכשיר הזה" button in ProfileScreen (below the reset button). It frees this device's slot server-side and returns to the gate, WITHOUT deleting her data (logging back in with the email restores everything).
- Client `logoutDevice()`: calls `${ACCESS_ENDPOINT}?email=&device=&logout=1`, then clears the stored access email/start-date and resets gate state (keeps STORAGE_KEY profile data + device id). Passed to ProfileScreen as onLogout.
- api/access.js: new early `logout` branch - `ZREM devices:<email> <device>` (when Upstash configured) and returns {ok:true}, before any sheet lookup.
- Solves the real beta gap: a user on her 3rd device (or replacing a device) can free a slot herself instead of waiting for the 24h TTL.
- VERSION 1.70->1.71. Changed: src/App.jsx, api/access.js. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7, access.js node --check ok.

## v1.70 - Hide skip-to-demo for real users + prominent install CTA + install FAQ
- **"דלג ישר לדמו" skip button is now DEV-only** (wrapped in `{DEV && ...}`), so real participants can't bypass onboarding into demo mode; still available with ?dev=1 for testing.
- **Install-as-app CTA upgraded** from a small underlined link to a prominent brandBg box at the top of onboarding: "📲 מומלץ מאוד להתקין את האפליקציה בטלפון" + "תרצי הנחיות? הקישי כאן" + chevron; opens the existing install modal.
- **New FAQ item (first)** in profile Q&A: "איך מתקינים את האפליקציה בטלפון" with Android(Chrome)/iPhone(Safari) Add-to-Home-Screen steps.
- VERSION 1.69->1.70. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.
- NOTE (no code): the 2-device limit not blocking the 3rd login is an env/deploy issue, not code - device id is sent correctly (myprime_device_id UUID per browser). Requires UPSTASH_REDIS_REST_URL + _TOKEN set AND a redeploy.

## v1.69 - Intro modal text black
- The two IntroOverlay (demo intro) paragraphs (greeting + daily-refresh recommendation) changed from gray (C.sub) to black (C.ink) per owner. Feedback box unchanged.
- VERSION 1.68->1.69. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.68 - Backup-step privacy text black
- The two privacy/backup paragraphs on onboarding step 3 ("מה שאת ממלאת... נשמר במכשיר שלך בלבד..." and the encrypted-cloud-backup paragraph) changed from gray (C.sub) to black (C.ink) per owner.
- VERSION 1.67->1.68. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.67 - Summary disclaimer text black
- The liability disclaimer on the onboarding summary ("ההמלצות בתוכנית מבוססות...") changed from gray (C.faint) to black (C.ink) per owner.
- VERSION 1.66->1.67. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.66 - Goal-weight default = entered current weight + gate consent text black
- **Goal weight no longer defaults to a fixed 66.** `goalKg` now starts null; `goalEff = goalKg == null ? weightN : goalKg` is used for the stepper value, draft goalWeightKg, projection, and the summary text. So the "משקל רצוי" stepper starts at her entered current weight and she lowers it from there. If left at current weight, projection() returns maintain (goal>=current) so the summary reads as a maintenance plan rather than odd "0 weeks". Change still clamps to Math.max(minHealthyKg, Math.min(weightN-0.5, v)).
- **Gate consent now black (per owner):** the privacy disclosure paragraph (C.faint -> C.ink) and the "קראתי ואני מאשרת" label (C.sub -> C.ink) on the access gate are now black instead of gray.
- VERSION 1.65->1.66. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.65 - Liability disclaimer on summary
- Added a disclaimer line on the onboarding summary step (step 4, under the kcal target): recommendations are based on the data she entered, she is responsible for accurate/current data, and the app is a tool only - not medical/nutritional advice or a substitute for it. Faint text + Info icon. Owner to pass wording to their lawyer; can be upgraded to an acknowledged checkbox if the lawyer prefers.
- VERSION 1.64->1.65. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.64 - Tighter onboarding ranges (owner)
- Adjusted step-0 validation ranges per owner: age 33-80 (was 18-120), height 120-210 cm (was 120-230), weight 50-150 kg (was 30-300). Age invalid-note made generic ("יש להזין גיל תקין"). NOTE: owner said height "can't be more than 1.20m" - interpreted as a 120 cm MINIMUM (literal reading would block everyone); confirm if a different bound was meant.
- VERSION 1.63->1.64. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.63 - Fix onboarding number inputs (one-digit bug) + sensible ranges
- **Fixed the "can only type one digit" bug** on the step-0 age/height/weight inputs. Root cause: `Field` was defined INSIDE Onboarding, so it was a new component type on every render; typing a digit -> setState -> re-render -> React remounted Field and its <input>, dropping focus after each keystroke. Fix: moved `Field` to module scope (stable reference). It now keeps focus and accepts multi-digit input.
- **Sensible range validation** on step 0 (was just >0, which accepted 1 cm / 1 kg / age 1): age 18-120, height 120-230 cm, weight 30-300 kg. Error notes are now range-aware: empty -> "יש למלא את הנתון"; filled-but-invalid -> "יש להזין גיל תקין (18 ומעלה)" / "יש להזין גובה תקין בסנטימטרים" / "יש להזין משקל תקין בק״ג". The amber field outline + block-on-המשך use the same per-field ok flags (ageOk/heightOk/weightOk).
- VERSION 1.62->1.63. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.62 - Splash screen + install-as-app guide + favicon/PWA icons + cancelled-member block
- **Splash screen** (`SplashScreen`): full-screen overlay shown for 2s on every app open - big medal (MEDAL_SRC, 150px), "ברוכה הבאה לאפליקציית המעקב היומי של מיי פריים", and a small "דמו" badge top-left. Fades in/out via `@keyframes splashFade`. App state `showSplash` (init true) + a 2000ms setTimeout to dismiss; rendered as the first child of `.phone-frame` (zIndex 200).
- **Install-as-app guide:** an "📲 איך מתקינים כאפליקציה?" link under the v{VERSION} line in onboarding opens a modal with Android(Chrome) + iPhone(Safari) Add-to-Home-Screen steps. Local `showInstall` state in Onboarding.
- **Favicon + PWA (medal icon on the home screen):** new `index.html` adds icon / apple-touch-icon / manifest links + theme-color #D45D79 + apple-mobile-web-app metas. New `public/manifest.webmanifest` (standalone, rtl, he, bg #fff, theme #D45D79). New icon files generated from medal.png on a WHITE background: `public/icon-192.png`, `public/icon-512.png` (Android), `public/apple-touch-icon.png` (180px, iOS, no alpha).
- **Cancelled-member block:** api/access.js now flags the matched email's row as cancelled if it contains a standalone TRUE cell (`/(^|,)\s*TRUE\s*(,|$)/i`), and returns `reason:"cancelled"` (before expiry/device checks). AccessGate shows a support-contact message for cancelled and hides the retry button (terminal, like expired). Inert until the cancellation column is added to the published `access` tab. NOTE: owner must update the access-tab formula to also pull the cancellation column (TRUE = cancelled = blocked).
- VERSION 1.61->1.62. Changed: src/App.jsx, index.html, api/access.js, public/manifest.webmanifest, public/icon-192.png, public/icon-512.png, public/apple-touch-icon.png. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7, access.js node --check ok.

## v1.61 - Onboarding rework: empty fields + keyboard entry + validation + consent moved to gate
- **Privacy consent moved to the gate (before personal data).** The legal disclosure + "קראתי ואני מאשרת את מדיניות הפרטיות ומדיניות העוגיות" checkbox now live on the AccessGate name+email form; "כניסה" is blocked (gateMsg "יש לאשר את מדיניות הפרטיות כדי להמשיך") until checked. New App state `gateAgree`, passed to AccessGate; submitGate enforces it. Removed the consent block + `agree` state from onboarding step 4 (now just the projection graph + recommended kcal), and the final button is no longer gated by agree. The old small "data stays on your device" gate note was replaced by the formal disclosure.
- **Onboarding step 0 reworked:** age/height/current-weight now start EMPTY (no 50/165/72 defaults) and are KEYBOARD number inputs (type=number, inputMode numeric/decimal) instead of +/- steppers. Removed the "can't enter weight below X" helper line (the 1,200 kcal calorie floor + goal-weight block still protect downstream; no floor on the current-weight field - she enters her real weight).
- **Saturday question has no default selection** (`keepShabbat` starts null); she must choose.
- **Required-field validation on step 0:** tapping "המשך" with anything missing sets `err0`, shows an amber note next to each missing field ("יש למלא את הנתון" / age: "יש להזין גיל 18 ומעלה" / Saturday: "יש לבחור תשובה") and blocks advance. Validity = age>=18, height>0, weight>0, Saturday chosen. Step 1 goal-weight refs switched to parsed numbers (heightN/weightN). Goal/rate step and other steps unchanged.
- **Demo intro modal:** added a highlighted feedback box (brandBg + MessageCircle bubble icon) inviting beta feedback via the bottom-left bubble button.
- VERSION 1.60->1.61. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.60 - Gate text + start-date cap + attempts limit + intro copy
- **Profile start-date capped to the sheet date.** The profile start-date editor now offers only Sundays up to and including her registered (gate) date - she can move her start EARLIER (gets different values, allowed) but not later than the sheet. `ProfileScreen` takes `maxStart={gateStartDate}`; the date select filters `listSundays()` to `s.value <= maxStart`. The v1.59 sync effect changed from force-equal to a CAP: it only overrides profile.startDate when it is LATER than the sheet date (earlier manual choices are preserved instead of being reverted).
- **Rejection (not_registered) text updated** to direct to the technical team: "...פני בבקשה לצוות הטכני בווטסאפ 0547304177 או במייל support@myprime.co.il." (device_limit / expired texts unchanged.)
- **Email-attempt cap at the gate = 5.** `gateAttempts` counts failed not_registered submits; after 5 the "נסי שוב / כתובת אחרת" button is hidden so she must contact support (the rejection text already gives the contact details). In-memory soft cap (a page reload resets it; avoids permanently locking out a legit user who mistyped). Reset on resetDemo.
- **Demo intro modal (IntroOverlay) copy replaced** with the owner's beta/refresh text, now personalized with her name: "שלום {name} 🙂 זו גרסת הדגמה (בטה) להתנסות." + a paragraph recommending a daily pull-to-refresh for the latest version. Bullet list removed.
- VERSION 1.59->1.60. App.jsx only. esbuild clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.59 - Sheet start date + usage window (expiry)
- `api/access.js` now reads each participant's program START DATE from her row in the registration sheet (same ACCESS_SHEET_CSV_URL). It matches the email per row and extracts a date (DD/MM/YYYY or YYYY-MM-DD, any column order, header row ok), snapped to its Sunday. Returns `startDate` on allowed responses.
- Usage window enforced SERVER-SIDE: access ends 70 days (10 weeks) + 3 months after the start date (inclusive of the last day). Past that, the gate returns allowed:false reason "expired" (tamper-proof vs device clock). Participants with no parseable date stay allowed with no expiry (graceful fallback).
- Client: stores the gate's startDate (localStorage myprime_start_date). Onboarding now LOCKS the start date when provided by the sheet (read-only display "התאריך נקבע לפי ההרשמה שלך", no selector); falls back to the Sunday picker in demo mode. Returning users sync profile.startDate to the sheet value on each gate pass. Cleared on retry/reset.
- AccessGate: new "expired" state -> "תקופת השימוש באפליקציה הסתיימה. תודה שהיית חלק מהמסע שלנו 💜" (no retry button).
- Setup note for owner: add a start-date column to the SAME registration sheet, format DD/MM/YYYY, re-publish CSV (ACCESS_SHEET_CSV_URL env stays the same).
- VERSION 1.58->1.59. Changed: src/App.jsx, api/access.js (api/backup.js unchanged, included for a complete deploy drop). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.


- Onboarding backup screen (step 3): added a required acknowledgment checkbox "קראתי והבנתי את מדיניות שמירת הנתונים של מיי פריים." The "המשך" button is now gated on it (in addition to the existing backup yes/no choice and, if backup chosen, a valid email + matching code). The backup yes/no choice and Profile enable flow (email + code + confirm via BackupModal, shown when backup is off) were already in place.
- VERSION 1.57->1.58 (App.jsx only). api/backup.js unchanged from v1.57 (still needs deploying). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.


- New end-to-end encrypted backup. User data is encrypted IN THE BROWSER (AES-GCM, key derived from a personal backup code via PBKDF2, Web Crypto - no external library) before upload. The server (Upstash) stores ONLY ciphertext + salt + iv, keyed by email. No one, including MyPrime, can read the contents without the user's code. The code lives in its own localStorage key (myprime_bk_code) and is never sent to the server.
- New serverless endpoint `api/backup.js` on the SAME Upstash as the access gate (UPSTASH_REDIS_REST_URL/TOKEN). Email must be on the registered list (ACCESS_SHEET_CSV_URL) to read/write, matching the gate. GET ?email -> {exists, blob}; POST {email, blob} -> stores. While Upstash is unset, backup is simply off.
- Onboarding: new screen (now step 3 of 5, before the plan-graph + privacy screen). Explains that data is stored only on her device and only she can access it; offers optional encrypted cloud backup. If she opts in: confirm/edit email (prefilled from the gate) + set a backup code with double-entry confirmation, plus a clear warning that the code cannot be recovered. Progress bar is now 5 dots; the plan-graph + privacy approval moved to step 4.
- New-device restore: when there is no local data but a cloud backup exists for the gate email, a Restore screen asks for the backup code, decrypts locally and loads the data (skipping onboarding). Wrong code -> "קוד שגוי, נסי שוב." Option to start fresh without restoring.
- Profile > נתוני בסיס: new "גיבוי מוצפן" status row (מופעל/כבוי) opening a manage sheet (BackupModal): enable (email+code+confirm), "גבה עכשיו", and "איפוס קוד" (re-keys from the current device and overwrites the cloud copy - the E2E-compatible reset).
- Auto-backup: once a day, a few seconds after the first load/change of the day (not on every keystroke), when backup is enabled and a code is present locally. Tracked via myprime_bk_last.
- VERSION 1.56->1.57. New file api/backup.js included in the zip (deploy it). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.


- Tour tracker bubble (the daily-tasks step) text -> "וכאן המשימות היומיות. שתי המשימות הראשונות מסומנות אוטומטית כשאת ממלאת בפלוס את הצעדים והקלוריות 💜".
- Tour bubbles whose target is a bottom-nav item (sel starts with "nav-") now sit just ABOVE the bottom bar instead of being pinned to the top.
- Tracker modal yellow note -> "חלק מהמשימות מסומנות 'אוטומטי' - הן מתעדכנות לבד לפי מה שמילאת בפלוס של הקלוריות והצעדים, בלי שתצטרכי למלא שוב."
- Tracker modal: each auto task with no data yet shows a small amber hint under its label - steps -> "יש למלא בעיגול הצעדים", water -> "יש לעדכן בעיגול המים", food-based (journal/protein/other) -> "יש למלא בעיגול הקלוריות".
- FAQ (Profile > שאלות ותשובות): added a "סיור באפליקציה (מעבר לשבוע ראשון, יום שלישי)" button that jumps selectedDate to week1-day3 (addDays(startDate,2)), switches to the day tab and launches the tour. Added an intro note "יש לך שאלה נוספת שלא מופיעה כאן? אפשר לשלוח אותה בקבוצה ולקבל מענה." The steps Q now renders the existing image guide (StepGuideLink, which also covers the no-app/store case) instead of a text-only answer. Added 5 new Q&A (calorie target, missed a whole day, edit/delete an item, medals/trophies, why tasks unlock gradually). The "מסכים באפליקציה" section now lists only "הוספת מזון ופעילות (כפתור +)" (the rest were redundant).
- VERSION 1.55->1.56 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.


- Tap steps (calorie ➕ and now the steps ➕) dim the whole screen EXCEPT the highlighted element via 4 click-capturing strips around it, so only the ➕ (and the bubble) are tappable - she can't accidentally tap elsewhere and break the tour. Steps step changed from a "המשך" button to a tap step ("לחצי על הפלוס של הצעדים", event "opensteps" fired from onEditSteps) that opens the steps demo and advances.
- Bubble placement: when the highlighted element is in the lower half of the screen the bubble now pins to the top (top:12) instead of hugging the element, so it never hides the options that the screen reveals; the highlight stays lit.
- Every bubble now has a "הקודם" button (when idx>0) to step back; `tourBack` decrements and the open-sync effect restores that step's screen. Every step now carries an explicit `open` (calorie ➕ and steps ➕ are `open:"day"`) so back/forward reopen/close the right screen.
- Intro screen (week1 days 1-2): heart emoji -> medal image (/medal.png); title -> "ברוכה הבאה לאפליקציית המעקב של מיי פריים 360"; body is day-dependent: "ביומיים הראשונים עדיין אין מעקב. [מחרתיים (day1) / מחר (day2)] מתחילות יחד, צעד אחרי צעד, ותקבלי כאן ביום שלישי את כל ההסברים על השימוש באפליקציה." Placeholder line removed.
- VERSION 1.54->1.55 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.


- Tracker CTA is now dynamic by whether the viewed day has any MANUAL (non-auto) task: if all of the day's tasks are auto (steps/journal only - i.e. week1-day3 up to before week2-day3) the button reads "הקישי לצפייה במעקב"; once a manual task exists (first one is אימון כוח at week2-dow3) it reads "הקישי למילוי המעקב". Implemented via `tasks.some(t => !t.auto)` in CheckinCard, so it self-adjusts if the schedule changes.
- New one-time coachmark "trackerfill" (TIPS, no FAQ title, sel "tracker"), due when the day first has a manual task (`ctx.manualTracker`): "מהיום אנחנו מתחילות למלא את יומן המעקב במשימות שלא נכנסות באופן אוטומטי. היום לדוגמה נוספה משימת אימון כוח, ולאחר שתבצעי אימון כוח את יכולה לסמן וי במעקב." DayScreen ctx now carries `manualTracker = checkinOpen && tasksForDate(...).some(t => !t.auto)`.
- VERSION 1.53->1.54 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.


- The tour no longer asks the user to fill anything in. It now DRIVES the screens itself (demo): each step carries `open` ("day"/"caloriemenu"/"addfood"/"steps") and an App effect syncs the live screen to it. Only the very first step is a real tap (the calorie ➕), with NO "המשך" button - tapping the ➕ opens the menu and advances (tap steps render no advance button now).
- Bubbles are anchored to real elements (spotlight) on each demo screen: ➕ ring -> calorie menu "הוספת מזון" -> add-food "האחרונים והמועדפים" -> add-food "ספרי לי מה אכלת" (this single bubble now explains the AI chat; no real chat screen is opened, no API) -> day "מה שהוזן" (diarylist) -> calorie menu "פעילות גופנית" (NEW activity bubble) -> day steps ring -> steps screen (demo, autofocus disabled so no keyboard) -> tracker -> cabinet -> nav יומן/דוח/➕/מתכונים/פרופיל -> day strip -> finish.
- New data-tut anchors: diarylist ("מה שהוזן" header), entry-activity (calorie-menu activity item), steps-input (steps field). Removed reliance on the old ai-chat/real-tap-advance for the inner steps.
- Every bubble now has a "סיים את הסיור" link (except the final bubble); it jumps straight to the final bubble (the restart/FAQ message), which then closes via "סיימנו". Default advance button label is now "המשך".
- Daystrip bubble text updated: "...דרך סרגל הזמן שלמעלה, או בהחלקה ימינה ושמאלה על המסך (סוויפ)" (dropped the side-arrows wording).
- "סיור באפליקציה" button now shows ONLY on program day 3 of week 1 (was always shown).
- Intro days lock: on week 1 days 1-2 (`introLock`), the top day strip and the bottom nav bar + FAB are grayed (opacity 0.4) and non-interactive (pointerEvents none), each with a small "בקרוב" pill.
- VERSION 1.52->1.53 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Cross-screen UX still needs device testing.


- Replaces the old day-3 coachmark set (cal/steps/tracker/cabinet) with a single App-level guided tour that walks across screens. Auto-triggers once on program week 1, day>=3 (700ms after the day screen settles), and is restartable anytime via a permanent "סיור באפליקציה" button under the day strip (data-tut="tourbtn", Sparkles icon).
- Bubble 1 (cal ring): explains the + and asks "רוצה שאראה לך דוגמה?" with [כן, בבקשה]/[אין צורך, נמשיך].
- YES path is hands-on across real screens: tap cal + (opens calorie menu) -> tap "הוספת מזון" (opens add-food) -> bubble on "האחרונים והמועדפים" -> tap "ספרי לי מה אכלת" (opens AI chat) -> explain the chat (NO API call in the demo; she does not send) -> back on day: edit/delete note -> steps explain -> tap steps + and enter a number -> daily-tasks auto-check note.
- NO path: steps bubble + tracker bubble (original texts).
- Shared tail (both paths): cabinet -> nav buttons יומן/דוח/+/מתכונים/פרופיל -> day strip (time travel) -> finish bubble that points at the "סיור באפליקציה" button and mentions FAQ.
- Architecture: tour state lifted to App `{steps,i}`; builder `buildTour(path)` + TOUR_YES/TOUR_NO/TOUR_TAIL consts. `tourView` derives the live screen from sheet/modal. Steps render only when `step.view === tourView`. `tap:true` steps render WITHOUT a screen-blocking backdrop (lighter dim, real UI tappable) and advance via `tourEvent(key)` fired from the real handlers (addcalorie / pickfood / pickai / addsteps); button steps advance via onNext; `closeModal` steps close the add-food modal on advance. Tour-seen flag = "appTour" in profile.tipsSeen (auto-trigger only; restart ignores it).
- TutorialOverlay generalized: optional `cur.btn` label (default "הבנתי"), `cur.tap` (no block, lighter dim), `cur.sel===null` centered bubble, counter hidden when a single step. Existing later-day tips (water/protein/stepbaseline/weeklysummary) unchanged; DayScreen queue now excludes the four tour keys (kept in TIPS only for the FAQ list).
- data-tut tags added: EntryMenu food item (entry-food), add-food method items (method-history, method-ai) + AI chat area (ai-chat), day strip (daystrip), restart button (tourbtn), nav tabs (nav-day/report/recipes/profile) + FAB (nav-fab).
- NOTE: cross-screen UX could not be runtime-tested here; needs owner testing (see chat checklist). Likely one fix round.
- VERSION 1.51->1.52 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.51 - Day-3 tutorial rework (step 1): first bubble offers an example with yes/no choice
- Start of the owner's multi-stage day-3 tutorial redesign. First bubble (the "cal" tip) now ends with the prompt "רוצה שאראה לך דוגמה?" and shows TWO buttons instead of "הבנתי": "כן, בבקשה" / "אין צורך, נמשיך".
- TutorialOverlay extended: a tip with a `choice: {yes,no}` (and optional `prompt`) renders the prompt (bold) + two buttons; non-choice tips keep the single "הבנתי". Added onChoice prop.
- DayScreen: added tipChoose(yes). FOR NOW both yes and no just continue to the next bubble - the step-by-step food-example bubbles (the YES path) and the NO=skip-past-them wiring will be inserted in tipChoose once the owner provides the example bubbles' content.
- Owner is feeding this bubble-by-bubble; remaining: the example/food bubbles, and confirming the post-example flow (steps bubble, then the journal/tracker, no extra bubbles).
- VERSION 1.50->1.51 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.50 - Weekly summary polish: bigger achievements card, normal P.S., larger body text
- Owner feedback on the weekly summary:
  1. The "ההישגים שלך השבוע" block looked small/unserious -> redesigned as a prominent white card (C.panel) with a brand border + soft shadow; bigger title (18.5, bold), bigger medals (34->48px), bigger trophy (66->92px), and clearer labels (medal count 16/bold ink, trophy line 16/bold brandD).
  2. The closing נ.ב. was small + gray (14 / C.sub) -> now same as body text (16 / C.ink / lineHeight 1.7) with a bold "נ.ב." prefix, in both week 1 and weeks 2-10.
  3. Summary body text felt small -> bumped from 15.5 to 16 (matches the app's standard body size); the bold title from 16.5 to 17.5.
- VERSION 1.49->1.50 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.49 - Fix (desktop): sheet still cut off at top - cap height to the app frame, not the viewport
- v1.43 used maxHeight 88vh on the SheetShell panel. On desktop the app is a FIXED 800px-tall .phone-frame (overflow hidden); 88vh of the tall desktop browser (~950px) is bigger than the 800px frame, so a long sheet (weekly summary) overflowed the frame's top and got clipped/hidden behind the DEV bar.
- Fix: SheetShell panel maxHeight changed from "88vh" to "88%" - i.e. 88% of the app frame (which is 800px on desktop, 100vh on mobile). The sheet now always fits inside the frame with the header visible and the body scrolling internally, on both desktop and mobile.
- VERSION 1.48->1.49 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test on desktop: open a long weekly summary -> title + intro visible at top, scrolls within the sheet, nothing hidden.

## v1.48 - Weekly summary: natural Hebrew grammar for 0 / 1 in every task line
- Owner: lines read oddly for 0 or 1 (e.g. "1 פעמים", "ביצעת השבוע 0 אימוני כוח"). Wanted "פעם אחת" for 1 and a "did not / not yet" phrasing for 0.
- Rewrote summaryTaskLine so EVERY line branches on 0 / 1 / many:
  * 1 -> singular ("פעם אחת", "יום אחד", "אימון כוח אחד", "כוס אחת", "שעה אחת", "צבע אחד", "ארוחה אחת").
  * 0 -> a gentle "השבוע עוד לא..." / "עדיין לא..." phrasing instead of "0 ...".
  * many -> the original plural wording.
- Covers steps, journal, strength, strength+mobility, veg+order, water (full/simple), protein, sleep (full/simple), breathing, gratitude, grains (split/combined), pelvic, probiotics, antiinflam, bone-density, fasting. Added an `amt()` singular-aware helper for averaged amounts.
- VERSION 1.47->1.48 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test: a week with 0 strength + 1 step-report day now reads "השבוע עוד לא ביצעת אימוני כוח" and "דיווחת פעם אחת על הצעדים".

## v1.47 - "ספרי לי מה אכלת": ask for all details up front (shorten the chat)
- Owner: in the AI food chat, the opening message should ask her to give as many calorie-relevant details as possible right away (how it was prepared - fried/baked/etc, what she drank, approx grams), so there are fewer follow-up questions.
- Rewrote the first assistant message (aiMsgs initial) to request: preparation method, added oil/butter/sauce, what she drank, and an approximate quantity (grams/cups/spoons), noting that more detail = more accurate estimate. Kept "אפשר לדבר או לכתוב".
- Added whiteSpace:pre-wrap to the food-chat bubble so the multi-line message renders with its line breaks (matches the other chat bubbles).
- The system prompt already instructs one-question-at-a-time and not to re-ask what was given, so providing details up front naturally reduces follow-ups; no system-prompt change needed.
- VERSION 1.46->1.47 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.46 - Weekly summary: "ההישגים שלך השבוע" illustration at the end (medals + trophy)
- Owner idea: end each weekly summary with a nice illustration of the medals/trophy she earned that week.
- WeeklySummaryModal now computes wkMedals (completed days this program week, via checkins[date]._done over day-numbers (week-1)*7+1 .. week*7, capped at today) and wkTrophy (weekTrophyEarned for this week). Reuses the existing medal/trophy assets (MEDAL_SRC, trophyForWeek).
- achievementsEl: a bottom section (top border) titled "ההישגים שלך השבוע 🏆" showing a row of this week's daily medals ("N מדליות יומיות השבוע") and, if earned, the week's trophy ("גביע השבוע נכנס לארון!" / "גביע האלופה..." at week 10). Hidden entirely if nothing earned that week. Appended at the very end of BOTH summary branches (week 1 and weeks 2-10), after the signature/PS.
- VERSION 1.45->1.46 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test: complete a few days in dev, open the weekly summary -> medals row + trophy at the bottom.

## v1.45 - Unified bold title on every weekly summary
- Owner: each weekly summary should open with the bold title "סיכום שבועי של משימות השבוע {הראשון} שלך במיי פריים!", where only the ordinal word changes per week.
- Added WK_ORD (1..10 -> הראשון..העשירי) and a titleEl rendered as the first line of the summary box (bold, brand color, centered) in BOTH branches (week 1 and weeks 2-10). The SheetShell chrome header still shows "סיכום שבוע X" as a short identifier.
- VERSION 1.44->1.45 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test: open any week's summary -> the bold MyPrime title appears on top with the correct ordinal.

## v1.44 - Fix: report "עמידה ביעד הקלורי" over-counted (partial logging shown as met)
- Owner bug: the report showed "עמדת ביעד 2 מתוך 2" when the woman had only logged a tiny amount (filled the food journal once) and had NOT actually met the calorie goal.
- Cause: metDays counted any logged day with kcal <= goalKcal as "met". A single small item -> total far below target -> counted as met.
- Fix: a day counts as "met" only if intake is CLOSE to target: calMet(kc) = kc >= goalKcal*0.8 && kc <= goalKcal*1.05. Trivial/partial logging (far below target) or strong under-eating no longer counts. loggedDays (the "X מתוך Y" denominator) still = any day with food logged, so Ron's case now reads e.g. "0 מתוך 2". The calorie bar colors match the same rule (brand = met, amber = off-target either direction, line = no data).
- Threshold (80%-105%) is tunable - tell me if you want it wider/narrower. Note: weeklySummaryData.calOnGoal uses a stricter +-5% band but is not currently displayed (curated summaries dropped the calorie line).
- VERSION 1.43->1.44 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test: log one small item on a day -> report shows that day as NOT met.

## v1.43 - Fix: long bottom-sheets (weekly summary) cut off at the top / unreadable
- Owner (testing in dev): could not read the whole weekly-summary message - the top (title + intro + first tasks) was pushed above the screen and hidden behind the DEV bar (z99999).
- Root cause: SheetShell (the bottom sheet used by the weekly summary, FAQ, entry menu, etc.) had no max-height and no internal scroll. When content was taller than the viewport, the panel overflowed upward off-screen with no way to scroll back to the top (the page-level scroll let the DEV bar cover it).
- Fix: SheetShell panel now has maxHeight 88vh + flex column; the header (title + X) is fixed (flex-shrink 0) and the body is wrapped in an overflow-y:auto, flex:1, minHeight:0 container that scrolls internally. The sheet now stays below the DEV bar and any long content scrolls within the sheet with the title always visible. Affects ALL sheets (universal improvement); short sheets are unchanged.
- VERSION 1.42->1.43 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test: open a long weekly summary (e.g. week 7+) and scroll - title stays, whole message readable, nothing hidden by the top bar.

## v1.42 - Step guide collapsed into one button -> options menu (owner: bubble too crowded)
- Owner: the steps tip bubble showed too much (2 guide buttons + a links line). Replace with a SINGLE trigger button, and put the 3 options behind it.
- StepGuideLink now renders one amber button "זקוקה להנחיות שימוש באפליקציית הצעדים? לחצי". Tapping opens a menu modal (overlay, zIndex 100001) titled "הנחיות לאפליקציית הצעדים" with three amber boxes:
  1. מדריך: Apple Health -> in-app image viewer.
  2. מדריך: Samsung Health -> in-app image viewer.
  3. an amber box "אין לך אפליקציית בריאות בטלפון? הורידי אפליקציית צעדים חינמית:" with the two store links rendered AS BUTTONS (Android / אייפון), per owner ("שהלינקים יראו ככפתורים").
- view state machine: null | menu | ios | android. From an image viewer, X / tap-outside / last-image button ("חזרה") return to the menu; from the menu, X / tap-outside close. Single trigger shown in all surfaces (StepsModal, report card, steps tip bubble); the non-linkOnly explanation line is kept above it.
- VERSION 1.41->1.42 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test: steps tip bubble now shows only the one button -> opens the 3-option menu -> guides flip in-app, store links open as buttons.

## v1.41 - Step guide: show all 3 options to everyone (no platform detection)
- Owner: stop branching by detected phone - show every woman all three options together: Apple Health guide, Samsung Health guide, and the external app links.
- StepGuideLink rewritten: no longer calls detectPlatform/currentStepGuide. It renders a button per guide (iterates STEP_GUIDES -> Apple Health, then Samsung Health), each opening the in-app image viewer for that guide (openKey state picks which images). Below them, the free-app line always shows both store links (Android / אייפון).
- The intro line dropped the per-app name (generic "פתחי את אפליקציית הבריאות בטלפון"). Shown in all surfaces incl. the steps tip bubble (linkOnly).
- detectPlatform / currentStepGuide / stepAppFor are no longer used by StepGuideLink (left in file, harmless) - can be removed later if nothing else needs them.
- VERSION 1.40->1.41 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test: on ANY device, open steps -> two guide buttons (Apple + Samsung) both open their image viewer, and the Android/אייפון app links appear.

## v1.40 - Fallback step-counter app links (for women without Samsung Health / Apple Health)
- Coverage gap raised by owner: iPhone always has Apple Health (covered), but a non-Samsung Android (Pixel, Xiaomi, etc.) has no Samsung Health, and desktop/other shows no guide at all.
- Added STEP_APPS: free pedometer apps per store - Android "Pedometer - Step Counter" (play.google.com/.../pedometer.steptracker.calorieburner.stepcounter), iOS "StepsApp" (apps.apple.com/.../id1037595083). stepAppFor(platform) returns the right one.
- StepGuideLink now shows fallback download links:
  * When a native guide exists (ios/android): a small line under the מדריך button - "אין לך את {app}? אפשר להוריד אפליקציית צעדים חינמית: {store app}" (Play app on Android, StepsApp on iOS).
  * When NO native guide (other/desktop), non-linkOnly: "אין לך אפליקציית בריאות בטלפון? ... Android / אייפון" with both store links. (linkOnly tip bubbles still render nothing when there is no guide.)
- These store links open externally (the store app) - that is expected/correct for installing an app, and unrelated to the old PDF blank-page issue.
- VERSION 1.39->1.40 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.
- OPEN: owner to confirm the two chosen pedometer apps are good picks for MyPrime's audience (free, simple, Hebrew-friendly), and whether to surface the fallback link inside the tip bubble too.

## v1.39 - Intermittent-fasting intro bubble + fasting now opt-in (gated in tracker)
- checkins.js: fasting task startDow 5 -> 4, so it (and the intro) land on week 8 DAY 4 (Wednesday), per owner.
- NEW FastingIntroModal: a one-time bubble on the day screen, fires from week 8 day 4 onward (dowOf>=4) or week>8, once (tipsSeen key "fastingintro"), only on the day tab with no other overlay, and skipped if she already opted in. Copy (Anat voice): "היום העליתי לך סרטון על משימת הצום לסירוגין. אם את מעוניינת לנסות את המשימה - אשרי זאת בכפתור. תמיד אפשר לשנות את הבחירה בפרופיל." Two buttons: "כן, אשמח לנסות" -> sets profile.fasting=true + marks seen; "לא עכשיו" -> marks seen, stays off. (Owner wrote "משימת הצעדים" - corrected to "הצום", confirmed the intent.)
- FASTING IS NOW OPT-IN END-TO-END: tasksForDate gained a `fasting` arg and filters the fasting task out unless opted in. Wired into the daily tracker (DayScreen ciTasks + CheckinModal) and weeklySummaryData, so the fasting task shows in the tracker AND the summary line ONLY for women who opted in (via the bubble or the week-8 profile toggle). Default off -> never appears.
- dayComplete + dayProgress now ignore optional tasks (filter !t.optional) - so the optional fasting task never blocks a medal or drags the progress ring (fixes a latent issue where the optional task could have blocked completion).
- VERSION 1.38->1.39 (App.jsx + checkins.js). esbuild parse clean, brackets 0/0/0 both files, 0 em/en dashes, check-logic 7/7.
- TEST (?dev=1, simulate to week 8 Wed): the bubble appears on the day screen; "כן" turns on fasting (toggle in profile reflects it, fasting task appears in tracker, fasting line in the weekly summary); "לא עכשיו" leaves everything off and the fasting task does not appear. Bubble does not reappear after either choice.

## v1.38 - Step guide is now IN-APP (two-image viewer), no external PDF/page
- BUG (owner): tapping the guide button opened a blank page (the PDF link `/guides/*.pdf` opened a new tab; the in-app browser could not render it / file not deployed). Owner wants the guide to stay INSIDE the app - flip between the two instruction images in place, per phone.
- REPLACED the PDF-link approach with an in-app image viewer. STEP_GUIDES now holds `images: []` per platform (not a `url`): ios -> [/guides/apple-1.png, /guides/apple-2.png], android -> [/guides/samsung-1.png, /guides/samsung-2.png]. currentStepGuide() returns the platform guide if it has images (no cross-platform fallback - iPhone never sees Samsung).
- StepGuideLink: the "מדריך" button now opens a fixed overlay (zIndex 100001, above the tutorial overlay) showing one image at a time with הקודם / הבא navigation, a 1/2 counter, and close. "הבא" on the last image closes. Tap-outside closes. Used in all 3 spots (StepsModal, report steps card, steps tip bubble).
- Old PDFs removed from public/guides; replaced by 4 PNGs (1080px wide, optimized): samsung-1/2.png, apple-1/2.png.
- OWNER: add the 4 files under public/guides/ (in the zip). You can delete the old samsung-health-steps.pdf / apple-health-steps.pdf if you added them - no longer referenced.
- VERSION 1.37->1.38 (App.jsx + 4 new assets). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test: open steps -> מדריך -> flip between the two images without leaving the app.

## v1.37 - Apple Health step guide wired (iOS) - both platforms now complete
- Owner supplied the Apple Health (iPhone) "find your steps" instructions as two images (step 1: open the Health app; step 2: the Steps card with Today vs Average). Built public/guides/apple-health-steps.pdf (2 pages, ~120KB), same layout as the Samsung guide.
- STEP_GUIDES.ios.url set to "/guides/apple-health-steps.pdf". Both ios + android guides are now live: iPhone -> Apple Health PDF, Android -> Samsung Health PDF. Item 10 guide content fully complete.
- OWNER: add public/guides/apple-health-steps.pdf to the repo (in the zip, alongside the Samsung one from v1.36).
- VERSION 1.36->1.37 (App.jsx + new asset). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test on an iPhone/iOS UA: open steps -> "מדריך: איך מוצאים את הצעדים ב-Apple Health" opens the PDF.

## v1.36 - Samsung Health step guide wired (android)
- Owner supplied the Samsung Health "find your steps" instructions as two images (step 1: open the app; step 2: where the step count is + scroll for history). Built a 2-page PDF (step 1 then step 2, each centered on a white A4 page) at public/guides/samsung-health-steps.pdf (~140KB).
- STEP_GUIDES.android.url set to "/guides/samsung-health-steps.pdf". iOS (Apple Health) url still empty - pending owner. So on Android the guide link/button now appears (StepsModal, report steps card, steps tip bubble); on iOS it stays hidden until the Apple guide is supplied.
- FIXED currentStepGuide(): removed the cross-platform fallback so an iPhone never gets shown the Samsung guide. Now returns the guide only for the detected platform (else null). Desktop/other shows no guide link.
- OWNER: add public/guides/samsung-health-steps.pdf to the repo (in the zip). Apple Health guide still TODO (send the iOS instructions and I'll build + fill STEP_GUIDES.ios.url).
- VERSION 1.35->1.36 (App.jsx + new asset). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. Test on an Android device/UA: open steps -> the "מדריך" button opens the PDF.

## v1.35 - New daily-medal artwork (gold rosette, woman silhouette, brand colors)
- Owner supplied a medal graphic to use everywhere the daily medal appears. Source was RGB with a solid white background; removed the OUTER white via border flood-fill (kept the inner white silhouette), autocropped, padded to square, resized to 360x360, saved transparent at public/medal.png (~175KB).
- MEDAL_SRC changed from "/medals/medal.webp" to "/medal.png". This single constant drives every daily-medal spot: MedalCheer ("מדליה נכנסה לאוסף"), and CollectionModal (the earned-medals grid + the empty-state grayscale). No other code changes needed.
- Weekly trophies (גביעים: /medals/trophy-*.webp) and the cabinet icon are SEPARATE and left unchanged - owner said "the medal". Can swap those too if asked.
- OWNER: add the file public/medal.png to the repo (included in the zip). Square asset so the existing width=height sizing renders undistorted.
- VERSION 1.34->1.35 (App.jsx + new asset). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. VISUAL pass: see the medal in the cabinet + day-complete cheer.

## v1.34 - Combined grains/fats summary count = days with at least one (owner)
- "במהלך X ימים הוספת דגנים מלאים ו/או קטניות ו/או שומן בריא" (grains_combined, weeks 7+): X was a rough max(grains, goodfat). Owner chose: count a day if she did AT LEAST ONE of grains/goodfat.
- weeklySummaryData now computes `grainsDays` per-day (grains OR goodfat done that day), returned and used by grains_combined. This resolves the last v1.32 mapping assumption. Week 6 stays split (two separate counts), unchanged.
- VERSION 1.33->1.34 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.

## v1.33 - Sleep-improvement summary count = days with at least one sleep task (owner)
- "במהלך X ימים ביצעת את משימות שיפור השינה" (weeks 4-7 sleep_full line): X was approximated by counts.noscreens. There are two sleep-improvement tasks (noscreens + stopeating; "שעות שינה" is the separate hours metric). Owner chose: count a day if she did AT LEAST ONE of them.
- weeklySummaryData now computes `sleepDays` properly per-day (a day counts if noscreens OR stopeating was done that day) and returns it; sleep_full uses data.sleepDays. This replaces the noscreens approximation (one of the two v1.32 flagged assumptions resolved). The grains_combined max(grains,goodfat) assumption still stands pending owner.
- VERSION 1.32->1.33 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7.


Wired the owner-supplied WhatsApp weekly summaries (weeks 2-10) into the in-app WeeklySummaryModal, in Anat's voice. Source: feedback/weekly-summaries-unified.md (the merged copy, approved approach).
- DECISIONS APPLIED: two %-variants unified into ONE warm/inclusive narrative per week; the "X% מהמשימות" line DROPPED everywhere (owner, like week 1); short hyphens only.
- Replaced the old generic checklist (weeks 2+) with a CURATED per-week narrative: WK_INTRO/WK_OUTRO/WK_TASKS configs + summaryTaskLine() builder. Week 1 keeps its v1.31 unified narrative. The summary lists only the tasks Anat recaps that week (NOT every active task) - e.g. journal drops from the summary at week 4, veg/order at week 5 - matching the source.
- Per-week task sets reconciled against checkins.js (all tasks exist there): W2 steps/journal/strength/veg+order; W3 +water+protein; W4 swaps journal->sleep+breathing; W5 +gratitude (drops veg/order); W6 grains(split)+gratitude; W7 +pelvic(NEW)+probiotics(NEW), grains becomes combined; W8 +antiinflam +fasting(optional), water/sleep wording simplifies; W9-10 strength+mobility, +bone-density(calcium/sun). "חדש" pill shown on pelvic+probiotics at week 7 only.
- Wording variants by week handled in the builder: water_full (W3-7) vs water_simple (W8+); sleep_full (W4-7) vs sleep_simple (W8+); grains_split (W6) vs grains_combined (W7+); strength vs strength_mobility (W9+).
- INTERMITTENT FASTING: new profile field `fasting` (bool, default false; added to DEFAULT_PROFILE + onboarding draft). Toggle added in Profile > "נתוני בסיס" (next to "שומרת שבת"), rendered ONLY when programWeek >= 8 (fully hidden before, not greyed). When ON, the "*משימת צום לסירוגין (רשות)* 🕘" line shows in the W8-10 summaries (WeeklySummaryModal now takes a `fasting` prop = profile.fasting).
- The week-2 step-baseline-sanity amber box (stepRecheckDir) is preserved, now rendered between the task lines and the outro.
- ASSUMPTIONS (flagged for Anat to validate): "ימים שביצעת את משימות שיפור השינה" uses counts.noscreens as the representative count; grains_combined day-count uses max(grains, goodfat). These map a single WhatsApp field onto the app's split tasks.
- OPEN (owner): week 4 & 7 copy received and merged. Weeks-2+ copy approval still welcome. Fasting coachmark BUBBLE still TODO (create a TIPS entry when the fasting task UI first appears, week 8). Old SUMMARY_COUNT_PHRASE/SUMMARY_AVG_PHRASE/WEEKLY_MOTIVATION now unused (left in place, harmless).
- VERSION 1.31->1.32 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. VISUAL pass needed - eyeball weeks 2-10 summaries (use ?dev=1 + simulate weeks) and the week-8 fasting toggle.


Owner accumulated 12 fixes and said execute all in one pass. Week-1 summary copy implemented now; weeks 2+ keep the checklist format until owner sends their copy. Two content dependencies remain (owner-supplied): the 2 health-app PDFs and more FAQ Q&A.
1. EntryMenu (the bottom "+" / `sheet:"menu"`, default mode): removed the "הזיני משקל" item (weight stays in the report). `onPickEntry` still has a dead "weight" branch (harmless); `TrendingDown` import now unused (harmless).
2. EntryMenu color-coding + prominence: food family (הוספת מזון + מה כדאי לאכול) tinted brand pink (C.brandBg/C.brand), activity tinted purple (C.infoBg/C.info). Each row got a tinted background + 4px colored start-border + white icon tile. Reordered so recommend sits with food, activity last.
3. ActivityModal: removed "הליכה" + "הליכה מהירה" from `acts[]` (ריצה is now first, default `sel=0`). Walking is covered by steps.
4. ActivityModal: added a C.infoBg note box - workout calories ADD to the daily calorie budget, and walking is auto-counted via steps.
5. Weekly summary: protein line gated to `week >= 3` (`if (data.protein && week >= 3)`). Weeks 1-2 show no protein line.
6. Weekly summary signature "ענת" is now black + bold everywhere (week-1 narrative fontWeight 800/C.ink; weeks 2+ motivation box C.faint -> C.ink fontWeight 700).
7. Weeks 2+ steps line verb: "הוצאת בממוצע" -> "צעדת בממוצע" (week 1 uses the new narrative).
8. `stepBaseline` loop d=2..6 -> d=2..7 so Saturday (program day 7) is included if logged. StepSetupModal baseline branch rewritten: states "your average is X, the task is +offset, so your goal = X+offset", with a live amber goal box (offset = `stepGoalCumOffset(programWeek)`, =2000 in week 2) and a button that shows the resulting goal. `confirmBaseline` already stored `stepGoal = val + offset`, so no logic change there.
9. Report steps card: added `steps7stats()` (returns {avg,n}); the average label is now dynamic - "ממוצע N ימים" (n<=0 -> "7", n===1 -> "יום אחד", else N), reflecting actual days-with-data in the rolling 7-window. Average still over days-with-data only (a skipped day is not counted as 0). `steps7avg` kept (now unused, harmless).
10. Health-app step guides (structure done; PDFs PENDING owner): added `detectPlatform()` (ios/android/other), `STEP_GUIDES = {ios:{url:"",app:"Apple Health"}, android:{url:"",app:"Samsung Health"}}` (empty urls = link hidden), `currentStepGuide()`, and a reusable `StepGuideLink({style,linkOnly})`. Deeper steps explanation now shown; the per-platform PDF button auto-appears once a STEP_GUIDES url is filled. Placed in: StepsModal (replaced the old disabled "התחברות לאפליקציית הבריאות" button), the report steps card, and the "steps" tip bubble (linkOnly). Steps tip text deepened. **OWNER TODO: drop the 2 PDFs in /public/guides and fill the two STEP_GUIDES urls.**
11. FAQ / help (structure done; more Q&A PENDING owner): added `title` to every TIPS entry; `FAQ_ITEMS` (3 seeded entries that restate existing app copy); `FaqModal` (accordion of FAQ_ITEMS + app-screen tips from TIPS + StepGuideLink, scrollable). ProfileScreen got `onOpenFaq`; a "שאלות ותשובות ועזרה" row sits above the reset button; root renders `sheet === "faq" && <FaqModal/>`. **OWNER TODO: expand FAQ_ITEMS.**
12. WeeklySummaryModal week 1: single unified Anat-voice narrative (no 80%/100% branching - owner dropped it) in a C.brandBg box. Merge fields: stepsDays = `data.avgs.steps.n`, stepsAvg = `data.avgs.steps.avg`, journalDays = `data.journalDays` (= calN, days with >=1 food entry; added to `weeklySummaryData` return). Empty-state fallback when week 1 has no data. Weeks 2+ keep the checklist + motivation box. Verbatim copy lives in `wk1Lines[]`. **OWNER: approve/adjust the week-1 wording.**
- VERSION 1.30->1.31 (App.jsx only). esbuild parse clean, brackets 0 0 0, 0 em/en dashes, check-logic 7/7. NOTE: heavy UI pass - eyeball on device (entry menu colors, activity sheet, week-1 summary, step-goal modal, FAQ).


- BUG (owner, ?dev=1): after reset + "קבע יום 1", stepping to program day 3 (filled it, got a medal), then tapping "+" to add food, the WEEK-1 weekly-summary tip popped up over the food sheet with a full dim and no spotlight - on what should have been a Tuesday (day 3), not a Friday/Saturday. The tracker card also showed the REAL date ("שבת, 6 ביוני") instead of the simulated day.
- ROOT CAUSE: the v0.44 midnight-rollover interval (root, ~line 3079) ran `ymd(new Date())` every 60s and did NOT respect DEV. ~60s after load it overwrote the simulated `today` (2.6) with the real date (Sat 6.6) and advanced `selectedDate` to it. Sat -> `dow===0` -> the weekly-summary tip's `weeklySummaryShown = checkinOpen && (dow===6||dow===0)` became true on week 1 -> the tip fired. TutorialOverlay sits at zIndex ~99999 (above all sheets), so it rendered on top of the open food sheet; the target bar was hidden behind the sheet so `rect` was unusable -> the no-rect full-dim fallback. This was also the source of the parked "tracker shows the real date during ?dev=1" test-fidelity bug.
- FIX 1 (root cause): the rollover interval now early-returns when `DEV` (the simulated date is fixed; the DevDateBar reloads to change it). Production behavior is unchanged. The simulated day stays put, so day 3 stays Tuesday and the tip is no longer due.
- FIX 2 (robustness, also production-relevant): the tip-start effect now early-returns when an overlay is open (`overlayOpen` prop = `!!(sheet||modal||showExit||showIntro)`, added to the effect guard + deps), mirroring the existing isIntro/isShabbat gate (v1.26). So a tip can never start over an open sheet/modal - including a real week-1 Friday where the user happens to be mid food-add. The tip re-evaluates and can appear once the overlay closes.
- VERSION 1.29->1.30 (App.jsx only). tsc/parse clean, brackets 0 0 0, 0 dashes, check-logic 7/7. No prompt change (qa harness unaffected). No visual pass needed - logic-only.
1. Steps tip: appended "אפשר תמיד לעדכן את כמות הצעדים של היום - אל דאגה."
2a. Tracker tip: "כמה משימות קטנות" -> "המשימות שלך בשלב הזה".
2b. Tracker spotlight excludes the trophy-cabinet rail: moved `data-tut="tracker"` from the CheckinCard root to the inner main-content div (the cabinet keeps its own `data-tut="cabinet"`).
3. Calorie tip: now lists the logging methods - "לספר במילים או בדיבור (AI), לצלם, לסרוק ברקוד, או לחפש מזון" (matches the caloriemenu options: Mic/Camera/Barcode/History/Search).
4. NEW weekly-summary tip (`key:"weeklysummary"`, `data-tut="weeklysummary"` on the summary bar): fires once on week 1 when the summary bar is visible (`due: week===1 && weeklySummaryShown`, where `weeklySummaryShown = checkinOpen && (dow===6||dow===0)`). Tip ctx gained `week` + `weeklySummaryShown`; effect deps gained `week, dow`. Text: "זה השבוע הראשון שלך בתוכנית! ... ואם שכחת למלא ... אפשר להשלים ולפתוח שוב את הסיכום, והוא יתעדכן."
5. StepSetupModal baseline copy: "מדדנו את הצעדים שלך בשבוע הראשון..." -> "לפי נתוני הצעדים שנמדדו עד כה, הקצב הטבעי שלך הוא בערך X... אפשר גם לשנות את המספר למטה - בהוספה או הורדה של צעדים." AND `stepBaseline` now rounds UP to the nearest 100 (`Math.ceil(sum/n/100)*100`); `steps7avg` (report 7-day avg) stays `Math.round` (unchanged).
6. Step banner tip: "נקודת ההתחלה שלך בצעדים" -> "נקודת ההתחלה שלך במשימת הצעדים".
7. DEV "קבע יום 1" is now a true clean slate: clears log/stepsByDate/waterByDate/checkins/activityLog, resets `weights` to `initWeights(profile.weightKg, sun)`, and resets the program-progress profile fields (`stepBaseline:null, stepGoal:null, calorieOverride:null, tipsSeen:[]`, `goalAckWeek:0`). Keeps her base stats (age/height/weight/diet). This fixes both the "leftover 2,000 steps / 165 kcal on day 3" and the "step baseline banner vanished after reset" reports (it had preserved a previously-set stepBaseline). Not a production issue - real users start empty.
- VERSION 1.28->1.29 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7. data-tut targets now 8 (added weeklysummary). NOTE: the new weekly-summary tip + the tracker-spotlight change are a first VISUAL pass - eyeball on device.

## v1.28 - Report weight label: "משקל נוכחי" -> "משקל (עדכון אחרון: <date>)"
- Owner: "current weight" was misleading since the shown value is the last logged weight, not necessarily today's. Relabeled the ReportScreen weight card to "משקל (עדכון אחרון: D.M.YYYY)" using the date of the latest weight entry (`weights[last].date`). The parenthetical is smaller/fainter. The onboarding "משקל נוכחי" Field (step 0) is unchanged - appropriate there.
- `lastWUpdate` derived from `weights[weights.length - 1].date`.
- VERSION 1.27->1.28 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.

## v1.27 - DEV: "קבע יום 1" button (anchor this week's Sunday as day 1)
- Testing helper so the owner can simulate a participant starting fresh, without the access+onboarding round-trip. Added a teal "קבע יום 1" button to DevDateBar.
- `devAnchorDay1` (App): computes `sundayOf(TODAY)`, then writes the full state blob to STORAGE_KEY directly (synchronous, no React-effect race) with `profile.startDate = that Sunday`, `profile.tipsSeen = []` (so the tour/tips re-appear), `onboarded: true`; also sets `myprime_dev_today` to that Sunday; then reloads. Result: lands on day 1 = that Sunday, onboarded, tips re-armed. Stepping +1 walks the progression (day 3 tour, week-2 step banner, week-3 water/protein).
- Why needed: `startDate` is `sundayOf(TODAY)`, so resetting on a Saturday snapped day 1 to the PREVIOUS Sunday (today became day 7). The button removes the weekday dependency for testing. DevDateBar got `flexWrap` to fit the extra button. Still entirely behind `?dev=1`.
- VERSION 1.26->1.27 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.

## v1.26 - Fix: tips must not fire on the intro / shabbat screens
- BUG (owner screenshot): on program day 2 the steps tip popped up over the "ברוכה הבאה" welcome screen with a full dim and no spotlight. Cause: `STEPS_UNLOCK = {week:1,day:2}` so `stepsOpen` is true from day 2, but days 1-2 render the intro placeholder (no rings), so the tip was "due" with no on-screen target -> TutorialOverlay's no-rect fallback (full dim + bottom bubble). It was alone (1/1) because checkin/cal unlock only on day 3.
- Fix: added `const isIntro = progDay >= 1 && progDay <= 2;` and the tip-start effect now early-returns when `isIntro || isShabbatRest` (also added both to its deps). The render branch reuses `isIntro` (single source). So the steps tip now appears on day 3 as part of the day-3 tour, when the ring is actually visible.
- VERSION 1.25->1.26 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.

## v1.25 - Contextual tips: explainer bubble for every feature on its first-appearance day
- Generalized the day-3 tour into a one-time TIP SYSTEM. Replaced the fixed `TUTORIAL_STEPS` with a `TIPS` registry (module-level, before App): each `{ key, sel, due:(ctx)=>bool, text }`. 7 tips:
  - cal (progDay>=3), steps (stepsOpen), tracker (checkinOpen), cabinet (checkinOpen) - the original day-3 four.
  - stepbaseline (sel "stepbanner", due when the week-2 step banner is active) - owner wanted emphasis even though the banner is self-explanatory.
  - water (due when waterOpen) - fuller text per owner: states the 2-liter goal AND that cup size is set via the water + (onSetCup -> profile.cupMl).
  - protein (due when macroOpen) - explains it is NOT filled manually; auto-calculated and auto-updated from logged food.
- DayScreen: `stepBannerActive`, `tipQueue`/`tipIdx` state. An effect (guarded by `tipIdx === -1`) snapshots all due+unseen tips into a queue and starts; `tipAdvance` walks the queue and on finish calls `onTipsSeen(keys)` to persist. If several tips are due the same day they queue in registry order (e.g. day 3 still shows cal->steps->tracker->cabinet). Reuses the existing `TutorialOverlay` (spotlight + bubble) - now fed `steps={tipQueue}`.
- data-tut added: protein (ProteinRing wrapper), water (water MetricRing wrapper), stepbanner (the step-goal banner). Existing: cal/steps/tracker/cabinet.
- Persistence: replaced the `tutorialSeen` boolean with `profile.tipsSeen` (array of seen tip keys). DEFAULT_PROFILE `tipsSeen: []`; existing profiles (undefined) are treated as [] so tips show once for them too. App passes `tipsSeen` + an `onTipsSeen` that appends keys.
- CheckinModal: one-time amber note at the top ("חלק מהמשימות מסומנות 'אוטומטי' - הן מתעדכנות לבד...") with a "הבנתי" that marks `tipsSeen` key "autotasks". Shown only when the day has auto tasks and the note was not yet dismissed. Modal now receives `tipsSeen` + `onTipsSeen`.
- VERSION 1.24->1.25. tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7; grep confirms 0 refs to the removed tutStep/tutAdvance/TUTORIAL_STEPS/tutorialSeen/onTutorialDone.
- NOTE: the day-3 bubbles are owner-confirmed good; the NEW bubbles (water/protein/stepbanner) are a first visual pass - eyeball positioning on device (esp. the step banner near the top, and protein/water in row 2).

## v1.24 - First-day tutorial (coachmark tour) on program day 3
- On the first data-filling day (progDay >= 3, the w1d3 unlock), a 4-step guided tour appears automatically, once. Sequence + texts (owner-specified for 1-2, drafted in Anat's voice for 3-4):
  1. cal ring: "בלחיצה על הפלוס את ממלאת את המזון... והפעילות הגופנית (חוץ מהצעדים)..."
  2. steps ring: "כאן את ממלאת את הצעדים... עדיף מאוחר ביום אחרי בדיקה באפליקציית הבריאות..."
  3. tracker (יומן המעקב): daily-tasks + medal explanation.
  4. cabinet (ארון הגביעים): medals + trophies collection.
- Implementation: targets tagged with `data-tut="cal|steps|tracker|cabinet"`; `TutorialOverlay` querySelectors the current target, `scrollIntoView` (handles tracker/cabinet below fold), measures rect, draws a box-shadow spotlight + "2px white" ring, and a bubble (positioned below the target if it is in the top half, else above) with the text + "הבנתי" + a step counter. A full-screen click-blocker prevents app interaction mid-tour. If a target is not found it falls back to a full dim + centered-ish bubble.
- Trigger/persist: DayScreen `tutStep` state (-1 idle, 0..3 active, 99 done); effect starts it when `!tutorialSeen && progDay >= 3`; "הבנתי" advances; after the last, calls `onTutorialDone` -> sets `profile.tutorialSeen = true` (persisted, never shows again). DEFAULT_PROFILE gets `tutorialSeen: false`; existing profiles (undefined) are falsy so it shows once for them too.
- To RE-TEST: reset the demo (clears tutorialSeen). Use ?dev=1 to set today to program day 3.
- VERSION 1.23->1.24. tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.
- NOTE: first VISUAL pass (sandbox cannot render). Bubble positioning, the spotlight fit, and scroll-into-view for the tracker/cabinet (below the fold) should be eyeballed on device and tuned.

## v1.23 - DEV-only "simulated today" tool for testing (gated by ?dev=1)
- Owner wanted to step through days and preview what a participant sees each day, WITHOUT this shipping to real users. Implemented as a URL-gated dev tool - no flag to remember to flip, inert in production:
- `const DEV = URLSearchParams(location.search).has("dev")`. `TODAY` now reads an override from `localStorage["myprime_dev_today"]` (validated YYYY-MM-DD) ONLY when `?dev=1` is present; otherwise it is the real `ymd(new Date())`. Since TODAY is the single source (seeds, programWeek line ~3054, app `today`/`selectedDate` init, profile week calc, screen defaults), overriding it recomputes the whole app for the simulated day.
- `DevDateBar` (rendered only when DEV) - a thin dark bar absolutely positioned at the top of the phone-frame with: -1 / date-picker / +1 / איפוס. Each writes `myprime_dev_today` and reloads so everything recomputes.
- Production: real users never pass `?dev=1`, so the bar never shows and TODAY is always the real date. Nothing to remove before the PWA goes live. To use: open `...vercel.app/?dev=1`, set/step the day; "איפוס" clears the override.
- VERSION 1.22->1.23. tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.

## v1.22 - Remove "צעדים היום" cell from the report step summary
- The report (ReportScreen) step-summary header had 3 cells: צעדים היום / היעד היומי / ממוצע 7 ימים. The "צעדים היום" cell showed 0 and was confusing in the report (the report is not tied to a specific day; today's steps belong on the יומן). Removed it - now 2 cells: היעד היומי (highlighted) + ממוצע 7 ימים.
- Highlight now keyed off a `hl: true` flag on the היעד-היומי cell (was `i === 1`), so it stays correct with 2 cells. `stepsToday` const is now unused (harmless, left in place).
- VERSION 1.21->1.22 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.

## v1.21 - Drop "מודדת ממוצע" from the week-1 steps ring
- In week 1 the steps `MetricRing` sub showed "מודדת ממוצע" (owner: confusing/unclear). Emptied it: `sub` is now "" when there is no goal, so the ring shows just the step count + "צעדים". The profile step-goal field still shows "מודדת ממוצע" as its value (owner only flagged the ring; left as-is, easy to change if he wants).
- VERSION 1.20->1.21 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.

## v1.20 - Bigger text app-wide + "שומרת שבת" moved into base-data section
- "שומרת שבת" toggle moved from a standalone card in ProfileScreen INTO the collapsible "נתוני בסיס" section (as a row after תחילת התוכנית, before the week note). Onboarding shabbat question (step 0) unchanged.
- Text enlarged app-wide: uniform +1px on EVERY `fontSize` (367 occurrences) via regex - the cleanest global bump given fonts are inline px with no single root knob. "A bit bigger everywhere" per owner.
- Fold protection (owner: must still see the tracker/checkin card above the fold on the day screen): compensated the rings area so bigger text does not push the journal down - the 4 day-screen rings 130->124, grid rowGap 14->10, marginTop 6->2, marginBottom 14->10. Net day-screen vertical budget roughly unchanged while body text is larger.
- VERSION 1.19->1.20 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.
- NOTE: this is a first visual pass (sandbox cannot render). Magnitude (+1) and the ring/gap compensation should be eyeballed on device and tuned.

## v1.19 - Week-2 baseline note: added the upward direction
- The week-2 summary note (v1.18) now also fires when she is tracking >20% ABOVE her goal (`wkStepAvg > stepGoal * 1.2`): a congratulatory text suggesting she set a HIGHER baseline in the profile for more challenge (Anat's increases continue from it). Logic replaced `showStepRecheck` (below-only) with `stepRecheckDir` = "low" | "high" | null; the card renders the matching text. Still text-only, profile-driven, week 2 only, no recalculation/runaway.
- VERSION 1.18->1.19 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.

## v1.18 - One-time week-2 baseline sanity note in the weekly summary
- Owner intent (after rejecting a broader ongoing recalibration as a "bypass" of Anat's methodology): the ONLY goal is that her baseline is sensible; from there Anat's fixed gradual increases run untouched. So this is a single, optional, text-only nudge - NOT an ongoing goal-vs-performance mechanism.
- In `WeeklySummaryModal`: when viewing the WEEK 2 summary, if her week-2 actual step average is tracking >20% BELOW her current goal (`wkStepAvg < stepGoal * 0.8`), show one gentle amber text note suggesting she set a more realistic baseline in the profile ("a goal you'll win"), and noting Anat's increases continue from it. No button/recalibration math - she changes it herself via the existing profile step-goal edit; Anat's scheduled increases then add to whatever she sets.
- Design choice: compares to the GOAL, not the bare baseline, and only flags the DOWNWARD/struggling case. Comparing to the bare baseline would false-positive whenever she simply succeeds at baseline+2000 (that is the goal, not a sign the baseline was wrong) and would push the goal up - the double-count/runaway the owner warned against. Downward-only serves the owner's principle: realistic goal, feeling of winning, not despair.
- Gated to week === 2 (so it is effectively one-time; never appears week 3+). New prop `stepGoal` passed to WeeklySummaryModal.
- VERSION 1.17->1.18 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.

## v1.17 - Daily AI call limit default lowered 40 -> 25
- `api/ai.js`: built-in `AI_DAILY_LIMIT` default changed from 40 to 25 per owner (40 felt high; a heavy-but-legit day of multi-turn chat logging is ~15-25 CALLS, so 25 gives headroom while halving the worst case). Still overridable via the `AI_DAILY_LIMIT` env var with no code change. Burst cap unchanged (10/min).
- VERSION 1.16->1.17 (bumped per the every-code-change rule even though only api/ai.js changed; re-upload BOTH src/App.jsx and api/ai.js).

## v1.16 - Bug fixes from owner testing: white-screen crash + day strip going before start
- **CRASH (white screen) opening the steps entry:** `StepsModal` still passed `goal={curStepGoal || 0}`, but `curStepGoal` was DELETED in v1.14 (it was part of the old auto-bump block). So tapping the step ring "+" threw `ReferenceError: curStepGoal is not defined` and crashed React. Fixed: `goal={effectiveStepGoal(profile.stepGoal, programWeek) || 0}` (single-source goal, `programWeek` is in App scope at line ~3043).
- **Day strip showed days BEFORE the program start ("a week back"):** the strip range used `Math.max(10, programDayNumber(startDate, today) - 1)`. The `10` floor forced 10 days back even when the program started <10 days ago, so the strip extended before the start date. Fixed to `Math.max(0, ...)` so the earliest cell is always exactly day 1 (the start). New users now see just today + future (dimmed); no pre-start days.
- QA LESSON: `tsc --jsx preserve --skipLibCheck` on the single .tsx did NOT flag the undefined `curStepGoal` (no TS2304). So tsc is NOT a reliable undefined-variable check here. New rule: whenever a `const`/variable is removed, `grep -c <name> src/App.jsx` must return 0 (verify no dangling refs). Done for this fix (curStepGoal -> 0, stepBase -> 0).
- VERSION 1.15->1.16 (App.jsx only). tsc 0, brackets 0 0 0, 0 dashes, check-logic 7/7.
- Note: the week-7 seen in the owner's screenshot is from the back-dated April-19 demo start; with a fresh May-31 start, today computes as week 1 (this was the strip bug, not the week calc).

## v1.15 - Server-side per-user AI rate limit (cost protection)
- `api/ai.js` rewritten: before proxying to Anthropic it enforces a per-user rate limit using the SAME Upstash Redis already used by `api/access.js` (no new infra). Per-user DAILY cap (`AI_DAILY_LIMIT`, default 25) and per-minute BURST cap (`AI_BURST_LIMIT`, default 10). Key = `x-user-id` header (the access email, lowercased), falling back to `ip:<x-forwarded-for>` then `anon`. Day key uses Israel-time date (`Intl` Asia/Jerusalem) so the quota resets at local midnight; keys expire (~48h day, 120s minute). Over-limit returns HTTP 429 `{error:'limit', scope, message}`. If the limiter itself throws, it fails OPEN (logs, does not block). If the Upstash vars are unset, the limit is OFF and the app works as before.
- The key still lives only in `process.env.ANTHROPIC_API_KEY` (server side); never in the client. `AI_MODEL` env still overrides the model (set `claude-haiku-4-5` for the cheap path).
- App.jsx: new `aiHeaders()` helper sends `x-user-id` (from `localStorage.myprime_access_email`) on ALL 5 `/api/ai` calls. 429 handled gracefully: `aiNutritionChat` returns the server's gentle message as the reply; `analyzeMeal` throws the message; `aiMealChat` returns `{error,limit,message}`.
- Tuning: change `AI_DAILY_LIMIT` / `AI_BURST_LIMIT` in Vercel env (no code change). Splitting photo vs chat caps would need the client to tag request kind - easy follow-up if wanted.
- VERSION 1.14->1.15. Files changed: src/App.jsx, api/ai.js. qa: tsc 0, brackets 0, 0 dashes, check-logic 7/7.

## v1.14 - Step goal: user-confirmed baseline + transparent, button-driven increases
- Methodology (confirmed by owner = Anat's): personal baseline, then +2000/+2000/+1000/+1000 over weeks 2/4/6/8 (+6000 cumulative). NOT capped at 8,000 - higher starters reach higher (2,000 -> 8,000; 4,000 -> 10,000).
- The goal NEVER changes silently now. A prominent "important" banner appears on the day screen when a step action is pending (pendingStepAction): week>=2 with no baseline -> "קביעת ממוצע צעדים יומי"; an unacknowledged bump week (4/6/8) -> "היעד שלך עולה השבוע". She taps it to act.
- New StepSetupModal: baseline-set (proposes the measured week-1 average, or asks her to estimate with a 2,000-4,000 hint if no data) and increase (shows the bump, lets her ACCEPT or CHANGE via a 250-step +/- stepper). Copy in Anat's voice (owner-approved drafts).
- Data model: profile.stepBaseline (confirmed anchor) + profile.stepGoal (single source of truth for display, set on confirm = baseline + cumOffset(week), updated on each accepted bump or manual edit). effectiveStepGoal simplified to (stepGoal, week) - all screens read the one stored value (no more recompute drift). goalAckWeek tracks acknowledged bumps; confirmBaseline sets it to highestBumpAtOrBelow(week) so mid-program entry does not cascade retroactive prompts.
- Removed the old silent auto-bump useEffect + the goalBump sheet (GoalBumpModal now unused).
- Transparency: profile shows "התחלת ב-X" under the goal; modal explains the journey.
- Profile keeps the goal edit; editing sets stepGoal and future bumps continue from her value (per owner).
- VERSION 1.13->1.14 (App.jsx only). check-logic 7/7; tsc clean; 0 dashes.
- Existing demo profiles have no stepBaseline -> the baseline banner will appear on load (intended: she confirms her start).

## v1.13 - Step goal unified across all screens (bugfix)
- BUG: day ring + report showed the dynamic goal (baseline + weekly offset, e.g. 6,740), but the PROFILE field showed "מודדת ממוצע" and the profile edit modal defaulted to 2,000 - because those two only read profile.stepGoal (null until a Sunday bump actually runs). Mid-program entry (back-dated April start, now week 7) never ran the bumps, so the three screens disagreed.
- FIX: new single-source helper effectiveStepGoal(stepGoalStored, stepsByDate, startDate, week) = week<2 ? null : (stored ?? baseline+cumOffset). Now used by the day ring, report, profile display, profile edit init, AND the bump effect. All screens show the same number; the profile edit opens at the current effective goal (not 2,000), so saving no longer silently resets the goal.
- ProfileScreen now receives stepsByDate + programWeek.
- VERSION 1.12->1.13 (App.jsx only). check-logic 7/7; tsc clean; 0 dashes.
- NOTE: the goal value itself (e.g. 6,740 = baseline 1,740 + 5,000 at week 7) depends on week-1 step data. A back-dated start with no real week-1 steps yields whatever baseline the seed/data gives; for a real user week 1 measures it properly.

## v1.12 - Date line in the check-in modal
- CheckinModal now shows the same date/day/week line as the card, under the title "המעקב היומי שלי" (relLabel + full weekday + d/month + "שבוע N, יום D"). Passed date={selectedDate} + startDate to the modal.
- VERSION 1.11->1.12 (App.jsx only). check-logic 7/7; tsc clean; 0 dashes.

## v1.11 - Card graphics: bigger cabinet trophy + fill button
- Cabinet "ארון הגביעים" button: trophy image enlarged (44x44 -> 72x58, correct 1.25 aspect), padding reduced (10px6px -> 8px4px), gap 6->4, button width 80->84. Owner: trophy was too small with too much padding.
- CheckinCard: replaced the "הקישי לפתיחה" + "כל יום שתמלאי, עוד מדליה לאוסף" hint lines with a solid square brand button "הקישי למילוי המעקב" (onClick -> onOpen, stopPropagation).
- VERSION 1.10->1.11 (App.jsx only). check-logic 7/7; tsc clean; 0 dashes.

## OPEN TASK / DECISION (Phase 2): PWA vs Native + health-band (Xiaomi) integration + migration steps
Full detailed planning doc: **"MyPrime-חיבור-צמיד-שיאומי-תכנון.docx"** (+ .pdf) - included in the handoff zip. The key conclusions and the migration plan, captured here so they survive in CLAUDE.md:

**Why a band needs native:** A PWA on iOS CANNOT read Apple Health / step data (HealthKit is native-only), and cannot read the phone's own pedometer (Core Motion is native-only; there is no reliable web pedometer). So automatic steps from a band or the phone require a native/hybrid app. The current web demo therefore uses MANUAL step entry (chosen for beta - the user reads her daily total from Mi Fitness at end of day and types it in; works with any band).

**Capacitor (the recommended hybrid path):** wraps the SAME React/Vite code in a WebView - it keeps debugging like a web app (Safari Web Inspector on a real iPhone). Only the thin health plugin needs Mac + Xcode and a REAL device (the simulator has no health data; the health permission is a one-shot prompt). The plugin writes steps into the SAME `stepsByDate` store, so the UI is unchanged (there is already a disabled "התחברות לאפליקציית הבריאות" placeholder slot in StepsModal). Native also unlocks the daily 19:00 push notification (the in-app card already gates the report to 19:00 as a placeholder).

**Real "native tax":** a Mac + Apple Developer account ($99/yr) + slower release cadence through app-store review (mitigated with a live-update / OTA mechanism).

**The Xiaomi problem specifically:** the weak link is the flaky Mi Fitness -> Apple Health sync (Xiaomi's own hop; Xiaomi has no public cloud API), NOT the band's measurement.

**Band options:** (a) manual entry [chosen for beta]; (b) the phone's own steps [native only]; (c) band-via-Health as a fill-in [native + flaky for Xiaomi].

**Aggregators (Terra / Rook / Spike):** a ~$400-500/mo floor (Terra: $399 annual / $499 monthly incl ~100k credits) - only worth it at scale; they absorb vendor-API churn. They do NOT cover current Xiaomi/Mi-Fitness cloud (only legacy Mi Bands via Zepp Life). **Amazfit** (same maker, Zepp app, same cheap price) IS cloud-supported by Terra server-to-server, which is **PWA-compatible** (no native needed). Fitbit has a cloud API but is mid-migration to the Google Health API (legacy dies ~Sept 2026) - churn risk.

**DECISION:** Beta = PWA + manual step entry (any band). Auto-steps deferred. If/when pursued: use a cloud band (Amazfit + Terra) to STAY a PWA; otherwise go native (Capacitor + health plugin).

**Migration steps (PWA -> native, when the time comes):**
1. Wrap the existing React/Vite app in Capacitor (same codebase, WebView).
2. Build env: Mac + Xcode (iOS) and/or Android Studio (Android); Apple Developer account ($99/yr).
3. Add a health plugin (HealthKit / Health Connect) that writes into the existing `stepsByDate` store - UI stays the same.
4. Test on a REAL device only (simulator has no health data); handle the one-shot permission prompt.
5. Add a live-update / OTA channel to keep releases fast despite store review.
6. Turn on the native daily 19:00 notification (card already gates to 19:00).
7. Pick the band path per the decision above (cloud band stays PWA-compatible; Mi/Apple-Health is native + flaky).
8. Run the full QA pass (qa/QA-CHECKLIST.md) on a phone AND a computer before any real users / dietitians.

## v1.10 - Summary button polish (Fri/Sat only) + trophy image on cabinet button
- Weekly-summary bar now appears ONLY on Friday (dn 6) and Saturday (dn 0); hidden on other days.
- Bar restyled as a clear button: light brand background (C.brandBg) + brand border + bar-chart icon + label + ChevronLeft.
- WeeklySummaryModal: Anat's motivation line is hidden when there is no data (empty state shows only the "עוד אין נתונים" message, no closing quote).
- Cabinet "ארון הגביעים" button: replaced the white SVG trophy outline with the actual golden trophy image. New asset `public/medals/trophy-icon.webp` = label-free crop of trophy-1 (cup only, no "שבוע N").
- VERSION 1.09->1.10. CHANGED FILES: src/App.jsx, CLAUDE.md, public/medals/trophy-icon.webp (NEW). check-logic 7/7; tsc clean; 0 dashes.
- ASSET NOTE: the cabinet INTERIOR trophies use /medals/trophy-1..9.webp + trophy-champion.webp (real golden trophies, 400x400). If they 404 in production the owner must upload them to public/medals/. Delivered the full medals folder in the zip to be safe.

## v1.09 - Weekly summary (סיכום שבועי) built
- New "סיכום שבועי" bar at the bottom of the tracker-card main area (top border, spans right edge to where the cabinet button starts; inline bar-chart SVG + label; stopPropagation so it does not open the check-in). Wired App -> DayScreen -> CheckinCard via onOpenSummary.
- New WeeklySummaryModal (sheet "weeklySummary"): computes LIVE on every open (re-tap after adding data recomputes). Covers the program week of the SELECTED date (navigate to a past week's day to see that week's summary). Aggregates only days that are unlocked, <= today, and have tasks (Saturday included for non-keepers).
- Aggregation (weeklySummaryData): bool/workout tasks -> COUNT of days done ("ב-X ימים" / "X אימונים", no denominator); number tasks (steps, water cups, veg, mealorder, sleep, fasting) -> AVERAGE over reported days ("בממוצע X" + "ב-N לילות שדיווחת" for sleep). Steps also compared to the previous week's average. Calories: avg kcal/day vs dailyTarget + "על היעד ב-X ימים" where on-goal = within 95%-105% of target (ASSUMPTION - owner to confirm band). Protein: avg g/day vs targets.protein. Only positives shown (zero-count tasks are skipped, warm tone).
- Motivation: WEEKLY_MOTIVATION[week-1] closes each summary in Anat's voice; week 10 = the long "program ends, keep the habits" text (no "מסע"). ALL summary copy + phrasing is DRAFT - owner will refine.
- VERSION 1.08->1.09 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.
- Note: calorie 95% rule lives here (calorie on-goal count), since calories is not a daily check-in task.

## v1.08 - Cheers stay (close button, no auto-dismiss)
- Removed the auto-dismiss timers from CheckinCheer and TrophyCheer (they "ran away" before the owner could enjoy them). Both now stay until dismissed.
- Added a warm close button to both: medal -> "יאללה, ממשיכות 💜"; trophy -> "ממשיכות חזק 💜" (champion week 10 -> "סגירה 💜"). Tap-outside still closes.
- Confirmed: the trophy cheer fires on BACKFILL too - the auto-award effect detects an increase in earned-trophy count on any data change (after mount), regardless of which day was filled.
- VERSION 1.07->1.08 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.

## v1.07 - Medal pops for any completed day (was today-only)
- Auto-award effect: the medal cheer now fires when ANY day newly completes (not only `today`). Fixes "completed week 2 day 3, no medal popped" - that day was not the demo's today, so the old `d === today` guard suppressed it. The first-load `celebRef.mounted` guard still prevents pops on app open.
- Reminder: a day completes only when ALL its tasks are done. E.g. week 2 day 3 = steps (auto) + food journal (auto) + strength (manual). Filling only strength will not complete it; steps must be entered and food logged for that date too.
- VERSION 1.06->1.07 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.

## OPEN TASK (owner): owner will supply/refine the weekly-summary copy later (motivation lines 1-10 + metric phrasing). Hold final copy until provided. Aggregation spec is otherwise locked (live recompute on button tap; counts as "ב-X ימים" no denominator; averages "בממוצע X, ב-N ימים שדיווחת"; add calories/day-vs-target and protein/day-vs-target; count days within 95% of calorie target as on-goal).

## Copy rule (owner): AVOID the word "מסע" anywhere in UI/copy (Anat's voice). Also scrub it from the days 1-2 welcome ("ברוכה הבאה למסע") on the next build.

## v1.06 - Celebration animations + 95% protein
- Protein task (auto) now counts as done at 95% of target: autoStatusFor.protein uses `proteinHad >= targets.protein * 0.95`. Affects the card, dayComplete, and medal logic consistently.
- Medal celebration (CheckinCheer): now AUTO-dismisses (~2.6s), no button. Medal image pops with a new `medalIn` keyframe (scale+rotate bounce) on top of the existing confetti. Tap still dismisses.
- New TrophyCheer overlay: when a NEW weekly trophy is earned, a trophy (that week's image, champion for week 10) pops in and auto-dismisses (~3s) with confetti. Warm Anat copy ("גביע השבוע נכנס לארון!" / champion text for week 10).
- Auto-award effect upgraded: a `celebRef` (useRef) guards against popping on first load (sets _done silently on mount, only celebrates on later transitions) and tracks earned-trophy count to detect a NEW trophy. Routing: new trophy -> trophyCheer (priority); else today newly complete -> checkinCheer. New state `cheerTrophyWeek` feeds the trophy image.
- VERSION 1.05->1.06 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.
- RESUMING NEXT: weekly-summary aggregation spec was proposed (count vs average-over-reported-days per task) - awaiting owner's approval + the "ב-5 ימים" vs "5 מתוך 6" choice, then full copy + 10-week motivation bank + mock + build (with the "סיכום שבועי" button bar).

## v1.05 - Collection shows individual medals
- CollectionModal: replaced the single big medal with a wrapping grid of N small medals (40px, count = days earned = _done days), scrollable (maxHeight 176) when many. The "X מדליות" count text and subtitle are KEPT below the grid (owner: keep the number AND show medals visually). 0 medals -> one greyed medal.
- VERSION 1.04->1.05 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.
- WEEKLY SUMMARY (planning): owner says base the CALCULATIONS on the uploaded PDF (Friday weekly-summary column + Sunday weekly-avg-steps) and the WhatsApp/ManyChat flow files, and present it WARM in Anat's voice (not a dry report) with a motivational line that VARIES week to week. Next step: extract the exact weekly calcs from the PDF/flows, draft structure + sample warm copy + a per-week motivation bank for approval, then mock, then build (+ the "סיכום שבועי" button bar in the card).

## v1.04 - Swipe fixes
- Swipe direction FLIPPED per owner (it felt reversed): onTouchEnd now `goDay(dx > 0 ? 1 : -1)`.
- Future/pre-start clamp hardened: goDay now compares with getTime() against [startDate, today] so swipe can never land on a future (not-yet-arrived) or pre-program day.
- VERSION 1.03->1.04 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.
- OPEN VISUAL TASK (owner request): the collection ("ארון הגביעים") should show individual SMALL medals, count = medals earned since program start (now = number of _done days, auto). Need a layout that holds many: shrink the medal size / wrap to a scrollable grid as the count grows. Currently CollectionModal shows ONE medal image + a "X מדליות" count - to be replaced with N small medals.
- OPEN: weekly summary (סיכום שבועי) + its button in the tracker card - still in planning.

## v1.03 - Days 1-2 intro, Saturday tracking for non-keepers, automatic medal
- Days 1-2 of the program: no rings and no tracker card - a placeholder intro panel instead (welcome text, marked as temporary; real onboarding text comes with the help system). Gated on `progDay = programDayNumber(startDate, date)` in {1,2}. Swipe still works there.
- Saturday: new `tasksForDate(startDate, date, keepShabbat)` - for non-Shabbat-keepers, Saturday now shows the SAME tasks as the Friday before it (`activeTasks(week, 6)` = that week's daily tasks; Friday has no strength/mobility so it is exactly the daily set). Shabbat-keepers: Saturday stays a rest day (tasksForDate returns []). DayScreen ciTasks, dayProgress, and the CheckinModal all use tasksForDate now. Rings show on Saturday for non-keepers (they are date-gated, not dow-gated). Weekly trophy still counts Sun-Fri only (Saturday optional, never blocks).
- Automatic medal: removed the "סיימתי להיום" button (now just "סגירה"/close). New `dayComplete(...)` helper (every active task done). An effect in App auto-sets `_done` for any day from start..today that is complete (so all-auto days like day 3 earn the medal by themselves) and pops the "מדליה נכנסה לאוסף" cheer when TODAY transitions to complete. `_done` still drives the existing medal/trophy counts (trackerStats, weekTrophyEarned) - now set automatically instead of by a button. Removed finishCheckin.
- VERSION 1.02->1.03 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.
- STILL OPEN: weekly summary (סיכום שבועי) - needs planning (Friday vs Saturday timing, content) + a "סיכום שבועי" button as a bar at the bottom of the tracker-card main area (right edge to where the cabinet button starts). Not built yet.

## v1.02 - Real trophy icon + swipe between days
- Cabinet button: the lucide Trophy icon was not rendering for the owner, so replaced it with an INLINE SVG trophy (lucide Trophy paths, white stroke) - guaranteed to show. Removed the lucide Trophy import.
- Swipe between days on the day content area (onTouchStart/onTouchEnd on the rings/content div, NOT the strip so it doesn't fight the strip's own horizontal scroll). Swipe RIGHT = previous (earlier) day, swipe LEFT = next (later) day - matches the strip layout (past on the right, future on the left). Threshold 55px and horizontal-dominant (|dx| > 1.5*|dy|). `goDay(delta)` clamps to [profile.startDate, today] and SKIPS Saturday for keepShabbat users (steps one more in the same direction). Tap on strip still works.
- Strip auto-sync: renamed todayRef -> selRef; the selected pill now scrolls into center via a useEffect on [date], so the strip follows the day you swiped to (also covers mount = today).
- VERSION 1.01->1.02 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.
- Swipe direction is easy to flip if it feels backwards (one line in onTouchEnd).

## v1.01 - Fixes to v1.00 tracker card
- Removed the "יומן המעקב שלי" screen title from the top of DayScreen (top now shows only the scrolling day strip, per owner).
- Moved "יומן המעקב שלי" INTO the tracker card as the first header line (with Sparkles icon), with the detailed date line ("שלישי, 2 ביוני · שבוע 9, יום 3") directly below it as a secondary line.
- Cabinet button icon changed from Award (rosette) to Trophy (cup), matching "ארון הגביעים". Import Award->Trophy.
- VERSION 1.00->1.01 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.

## v1.00 - Tracker-card redesign, day-strip progress bars, screen title
- Bottom nav: removed the "האוסף" button - back to 4 tabs + CENTERED FAB (padding restored to 5px 12px). The collection is now opened from the tracker card instead.
- CheckinCard rebuilt: it is now a flex row. LEFT = a solid brand-pink "ארון הגביעים" button (Award icon + label + ChevronLeft, full height, clearly tappable) that opens the collection (stopPropagation so it does not trigger the check-in). RIGHT = the main area (tap opens check-in). The card header is no longer "המעקב היומי שלי" + week pill; it now shows the selected day's date line: relLabel + full day name (HE_DAYS_FULL) + date + "שבוע N, יום D" (D = dowOf 1-6). Week pill removed. `onOpenCollection` prop added (App -> DayScreen -> CheckinCard, = setSheet("collection")).
- DayScreen: added a screen title "יומן המעקב שלי" at the very top. Removed the day-line that sat under the strip (date now lives only in the tracker card header, per owner). Note: on days with no tracker card (week 1 days 1-2, Saturdays) no date text shows except the highlighted strip pill.
- Day strip: the small dot under each day was replaced by a thin completion progress bar at the bottom of each pill. Fills RIGHT->LEFT by that day's tracker completion fraction (new `dayProgress(d)` in DayScreen using programWeekFor/dowOf/activeTasks/autoStatusFor/taskDone). Color STRENGTHENS with completion via new `lerpHex("#F4B8D2","#D81B7A",pct)`; selected (pink) pill uses white fill on a translucent track.
- New module helpers: HE_DAYS_FULL, lerpHex. New import: Award.
- VERSION 0.99->1.00 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.
- STILL OPEN: swipe between days (discussed, owner positive, direction not finalized - not built); the help/explanation system (onboarding screens, per-unlock full-screen explainers, "?" badge popups) - texts not drafted yet.

## v0.99 - Dashboard restructure: cleaner top, stable ring grid, verbs, collection in bottom bar
- Removed the top header on DayScreen (greeting "היי <name>", the "האוסף שלי" pill, the medal logo); tightened the top space. `userName`/`onOpenCollection` props dropped from DayScreen.
- "האוסף שלי" moved to the BOTTOM nav as a button (medal image icon, label "האוסף", opens the collection sheet). Nav button padding shrunk (5px 8px) to fit 5 items + FAB.
- New selected-day line under the day strip, above the rings: relLabel + prettyDate + "שבוע N" (date + day + week, centered).
- Rings now a FIXED 2-col grid - positions never shift when a new ring unlocks: calories top-right (col1/row1), steps top-left (col2/row1), protein bottom-right (col1/row2), water bottom-left (col2/row2). RTL => col1 = right. (Between water unlock w3d2 and protein w3d4 the bottom-right cell is briefly empty - the cost of stable positions.)
- Verb label added at the top of each ring (center = the number, as before): calories/protein "צרכת", water "שתית", steps "צעדת". `MetricRing` got a `verb` prop. All ring text re-spaced to 4 lines (y 40/64/83/97).
- VERSION 0.98->0.99 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.
- STILL OPEN (next batch, owner approved structure first): the help/explanation system - onboarding intro screens, a full-screen explainer on each "first appearance" day (steps w1d2, daily tracker w1d3, water w3d2, protein w3d4), and a small "?" badge on each ring for the first 2 weeks opening a per-metric help popup (protein ring = only "?", no +). Texts to be drafted in Anat's voice for owner approval before building.

## v0.98 - Calorie ring consistent with the others (center = eaten, not remaining)
- `Ring` (calorie) center now shows calories EATEN (`Math.round(consumed)`) instead of remaining, so all four day rings read the same way: center = what you did, ring fills as you progress, subtitle "מתוך X". Over the cap: amber + "מעל היעד (X)". Resolves the confusion where a full ring meant "good progress" on 3 rings but "near your limit" on calories, and "245 מתוך 1,333" was ambiguous (ate vs left). Kept 4 rings (owner: for an older audience clarity > fewer rings).
- VERSION 0.97->0.98 (App.jsx only). check-logic 7/7; tsc clean; 0 em/en dashes.

## v0.97 - Shabbat = full rest day (no measurement), not just a greyed pill
- When `profile.keepShabbat` and the viewed date is Saturday, DayScreen now shows a calm rest view ("שבת שלום, יום מנוחה") instead of the rings/check-in/food content. `const isShabbatRest = profile.keepShabbat && dow === 0;` wraps the day content. Matters mainly when today itself is Saturday (auto-selected). Header + day strip stay so she can navigate to other days.
- VERSION 0.96->0.97 (App.jsx only). qa unaffected; check-logic 7/7; tsc clean; 0 em/en dashes.

## v0.96 - Report steps section moved to top + 3-column table layout
- In ReportScreen the steps section is now the FIRST section (right after the week pill, above the calorie and weight cards).
- Steps header redesigned as one bordered row split into 3 equal cells (table-like): "צעדים היום" | "היעד היומי" (highlighted, brandBg) | "ממוצע 7 ימים". Goal cell shows "במדידה" in week 1. The 14-day bar chart stays below.
- VERSION 0.95->0.96 (App.jsx only). qa unaffected; check-logic 7/7; tsc clean; 0 em/en dashes.

## v0.95 - Verified day-by-day schedule + running step goal + Shabbat option + cleanup
- **Schedule overhaul (src/checkins.js):** rewritten against the 10-week PDF, day by day. Each task now has `startWeek` + `startDow` (1=Sun..6=Fri) + `recur`: "daily" / "strength" (Sun/Tue/Thu, skipped on a mobility day) / "mobility" (explicit `MOBILITY_DAYS` = [[9,1],[10,1],[10,3]]). `activeTasks(week, dow)` now takes the day-of-week; returns [] for Saturday (dow 0/rest). fasting = optional (never blocks finishing).
- Start-day fixes vs the old week-only model: strength w2 d3 (not daily), veg+mealorder w2 d4, water+drinkbefore w3 d2, protein w3 d4, stopeating w4 d2, probiotics w7 d4, antiinflam w8 d2, etc. Full reference: outputs Excel "MyPrime-לוז-מעקב-יומי.xlsx".
- **Running step goal:** week 1 = measure baseline (avg daily steps, days 2-6). From week 2 the goal is a stored running value in `profile.stepGoal`; it goes up on Sundays of weeks 2/4/6/8 (+2000/+2000/+1000/+1000), each bump relative to the LAST goal. She can override it manually in the profile any time; later bumps build on her number. Helpers: `stepBaseline`, `stepGoalCumOffset`, `STEP_BUMP_WEEKS`. Day-screen + report steps ring uses this goal; week 1 shows "מודדת ממוצע" (no target).
- **Goal-increase notice:** `GoalBumpModal` (sheet "goalBump") fires once on the bump Sunday - "היעד היומי שלך עלה היום ל-X (+Y)" + acknowledge. Recorded via `goalAckWeek` (persisted in STORAGE_KEY).
- **7-day average:** report shows rolling 7-day avg daily steps next to "צעדים היום" (`steps7avg`; week 1 = from when she started measuring).
- **Shabbat option:** onboarding Q ("להשתמש בכל ימות השבוע כולל שבת?") + profile toggle "שומרת שבת" -> `profile.keepShabbat`. When on, Saturdays are greyed/disabled in the day strip (rest day); rest of app stays available. (Saturday already has no tasks for anyone.)
- **Cleanup:** removed dead `streakDays`, `StreakCheer`, sheet "streak", and the unused `const streak` in DayScreen. `dowOf(date)` helper added.
- VERSION 0.94->0.95 (re-upload src/App.jsx AND src/checkins.js). qa unaffected; check-logic 7/7; tsc clean; 0 em/en dashes; 19/19 schedule spot-checks pass.

## v0.94 - Streak removed (owner decision); medals-per-day + trophy-per-week only
Owner: the streak ("ימים ברצף") was confusing with backfill and adds no real prize - drop it.
- Removed `checkinStreak` entirely (function + all usages: DayScreen `ciStreak`, CheckinCard `streak` prop + header medals row + subtitle, CheckinCheer `streak`, CollectionModal streak line, App CheckinCheer prop).
- Reward model is now simple: a MEDAL for every completed day (cabinet count, whole program) + a TROPHY per completed week (Sunday-Friday, Saturday optional) + champion (week 10). No streak anywhere in the tracker.
- `CheckinCheer` now shows ONE medal (92px) + "מדליה נכנסה לאוסף!" + Anat note (no streak count / no 1-6 medal fan).
- CheckinCard: removed the top-right streak medals and the "X ימים ברצף" subtitle.
- CollectionModal subtitle: "כל יום שהשלמת שווה מדליה".
- NOTE: the old FOOD-LOG streak (`streakDays`, `StreakCheer`, sheet "streak") is now unreachable dead code (the flame pill that opened it was replaced by the cabinet in v0.91). Left in place (harmless, predates the tracker); its "ימים ברצף" copy is never shown. Can be deleted later if desired.
- VERSION 0.93->0.94 (App.jsx only). qa unaffected; check-logic 7/7.
