# Chinese Nouns Game

Three to eight players study everyday Mandarin nouns and play Guess the Picture, Memory Match, and Taboo on their own devices.
The host creates a room and shares its QR code, invite link, or six-character code.
The host also plays, starts rounds, and records the spoken answers.
Players speak aloud in person or use a separate voice call.

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
