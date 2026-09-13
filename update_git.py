import subprocess

cmds = [
    ['git', 'add', '-A'],
    ['git', 'commit', '-m', 'Add Google Remote Desktop style online/offline device monitoring dashboard and authentication'],
    ['git', 'push', 'origin', 'main']
]

for cmd in cmds:
    p = subprocess.run(cmd, cwd=r'C:\Users\Burghardt Norbert\Desktop\HydraREMOTE', capture_output=True, text=True)
    print(p.stdout)
    if p.stderr:
        print(p.stderr)
