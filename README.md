# צ׳אט AI

אתר צ׳אט AI קליל בעברית, שמותאם לטלפון. האתר מדבר רק עם הדומיין של עצמו (בלי CDN, בלי גופנים חיצוניים ובלי אנליטיקס), כך שהוא עובד גם בטלפון עם סינון תוכן.
הכניסה מוגנת בקוד גישה, והתשובות מגיעות מ-NVIDIA דרך ממשק תואם OpenAI.

## מה צריך

- Node.js בגרסה 20.9 ומעלה
- מפתח API של NVIDIA (מ-build.nvidia.com, לוחצים על "Get API Key")

## הרצה מקומית

1. מתקינים את התלויות:
   ```bash
   npm install
   ```
2. מעתיקים את `.env.example` לקובץ חדש בשם `.env.local` וממלאים את הערכים (פירוט בטבלה למטה).
3. בודקים אילו מודלים זמינים למפתח שלכם, ובוחרים אחד ל-`NVIDIA_MODEL`:
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
| `NVIDIA_API_KEY` | כן | מפתח ה-API של NVIDIA (מתחיל ב-`nvapi-`) |
| `NVIDIA_MODEL` | כן | מזהה המודל, למשל `meta/llama-3.3-70b-instruct`. הרשימה המלאה: `npm run models` |
| `ACCESS_CODE` | כן | הקוד שמקלידים במסך הכניסה. כדאי לבחור קוד ארוך שקשה לנחש. שינוי הקוד מנתק את כל מי שמחובר |

## העלאה ל-Vercel

1. מעלים את הפרויקט ל-GitHub ומייבאים אותו ב-Vercel (ההגדרות של Next.js מזוהות לבד).
2. ב-**Settings ← Environment Variables** מוסיפים את שלושת המשתנים מהטבלה (`NVIDIA_API_KEY`, `NVIDIA_MODEL`, `ACCESS_CODE`) עבור Production.
3. מבצעים Deploy. אם שיניתם משתנה אחרי ה-Deploy, צריך לבצע Redeploy כדי שהשינוי ייכנס לתוקף.

## בדיקות

```bash
npm test            # בדיקות יחידה: קוד גישה, קיצור היסטוריה ל-20 הודעות, הגבלת אורך הודעה
npm run typecheck   # בדיקת TypeScript
npm run lint
npm run build
```

בדיקות דפדפן (Playwright) רצות מול שרת NVIDIA מדומה, כך שלא צריך מפתח אמיתי:

```bash
npm run build
npm run mock:nvidia      # בחלון נפרד
ACCESS_CODE=test-code-123 NVIDIA_API_KEY=mock NVIDIA_MODEL=mock NVIDIA_BASE_URL=http://localhost:4010/v1 npx next start -p 3100   # בחלון נפרד
npm run e2e
```

צילומי המסך נשמרים בתיקייה `test-screenshots/`. אם הדפדפן של Playwright לא מותקן, מריצים `npx playwright install chromium`, או מגדירים `CHROME_PATH` לנתיב של Chromium קיים.

## מבנה

- `app/page.tsx` + `components/Chat.tsx`: מסך הצ׳אט
- `components/Markdown.tsx`: הצגת תשובות (נטען רק כשיש תשובה ראשונה)
- `app/login/page.tsx` + `app/api/login/route.ts`: מסך הכניסה
- `app/api/chat/route.ts`: ה-API ששולח את השיחה ל-NVIDIA ומזרים את התשובה
- `proxy.ts`: חוסם גישה לצ׳אט ול-API בלי עוגיית כניסה תקפה
- `lib/systemPrompt.ts`: ההנחיות למודל (תמיד לענות בעברית, בקצרה, בלי קישורים)
