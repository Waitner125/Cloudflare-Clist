# WebDAV 测试脚本 (PowerShell)
# 用法: .\test-webdav.ps1 -BaseUrl "https://your-domain" -Username "admin" -Password "password" -StorageId 11

param(
    [Parameter(Mandatory=$true)]
    [string]$BaseUrl,

    [Parameter(Mandatory=$true)]
    [string]$Username,

    [Parameter(Mandatory=$true)]
    [string]$Password,

    [Parameter(Mandatory=$false)]
    [int]$StorageId = 11
)

# 创建 Base64 认证
$AuthBytes = [System.Text.Encoding]::UTF8.GetBytes("${Username}:${Password}")
$AuthBase64 = [System.Convert]::ToBase64String($AuthBytes)
$WebDavUrl = "$BaseUrl/dav/$StorageId/"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "Testing WebDAV at: $WebDavUrl" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

# Test 1: OPTIONS request
Write-Host "Test 1: OPTIONS - Check WebDAV capabilities" -ForegroundColor Yellow
Write-Host "---"
try {
    $response = Invoke-WebRequest -Uri $WebDavUrl -Method OPTIONS -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.StatusDescription)" -ForegroundColor Green
    Write-Host "DAV Header: $($response.Headers['DAV'])" -ForegroundColor Green
    Write-Host "Allow Header: $($response.Headers['Allow'])" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 2: PROPFIND - List directory
Write-Host "Test 2: PROPFIND - List directory contents" -ForegroundColor Yellow
Write-Host "---"
try {
    $headers = @{
        "Authorization" = "Basic $AuthBase64"
        "Depth" = "1"
        "Content-Type" = "application/xml"
    }
    $body = @"
<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:">
    <d:prop>
        <d:displayname/>
        <d:getcontentlength/>
        <d:resourcetype/>
    </d:prop>
</d:propfind>
"@
    $response = Invoke-WebRequest -Uri $WebDavUrl -Method PROPFIND -Headers $headers -Body $body -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.StatusDescription)" -ForegroundColor Green
    Write-Host "Response preview:" -ForegroundColor Green
    Write-Host $response.Content.Substring(0, [Math]::Min(500, $response.Content.Length))
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 3: Upload a test file
Write-Host "Test 3: PUT - Upload test file" -ForegroundColor Yellow
Write-Host "---"
try {
    $testContent = "Hello WebDAV Test from PowerShell!"
    $headers = @{
        "Authorization" = "Basic $AuthBase64"
        "Content-Type" = "text/plain"
    }
    $response = Invoke-WebRequest -Uri "$WebDavUrl/webdav-test.txt" -Method PUT -Headers $headers -Body $testContent -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.StatusDescription)" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 4: Download the test file
Write-Host "Test 4: GET - Download test file" -ForegroundColor Yellow
Write-Host "---"
try {
    $headers = @{
        "Authorization" = "Basic $AuthBase64"
    }
    $response = Invoke-WebRequest -Uri "$WebDavUrl/webdav-test.txt" -Method GET -Headers $headers -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.StatusDescription)" -ForegroundColor Green
    Write-Host "Content: $($response.Content)" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 5: Create directory
Write-Host "Test 5: MKCOL - Create directory" -ForegroundColor Yellow
Write-Host "---"
try {
    $headers = @{
        "Authorization" = "Basic $AuthBase64"
    }
    $response = Invoke-WebRequest -Uri "$WebDavUrl/test-folder/" -Method MKCOL -Headers $headers -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.StatusDescription)" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 6: Delete the test file
Write-Host "Test 6: DELETE - Delete test file" -ForegroundColor Yellow
Write-Host "---"
try {
    $headers = @{
        "Authorization" = "Basic $AuthBase64"
    }
    $response = Invoke-WebRequest -Uri "$WebDavUrl/webdav-test.txt" -Method DELETE -Headers $headers -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.StatusDescription)" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 7: Delete the test folder
Write-Host "Test 7: DELETE - Delete test folder" -ForegroundColor Yellow
Write-Host "---"
try {
    $headers = @{
        "Authorization" = "Basic $AuthBase64"
    }
    $response = Invoke-WebRequest -Uri "$WebDavUrl/test-folder/" -Method DELETE -Headers $headers -UseBasicParsing
    Write-Host "Status: $($response.StatusCode) $($response.StatusDescription)" -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "WebDAV tests completed!" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Expected results:" -ForegroundColor White
Write-Host "- Test 1: Should show 'DAV: 1, 2' header" -ForegroundColor White
Write-Host "- Test 2: Should return 207 Multi-Status with XML" -ForegroundColor White
Write-Host "- Test 3: Should return 201 Created" -ForegroundColor White
Write-Host "- Test 4: Should return 200 OK with file content" -ForegroundColor White
Write-Host "- Test 5: Should return 201 Created" -ForegroundColor White
Write-Host "- Test 6: Should return 204 No Content" -ForegroundColor White
Write-Host "- Test 7: Should return 204 No Content" -ForegroundColor White
