# ARK Nitrado Discord Bot

Kurz: Dieser Bot zieht ARK-Logs per FTP, scannt auf Dupe/Spoof/Alt-Muster, speichert Events in SQLite, und kann per RCON Playerlist/Status/Befehle auslesen. Standardmäßig nur Alerts (keine automatischen Banns).

Wichtig: Teile NIE deinen Token/FTP/RCON-Passwörter öffentlich. Nutze Umgebungsvariablen / Replit-Secrets / .env (lokal, nicht ins Repo).

1) Dateien vorbereiten
- Kopiere alle Dateien in einen Ordner.
- Erstelle eine `.env` (oder setze Umgebungsvariablen / Replit Secrets) basierend auf `.env.example`.
- Alternativ: befülle `config.json` (weniger sicher, nicht ins öffentliches Repo).

2) Installation
- Node.js v16+ / v18 empfohlen.
- Im Projektordner:
  npm install

3) Starten
- Lokal:
  node index.js
- Oder: npm start

4) Replit (schnell)
- Neues Repl (Node.js) erstellen.
- Dateien hochladen.
- In "Secrets" (Environment variables) die Variablen aus `.env.example` anlegen.
- In Shell: npm install
- Run/Start drücken.

5) RCON in Nitrado aktivieren (Kurz)
- nitrado.net -> Mein Dienst -> ARK -> Einstellungen / Remote Console.
- RCON-Passwort setzen, Port/Host notieren.
- In Bot: RCON_ENABLED=true, RCON_HOST, RCON_PORT, RCON_PASS setzen.

6) Testbefehle (Discord)
- !serverstatus  -> nutzt RCON (ListPlayers) (nur wenn RCON_ENABLED=true)
- !playerlist    -> RCON ListPlayers
- !rcon <befehl> -> führt RCON-Befehl aus (nur für Moderatoren)
- !cmdlogs       -> zeigt extrahierte Admin-Kommandos
- !watchban add/remove/list -> manage watchlist

7) Wie du Channel-IDs / Role-IDs findest
- Discord: Benutzereinstellungen -> Erweitert -> Entwicklermodus aktivieren.
- Rechtsklick auf Kanal/Rolle -> ID kopieren.

8) Tipps & Sicherheit
- Standardmäßig macht der Bot nur Alerts. Ich kann Confirm‑Flows und automatisches Ban-Vorschläge hinzufügen.
- Wenn FTP oder RCON fehlschlagen: prüfe Zugangsdaten, Firewall, und ob der richtige Log-Pfad genutzt wird.
- Backup: mach regelmäßig Kopien von data.sqlite, besonders bevor du Features änderst.

Wenn du möchtest, mache ich dir jetzt:
- a) eine Schritt-für-Schritt Replit-Anleitung mit Screenshots (ich schreibe die Schritte hier), oder
- b) ich helfe dir beim Setzen der Secrets und dem Starten, indem du mir sagst, bei welchem Schritt du steckst.
