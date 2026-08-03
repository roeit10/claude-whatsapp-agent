---
name: whatsapp-agent-connect-app
description: Connect Gmail, Google Calendar, Monday, Airtable and 1000+ other apps to the WhatsApp agent through Composio, and verify the connection actually works from inside the agent's own folder. Use when the user wants the agent to read email, manage the calendar, or reach any external system — "תחבר לו את המייל", "שיראה לי את היומן", "connect gmail to the agent" — or when the agent replies that it has no access to something — "תחבר לו את המייל", "שיראה לי את היומן", "תחבר לסוכן את היומן והמייל", "connect gmail to the agent".
---

# חיבור אפליקציות לסוכן

מחבר את הסוכן למערכות חיצוניות דרך **Composio**.
המשתמש כבר מכיר את Composio משיעור 5 במועדון — אל תסביר מה זה MCP ואל תיכנס לפרוטוקולים.

## קודם כל — זהה מערכת הפעלה

זה קובע הכל. ל-Composio **אין תמיכה ב-Windows** ב-CLI שלו
(המתקין עצמו עוצר עם "Windows is not supported"), אז יש שני מסלולים נפרדים.

```bash
node -e "console.log(process.platform)"   # darwin | linux | win32
```

---

## מסלול א׳ — מק / לינוקס (CLI)

### 1. התקנה
```bash
curl -fsSL https://composio.dev/install | bash
```
מתקין ל-`~/.composio/composio` ומוסיף ל-PATH. **פתח טרמינל חדש** אחרי זה,
או השתמש בנתיב המלא `~/.composio/composio`.

### 2. התחברות
```bash
~/.composio/composio login
```
זה מדפיס קישור. **תן אותו למשתמש שילחץ** — אל תנסה לפתוח דפדפן בעצמך.
אחרי שהוא אישר:
```bash
~/.composio/composio login --poll
```
ממתין עד 10 דקות ומסיים לבד. אמת שהחשבון נכון — ה-email שחוזר צריך להיות
של המשתמש.

> אל תשתמש ב-`composio login --agent`. זה יוצר חשבון סוכן נפרד ומחבר
> את המערכות לחשבון הלא נכון.

### 3. חיבור האפליקציות — בדפדפן
שלח את המשתמש ל-https://dashboard.composio.dev ובקש שיחבר שם את מה שהוא צריך
(Gmail, Google Calendar וכו').

> **אל תריץ `composio link <app>`.** הפקודה דורשת טרמינל אינטראקטיבי, ומתוך
> סקריפט היא נתקעת בשקט ומשאירה חיבור תקוע במצב `INITIALIZING`.
> הדשבורד גם פשוט יותר למשתמש — כמה קליקים.

### 4. אימות
```bash
~/.composio/composio connections list
```
כל מה שצריך חייב להיות `"status": "ACTIVE"`.
`INITIALIZING` תקוע = חיבור חצי-גמור; הסר אותו עם `composio connections remove`.

### 5. mcp.json
במסלול הזה הסוכן לא צריך MCP בכלל. ודא ש-`~/whatsapp-agent/mcp.json` הוא:
```json
{"mcpServers":{}}
```
זה **מכוון**: כך הסוכן לא רואה שרתים אחרים שהמשתמש הגדיר במקום אחר.

---

## מסלול ב׳ — Windows (MCP)

ה-CLI לא זמין, אז משתמשים בשרת ה-MCP של Composio, שהוא חבילת npm ולכן עובד בכל מקום.

ערוך את `~/whatsapp-agent/mcp.json`:
```json
{
  "mcpServers": {
    "composio": {
      "command": "npx",
      "args": ["-y", "@composio/mcp@latest"],
      "env": { "COMPOSIO_API_KEY": "<המפתח של המשתמש>" }
    }
  }
}
```

המפתח מגיע מ-https://dashboard.composio.dev (אזור המפתחים).
חיבור האפליקציות עצמן — באותו דשבורד, בדיוק כמו במסלול א׳.

> ⚠️ אמת מול התיעוד העדכני של Composio לפני שאתה מבטיח שזה עובד.
> המסלול הזה **לא נבדק על Windows אמיתי** — אם אתה מריץ אותו בפעם הראשונה,
> אמור זאת למשתמש ובדוק מקצה לקצה לפני שאתה מכריז שסיימת.

---

## עדכון ה-CLAUDE.md של הסוכן

הסוכן צריך לדעת דרך מה לעבוד. ודא שב-`~/whatsapp-agent/CLAUDE.md` יש:

**מק/לינוקס:**
```
כל גישה למייל/יומן היא דרך ה-CLI של Composio ב-Bash:
- `composio search "<מה שצריך>" --toolkits <gmail|googlecalendar>`
- `composio execute <SLUG> -d '<json>'`
אם `composio` לא נמצא — הוא ב-`~/.composio/composio`.
```

**Windows:**
```
כל גישה למייל/יומן היא דרך הכלים של composio שזמינים לך.
```

---

## בדיקה אמיתית — חובה

אל תסתפק ב-`connections list`. הרץ בקשה אמיתית **מתוך תיקיית הסוכן**:

```bash
cd ~/whatsapp-agent && echo "מה יש לי ביומן השבוע? השתמש ב composio" | \
  claude -p --output-format json --model sonnet --effort medium \
  --allowedTools Bash Read Grep --strict-mcp-config --mcp-config mcp.json
```

בפלט:
- `num_turns` גדול מ-1 → הסוכן באמת הריץ כלים
- `num_turns` שווה ל-1 → הוא ענה בלי לגעת בשום דבר. **זו תקלה**, גם אם התשובה נשמעת סבירה
- `permission_denials` לא ריק → חסרים כלים ב-`--allowedTools`

## תקלות

| תסמין | סיבה | פתרון |
|---|---|---|
| "צריך אישור OAuth / התחבר ב-/mcp" | הסוכן ראה קונקטור זר | `--strict-mcp-config` עם `mcp.json` של התיקייה |
| `composio: command not found` | PATH לא נטען | נתיב מלא `~/.composio/composio` |
| חיבור תקוע ב-`INITIALIZING` | `composio link` רץ בלי טרמינל | הסר וחבר מהדשבורד |
| ענה יפה אבל המציא נתונים | `num_turns` = 1 | ודא `--allowedTools` ובדוק denials |
