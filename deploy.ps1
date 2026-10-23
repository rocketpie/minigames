# Publish games/ to the static site host. Requires rsync on PATH.
param(
    [string]$Remote = 'website-deploy@v220261027929543845.megasrv.de',
    [string]$RemotePath = '/opt/website/content/',
    [string]$KeyPath = "$HOME/.ssh/website-publish"
)
$ErrorActionPreference = 'Stop'

if (-not (Get-Command rsync -ErrorAction SilentlyContinue)) { throw 'rsync not found on PATH' }

if (-not (Test-Path $KeyPath)) {
     throw "no ssh key at '$KeyPath'" 
}

$key = $KeyPath -replace '\\', '/'
$src = (Join-Path $PSScriptRoot 'games') -replace '\\', '/'

# tests stay local; -e quotes the key path for rsync's own command parsing
rsync -az --delete --chmod=D755,F644 --exclude='*.test.mjs' `
    -e "ssh -i `"$key`" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" `
    "$src/" "${Remote}:$RemotePath"
exit $LASTEXITCODE
