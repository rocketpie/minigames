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

Preview, and share to your phone:

    node serve.mjs                                   # http://localhost:8000 (serves games/ only)
    cloudflared tunnel --url http://localhost:8000   # public https url for the phone

Run the game logic tests:

    node --test