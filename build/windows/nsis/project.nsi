Unicode true

####
## Please note: Template replacements don't work in this file. They are provided with default defines like
## mentioned underneath.
## If the keyword is not defined, "wails_tools.nsh" will populate them.
## If they are defined here, "wails_tools.nsh" will not touch them. This allows you to use this project.nsi manually
## from outside of Wails for debugging and development of the installer.
## 
## For development first make a wails nsis build to populate the "wails_tools.nsh":
## > wails build --target windows/amd64 --nsis
## Then you can call makensis on this file with specifying the path to your binary:
## 脚本里有中文，必须用 -INPUTCHARSET UTF8，否则在非 UTF-8 代码页的机器上会编译成乱码。
## For a AMD64 only installer:
## > makensis -INPUTCHARSET UTF8 -DARG_WAILS_AMD64_BINARY=..\..\bin\app.exe
## For a ARM64 only installer:
## > makensis -INPUTCHARSET UTF8 -DARG_WAILS_ARM64_BINARY=..\..\bin\app.exe
## For a installer with both architectures:
## > makensis -INPUTCHARSET UTF8 -DARG_WAILS_AMD64_BINARY=..\..\bin\app-amd64.exe -DARG_WAILS_ARM64_BINARY=..\..\bin\app-arm64.exe
####
## The following information is taken from the wails_tools.nsh file, but they can be overwritten here.
####
## !define INFO_PROJECTNAME    "my-project" # Default "tmp2"
## !define INFO_COMPANYNAME    "My Company" # Default "My Company"
## !define INFO_PRODUCTNAME    "My Product Name" # Default "My Product"
## !define INFO_PRODUCTVERSION "1.0.0"     # Default "0.1.0"
## !define INFO_COPYRIGHT      "(c) Now, My Company" # Default "© 2026, My Company"
###
## !define PRODUCT_EXECUTABLE  "Application.exe"      # Default "${INFO_PROJECTNAME}.exe"
## !define UNINST_KEY_NAME     "UninstKeyInRegistry"  # Default "${INFO_COMPANYNAME}${INFO_PRODUCTNAME}"
####
## !define REQUEST_EXECUTION_LEVEL "admin"            # Default "admin"  see also https://nsis.sourceforge.io/Docs/Chapter4.html
## !define WAILS_INSTALL_SCOPE     "user"             # Default "machine" - set to "user" for per-user install ($LOCALAPPDATA) without UAC prompt
####
## Include the wails tools
####
!include "wails_tools.nsh"

# The version information for this two must consist of 4 parts
VIProductVersion "${INFO_PRODUCTVERSION}.0"
VIFileVersion    "${INFO_PRODUCTVERSION}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${INFO_PRODUCTVERSION}"
VIAddVersionKey "FileVersion"     "${INFO_PRODUCTVERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
# !define MUI_WELCOMEFINISHPAGE_BITMAP "resources\leftimage.bmp" #Include this to add a bitmap on the left side of the Welcome Page. Must be a size of 164x314
!define MUI_FINISHPAGE_NOAUTOCLOSE # Wait on the INSTFILES page so the user can take a look into the details of the installation steps
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.

## 安装目录名固定为 ASCII，中文产品名只用于显示（安装向导标题、快捷方式、卸载列表）。
## 目录名带中文会让用户手动输入/粘贴路径、看日志、排查 sidecar 都更麻烦。
!define INSTALL_DIRNAME "aling-go"

!insertmacro MUI_PAGE_WELCOME # Welcome to the installer page.
# !insertmacro MUI_PAGE_LICENSE "resources\eula.txt" # Adds a EULA page to the installer
## 目录页：选目录前先把两个已知坑说清楚，离开页面时再预检写权限。
## - 不能选盘符根目录（如 D:\）或网络共享根目录：NSIS 默认就拒绝，因为卸载时
##   会 RMDir /r 整个 $INSTDIR，装到根目录等于让卸载器删整个盘。
## - 安装包以当前用户权限运行（user scope，保证应用内自动更新能写 exe），
##   所以目标目录必须是当前用户可写的，Program Files 之类的受保护位置会失败。
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ValidateInstallDir
!define MUI_DIRECTORYPAGE_TEXT_TOP "请选择当前用户有写权限的文件夹（例 D:\Apps\aling-go，可在『浏览』中新建），不要选盘符根目录或网络共享根目录。"
!insertmacro MUI_PAGE_DIRECTORY # In which folder install page.
!insertmacro MUI_PAGE_INSTFILES # Installing page.
!insertmacro MUI_PAGE_FINISH # Finished installation page.

!insertmacro MUI_UNPAGE_INSTFILES # Uninstalling page

!insertmacro MUI_LANGUAGE "English" # Set the Language of the installer

## The following two statements can be used to sign the installer and the uninstaller. The path to the binaries are provided in %1
#!uninstfinalize 'signtool --file "%1"'
#!finalize 'signtool --file "%1"'

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\..\bin\${INFO_PROJECTNAME}-${INFO_PRODUCTVERSION}-${ARCH}-installer.exe" # Name of the installer's file.
!if "${WAILS_INSTALL_SCOPE}" == "user"
    InstallDir "$LOCALAPPDATA\Programs\${INSTALL_DIRNAME}"
!else
    InstallDir "$PROGRAMFILES64\${INSTALL_DIRNAME}"
!endif
ShowInstDetails show # This will always show the installation details.

## 目录页离开前预检写权限：选到只读目录或受保护位置时，如果不在这里拦下，
## 要到复制文件阶段才会失败，用户看不出原因，也不知道该换成哪个目录。
Function ValidateInstallDir
    CreateDirectory "$INSTDIR"
    ClearErrors
    FileOpen $0 "$INSTDIR\.aling-write-test" w
    IfErrors 0 WriteOK
        MessageBox MB_ICONSTOP|MB_OK "无法写入安装目录：$INSTDIR$\r$\n$\r$\n请选择一个当前用户有写权限的文件夹（例如 D:\Apps\aling-go）。以管理员身份运行安装程序可以写入受保护目录，但安装后应用内自动更新会失败。"
        Abort
    WriteOK:
        FileClose $0
        Delete "$INSTDIR\.aling-write-test"
FunctionEnd

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR
    
    !insertmacro wails.files

    ## sidecar 与只读数据库安装到 exe 同目录，Windows 上应用从这里读取。
    ## 两个 define 由 Taskfile 传入；手工 makensis 时可缺省。
    !ifdef ARG_WAILS_SIDECAR_DIR
        File "${ARG_WAILS_SIDECAR_DIR}\ffmpeg.exe"
        File "${ARG_WAILS_SIDECAR_DIR}\whisper-sidecar.exe"
        File "${ARG_WAILS_SIDECAR_DIR}\yt-dlp.exe"
    !endif

    !ifdef ARG_WAILS_DATA_DIR
        File "${ARG_WAILS_DATA_DIR}\dict.db"
        File "${ARG_WAILS_DATA_DIR}\articles.db"
    !endif

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    CreateShortCut "$DESKTOP\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro wails.associateFiles
    !insertmacro wails.associateCustomProtocols
    
    !insertmacro wails.writeUninstaller
SectionEnd

Section "uninstall" 
    !insertmacro wails.setShellContext

    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}" # Remove the WebView2 DataPath

    RMDir /r $INSTDIR

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"
    Delete "$DESKTOP\${INFO_PRODUCTNAME}.lnk"

    !insertmacro wails.unassociateFiles
    !insertmacro wails.unassociateCustomProtocols

    !insertmacro wails.deleteUninstaller
SectionEnd
