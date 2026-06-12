#!/bin/bash
# WebDAV 测试脚本
# 用法: ./test-webdav.sh <base_url> <username> <password> <storage_id>
# 例如: ./test-webdav.sh https://your-domain admin password 11

set -e

BASE_URL="$1"
USERNAME="$2"
PASSWORD="$3"
STORAGE_ID="${4:-11}"

if [ -z "$BASE_URL" ] || [ -z "$USERNAME" ] || [ -z "$PASSWORD" ]; then
    echo "Usage: $0 <base_url> <username> <password> [storage_id]"
    echo "Example: $0 https://your-domain admin password 11"
    exit 1
fi

AUTH=$(echo -n "$USERNAME:$PASSWORD" | base64)
WEBDAV_URL="$BASE_URL/dav/$STORAGE_ID/"

echo "=========================================="
echo "Testing WebDAV at: $WEBDAV_URL"
echo "=========================================="
echo ""

# Test 1: OPTIONS request
echo "Test 1: OPTIONS - Check WebDAV capabilities"
echo "---"
curl -i -X OPTIONS "$WEBDAV_URL" 2>/dev/null | head -20
echo ""
echo ""

# Test 2: PROPFIND - List root
echo "Test 2: PROPFIND - List directory contents"
echo "---"
curl -i -X PROPFIND \
  -H "Authorization: Basic $AUTH" \
  -H "Depth: 1" \
  -H "Content-Type: application/xml" \
  --data '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:displayname/><d:getcontentlength/><d:resourcetype/></d:prop></d:propfind>' \
  "$WEBDAV_URL" 2>/dev/null | head -30
echo ""
echo ""

# Test 3: Upload a test file
echo "Test 3: PUT - Upload test file"
echo "---"
echo "Hello WebDAV Test!" > /tmp/webdav-test.txt
curl -i -X PUT \
  -H "Authorization: Basic $AUTH" \
  --data-binary @/tmp/webdav-test.txt \
  "$WEBDAV_URL/webdav-test.txt" 2>/dev/null | head -15
echo ""
echo ""

# Test 4: Download the test file
echo "Test 4: GET - Download test file"
echo "---"
curl -i -X GET \
  -H "Authorization: Basic $AUTH" \
  "$WEBDAV_URL/webdav-test.txt" 2>/dev/null | head -20
echo ""
echo ""

# Test 5: Create directory
echo "Test 5: MKCOL - Create directory"
echo "---"
curl -i -X MKCOL \
  -H "Authorization: Basic $AUTH" \
  "$WEBDAV_URL/test-folder/" 2>/dev/null | head -15
echo ""
echo ""

# Test 6: Delete the test file
echo "Test 6: DELETE - Delete test file"
echo "---"
curl -i -X DELETE \
  -H "Authorization: Basic $AUTH" \
  "$WEBDAV_URL/webdav-test.txt" 2>/dev/null | head -15
echo ""
echo ""

# Test 7: Delete the test folder
echo "Test 7: DELETE - Delete test folder"
echo "---"
curl -i -X DELETE \
  -H "Authorization: Basic $AUTH" \
  "$WEBDAV_URL/test-folder/" 2>/dev/null | head -15
echo ""
echo ""

# Cleanup
rm -f /tmp/webdav-test.txt

echo "=========================================="
echo "WebDAV tests completed!"
echo "=========================================="
echo ""
echo "Expected results:"
echo "- Test 1: Should show 'DAV: 1, 2' header"
echo "- Test 2: Should return 207 Multi-Status with XML"
echo "- Test 3: Should return 201 Created"
echo "- Test 4: Should return 200 OK with file content"
echo "- Test 5: Should return 201 Created"
echo "- Test 6: Should return 204 No Content"
echo "- Test 7: Should return 204 No Content"
