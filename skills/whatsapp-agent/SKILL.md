---
name: whatsapp-agent
description: Build, extend and fix a personal WhatsApp agent that runs on the user's own computer — a dedicated WhatsApp number connected through Green API to Claude Code running locally, locked so it only ever answers its owner. Use for anything about a personal WhatsApp agent or bot — "תתקין לי סוכן וואטסאפ", "תקים לי סוכן וואטסאפ", "תחבר לי את הוואטסאפ", "בוא נבנה סוכן וואטסאפ", "set up my whatsapp agent" — and also to teach it new capabilities ("שיאסוף לי קבלות", "תוסיף לו יכולת") or to diagnose it when it stops working ("הסוכן לא עונה", "משהו לא עובד", "תריץ doctor על הסוכן"). Handles everything; the user only clicks links in a browser and scans a QR code. This is about building the AGENT — if the user just asked to copy these skill files from a repo, that is already done; do not re-run it.
---

# סוכן וואטסאפ אישי

מקים למשתמש סוכן וואטסאפ שרץ **על המחשב שלו**, בלי שרת.
המשתמש לא מפתח. אל תסביר ארכיטקטורה ואל תשתמש במונחים טכניים —
בקש ממנו רק פעולות פשוטות: ללחוץ על קישור, לסרוק QR, להעתיק שני ערכים.

```
מספר וואטסאפ ייעודי → Green API → poller על המחשב → Claude Code → תשובה בוואטסאפ
```

**כלל הזהב:** הסוכן עונה **רק** לבעלים. הודעות מקבוצות, מזרים ומכל אחד אחר
נרשמות ביומן ונזרקות. זה לא הגדרה — זה קוד, והוא נבדק.

## מה עושים כאן

| הבקשה | לאן ללכת |
|---|---|
| להקים סוכן חדש | המשך לשלבים למטה |
| ללמד את הסוכן יכולת חדשה | `references/adding-capabilities.md` |
| משהו לא עובד | `references/troubleshooting.md` — **קרא לפני שאתה מנחש** |

---

## איפה מתקינים

**בתיקייה שהמשתמש עובד בה עכשיו**, תת-תיקייה בשם `whatsapp-agent/`.
לא בבית, לא בנתיב גלובלי. כל פרויקט מקבל סוכן משלו.

**אל תחפש התקנות קודמות במקומות אחרים ואל תדווח עליהן.**
המשתמש ביקש להקים סוכן — תקים אותו כאן.

היוצא מן הכלל היחיד: אם `./whatsapp-agent` כבר קיים **בתיקייה הזו**, שאל את
המשתמש אם להמשיך אותו או לבחור שם אחר. אל תמחק ואל תדרוס — יש שם `.env` ולוגים.

> שים לב: כשתיקיית הסוכן יושבת בתוך פרויקט, ההרצה תטען גם `CLAUDE.md` של
> הפרויקט שמעליה, לא רק את זה של הסוכן. בדרך כלל זה לא מזיק. אם הפרויקט מכיל
> הנחיות שמתנגשות עם התנהגות הסוכן — התקן בתיקייה נפרדת ונקייה.

---

## לפני שמתחילים — שאל את המשתמש

1. **יש לך מספר טלפון נפרד לסוכן?** חייב להיות מספר **אחר** מהמספר האישי.
   אין → עצור. הוא צריך SIM/eSIM נוסף. אל תמשיך עם המספר האישי:
   הסוכן יושב על המספר וקורא את ההודעות שלו.
2. **מה המספר האישי שלך?** זה יהיה "הבעלים" — היחיד שהסוכן עונה לו.

---

## שלב 1 — בדיקת המחשב

```bash
node --version    # צריך 18 ומעלה
claude --version
```
אין Node → https://nodejs.org (LTS). התקנה רגילה של תוכנה.

## שלב 2 — Green API

בקש מהמשתמש:
1. להירשם ב-https://console.green-api.com (חינם)
2. ליצור instance בתוכנית **Developer** (החינמית)
3. לסרוק את ה-QR **מהמספר הייעודי** (וואטסאפ → מכשירים מקושרים → קישור מכשיר)
4. להעתיק שני ערכים: **idInstance** ו-**apiTokenInstance**

> ⚠️ אמור לו במפורש: התוכנית החינמית מוגבלת ל-**3 צ'אטים**.
> אחד מהם הולך על השיחה שלו עם הסוכן, אז נשארות שתי קבוצות.
> מספיק להתנסות; לשימוש אמיתי צריך לשדרג.

