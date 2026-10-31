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
| [dreiziehn](games/dreiziehn/dreiziehn.html) | single-player card solitaire: tap a hand card, then a middle pile or one of your own piles; end your turn to refill. Empty the stock and your piles to win. |

Multiplayer lobby (PoC): [`lobby/`](lobby/README.md).

Preview, and share to your phone:

    node serve.mjs                                   # http://localhost:8000 (serves games/ only)
    cloudflared tunnel --url http://localhost:8000   # public https url for the phone

Run the game logic tests:

    node --test