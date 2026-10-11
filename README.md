# צ׳אט AI

אתר צ׳אט AI קליל בעברית, שמותאם לטלפון. האתר מדבר רק עם הדומיין של עצמו (בלי CDN, בלי גופנים חיצוניים ובלי אנליטיקס), כך שהוא עובד גם בטלפון עם סינון תוכן.
הכניסה מוגנת בקוד גישה. התשובות מגיעות מכל ספק שתומך בממשק תואם OpenAI (ברירת המחדל: NVIDIA, אפשר גם Gemini ואחרים).
השיחות נשמרות בדפדפן (localStorage): רשימת שיחות עם שינוי שם, נעיצה ומחיקה.

## מה צריך

- Node.js בגרסה 20.9 ומעלה
- מפתח API של ספק AI, למשל NVIDIA (מ-build.nvidia.com, לוחצים על "Get API Key")

## הרצה מקומית

1. מתקינים את התלויות:
   ```bash
   npm install
   ```
2. מעתיקים את `.env.example` לקובץ חדש בשם `.env.local` וממלאים את הערכים (פירוט בטבלה למטה).
3. בודקים אילו מודלים זמינים למפתח שלכם, ובוחרים אחד ל-`AI_MODEL`:
   ```bash
   npm run models
   ```
4. מריצים:
   ```bash
   npm run dev
   ```
   ופותחים את http://localhost:3000 בדפדפן.

## משתני סביבה

| משתנה | חובה | מה זה |
| --- | --- | --- |
| `AI_API_KEY` | כן | מפתח ה-API של הספק |
| `AI_MODEL` | כן | מזהה המודל. הרשימה המלאה: `npm run models` |
| `AI_BASE_URL` | לא | כתובת הממשק התואם OpenAI. ברירת מחדל: `https://integrate.api.nvidia.com/v1` |
| `AI_REASONING_EFFORT` | לא | כמה המודל "חושב" לפני שהוא עונה: `none` / `low` / `medium` / `high`. ברירת מחדל: `none` (התשובה מתחילה הכי מהר). יותר חשיבה = התשובה מתחילה מאוחר יותר. אם הספק דוחה את הפרמטר, מגדירים ערך ריק |
| `ACCESS_CODE` | כן | הקוד שמקלידים במסך הכניסה. כדאי לבחור קוד ארוך שקשה לנחש. שינוי הקוד מנתק את כל מי שמחובר |

השמות הישנים (`NVIDIA_API_KEY`, `NVIDIA_MODEL`, `NVIDIA_BASE_URL`) עדיין עובדים: אם משתנה חדש חסר, האתר משתמש בשם הישן.

### דוגמאות לספקים

NVIDIA (ברירת המחדל, אפשר להשמיט את `AI_BASE_URL`):

```bash
AI_API_KEY=nvapi-...
AI_MODEL=meta/llama-3.3-70b-instruct
```

Gemini (דרך הממשק התואם OpenAI של Google):

```bash
AI_API_KEY=...            # מפתח מ-Google AI Studio
AI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
AI_MODEL=gemini-3.6-flash # או כל מודל אחר מ-npm run models
```

מודלים שמציגים "חשיבה" בתגיות `<think>…</think>` נתמכים: החלק הזה מסונן ולא מוצג.

## העלאה ל-Vercel

1. מעלים את הפרויקט ל-GitHub ומייבאים אותו ב-Vercel (ההגדרות של Next.js מזוהות לבד).
2. ב-**Settings ← Environment Variables** מוסיפים את המשתנים מהטבלה (`AI_API_KEY`, `AI_MODEL`, `ACCESS_CODE`, ולפי הצורך `AI_BASE_URL`) עבור Production.
3. מבצעים Deploy. אם שיניתם משתנה אחרי ה-Deploy, צריך לבצע Redeploy כדי שהשינוי ייכנס לתוקף.

## בדיקות

```bash
npm test            # בדיקות יחידה: קוד גישה, קיצור היסטוריה, אחסון שיחות, סינון <think>
npm run typecheck   # בדיקת TypeScript
npm run lint
npm run build
```

בדיקות דפדפן (Playwright) רצות מול שרת AI מדומה, כך שלא צריך מפתח אמיתי:

```bash
npm run build
npm run mock:nvidia      # בחלון נפרד
ACCESS_CODE=test-code-123 AI_API_KEY=mock AI_MODEL=mock AI_BASE_URL=http://localhost:4010/v1 npx next start -p 3100   # בחלון נפרד
npm run e2e          # צ׳אט ו-RTL
npm run e2e:history  # רשימת השיחות
```

צילומי המסך נשמרים בתיקייה `test-screenshots/`. אם הדפדפן של Playwright לא מותקן, מריצים `npx playwright install chromium`, או מגדירים `CHROME_PATH` לנתיב של Chromium קיים.

## מבנה

- `app/page.tsx` + `components/Chat.tsx`: מסך הצ׳אט
- `components/Sidebar.tsx`: רשימת השיחות (מגירה בטלפון, סרגל צד במחשב)
- `lib/history.ts`: שמירת השיחות ב-localStorage, העברה מהגרסה הקודמת, מיון וקיבוץ לפי תאריך
- `components/Markdown.tsx`: הצגת תשובות (נטען רק כשיש תשובה ראשונה)
- `app/login/page.tsx` + `app/api/login/route.ts`: מסך הכניסה
- `app/api/chat/route.ts`: ה-API ששולח את השיחה לספק ה-AI ומזרים את התשובה
- `proxy.ts`: חוסם גישה לצ׳אט ול-API בלי עוגיית כניסה תקפה
- `lib/systemPrompt.ts`: ההנחיות למודל (תמיד לענות בעברית, בקצרה, בלי קישורים)
