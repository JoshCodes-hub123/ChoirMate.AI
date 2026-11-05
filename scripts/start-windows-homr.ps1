# ChoirMate AI — PowerShell Everyday Startup Launcher (Windows)
# Reuses the existing .venv and cached HOMR model weights created by setup-choirmate.bat.
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

& cmd.exe /c "`"$RepoRoot\start-choirmate.bat`""
