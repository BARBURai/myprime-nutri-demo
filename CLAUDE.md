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

These feed the AI suggestion chat (`RecommendModal`): the seed prompt lists the diet style and, critically, injects allergies+dislikes as a **hard "never suggest" rule** (not a soft preference). **Safety stance:** this is best-effort risk reduction, never a guarantee — an onboarding + profile disclaimer makes clear the app is a coaching aid, not a medical allergy-safety tool, and the user must verify ingredients herself. Do not position the app as "safe for allergies." Existing stored profiles may predate `allergies`, so always read it defensively (`profile.allergies || []`). As of v0.33, `RecommendModal` opens with a **confirm stage**: it shows the diet style + sensitivities (editable inline, persisted to the profile via `setProfile`; "none recorded" hint when empty), and only on "קבלי המלצות" builds the seed and starts the chat — a double-check that reduces wrong-context errors. When sensitivities exist, the seed instructs the assistant to always end with a gentle reminder to verify the full ingredient list, and the confirm stage shows the same caution. As of v0.35 there is **no human-handoff path anywhere** in the app (testers use their program group, not the app): the "talk to someone" quick-reply was removed and the `aiMealChat` prompt now explicitly instructs the assistant not to offer human contact or forward requests; the QA harness verifies that offering human contact is a failure. `ActivityModal` (v0.34) computes burned calories with the MET formula `MET × 3.5 × weightKg ÷ 200 × minutes` — a chosen activity's MET (or a custom "אחר" intensity) × a minutes stepper × the user's body weight, instead of fixed presets. As of v0.36: (1) each meal suggestion includes an inline estimate — kcal + protein/fat/carbs from week 3, kcal-only before week 3 (`estimateRule`, gated by `proteinFocus`, synced in the QA harness); (2) when the user states a new preference/dislike/sensitivity mid-chat, `extractPreferences()` (a small AI call to `/api/ai`) detects it and `RecommendModal` shows a "save to your preferences?" banner — on confirm, diet styles → `profile.diet`, known sensitivities → `profile.allergies`, the rest → appended to `profile.dislikes` (persisted). **Persistence note:** the profile lives in `localStorage` (per device/browser); chat history is ephemeral and is *not* persisted, which is why only saved-to-profile preferences survive across sessions, and why a new device starts fresh (gate + onboarding) — true cross-device sync would require server-side profile storage.

### Backend (Vercel serverless functions in `api/`)
- `api/ai.js` — proxy to the Anthropic Messages API. Requires env var `ANTHROPIC_API_KEY`; optional `AI_MODEL` (defaults to a current Sonnet model). The frontend calls it via `AI_ENDPOINT` (`/api/ai`, overridable with `VITE_AI_ENDPOINT`). The proxy overrides the model server-side, so the model string sent from the client is not authoritative.
- `api/access.js` — access gate: checks an email against the program participant list (`ACCESS_ENDPOINT` / `/api/access`).
- `api/il-food.js` — Israeli food database lookup (`/api/il-food?q=...`).

Barcode scanning (in `AddModal`) — as of v0.31 — prefers the **native `BarcodeDetector` API** (reliable on Android/Chrome incl. Samsung): it opens the rear camera via `getUserMedia` (with best-effort `focusMode: continuous`) and polls `detect()` in a `requestAnimationFrame` loop, advancing on the first code. Browsers without `BarcodeDetector` (e.g. iOS Safari) fall back to `@zxing/browser`'s `decodeFromVideoDevice` with retail format hints + `TRY_HARDER`. `stopScan` runs a stored cleanup (stops the rAF loop, the ZXing controls, and the camera tracks). A successful scan looks the code up on Open Food Facts; manual-code entry is the fallback. (Earlier `decodeFromConstraints` never detected on the target device — hence the rewrite.) Note: photo analysis (`analyzeMeal`) only *estimates* nutrition from appearance and is unreliable for packaged products — the barcode is the accurate path for those. As of v0.29 the photo prompt also reads an on-package nutrition label when one is visible. **Photo flow internals:** the live path is `onPhoto → sendAiImage → aiNutritionChat` (image sent into the logging chat); the standalone `analyzeMeal()` function exists but is **unused** (dead code). v0.30 adds a **hybrid reconciliation**: after the AI identifies items (photo or text logging), `reconcileWithDb()` searches the product DBs (`searchIsraeliDB` + `searchOpenFoodFacts`) by item name and, only on a **strong** name match (`strongMatch`), replaces the AI's estimated values with the DB's real per-100g values scaled to the item's grams, tagging the item `source:"db"` (badge "מהמאגר") vs `source:"estimated"` (badge "מוערך", via `SrcBadge`). Name search is fuzzier than a barcode (no unique id), so unmatched items keep the estimate; the barcode remains the accurate path for packaged products. As of v0.31 the logging prompt (`aiNutritionChat`) also asks about typical accompaniments (e.g. oats/cereal → milk/yogurt + which kind; coffee → milk/sugar) and returns each component as a separate item, so the whole thing is logged at once.

