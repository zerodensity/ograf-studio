param(
  [ValidateSet('anthropic', 'openai-compatible')]
  [string]$Provider
)

$ErrorActionPreference = 'Stop'
if (-not $Provider) {
  $Provider = Read-Host 'Provider (anthropic or openai-compatible)'
}
if ($Provider -notin @('anthropic', 'openai-compatible')) {
  throw 'Provider must be anthropic or openai-compatible.'
}

Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class OGCredentialWriter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CREDENTIAL {
    public UInt32 Flags; public UInt32 Type; public IntPtr TargetName; public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public UInt32 CredentialBlobSize; public IntPtr CredentialBlob; public UInt32 Persist;
    public UInt32 AttributeCount; public IntPtr Attributes; public IntPtr TargetAlias; public IntPtr UserName;
  }
  [DllImport("advapi32", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite(ref CREDENTIAL credential, uint flags);
}
'@

$secure = Read-Host 'API key (input is hidden)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$targetPointer = [IntPtr]::Zero
$userPointer = [IntPtr]::Zero
$secretPointer = [IntPtr]::Zero
try {
  $secret = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  if ([string]::IsNullOrWhiteSpace($secret)) { throw 'API key cannot be empty.' }
  $target = "OGraf Studio/$Provider"
  $targetPointer = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($target)
  $userPointer = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni('apikey')
  $secretPointer = [Runtime.InteropServices.Marshal]::StringToCoTaskMemUni($secret)
  $credential = New-Object OGCredentialWriter+CREDENTIAL
  $credential.Type = 1
  $credential.TargetName = $targetPointer
  $credential.UserName = $userPointer
  $credential.CredentialBlob = $secretPointer
  $credential.CredentialBlobSize = $secret.Length * 2
  $credential.Persist = 2
  if (-not [OGCredentialWriter]::CredWrite([ref]$credential, 0)) {
    throw "Windows Credential Manager rejected the credential (error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))."
  }
  Write-Host "Stored $target in Windows Credential Manager. Restart the OGraf Studio server."
} finally {
  if ($secretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeCoTaskMemUnicode($secretPointer) }
  if ($targetPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($targetPointer) }
  if ($userPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeCoTaskMem($userPointer) }
  if ($bstr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
