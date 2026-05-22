# 🧪 Potion Order Bot

A Discord bot that calculates potion order totals using a `/order` slash command.

## Setup Guide

### Step 1 — Create your Discord bot
1. Go to https://discord.com/developers/applications
2. Click **New Application**, give it a name (e.g. "Potion Shop")
3. Go to the **Bot** tab → click **Add Bot**
4. Under **Token**, click **Reset Token** and copy it — save this somewhere safe
5. Scroll down and enable **applications.commands** under Bot Permissions
6. Go to **OAuth2 → URL Generator**, tick `bot` and `applications.commands`
7. Copy the generated URL and open it to invite the bot to your server

### Step 2 — Deploy on Railway
1. Go to https://railway.app and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Push this folder to a GitHub repo first, then connect it
   — OR — use **New Project → Empty Project → Add Service → GitHub Repo**
4. Once deployed, go to your service → **Variables** tab
5. Add one variable:
   - `DISCORD_TOKEN` = your bot token from Step 1
6. Railway will auto-deploy. Check the logs — you should see "Logged in as YourBot#1234"

### Step 3 — Use it!
In any channel your bot has access to, type:
```
/order
```
Pick your items and quantities from the autocomplete options. Toggle the discount on if needed.

## Pricing
| Item | Price |
|------|-------|
| Animagus Potion | 25 Galleons |
| Polyjuice Potion | 5 Galleons |
| Death Potion | 2 Galleons |
| Pittlebugs Exhaust Potion | 1 Galleon |
| Invisibility Potion | 3 Galleons |
| Shrinking Solution Potion | 3 Galleons |
| Healing Potion | 3 Galleons |
| Alihotsy Draught Potion | 2 Galleons |
| Dizziness Draught Potion | 2 Galleons |
| Bulgeye Potion | 2 Galleons |
| Exploding Potion | 8 Galleons |
| Snape's Advanced Potion Book | 50 Galleons |

Optional 15% discount togglable per order.
