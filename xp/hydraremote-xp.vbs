' HydraREMOTE XP Agent — heartbeat pentru Windows XP / Vista / 7 vechi
' Ruleaza hidden in fundal, trimite semnal de viata la fiecare 60 secunde.
' FARA tunel (nu exista cloudflared pe XP) — PC-ul apare Online in panou,
' cu nume, IP si ora ultimei activitati.
'
' INSTALARE pe XP:
'   1. Copiaza acest fisier in folderul Startup:
'      C:\Documents and Settings\All Users\Start Menu\Programs\Startup\
'   2. Dublu-click pe el o data ca sa porneasca acum
'      (apoi porneste singur la fiecare boot, silentios).
'   3. Verifica in panou: https://remote.hydraromania.ro/

Option Explicit

' ======== CONFIG — completat automat la generare ========
Const API_KEY  = "__API_KEY__"
Const PC_NAME  = "__PC_NAME__"
' ========================================================

Const SERVER   = "http://remote.hydraromania.ro:4420"
Const INTERVAL = 60000 ' 60 secunde

Dim net, hostName
Set net = CreateObject("WScript.Network")
hostName = PC_NAME
If hostName = "" Or hostName = "__PC_NAME__" Then hostName = net.ComputerName

' session/create o singura data la pornire
HttpPost SERVER & "/api/session/create", "{""machineId"":""" & hostName & """,""apiKey"":""" & API_KEY & """,""hostname"":""" & hostName & """,""platform"":""win32-xp""}"

' bucla heartbeat
Do While True
  WScript.Sleep INTERVAL
  HttpPost SERVER & "/api/session/update", "{""apiKey"":""" & API_KEY & """,""hostname"":""" & hostName & """,""platform"":""win32-xp"",""tunnelUrl"":"""",""localIp"":""xp-agent""}"
Loop

Sub HttpPost(url, body)
  On Error Resume Next
  Dim http
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.open "POST", url, False
  http.setRequestHeader "Content-Type", "application/json"
  http.send body
  Set http = Nothing
End Sub
