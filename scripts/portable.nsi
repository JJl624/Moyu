!include "common.nsh"
CRCCheck on
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel user
Var dataRoot
Var cacheRoot
Var prepareLock
Var packageArch
Var customData
Var prepareStage
Var prepareError
Var probeFile

Function .onInit
  SetSilent silent
  !insertmacro check64BitAndSetRegView
FunctionEnd

Section
  StrCpy $prepareLock 0
  StrCpy $prepareStage "应用数据目录"
  ReadEnvStr $probeFile "MOYU_PORTABLE_PROBE"
  ReadEnvStr $0 "MOYU_TEST"
  ${If} $0 != "1"
    StrCpy $probeFile ""
  ${EndIf}
  ReadEnvStr $dataRoot "MOYU_USER_DATA"
  StrCpy $customData 1
  ${If} $dataRoot == ""
    StrCpy $customData 0
    StrCpy $dataRoot "$DOCUMENTS\MoyuData"
  ${EndIf}
  # NSIS GetFullPathName requires an existing path and may return an empty
  # string on the first launch. Win32 resolves paths before they are created.
  System::Call 'Kernel32::GetFullPathNameW(w "$dataRoot", i ${NSIS_MAX_STRLEN}, w .r1, p 0)i.r0'
  ${If} $0 == 0
  ${OrIf} $0 >= ${NSIS_MAX_STRLEN}
    Goto failure
  ${EndIf}
  StrCpy $dataRoot $1
  StrCpy $cacheRoot "$dataRoot\cache\temp"
  ClearErrors
  CreateDirectory $cacheRoot
  IfErrors failure
  ${If} $customData == 1
    System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("MOYU_USER_DATA", "$dataRoot").r0'
  ${EndIf}
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("TEMP", "$cacheRoot").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("TMP", "$cacheRoot").r0'
  !ifdef APP_DIR_64
    StrCpy $packageArch "64"
  !endif
  !ifdef APP_DIR_32
    ${IfNot} ${RunningX64}
      StrCpy $packageArch "32"
    ${EndIf}
  !endif
  !ifdef APP_DIR_ARM64
    ${If} ${IsNativeARM64}
      StrCpy $packageArch "ARM64"
    ${EndIf}
  !endif
  StrCpy $INSTDIR "$dataRoot\programs\${VERSION}-$packageArch-@BUILD_ID@"

  # Serialize extraction across launches. Release the lock before running the app.
  StrCpy $prepareStage "启动锁"
  System::Call 'Kernel32::CreateMutex(p 0, i 0, t "Local\MoyuPrepare-@BUILD_ID@")p.r0'
  StrCpy $prepareLock $0
  ${If} $prepareLock == 0
    Goto failure
  ${EndIf}
  System::Call 'Kernel32::WaitForSingleObject(p $prepareLock, i 120000)i.r0'
  ${If} $0 != 0
  ${AndIf} $0 != 128
    Goto failure
  ${EndIf}
  IfFileExists "$INSTDIR\ready.txt" 0 extract
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 extract
  IfFileExists "$INSTDIR\resources\app.asar" prepared extract

extract:
  StrCpy $prepareStage "程序解压"
  ClearErrors
  SetOutPath $INSTDIR
  IfErrors failure
  # Repair only missing or changed files. Reopening unchanged executable/DLL
  # files immediately after exit can race Windows releasing their handles.
  SetOverwrite ifdiff
  ${If} $packageArch == "ARM64"
    !ifdef APP_DIR_ARM64
      File /r "${APP_DIR_ARM64}\*.*"
    !endif
  ${ElseIf} $packageArch == "64"
    !ifdef APP_DIR_64
      File /r "${APP_DIR_64}\*.*"
    !endif
  ${Else}
    !ifdef APP_DIR_32
      File /r "${APP_DIR_32}\*.*"
    !endif
  ${EndIf}
  IfErrors failure
  IfFileExists "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0 failure
  IfFileExists "$INSTDIR\resources\app.asar" 0 failure
  StrCpy $prepareStage "完成标记"
  ClearErrors
  FileOpen $R0 "$INSTDIR\ready.txt" w
  IfErrors failure
  FileWrite $R0 "@BUILD_ID@"
  FileClose $R0
  IfErrors failure

prepared:
  System::Call 'Kernel32::ReleaseMutex(p $prepareLock)'
  System::Call 'Kernel32::CloseHandle(p $prepareLock)'
  StrCpy $prepareLock 0
  # Probe the actual default-folder bootstrap without opening user documents.
  ${If} $probeFile != ""
    ClearErrors
    FileOpen $R0 $probeFile w
    IfErrors failure
    FileWriteUTF16LE $R0 "prepared$\r$\ndata=$dataRoot$\r$\nprogram=$INSTDIR$\r$\n"
    FileClose $R0
    SetErrorLevel 0
    Goto done
  ${EndIf}
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0
  StrCpy $prepareStage "启动应用"
  ClearErrors
  ExecWait '"$INSTDIR\${APP_EXECUTABLE_FILENAME}" $R0' $0
  IfErrors failure
  SetErrorLevel $0
  Goto done

failure:
  System::Call 'Kernel32::GetLastError()i.r0'
  StrCpy $prepareError $0
  ${If} $prepareLock != 0
    System::Call 'Kernel32::ReleaseMutex(p $prepareLock)'
    System::Call 'Kernel32::CloseHandle(p $prepareLock)'
  ${EndIf}
  ${If} $probeFile != ""
    ClearErrors
    FileOpen $R0 $probeFile w
    IfErrors showFailure
    FileWriteUTF16LE $R0 "failed$\r$\nstage=$prepareStage$\r$\nerror=$prepareError$\r$\ndata=$dataRoot$\r$\n"
    FileClose $R0
    Goto showFailure
  ${EndIf}
  ${If} $cacheRoot == ""
    Goto showFailure
  ${EndIf}
  ClearErrors
  FileOpen $R0 "$cacheRoot\startup-error.txt" w
  IfErrors showFailure
  FileWriteUTF16LE $R0 "阶段：$prepareStage$\r$\nWindows 错误：$prepareError$\r$\n数据目录：$dataRoot$\r$\n程序目录：$INSTDIR$\r$\n"
  FileClose $R0
showFailure:
  ${If} $probeFile == ""
    MessageBox MB_OK|MB_ICONSTOP "无法准备 Moyu 程序环境。$\r$\n阶段：$prepareStage$\r$\nWindows 错误：$prepareError$\r$\n目录：$dataRoot$\r$\n详细信息：$cacheRoot\startup-error.txt"
  ${EndIf}
  SetErrorLevel 1
done:
SectionEnd