אמת:
```bash
curl -s "https://api.green-api.com/waInstance<ID>/getStateInstance/<TOKEN>"
```
`{"stateInstance":"authorized"}` → תקין. `notAuthorized` → לסרוק QR שוב.

## שלב 3 — יצירת התיקייה

```bash
mkdir -p whatsapp-agent/{logs,state}
```

`./whatsapp-agent/.env`:
```
GREEN_API_ID_INSTANCE=<ID>
GREEN_API_TOKEN=<TOKEN>
OWNER_CHAT_ID=<ימולא בשלב 5 — אל תנחש>
CLAUDE_MODEL=sonnet
CLAUDE_EFFORT=medium
# TIMEOUT_MINUTES=0   # 0/לא מוגדר = בלי מגבלת זמן. ריצה ארוכה לא תיקטע באמצע
```
`chmod 600 ./whatsapp-agent/.env` (מק/לינוקס).

התבניות נמצאות **בתיקיית הסקיל הזה**, תחת `templates/`.
העתק ל-`./whatsapp-agent/` את `poller.mjs`, `CLAUDE.md`, ואת סקריפט ההפעלה
המתאים — `start.command` במק (ואז `chmod +x`), `start.bat` ב-Windows.

## שלב 4 — הקשחת ההגדרות

נתק webhooks כדי שההודעות ייכנסו לתור שה-poller מושך ממנו, וכבה כל השאר:

```bash
curl -s -X POST "https://api.green-api.com/waInstance<ID>/setSettings/<TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"webhookUrl":"","outgoingWebhook":"no","outgoingMessageWebhook":"no",
       "outgoingAPIMessageWebhook":"no","incomingCallWebhook":"no",
       "pollMessageWebhook":"no","editedMessageWebhook":"no",
       "deletedMessageWebhook":"no","incomingWebhook":"yes"}'
```
⚠️ `setSettings` מאתחל את האינסטנס — חכה דקה ובדוק `getStateInstance` שוב.

## שלב 5 — קליטת ה-chatId האמיתי (אל תדלג)

**אסור להרכיב את ה-chatId ממספר הטלפון.** וואטסאפ מחזירה לפעמים מזהה בפורמט
אחר (`@lid`), וההשוואה נכשלת בשקט — הסוכן פשוט מפסיק לענות.

בקש מהמשתמש לשלוח **מהמספר האישי** הודעה כלשהי למספר הסוכן, ואז:
```bash
curl -s "https://api.green-api.com/waInstance<ID>/receiveNotification/<TOKEN>?receiveTimeout=20"
```
קח את `body.senderData.chatId` **בדיוק כפי שהוא** → `OWNER_CHAT_ID`. ונקה:
```bash
curl -s -X DELETE "https://api.green-api.com/waInstance<ID>/deleteNotification/<TOKEN>/<receiptId>"
```

> הטוקן תמיד בא **לפני** פרמטרים ומזהים בנתיב:
> `{method}/{token}/{extra}?{query}`. סדר הפוך מחזיר 403 של nginx בלי הסבר.

## שלב 6 — גישה למערכות חיצוניות (Composio)

אפשר לדלג ולחזור לזה — בלי זה הסוכן עונה, פשוט בלי גישה למייל וליומן.

**חד-פעמי.** ההוראה ב-`CLAUDE.md` גנרית, כך שכל מערכת שהמשתמש יחבר בעתיד
בדשבורד תעבוד מיד — אין מה "לחבר לסוכן" בכל פעם.

**מק / לינוקס:**
```bash
curl -fsSL https://composio.dev/install | bash    # אם עוד לא מותקן
~/.composio/composio login                        # מדפיס קישור — תן למשתמש ללחוץ
~/.composio/composio login --poll                 # ממתין עד 10 דק' ומסיים לבד
```
> אל תשתמש ב-`login --agent` — מחבר חשבון סוכן, לא של המשתמש.

את האפליקציות המשתמש מחבר ב-https://dashboard.composio.dev.
**אל תריץ `composio link`** — דורש טרמינל אינטראקטיבי, נתקע, ומשאיר `INITIALIZING`.

אימות: `~/.composio/composio connections list` → הכל `"status": "ACTIVE"`.
ודא ש-`./whatsapp-agent/mcp.json` הוא `{"mcpServers":{}}` — מכוון, כדי שהסוכן
לא יראה MCP servers שהמשתמש הגדיר במקום אחר.

