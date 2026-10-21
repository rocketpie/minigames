#!/bin/bash
devcontainer up && devcontainer exec opencode pair
devcontainer exec /workspaces/minigames/start-tunnel.sh