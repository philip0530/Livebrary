param(
  [string]$BotPath = (Join-Path $PSScriptRoot '..\..\..\riyan-bot\riyan-bot')
)
$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$archive = Join-Path $env:TEMP 'livebrary-deploy.tar'
$stage = Join-Path $env:TEMP 'livebrary-deploy-stage'
if (Test-Path $archive) { Remove-Item $archive }
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }

$withBot = Test-Path (Join-Path $BotPath 'package.json')
if ($withBot) {
  $bot = Join-Path $stage 'riyan-bot'
  robocopy $BotPath $bot /E /NFL /NDL /NJH /NJS /NP /XD node_modules .git tests /XF .env .env.bak '*.log' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Copying the bot failed (robocopy $LASTEXITCODE)" }
  $botEnv = Join-Path $BotPath '.env'
  if (Test-Path $botEnv) {
    Copy-Item $botEnv (Join-Path $bot '.env.upload')
    # Bot data (Discord links, weekly code) from the local PostgreSQL. Optional.
    $url = (Get-Content $botEnv | Where-Object { $_ -match '^\s*DATABASE_URL\s*=' } | Select-Object -First 1) -replace '^\s*DATABASE_URL\s*=\s*', ''
    $pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
    if (-not $pgDump) {
      $pgDump = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
    }
    if ($url -and $pgDump) {
      & $pgDump --no-owner --no-acl --table 'public.riyan_*' --file (Join-Path $bot 'riyan-bot.sql') "--dbname=$url" 2>$null
      if ($LASTEXITCODE -ne 0) { Write-Warning 'Could not dump the bot database. The server bot starts with empty data.' }
    } else {
      Write-Warning 'pg_dump or DATABASE_URL not found. The server bot starts with empty data.'
    }
  } else {
    Write-Warning "No .env in $BotPath. setup-bot.sh will stop until the bot settings are uploaded."
  }
} else {
  Write-Warning "Riyan bot not found at $BotPath. Packing the site only."
}

Push-Location $root
try {
  $parts = @('-cf', $archive, '--exclude', 'node_modules', '--exclude', 'dist', '--exclude', '.data', '--exclude', '.env', '--exclude', '.env.bak', '--exclude', '.git', '.')
  if ($withBot) { $parts += @('-C', $stage, 'riyan-bot') }
  # Windows' own bsdtar; a GNU tar earlier on PATH reads "C:" as a remote host.
  & (Join-Path $env:SystemRoot 'System32\tar.exe') @parts
  if ($LASTEXITCODE -ne 0) { throw "tar failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
  if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}
Write-Output $archive
if ($withBot) { Write-Warning 'The archive contains the bot token and keys. Delete it after uploading.' }