**Windows:** ל-Composio אין CLI ל-Windows (המתקין עוצר ומפנה ל-WSL). במקום:
```json
{"mcpServers":{"composio":{"command":"npx","args":["-y","@composio/mcp@latest"],
 "env":{"COMPOSIO_API_KEY":"<מפתח מהדשבורד>"}}}}
```
והתאם את סעיף הגישה ב-`CLAUDE.md` לכלים במקום ל-CLI.
⚠️ המסלול הזה **לא נבדק על Windows אמיתי** — אמור זאת ובדוק מקצה לקצה.

## שלב 7 — הפעלה ובדיקה

הרצה ידנית **לצורך הבדיקה בלבד** — בשלב 8 היא מוחלפת בהפעלה קבועה:
```bash
cd whatsapp-agent && node poller.mjs
```
בקש מהמשתמש לשלוח `היי` מהמספר האישי. תוך ~10 שניות תחזור תשובה.

**בדיקת גישה אמיתית** (אם חובר Composio):
```bash
cd whatsapp-agent && echo "מה יש לי ביומן השבוע?" | claude -p --output-format json \
  --model sonnet --effort medium --allowedTools Bash Read Grep \
  --strict-mcp-config --mcp-config mcp.json
```
`num_turns` = 1 → הסוכן לא הריץ כלום. **זו תקלה**, גם אם התשובה נשמעת סבירה.

**בדיקת הנעילה** — זה מה שנותן למשתמש ביטחון: שיבקש מחבר לשלוח הודעה למספר
הסוכן. לא תחזור תשובה, ובלוג תופיע שורה `ignored`.

**ספר למשתמש על `/reset`:** אחרי ריצה ארוכה השיחה תופחת והתשובות מאטות.
שליחת `/reset` (או "אפס שיחה") מתחילה שיחה נקייה בלי לאבד יכולות או חיבורים.

## שלב 8 — הפעלה אוטומטית

**חלק מההתקנה, לא תוספת.** אל תשאל אם המשתמש רוצה — פשוט הגדר.

ה-poller הוא תהליך רגיל: אם הפעלת אותו מתוך סשן של Claude Code או מחלון טרמינל,
הוא מת כשהסשן נסגר. **בלי שגיאה, בלי הודעה — פשוט שקט.** המשתמש יגלה את זה
רק כשהוא ישאל משהו ולא תחזור תשובה, ויחשוב שהסוכן שבור.

זו הסיבה שההרצה הידנית בשלב 7 היא לבדיקה בלבד. **עצור אותה לפני שאתה ממשיך.**

**מק:** קח את `templates/autostart.mac.plist`, החלף `__NODE_PATH__` (מ-`which node`),
`__AGENT_DIR__` (הנתיב המלא לתיקיית הסוכן) ו-`__HOME__`, ושמור ל-
`~/Library/LaunchAgents/com.whatsapp-agent.plist`. אז:
```bash
launchctl unload ~/Library/LaunchAgents/com.whatsapp-agent.plist 2>/dev/null
launchctl load  ~/Library/LaunchAgents/com.whatsapp-agent.plist
launchctl list | grep whatsapp-agent
```
`KeepAlive` מרים אותו לבד גם אם ייפול. לרסטארט אחרי שינוי קוד:
`launchctl kickstart -k gui/$(id -u)/com.whatsapp-agent`

> `setsid` לא קיים במק. אם צריך להפעיל ידנית ברקע: `nohup node poller.mjs >> logs/poller.out 2>&1 &`

**Windows:** Task Scheduler, טריגר At log on, פעולה `node`, ארגומנט `poller.mjs`,
"Start in" = תיקיית הסוכן.

**חשוב:** לפני שמתקינים הפעלה אוטומטית — **תעצור poller שרץ ידנית.**
שני pollers על אותו אינסטנס מושכים מאותו תור ועונים פעמיים. ה-poller מזהה את זה
ומסרב לעלות (`poller.pid` ב-`state/`), אבל עדיף לא להגיע לשם.

---

## אל תעשה

- אל תשתמש במספר האישי כמספר הסוכן
- אל תרכיב `OWNER_CHAT_ID` ממספר טלפון — תמיד קלוט אותו מהודעה
- אל תוסיף יעדים ל-`EXTRA_SEND_TARGETS` בלי בקשה מפורשת
- אל תפעיל שליחה יזומה לאנשים אחרים כברירת מחדל
- אל תוסיף cron או תזמון — אין הרצה מתוזמנת בגרסה הזו

הכל נרשם ב-`./whatsapp-agent/logs/messages-YYYY-MM-DD.jsonl` — **כולל** מה שנזרק.
כשמשהו לא מסתדר, `references/troubleshooting.md` לפני כל ניחוש.
