#!/bin/bash
# מק — לחיצה כפולה מפעילה את הסוכן. סגירת החלון עוצרת אותו.
cd "$(dirname "$0")" || exit 1
export PATH="$HOME/.composio:$PATH"
echo "מפעיל את הסוכן... (Ctrl+C לעצירה)"
node poller.mjs
