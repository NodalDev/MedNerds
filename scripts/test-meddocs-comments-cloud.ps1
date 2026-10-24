# Remote execution is OPERATOR-ONLY. Codex must not invoke this wrapper.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('mednerds-security-tests')]
    [string]$ConfirmProject,
    [Parameter(Mandatory=$true)]
    [ValidateSet('wpdfduxzqqlizuhkhebb')]
    [string]$ProjectRef,
    [Parameter(Mandatory=$true)]
    [string]$SslRootCert,
    [string]$PsqlPath = 'C:\Program Files\PostgreSQL\17\bin\psql.exe',
    [switch]$VerifyClean
)
$ErrorActionPreference = 'Stop'
$clientPath = (Resolve-Path -LiteralPath $PsqlPath).Path
$certificatePath = (Resolve-Path -LiteralPath $SslRootCert).Path
if (-not (Test-Path -LiteralPath $clientPath -PathType Leaf) -or
    [IO.Path]::GetFileName($clientPath).ToLowerInvariant() -ne 'psql.exe' -or
    -not (Test-Path -LiteralPath $certificatePath -PathType Leaf)) {
    throw 'Local psql.exe and CA certificate files are required.'
}
foreach ($argumentPath in @($clientPath, $certificatePath)) {
    if ($argumentPath.Contains('"') -or $argumentPath.Contains([char]10) -or $argumentPath.Contains([char]13)) {
        throw 'Invalid local path.'
    }
}
$clientVersion = & $clientPath --version
if ($LASTEXITCODE -ne 0 -or $clientVersion -notmatch 'PostgreSQL\)\s+17\.') {
    throw 'This workflow requires the existing PostgreSQL 17 client.'
}
$nodePath = (Get-Command node -CommandType Application).Source
$runnerPath = Join-Path $PSScriptRoot 'test-meddocs-comments-cloud.mjs'
Write-Host 'Target: mednerds-security-tests (wpdfduxzqqlizuhkhebb), Session Pooler only.'
Write-Host 'aws-0-eu-central-2.pooler.supabase.com:5432 / postgres.wpdfduxzqqlizuhkhebb / TLS verify-full.'
Write-Host 'No Production/Staging target, email delivery or permanent test fixtures.'
$securePassword = Read-Host 'Database password of this isolated test project' -AsSecureString
$passwordPointer = [IntPtr]::Zero
$plainPassword = $null
$passwordBytes = $null
$runnerProcess = $null
try {
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $passwordBytes = [Text.Encoding]::UTF8.GetBytes($plainPassword + [Environment]::NewLine)
    $plainPassword = $null
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $passwordPointer = [IntPtr]::Zero
    $securePassword.Dispose()
    $securePassword = $null
    $startInfo = New-Object Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodePath
    # Paths are existing files without quotes/newlines; all other values use exact ValidateSet bindings.
    $startInfo.Arguments = '"' + $runnerPath + '" --confirm-project=' + $ConfirmProject +
        ' --project-ref=' + $ProjectRef + ' "--psql=' + $clientPath +
        '" "--ssl-root-cert=' + $certificatePath + '"'
    if ($VerifyClean) { $startInfo.Arguments += ' --verify-clean' }
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    foreach ($environmentKey in @($startInfo.EnvironmentVariables.Keys)) {
        if ($environmentKey -match '^(PG|NODE_OPTIONS$|NODE_PATH$)') {
            $startInfo.EnvironmentVariables.Remove($environmentKey)
        }
    }
    $runnerProcess = New-Object Diagnostics.Process
    $runnerProcess.StartInfo = $startInfo
    if (-not $runnerProcess.Start()) { throw 'Could not start local Node runner.' }
    $outputTask = $runnerProcess.StandardOutput.ReadToEndAsync()
    $errorTask = $runnerProcess.StandardError.ReadToEndAsync()
    $runnerProcess.StandardInput.BaseStream.Write($passwordBytes, 0, $passwordBytes.Length)
    $runnerProcess.StandardInput.BaseStream.Flush()
    $runnerProcess.StandardInput.Close()
    [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    $runnerProcess.WaitForExit()
    $outputText = $outputTask.GetAwaiter().GetResult()
    $errorText = $errorTask.GetAwaiter().GetResult()
    if ($outputText) { Write-Host $outputText.TrimEnd() }
    if ($errorText) { [Console]::Error.WriteLine($errorText.TrimEnd()) }
    exit $runnerProcess.ExitCode
} finally {
    if ($passwordBytes) { [Array]::Clear($passwordBytes, 0, $passwordBytes.Length) }
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
    if ($securePassword) { $securePassword.Dispose() }
    if ($runnerProcess) {
        if (-not $runnerProcess.HasExited) { $runnerProcess.Kill() }
        $runnerProcess.Dispose()
    }
}
