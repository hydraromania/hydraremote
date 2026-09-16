# Raport Eroare Executabil HydraREMOTE pe Windows

**Imagine salvată:** `error_app_cant_run.jpg`  
**Sursa erorii:** Utilizatorul a încercat rularea/instalarea executabilului descărcat pe un sistem Windows țintă (posibil pe 32-bit sau o versiune mai veche / arhitectură diferită).

### Mesaj eroare afișat în dialog:
> **This app can't run on your PC**  
> To find a version for your PC, check with the software publisher.  
> [Close]

### Cauză identificată:
- Executabilul compilat/descărcat (`hydraremote.exe`) a fost livrat într-o arhitectură incompatibilă cu sistemul respectiv (de exemplu binar pe 64-bit pe un Windows de 32-bit, sau fișier trunchiat la descărcare din cauza deconectării rețelei / conexiune întreruptă).
- S-a încercat deja generarea unei versiuni dedicate pe 32-bit (`hydraremote-x86.exe`).
