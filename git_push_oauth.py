import subprocess

cmds = [
    ['git', 'add', '-A'],
    ['git', 'commit', '-m', 'Configure Google OAuth Client ID for remote.hydraromania.ro'],
    ['git', 'push', 'origin', 'main']
]
for cmd in cmds:
    p = subprocess.run(cmd, cwd=r'C:\Users\Burghardt Norbert\Desktop\HydraREMOTE', capture_output=True, text=True)
    if p.stdout: print(p.stdout.strip())
