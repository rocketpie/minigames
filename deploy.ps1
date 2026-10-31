# Publish the website and lobby images. Requires rsync, ssh, docker and zstd on PATH.
param(
    [string]$Remote = 'website-deploy@v22017022792944432.nicesrv.de',
    [string]$Platform = 'linux/amd64',
    [string]$KeyPath = "$HOME/.ssh/lobby-publish",
    [ValidateSet('games', 'lobby')]
    [string[]]$Component = @('games', 'lobby'),
    [int]$TimeoutSeconds = 120
)
$ErrorActionPreference = 'Stop'

foreach ($tool in 'rsync', 'ssh', 'docker', 'zstd') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool not found on PATH" }
}
if (-not (Test-Path $KeyPath)) { throw "no ssh key at '$KeyPath'" }

$key = $KeyPath -replace '\\', '/'
$sshArgs = @('-i', $key, '-o', 'IdentitiesOnly=yes', '-o', 'StrictHostKeyChecking=accept-new')
$rsyncSsh = "ssh -i `"$key`" -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
$temp = [System.IO.Path]::GetTempPath()

# ---- remote sanity check: fails here instead of after a long build ----
$remoteHost = (($Remote -split '@')[-1]) -replace ':\d+$', ''
try {
    $addresses = [System.Net.Dns]::GetHostAddresses($remoteHost) | ForEach-Object { $_.IPAddressToString }
} catch {
    throw "cannot resolve '$remoteHost': $($_.Exception.Message)"
}
Write-Host "ssh target: $Remote -> $($addresses -join ', ')"

$remoteName = ssh @sshArgs $Remote hostname
if ($LASTEXITCODE -ne 0) { throw "ssh to $Remote failed (exit $LASTEXITCODE)" }
Write-Host "remote hostname: $($remoteName -join ' ')"

function Assert-Ok([string]$what) {
    if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)" }
}

function Publish-Image([string]$Name, [string]$Context) {
    $image = "homelab/${Name}:latest"
    $tar = (Join-Path $temp "$Name.tar") -replace '\\', '/'
    $zst = (Join-Path $temp "$Name.tar.zst") -replace '\\', '/'
    $sha = "$zst.sha256"

    $buildArgs = @(
        'buildx', 'build', '--platform', $Platform, '--load',
        '--label', 'com.co3d.service=public',
        '--label', "com.co3d.service.name=$Name",
        '-t', $image, $Context
    )
    docker @buildArgs
    Assert-Ok "docker buildx build ($Name)"

    docker save -o $tar $image
    Assert-Ok "docker save ($Name)"
    zstd -T0 -3 -f -o $zst $tar
    Assert-Ok "zstd ($Name)"
    Remove-Item $tar -Force

    # same bytes sha256sum would write: "<hash>  <name>.tar.zst" + LF
    $hash = (Get-FileHash -Algorithm SHA256 $zst).Hash.ToLower()
    Set-Content -Path $sha -Value "$hash  $(Split-Path $zst -Leaf)`n" -NoNewline -Encoding ascii

    $remoteDir = "/opt/public/$Name"
    rsync -az --delete --chmod=D755,F644 `
        -e $rsyncSsh `
        $zst $sha "${Remote}:$remoteDir/"
    Assert-Ok "rsync artifact ($Name)"

    # validate what actually landed, not what rsync intended
    $check = @(ssh @sshArgs $Remote "cd $remoteDir && ls -la $Name.tar.zst $Name.tar.zst.sha256 && sha256sum -c $Name.tar.zst.sha256")
    if ($LASTEXITCODE -ne 0) { throw "$Name artifact missing or corrupt in $remoteDir" }
    foreach ($line in $check) { Write-Host "  $line" }

    # remember the log position so only this deploy's lines are shown
    $offsetText = ssh @sshArgs $Remote 'wc -l < /var/log/public-deploy.log 2>/dev/null'
    $logOffset = if ($LASTEXITCODE -eq 0 -and "$offsetText" -match '^\s*(\d+)') { [int]$Matches[1] } else { $null }

    ssh @sshArgs $Remote "touch /opt/public/triggers/${Name}.restart"
    Assert-Ok "restart trigger ($Name)"
    Write-Host "${Name}: trigger set, waiting up to ${TimeoutSeconds}s for the deploy log"

    if ($null -eq $logOffset) {
        Write-Host "  cannot read /var/log/public-deploy.log remotely; watch it with: sudo tail -f /var/log/public-deploy.log"
    } else {
        $printed = 0
        $done = $false
        $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
        while (-not $done -and (Get-Date) -lt $deadline) {
            Start-Sleep -Seconds 2
            $lines = @(ssh @sshArgs $Remote "tail -n +$($logOffset + 1) /var/log/public-deploy.log 2>/dev/null")
            if ($LASTEXITCODE -ne 0) { Write-Host "  lost access to /var/log/public-deploy.log"; break }
            for ($i = $printed; $i -lt $lines.Count; $i++) { Write-Host "  $($lines[$i])" }
            $printed = $lines.Count
            $done = [bool]($lines | Where-Object { $_ -like "*$Name deploy complete*" })
        }
        if (-not $done) { throw "${Name}: no '$Name deploy complete' in the log within ${TimeoutSeconds}s" }
    }

    Remove-Item $zst, $sha -Force
    Write-Host "$Name published"
}

$targets = @{
    games = @{ Name = 'website'; Context = (Join-Path $PSScriptRoot 'games') }
    lobby = @{ Name = 'lobby'; Context = (Join-Path $PSScriptRoot 'lobby') }
}

foreach ($name in $Component) {
    $target = $targets[$name]
    Publish-Image -Name $target.Name -Context $target.Context
}
