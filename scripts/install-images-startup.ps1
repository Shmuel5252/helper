param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'AI Chat Images.lnk'
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
    $existing = $shell.CreateShortcut($shortcutPath)
    if ($existing.WorkingDirectory -ne $projectRoot) {
        throw 'A different startup entry already uses this name. No changes made.'
    }
}
if ($Remove) {
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
    Write-Output 'Automatic image startup removed. Running processes were left unchanged.'
    exit
}
$nodePath = (Get-Command node -CommandType Application | Select-Object -First 1).Source
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env.local'))) {
    throw 'Configure .env.local before enabling startup.'
}
$logDir = Join-Path $projectRoot '.local-images\logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
# Store paths only: credentials remain in the existing private environment file.
function Quote-Literal([string]$value) { return "'" + $value.Replace("'", "''") + "'" }
$command = 'Start-Process -FilePath ' + (Quote-Literal $nodePath) +
    " -ArgumentList '--env-file=.env.local','scripts/start-images.mjs' -WorkingDirectory " + (Quote-Literal $projectRoot) +
    ' -WindowStyle Hidden -RedirectStandardOutput ' + (Quote-Literal (Join-Path $logDir 'startup.log')) +
    ' -RedirectStandardError ' + (Quote-Literal (Join-Path $logDir 'startup-error.log')) + ' -Wait'
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $command + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Start the existing AI Chat image model and outbound worker at Windows sign-in'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output ('Automatic image startup enabled: ' + $shortcutPath)
