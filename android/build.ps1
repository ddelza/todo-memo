# 할일 메모 — 안드로이드 APK 빌드 (Gradle 없이 Android SDK 도구로 직접)
#   powershell -ExecutionPolicy Bypass -File build.ps1 -VersionCode 1 -VersionName 1.0
#   → out\todo-memo.apk  (웹의 「앱 받기」 = GitHub 릴리스 ddelza/todo-memo 최신 todo-memo.apk, release.ps1 로 올림)
#   앱 화면은 웹앱(my-todo-memo.web.app)을 띄우는 것이라, 웹만 고치면 APK를 다시 만들 필요 없음.
#   자바(캘린더·로그인 연결)를 고쳤을 때만 -VersionCode 를 올려서 다시 빌드.
param([int]$VersionCode = 1, [string]$VersionName = '1.0', [switch]$Dev)   # -Dev: chrome://inspect 로 WebView 보기
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$JDK = "$env:LOCALAPPDATA\Programs\jdk-17"
$SDK = "$env:LOCALAPPDATA\Android\Sdk"
$BT = "$SDK\build-tools\34.0.0"
$JAR = "$SDK\platforms\android-34\android.jar"
$env:JAVA_HOME = $JDK
$env:Path = "$JDK\bin;$BT;$env:Path"
function Run($exe, [string[]]$a) { & $exe @a; if ($LASTEXITCODE -ne 0) { throw "$exe 실패 ($LASTEXITCODE)" } }

$B = Join-Path $here 'build'; $O = Join-Path $here 'out'
if (Test-Path $B) { Remove-Item $B -Recurse -Force }
New-Item -ItemType Directory -Force "$B\assets", "$B\gen", "$B\classes", "$B\dex", $O | Out-Null

Run "$BT\aapt2.exe" @('compile', '--dir', "$here\res", '-o', "$B\res.zip")
Run "$BT\aapt2.exe" @('link', '-I', $JAR, '--manifest', "$here\AndroidManifest.xml", "$B\res.zip",
  '--java', "$B\gen", '--min-sdk-version', '24', '--target-sdk-version', '34',
  '--version-code', "$VersionCode", '--version-name', $VersionName, '-o', "$B\base.apk")

@"
package kr.ddelza.todomemo;
final class BuildInfo { static final String VERSION = "$VersionName"; static final boolean DEV = $(if ($Dev) { 'true' } else { 'false' }); }
"@ | ForEach-Object { [IO.File]::WriteAllText("$B\gen\BuildInfo.java", $_, (New-Object Text.UTF8Encoding $false)) }
$src = @(Get-ChildItem "$here\src", "$B\gen" -Recurse -Filter *.java | ForEach-Object FullName)
Run "$JDK\bin\javac.exe" (@('-encoding', 'UTF-8', '-source', '1.8', '-target', '1.8', '-Xlint:-options', '-bootclasspath', "$JAR;$BT\core-lambda-stubs.jar", '-d', "$B\classes") + $src)
$cls = @(Get-ChildItem "$B\classes" -Recurse -Filter *.class | ForEach-Object FullName)
Run "$BT\d8.bat" (@('--release', '--lib', $JAR, '--min-api', '24', '--output', "$B\dex") + $cls)

Run 'python' @("$here\tools\pack_apk.py", "$B\base.apk", "$B\assets", "$B\dex\classes.dex", "$B\unsigned.apk")
Run "$BT\zipalign.exe" @('-p', '-f', '4', "$B\unsigned.apk", "$B\aligned.apk")

# 서명 키: 처음 한 번 만들고 계속 같은 키를 써야 휴대폰에서 업데이트 설치가 됨 (keystore\ 폴더를 잃어버리지 말 것)
$KS = "$here\keystore\todomemo.jks"; $PW = 'todo-memo-key'
if (-not (Test-Path $KS)) {
  New-Item -ItemType Directory -Force "$here\keystore" | Out-Null
  Run "$JDK\bin\keytool.exe" @('-genkeypair', '-keystore', $KS, '-storepass', $PW, '-keypass', $PW, '-alias', 'todomemo', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Todo Memo, C=KR')
}
Run "$BT\apksigner.bat" @('sign', '--ks', $KS, '--ks-pass', "pass:$PW", '--key-pass', "pass:$PW", '--ks-key-alias', 'todomemo', '--out', "$O\todo-memo.apk", "$B\aligned.apk")
Run "$BT\apksigner.bat" @('verify', "$O\todo-memo.apk")
$apk = Get-Item "$O\todo-memo.apk"
Write-Host ("완료: {0} ({1:N1} KB, 버전 {2}/{3})" -f $apk.FullName, ($apk.Length / 1KB), $VersionName, $VersionCode)
