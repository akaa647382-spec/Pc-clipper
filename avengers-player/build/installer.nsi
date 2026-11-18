; ---------------------------------------------------------------------------
; Avengers Player - Windows installer (NSIS 3, stock plug-ins only).
;
; Do not compile this file by hand. Run "node scripts/build-win.mjs" (or
; "npm run build:win"); the script packages the app and then calls makensis
; with these defines:
;
;   -DAPP_VERSION=1.2.3       version from package.json (three numbers)
;   -DSOURCE_DIR=<folder>     the packaged app (out/Avengers Player-win32-x64)
;   -DOUTPUT_FILE=<file>      where the installer is written
;   -DUNINSTALL_LIST=<file>   generated include: one Delete line per packaged
;                             file and one RMDir line per packaged folder
;
; Design notes
;   * Per-user install into %LOCALAPPDATA%\Programs. Nothing needs
;     administrator rights, so there is never a UAC prompt.
;   * Already installed: Setup says so and asks first ("update it to x.y.z?",
;     "replace it?", or "a newer version is installed: replace it?"). On yes
;     the welcome and folder pages are skipped and the new version goes into
;     the folder of the old one; on no Setup quits. In silent mode the answer
;     is yes.
;   * Upgrades: a running copy is closed first, then the previous version's
;     own uninstaller removes its files, then the new files are copied. The
;     user's settings live in %APPDATA% and are never touched, and a
;     countdown's "start at sign-in" entry is put back.
;   * The uninstaller deletes exactly the files this installer copied (the
;     generated list) and then removes the folder only if it is empty. It
;     never does "RMDir /r $INSTDIR": if someone installs into a folder that
;     also holds their own files (Desktop, Documents, ...), a recursive
;     delete would take those files with it.
;   * Silent mode works: "Avengers-Player-Setup-x.y.z.exe /S" and optionally
;     "/D=C:\some\folder" as the last argument.
; ---------------------------------------------------------------------------

Unicode true

!ifndef APP_VERSION
  !error "APP_VERSION is not defined. Build with: node scripts/build-win.mjs"
!endif
!ifndef SOURCE_DIR
  !error "SOURCE_DIR is not defined. Build with: node scripts/build-win.mjs"
!endif
!ifndef OUTPUT_FILE
  !error "OUTPUT_FILE is not defined. Build with: node scripts/build-win.mjs"
!endif
!ifndef UNINSTALL_LIST
  !error "UNINSTALL_LIST is not defined. Build with: node scripts/build-win.mjs"
!endif

!define APP_NAME "Avengers Player"
!define APP_EXE "Avengers Player.exe"
!define APP_PUBLISHER "akaa"
!define UNINSTALLER_EXE "Uninstall Avengers Player.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\AvengersPlayer"
!define /date BUILD_YEAR "%Y"

; The icon sits next to this script; __FILEDIR__ keeps that true no matter
; which folder makensis is started from.
!ifndef ICON_FILE
  !define ICON_FILE "${__FILEDIR__}\icon.ico"
!endif

; Solid LZMA with a 64 MB dictionary: Chromium's large binaries compress far
; better when the compressor can look that far back, and the installer has to
; stay under GitHub's 100 MB file limit.
SetCompressor /SOLID lzma
SetCompressorDictSize 64

Name "${APP_NAME}"
OutFile "${OUTPUT_FILE}"
BrandingText "${APP_NAME} ${APP_VERSION}"

; "user" = run with the rights of whoever started the installer. No UAC.
RequestExecutionLevel user
ManifestDPIAware true

InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
; An upgrade defaults to wherever the previous version was installed.
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "WinVer.nsh"
!include "x64.nsh"
!include "WordFunc.nsh"

; The copy already on this PC, if any (found in .onInit).
Var OldDir      ; its folder, "" when there is none
Var OldVer      ; its version, "" when unknown
Var Replacing   ; "1" once the user agreed to replace it

; ---------------------------------------------------------------------------
; Pages
; ---------------------------------------------------------------------------

!define MUI_ICON "${ICON_FILE}"
!define MUI_UNICON "${ICON_FILE}"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TEXT "Setup will install ${APP_NAME} ${APP_VERSION} for your Windows account. No administrator password is needed.$\r$\n$\r$\nIf ${APP_NAME} is open, Setup will close it first.$\r$\n$\r$\nClick Next to continue."

; The box is ticked unless MUI_FINISHPAGE_RUN_NOTCHECKED is defined.
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Launch ${APP_NAME}"
!define MUI_FINISHPAGE_NOREBOOTSUPPORT

; Replacing a copy that is already installed: no welcome, no folder to choose
; (the new version goes where the old one is).
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenReplacing
!insertmacro MUI_PAGE_WELCOME
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipWhenReplacing
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

