$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$archive = Join-Path $env:TEMP 'livebrary-deploy.tar'
if (Test-Path $archive) { Remove-Item $archive }
Push-Location $root
try {
  tar -cf $archive --exclude node_modules --exclude dist --exclude .data --exclude .env --exclude .git .
} finally {
  Pop-Location
}
Write-Output $archive
