---
name: whatsapp-agent-setup
description: Set up a personal WhatsApp agent on the user's own computer — connects a dedicated WhatsApp number through Green API to Claude Code running locally, locked so it only ever answers its owner. Use when the user wants to build a WhatsApp assistant/bot, connect WhatsApp to Claude Code, or says things like "תחבר לי את הוואטסאפ", "בוא נבנה סוכן וואטסאפ", "set up my whatsapp agent". Handles everything — the user only clicks links in a browser and scans a QR code.
---

# הקמת סוכן וואטסאפ אישי

אתה מקים למשתמש סוכן וואטסאפ שרץ **על המחשב שלו**, בלי שרת.
המשתמש לא מפתח. אל תסביר מונחים טכניים ואל תבקש ממנו להבין ארכיטקטורה —
בקש ממנו רק פעולות פשוטות (ללחוץ על קישור, לסרוק QR, להעתיק שני מספרים).

## מה נבנה

```
מספר וואטסאפ ייעודי → Green API → poller על המחשב → Claude Code → תשובה בוואטסאפ
```

**כלל הזהב:** הסוכן עונה **רק** לבעלים. הודעות מקבוצות, מזרים ומאנשים אחרים
נרשמות ביומן ונזרקות. זה לא הגדרה — זה קוד, והוא נבדק.

---

## לפני שמתחילים — שאל את המשתמש

1. **יש לך מספר טלפון נפרד לסוכן?** חייב להיות מספר **אחר** מהמספר האישי.
   אם אין — עצור. הוא צריך SIM/eSIM נוסף. אל תמשיך עם המספר האישי:
   הסוכן ישב על המספר ההוא ויקרא את ההודעות שלו.
2. **מה המספר האישי שלך?** (זה יהיה "הבעלים" — היחיד שהסוכן עונה לו)

---

## שלב 1 — בדיקת המחשב

```bash
node --version    # צריך 18 ומעלה
claude --version
```

- אין Node → https://nodejs.org (הכפתור הירוק, LTS). זו התקנה רגילה של תוכנה.
- אין Claude Code → המשתמש כבר אמור להכיר; הפנה אותו להדרכת ההתקנה.

## שלב 2 — Green API

בקש מהמשתמש:
1. להירשם ב-https://console.green-api.com (חינם)
2. ליצור instance בתוכנית **Developer** (חינמית)
3. לסרוק את ה-QR **מהמספר הייעודי** (וואטסאפ → מכשירים מקושרים → קישור מכשיר)
4. להעתיק לך שני ערכים מהמסך: **idInstance** ו-**apiTokenInstance**

> ⚠️ אמור למשתמש במפורש: התוכנית החינמית מאפשרת **3 צ'אטים בחודש**.
> אחד מהם הולך על השיחה שלו עם הסוכן, אז נשארות שתי קבוצות.
> זה מספיק כדי להתנסות. לשימוש אמיתי צריך לשדרג.

אמת שהחיבור עלה:
```bash
curl -s "https://api.green-api.com/waInstance<ID>/getStateInstance/<TOKEN>"
```
צריך להחזיר `{"stateInstance":"authorized"}`.
`notAuthorized` → ה-QR לא נסרק או שפג תוקפו. בקש לסרוק שוב.

## שלב 3 — יצירת התיקייה

```bash
mkdir -p ~/whatsapp-agent/{logs,state}
```

צור `~/whatsapp-agent/.env`:
```
GREEN_API_ID_INSTANCE=<ID>
GREEN_API_TOKEN=<TOKEN>
OWNER_CHAT_ID=<ימולא בשלב 5 — אל תנחש>
CLAUDE_MODEL=sonnet
CLAUDE_EFFORT=medium
```
`chmod 600 ~/whatsapp-agent/.env` (מק/לינוקס).

העתק לשם את `templates/poller.mjs`, `templates/CLAUDE.md`,
ואת סקריפט ההפעלה המתאים (`start.command` במק, `start.bat` ב-Windows).

