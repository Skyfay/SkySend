# Management API

## DELETE /api/upload/:id

Delete an upload. Requires the owner token.

### Request

**Headers:**

| Header | Type | Description |
| --- | --- | --- |
| `X-Owner-Token` | base64url | Ownership token |

### Response

**200 OK:**

```json
{
  "ok": true
}
```

**401 Unauthorized:**

```json
{
  "error": "Invalid or missing owner token"
}
```

**404 Not Found:**

```json
{
  "error": "Upload not found"
}
```

### Notes

- The database record is deleted first, then the file on disk (best-effort)
- If the file-on-disk deletion fails (e.g., already removed), the operation still succeeds
- After deletion, the upload ID returns `404` on all endpoints

### Example

```bash
curl -X DELETE \
  -H "X-Owner-Token: dGVzdA" \
  http://localhost:3000/api/upload/a1b2c3d4-e5f6-7890-abcd-ef1234567890
```
