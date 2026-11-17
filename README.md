# Chinese Nouns Game

One to eight players study everyday Mandarin nouns and play three shuffled rounds.
Guess the Picture, Memory Match, and Listen & Tap support solo and group play.
Taboo can be drawn when at least three players start the session.
The host creates a room and shares its QR code, invite link, or six-character code.
The host chooses Nouns or 成语 in the room lobby and can switch between games after returning to the lobby.
The host also plays, starts rounds, and records the spoken answers.
In solo Guess the Picture, reveal the word and mark your own spoken answer.
Players speak aloud in person or use a separate voice call.
Listen & Tap uses each browser's text-to-speech to read the Mandarin word.
Enable a Mandarin voice on your device if the game reports that one is missing.
In solo play, submitting an answer immediately starts the next question and leaves the previous word visible for review.

## 情境选成语

Choose **成语 Idioms** in the room lobby to play the quiz with one to eight players.
Everyone in the room can open **Learn the 10 idioms** to browse the illustrated stories at their own pace.
When the host starts the quiz, choose the best idiom for each bilingual scenario.
Solo play is untimed.
In group play, answers stay locked until everyone answers or the 25-second timer runs out.
Every answer reveal shows the correct idiom, pinyin, meaning, and why it fits the scenario.

## Run locally

Run these commands with Node.js 24.

```sh
npm ci
npm start
```

Open `http://localhost:3000` and try hosting and joining in separate browser tabs.
For devices on the same Wi-Fi, the host should open the game at their computer’s LAN address using port 3000 before sharing the invite.
The QR code uses the same address the host opened.

## Deploy to Render

1. Push the project to a Git repository that Render can access.
2. In the Render dashboard, create a Blueprint and select the repository and branch containing `render.yaml`.
3. Once deployment is healthy, open the service’s public HTTPS URL to host a room.

The Blueprint uses one free web service.
Rooms live in server memory, so a service restart, redeploy, or spin-down ends active rooms.
Use one instance so all devices in a room share the same game state.

The GitHub Pages address redirects to the live Render game, which hosts the game page and the multiplayer server.
