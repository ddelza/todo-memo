# 로컬 시험: Auth·Firestore·Hosting 에뮬레이터 (http://localhost:5055) — 운영 DB는 건드리지 않음
$env:JAVA_HOME = "$env:LOCALAPPDATA\Programs\jdk-17"; $env:Path = "$env:JAVA_HOME\bin;$env:Path"
Set-Location (Split-Path $PSScriptRoot)
npx -y firebase-tools@13 emulators:start --only auth,firestore,hosting --project my-todo-memo