The AI features only work when deployed (or with the functions running), since they depend on `/api/*`. In a plain local `npm run dev` they may not respond — that is expected.

### Beta feedback (`feedback/`)
The notes panel (`NotesFab`, "הערות לדמו") lets testers jot screen-tagged notes. As of v0.32, when `VITE_FEEDBACK_URL` is set it shows a "שלחי משוב לצוות MyPrime" button that POSTs all notes (with device id, app version, tester name, timestamp, per-note screen) to a Google Apps Script web app, which appends one row per note to a "Feedback" sheet. The POST uses `mode:"no-cors"` + `text/plain` (fire-and-forget, avoids CORS preflight). `feedback/Code.gs` is the Apps Script; `feedback/README.md` has the one-time setup (create Sheet → Apps Script → deploy as web app "Anyone" → set `VITE_FEEDBACK_URL` in Vercel → redeploy). Clipboard copy remains as a fallback when no URL is configured.

### Testing / QA (`qa/`)
`qa/run-qa.mjs` is a standalone Node (18+) harness that evaluates the **AI layer only**. It generates a broad scenario matrix (adversarial allergy/diet baits, neutral suggestion-with-allergy, suggestions across profiles, the week-3 protein-gating rule, safety/extreme + medical-condition requests, brand-voice/no-shaming probes, verifying NO human-handoff is offered, off-topic, and meal-logging format/accuracy — ~83 text scenarios) plus optional meal-photo tests driven by `qa/images/manifest.json` (user supplies real plate photos + ground truth; analyzed via the verbatim `analyzeMeal` prompt, checked for expected items + plausible total kcal), runs each through the **same prompts the app uses** (the `aiMealChat`/`aiNutritionChat`/`analyzeMeal` strings and the RecommendModal seed are copied verbatim — `KEEP IN SYNC` if those change in `App.jsx`), then grades each answer with an LLM rubric plus an independent allergen keyword heuristic and rule-based logging/photo-JSON checks. It writes `qa/report.html` + `qa/results.json`. Run with `QA_BASE_URL="https://<app>.vercel.app" node qa/run-qa.mjs` (hits the deployed `/api/ai`, no key needed) or `ANTHROPIC_API_KEY=... node qa/run-qa.mjs`. See `qa/README.md`. This does **not** cover product-data accuracy (FOODS vs ground truth) or functional/device testing, and LLM grading is fallible — human-review all critical fails. There is still no automated test runner for the app itself.

## Working rules (owner preferences — important)

- **Never hand back patches or code snippets.** For every change, deliver a complete, ready-to-paste `src/App.jsx` **and** a full project zip. Never "replace this line" or partial diffs. The owner does not edit code by hand.
- **Bump `VERSION` by 0.01 on every change**, and **state the new version number in the chat reply** (the owner tracks versions; it also shows in the UI). Current version: `0.36`.
- **Preserve the existing structure**, variable/component names, and writing style. Change only what the request needs.
- **Brand voice (Anat Harel):** warm, personal, conversational — "a friend talking, not a marketer selling." No marketing-speak. Applies to all user-facing Hebrew copy.
- **Program logic:** protein and trackers (nutrition/water) are relevant only **from week 3**. Before that they do not appear at all (not locked, not "opens in week X").
