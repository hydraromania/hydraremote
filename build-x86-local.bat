@echo off
setlocal
set PATH=%LOCALAPPDATA%\HydraBuild\nasm\nasm-2.16.03;%PATH%
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvarsall.bat" x86 >NUL 2>&1
cd /d "C:\Users\Burghardt Norbert\Desktop\HydraREMOTE"
npx --yes pkg cli/dist/cli.cjs --target node18-win-x86 --output dist/hydraremote-x86.exe
echo BUILD-EXIT=%ERRORLEVEL%
endlocal
