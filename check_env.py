import paramiko

c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('vmi1000.hydraromania.ro', username='hydra', password='MagicMedia1987+', timeout=15)

stdin, stdout, stderr = c.exec_command('grep -rn "googleusercontent" /home/hydra/ 2>/dev/null | head -n 10')
print(stdout.read().decode())
c.close()
