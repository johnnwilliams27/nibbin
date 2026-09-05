import { vetUrl } from "../src/net.js";
const cases = ["http://2130706433/","http://0x7f000001/","http://017700000001/","http://127.1/","http://[::ffff:127.0.0.1]/","http://localtest.me/","http://metadata.google.internal/","https://169.254.169.254/","http://[0:0:0:0:0:ffff:a9fe:a9fe]/","http://[::a9fe:a9fe]/","http://1.1.1.1./","http://192.168.1.1./","http://user:pw@10.0.0.1@evil.com/"];
for (const c of cases) { let h = ""; try { h = new URL(c).hostname; } catch { h = "(unparseable)"; } const v = vetUrl(c); console.log(`${String(v.allowed).padEnd(6)} host=${h.padEnd(30)} ${c}`); }
