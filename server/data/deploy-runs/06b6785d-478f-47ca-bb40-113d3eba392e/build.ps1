$ErrorActionPreference = 'Continue'
$code = 0
$writer = $null
try {
  Set-Location -LiteralPath 'D:\other\douyin3.0'
  Write-Host ('AIEditHere：在项目目录构建 → ' + 'D:\other\douyin3.0') -ForegroundColor Green
  $utf8 = New-Object System.Text.UTF8Encoding($false)
  $writer = New-Object System.IO.StreamWriter('D:\other\ai-auto-code\server\data\deploy-runs\06b6785d-478f-47ca-bb40-113d3eba392e\build.log', $false, $utf8)
  cmd /c "npm run build" 2>&1 | ForEach-Object {
    $line = $_
    Write-Host $line
    $writer.WriteLine($line)
  }
  if ($LASTEXITCODE -ne $null) { $code = $LASTEXITCODE }
} catch {
  Write-Host $_ -ForegroundColor Red
  $code = 1
} finally {
  if ($writer) { $writer.Close() }
  Set-Content -LiteralPath 'D:\other\ai-auto-code\server\data\deploy-runs\06b6785d-478f-47ca-bb40-113d3eba392e\build.exit' -Value $code -Encoding ascii
  Write-Host ('AIEditHere：构建结束，退出码 ' + $code) -ForegroundColor Green
}