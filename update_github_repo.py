import subprocess

cmds = [
    ['git', 'add', '-A'],
    ['git', 'commit', '-m', 'Add live server setup and auto-start integration for remote.hydraromania.ro'],
    ['git', 'push', 'origin', 'main']
]

for cmd in cmds:
    p = subprocess.run(cmd, cwd=r'C:\Users\Burghardt Norbert\Desktop\HydraREMOTE', capture_output=True, text=True)
    print(p.stdout)
    if p.stderr:
        print(p.stderr)
