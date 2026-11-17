# Chinese Nouns Game

- Run the game with Node.js 24 and `npm start`.
- After verifying each completed project change, commit and push it directly to GitHub's `main` branch, then verify that the update is live on Render.
- Keep room state, permissions, and scoring on the server.
  Clients receive only the card faces and prompts their current role may see.
- Set each round's minimum player count on the server so solo and two-player rooms can start.
- Deploy as a single Render web service while rooms live in process memory.
- Save new noun images as compact WebP files using the English noun's filename slug in `assets/images`.
- Use browser speech synthesis for Listen & Tap and keep the written solution out of the question screen.
