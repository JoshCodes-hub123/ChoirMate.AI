@echo off
REM Delegates to the root everyday startup script (start-choirmate.bat).
REM For one-time dependency and HOMR weight setup, run setup-choirmate.bat first.
call "%~dp0..\start-choirmate.bat"
