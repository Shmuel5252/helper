# Optional local maintenance/login connection. Normal phone use does not need this.
[CmdletBinding()]
param([string]$Server = '151.145.89.185')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$keyPath = Join-Path $projectRoot 'test-screenshots/oracle/ai-chat-gemini.pem'
$knownHostsPath = Join-Path $projectRoot 'test-screenshots/oracle/known_hosts'
if (!(Test-Path -LiteralPath $keyPath) -or !(Test-Path -LiteralPath $knownHostsPath)) {
    throw 'The dedicated key or verified host record is missing.'
}
Write-Host 'Private browser login: http://127.0.0.1:6080/vnc.html?autoconnect=true&resize=scale'
Write-Host 'Keep this command running only while signing in or maintaining the server.'
& ssh -i $keyPath -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$knownHostsPath" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -N -L 127.0.0.1:6080:127.0.0.1:6080 "ubuntu@$Server"
exit $LASTEXITCODE