; ---------------------------------------------------------------------------
; Version information shown in the installer's Properties > Details tab
; ---------------------------------------------------------------------------

VIProductVersion "${APP_VERSION}.0"
VIFileVersion "${APP_VERSION}.0"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${APP_VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "Copyright (C) ${BUILD_YEAR} ${APP_PUBLISHER}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "OriginalFilename" "Avengers-Player-Setup-${APP_VERSION}.exe"

; ---------------------------------------------------------------------------
; Closing a running copy
;
; Windows refuses to replace or delete a program file while it is running.
; The functions are generated twice because NSIS requires uninstaller
; functions to carry the "un." prefix.
; ---------------------------------------------------------------------------

!macro DefineCloseFunctions UN

  ; Leaves "1" in $0 when the installed program file cannot be opened for
  ; writing, which means some process is still running from it. This works
  ; for the main window and for stray helper processes alike, and it does
  ; not depend on taskkill's exit codes.
  Function ${UN}IsAppLocked
    StrCpy $0 "0"
    ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
      ClearErrors
      FileOpen $1 "$INSTDIR\${APP_EXE}" a
      ${If} ${Errors}
        StrCpy $0 "1"
      ${Else}
        FileClose $1
      ${EndIf}
    ${EndIf}
  FunctionEnd

  ; Polls for up to five seconds; $0 holds the final IsAppLocked answer.
  Function ${UN}WaitForAppUnlock
    StrCpy $2 0
    ${Do}
      Call ${UN}IsAppLocked
      ${If} $0 == "0"
        ${ExitDo}
      ${EndIf}
      Sleep 250
      IntOp $2 $2 + 1
    ${LoopUntil} $2 >= 20
  FunctionEnd

  Function ${UN}CloseRunningApp
    Call ${UN}IsAppLocked
    ${If} $0 == "1"
      DetailPrint "Closing ${APP_NAME}..."
      ; Ask politely first so the app can save its settings on the way out.
      ; taskkill's result is popped and ignored: failing to close is not a
      ; reason to stop here, the lock check below decides what happens next.
      nsExec::Exec '"$SYSDIR\taskkill.exe" /IM "${APP_EXE}"'
      Pop $3
      Call ${UN}WaitForAppUnlock
      ${If} $0 == "1"
        ; Still running (or only helper processes are left): end the whole
        ; process tree.
        nsExec::Exec '"$SYSDIR\taskkill.exe" /F /T /IM "${APP_EXE}"'
        Pop $3
        Call ${UN}WaitForAppUnlock
      ${EndIf}
    ${EndIf}
  FunctionEnd

!macroend

!insertmacro DefineCloseFunctions ""
!insertmacro DefineCloseFunctions "un."

; ---------------------------------------------------------------------------
; Removing a previous version
; ---------------------------------------------------------------------------

; Takes a folder from the stack. If it holds one of our uninstallers, runs it
; silently so that files the new version no longer ships do not linger.
Function RunPreviousUninstaller
  Pop $R1
  ${If} ${FileExists} "$R1\${UNINSTALLER_EXE}"
    DetailPrint "Removing the previous version..."
    ; "_?=" makes the uninstaller work in place instead of copying itself to
    ; a temporary folder and returning at once, so ExecWait really waits. It
    ; must be the last argument and must not be quoted, spaces or not.
    ClearErrors
    ExecWait '"$R1\${UNINSTALLER_EXE}" /S _?=$R1' $R2
    ; An uninstaller that ran in place cannot delete itself.
    Delete "$R1\${UNINSTALLER_EXE}"
    RMDir "$R1"
  ${EndIf}
FunctionEnd

Function RemovePreviousVersion
  ; A previous install may sit in a different folder than the one chosen now.
  ReadRegStr $R0 HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ${If} $R0 != ""
  ${AndIf} $R0 != $INSTDIR
    Push $R0
    Call RunPreviousUninstaller
  ${EndIf}
  Push $INSTDIR
  Call RunPreviousUninstaller
FunctionEnd

; ---------------------------------------------------------------------------
; Installer
; ---------------------------------------------------------------------------

Function SkipWhenReplacing
  ${If} $Replacing == "1"
    Abort
  ${EndIf}
FunctionEnd

; Finds a copy that is already installed and asks whether to replace it.
Function AskToReplace
  StrCpy $Replacing "0"
  ReadRegStr $OldDir HKCU "${UNINSTALL_KEY}" "InstallLocation"
  ReadRegStr $OldVer HKCU "${UNINSTALL_KEY}" "DisplayVersion"
  ${If} $OldDir == ""
  ${OrIfNot} ${FileExists} "$OldDir\${APP_EXE}"
    ; Not registered, or not where the registry says: a copy in the folder
    ; Setup would use still counts.
    StrCpy $OldVer ""
    StrCpy $OldDir ""
    ${If} ${FileExists} "$INSTDIR\${APP_EXE}"
      StrCpy $OldDir "$INSTDIR"
    ${EndIf}
  ${EndIf}
  ${If} $OldDir == ""
    Return
  ${EndIf}

  ; $0: what is installed and the question; $2: what Yes does.
  ${If} $OldVer == ""
    StrCpy $0 "${APP_NAME} is already installed on this PC.$\r$\n$\r$\nDo you want to replace it with version ${APP_VERSION}?"
    StrCpy $2 "replace it"
  ${Else}
    ${VersionCompare} "${APP_VERSION}" "$OldVer" $1
    ${If} $1 == "1"
      StrCpy $0 "${APP_NAME} $OldVer is already installed on this PC.$\r$\n$\r$\nDo you want to update it to version ${APP_VERSION}?"
      StrCpy $2 "update it"
    ${ElseIf} $1 == "0"
      StrCpy $0 "${APP_NAME} ${APP_VERSION} is already installed on this PC.$\r$\n$\r$\nDo you want to install it again (replace it)?"
      StrCpy $2 "install it again"
    ${Else}
      StrCpy $0 "A newer version of ${APP_NAME} ($OldVer) is already installed on this PC.$\r$\n$\r$\nDo you want to replace it with version ${APP_VERSION}?"
      StrCpy $2 "replace it with ${APP_VERSION}"
    ${EndIf}
  ${EndIf}
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON1 "$0$\r$\n$\r$\nSetup will replace the program in its folder:$\r$\n$OldDir$\r$\n$\r$\nYour settings, snap points and countdown stay as they are. If ${APP_NAME} is open, Setup closes it first.$\r$\n$\r$\nYes: $2.$\r$\nNo: leave it as it is and close Setup." /SD IDYES IDYES replace
  Quit
  replace:
  StrCpy $Replacing "1"
FunctionEnd

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${APP_NAME} needs a 64-bit version of Windows 10 or Windows 11.$\r$\n$\r$\nThis computer runs 32-bit Windows, so Setup cannot continue." /SD IDOK
    Abort
  ${EndIf}
  ; Only a warning: compatibility-mode settings can make Windows report an
  ; older version than it really is, and blocking a good PC would be worse.
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_YESNO|MB_ICONEXCLAMATION "${APP_NAME} is made for Windows 10 and Windows 11, and this looks like an older version of Windows. It will probably not start here.$\r$\n$\r$\nInstall anyway?" /SD IDYES IDYES proceed
    Abort
    proceed:
  ${EndIf}
  Call AskToReplace
FunctionEnd

Section "${APP_NAME}" SecApp
  SectionIn RO
  SetShellVarContext current

  ; An armed countdown starts the app at sign-in. The old version's uninstaller
  ; takes that entry away: note it, and put it back for the new version.
  ReadRegStr $R5 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AvengersPlayer"

  Call CloseRunningApp
  Call RemovePreviousVersion

  SetOutPath "$INSTDIR"
  SetOverwrite on
  File /r "${SOURCE_DIR}\*"

  ${If} $R5 != ""
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AvengersPlayer" '"$INSTDIR\${APP_EXE}"'
  ${EndIf}
SectionEnd

Section "-Register"
  SetShellVarContext current
  ; Shortcuts start in the install folder.
  SetOutPath "$INSTDIR"

  WriteUninstaller "$INSTDIR\${UNINSTALLER_EXE}"

  CreateShortcut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  ; Entry in Settings > Apps (per user, so HKCU).
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER_EXE}"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER_EXE}" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  ; Size of the copied files in KB, as Windows expects.
  SectionGetSize ${SecApp} $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
SectionEnd

; ---------------------------------------------------------------------------
; Uninstaller
; ---------------------------------------------------------------------------

Section "Uninstall"
  SetShellVarContext current

  Call un.CloseRunningApp

  ; Exactly the files and folders this installer copied.
  !include "${UNINSTALL_LIST}"

  ; Chromium can leave this behind when it is started with logging enabled.
  Delete "$INSTDIR\debug.log"
  Delete "$INSTDIR\${UNINSTALLER_EXE}"
  ; Not recursive on purpose: the folder goes only if nothing else is in it.
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"

  ; The app adds itself to "start at sign-in" while a countdown is armed: take that with it.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AvengersPlayer"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "AvengersPlayer"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"

  ; The user's settings in %APPDATA% are deliberately left alone, so an
  ; upgrade or a reinstall starts with everything still set up.
SectionEnd
