"use strict";
/**
 * Genereaza pachetul XP: citeste template-ul VBS, inlocuieste __API_KEY__ / __PC_NAME__,
 * scrie output gata de copiat pe PC-ul cu XP.
 * Nu necesita serverul pornit — cheia se inregistreaza la primul heartbeat.
 *
 * Folosire:
 *   node xp/make-xp-package.js --name "PC-Birou-X"
 *   node xp/make-xp-package.js --name "PC-Birou-X" --key sk-xxxx-xxxx-xxxxxx
 *   node xp/make-xp-package.js --name "PC-Birou-X" --out ./pachet-xp
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}

function randomPart(len) {
  const chars = "abcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const buf = crypto.randomBytes(len);
  for (let i = 0; i < len; i++) s += chars[buf[i] % chars.length];
  return s;
}

// Format identic cu CLI-ul modern: sk-<machine8>-<keyid4>-<hash6>
function makeKey(machine) {
  const m = (machine || "xppc").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8).padEnd(8, "x");
  const keyId = randomPart(4);
  const hash = crypto.createHash("sha256").update("hydraremote-xp:" + m + ":" + keyId).digest("hex").slice(0, 6);
  return "sk-" + m + "-" + keyId + "-" + hash;
}

const pcName = arg("--name");
if (!pcName) {
  console.error("Folosire: node xp/make-xp-package.js --name \"NUME-PC\" [--key sk-...] [--out DIR]");
  process.exit(1);
}

const apiKey = arg("--key") || makeKey(pcName);
const outDir = path.resolve(arg("--out") || path.join("xp", "out-" + pcName.replace(/[^A-Za-z0-9-_]/g, "_")));
fs.mkdirSync(outDir, { recursive: true });

const template = fs.readFileSync(path.join(__dirname, "hydraremote-xp.vbs"), "utf8");
if (!template.includes("__API_KEY__")) {
  console.error("EROARE: template-ul VBS nu contine placeholder-ul __API_KEY__");
  process.exit(1);
}

const vbs = template.split("__API_KEY__").join(apiKey).split("__PC_NAME__").join(pcName);
fs.writeFileSync(path.join(outDir, "hydraremote-xp.vbs"), vbs);

const installer = "@echo off\r\n"
  + "REM Instalare HydraREMOTE XP Agent — dublu-click pe acest fisier\r\n"
  + "set STARTUP=%ALLUSERSPROFILE%\\Start Menu\\Programs\\Startup\r\n"
  + "copy /Y \"%~dp0hydraremote-xp.vbs\" \"%STARTUP%\\hydraremote-xp.vbs\"\r\n"
  + "cscript //nologo \"%STARTUP%\\hydraremote-xp.vbs\" &\r\n"
  + "echo.\r\n"
  + "echo Agent instalat si pornit. Verifica panoul: https://remote.hydraromania.ro/\r\n"
  + "pause\r\n";
fs.writeFileSync(path.join(outDir, "INSTALEAZA.bat"), installer);

fs.writeFileSync(path.join(outDir, "CHEIE.txt"),
  "Cheie permanenta PC " + pcName + ":\r\n\r\n" + apiKey + "\r\n\r\n"
  + "1. Adaug-o in panou: https://remote.hydraromania.ro/ -> Adauga PC cu Cheie SK\r\n"
  + "2. Copiaza fisierele pe PC-ul cu XP si ruleaza INSTALEAZA.bat\r\n");

console.log("Pachet XP generat in: " + outDir);
console.log("Cheie: " + apiKey);
