# APK를 GitHub 릴리스(ddelza/todo-memo)에 올린다 → 웹의 「앱 받기」 링크가 자동으로 최신 판을 가리킴
#   powershell -ExecutionPolicy Bypass -File release.ps1 -Tag v1.0      (먼저 build.ps1 로 out\todo-memo.apk 만들기)
param([Parameter(Mandatory)][string]$Tag)
$ErrorActionPreference = 'Stop'
$pat = [Environment]::GetEnvironmentVariable('GITHUB_PAT', 'User')
$h = @{ Authorization = "Bearer $pat"; Accept = 'application/vnd.github+json' }
$apk = Join-Path $PSScriptRoot 'out\todo-memo.apk'
$body = @{ tag_name = $Tag; name = "할일 메모 $Tag"; body = '안드로이드 앱. todo-memo.apk 를 내려받아 설치하세요.' } | ConvertTo-Json
$r = Invoke-RestMethod -Method Post -Uri 'https://api.github.com/repos/ddelza/todo-memo/releases' -Headers $h -Body ([Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8'
$up = $r.upload_url -replace '\{.*\}', ''
Invoke-RestMethod -Method Post -Uri "$($up)?name=todo-memo.apk" -Headers $h -InFile $apk -ContentType 'application/vnd.android.package-archive' | Out-Null
Write-Host "올림: $($r.html_url)"
