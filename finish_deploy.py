import paramiko, time, subprocess

# 1. Upload files
c = paramiko.SSHClient()
c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c.connect('vmi1000.hydraromania.ro', username='hydra', password='MagicMedia1987+', timeout=15)
sftp = c.open_sftp()
sftp.put('server/index.js', '/home/hydra/hydraremote/server/index.js')
sftp.put('pwa/devices.html', '/home/hydra/hydraremote/pwa/devices.html')
sftp.close()
c.close()
print("SFTP Upload completed.")

# 2. Restart service via administrator -> su - root
c_admin = paramiko.SSHClient()
c_admin.set_missing_host_key_policy(paramiko.AutoAddPolicy())
c_admin.connect('vmi1000.hydraromania.ro', username='administrator', password='MagicMedia1987+', timeout=15)
ch = c_admin.invoke_shell()

def wait_tok(tok, timeout=15):
    buf = ""
    start = time.time()
    while time.time() - start < timeout:
        if ch.recv_ready():
            buf += ch.recv(1024).decode('utf-8', errors='ignore')
            if tok in buf:
                return buf
        time.sleep(0.1)
    return buf

wait_tok('$')
ch.send('su - root\n')
wait_tok('Password:')
ch.send('MagicMedia1987+\n')
wait_tok('#')
ch.send('systemctl restart hydraremote && systemctl is-active hydraremote\n')
time.sleep(2)
out = wait_tok('#', timeout=10)
print("Restart output:", out.strip())
c_admin.close()

# 3. Git commit & push
cmds = [
    ['git', 'add', '-A'],
    ['git', 'commit', '-m', 'Add Google account authentication and per-account device syncing'],
    ['git', 'push', 'origin', 'main']
]
for cmd in cmds:
    p = subprocess.run(cmd, cwd=r'C:\Users\Burghardt Norbert\Desktop\HydraREMOTE', capture_output=True, text=True)
    if p.stdout: print(p.stdout.strip())
