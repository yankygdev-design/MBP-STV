# MovieBox Pro TV

A [TizenBrew](https://github.com/reisxd/TizenBrew) mod that makes MovieBoxPro's website usable with a Samsung TV remote.

- **Browsing:** D-pad navigation with a focus ring, rows and grids that scroll with you, popups and dialogs that hold the focus, dropdowns turned into TV pickers, and focus restored to the poster you came from when you press Back.
- **Watching:** the player fills the screen. OK pauses, ◀ ▶ skip with an on-screen time bar, and ▲▼ open **MovieBoxPro's own player controls**. Subtitles, subtitle sync, quality and anything else in their player stay available, because the mod drives their controls instead of replacing them.
- **Shortcuts:** a quick menu (Home, Search, History, Favorites, My lists, Sign in with a code) and colour-key shortcuts.

It is one plain-ES5 file with no build step, so it runs on 2017 and later TVs.

## Install

1. **TizenBrew on the TV.** Install it with Apps2Samsung (it's in the Tizen Community catalog).
2. **Host PC IP = 127.0.0.1.** Open Apps, press `1 2 3 4 5`, keep Developer mode on and set Host PC IP to `127.0.0.1`, then restart the TV. TizenBrew injects mods through the TV's own debugger, which needs this. Apps2Samsung needs your PC's IP while installing, so switch to `127.0.0.1` afterwards.
3. **Publish this folder** as a public GitHub repo, for example `movieboxpro-tv`, with `package.json` and `userScript.js` at the root.
4. **Add the module.** In TizenBrew go to Module Manager → Add GitHub Module and type `YOUR-GITHUB-USER/movieboxpro-tv@main`.
5. **Launch it.** Start "MovieBox Pro TV" from TizenBrew. To sign in without typing, press **Red** → *Sign in with a code* (MovieBoxPro's TV code login).

## Updating

TizenBrew downloads the mod from jsDelivr, which caches GitHub branches for up to 12 hours.

- The included workflow (`.github/workflows/purge-jsdelivr.yml`) clears that cache on every push to `main`.
- To clear it by hand, open these URLs in a browser:
  - `https://purge.jsdelivr.net/gh/YOUR-GITHUB-USER/movieboxpro-tv@main/userScript.js`
  - `https://purge.jsdelivr.net/gh/YOUR-GITHUB-USER/movieboxpro-tv@main/package.json`
- After either one, close and reopen TizenBrew. If the old version still loads, restart the TV: TizenBrew's background service keeps a copy of the script in memory.

## Remote

| Browsing | |
|---|---|
| ◀ ▲ ▼ ▶ / OK | Move / select |
| Back | Close a popup, otherwise go back (focus returns to where you were) |
| Red | Quick menu |
| Green | Search |
| Yellow | History |
| CH+ / CH− | Page up / down |
| Play | Open the player full screen (on a watch page) |
| Blue or Info | Help |

| Watching | |
|---|---|
| OK, Play/Pause | Play / pause |
| ◀ ▶ | Skip 10 s; keep pressing and it jumps 30 s, then 60 s |
| ▲ ▼ | MovieBoxPro's player controls (subtitles, sync, quality…) |
| FF / RW | Skip 30 s |
| Red / Green | Subtitles menu / quality and settings menu |
| Yellow, Next, CH+ | Next episode |
| Prev, CH− | Previous episode |
| Back | Close the open menu → hide the controls → leave full screen |

Inside the player controls, OK presses the focused button and Back closes the open menu. Controls hide by themselves after 7 seconds without a key press.

## Try it on a computer first

Open movieboxpro.app in desktop Chrome, sign in, and paste `userScript.js` into the DevTools console. Tampermonkey with `@match https://www.movieboxpro.app/*` works too. The keyboard stands in for the remote:

| Remote | Keyboard |
|---|---|
| D-pad / OK | Arrow keys / Enter |
| Back | Esc or Backspace |
| Red / Green / Yellow / Blue | R / G / Y / B |
| Info | I |
| Play/Pause | K (Space while watching) |
| CH+ / CH− | Page Up / Page Down |

`window.__mbtv.state()` shows the current mode and focused element.

## Tuning

The `CFG` block at the top of `userScript.js` holds the settings:

- skip lengths
- `autoWatch`: go full screen when an episode starts
- `fullscreen`: `'pseudo'` fills the screen with CSS (the reliable choice on TVs); `'native'` tries the Fullscreen API first
- controls timeout
- quick-menu links

The mod is player-agnostic: it finds the main `<video>`, treats its wrapper as the player, and navigates whatever buttons the site shows.

If something is unreachable on MovieBoxPro, inspect it in desktop Chrome and note the element's tag, class and `aria-label`. That's usually enough to add a specific rule.

Not affiliated with MovieBoxPro, Samsung or TizenBrew.
