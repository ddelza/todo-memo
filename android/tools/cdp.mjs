// 시험용: 에뮬레이터 WebView에서 JS를 실행하고 결과를 출력 (build.ps1 -Dev 로 만든 APK + adb forward tcp:9222)
//   node tools/cdp.mjs "document.title"
const expr = process.argv[2] || 'document.title';
const list = await (await fetch('http://127.0.0.1:9222/json')).json();
const ws = new WebSocket(list[0].webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener('open', ok));
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }));
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id !== 1) return;
  const r = m.result && m.result.result;
  console.log(m.result && m.result.exceptionDetails ? 'EXC ' + JSON.stringify(m.result.exceptionDetails.exception && m.result.exceptionDetails.exception.description) : JSON.stringify(r && r.value !== undefined ? r.value : r));
  ws.close(); process.exit(0);
});
