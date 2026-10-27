; Spark DSH Windows single-file launcher.
; The web page appends a UTF-8 PowerShell installer and a fixed footer:
;   SPRK + 8 decimal digits (payload length) + LF
; This stub copies the appended payload to %TEMP% and runs it with Windows
; PowerShell. It deliberately only uses per-user paths and does not request
; administrator rights.

Unicode true
!include "LogicLib.nsh"

!ifndef OUTFILE
  !define OUTFILE "assets/spark-install-stub.exe"
!endif

Name "Spark DSH Installer"
OutFile "${OUTFILE}"
Icon "..\assets\spark-dsh.ico"
RequestExecutionLevel user
SilentInstall silent
SetCompressor zlib
ShowInstDetails nevershow
BrandingText "Spark DSH"

VIProductVersion "2.0.0.0"
VIAddVersionKey "ProductName" "Spark DSH Installer"
VIAddVersionKey "CompanyName" "Spark Lab"
VIAddVersionKey "FileDescription" "Spark DSH installer"
VIAddVersionKey "FileVersion" "2.0.0.0"
VIAddVersionKey "LegalCopyright" "Spark Lab"

Section "Install"
  StrCpy $R7 "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$R7" powershell_ready 0
  StrCpy $R7 "powershell.exe"

powershell_ready:
  FileOpen $0 "$EXEPATH" r
  IfErrors no_payload_error
  FileSeek $0 0 END $R0
  IntCmp $R0 13 too_small too_small payload_size_ok

payload_size_ok:
  IntOp $R1 $R0 - 13
  FileSeek $0 $R1 SET
  FileRead $0 $R2
  StrLen $R3 $R2
  StrCmp $R3 12 0 no_payload_error
  StrCpy $R4 $R2 4
  StrCmp $R4 "SPRK" 0 no_payload_error
  StrCpy $R5 $R2 8 4
  IntOp $R5 $R5 + 0
  IntCmp $R5 0 no_payload_error too_big_error payload_size_ok2

payload_size_ok2:
  IntOp $R6 $R0 - 13
  IntCmp $R5 $R6 payload_offset_ok no_payload_error too_big_error

payload_offset_ok:
  IntOp $R6 $R6 - $R5
  FileSeek $0 $R6 SET
  StrCpy $R1 "$TEMP\SparkDSH-spark-install.ps1"
  Delete "$R1"
  FileOpen $1 "$R1" w
  IfErrors temp_error
  StrCpy $R8 0

copy_loop:
  IntCmp $R8 $R5 copy_done
  FileReadByte $0 $R9
  FileWriteByte $1 $R9
  IntOp $R8 $R8 + 1
  Goto copy_loop

copy_done:
  FileClose $1
  FileClose $0
  ; The installer is a GUI process. Attach a console so PowerShell's password
  ; prompts and progress messages are visible to the user.
  System::Call 'kernel32::AllocConsole()i.r0'
  ExecWait '"$R7" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "$R1"' $R9
  Delete "$R1"
  IntCmp $R9 0 install_done install_failed install_done

install_failed:
  MessageBox MB_ICONSTOP|MB_OK "Spark DSH installation failed (exit code $R9).$\r$\nSee %LOCALAPPDATA%\SparkDSH\install.log for details."
  SetErrorLevel $R9
  Goto install_done

too_small:
  FileClose $0
  Goto no_payload_error

too_big_error:
  FileClose $0
  MessageBox MB_ICONSTOP|MB_OK "This installer is corrupt or incomplete. Please download it again."
  SetErrorLevel 3
  Goto install_done

no_payload_error:
  FileClose $0
  MessageBox MB_ICONSTOP|MB_OK "This installer is missing its payload. Please download it again."
  SetErrorLevel 3
  Goto install_done

temp_error:
  FileClose $1
  FileClose $0
  MessageBox MB_ICONSTOP|MB_OK "Cannot write the temporary installer to %TEMP%."
  SetErrorLevel 4

install_done:
SectionEnd