## שלב 4 — הקשחת ההגדרות

כבה כל מה שלא צריך, והכי חשוב — נתק webhooks כדי שההודעות ייכנסו לתור
שה-poller מושך ממנו:

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

**אסור להרכיב את ה-chatId ממספר הטלפון.** וואטסאפ מחזירה לפעמים מזהה
בפורמט אחר (`@lid`), ואז ההשוואה נכשלת בשקט והסוכן פשוט מפסיק לענות.
תמיד קלוט את הערך האמיתי:

בקש מהמשתמש לשלוח **מהמספר האישי** הודעה כלשהי למספר הסוכן. אז:

```bash
curl -s "https://api.green-api.com/waInstance<ID>/receiveNotification/<TOKEN>?receiveTimeout=20"
```

קח את `body.senderData.chatId` **בדיוק כפי שהוא** וכתוב אותו ל-`OWNER_CHAT_ID`.
נקה את ההודעה מהתור:
```bash
curl -s -X DELETE "https://api.green-api.com/waInstance<ID>/deleteNotification/<TOKEN>/<receiptId>"
```

> הטוקן תמיד בא **לפני** פרמטרים ומזהים בנתיב. סדר הפוך מחזיר 403 של nginx
> בלי שום הסבר.

## שלב 6 — חיבור מייל ויומן

הרץ את הסקיל `whatsapp-agent-connect-app`. אפשר גם לדלג ולחזור לזה אחר כך —
בלי זה הסוכן עדיין עונה, פשוט בלי גישה למייל וליומן.

## שלב 7 — הפעלה ובדיקה

```bash
cd ~/whatsapp-agent && node poller.mjs
```

בקש מהמשתמש לשלוח לסוכן `היי` מהמספר האישי. תוך כ-10 שניות צריכה לחזור תשובה.

**בדיקת הנעילה** — זה מה שנותן לו ביטחון: בקש שיבקש מחבר לשלוח הודעה
למספר הסוכן. לא תחזור תשובה, ובלוג תופיע שורה `ignored`.

## שלב 8 — הפעלה אוטומטית (רשות)

הצע, אל תכפה. עד שהמשתמש לא מבין את זה, עדיף שיפעיל ידנית ויראה מה קורה.
- מק: LaunchAgent ב-`~/Library/LaunchAgents`
- Windows: Task Scheduler, טריגר At log on

---

## תקלות נפוצות

| תסמין | סיבה | פתרון |
|---|---|---|
| 403 של nginx | הטוקן במקום הלא נכון בנתיב | `{method}/{token}/{extra}?{query}` |
| הסוכן לא עונה בכלל | `OWNER_CHAT_ID` לא תואם | חזור לשלב 5, אל תנחש את הערך |
| "צריך להתחבר / OAuth" | הסוכן ראה MCP servers זרים | ודא ש-`mcp.json` בתיקייה ושהוא נטען |
| הסוכן עונה בלי להשתמש בכלים | ההרצה בלי `--allowedTools` | ה-poller מטפל; אל תריץ `claude -p` ידנית |
| הודעות מסוימות מפוספסות | סוג הודעה לא נתמך | טקסט בלבד ב-v1; ראה `ignored` בלוג |
| התור מחזיר את אותה הודעה שוב | לא נמחקה | ה-poller מוחק מיד; אל תסיר את זה |

הכל נרשם ב-`~/whatsapp-agent/logs/messages-YYYY-MM-DD.jsonl` — **כולל** מה שנזרק.

## אל תעשה

- אל תשתמש במספר האישי כמספר הסוכן
- אל תרכיב `OWNER_CHAT_ID` ממספר טלפון
- אל תוסיף יעדי שליחה ל-`EXTRA_SEND_TARGETS` בלי בקשה מפורשת
- אל תפעיל שליחה יזומה לאנשים אחרים כברירת מחדל
