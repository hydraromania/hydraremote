# Agent Windows XP (si Vista / Win7 vechi)

PC-urile cu XP nu pot rula `hydraremote.exe` (Node 18 nu porneste pe XP) si nici
HTTPS modern (XP stie doar TLS 1.0, serverul cere TLS 1.2+). Solutia: un agent
usor in **VBScript** — tehnologie nativa XP — care trimite heartbeat la fiecare
60 de secunde prin HTTP simplu pe portul 4420.

## Ce face / ce NU face

- PC-ul apare **Online** in panou, cu nume, IP si ultima activitate.
- FARA tunel, FARA terminal la distanta pe XP (limita tehnologica a XP-ului).
- Conectarea la distanta se face de pe un PC cu Win7+ unde ruleaza `hydraremote.exe`.

## Generare pachet (pe PC-ul tau, nu pe XP)

```cmd
node xp/make-xp-package.js --name "PC-Birou-X"
```

Genereaza `xp/out-PC-Birou-X/` cu 3 fisiere:

| Fisier | Rol |
|---|---|
| `hydraremote-xp.vbs` | agentul (cheia + numele deja completate) |
| `INSTALEAZA.bat` | copiaza VBS-ul in Startup si il porneste |
| `CHEIE.txt` | cheia permanenta — o adaugi in panou la "Adauga PC cu Cheie SK" |

Cu cheie existenta:

```cmd
node xp/make-xp-package.js --name "PC-Birou-X" --key sk-xxxxxxxx-xxxx-xxxxxx
```

## Instalare pe XP

1. Adauga cheia din `CHEIE.txt` in panou: https://remote.hydraromania.ro/
   → "Adauga PC cu Cheie SK".
2. Copiaza fisierele pe PC-ul cu XP (stick USB / retea).
3. Dublu-click pe `INSTALEAZA.bat`. Gata — agentul porneste silentios la fiecare boot.
