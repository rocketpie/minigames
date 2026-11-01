# minigames
simple games, without ads or 'in-app purchases'

## Dev Container Setup, Syncing

dev container setup for use with opencode. 
git interaction from host only.

1. say you clone all your repos here:  
`~/workspaces/your-github-slug/repo-name`

2. make another copy where you want your dev containers to live:  
`~/workspaces/containers/repo-name`  
and `rm -rf ~/workspaces/containers/repo-name/.git`

3. Add this to your host shell (`~/.bashrc`):

    `export GIT_WORKSPACE_ROOT=~/workspaces/your-github-slug/`


4. from `~/workspaces/containers/repo-name`, run:

|command|what it does|
|---|---|
| `devcontainer up` | build and run the dev container |
| `devcontainer exec opencode pair` | start opencode in the container (open the url to connect via browser) |
| `./import.sh` | sync from GIT_WORKSPACE_ROOT/repo-name to container copy | 
| `./export.sh` | sycn from container copy to GIT_WORKSPACE_ROOT/repo-name | 

Both mirror with `rsync --delete` and skip `.git/`.

Then, you can review the changes in `~/workspaces/your-github-slug/repo-name` with VSCode or whatever floats your goat.  
And that's pretty cool!

## Games

| game | controls |
|---|---|
| [2048](games/2048/2048.html) | arrow keys / WASD / swipe. Includes a [strategy guide](games/2048/2048-guide.html). |
| [icewall](games/icewall/icewall.html) | drag a shape from the tray onto the board. |
| [drone printer](games/drone-printer/drone-printer.html) | tap a glowing drone to send it, the dimmer one to bring the next forward; tap a parked drone to send it out again. |
| [lights, please!](games/lights-please/lights-please.html) | tap a room to flip its circuit; make the whole house all lit or all dark. Keys 1–9, U (undo), R (reset). |
| [freecell](games/freecell/freecell.html) | tap a card to pick it up, tap a column, free cell or foundation to place it. Includes a [strategy guide](games/freecell/freecell-guide.html). |
| [dreiziehn](games/dreiziehn/dreiziehn.html) | card solitaire: play a hand card, your stack top or a cache top onto a middle pile or a cache; end your turn to refill from the shared draw stack. Empty your stack and caches to win. The Multiplayer button opens the lobby; when the host starts, everyone returns to the game with the room id. |
| [chess](games/chess/chess.html) | tap a figure, then a glowing square. Classic rules: castling, en passant, promotion, stalemate and material/fifty-move draws. Every capture is a piece-specific spell — beams, arcing missiles or a spectral horse — and leaves a burn, crack or crater for the rest of the duel. At seventeen losses the board splits with a great crack; a checkmated king topples and burns. Two players can share one screen, or join through the lobby (host is Gold, guest Emerald). |
| [Beweg (Kjell's Chess)](games/beweg/beweg.html) | chess with two new figures. A teleporter (a crownless queen) replaces the outer pawns and teleports anywhere; landing on a rival figure explodes it, but the teleporter dies with it and rival kings and queens are untouchable. A trebuchet on the second-outer pawns cannot move but hurls a huge boulder up to four squares along a rank, file or diagonal at the first figure in line. Pawns run one or two squares, strike two diagonally and may promote to a teleporter. Otherwise standard chess, with a cracking board and a burning king when the duel ends. |


Deploy: `./deploy.ps1` builds and ships two images – `homelab/website` (this page, nginx,
built from `games/` with `games/Dockerfile`) and `homelab/lobby` (see
[lobby/HOSTING.md](lobby/HOSTING.md)). `-Component games` or `-Component lobby` ships only one.

Preview, and share to your phone:

    ./start-tunnel.sh                                # one public https url, see below
    node serve.mjs                                   # http://localhost:8000
    cloudflared tunnel --url http://localhost:8000   # public https url for the phone

`serve.mjs` uses the first path segment for routing: `/` redirects to `/games/`, everything
under `/games/` is static, and everything under `/lobby/` is proxied to `127.0.0.1:8080`
after stripping the prefix (`/lobby/challenge` → `/challenge`, `/lobby/ws` → `/ws`).
`start-tunnel.sh` starts the dev lobby on :8080 unless `/healthz` already answers (e.g. the
lobby container). The production containers are unchanged: nginx still listens on :80 and
the lobby on :8080.

Run the game logic tests:

    node --test